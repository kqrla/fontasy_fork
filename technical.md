# fontasy — technical implementation notes

this document evaluates the feasibility of each roadmap feature, distinguishing what can be built inside the figma plugin environment from what requires a companion web app or server.

---

## architecture constraints of the current plugin

the plugin runs in two isolated environments:

1. the sandbox (`code.ts` / `code.js`) — a restricted js runtime with access to the figma plugin api. no dom, no `fetch`, no `canvas`, no `AudioContext`. communicates with the ui iframe via `postMessage`.
2. the ui iframe (`ui.html`) — a standard browser iframe running inside figma's plugin panel. has full browser apis (`canvas`, `fetch`, `OffscreenCanvas`, `createImageBitmap`, `AudioContext`, `<video>`, onnx runtime web). cannot call the figma plugin api directly.

all image processing in the current fontasy plugin happens in the ui iframe. the sandbox only constructs figma nodes from the vector paths the ui produces.

critical constraint — no secrets in plugin source: plugin source code (`code.ts`, `ui.html`) is stored in the figma file and readable by any file collaborator. any api key, oauth token, or signed url embedded in source is effectively public. features requiring authenticated backend calls must be routed through a companion web app or a keyless/public api endpoint.

---

## feature 1: video source

feasibility: implementable in the plugin (ui iframe), with caveats.

### what works in-browser

the ui iframe can:
- accept a video file via `<input type="file" accept="video/*">`.
- decode it using a hidden `<video>` element + `OffscreenCanvas.drawImage(video, ...)`.
- sample frames at arbitrary timestamps using `video.currentTime = t; await new Promise(...)` (with `seeked` event).
- run each sampled frame through the existing binarization and connected-component pipeline.

this is entirely feasible without any server. a 30-second 1080p video sampled every 0.5 seconds produces 60 frames × ~8 mb per frame uncompressed = ~480 mb peak memory. for typical whiteboard or lettering videos (720p, shorter clips), this is manageable in modern browsers.

### complications

- seekable video only: some video container formats (e.g. certain mp4 profiles without a proper `moov` atom at the start) may not seek correctly in a `<video>` element. most phone-recorded videos work fine.
- frame detection heuristic: deciding which frames "contain text" reliably requires either a fixed threshold on ink-pixel density (fast but fragile) or a simple ml classifier (more robust but adds a model download). the density heuristic is sufficient for mvp.
- plugin panel ux: displaying a filmstrip of 60 thumbnail frames in a 320px-wide plugin panel is cramped. a "key frames only" summary view (showing only frames the heuristic flagged) is more practical.

### verdict
✅ fully buildable as a plugin feature. no server required.

---

## feature 2: multiple image sources → merged glyph set

feasibility: fully implementable in the plugin.

### architecture

the existing pipeline already produces a `Map<char, CharData>` — one chardata per character. supporting multiple sources means extending this to `Map<char, CharData[]>` and adding a disambiguation step.

all state lives in the ui iframe's javascript memory for the session. no persistence is needed: re-processing a source image is fast (< 2 s for a typical scan at 1500×2000 px).

### ui considerations

- a source list panel with add/remove controls is straightforward to implement with vanilla js + css in `ui.html`.
- the "pick between candidates" disambiguation ui (showing thumbnails of competing glyphs side by side) requires rendering each candidate onto a small canvas — feasible, but adds some ui complexity.
- plugin panel height auto-resize (already implemented via `ResizeObserver`) handles variable source counts without layout issues.

### verdict
✅ fully buildable as a plugin feature. no server required.

---

## feature 3: in-plugin font conversion (woff / otf / ttf / woff2)

feasibility: partially feasible in the plugin; woff2 specifically requires a server or companion app.

### what can be done in-browser now

- otf: already implemented via `opentype.js`. no change needed.
- ttf: `opentype.js` does not produce ttf directly, but the binary format difference between otf cff and ttf is significant (cubic vs quadratic beziers). converting between them in pure js is non-trivial. `fontkit` (a pure js library) can read both; writing ttf from cff data requires bezier conversion. possible but adds ~150 kb of library overhead.
- woff: woff is a zip-compressed wrapper around ttf/otf binary data. a pure js implementation is ~50 lines using `pako` (zlib). fully feasible in-browser.
- woff2: woff2 uses brotli compression and a complex table transform specific to font data. no pure-js woff2 encoder exists that is both small enough to bundle in a plugin and accurate enough for production use. the reference implementation is in c++ (`woff2` by google); the best js option is a wasm port.

