# Fontasy — Extended Roadmap

Fontasy currently detects handwritten characters from a practice sheet image and extracts each glyph as a clean, vectorized Figma frame. The following features describe a meaningful expansion of that core capability.

---

## 1. Video source — detect text frames and isolate glyphs

**What it is:** Accept a video file as input. The plugin scrubs through frames, identifies frames that contain handwritten or hand-lettered text (e.g. someone writing on a whiteboard, brush lettering on paper), and extracts glyphs from those frames.

**How it would work:**
- User uploads a video (MP4, MOV, WebM).
- The UI iframe decodes the video using the browser's `<video>` element and `OffscreenCanvas`, sampling frames at a configurable interval (e.g. every 0.5 s).
- Each sampled frame is run through the existing binarization + connected-component pipeline.
- Frames with a meaningful ink-pixel density and enough distinct connected components are flagged as "text frames."
- The user reviews auto-detected text frames in a filmstrip UI, confirming or rejecting each.
- Confirmed frames are merged into a single pooled glyph set using the multi-source merge logic (see Feature 2).

**Key UX consideration:** Video frames often contain motion blur and variable lighting. An extra preprocessing step — adaptive local thresholding (e.g. Sauvola) instead of global Otsu — would handle uneven illumination better than the current approach.

---

## 2. Multiple images contributing to a single glyph set

**What it is:** Let the user upload multiple separate images (different pages, different sessions, different paper/ink) and treat all of them as contributing to one unified character set. If a glyph for "A" exists in image 1 and image 3, the user chooses which version to use (or the plugin picks the highest-confidence detection).

**How it would work:**
- A source list panel replaces the single source zone. Users add images one at a time.
- Each image is processed independently through the detection pipeline, producing its own set of detected rows and classified glyphs.
- After all sources are processed, glyphs are merged into a unified `Map<char, GlyphCandidate[]>`. When multiple images provide the same character, the candidates are displayed side by side and the user picks the preferred one (or accepts the default: highest contour area, indicating most complete rendering).
- The final glyph sheet and font export pull from the merged selection.

**Storage:** Per-source detection results are cached in memory (JavaScript objects in the UI iframe) for the session. No plugin data persistence is required since re-detection from the same image is fast enough.

---

## 3. In-plugin glyph set → WOFF / OTF / TTF conversion via API

**What it is:** Instead of downloading an OTF and leaving the user to convert it themselves, the plugin calls a font-compilation API to produce WOFF, WOFF2, OTF, and TTF variants in one step.

**Current state:** The plugin already generates OTF using opentype.js on the client. The gap is WOFF/WOFF2 output — opentype.js does not produce WOFF2.

**How it would work:**
- A lightweight server endpoint (Node.js + `ttf2woff2` or `fonttools`) accepts raw OTF bytes via a POST request and returns WOFF2 bytes.
- The plugin POSTs the opentype.js-generated OTF buffer to this endpoint and receives back all format variants.
- The user selects which formats to download (OTF / TTF / WOFF / WOFF2) from a format picker in the UI.

**Constraint:** A Figma plugin's source is stored in the file and is readable by anyone who opens the file. An API key baked into `ui.html` or `code.ts` would be exposed. The endpoint must either be public/keyless, use a token generated at request time (short-lived, low-value), or the conversion must be offered as a companion web app rather than inside the plugin itself (see `technical.md` for a full analysis).

**Recommended architecture for the plugin itself:** Keep WOFF/WOFF2 conversion out of the plugin and instead add a "copy OTF → clipboard" or "download and convert online" link that opens the companion webapp.

---

## 4. Dingbats and symbol fonts

**What it is:** Treat arbitrary drawn shapes — stars, arrows, ornamental borders, icons, bullet patterns — as a named symbol font rather than an alphabetic one. Each shape is assigned to a Unicode dingbat / PUA (Private Use Area) code point and exported as a usable icon font.

**How it would work:**
- A new "dingbat mode" is added alongside the existing caps/lower/number/symbol classification system.
- In dingbat mode, the row classifier is replaced with a free-form grid: each detected component is shown as a thumbnail, and the user either:
  - Assigns it to a specific Unicode PUA slot (`U+E000` … `U+F8FF`) manually, or
  - Lets the plugin auto-assign sequentially starting from `U+E000`.
