# use cases

## handwriting fonts

the primary use case. write out your alphabet on paper (or a tablet), photograph it, and convert to a font.

**workflow:**
1. write characters in a rough grid: punctuation → digits → uppercase → lowercase
2. photograph or scan at decent resolution (1000px+ wide)
3. drop into fontasy fork
4. adjust sensitivity until all strokes are detected
5. increase merge distance if letters with dots (i, j) or broken strokes aren't joining
6. export as otf/ttf

**tips:**
- use dark ink on white/light paper for best detection
- leave space between characters
- keep rows relatively straight
- thicker pens trace better than fine lines

## icon/symbol fonts (dingbat mode)

turn a collection of hand-drawn icons into a symbol font.

**workflow:**
1. draw icons on paper or digitally
2. arrange loosely (doesn't need to be in grid rows)
3. switch to dingbat mode
4. detect + export
5. glyphs get PUA unicode mappings (U+E000+)

**use for:**
- custom icon sets for websites
- decorative symbols for print
- game UI elements
- pattern/ornament fonts

## letter beads & tiles (bead mode)

for sources where the physical object shape matters — not just the letter on it.

**examples:**
- scrabble tiles
- letter beads (round, square, heart-shaped)
- rubber stamps
- embossed metal letters
- fridge magnets

**workflow:**
1. photograph your beads/tiles arranged in order
2. switch to bead mode
3. detect — each bead is cropped as a raster image preserving its full appearance
4. generate sheet shows the actual bead textures/shapes

## multi-color lettering

for hand-painted or watercolor lettering with multiple colors per character.

**workflow:**
1. enable "color zones (k-means)" toggle
2. set cluster count (3-5 works well for most)
3. detect — each glyph gets segmented into color regions
4. each color zone becomes a separate vector path with its original color

**works great with:**
- watercolor brush lettering
- gradient marker effects
- two-tone calligraphy
- spray paint stencils

## texture preservation

when you want the font to retain the hand-made quality of the original medium.

**modes:**
- **crayon** — thick waxy strokes from actual crayons
- **pencil** — graphite sketches, light pressure variation
- **chalk** — dusty edges from chalkboard writing
- **rough** — general hand-drawn feel without mimicking a specific medium

## video frame extraction

for extracting lettering from recorded writing sessions.

**workflow:**
1. record yourself writing (overhead camera or screen recording)
2. drop the video file into fontasy fork
3. scrub to the frame where all characters are visible
4. proceed with normal detection

**use for:**
- timelapse calligraphy videos
- whiteboard session captures
- process documentation
- educational content

## batch processing (multi-source)

when your character set spans multiple pages/photos.

**workflow:**
1. drop first image (e.g., uppercase letters)
2. click "+ add source" for the next image (lowercase)
3. switch between sources in the thumbnail strip
4. detect from each source separately
5. all detected glyphs combine into the final font

## web app (standalone)

the `web/index.html` version works without figma — same processing pipeline, runs in any browser.

**good for:**
- quick font creation without opening figma
- sharing with non-figma users
- embedding in other workflows
- offline use (once loaded)
