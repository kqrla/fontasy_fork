# Fontasy — Technical Implementation Notes

This document evaluates the feasibility of each roadmap feature, distinguishing what can be built inside the Figma plugin environment from what requires a companion web app or server.

---

## Architecture constraints of the current plugin

The plugin runs in two isolated environments:

1. **The sandbox** (`code.ts` / `code.js`) — a restricted JS runtime with access to the Figma Plugin API. No DOM, no `fetch`, no `canvas`, no `AudioContext`. Communicates with the UI iframe via `postMessage`.
2. **The UI iframe** (`ui.html`) — a standard browser iframe running inside Figma's plugin panel. Has full browser APIs (`canvas`, `fetch`, `OffscreenCanvas`, `createImageBitmap`, `AudioContext`, `<video>`, ONNX Runtime Web). **Cannot** call the Figma Plugin API directly.

All image processing in the current Fontasy plugin happens in the UI iframe. The sandbox only constructs Figma nodes from the vector paths the UI produces.

**Critical constraint — no secrets in plugin source:** Plugin source code (`code.ts`, `ui.html`) is stored in the Figma file and readable by any file collaborator. Any API key, OAuth token, or signed URL embedded in source is effectively public. Features requiring authenticated backend calls must be routed through a companion web app or a keyless/public API endpoint.

---

## Feature 1: Video source

**Feasibility: Implementable in the plugin (UI iframe), with caveats.**

### What works in-browser

The UI iframe can:
- Accept a video file via `<input type="file" accept="video/*">`.
- Decode it using a hidden `<video>` element + `OffscreenCanvas.drawImage(video, ...)`.
- Sample frames at arbitrary timestamps using `video.currentTime = t; await new Promise(...)` (with `seeked` event).
- Run each sampled frame through the existing binarization and connected-component pipeline.

This is entirely feasible without any server. A 30-second 1080p video sampled every 0.5 seconds produces 60 frames × ~8 MB per frame uncompressed = ~480 MB peak memory. For typical whiteboard or lettering videos (720p, shorter clips), this is manageable in modern browsers.

### Complications

- **Seekable video only:** Some video container formats (e.g. certain MP4 profiles without a proper `moov` atom at the start) may not seek correctly in a `<video>` element. Most phone-recorded videos work fine.
- **Frame detection heuristic:** Deciding which frames "contain text" reliably requires either a fixed threshold on ink-pixel density (fast but fragile) or a simple ML classifier (more robust but adds a model download). The density heuristic is sufficient for MVP.
- **Plugin panel UX:** Displaying a filmstrip of 60 thumbnail frames in a 320px-wide plugin panel is cramped. A "key frames only" summary view (showing only frames the heuristic flagged) is more practical.

### Verdict
✅ Fully buildable as a plugin feature. No server required.

---

## Feature 2: Multiple image sources → merged glyph set

**Feasibility: Fully implementable in the plugin.**

### Architecture

The existing pipeline already produces a `Map<char, CharData>` — one CharData per character. Supporting multiple sources means extending this to `Map<char, CharData[]>` and adding a disambiguation step.

All state lives in the UI iframe's JavaScript memory for the session. No persistence is needed: re-processing a source image is fast (< 2 s for a typical scan at 1500×2000 px).

### UI considerations

- A source list panel with add/remove controls is straightforward to implement with vanilla JS + CSS in `ui.html`.
- The "pick between candidates" disambiguation UI (showing thumbnails of competing glyphs side by side) requires rendering each candidate onto a small canvas — feasible, but adds some UI complexity.
- Plugin panel height auto-resize (already implemented via `ResizeObserver`) handles variable source counts without layout issues.

### Verdict
✅ Fully buildable as a plugin feature. No server required.

---

## Feature 3: In-plugin font conversion (WOFF / OTF / TTF / WOFF2)

**Feasibility: Partially feasible in the plugin; WOFF2 specifically requires a server or companion app.**

### What can be done in-browser now

- **OTF:** Already implemented via `opentype.js`. No change needed.
- **TTF:** `opentype.js` does not produce TTF directly, but the binary format difference between OTF CFF and TTF is significant (cubic vs quadratic beziers). Converting between them in pure JS is non-trivial. `fontkit` (a pure JS library) can read both; writing TTF from CFF data requires bezier conversion. Possible but adds ~150 KB of library overhead.
- **WOFF:** WOFF is a ZIP-compressed wrapper around TTF/OTF binary data. A pure JS implementation is ~50 lines using `pako` (zlib). **Fully feasible in-browser.**
- **WOFF2:** WOFF2 uses Brotli compression and a complex table transform specific to font data. No pure-JS WOFF2 encoder exists that is both small enough to bundle in a plugin and accurate enough for production use. The reference implementation is in C++ (`woff2` by Google); the best JS option is a WASM port.

