/**
 * OCR for statements that arrive as scans.
 *
 * Citizens (and any bank that prints to image) ships PDFs with no text layer at
 * all — zero text items, nothing for the parser to read. Tesseract reports a
 * word and a bounding box per word, which is the same shape pdfjs reports, so
 * the recognised page goes through the shared parser's own sectioning, sign and
 * validation logic. That matters: an OCR'd statement is held to the same
 * standard as any other and is reported as failing rather than quietly trusted.
 *
 * Pulse only. Ledger runs online and stays light; this pulls in a WASM engine
 * and a language model.
 */
import { createWorker, PSM } from 'tesseract.js'

/** ~216 dpi. Tesseract degrades badly below about 150. */
const RENDER_SCALE = 3

/** Words the engine itself doubts are noise more often than data. */
const MIN_CONFIDENCE = 40

/** Narrower than this is word spacing, not a column gutter. Points. */
const MIN_GUTTER_WIDTH = 12

/** Ignore slivers when deciding whether a gutter really splits the page. */
const MIN_COLUMN_WORDS = 4

export interface TextItem {
  str: string
  x: number
  y: number
  width: number
}

interface OcrWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * Split a page into columns at its vertical gutters.
 *
 * With no text layer there is nothing to say which column a word belongs to,
 * and Citizens prints a section heading ("Deposits & Credits") at the same y as
 * an unrelated right-hand total ("Total Deposits & Credits") — measured 490.00
 * against 492.00, closer together than any line tolerance could separate.
 * Grouped by y alone they become one line, which reads as a footer instead of a
 * heading and files every deposit under debits.
 *
 * A gutter is a vertical band no word crosses. Splitting there and reading each
 * column top to bottom recovers the order a person reads in.
 */
export function splitIntoColumns(items: TextItem[], pageWidth: number): TextItem[][] {
  if (items.length < 12) return [items]

  const covered = new Uint8Array(Math.ceil(pageWidth) + 1)
  for (const item of items) {
    const from = Math.max(0, Math.floor(item.x))
    const to = Math.min(covered.length - 1, Math.ceil(item.x + item.width))
    for (let x = from; x <= to; x++) covered[x] = 1
  }

  const gutters: Array<[number, number]> = []
  let runStart: number | null = null
  for (let x = 0; x < covered.length; x++) {
    if (!covered[x]) {
      if (runStart === null) runStart = x
    } else if (runStart !== null) {
      if (x - runStart >= MIN_GUTTER_WIDTH) gutters.push([runStart, x])
      runStart = null
    }
  }

  // Margins are not columns.
  const interior = gutters.filter(([a, b]) => a > pageWidth * 0.15 && b < pageWidth * 0.9)
  if (!interior.length) return [items]

  interior.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
  const [gapStart, gapEnd] = interior[0]
  const boundary = (gapStart + gapEnd) / 2

  const left = items.filter((i) => i.x + i.width / 2 < boundary)
  const right = items.filter((i) => i.x + i.width / 2 >= boundary)
  if (left.length < MIN_COLUMN_WORDS || right.length < MIN_COLUMN_WORDS) return [items]

  return [left, right]
}

function wordsToItems(words: OcrWord[], imageHeight: number, scale: number): TextItem[] {
  const items: TextItem[] = []
  for (const word of words) {
    const text = String(word.text || '').trim()
    if (!text || word.confidence < MIN_CONFIDENCE) continue
    items.push({
      str: text,
      x: word.bbox.x0 / scale,
      // OCR boxes grow downward from the top of the image; pdfjs y grows upward
      // from the bottom and sits on the baseline, which the box's lower edge
      // approximates closely enough to group lines by.
      y: (imageHeight - word.bbox.y1) / scale,
      width: (word.bbox.x1 - word.bbox.x0) / scale
    })
  }
  return items
}

function collectWords(blocks: unknown): OcrWord[] {
  const words: OcrWord[] = []
  for (const block of (blocks as any[]) || [])
    for (const para of block.paragraphs || [])
      for (const line of para.lines || [])
        for (const word of line.words || []) words.push(word as OcrWord)
  return words
}

/**
 * Recognise every page of an already-opened pdfjs document, returning one entry
 * per column per page in reading order — the shape extractTransactionsFromItems
 * expects.
 */
export async function ocrDocumentPages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  document: any,
  onProgress?: (pageNumber: number, pageCount: number) => void
): Promise<TextItem[][]> {
  const worker = await createWorker('eng')
  const pages: TextItem[][] = []

  try {
    // AUTO runs layout analysis, which keeps the sign glyphs that SPARSE_TEXT
    // drops ("- 53.00" rather than "53.00").
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      onProgress?.(pageNumber, document.numPages)

      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not get a 2D canvas context for OCR rendering.')
      // Tesseract reads dark on light; an unpainted canvas is transparent.
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise

      const { data } = await worker.recognize(canvas, {}, { blocks: true })
      const items = wordsToItems(collectWords(data.blocks), canvas.height, RENDER_SCALE)
      for (const column of splitIntoColumns(items, viewport.width / RENDER_SCALE)) {
        pages.push(column)
      }
    }
  } finally {
    await worker.terminate()
  }

  return pages
}
