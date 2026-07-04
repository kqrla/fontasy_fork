const TOOL_ID = '4691facd-7d64-4400-90f1-5d27ed0f41be'
const DISPLAY_NAME = 'Fontasy'

// ── Full character set in Calligraphr/Unicode order ──
const CHAR_ORDER: string[] = [
  // Punctuation & symbols (! through /)
  '!', '"', '#', '$', '%', '&', "'", '(', ')',
  '*', '+', ',', '-', '.', '/',
  // Digits
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  // More punctuation
  ':', ';', '<', '=', '>', '?', '@',
  // Uppercase A-Z
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I',
  'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R',
  'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  // More punctuation
  '[', '\\', ']', '^', '_', '`',
  // Lowercase a-z
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i',
  'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r',
  's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  // Final punctuation
  '{', '|', '}', '~',
  // Currency & arrows
  '£', '€', '₹', '←', '↑', '→', '↓',
]

// ── Grid layout (matches Calligraphr template) ──
const COLS = 9
const CELL_W = 128
const CELL_H = 192
const BORDER = 1  // 1px grid line between cells
const OUTER = 48
const TITLE_H = 88

// Guide line positions as fraction of cell height (matching Calligraphr proportions)
const GUIDES = [
  { pos: 0.22, r: 0.38, g: 0.58, b: 0.92, a: 0.2 },  // ascender / cap height
  { pos: 0.47, r: 0.35, g: 0.72, b: 0.52, a: 0.2 },  // x-height
  { pos: 0.70, r: 0.15, g: 0.15, b: 0.15, a: 0.5 },  // baseline (darker)
  { pos: 0.84, r: 0.85, g: 0.42, b: 0.38, a: 0.2 },  // descender
]

// Zone where glyphs are positioned (between ascender and descender guide)
const GLYPH_TOP_FRAC = 0.22
const GLYPH_BOT_FRAC = 0.84

type CharData = {
  label: string
  sectionType: string
  sectionIndex: number
  bounds: { x: number; y: number; w: number; h: number }
  vectorPath: string
}

type Msg =
  | { type: 'resize'; height: number }
  | { type: 'generate'; sections: Array<{ type: string; chars: CharData[] }>; padding: number; inkColor: { r: number; g: number; b: number }; filename: string }
  | { type: 'request-canvas-image' }
  | { type: 'cancel' }

figma.root.setRelaunchData({ [TOOL_ID]: DISPLAY_NAME })
figma.showUI(__html__, { width: 320, height: 560, themeColors: false })

void tryExportSelectedImage()
figma.on('selectionchange', () => { void tryExportSelectedImage() })

async function tryExportSelectedImage() {
  const sel = figma.currentPage.selection
  if (sel.length !== 1) return
  const node = sel[0]
  try {
    const maxDim = Math.max(node.width, node.height)
    const scale = maxDim > 2000 ? 2000 / maxDim : 1
    const bytes = await (node as ExportMixin).exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: scale },
    })
    figma.ui.postMessage({
      type: 'canvas-image',
      bytes: Array.from(bytes),
      name: node.name,
      width: Math.round(node.width * scale),
      height: Math.round(node.height * scale),
    })
  } catch { /* not exportable */ }
}

figma.ui.onmessage = async (msg: Msg) => {
  if (msg.type === 'resize') {
    figma.ui.resize(320, Math.min(750, Math.max(200, Math.round(msg.height))))
    return
  }
  if (msg.type === 'request-canvas-image') { void tryExportSelectedImage(); return }
  if (msg.type === 'cancel') { figma.closePlugin(); return }
  if (msg.type === 'generate') {
    try {
      await buildGlyphSheet(msg.sections as Array<{ type: string; chars: CharData[] }>, msg.padding, msg.inkColor, msg.filename)
      figma.ui.postMessage({ type: 'done' })
    } catch (err) {
      figma.ui.postMessage({ type: 'error', message: String(err) })
      throw err
    }
  }
}

