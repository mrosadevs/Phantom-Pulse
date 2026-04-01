/**
 * Bank statement PDF parser — ported from Phantom Ledger's pdfParser.js
 * Runs entirely in the renderer (Chromium) where pdfjs-dist works natively.
 */

import * as pdfjsLib from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

// Configure worker — Vite resolves this at build time
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// ── Types ────────────────────────────────────────────────────────────────────

export interface ParsedTransaction {
  date: string      // MM/DD/YYYY
  description: string
  amount: number    // negative = debit/withdrawal, positive = credit/deposit
  original: string  // raw description before cleaning
}

interface TextChunk {
  text: string
  x: number
  y: number
}

interface LogicalLine {
  chunks: TextChunk[]
  text: string
  y: number
}

interface ColumnHints {
  debitX?: number
  creditX?: number
  amountX?: number
  descriptionX?: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DATE_RE = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/
const DATE_NAMED_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}$/i
const DATE_YYYYMMDD_RE = /^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/
const AMOUNT_RE = /^-?\$?(\d{1,3}(?:,\d{3})*|\d+)(\.\d{2})?(CR|DR)?$/i
const FOOTER_PATTERNS = [
  /ending balance/i, /beginning balance/i, /page \d+ of \d+/i,
  /member fdic/i, /continued on/i, /total (debit|credit|deposit|withdrawal)/i,
  /^\s*balance\s*$/i, /^account (number|#)/i
]

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function parseStatementPdfs(files: File[]): Promise<ParsedTransaction[]> {
  const all: ParsedTransaction[] = []
  for (const file of files) {
    const buf = await file.arrayBuffer()
    const txns = await parseSinglePdf(new Uint8Array(buf), file.name)
    all.push(...txns)
  }
  // Sort chronologically
  all.sort((a, b) => {
    const da = new Date(a.date).getTime()
    const db = new Date(b.date).getTime()
    return da - db
  })
  return all
}

// ── Single PDF ────────────────────────────────────────────────────────────────

async function parseSinglePdf(data: Uint8Array, _fileName: string): Promise<ParsedTransaction[]> {
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const allLines: LogicalLine[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const chunks: TextChunk[] = (content.items as TextItem[])
      .filter((item) => item.str.trim().length > 0)
      .map((item) => ({
        text: item.str,
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5])
      }))
    allLines.push(...groupIntoLines(chunks))
  }

  const anchorYear = inferAnchorYear(allLines)
  const colHints = detectColumnHints(allLines)
  return extractTransactions(allLines, anchorYear, colHints)
}

// ── Group text chunks into logical lines (same y within tolerance) ─────────────

function groupIntoLines(chunks: TextChunk[]): LogicalLine[] {
  const TOLERANCE = 2.4
  const buckets: Map<number, TextChunk[]> = new Map()

  for (const chunk of chunks) {
    let found = false
    for (const [key] of buckets) {
      if (Math.abs(key - chunk.y) <= TOLERANCE) {
        buckets.get(key)!.push(chunk)
        found = true
        break
      }
    }
    if (!found) buckets.set(chunk.y, [chunk])
  }

  const lines: LogicalLine[] = []
  for (const [y, chks] of buckets) {
    const sorted = chks.sort((a, b) => a.x - b.x)
    lines.push({
      chunks: sorted,
      text: sorted.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim(),
      y
    })
  }

  return lines.sort((a, b) => b.y - a.y) // top-to-bottom (PDF y is bottom-up)
}

// ── Infer anchor year from fully-qualified dates in the document ───────────────

function inferAnchorYear(lines: LogicalLine[]): number {
  for (const line of lines) {
    const m = line.text.match(/\b(20\d{2})\b/)
    if (m) return parseInt(m[1], 10)
  }
  return new Date().getFullYear()
}

// ── Detect column x-positions from header row ─────────────────────────────────

