# fontasy fork

a figma plugin + standalone web app that turns images of handwriting, dingbats, letter beads, and symbols into usable fonts.

drop an image (or select from canvas), detect glyphs automatically, then export as otf/ttf/woff/woff2.

## what it does

- **alphabetic mode** — detects rows of handwritten characters, auto-classifies them (uppercase, lowercase, digits, punctuation), traces contours to vector paths
- **dingbat mode** — treats every detected blob as a symbol glyph, maps to Private Use Area unicode
- **bead mode** — preserves the full raster appearance of letter beads/tiles/stamps (no vectorization)

## features

- multi-source image support (drop multiple images, paste, or grab from figma canvas)
- video frame extraction (mp4/mov/webm/gif)
- k-means color zone segmentation for multi-color glyphs
- texture preservation modes (clean/rough/crayon/pencil/chalk)
- auto-sensitivity (otsu thresholding) or manual control
- fragment merging for broken strokes
- hole detection for counters (o, p, d, etc.)
- multi-format font export (otf, ttf, woff, woff2)
- dark themed UI

## supported input formats

png, jpg/jpeg, webp, avif, svg, gif, mp4, mov, webm, zip

## quick start

### figma plugin

1. open figma, run "fontasy fork" from plugins
2. drop an image of handwriting or select a canvas element
3. adjust sensitivity if needed
4. click "detect glyphs"
5. click "generate sheet" to preview in figma
6. click "export font" to download

### standalone web app

open `web/index.html` in any browser — same pipeline, no figma needed.

## project structure

```
├── manifest.json      # figma plugin manifest
├── code.ts            # plugin sandbox (figma API)
├── ui.html            # plugin UI + processing pipeline
├── web/
│   └── index.html     # standalone web app
├── readme.md          # this file
├── features.md        # detailed feature docs
├── usecases.md        # use case examples
├── underthehood.md    # technical deep-dive + diagrams
└── roadmap.md         # development roadmap
```

## how it works (brief)

1. image → grayscale → gaussian blur → threshold (otsu or manual)
2. binary dilation → connected component labeling
3. bounding box extraction → fragment merging → row grouping
4. contour tracing (moore boundary) → simplification (douglas-peucker)
5. catmull-rom spline → cubic bezier paths
6. hole detection via flood fill
7. font assembly via opentype.js

see [underthehood.md](underthehood.md) for the full technical breakdown with mermaid diagrams.

## license

mit