async function buildGlyphSheet(
  rawSections: Array<{ type: string; chars: CharData[] }>,
  _padding: number,
  ink: { r: number; g: number; b: number },
  filename: string
) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Light' })

  // Build char map: label → CharData
  const charMap = new Map<string, CharData>()
  for (const section of rawSections) {
    if (section.type === 'skip') continue
    for (const char of section.chars) {
      // Single-char labels that exist in our character set
      if (char.label.length === 1 && CHAR_ORDER.includes(char.label)) {
        charMap.set(char.label, char)
      }
    }
  }

  const nRows = Math.ceil(CHAR_ORDER.length / COLS)
  const gridW = COLS * CELL_W + (COLS - 1) * BORDER
  const gridH = nRows * CELL_H + (nRows - 1) * BORDER
  const totalW = gridW + OUTER * 2
  const totalH = TITLE_H + gridH + OUTER * 2

  // Main sheet frame — pure white like the Calligraphr template
  const main = figma.createFrame()
  main.name = '✦ fontasy — glyph sheet'
  main.resize(totalW, totalH)
  main.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  main.clipsContent = false

  // ── Title block ──
  const wordmark = figma.createText()
  wordmark.fontName = { family: 'Inter', style: 'Medium' }
  wordmark.characters = 'fontasy'
  wordmark.fontSize = 22
  wordmark.fills = [{ type: 'SOLID', color: { r: 0.08, g: 0.08, b: 0.1 } }]
  wordmark.letterSpacing = { value: -0.4, unit: 'PIXELS' }
  wordmark.x = OUTER; wordmark.y = 22
  main.appendChild(wordmark)

  const metaText = figma.createText()
  metaText.fontName = { family: 'Inter', style: 'Regular' }
  metaText.characters = `glyph sheet · ${charMap.size} glyphs collected · ${filename}`
  metaText.fontSize = 11
  metaText.fills = [{ type: 'SOLID', color: { r: 0.55, g: 0.55, b: 0.58 } }]
  metaText.x = OUTER; metaText.y = 52
  main.appendChild(metaText)

  // Legend row (guide line key)
  const legendItems = [
    { label: 'ascender', r: 0.38, g: 0.58, b: 0.92 },
    { label: 'x-height', r: 0.35, g: 0.72, b: 0.52 },
    { label: 'baseline', r: 0.15, g: 0.15, b: 0.15 },
    { label: 'descender', r: 0.85, g: 0.42, b: 0.38 },
  ]
  let legendX = totalW - OUTER
  for (let i = legendItems.length - 1; i >= 0; i--) {
    const li = legendItems[i]
    const lbl = figma.createText()
    lbl.fontName = { family: 'Inter', style: 'Regular' }
    lbl.characters = li.label
    lbl.fontSize = 9
    lbl.fills = [{ type: 'SOLID', color: { r: li.r, g: li.g, b: li.b } }]
    legendX -= lbl.width + 16
    lbl.x = legendX; lbl.y = 56
    main.appendChild(lbl)

    const dot = figma.createEllipse()
    dot.resize(6, 6)
    dot.x = legendX - 10; dot.y = 59
    dot.fills = [{ type: 'SOLID', color: { r: li.r, g: li.g, b: li.b }, opacity: 0.7 }]
    main.appendChild(dot)
    legendX -= 10
  }

  // ── Grid background (the 1px gray borders show through as grid lines) ──
  const gridBg = figma.createRectangle()
  gridBg.x = OUTER; gridBg.y = TITLE_H + OUTER
  gridBg.resize(gridW, gridH)
  gridBg.fills = [{ type: 'SOLID', color: { r: 0.82, g: 0.82, b: 0.84 } }]
  main.appendChild(gridBg)

  // ── Draw each cell ──
  let charIdx = 0
  for (let row = 0; row < nRows; row++) {
    for (let col = 0; col < COLS && charIdx < CHAR_ORDER.length; col++, charIdx++) {
      const ch = CHAR_ORDER[charIdx]
      const cellX = OUTER + col * (CELL_W + BORDER)
      const cellY = TITLE_H + OUTER + row * (CELL_H + BORDER)

      figma.ui.postMessage({ type: 'progress', section: `cell ${charIdx + 1}/${CHAR_ORDER.length}` })

      await drawCell(main, cellX, cellY, ch, charMap.get(ch) ?? null, ink)
    }
  }

  // Outer border frame around the grid
  const outerBorder = figma.createRectangle()
  outerBorder.x = OUTER; outerBorder.y = TITLE_H + OUTER
  outerBorder.resize(gridW, gridH)
  outerBorder.fills = []
  outerBorder.strokes = [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.62 } }]
  outerBorder.strokeWeight = 1
  outerBorder.strokeAlign = 'OUTSIDE'
  main.appendChild(outerBorder)

  main.x = Math.round(figma.viewport.center.x - totalW / 2)
  main.y = Math.round(figma.viewport.center.y - totalH / 2)
  main.setRelaunchData({ [TOOL_ID]: DISPLAY_NAME })
  figma.currentPage.selection = [main]
  figma.viewport.scrollAndZoomIntoView([main])
  figma.notify(`✦ fontasy · ${CHAR_ORDER.length} cells · ${charMap.size} glyphs`)
}