function detectColumnHints(lines: LogicalLine[]): ColumnHints {
  const hints: ColumnHints = {}
  for (const line of lines) {
    const lower = line.text.toLowerCase()
    if (
      lower.includes('date') &&
      (lower.includes('description') || lower.includes('transaction')) &&
      (lower.includes('amount') || lower.includes('debit') || lower.includes('credit'))
    ) {
      // Found header line — map column keywords to x positions
      for (const chunk of line.chunks) {
        const w = chunk.text.toLowerCase().trim()
        if (w === 'debit' || w === 'withdrawals') hints.debitX = chunk.x
        else if (w === 'credit' || w === 'deposits') hints.creditX = chunk.x
        else if (w === 'amount') hints.amountX = chunk.x
        else if (w === 'description' || w === 'transaction') hints.descriptionX = chunk.x
      }
      break
    }
  }
  return hints
}

// ── Extract transactions ───────────────────────────────────────────────────────

function extractTransactions(
  lines: LogicalLine[],
  anchorYear: number,
  colHints: ColumnHints
): ParsedTransaction[] {
  const results: ParsedTransaction[] = []
  let pending: { date: string; parts: string[] } | null = null

  const flush = () => {
    if (!pending) return
    const raw = pending.parts.join(' ').trim()
    const parsed = parseDescriptionAndAmount(raw, pending.date, colHints)
    if (parsed) results.push(parsed)
    pending = null
  }

  for (const line of lines) {
    if (isFooterLine(line.text)) { flush(); continue }

    const date = extractLeadingDate(line.text, anchorYear)
    if (date) {
      flush()
      const rest = line.text.replace(/^\S+\s*/, '').trim()
      pending = { date, parts: rest ? [rest] : [] }
    } else if (pending) {
      // Continuation line
      pending.parts.push(line.text)
    }
  }
  flush()
  return results
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isFooterLine(text: string): boolean {
  return FOOTER_PATTERNS.some((p) => p.test(text))
}

function extractLeadingDate(text: string, anchorYear: number): string | null {
  const firstToken = text.split(/\s+/)[0]

  // MM/DD/YYYY or MM-DD-YYYY
  const m1 = firstToken.match(DATE_RE)
  if (m1) {
    const [, mm, dd, yy] = m1
    const year = yy.length === 2 ? anchorYear - (anchorYear % 100) + parseInt(yy, 10) : parseInt(yy, 10)
    return `${mm.padStart(2, '0')}/${dd.padStart(2, '0')}/${year}`
  }

  // YYYYMMDD
  const m2 = firstToken.match(DATE_YYYYMMDD_RE)
  if (m2) {
    return `${m2[2]}/${m2[3]}/${m2[1]}`
  }

  // Named: "Jan 15, 2024" — needs first 3 tokens
  const threeTokens = text.split(/\s+/).slice(0, 3).join(' ')
  const m3 = threeTokens.match(DATE_NAMED_RE)
  if (m3) {
    const parts = threeTokens.replace(',', '').split(/\s+/)
    const month = MONTH_MAP[parts[0].slice(0, 3).toLowerCase()]
    const day = parseInt(parts[1], 10)
    const year = parseInt(parts[2], 10)
    if (month && day && year) {
      return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`
    }
  }

  return null
}

function parseDescriptionAndAmount(
  raw: string,
  date: string,
  _colHints: ColumnHints
): ParsedTransaction | null {
  if (!raw) return null

  // Find all amount-like tokens
  const tokens = raw.split(/\s+/)
  let amount: number | null = null
  let amountIdx = -1

  // Scan from the right for amounts
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/,/g, '')
    const m = t.match(/^-?\$?(\d+\.\d{2})(CR|DR)?$/i)
    if (m) {
      let val = parseFloat(m[1])
      const suffix = m[2]?.toUpperCase()
      const isNeg = t.startsWith('-') || suffix === 'DR'
      if (isNeg) val = -val
      // Ignore balance column (often the last amount) if there are two amounts
      if (amount === null) {
        amount = val
        amountIdx = i
      } else {
        // We already have one — use this earlier one as the transaction amount
        amount = val
        amountIdx = i
        break
      }
    }
  }

  if (amount === null) return null

  // Description is everything before the amount token
  const descTokens = tokens.slice(0, amountIdx)
  // Strip check numbers at start (e.g. "1234 AMAZON")
  const desc = descTokens
    .filter((t) => !/^\d{3,}$/.test(t)) // bare long numbers
    .join(' ')
    .trim()

  if (!desc) return null

  return {
    date,
    description: desc,
    amount,
    original: desc
  }
}