### WASM option for WOFF2

A WASM build of the `woff2` encoder can be loaded in the UI iframe:
```
fetch('woff2enc.wasm') → WebAssembly.instantiate(...) → encode(otfBytes) → woff2Bytes
```
The WASM binary is ~80–120 KB. This is feasible if the WASM file is hosted at a public, keyless URL or bundled into the plugin's HTML as a base64 data URI (increases `ui.html` size but requires no server).

### API-based conversion (the "via API" roadmap item)

If a conversion endpoint exists (e.g. a small Node.js service running `fonttools` or `woff2`):
- The plugin POSTs OTF bytes to the endpoint with `fetch()`.
- The endpoint returns WOFF2 bytes.
- No API key is needed if the endpoint is public and rate-limited by IP.

**The key risk:** A public, keyless font conversion endpoint is a high-abuse surface (it accepts arbitrary binary input and runs a font parser). Production deployment requires rate limiting, input size caps, and sandboxed execution (e.g. a Cloudflare Worker with a WASM WOFF2 encoder — this is actually the cleanest architecture).

### Verdict
- OTF: ✅ Already done.
- WOFF: ✅ Feasible in-plugin (pako + wrapper code).
- TTF: ⚠️ Feasible with additional library, moderate effort.
- WOFF2: ⚠️ Feasible in-plugin via WASM (~120 KB WASM + loader); OR via a companion Cloudflare Worker with no API key needed. The Worker approach is cleaner and avoids bloating the plugin.

---

## Feature 4: Dingbats

**Feasibility: Fully implementable in the plugin.**

Dingbat mode is a UX change, not a technical one. The underlying pipeline is identical — connected-component detection, vectorization, OTF export. The differences are:

- Unicode assignment: map to PUA `U+E000` … `U+F8FF` instead of ASCII code points.
- Classification UI: replace the row type buttons (caps/lower/number/symbol) with a per-glyph name/codepoint editor.
- Glyph sheet layout: replace the fixed 9-column alphabetic grid with a configurable grid that renders each shape with a user-defined label below it.

None of these require server resources or capabilities beyond what the current plugin already has.

### Optical sizing note

Dingbats look best when all glyphs share a consistent visual weight. A normalization pass that scales each glyph to a target bounding box (with aspect ratio preserved) — already done for alphabetic glyphs in the current code — is sufficient. An optional "baseline alignment" toggle would let ornamental glyphs break the grid intentionally.

### Verdict
✅ Fully buildable as a plugin feature. No server required.

---

## Feature 5: Non-traditional lettering sources (friendship bracelets, physical objects)

**Feasibility: Partially feasible in the plugin; background removal is the hard part.**

### Background removal options

**Option A — Heuristic flood fill from corners (in-plugin, fast):**
Flood-fill transparent/background-colored pixels from image corners, using color similarity (RGB distance < threshold). This works well for photos taken on a uniform surface (white table, solid-color fabric). Implementation is ~100 lines of JS in the UI iframe. Fails on busy or patterned backgrounds.

**Option B — ONNX segmentation model (in-plugin, ML):**
Load a quantized U2-Net or REMBG model (~4–20 MB) as an ONNX file via ONNX Runtime Web in the UI iframe. Run foreground segmentation inference entirely in the browser — no server. Returns an alpha mask that works on arbitrary backgrounds. Inference time: 200–800 ms on a modern CPU; faster with WebGL backend. The main cost is download size (model weights). This is the approach used by tools like Remove.bg's offline mode and browser-based background erasers.

**Option C — External API (companion web app or server, not in-plugin):**
Services like Remove.bg or Clipdrop offer background removal APIs. These require an API key, which **cannot be stored in plugin source**. This path requires a companion web app where the user is authenticated separately.

### Letter detection after background removal

Once the background is masked (transparent alpha = 0), the existing connected-component pipeline works on the alpha channel instead of the grayscale channel. The `toGray()` function is replaced with an `alphaChannel()` extraction. The rest of the pipeline (dilate, labelComps, mergeFragments, groupRows, vectorize) is unchanged.

### Manual split tool

A touch/mouse drawing tool in the UI iframe that lets the user stroke a line across a merged component is implementable with a `<canvas>` overlay using pointer events. The line is rasterized into the binary mask as a gap (0-pixels), then the component re-labeled. This is ~150–200 lines of canvas interaction code.