async function drawCell(
  parent: FrameNode,
  x: number, y: number,
  ch: string,
  charData: CharData | null,
  ink: { r: number; g: number; b: number }
) {
  // Cell frame — white background (grid background shows through gaps = borders)
  const cell = figma.createFrame()
  cell.name = ch
  cell.resize(CELL_W, CELL_H)
  cell.x = x; cell.y = y
  cell.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  cell.clipsContent = true
  parent.appendChild(cell)

  // ── Character label (top-left corner) ──
  const lbl = figma.createText()
  lbl.fontName = { family: 'Inter', style: 'Light' }
  lbl.characters = ch
  lbl.fontSize = 11
  lbl.fills = [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.62 } }]
  lbl.x = 5; lbl.y = 4
  cell.appendChild(lbl)

  // ── Guide lines ──
  for (const g of GUIDES) {
    const lineY = Math.round(g.pos * CELL_H)
    const line = figma.createRectangle()
    line.name = 'guide'
    line.x = 0; line.y = lineY
    line.resize(CELL_W, 1)
    line.fills = [{ type: 'SOLID', color: { r: g.r, g: g.g, b: g.b }, opacity: g.a }]
    cell.appendChild(line)
  }

  // ── Glyph vector (if detected) ──
  if (charData) {
    try {
      const vec = figma.createVector()
      vec.name = ch
      vec.vectorPaths = [{ windingRule: 'EVENODD', data: charData.vectorPath }]
      vec.fills = [{ type: 'SOLID', color: ink }]
      vec.strokes = []
      cell.appendChild(vec)

      // Scale glyph to fit in the guide zone between ascender and descender lines
      const glyphZoneTop = Math.round(GLYPH_TOP_FRAC * CELL_H)
      const glyphZoneBot = Math.round(GLYPH_BOT_FRAC * CELL_H)
      const availH = glyphZoneBot - glyphZoneTop
      const availW = CELL_W - 16

      const vw = vec.width, vh = vec.height
      if (vw > 0 && vh > 0) {
        const scale = Math.min(availH / vh, availW / vw) * 0.88
        const clampedScale = Math.min(scale, 4)  // cap upscaling
        if (clampedScale > 0 && Math.abs(clampedScale - 1) > 0.01) {
          vec.rescale(clampedScale)
        }
        // Center in guide zone
        vec.x = Math.round((CELL_W - vec.width) / 2)
        vec.y = Math.round(glyphZoneTop + (availH - vec.height) / 2)
      }

      vec.setRelaunchData({ [TOOL_ID]: DISPLAY_NAME })
    } catch { /* leave cell empty */ }
  }
}