### wasm option for woff2

a wasm build of the `woff2` encoder can be loaded in the ui iframe:
```
fetch('woff2enc.wasm') → WebAssembly.instantiate(...) → encode(otfBytes) → woff2Bytes
```
the wasm binary is ~80–120 kb. this is feasible if the wasm file is hosted at a public, keyless url or bundled into the plugin's html as a base64 data uri (increases `ui.html` size but requires no server).

### api-based conversion (the "via api" roadmap item)

if a conversion endpoint exists (e.g. a small node.js service running `fonttools` or `woff2`):
- the plugin posts otf bytes to the endpoint with `fetch()`.
- the endpoint returns woff2 bytes.
- no api key is needed if the endpoint is public and rate-limited by ip.

the key risk: a public, keyless font conversion endpoint is a high-abuse surface (it accepts arbitrary binary input and runs a font parser). production deployment requires rate limiting, input size caps, and sandboxed execution (e.g. a cloudflare worker with a wasm woff2 encoder — this is actually the cleanest architecture).

### verdict
- otf: ✅ already done.
- woff: ✅ feasible in-plugin (pako + wrapper code).
- ttf: ⚠️ feasible with additional library, moderate effort.
- woff2: ⚠️ feasible in-plugin via wasm (~120 kb wasm + loader); or via a companion cloudflare worker with no api key needed. the worker approach is cleaner and avoids bloating the plugin.

---

## feature 4: dingbats

feasibility: fully implementable in the plugin.

dingbat mode is a ux change, not a technical one. the underlying pipeline is identical — connected-component detection, vectorization, otf export. the differences are:

- unicode assignment: map to pua `U+E000` … `U+F8FF` instead of ascii code points.
- classification ui: replace the row type buttons (caps/lower/number/symbol) with a per-glyph name/codepoint editor.
- glyph sheet layout: replace the fixed 9-column alphabetic grid with a configurable grid that renders each shape with a user-defined label below it.

none of these require server resources or capabilities beyond what the current plugin already has.

### optical sizing note

dingbats look best when all glyphs share a consistent visual weight. a normalization pass that scales each glyph to a target bounding box (with aspect ratio preserved) — already done for alphabetic glyphs in the current code — is sufficient. an optional "baseline alignment" toggle would let ornamental glyphs break the grid intentionally.

### verdict
✅ fully buildable as a plugin feature. no server required.

---

## feature 5: non-traditional lettering sources (friendship bracelets, physical objects)

feasibility: partially feasible in the plugin; background removal is the hard part.

### background removal options

option a — heuristic flood fill from corners (in-plugin, fast):
flood-fill transparent/background-colored pixels from image corners, using color similarity (rgb distance < threshold). this works well for photos taken on a uniform surface (white table, solid-color fabric). implementation is ~100 lines of js in the ui iframe. fails on busy or patterned backgrounds.

option b — onnx segmentation model (in-plugin, ml):
load a quantized u2-net or rembg model (~4–20 mb) as an onnx file via onnx runtime web in the ui iframe. run foreground segmentation inference entirely in the browser — no server. returns an alpha mask that works on arbitrary backgrounds. inference time: 200–800 ms on a modern cpu; faster with webgl backend. the main cost is download size (model weights). this is the approach used by tools like remove.bg's offline mode and browser-based background erasers.

option c — external api (companion web app or server, not in-plugin):
services like remove.bg or clipdrop offer background removal apis. these require an api key, which cannot be stored in plugin source. this path requires a companion web app where the user is authenticated separately.

### letter detection after background removal

once the background is masked (transparent alpha = 0), the existing connected-component pipeline works on the alpha channel instead of the grayscale channel. the `toGray()` function is replaced with an `alphaChannel()` extraction. the rest of the pipeline (dilate, labelComps, mergeFragments, groupRows, vectorize) is unchanged.

### manual split tool

