# fontasy — extended roadmap

fontasy currently detects handwritten characters from a practice sheet image and extracts each glyph as a clean, vectorized figma frame. the following features describe a meaningful expansion of that core capability.

---

## 1. video source — detect text frames and isolate glyphs

what it is: accept a video file as input. the plugin scrubs through frames, identifies frames that contain handwritten or hand-lettered text (e.g. someone writing on a whiteboard, brush lettering on paper), and extracts glyphs from those frames.

how it would work:
- user uploads a video (mp4, mov, webm).
- the ui iframe decodes the video using the browser's `<video>` element and `OffscreenCanvas`, sampling frames at a configurable interval (e.g. every 0.5 s).
- each sampled frame is run through the existing binarization + connected-component pipeline.
- frames with a meaningful ink-pixel density and enough distinct connected components are flagged as "text frames."
- the user reviews auto-detected text frames in a filmstrip ui, confirming or rejecting each.
- confirmed frames are merged into a single pooled glyph set using the multi-source merge logic (see feature 2).

key ux consideration: video frames often contain motion blur and variable lighting. an extra preprocessing step — adaptive local thresholding (e.g. sauvola) instead of global otsu — would handle uneven illumination better than the current approach.

---

## 2. multiple images contributing to a single glyph set

what it is: let the user upload multiple separate images (different pages, different sessions, different paper/ink) and treat all of them as contributing to one unified character set. if a glyph for "a" exists in image 1 and image 3, the user chooses which version to use (or the plugin picks the highest-confidence detection).

how it would work:
- a source list panel replaces the single source zone. users add images one at a time.
- each image is processed independently through the detection pipeline, producing its own set of detected rows and classified glyphs.
- after all sources are processed, glyphs are merged into a unified `Map<char, GlyphCandidate[]>`. when multiple images provide the same character, the candidates are displayed side by side and the user picks the preferred one (or accepts the default: highest contour area, indicating most complete rendering).
- the final glyph sheet and font export pull from the merged selection.

storage: per-source detection results are cached in memory (javascript objects in the ui iframe) for the session. no plugin data persistence is required since re-detection from the same image is fast enough.

---

## 3. in-plugin glyph set → woff / otf / ttf conversion via api

what it is: instead of downloading an otf and leaving the user to convert it themselves, the plugin calls a font-compilation api to produce woff, woff2, otf, and ttf variants in one step.

current state: the plugin already generates otf using opentype.js on the client. the gap is woff/woff2 output — opentype.js does not produce woff2.

how it would work:
- a lightweight server endpoint (node.js + `ttf2woff2` or `fonttools`) accepts raw otf bytes via a post request and returns woff2 bytes.
- the plugin posts the opentype.js-generated otf buffer to this endpoint and receives back all format variants.
- the user selects which formats to download (otf / ttf / woff / woff2) from a format picker in the ui.

constraint: a figma plugin's source is stored in the file and is readable by anyone who opens the file. an api key baked into `ui.html` or `code.ts` would be exposed. the endpoint must either be public/keyless, use a token generated at request time (short-lived, low-value), or the conversion must be offered as a companion web app rather than inside the plugin itself (see `technical.md` for a full analysis).

recommended architecture for the plugin itself: keep woff/woff2 conversion out of the plugin and instead add a "copy otf → clipboard" or "download and convert online" link that opens the companion webapp.

---

## 4. dingbats and symbol fonts

what it is: treat arbitrary drawn shapes — stars, arrows, ornamental borders, icons, bullet patterns — as a named symbol font rather than an alphabetic one. each shape is assigned to a unicode dingbat / pua (private use area) code point and exported as a usable icon font.

how it would work:
- a new "dingbat mode" is added alongside the existing caps/lower/number/symbol classification system.
- in dingbat mode, the row classifier is replaced with a free-form grid: each detected component is shown as a thumbnail, and the user either:
  - assigns it to a specific unicode pua slot (`U+E000` … `U+F8FF`) manually, or
  - lets the plugin auto-assign sequentially starting from `U+E000`.
- the glyph sheet layout switches from the alphabetic calligraphr-style grid to a free-form symbol board with custom labels.
- the otf export assigns each shape to its pua code point with a descriptive glyph name (e.g. `uniE001`, `heart`, `star-four-point`).

design consideration: dingbat fonts benefit from consistent optical sizing. a normalization step that scales all glyphs to a common cap-height (already done for alphabetic glyphs) is important here too, but with an opt-out for glyphs that intentionally break the baseline (e.g. descenders, ornamental swashes).

---

## 5. non-traditional lettering sources — friendship bracelets, physical arrangements, etc.

what it is: support image sources where letters are spelled out by physical objects rather than handwriting — friendship bracelet beads, stencil cutouts, letter tiles, typeset stamps, or any arrangement where the letter shape is preserved but the medium is non-ink.

