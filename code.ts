const TOOL_ID = 'fedc6abd-75e6-477c-982e-fb0d81e97e14'
const DISPLAY_NAME = 'Fontasy fork'

const CHAR_ORDER: string[] = [
  '!', '"', '#', '$', '%', '&', "'", '(', ')',
  '*', '+', ',', '-', '.', '/',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  ':', ';', '<', '=', '>', '?', '@',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I',
  'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R',
  'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  '[', '\\', ']', '^', '_', '`',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i',
  'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r',
  's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '{', '|', '}', '~',
  '£', '€', '₹', '←', '↑', '→', '↓',
]

const COLS = 9
const CELL_W = 128
const CELL_H = 192
const BORDER = 1
const OUTER = 48
const TITLE_H = 88

const GUIDES = [
  { pos: 0.22, r: 0.38, g: 0.58, b: 0.92, a: 0.2 },
  { pos: 0.47, r: 0.35, g: 0.72, b: 0.52, a: 0.2 },
  { pos: 0.70, r: 0.15, g: 0.15, b: 0.15, a: 0.5 },
  { pos: 0.84, r: 0.85, g: 0.42, b: 0.38, a: 0.2 },
]

const GLYPH_TOP_FRAC = 0.22
const GLYPH_BOT_FRAC = 0.84

type ColorZone = { path: string; color: { r: number; g: number; b: number }; opacity: number }

type CharData = {
  label: string
  sectionType: string
  sectionIndex: number
  bounds: { x: number; y: number; w: number; h: number }
  vectorPath: string
  colorZones?: ColorZone[]
  rasterBytes?: number[]
  rasterW?: number
  rasterH?: number
}

type Msg =
  | { type: 'resize'; height: number }
  | {
      type: 'generate'
      sections: Array<{ type: string; chars: CharData[] }>
      padding: number
      inkColor: { r: number; g: number; b: number }
      filename: string
      mode: 'alphabetic' | 'dingbat' | 'bead'
      textureMode: 'clean' | 'rough' | 'crayon' | 'pencil' | 'chalk'
      colorMode: boolean
    }
  | { type: 'request-canvas-image' }
  | { type: 'ui-ready' }
  | { type: 'cancel' }

figma.root.setRelaunchData({ [TOOL_ID]: DISPLAY_NAME })
figma.showUI(__html__, { width: 360, height: 640, themeColors: false })

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
    figma.ui.resize(360, Math.min(820, Math.max(200, Math.round(msg.height))))
    return
  }
  if (msg.type === 'request-canvas-image' || msg.type === 'ui-ready') { void tryExportSelectedImage(); return }
  if (msg.type === 'cancel') { figma.closePlugin(); return }
  if (msg.type === 'generate') {
    try {
      await buildGlyphSheet(msg)
      figma.ui.postMessage({ type: 'done' })
    } catch (err) {
      figma.ui.postMessage({ type: 'error', message: String(err) })
      throw err
    }
  }
}

async function buildGlyphSheet(msg: Extract<Msg, { type: 'generate' }>) {
  const { sections: rawSections, inkColor: ink, filename, mode, textureMode, colorMode } = msg

  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Light' })

  const isBead = mode === 'bead'
  const isDingbat = mode === 'dingbat'
  const isAlpha = mode === 'alphabetic'

  const charMap = new Map<string, CharData>()
  for (const section of rawSections) {
    if (section.type === 'skip') continue
    for (const char of section.chars) {
      if (!isBead && !char.vectorPath) continue
      if (isBead && !char.rasterBytes) continue
      charMap.set(char.label, char)
    }
  }

  const charList = isAlpha ? CHAR_ORDER : Array.from(charMap.keys())
  const cols = isAlpha ? COLS : Math.min(Math.max(charMap.size, 1), 8)
  const nRows = Math.ceil((isAlpha ? charList.length : charMap.size) / cols)
  const gridW = cols * CELL_W + (cols - 1) * BORDER
  const gridH = nRows * CELL_H + (nRows - 1) * BORDER
  const totalW = gridW + OUTER * 2
  const totalH = TITLE_H + gridH + OUTER * 2

  const main = figma.createFrame()
  main.name = isBead ? '✦ fontasy fork — bead sheet' : isDingbat ? '✦ fontasy fork — dingbat sheet' : '✦ fontasy fork — glyph sheet'
  main.resize(totalW, totalH)
  main.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  main.clipsContent = false

  const wordmark = figma.createText()
  wordmark.fontName = { family: 'Inter', style: 'Medium' }
  wordmark.characters = 'fontasy fork'
  wordmark.fontSize = 22
  wordmark.fills = [{ type: 'SOLID', color: { r: 0.08, g: 0.08, b: 0.1 } }]
  wordmark.letterSpacing = { value: -0.4, unit: 'PIXELS' }
  wordmark.x = OUTER; wordmark.y = 22
  main.appendChild(wordmark)

  const badges: string[] = []
  if (isBead) badges.push('bead')
  if (colorMode) badges.push('color')
  if (textureMode !== 'clean') badges.push(textureMode)
  if (isDingbat) badges.push('dingbat')

  const metaText = figma.createText()
  metaText.fontName = { family: 'Inter', style: 'Regular' }
  metaText.characters = `${charMap.size} glyphs · ${filename}${badges.length ? ' · ' + badges.join(' · ') : ''}`
  metaText.fontSize = 11
  metaText.fills = [{ type: 'SOLID', color: { r: 0.55, g: 0.55, b: 0.58 } }]
  metaText.x = OUTER; metaText.y = 52
  main.appendChild(metaText)

  if (isAlpha && !isBead) {
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
  }

  const gridBg = figma.createRectangle()
  gridBg.x = OUTER; gridBg.y = TITLE_H + OUTER
  gridBg.resize(gridW, gridH)
  gridBg.fills = [{ type: 'SOLID', color: { r: 0.82, g: 0.82, b: 0.84 } }]
  main.appendChild(gridBg)

  const iterList = isAlpha ? charList : Array.from(charMap.keys())
  let charIdx = 0
  for (let row = 0; row < nRows; row++) {
    for (let col = 0; col < cols && charIdx < iterList.length; col++, charIdx++) {
      const ch = iterList[charIdx]
      const cellX = OUTER + col * (CELL_W + BORDER)
      const cellY = TITLE_H + OUTER + row * (CELL_H + BORDER)
      figma.ui.postMessage({ type: 'progress', section: `cell ${charIdx + 1}/${iterList.length}` })
      const charData = charMap.get(ch) ?? null
      if (isBead) {
        await drawBeadCell(main, cellX, cellY, ch, charData)
      } else {
        await drawCell(main, cellX, cellY, ch, charData, ink, isDingbat, textureMode, colorMode)
      }
    }
  }

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
  figma.notify(`✦ fontasy fork · ${iterList.length} cells · ${charMap.size} glyphs`)
}

async function drawBeadCell(
  parent: FrameNode, x: number, y: number, ch: string, charData: CharData | null
) {
  const cell = figma.createFrame()
  cell.name = ch
  cell.resize(CELL_W, CELL_H)
  cell.x = x; cell.y = y
  cell.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  cell.clipsContent = true
  parent.appendChild(cell)

  const lbl = figma.createText()
  lbl.fontName = { family: 'Inter', style: 'Light' }
  lbl.characters = ch.length > 8 ? ch.slice(0, 8) : ch
  lbl.fontSize = 11
  lbl.fills = [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.62 } }]
  lbl.x = 5; lbl.y = 4
  cell.appendChild(lbl)

  if (charData && charData.rasterBytes && charData.rasterW && charData.rasterH) {
    try {
      const imgBytes = new Uint8Array(charData.rasterBytes)
      const imgHash = figma.createImage(imgBytes).hash
      const imgRect = figma.createRectangle()
      imgRect.name = ch + '-bead'
      const availW = CELL_W - 12
      const availH = CELL_H - 24
      const scale = Math.min(availW / charData.rasterW, availH / charData.rasterH)
      const rw = Math.round(charData.rasterW * scale)
      const rh = Math.round(charData.rasterH * scale)
      imgRect.resize(rw, rh)
      imgRect.x = Math.round((CELL_W - rw) / 2)
      imgRect.y = Math.round(18 + (availH - rh) / 2)
      imgRect.fills = [{
        type: 'IMAGE',
        imageHash: imgHash,
        scaleMode: 'FILL',
      }]
      cell.appendChild(imgRect)
      cell.setRelaunchData({ [TOOL_ID]: DISPLAY_NAME })
    } catch { /* skip */ }
  }
}

async function drawCell(
  parent: FrameNode, x: number, y: number, ch: string,
  charData: CharData | null, ink: { r: number; g: number; b: number },
  isDingbat: boolean, textureMode: string, colorMode: boolean
) {
  const cell = figma.createFrame()
  cell.name = ch
  cell.resize(CELL_W, CELL_H)
  cell.x = x; cell.y = y
  cell.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  cell.clipsContent = true
  parent.appendChild(cell)

  const lbl = figma.createText()
  lbl.fontName = { family: 'Inter', style: 'Light' }
  lbl.characters = ch.length > 8 ? ch.slice(0, 8) : ch
  lbl.fontSize = 11
  lbl.fills = [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.62 } }]
  lbl.x = 5; lbl.y = 4
  cell.appendChild(lbl)

  if (!isDingbat) {
    for (const g of GUIDES) {
      const lineY = Math.round(g.pos * CELL_H)
      const line = figma.createRectangle()
      line.name = 'guide'
      line.x = 0; line.y = lineY
      line.resize(CELL_W, 1)
      line.fills = [{ type: 'SOLID', color: { r: g.r, g: g.g, b: g.b }, opacity: g.a }]
      cell.appendChild(line)
    }
  }

  if (charData && charData.vectorPath) {
    try {
      if (colorMode && charData.colorZones && charData.colorZones.length > 0) {
        for (const zone of charData.colorZones) {
          const vec = figma.createVector()
          vec.name = ch + '-zone'
          vec.vectorPaths = [{ windingRule: 'EVENODD', data: zone.path }]
          vec.fills = [{ type: 'SOLID', color: zone.color, opacity: zone.opacity }]
          vec.strokes = []
          cell.appendChild(vec)
          scaleGlyphInCell(vec, isDingbat)
        }
      } else {
        const vec = figma.createVector()
        vec.name = ch
        vec.vectorPaths = [{ windingRule: 'EVENODD', data: charData.vectorPath }]
        vec.fills = [{ type: 'SOLID', color: ink }]
        vec.strokes = []
        cell.appendChild(vec)
        scaleGlyphInCell(vec, isDingbat)
        if (textureMode !== 'clean') applyTextureEffect(vec, textureMode)
      }
      cell.setRelaunchData({ [TOOL_ID]: DISPLAY_NAME })
    } catch { /* leave cell empty */ }
  }
}

function scaleGlyphInCell(vec: VectorNode, isDingbat: boolean) {
  const glyphZoneTop = Math.round(GLYPH_TOP_FRAC * CELL_H)
  const glyphZoneBot = Math.round(GLYPH_BOT_FRAC * CELL_H)
  const availH = isDingbat ? CELL_H - 32 : glyphZoneBot - glyphZoneTop
  const availW = CELL_W - 16
  const topOffset = isDingbat ? 16 : glyphZoneTop
  const vw = vec.width, vh = vec.height
  if (vw > 0 && vh > 0) {
    const scale = Math.min(availH / vh, availW / vw) * 0.85
    const clampedScale = Math.min(scale, 4)
    if (clampedScale > 0 && Math.abs(clampedScale - 1) > 0.01) vec.rescale(clampedScale)
    vec.x = Math.round((CELL_W - vec.width) / 2)
    vec.y = Math.round(topOffset + (availH - vec.height) / 2)
  }
}

function applyTextureEffect(vec: VectorNode, textureMode: string) {
  const effects: Effect[] = []
  if (textureMode === 'rough' || textureMode === 'crayon') {
    effects.push({ type: 'LAYER_BLUR', radius: textureMode === 'crayon' ? 0.4 : 0.2, visible: true } as Effect)
  } else if (textureMode === 'pencil') {
    effects.push({ type: 'LAYER_BLUR', radius: 0.15, visible: true } as Effect)
  } else if (textureMode === 'chalk') {
    effects.push({ type: 'LAYER_BLUR', radius: 0.6, visible: true } as Effect)
  }
  if (effects.length > 0) vec.effects = effects
}