a touch/mouse drawing tool in the ui iframe that lets the user stroke a line across a merged component is implementable with a `<canvas>` overlay using pointer events. the line is rasterized into the binary mask as a gap (0-pixels), then the component re-labeled. this is ~150–200 lines of canvas interaction code.

### verdict
- heuristic background removal: ✅ fully in-plugin, fast, works for simple backgrounds.
- ml background removal: ✅ fully in-plugin (onnx runtime web), works on complex backgrounds, adds model download.
- api-based background removal: ❌ not feasible in plugin (requires api key). must be a companion web app.
- letter detection after background removal: ✅ straightforward pipeline change.
- manual split tool: ✅ feasible in-plugin.

---

## feature 6: ai-assisted glyph completion

feasibility: partially feasible; depends on what ai surfaces figma exposes to plugins.

### generating missing glyphs

generating a plausible "missing" glyph that matches the visual style of the existing hand-lettered set is an image generation task. the inputs are:
- a target character (e.g. "q").
- style reference images (photos of the existing glyphs at sufficient resolution).

options:

option a — figma's ai generation inside the plugin:
if the plugin api exposes `figma.ai.generateImage(prompt, referenceImages)` or equivalent, the plugin can call it directly from `code.ts`. as of the current plugin api (`api: "1.0.0"`), no such surface is documented in the public typings. this may become available as figma expands plugin ai capabilities.

option b — generate via figma ai agent:
the user initiates a generation step outside the plugin (e.g. via figma ai chat), referencing the existing glyph frames as style context. the generated image is placed on the canvas, then used as a new input image in a subsequent plugin run. this is a manual workflow bridge, not an automated pipeline, but it is achievable today.

option c — external image generation api (not feasible in-plugin):
calling openai image generation, stability ai, or similar requires an api key. as noted above, this cannot be stored in plugin source. this path requires a companion web app where the user authenticates and the generation is proxied server-side.

option d — structural interpolation (no ai, fully in-plugin):
for characters with structural overlap (e.g. "p" and "b" share a vertical stroke and a bowl), a bezier interpolation step can approximate missing glyphs by blending vector paths from related characters. this is technically feasible with `opentype.js` path operations but produces noticeably artificial results — a useful fallback, not a replacement for real generation.

### verdict
- ai generation within plugin: ⚠️ not currently possible via public plugin api. may become feasible as figma expands ai apis to plugins.
- figma ai chat as a manual bridge: ✅ possible today as a described workflow.
- external api: ❌ not feasible in-plugin (api key exposure). requires companion web app.
- structural interpolation: ✅ feasible in-plugin as a lower-fidelity fallback.

---

## feature 7: colored lettering fonts — multi-color glyphs

feasibility: partially in-plugin for detection and figma output; font export with color tables requires additional library work.

### color region segmentation (in-plugin)

the ui iframe has full canvas access, which is all that's needed for k-means color clustering within each glyph bounding box:
- extract the pixels within a detected glyph's bounding box from the original (non-binarized) source image.
- run k-means clustering (k=2 to 5, user-configurable) on the rgb values. k-means is a ~60-line implementation in js and converges in < 50 ms for a typical glyph-sized pixel region (128×192 at most).
- assign each pixel to a cluster, producing k binary masks.
- trace each mask independently through the existing moore boundary + bezier smoothing pipeline, one vector path per color zone.

this is pure computation on pixel arrays already in memory. no server required, no new libraries, no model downloads.

### multi-layer glyph data model

the current pipeline produces one `vectorPath: string` per glyph. the colored version produces an array:
```
type ColorZone = { path: string; color: { r: number; g: number; b: number }; order: number }
type ColoredCharData = { label: string; zones: ColorZone[] }
```
this is a data shape change, not an infrastructure change. the glyph sheet rendering in `code.ts` already creates one vector node per glyph — it would create n nodes (one per zone) stacked back-to-front, each filled with its detected color.

### color font export (colrv1)

the hard part. opentype.js (v1.3.4, currently bundled) does not support writing colrv1 tables. options:

option a — extend opentype.js to write colr/cpal tables:
colrv1 is a relatively flat binary structure: a cpal table (palette of rgba colors) + a colr table (per-glyph layer list referencing palette indices). writing these tables by hand on top of opentype.js's `Font.download()` method is feasible — the font object exposes raw table access. estimated effort: ~300–500 lines of binary table construction code in the ui iframe. the colrv1 spec is well-documented and the table format is simpler than cff outlines.