the challenge: the current pipeline assumes ink-on-paper: a dark foreground on a light background, with coherent connected components per glyph. physical objects introduce:
- uneven backgrounds (wood, fabric, carpet, concrete).
- multiple colors per object that don't threshold cleanly.
- shadows and perspective distortion.
- complex internal structure (the bead hole, the thread between beads, the tile grout).

how it would work:

background removal step (new):
- before the existing binarization pipeline, run an automatic background removal pass. in-browser options:
  - webgl-accelerated grabcut (feasible but complex to implement from scratch).
  - load a lightweight onnx segmentation model (e.g. u2-net small at ~4 mb) via onnx runtime web and run inference in the ui iframe.
  - as a simpler fallback: magic-wand flood fill from image corners to isolate the background, then invert.
- the result is an rgba image with transparent background and preserved foreground colors.

letter detection step:
- after background removal, run connected-component detection on the alpha channel (non-transparent pixels) rather than on grayscale ink density.
- each component retains its original color information — the bead's color, the tile texture — so the extracted glyph vector can be colorized with the dominant color of the source region.

design structure preservation:
- the extracted vector outline captures the silhouette of the object (bead, tile).
- an optional "preserve fill color" toggle replaces the flat ink fill in the glyph sheet with a sampled color taken from the bead's dominant hue.
- for objects with internal holes (letter o bead, bracelet thread gaps), the existing evenodd hole-finding logic handles cutouts correctly once the alpha channel is used as the binary mask.

manual split tool (for tightly-packed arrangements):
- when beads or tiles touch, the connected-component algorithm merges them. a manual split tool lets the user draw a dividing line on a detected component to break it into two glyphs, similar to how some ocr tools handle touching characters.

---

## 6. ai-assisted glyph completion from a partial character set

what it is: the user provides only a subset of the alphabet (e.g. they hand-lettered only a–m, or only uppercase, or only the letters in a specific phrase). the plugin uses figma's ai capabilities and the existing glyph set as style reference to generate plausible completions for the missing characters.

how it would work (within figma plugin context):
- after the user's detected glyphs are placed in the glyph sheet, empty cells are identified.
- for each missing glyph, the plugin calls `figma.ai.generate(...)` (or the equivalent generation surface available to plugins) with a prompt that includes:
  - a reference image of 4–6 existing glyphs from the same font (showing the style, stroke weight, and quirks of the handwriting).
  - the target character as text.
  - a style description derived from the detected glyphs (e.g. "slightly right-leaning, thick downstrokes, open counters").
- the generated image is run through the same binarization + vectorization pipeline as a real photo.
- generated glyphs are placed in the glyph sheet with a visual indicator (e.g. a small sparkle icon or different background tint) to distinguish them from photographed originals.
- the user can regenerate any individual cell, replace it with a real photo, or delete it.

alternate path (not requiring ai generation):
- interpolation from similar characters: given "p" and "r", approximate "b" by combining features. this is a structural font interpolation problem — technically tractable with cubic bezier operations but producing lower-fidelity results than ai generation.
- a figma-native approach: create placeholder empty frames for missing glyphs and use the existing design agent to suggest completions as an explicit user-initiated step, outside the plugin itself.

---

## 7. colored lettering fonts — multi-color glyphs and recolorable typesets

what it is: a lot of people make incredibly expressive colored lettering — rainbow brush strokes, two-tone drop shadows baked into the letterform, watercolor washes that bleed differently across each stroke, gradient fills that shift mid-glyph — and never once think of it as a font. it just lives as a one-off illustration or a jpeg. this feature treats that kind of lettering as exactly what it could be: a typeface where color is a first-class part of the design, not an afterthought applied on top.

the core idea: each glyph is allowed to carry two or more distinct color regions by default. the letter "a" isn't just a shape with a fill — it might have a warm peach body, a deep coral shadow built into the stroke, and a pale highlight slice across the top. that color structure is preserved as separate named layers within the glyph, so the font behaves like a color font (otf with colrv1 or svg-in-otf table) and each color slot is independently recolorable when used.

how detection would work:
- after the standard background removal and connected-component pass, instead of immediately binarizing to a single ink color, the pipeline applies color region segmentation within each detected glyph bounding box. k-means clustering (k=2 to 5, user-configurable) groups pixels into dominant color zones.
- each color zone is traced independently using the existing moore boundary + bezier smoothing pipeline, producing one vector path per zone.
- the zones are stacked in paint order (back to front) and stored as a multi-layer glyph record rather than a single path.