### Verdict
- Heuristic background removal: ✅ Fully in-plugin, fast, works for simple backgrounds.
- ML background removal: ✅ Fully in-plugin (ONNX Runtime Web), works on complex backgrounds, adds model download.
- API-based background removal: ❌ Not feasible in plugin (requires API key). Must be a companion web app.
- Letter detection after background removal: ✅ Straightforward pipeline change.
- Manual split tool: ✅ Feasible in-plugin.

---

## Feature 6: AI-assisted glyph completion

**Feasibility: Partially feasible; depends on what AI surfaces Figma exposes to plugins.**

### Generating missing glyphs

Generating a plausible "missing" glyph that matches the visual style of the existing hand-lettered set is an image generation task. The inputs are:
- A target character (e.g. "Q").
- Style reference images (photos of the existing glyphs at sufficient resolution).

Options:

**Option A — Figma's AI generation inside the plugin:**
If the Plugin API exposes `figma.ai.generateImage(prompt, referenceImages)` or equivalent, the plugin can call it directly from `code.ts`. As of the current plugin API (`api: "1.0.0"`), no such surface is documented in the public typings. This may become available as Figma expands plugin AI capabilities.

**Option B — Generate via edit_slide_design / external Figma agent:**
The user initiates a generation step outside the plugin (e.g. via Figma AI chat), referencing the existing glyph frames as style context. The generated image is placed on the canvas, then used as a new input image in a subsequent plugin run. This is a manual workflow bridge, not an automated pipeline, but it is achievable today.

**Option C — External image generation API (not feasible in-plugin):**
Calling OpenAI Image Generation, Stability AI, or similar requires an API key. As noted above, this **cannot** be stored in plugin source. This path requires a companion web app where the user authenticates and the generation is proxied server-side.

**Option D — Structural interpolation (no AI, fully in-plugin):**
For characters with structural overlap (e.g. "P" and "B" share a vertical stroke and a bowl), a bezier interpolation step can approximate missing glyphs by blending vector paths from related characters. This is technically feasible with `opentype.js` path operations but produces noticeably artificial results — a useful fallback, not a replacement for real generation.

### Verdict
- AI generation within plugin: ⚠️ Not currently possible via public Plugin API. May become feasible as Figma expands AI APIs to plugins.
- Figma AI chat as a manual bridge: ✅ Possible today as a described workflow.
- External API: ❌ Not feasible in-plugin (API key exposure). Requires companion web app.
- Structural interpolation: ✅ Feasible in-plugin as a lower-fidelity fallback.

---

## Summary table

| Feature | In-plugin? | Server / companion app? | Notes |
|---|---|---|---|
| Video source | ✅ Yes | ❌ Not needed | Browser `<video>` + OffscreenCanvas |
| Multi-source merge | ✅ Yes | ❌ Not needed | In-memory state management |
| WOFF export | ✅ Yes | ❌ Not needed | pako + wrapper |
| WOFF2 export | ⚠️ Via WASM | ✅ Cleaner as Worker | WASM adds ~120 KB |
| TTF export | ⚠️ With library | ❌ Not needed | Bezier conversion required |
| Dingbats | ✅ Yes | ❌ Not needed | UX change, same pipeline |
| BG removal (heuristic) | ✅ Yes | ❌ Not needed | Works for simple backgrounds |
| BG removal (ML) | ✅ Yes | ❌ Not needed | ONNX Runtime Web, ~4–20 MB model |
| BG removal (API) | ❌ No | ✅ Required | API key cannot go in plugin |
| Manual glyph split | ✅ Yes | ❌ Not needed | Canvas pointer events |
| AI glyph completion | ❌ Not yet | ✅ Required today | Needs Plugin API AI surface or server |
| Structural interpolation | ✅ Yes | ❌ Not needed | Lower fidelity fallback |

---

## Companion web app — when to build one

A companion web app (e.g. `fontasy.app`) makes sense when:
1. The user needs authenticated API calls (background removal, AI generation, font format conversion through a signed service).
2. The workflow involves large file transfers (multi-minute video processing, batch glyph generation) that would block the Figma plugin panel.
3. The user wants to save and revisit projects across sessions — the plugin has no durable persistence beyond Figma file `pluginData`.

A minimal companion app would be a Next.js or SvelteKit site that:
- Accepts font project exports from the plugin (as JSON + SVG path data).
- Offers WOFF2 compilation, background removal, and AI glyph generation in a signed, authenticated context.
- Returns downloadable font packages (OTF, TTF, WOFF, WOFF2, CSS snippet) and optionally a Figma import link.

The plugin and the web app share the same vectorization and font metric logic — these can be extracted into a shared `fontasy-core` npm package usable in both environments.