option b — use fonttools via companion app:
`fonttools` (python) has full colrv1 authoring support. a companion web app can accept the multi-zone glyph data as json, run fonttools to produce a colrv1 otf, and return it. this is the most reliable path for production-quality color fonts but requires a server.

option c — svg-in-otf (simpler color font format):
the svg table in opentype embeds raw svg per glyph. since the plugin already produces svg path data, wrapping each multi-zone glyph in an svg document with colored `<path>` elements and embedding it in an svg table is straightforward. opentype.js doesn't write svg tables natively, but the svg table binary format is trivial (just a list of svg documents keyed by glyph id). this is the lowest-effort color font path. drawback: svg-in-otf is not supported on windows native apps (only browsers and macos).

### recolorable palette slots

colrv1 and svg-in-otf both support named palette entries. the plugin would define slots like:
- slot 0: main body
- slot 1: shadow/secondary
- slot 2: highlight/accent

each glyph's zones map to these slots by assignment (auto: largest area = body, darkest = shadow, lightest = highlight; manual: user picks in the classify ui). apps that support palette swapping (adobe apps, browsers via css `font-palette`) let end users recolor the entire font.

### figma-specific output (no font export needed)

for use within figma, the multi-zone glyph structure maps directly to components:
- each glyph cell in the figma glyph sheet becomes a frame with n child vector layers (one per zone).
- color variables can be bound to each layer's fill, making the "font" token-aware.
- this path requires zero font-format work and is fully implementable in the plugin as-is.

### verdict
- color segmentation (k-means): ✅ fully in-plugin, fast, no dependencies.
- multi-zone glyph sheet in figma: ✅ fully in-plugin, straightforward extension of current code.
- colrv1 otf export: ⚠️ feasible in-plugin with ~400 lines of custom binary table code. moderate effort.
- svg-in-otf export: ✅ feasible in-plugin, lower effort, but limited platform support.
- fonttools-based export: ❌ requires server. highest quality, widest format support.
- palette recoloring: ✅ native to both colrv1 and svg-in-otf specs. no extra work beyond correct table construction.

---

## feature 8: textured handwriting — crayon, pencil, chalk preservation

feasibility: rough outline mode is trivial; texture-filled font export is partially feasible depending on target format.

### rough outline tracing (in-plugin, trivial)

the current pipeline already has a "smoothing" slider (epsilon for douglas-peucker simplification). "rough outline mode" is literally just lowering epsilon. the contour tracing captures every pixel-level wobble of the ink edge; simplification removes it. keeping more of it is a slider change, not a new feature.

what would be new:
- a named preset in the ui ("textured" / "rough" / "clean") that sets epsilon to predefined values (e.g. 0.5 / 1.5 / 3.0) instead of requiring manual slider adjustment.
- an additional post-processing option: "jitter" — slightly perturb control points of the simplified bezier by ±0.5–1 px to add hand-drawn quality back to glyphs that were simplified. this is ~20 lines of math on the path array.

roughness in the exported font:
- a rough-outline glyph still exports as a standard otf/woff. the paths are just more complex (more control points). file size increases proportionally — a fully rough font might be 2–3× the size of a clean one. this is acceptable for display fonts (which is what handwritten fonts are).

### verdict for rough outlines
✅ fully in-plugin. essentially a ui/preset change on existing infrastructure.

### texture-filled color font (higher fidelity)

this is where it gets interesting. the goal is to embed the actual visual grain (crayon wax texture, pencil graphite scatter, chalk dust) into the font, not just preserve the outline shape.

### approach 1: sbix / cbdt bitmap font (in-plugin)

sbix (apple) and cbdt/cblc (google) are bitmap font tables that store a raster image per glyph at one or more sizes. the pipeline:
- for each detected glyph, crop the original source image to the glyph bounding box.
- apply background removal (alpha out everything outside the binary mask).
- store the resulting rgba image as a png.
- embed the pngs into an sbix or cbdt table in the otf.

opentype.js does not support sbix/cbdt, but the table format is straightforward:
- sbix: `[header][strike records (one per ppem size)][glyph data offsets][raw png bytes]`
- cbdt: slightly more complex with bitmap size tables, but well-documented.