- The glyph sheet layout switches from the alphabetic Calligraphr-style grid to a free-form symbol board with custom labels.
- The OTF export assigns each shape to its PUA code point with a descriptive glyph name (e.g. `uniE001`, `heart`, `star-four-point`).

**Design consideration:** Dingbat fonts benefit from consistent optical sizing. A normalization step that scales all glyphs to a common cap-height (already done for alphabetic glyphs) is important here too, but with an opt-out for glyphs that intentionally break the baseline (e.g. descenders, ornamental swashes).

---

## 5. Non-traditional lettering sources — friendship bracelets, physical arrangements, etc.

**What it is:** Support image sources where letters are spelled out by physical objects rather than handwriting — friendship bracelet beads, stencil cutouts, letter tiles, typeset stamps, or any arrangement where the letter shape is preserved but the medium is non-ink.

**The challenge:** The current pipeline assumes ink-on-paper: a dark foreground on a light background, with coherent connected components per glyph. Physical objects introduce:
- Uneven backgrounds (wood, fabric, carpet, concrete).
- Multiple colors per object that don't threshold cleanly.
- Shadows and perspective distortion.
- Complex internal structure (the bead hole, the thread between beads, the tile grout).

**How it would work:**

*Background removal step (new):*
- Before the existing binarization pipeline, run an automatic background removal pass. In-browser options:
  - WebGL-accelerated GrabCut (feasible but complex to implement from scratch).
  - Load a lightweight ONNX segmentation model (e.g. U2-Net small at ~4 MB) via ONNX Runtime Web and run inference in the UI iframe.
  - As a simpler fallback: magic-wand flood fill from image corners to isolate the background, then invert.
- The result is an RGBA image with transparent background and preserved foreground colors.

*Letter detection step:*
- After background removal, run connected-component detection on the alpha channel (non-transparent pixels) rather than on grayscale ink density.
- Each component retains its original color information — the bead's color, the tile texture — so the extracted glyph vector can be colorized with the dominant color of the source region.

*Design structure preservation:*
- The extracted vector outline captures the silhouette of the object (bead, tile).
- An optional "preserve fill color" toggle replaces the flat ink fill in the glyph sheet with a sampled color taken from the bead's dominant hue.
- For objects with internal holes (letter O bead, bracelet thread gaps), the existing EVENODD hole-finding logic handles cutouts correctly once the alpha channel is used as the binary mask.

*Manual split tool (for tightly-packed arrangements):*
- When beads or tiles touch, the connected-component algorithm merges them. A manual split tool lets the user draw a dividing line on a detected component to break it into two glyphs, similar to how some OCR tools handle touching characters.

---

## 6. AI-assisted glyph completion from a partial character set

**What it is:** The user provides only a subset of the alphabet (e.g. they hand-lettered only A–M, or only uppercase, or only the letters in a specific phrase). The plugin uses Figma's AI capabilities and the existing glyph set as style reference to generate plausible completions for the missing characters.

**How it would work (within Figma plugin context):**
- After the user's detected glyphs are placed in the glyph sheet, empty cells are identified.
- For each missing glyph, the plugin calls `figma.ai.generate(...)` (or the equivalent generation surface available to plugins) with a prompt that includes:
  - A reference image of 4–6 existing glyphs from the same font (showing the style, stroke width, and quirks of the handwriting).
  - The target character as text.
  - A style description derived from the detected glyphs (e.g. "slightly right-leaning, thick downstrokes, open counters").
- The generated image is run through the same binarization + vectorization pipeline as a real photo.
- Generated glyphs are placed in the glyph sheet with a visual indicator (e.g. a small sparkle icon or different background tint) to distinguish them from photographed originals.
- The user can regenerate any individual cell, replace it with a real photo, or delete it.

**Alternate path (not requiring AI generation):**
- Interpolation from similar characters: given "P" and "R", approximate "B" by combining features. This is a structural font interpolation problem — technically tractable with cubic bezier operations but producing lower-fidelity results than AI generation.
- A Figma-native approach: create placeholder empty frames for missing glyphs and use the existing `edit_slide_design` / `create_design` agent to suggest completions as an explicit user-initiated step, outside the plugin itself.
