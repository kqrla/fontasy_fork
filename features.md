# features

## modes

### alphabetic
the default mode. expects a grid-like layout of handwritten characters arranged in rows. auto-classifies detected glyphs into sections: punctuation, digits, uppercase, lowercase. maps each glyph to its corresponding unicode codepoint.

### dingbat
for symbol sets, icons, decorative elements. every detected blob becomes a glyph regardless of position. glyphs are mapped to the Private Use Area (U+E000+) since they don't correspond to standard characters.

### bead
for letter beads, scrabble tiles, rubber stamps, or any source where the physical shape/texture of the tile matters. instead of vectorizing, crops the original raster image for each detected glyph and preserves it as-is. the glyph sheet shows the actual bead/tile appearance.

## image processing

### multi-source input
- drag & drop images directly onto the plugin
- paste from clipboard
- select a node on the figma canvas (auto-detected on plugin open)
- upload via file picker
- multiple images can be loaded; switch between them in the source strip

### video frame extraction
- supports mp4, mov, webm, gif
- scrub through video with the frame slider
- captures the current frame as a still for processing
- useful for extracting hand-lettering from video recordings

### supported formats
png, jpeg, webp, avif, svg (rasterized), gif (first frame or scrubbed), mp4, mov, webm, zip (extract manually)

## detection

### sensitivity / threshold
- **auto mode (default)**: uses otsu's method to find the optimal binary threshold
- **manual mode**: slide to control the black/white cutoff point
- higher values = more aggressive detection (picks up lighter strokes)
- lower values = more selective (only strong dark marks)

### minimum glyph size
ignores connected components smaller than this pixel area. helps filter out noise, dust, and paper texture artifacts.

### merge distance
how close two fragments need to be (in pixels) to be merged into a single glyph. essential for:
- broken pencil strokes
- dotted letters (i, j)
- multi-stroke characters
- diacritics near their base letter

### row grouping
glyphs are grouped into rows based on their vertical center (y-midpoint). tolerance is based on average glyph height. rows are then sorted left-to-right for classification.

## color & texture

### k-means color zones
when enabled, runs k-means clustering on the pixels within each glyph to identify distinct color regions. each color zone gets its own vector path in the output.

- adjustable cluster count (2-8)
- preview swatches show detected palette
- useful for multi-color lettering, watercolor effects, gradient inks

### texture modes
- **clean**: no post-processing, sharp vector edges
- **rough**: subtle layer blur (0.2px) for a hand-drawn feel
- **crayon**: medium blur (0.4px) simulating waxy crayon texture
- **pencil**: light blur (0.15px) for graphite pencil appearance
- **chalk**: heavier blur (0.6px) for chalky/dusty edges

### ink color
when color zones are disabled, all glyphs are filled with a single ink color (default: near-black). pick any color with the color picker.

## output

### glyph sheet (figma)
generates a frame in figma containing:
- title bar with font name and metadata
- grid of cells, each containing one glyph
- guide lines (ascender, x-height, baseline, descender) for alphabetic mode
- cell labels showing the character mapping

### font export
- **otf** — opentype/cff format, standard for desktop/web
- **ttf** — truetype format, universal compatibility
- **woff** — web open font format 1.0, compressed for web use
- **woff2** — noted in UI (falls back to otf currently — full woff2 compression requires brotli which isn't available in browser sandbox)

glyphs are scaled to fit within a 1000 UPM (units per em) grid with 800 ascender / -200 descender metrics.

## canvas selection

the plugin automatically detects if you have a node selected on the figma canvas when it opens. the selection is exported as PNG and loaded as the source image — no file dropping needed. changing selection updates the source in real-time.