writing these tables manually (like colrv1) is feasible in ~200–400 lines.

drawback: bitmap fonts look best at their authored size. scaling up reveals pixels; scaling down loses detail. typical approach: author at 2–3 strike sizes (e.g. 64px, 128px, 256px). the plugin would export the glyph crop at each target size.

### approach 2: svg-in-otf with embedded texture (in-plugin)

the svg table can contain arbitrary svg per glyph, including `<image>` elements with base64-encoded pngs. this means:
- trace the outline as usual (for the fallback cff layer).
- embed the cropped texture image inside the svg document for each glyph, clipped to the outline path.

result: apps that support svg fonts (browsers, macos) render the textured version; apps that don't fall back to the clean outline. best of both worlds.

the svg document per glyph would look like:
```svg
<svg><defs><clipPath id="g"><path d="..."/></clipPath></defs>
<image href="data:image/png;base64,..." clip-path="url(#g)" width="..." height="..."/></svg>
```

this is composable from data already produced by the plugin (the vector path + the source image crop). implementation is string concatenation, not complex binary.

### approach 3: vector texture simulation (in-plugin, no bitmap)

instead of embedding raster texture, simulate it with vector noise:
- analyze the grayscale distribution inside the glyph bounding box. compute a density map (how dark each pixel region is relative to max).
- convert the density map into a stipple pattern: randomly place small circles or short strokes within the outline, with density proportional to the original darkness. darker regions get more dots; lighter regions (where the crayon barely touched) get fewer.
- the result is a vector-only glyph that approximates the texture through pure geometry.

this produces large path data (hundreds of tiny shapes per glyph) but stays entirely within standard otf cff/colr and works everywhere. file size: potentially large (1–5 mb for a full charset), but acceptable for a specialty display font.

### crayon-specific: opacity mapping

crayon leaves uneven wax opacity. the pipeline can detect this by reading the grayscale values inside the glyph mask before binarizing:
- pixels near 0 (full ink) map to opacity 1.0.
- pixels at intermediate gray (light wax) map to proportional opacity (e.g. 0.3–0.7).
- in colrv1, each zone can have its own opacity. in svg-in-otf, the svg can use `opacity` or `fill-opacity` per sub-path.
- this preserves the "heavy in the middle, light at the edges" quality of crayon strokes.

implementation: segment the glyph into 3–4 opacity bands (k-means on grayscale values within the mask), trace each band as a separate zone, assign descending opacity. this reuses the same color-zone segmentation from feature 7 but on grayscale instead of rgb.

### pencil: feathered edges

pencil marks have soft, feathered borders rather than hard outlines. options:
- gaussian blur the binary mask edges before tracing — produces a smoother outline that mimics the falloff. this is a one-line filter addition before the existing trace step.
- trace at multiple thresholds (e.g. 40%, 60%, 80% of max darkness) and stack the resulting paths at descending opacity. the outermost (lightest threshold) path is the full pencil field; inner paths are the darker core. in colrv1 or svg, this stacking with transparency recreates the feathered look.

### chalk: scatter and grain

chalk on a dark surface leaves gaps between particles of chalk dust. the current pipeline's dilate step fills those gaps. for chalk mode:
- skip or reduce dilate, preserving the natural scatter.
- trace the scattered binary directly. the resulting path has many small disconnected islands and internal holes, which is exactly the point.
- in the vector output, these gaps are genuine holes in the glyph shape (evenodd rule), not a rendering artifact.
- the font renders with visible grain, matching how chalk actually looks on a board.

### figma-specific texture output (no font export needed)

