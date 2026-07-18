# roadmap

## completed (v4)

- [x] core image processing pipeline (grayscale, threshold, blur, dilation)
- [x] connected component labeling + bounding box extraction
- [x] fragment merging (union-find)
- [x] row grouping + auto-classification
- [x] contour tracing (moore boundary algorithm)
- [x] douglas-peucker simplification
- [x] catmull-rom to cubic bezier conversion
- [x] hole detection (flood fill + interior region tracing)
- [x] otsu auto-thresholding
- [x] dingbat mode (PUA mapping)
- [x] bead mode (raster preservation)
- [x] k-means color zone segmentation
- [x] texture modes (clean/rough/crayon/pencil/chalk)
- [x] multi-source image support
- [x] video frame extraction (mp4/mov/webm/gif)
- [x] canvas selection auto-detection
- [x] multi-format export (otf/ttf/woff)
- [x] dark themed UI
- [x] standalone web app
- [x] figma plugin deployment

## next up (v5)

- [ ] proper woff2 compression (needs brotli — possibly via wasm)
- [ ] variable font support (weight axis from stroke thickness detection)
- [ ] kerning pair generation (measure inter-glyph spacing from source)
- [ ] ligature detection (fi, fl, ff, ffi, ffl)
- [ ] baseline auto-alignment from source image
- [ ] batch export (multiple fonts from one session)
- [ ] undo/redo in glyph editing
- [ ] manual glyph reassignment (drag to reorder/relabel)

## future (v6+)

- [ ] AI-assisted glyph classification (replace row-based assumption)
- [ ] style transfer between fonts (match weight/width of reference)
- [ ] svg color font support (SVGinOT)
- [ ] multi-layer color fonts (COLR/CPAL tables)
- [ ] opentype feature editor (alternates, contextual forms)
- [ ] web worker parallelization for large images
- [ ] progressive web app (offline-first)
- [ ] figma community plugin publishing
- [ ] collaborative editing (multiple users contribute glyphs)
- [ ] font specimen generator (preview text layouts)
- [ ] integration with google fonts / adobe fonts metadata format
- [ ] handwriting recognition for auto-labeling (optional ML model)
- [ ] pressure-sensitive stroke width from tablet input
- [ ] real-time preview of typed text using generated font