how the font export would work:
- in the otf/woff2 export flow, the colrv1 table (opentype color table version 1) is constructed from the per-zone vector layers. colrv1 supports gradients, compositing, and palette swapping natively.
- a color palette is defined per font: each zone across all glyphs is mapped to a named palette slot. slot 0 might be "main body", slot 1 "shadow", slot 2 "highlight." when the font is installed and used in any colrv1-aware app, the user can swap the entire palette.
- the figma glyph sheet gets an updated layout: each cell renders the glyph in its original detected colors, with a small color swatch strip along the bottom edge showing the palette slots assigned to that character.

the whimsical typeset angle: the typefaces people rarely think to make into fonts are exactly the ones that feel most alive — the hand-painted bakery sign, the birthday card lettering, the bubble letters that a kid fills in with three different markers. those aren't just shapes; the color decision is structural. this feature is specifically for those. rainbow lettering, hand-highlighted drop caps, two-color brush scripts, chalk-on-dark-board color schemes — all of them become repeatable, installable, shareable fonts instead of one-time drawings.

recolorability in figma specifically: for use inside figma without installing a system font, the multi-zone glyph structure maps cleanly onto a component with swappable color variables. each zone is a separate vector layer inside the glyph component. color variables from the user's design system can be bound to each zone, making the "font" fully token-aware within a figma file even before it is exported as a real otf.

---

## 8. textured handwriting — preserving crayon, pencil, and chalk character

what it is: clean vector outlines are not always what handwritten lettering should look like. a lot of what makes handwriting feel warm, personal, or interesting is exactly the stuff the current pipeline removes: the scraggly pencil edge that wavers slightly at each stroke, the crayon fill that is heavier in the middle and fades at the tip, the chalk stroke that leaves a soft dusty border instead of a hard edge, the pressed-hard-then-lifted quality of a marker that leaves a tapered gradient across the letterform. this feature lets the user keep that character rather than stripping it out in pursuit of a clean bezier.

two modes of texture preservation:

choice 1 — rough outline tracing:
- the existing pipeline already simplifies contours using the douglas-peucker algorithm (controlled by the epsilon slider). rough outline mode disables most of that simplification, keeping the micro-variations in the boundary exactly as traced. the result is a vector path that still wobbles, still has the hand's slight irregularity built into the shape itself — not artificially added noise, but the actual captured edge.
- this is the lightest-weight option: no new data format, works in standard otf, produces small file sizes. it just looks alive instead of drafted.
- a "roughness" slider in the ui maps directly to the epsilon value: all the way left keeps every traced point, all the way right produces the current clean output. the user finds their own middle ground.

choice 2 — texture-filled color font (higher fidelity):
- instead of tracing only the outline, the pipeline also samples the pixel texture from inside the glyph bounding box — the actual crayon grain, pencil graphite scatter, chalk dust — and embeds it as a pattern fill or image fill within an svg-in-otf or sbix (standard bitmap graphics) font table.
- for vector-host apps that support color fonts, the glyph renders with its real texture visible. for apps that don't, the outline-only fallback layer (always present as the base colr or cff table) displays instead.
- texture fill extraction works on the binary pixel data already produced during detection: the ink-region pixels are sampled at their original grayscale values, normalized, and composited as a soft overlay onto the clean vector shape. this is effectively a mask+texture composite that rides inside the glyph data.

crayon-specific behavior:
- crayon strokes have characteristically uneven opacity: heavy wax buildup in slow, deliberate areas, lighter coverage where the stroke moves fast. the pipeline detects this by reading the grayscale gradient inside the component bounds before binarizing and storing it as a fill opacity map. when exported as a color font, the lighter waxy regions become partially transparent, giving the same visual effect as the original.

pencil and graphite:
- pencil marks have soft, feathered edges rather than hard contours. rough outline mode captures the fraying of the edge well, but texture mode goes further: a thin border feather is synthesized by blending the outer 3–5 pixels of the component into a gradient from ink-color to transparent, replicating the look of graphite that's been barely pressed.

chalk:
- chalk on a dark surface is naturally the inverted use case (light on dark). the existing invert toggle already handles this for detection. for texture, chalk has a characteristic "scatter" — pixels that belong to the stroke but have gaps between them. rather than connecting those gaps with dilate and losing the scatter, a "chalk mode" keeps the gaps and treats them as part of the glyph's fill texture. the resulting vector has holes punched through it in the natural pattern of the chalk grain.

how this appears in the figma glyph sheet:
- a texture mode toggle in the output section switches between clean vector rendering and texture-preserved rendering for the glyph sheet preview.
- in texture mode, each glyph cell shows the detected vector at low epsilon plus a noise/grain effect layer on top, giving the user a preview of how the textured font will look before committing to export.
- the texture layer is implemented as a figma noise or texture effect on the vector node, using the fill analysis of the original image pixels to match grain density and direction to the source medium.