for use within figma without exporting a font:
- the glyph vector node is placed as usual.
- a noise or texture effect (figma's built-in grain effect) is applied on top, with parameters matched to the source medium's characteristics:
  - crayon: low-frequency noise, moderate intensity, no blur.
  - pencil: high-frequency noise, low intensity, slight gaussian blur.
  - chalk: high-frequency noise, high intensity, inverted (white grains on transparent).
- the grain parameters can be derived automatically from frequency analysis of the source pixels within the glyph bounding box (fft or simple variance measurement).

this is implementable in the sandbox (`code.ts`) since it only requires setting figma effect properties on the vector node.

### verdict
- rough outline mode: ✅ trivial. already exists as a slider; just needs presets.
- sbix/cbdt bitmap font: ⚠️ feasible in-plugin with custom table writing (~300 lines). moderate effort.
- svg-in-otf with texture image: ✅ feasible in-plugin, moderate effort, string-based svg assembly.
- vector stipple simulation: ✅ feasible in-plugin, produces large files but universal compatibility.
- opacity mapping (crayon): ✅ feasible in-plugin, reuses color-zone segmentation logic.
- feathered edges (pencil): ✅ feasible in-plugin, multi-threshold tracing.
- scatter preservation (chalk): ✅ feasible in-plugin, skip dilate + trace directly.
- figma texture effects: ✅ fully in-plugin, uses built-in figma effect apis.

---

## updated summary table

| feature | in-plugin? | server / companion app? | notes |
|---|---|---|---|
| video source | ✅ yes | ❌ not needed | browser `<video>` + offscreencanvas |
| multi-source merge | ✅ yes | ❌ not needed | in-memory state management |
| woff export | ✅ yes | ❌ not needed | pako + wrapper |
| woff2 export | ⚠️ via wasm | ✅ cleaner as worker | wasm adds ~120 kb |
| ttf export | ⚠️ with library | ❌ not needed | bezier conversion required |
| dingbats | ✅ yes | ❌ not needed | ux change, same pipeline |
| bg removal (heuristic) | ✅ yes | ❌ not needed | works for simple backgrounds |
| bg removal (ml) | ✅ yes | ❌ not needed | onnx runtime web, ~4–20 mb model |
| bg removal (api) | ❌ no | ✅ required | api key cannot go in plugin |
| manual glyph split | ✅ yes | ❌ not needed | canvas pointer events |
| ai glyph completion | ❌ not yet | ✅ required today | needs plugin api ai surface or server |
| structural interpolation | ✅ yes | ❌ not needed | lower fidelity fallback |
| color segmentation | ✅ yes | ❌ not needed | k-means on pixel arrays, fast |
| multi-zone glyph sheet | ✅ yes | ❌ not needed | n vector nodes per cell |
| colrv1 color font | ⚠️ custom tables | ❌ not needed | ~400 lines binary table code |
| svg-in-otf color font | ✅ yes | ❌ not needed | string assembly, limited platform |
| fonttools color font | ❌ no | ✅ required | highest quality, widest support |
| rough outline mode | ✅ yes | ❌ not needed | epsilon preset, trivial |
| bitmap texture font | ⚠️ custom tables | ❌ not needed | sbix/cbdt, ~300 lines |
| svg texture font | ✅ yes | ❌ not needed | embedded base64 image in svg |
| vector stipple texture | ✅ yes | ❌ not needed | large files, universal compat |
| crayon opacity map | ✅ yes | ❌ not needed | reuses zone segmentation |
| pencil feathered edge | ✅ yes | ❌ not needed | multi-threshold tracing |
| chalk scatter | ✅ yes | ❌ not needed | skip dilate, trace directly |
| figma texture effects | ✅ yes | ❌ not needed | built-in effect apis |

---

## companion web app — when to build one

a companion web app (e.g. `fontasy.app`) makes sense when:
1. the user needs authenticated api calls (background removal, ai generation, font format conversion through a signed service).
2. the workflow involves large file transfers (multi-minute video processing, batch glyph generation) that would block the figma plugin panel.
3. the user wants to save and revisit projects across sessions — the plugin has no durable persistence beyond figma file `pluginData`.
4. production-quality color font export (colrv1 with proper hinting, variable font axes for texture intensity) is needed — fonttools on a server produces better output than manual binary table writing.

a minimal companion app would be a next.js or sveltekit site that:
- accepts font project exports from the plugin (as json + svg path data + cropped texture images).
- offers woff2 compilation, colrv1 authoring via fonttools, background removal, and ai glyph generation in a signed, authenticated context.
- returns downloadable font packages (otf, ttf, woff, woff2, css snippet, specimen page) and optionally a figma import link.

the plugin and the web app share the same vectorization and font metric logic — these can be extracted into a shared `fontasy-core` npm package usable in both environments.
