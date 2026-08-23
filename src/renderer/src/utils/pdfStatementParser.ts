/**
 * Bank statement PDF parser — full TypeScript port of Phantom Ledger's
 * server/pdfParser.js (v2, with the METHOD.md fixes applied).
 *
 * Key guarantees, in order of importance:
 *  1. VALIDATION GATE — every statement is reconciled against its own printed
 *     control totals ("Total deposits and other credits", "Total checks", …)
 *     and its beginning→ending balance chain.  A parse that doesn't tie to
 *     the cent is reported loudly, never silently.
 *  2. SIGN FROM STRUCTURE — the transaction sign comes from the statement's
 *     section heading or the explicit sign on the amount token.  Description
 *     keywords ("deposit", "fee", "credit") never override structure; when
 *     they disagree, the row is flagged `sign-review` for a human.
 *  3. ACCOUNT-TYPE AWARE — bank and credit-card statements use opposite sign
 *     conventions (a Late Payment Fee on a card is a positive charge).  The
 *     account type is a first-class input, auto-detected but overridable.
 *
 * Runs entirely in the renderer (Chromium) where pdfjs-dist works natively.
 */

// The LEGACY build is required: the modern pdfjs 5.x build uses JS APIs
// (e.g. Uint8Array.toHex) that Electron 31's Chromium does not have yet.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

// Configure worker — Vite resolves this at build time
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// ── Types ────────────────────────────────────────────────────────────────────

export type AccountType = 'bank' | 'credit_card'
export type AccountTypeOption = AccountType | 'auto'

export interface ParsedTransaction {
  date: string // MM/DD/YYYY
  dateValue: number
  description: string
  amount: number // bank: deposits +, withdrawals −.  card: charges +, payments −.
  section: string | null
  sectionName: string | null
  flags: string[] // 'sign-review' | 'zero-value'
}

export interface SectionCheck {
  section: string
  label: string
  printed: number
  extracted: number
  delta: number
  pass: boolean
}

export interface BalanceCheck {
  beginning: number
  ending: number
  net: number
  expectedNet: number
  delta: number
  pass: boolean
}

export interface StatementValidation {
  sectionChecks: SectionCheck[]
  balanceCheck: BalanceCheck | null
  checksRun: number
  /** true = tied to the cent · false = mismatch · null = nothing to validate */
  passed: boolean | null
  warnings: string[]
}

export interface StatementPeriod {
  start: string | null
  end: string
}

export interface ParsedPdfResult {
  fileName: string
  transactions: ParsedTransaction[]
  accountId: string | null
  accountType: AccountType
  accountTypeDetected: AccountType | null
  statementPeriod: StatementPeriod | null
  validation: StatementValidation
  warnings: string[]
  sha256: string
}

interface TextChunk {
  str: string
  x: number
  y: number
  width: number
}

interface LogicalLine {
  pageNumber: number
  y: number
  chunks: TextChunk[]
  text: string
}

interface HeaderHints {
  hasDebitCredit: boolean
  hasBalance: boolean
  dateX: number | null
  descriptionX: number | null
  debitX: number | null
  creditX: number | null
  amountX: number | null
  balanceX: number | null
}

interface DateContext {
  anchorYear: number
  anchorMonth: number
}

interface SectionState {
  name: string
  compact: string
  sign: number
}

interface PrintedTotal {
  label: string
  compact: string
  amount: number
  section: string | null
  dedupeKey: string
}

interface DocState {
  accountType: AccountType
  currentSection: SectionState | null
  inCreditCardSection: boolean
  inChecksSection: boolean
  sectionsSeen: Set<string>
  printedTotals: PrintedTotal[]
  balances: { beginning: number | null; ending: number | null }
}

interface AmountResult {
  amount: number
  rawToken: string | null
  explicitSign: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AMOUNT_TOKEN_SOURCE = '\\(?-?\\$?\\s*\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})\\)?\\s*(?:CR|DR)?'
const AMOUNT_LOOKUP_REGEX = new RegExp(`^${AMOUNT_TOKEN_SOURCE}$`, 'i')
const AMOUNT_SEARCH_REGEX = new RegExp(AMOUNT_TOKEN_SOURCE, 'i')
const TRAILING_AMOUNTS_REGEX = new RegExp(`(?:\\s*${AMOUNT_TOKEN_SOURCE})+$`, 'i')
const DATE_PATTERNS = [
  /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/,
  /^\d{1,2}[/-]\d{1,2}(?![/-]\d)/,
  /^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}/,
  /^\d{8}/,
  // Wintrust and similar: "Jan06" or "Jan 06" (month abbreviation + day, no year)
  /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2}\b/i
]
const INLINE_DATE_PATTERN = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g
const FOOTER_PATTERNS = [
  /ending balance/i,
  /beginning balance/i,
  /account summary/i,
  /daily balance/i,
  /total (?:debits|credits|fees|withdrawals|deposits|payments|checks)/i,
  /page\s+\d+(?:\s+of\s+\d+)?/i,
  /continued on (?:the )?next page/i,
  /member fdic/i,
  /^§?\s*page\s+\d+\s+of\s+\d+/i,
  /account security you can see/i,
  /security meter level/i,
  /to learn more, visit/i,
  /message and data rates may apply/i,
  /monthly service fee summary/i
]
const NON_TRANSACTION_DESCRIPTION_PATTERNS = [/prfd?\s+rwds\s+for\s+bus-?wire\s+fee\s+waiver/i]

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function parseStatementPdfsWithMeta(
  files: File[],
  options: { accountType?: AccountTypeOption } = {}
): Promise<ParsedPdfResult[]> {
  const results: ParsedPdfResult[] = []
  for (const file of files) {
    const buf = await file.arrayBuffer()
    const sha256 = await computeSha256(buf)
    const result = await parseSinglePdf(new Uint8Array(buf), file.name, options)
    results.push({ ...result, sha256 })
  }
  return results
}

/**
 * Batch-level warnings (METHOD.md §7.4): byte-identical uploads, duplicate
 * statement periods, gaps in the monthly sequence, mixed account numbers,
 * and mixed account types.
 */
export function findBatchWarnings(results: ParsedPdfResult[]): string[] {
  const warnings: string[] = []

  // Byte-identical files
  const byHash = new Map<string, string[]>()
  for (const r of results) {
    const list = byHash.get(r.sha256) ?? []
    list.push(r.fileName)
    byHash.set(r.sha256, list)
  }
  for (const names of byHash.values()) {
    if (names.length > 1) {
      warnings.push(
        `Duplicate upload: ${names.join(' and ')} are byte-identical — the same statement uploaded ${names.length} times. The month it displaced is probably missing.`
      )
    }
  }

  // Duplicate periods + gaps
  const byMonth = new Map<string, string[]>()
  for (const r of results) {
    const end = r.statementPeriod?.end
    if (!end) continue
    const parts = end.split('/')
    if (parts.length !== 3) continue
    const key = `${parts[2]}-${parts[0]}`
    const list = byMonth.get(key) ?? []
    list.push(r.fileName)
    byMonth.set(key, list)
  }
  for (const [month, names] of byMonth.entries()) {
    if (names.length > 1) {
      warnings.push(
        `Statement period ${month} appears in ${names.length} files (${names.join(', ')}) — check for a duplicate download.`
      )
    }
  }
  const months = [...byMonth.keys()].sort()
  for (let i = 1; i < months.length; i++) {
    const [py, pm] = months[i - 1].split('-').map(Number)
    const [cy, cm] = months[i].split('-').map(Number)
    const gap = (cy - py) * 12 + (cm - pm)
    if (gap > 1) {
      const missing: string[] = []
      for (let step = 1; step < gap; step++) {
        const m = pm + step
        const y = py + Math.floor((m - 1) / 12)
        const mm = ((m - 1) % 12) + 1
        missing.push(`${y}-${String(mm).padStart(2, '0')}`)
      }
      warnings.push(`Possible missing statement(s): no file covers ${missing.join(', ')}.`)
    }
  }

  // Mixed accounts
  const accounts = new Map<string, string>()
  for (const r of results) {
    if (!r.accountId) continue
    const last4 = r.accountId.replace(/\D/g, '').slice(-4) || r.accountId
    if (!accounts.has(last4)) accounts.set(last4, r.fileName)
  }
  if (accounts.size > 1) {
    warnings.push(
      `These PDFs appear to be from ${accounts.size} different accounts (…${[...accounts.keys()].join(', …')}). Process one account at a time.`
    )
  }

  // Mixed account types
  const types = new Set(results.map((r) => r.accountType))
  if (types.size > 1) {
    warnings.push('Mix of bank and credit-card statements detected — process them separately so signs and QB transaction types stay correct.')
  }

  return warnings
}

async function computeSha256(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── Single PDF ────────────────────────────────────────────────────────────────

async function parseSinglePdf(
  data: Uint8Array,
  fileName: string,
  options: { accountType?: AccountTypeOption }
): Promise<Omit<ParsedPdfResult, 'sha256'>> {
  const warnings: string[] = []
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise
  const pageCollection: LogicalLine[][] = []
  let totalTextCharacters = 0

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const lines = await extractPageLines(page, p)
    if (!lines.length) continue
    totalTextCharacters += lines.reduce((sum, line) => sum + line.text.length, 0)
    pageCollection.push(lines)
  }

  const allLines = pageCollection.flat()

  if (totalTextCharacters < 40) {
    return {
      fileName,
      transactions: [],
      accountId: null,
      accountType: 'bank',
      accountTypeDetected: null,
      statementPeriod: null,
      validation: emptyValidation(['No extractable text — this PDF appears to be a scan and needs OCR.']),
      warnings: ['No extractable text found. The PDF appears image-based and requires OCR.']
    }
  }

  const dateContext = inferDateContext(allLines)
  const detectedType = detectAccountType(allLines)
  const requestedType = options.accountType && options.accountType !== 'auto' ? options.accountType : null
  const docState = createDocState(requestedType ?? detectedType ?? 'bank')

  const persistedHints = createHeaderHints()
  const parsedRows: ParsedTransaction[] = []

  for (const lines of pageCollection) {
    const pageResult = parsePageTransactions(lines, { dateContext, persistedHints, docState })
    if (pageResult.pageHints.hasBalance) persistedHints.hasBalance = true
    if (pageResult.pageHints.hasDebitCredit) persistedHints.hasDebitCredit = true
    parsedRows.push(...pageResult.rows)
  }

  if (!parsedRows.length) {
    warnings.push('No transactions detected — make sure this is a bank or credit card statement PDF.')
  }

  const validation = buildValidation(parsedRows, docState, fileName)
  warnings.push(...validation.warnings)

  const reviewCount = parsedRows.filter((r) => r.flags.includes('sign-review')).length
  if (reviewCount > 0) {
    warnings.push(`${reviewCount} transaction(s) flagged for sign review.`)
  }

  return {
    fileName,
    transactions: parsedRows,
    accountId: detectAccountId(allLines),
    accountType: docState.accountType,
    accountTypeDetected: detectedType,
    statementPeriod: detectStatementPeriod(allLines),
    validation,
    warnings
  }
}

function emptyValidation(warnings: string[] = []): StatementValidation {
  return { sectionChecks: [], balanceCheck: null, checksRun: 0, passed: null, warnings }
}

// ── Page text extraction ──────────────────────────────────────────────────────

async function extractPageLines(page: pdfjsLib.PDFPageProxy, pageNumber: number): Promise<LogicalLine[]> {
  const content = await page.getTextContent()

  const rawItems: TextChunk[] = (content.items as TextItem[])
    .map((item) => {
      const text = String(item.str || '').trim()
      if (!text) return null
      return {
        str: text,
        x: item.transform[4],
        y: item.transform[5],
        width: Number(item.width) || 0
      }
    })
    .filter((item): item is TextChunk => item !== null)

  if (!rawItems.length) return []

  rawItems.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 1) return b.y - a.y
    return a.x - b.x
  })

  const lineTolerance = 2.4
  const grouped: { y: number; chunks: TextChunk[] }[] = []

  for (const item of rawItems) {
    let target = grouped.find((line) => Math.abs(line.y - item.y) <= lineTolerance)
    if (!target) {
      target = { y: item.y, chunks: [] }
      grouped.push(target)
    }
    target.chunks.push(item)
  }

  grouped.sort((a, b) => b.y - a.y)

  return grouped
    .map((line) => {
      line.chunks.sort((a, b) => a.x - b.x)
      return {
        pageNumber,
        y: line.y,
        chunks: line.chunks,
        text: joinLineChunks(line.chunks)
      }
    })
    .filter((line) => line.text.length > 0)
}

function joinLineChunks(chunks: TextChunk[]): string {
  // Remove barcode-like chunks: 18+ consecutive uppercase letters with no
  // spaces (Wintrust postal barcodes grouped onto transaction lines).
  const filteredChunks = chunks.filter((chunk) => !/^[A-Z]{18,}$/.test(chunk.str))

  let output = ''
  let previousRightEdge: number | null = null

  for (const chunk of filteredChunks) {
    if (!chunk?.str) continue
    if (previousRightEdge !== null && chunk.x - previousRightEdge > 2.5) output += ' '
    if (output && !output.endsWith(' ')) output += ' '
    output += chunk.str
    previousRightEdge = chunk.x + Math.max(chunk.width, chunk.str.length * 2.4)
  }

  return normalizeSpaces(output)
}

// ── Page parsing ──────────────────────────────────────────────────────────────

function createDocState(accountType: AccountType = 'bank'): DocState {
  return {
    accountType,
    currentSection: null,
    inCreditCardSection: false,
    inChecksSection: false,
    sectionsSeen: new Set(),
    printedTotals: [],
    balances: { beginning: null, ending: null }
  }
}

interface ParseContext {
  dateContext: DateContext
  persistedHints: HeaderHints
  docState: DocState
}

function parsePageTransactions(
  lines: LogicalLine[],
  context: ParseContext
): { rows: ParsedTransaction[]; pageHints: HeaderHints } {
  const rows: ParsedTransaction[] = []
  let capture = false
  let pending: ParsedTransaction | null = null
  const docState = context.docState

  let headerHints = createHeaderHints()
  if (context.persistedHints.hasBalance) headerHints.hasBalance = true
  if (context.persistedHints.hasDebitCredit) headerHints.hasDebitCredit = true

  const setSection = (name: string, sign: number): void => {
    if (sign === 0) {
      docState.currentSection = null
      return
    }
    const canonical = normalizeSpaces(name).replace(/\s*[-–—]?\s*continued\s*$/i, '')
    const compact = compactLetters(canonical)
    docState.currentSection = { name: canonical, compact, sign }
    docState.sectionsSeen.add(compact)
  }

  for (const line of lines) {
    const text = normalizeSpaces(line.text)
    const lower = text.toLowerCase()

    // Control totals and balances feed the validation gate.
    recordControlLine(text, lower, docState)

    if (isHeaderLine(lower)) {
      const inferred = inferSectionSign(text, docState.accountType)
      if (inferred !== null) setSection(text, inferred)
      capture = true
      docState.inCreditCardSection = false
      docState.inChecksSection = false
      headerHints = mergeHeaderHints(headerHints, inferHeaderHints(line))
      if (pending) {
        pushPendingRow(rows, pending)
        pending = null
      }
      continue
    }

    if (isFooterLine(lower)) {
      capture = false
      docState.inChecksSection = false
      if (pending) {
        pushPendingRow(rows, pending)
        pending = null
      }
      continue
    }

    if (isCreditCardSectionLabel(lower)) {
      const inferred = inferSectionSign(text, docState.accountType)
      if (inferred !== null) setSection(text, inferred)
      capture = true
      docState.inCreditCardSection = true
      docState.inChecksSection = false
      if (pending) {
        pushPendingRow(rows, pending)
        pending = null
      }
      continue
    }

    if (isChecksSectionLabel(lower)) {
      setSection('Checks', -1)
      capture = true
      docState.inChecksSection = true
      docState.inCreditCardSection = false
      if (pending) {
        pushPendingRow(rows, pending)
        pending = null
      }
      continue
    }

    const dateToken = extractLeadingDate(text)
    const hasAmount = lineHasAmountToken(line)
    const dateCount = countDateTokens(text)
    const canUseFallbackWithoutHeader = !capture && hasAmount && dateCount === 1 && !isLikelySummaryLine(text)

    if (docState.inChecksSection && capture) {
      const checkTxns = parseChecksLine(line, context)
      if (checkTxns.length > 0) {
        if (pending) {
          pushPendingRow(rows, pending)
          pending = null
        }
        rows.push(...checkTxns)
        continue
      }
    }

    if (dateToken && (capture || canUseFallbackWithoutHeader)) {
      if (pending) pushPendingRow(rows, pending)
      pending = parseTransactionLine(line, dateToken, headerHints, context, docState)
      continue
    }

    const isContinuation = pending && shouldAppendDescription(line, capture, headerHints)

    if (isContinuation && pending) {
      pending.description = normalizeSpaces(`${pending.description} ${text}`)
    } else if (!docState.inCreditCardSection) {
      // A section heading is a short title line with no amounts and no date —
      // Account Summary lines carry amounts and must not re-arm the section.
      if (text.length <= 70 && !hasAmount && !dateToken) {
        const inferred = inferSectionSign(text, docState.accountType)
        if (inferred !== null) setSection(text, inferred)
      }
    }
  }

  if (pending) pushPendingRow(rows, pending)

  return {
    rows: rows.filter((row) => row && row.date && row.description && Number.isFinite(row.amount)),
    pageHints: headerHints
  }
}

function parseTransactionLine(
  line: LogicalLine,
  dateToken: { raw: string },
  headerHints: HeaderHints,
  context: ParseContext,
  docState: DocState
): ParsedTransaction | null {
  const normalizedDate = normalizeDate(dateToken.raw, context.dateContext)
  if (!normalizedDate) return null

  const startIndex = line.text.indexOf(dateToken.raw)
  let rawRemainder = line.text.slice(startIndex + dateToken.raw.length).trim()
  rawRemainder = stripRepeatedLeadingDate(rawRemainder, normalizedDate.normalized, context.dateContext)
  if (!rawRemainder) return null

  const amountResult = extractAmount(line, rawRemainder, headerHints)
  if (!Number.isFinite(amountResult.amount)) return null

  let description = rawRemainder.replace(TRAILING_AMOUNTS_REGEX, '').trim()
  if (!description) {
    description = rawRemainder.replace(amountResult.rawToken || '', '').trim()
  }
  description = normalizeSpaces(description.replace(/^\d{1,2}[/-]\d{1,2}\s+/, ''))
  if (!description) return null

  const section = docState.currentSection
  const signResult = resolveAmountSign(amountResult.amount, description, {
    sectionSign: section ? section.sign : 0,
    explicitSign: amountResult.explicitSign,
    inCreditCardSection: docState.inCreditCardSection
  })
  const finalAmount = signResult.amount

  description = sanitizeTransactionDescription(description, finalAmount)
  if (!description) return null

  const flags = [...signResult.flags]
  if (almostZero(finalAmount)) flags.push('zero-value')

  return {
    date: normalizedDate.normalized,
    dateValue: normalizedDate.value,
    description,
    amount: finalAmount,
    section: section ? section.compact : null,
    sectionName: section ? section.name : null,
    flags
  }
}

function pushPendingRow(rows: ParsedTransaction[], row: ParsedTransaction | null): void {
  if (!row) return

  const description = sanitizeTransactionDescription(row.description, row.amount)
  if (!description) return

  // Zero-value rows (fee waivers) are kept but flagged, never silently dropped.
  if (isNonTransactionDescription(description, row.amount)) {
    const flags = [...row.flags]
    if (!flags.includes('zero-value')) flags.push('zero-value')
    rows.push({ ...row, description, flags })
    return
  }

  rows.push({ ...row, description })
}

// ── Amount extraction ─────────────────────────────────────────────────────────

function extractAmount(line: LogicalLine, remainderText: string, headerHints: HeaderHints): AmountResult {
  const hasExplicitDebitCredit = headerHints.debitX !== null || headerHints.creditX !== null
  const byColumns =
    headerHints.hasBalance && !hasExplicitDebitCredit ? null : extractAmountFromColumns(line, headerHints)
  if (byColumns) return byColumns

  const amountTokens = getAmountTokens(remainderText)
  if (!amountTokens.length) return { amount: Number.NaN, rawToken: null, explicitSign: false }

  const parsedTokens = amountTokens.map((rawToken) => ({
    rawToken,
    naturalValue: parseAmountToken(rawToken)
  }))

  if (headerHints.hasDebitCredit) {
    let workingTokens = parsedTokens
    if (headerHints.hasBalance && workingTokens.length > 1) {
      workingTokens = workingTokens.slice(0, -1)
    }

    if (workingTokens.length >= 2) {
      const debitToken = workingTokens[0]
      const creditToken = workingTokens[1]
      const debitValue = parseAmountToken(debitToken.rawToken, 'debit')
      const creditValue = parseAmountToken(creditToken.rawToken, 'credit')
      const debitIsZero = almostZero(debitValue)
      const creditIsZero = almostZero(creditValue)

      if (!debitIsZero && creditIsZero) return { amount: debitValue, rawToken: debitToken.rawToken, explicitSign: true }
      if (debitIsZero && !creditIsZero) return { amount: creditValue, rawToken: creditToken.rawToken, explicitSign: true }
      return { amount: debitValue, rawToken: debitToken.rawToken, explicitSign: true }
    }
  }

  if (headerHints.hasBalance && parsedTokens.length >= 2) {
    const candidate = parsedTokens[parsedTokens.length - 2]
    return {
      amount: candidate.naturalValue,
      rawToken: candidate.rawToken,
      explicitSign: tokenHasExplicitSign(candidate.rawToken)
    }
  }

  const lastToken = parsedTokens[parsedTokens.length - 1]
  return {
    amount: lastToken.naturalValue,
    rawToken: lastToken.rawToken,
    explicitSign: tokenHasExplicitSign(lastToken.rawToken)
  }
}

function extractAmountFromColumns(line: LogicalLine, headerHints: HeaderHints): AmountResult | null {
  if (!line?.chunks?.length) return null

  const amountChunks = line.chunks.filter((chunk) => AMOUNT_LOOKUP_REGEX.test(chunk.str))
  if (!amountChunks.length) return null

  if (headerHints.debitX !== null || headerHints.creditX !== null) {
    const debitMatch = headerHints.debitX !== null ? nearestChunk(amountChunks, headerHints.debitX) : null
    const creditMatch = headerHints.creditX !== null ? nearestChunk(amountChunks, headerHints.creditX) : null

    const threshold = 64
    const debitWithin = debitMatch && Math.abs(debitMatch.x - (headerHints.debitX as number)) <= threshold
    const creditWithin = creditMatch && Math.abs(creditMatch.x - (headerHints.creditX as number)) <= threshold

    if (debitWithin && !creditWithin && debitMatch) {
      return { amount: parseAmountToken(debitMatch.str, 'debit'), rawToken: debitMatch.str, explicitSign: true }
    }
    if (creditWithin && !debitWithin && creditMatch) {
      return { amount: parseAmountToken(creditMatch.str, 'credit'), rawToken: creditMatch.str, explicitSign: true }
    }
    if (debitWithin && creditWithin && debitMatch && creditMatch) {
      const debitDistance = Math.abs(debitMatch.x - (headerHints.debitX as number))
      const creditDistance = Math.abs(creditMatch.x - (headerHints.creditX as number))

      if (debitMatch === creditMatch && Math.abs(debitDistance - creditDistance) < 8) return null

      if (debitDistance < creditDistance) {
        return { amount: parseAmountToken(debitMatch.str, 'debit'), rawToken: debitMatch.str, explicitSign: true }
      }
      if (creditDistance < debitDistance) {
        return { amount: parseAmountToken(creditMatch.str, 'credit'), rawToken: creditMatch.str, explicitSign: true }
      }

      const debitValue = parseAmountToken(debitMatch.str, 'debit')
      const creditValue = parseAmountToken(creditMatch.str, 'credit')

      if (!almostZero(debitValue) && almostZero(creditValue)) {
        return { amount: debitValue, rawToken: debitMatch.str, explicitSign: true }
      }
      if (almostZero(debitValue) && !almostZero(creditValue)) {
        return { amount: creditValue, rawToken: creditMatch.str, explicitSign: true }
      }
      return { amount: debitValue, rawToken: debitMatch.str, explicitSign: true }
    }
  }

  if (headerHints.amountX !== null) {
    const amountMatch = nearestChunk(amountChunks, headerHints.amountX)
    if (amountMatch && Math.abs(amountMatch.x - headerHints.amountX) <= 90) {
      return {
        amount: parseAmountToken(amountMatch.str),
        rawToken: amountMatch.str,
        explicitSign: tokenHasExplicitSign(amountMatch.str)
      }
    }
  }

  return null
}

function nearestChunk(chunks: TextChunk[], targetX: number): TextChunk | null {
  let best: TextChunk | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const chunk of chunks) {
    const distance = Math.abs(chunk.x - targetX)
    if (distance < bestDistance) {
      best = chunk
      bestDistance = distance
    }
  }
  return best
}

function parseAmountToken(rawToken: string | null, forceSign?: 'debit' | 'credit'): number {
  if (!rawToken) return Number.NaN
  const token = String(rawToken).trim()
  if (!token) return Number.NaN

  const hasDr = /DR/i.test(token)
  const hasParentheses = token.includes('(') && token.includes(')')
  const hasMinus = /^\s*-/.test(token)
  const isNegative = hasDr || hasParentheses || hasMinus

  const cleaned = token.replace(/CR|DR/gi, '').replace(/[\s$,()]/g, '')
  const absolute = Number.parseFloat(cleaned)
  if (!Number.isFinite(absolute)) return Number.NaN

  if (forceSign === 'debit') return -Math.abs(absolute)
  if (forceSign === 'credit') return Math.abs(absolute)
  return isNegative ? -Math.abs(absolute) : Math.abs(absolute)
}

// ── Sign resolution (METHOD.md §7.2) ─────────────────────────────────────────

export function resolveAmountSign(
  amount: number,
  description: string,
  {
    sectionSign = 0,
    explicitSign = false,
    inCreditCardSection = false
  }: { sectionSign?: number; explicitSign?: boolean; inCreditCardSection?: boolean } = {}
): { amount: number; flags: string[] } {
  const flags: string[] = []
  if (!Number.isFinite(amount)) return { amount, flags }

  const normalizedDescription = normalizeSpaces(description).toLowerCase()
  const keywordPositive = isStrongPositiveDescription(normalizedDescription)
  const keywordNegative = isStrongNegativeDescription(normalizedDescription)
  const keywordSign = keywordPositive === keywordNegative ? 0 : keywordPositive ? 1 : -1

  // 1. BofA credit-card sections: section label is authoritative.
  if (inCreditCardSection && sectionSign) {
    return { amount: sectionSign < 0 ? -Math.abs(amount) : Math.abs(amount), flags }
  }

  // 2. Explicit token sign is ground truth.
  if (explicitSign) {
    if (keywordSign !== 0 && Math.sign(amount) !== 0 && keywordSign !== Math.sign(amount)) {
      flags.push('sign-review')
    }
    return { amount, flags }
  }

  // 3. Section structure wins over description prose.
  if (sectionSign) {
    if (keywordSign !== 0 && keywordSign !== sectionSign) flags.push('sign-review')
    return { amount: sectionSign < 0 ? -Math.abs(amount) : Math.abs(amount), flags }
  }

  // 4. No structural evidence — keywords are the last resort.
  if (keywordPositive && keywordNegative) {
    flags.push('sign-review')
    return { amount, flags }
  }
  if (keywordSign !== 0) {
    return { amount: keywordSign < 0 ? -Math.abs(amount) : Math.abs(amount), flags }
  }
  return { amount, flags }
}

function isStrongPositiveDescription(description: string): boolean {
  return /(return|reverse|reversal|\brev\b|deposit|credit|cr\s+edit|cash\s+rewards|payment from|transfer from|wire from|online transfer from|zelle from|wire in|interest)/i.test(
    description
  )
}

function isStrongNegativeDescription(description: string): boolean {
  return /(payment to|transfer to|online transfer to|zelle to|wire to|trn out|withdrawal|debit|fee|purchase|wire out|service charge|overdraft|irs usataxpymt|taxpymt|harland clarke|^\d{3,6}\s+check\b|\bcheck\b)/i.test(
    description
  )
}

// ── Section sign inference (METHOD.md §7.3) ──────────────────────────────────

export function inferSectionSign(text: string, accountType: AccountType = 'bank'): number | null {
  const normalized = normalizeSpaces(text).toLowerCase()
  if (!normalized || extractLeadingDate(normalized)) return null

  if (/^purchases and other charges$/i.test(normalized)) return 1
  if (/^payments and other credits$/i.test(normalized)) return -1
  if (/^cash advances$/i.test(normalized)) return 1

  if (accountType === 'credit_card') {
    if (/payments? and (?:other )?credits?/i.test(normalized)) return -1
    if (/(new charges|purchases|cash advances)/i.test(normalized)) return 1
    if (/^fees\b|fees for this period|interest charged/i.test(normalized)) return 1
  }

  const hasDepositKeyword = /(deposit|credit|addition|interest payment|interest earned)/i.test(normalized)
  const hasDebitKeyword = /(withdrawal|debit|fee|service charge|payment to|wire out)/i.test(normalized)

  if (hasDepositKeyword && hasDebitKeyword) return 0

  if (
    /(atm\s*&\s*debit\s*card\s*withdrawals|electronic withdrawals|other withdrawals, debits and service charges|fees(?: section)?|service charges)/i.test(
      normalized
    )
  ) {
    return -1
  }

  if (/(deposits and additions|deposits, credits and interest|deposits and credits)/i.test(normalized)) return 1

  if (!hasDepositKeyword && !hasDebitKeyword) return null
  return hasDebitKeyword ? -1 : 1
}

// ── Account type detection ────────────────────────────────────────────────────

export function detectAccountType(lines: { text: string }[]): AccountType | null {
  let creditCardScore = 0
  let bankScore = 0

  for (const line of lines || []) {
    const lower = normalizeSpaces(line.text || '').toLowerCase()
    if (!lower) continue
    if (
      /(minimum payment due|payment due date|credit limit|cash advance|purchases and other charges|total new charges|american\s?express|closing date|interest charged|apr\b)/.test(
        lower
      )
    ) {
      creditCardScore += 1
    }
    if (
      /(deposits and other credits|withdrawals and other debits|total checks|service fees|checking account|savings account|business checking)/.test(lower)
    ) {
      bankScore += 1
    }
  }

  if (creditCardScore >= 2 && creditCardScore > bankScore) return 'credit_card'
  if (bankScore > 0) return 'bank'
  return null
}

// ── Validation gate (METHOD.md §7.1) ─────────────────────────────────────────

const TOTAL_LABEL_RELEVANT = /(deposit|withdrawal|check|fee|charge|credit|payment|interest|advance|debit)/i
const TOTAL_LABEL_IGNORED = /(\b(?:in|for)\s+20\d{2}\b|year[\s-]?to[\s-]?date|\bytd\b)/i

export function recordControlLine(text: string, lower: string, docState: DocState): void {
  if (!docState || extractLeadingDate(text)) return

  const balanceMatch = lower.match(/^(beginning|ending|previous|new) balance\b/)
  if (balanceMatch && !/daily/.test(lower)) {
    const tokens = getAmountTokens(text)
    if (tokens.length) {
      const key = balanceMatch[1] === 'beginning' || balanceMatch[1] === 'previous' ? 'beginning' : 'ending'
      const value = parseAmountToken(tokens[0])
      if (docState.balances[key] === null && Number.isFinite(value)) {
        docState.balances[key] = value
      }
    }
    return
  }

  if (!/^total\s+/i.test(text) || text.length > 90) return

  const tokens = getAmountTokens(text)
  if (!tokens.length) return

  const label = normalizeSpaces(text.replace(/^total\s+/i, '').replace(TRAILING_AMOUNTS_REGEX, ''))
  if (!label || !TOTAL_LABEL_RELEVANT.test(label) || TOTAL_LABEL_IGNORED.test(label)) return

  const amount = parseAmountToken(tokens[tokens.length - 1])
  if (!Number.isFinite(amount)) return

  const compact = compactLetters(label.replace(/for this period/i, ''))
  const dedupeKey = `${compact}|${amount.toFixed(2)}`
  if (docState.printedTotals.some((entry) => entry.dedupeKey === dedupeKey)) return

  docState.printedTotals.push({
    label: `Total ${label}`,
    compact,
    amount,
    section: docState.currentSection ? docState.currentSection.compact : null,
    dedupeKey
  })
}

export function buildValidation(
  rows: Pick<ParsedTransaction, 'section' | 'amount'>[],
  docState: DocState,
  fileName?: string
): StatementValidation {
  const warnings: string[] = []
  const sectionChecks: SectionCheck[] = []
  const sums = new Map<string, number>()

  for (const row of rows || []) {
    if (!row?.section) continue
    sums.set(row.section, (sums.get(row.section) ?? 0) + row.amount)
  }

  for (const printed of docState.printedTotals) {
    let key: string | null = null
    if (printed.section && (sums.has(printed.section) || docState.sectionsSeen.has(printed.section))) {
      key = printed.section
    } else {
      for (const seen of docState.sectionsSeen) {
        if (seen === printed.compact || seen.includes(printed.compact) || printed.compact.includes(seen)) {
          key = seen
          break
        }
      }
    }
    if (!key) continue

    const extracted = sums.get(key) ?? 0
    const delta = Math.abs(Math.abs(extracted) - Math.abs(printed.amount))
    const pass = delta <= 0.011
    sectionChecks.push({
      section: key,
      label: printed.label,
      printed: printed.amount,
      extracted: roundCents(extracted),
      delta: roundCents(delta),
      pass
    })
    if (!pass) {
      warnings.push(
        `Validation FAILED — ${printed.label}: extracted ${formatMoney(extracted)} vs printed ${formatMoney(printed.amount)} (off by ${formatMoney(delta)}).`
      )
    }
  }

  let balanceCheck: BalanceCheck | null = null
  const { beginning, ending } = docState.balances
  if (beginning !== null && ending !== null && Number.isFinite(beginning) && Number.isFinite(ending)) {
    const net = (rows || []).reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0)
    const expectedNet = ending - beginning
    const delta = Math.abs(net - expectedNet)
    const pass = delta <= 0.011
    balanceCheck = {
      beginning: roundCents(beginning),
      ending: roundCents(ending),
      net: roundCents(net),
      expectedNet: roundCents(expectedNet),
      delta: roundCents(delta),
      pass
    }
    if (!pass) {
      warnings.push(
        `Validation FAILED — balance chain: beginning ${formatMoney(beginning)} + extracted net ${formatMoney(net)} does not reach ending ${formatMoney(ending)} (off by ${formatMoney(delta)}).`
      )
    }
  }

  const checksRun = sectionChecks.length + (balanceCheck ? 1 : 0)
  const passed = checksRun === 0 ? null : sectionChecks.every((c) => c.pass) && (!balanceCheck || balanceCheck.pass)

  if (checksRun === 0) {
    warnings.push(
      `No printed control totals recognized in ${fileName || 'statement'} — extraction could not be validated against the statement's own arithmetic.`
    )
  }

  return { sectionChecks, balanceCheck, checksRun, passed, warnings }
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

function formatMoney(value: number): string {
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${value < 0 ? '-' : ''}$${abs}`
}

// ── Section / line classification helpers ─────────────────────────────────────

function isHeaderLine(lowerText: string): boolean {
  if (!lowerText || lowerText.length > 150) return false

  const compact = compactLetters(lowerText)
  const hasDate = /\bdate\b/.test(lowerText) || compact.includes('date') || compact.includes('fecha')
  const hasDescription =
    /(description|memo|transaction|details|narrative|activity)/.test(lowerText) ||
    compact.includes('description') ||
    compact.includes('transactionhistory') ||
    compact.includes('descripcion')
  const hasAmount =
    /(amount|debit|credit|withdrawal|deposit|balance|subtraction|addition)/.test(lowerText) ||
    ['amount', 'debit', 'credit', 'balance', 'subtraction', 'addition', 'retiros', 'dbitos', 'debitos', 'depsitos', 'depositos', 'crditos', 'creditos'].some(
      (kw) => compact.includes(kw)
    )

  if (hasDate && hasDescription && hasAmount) return true

  // Spanish Wells Fargo statements split column headers across two rows.
  const hasSpanishDebit = compact.includes('retiros') || compact.includes('dbitos') || compact.includes('debitos')
  const hasSpanishCreditOrBalance =
    compact.includes('depsitos') ||
    compact.includes('depositos') ||
    compact.includes('crditos') ||
    compact.includes('creditos') ||
    compact.includes('saldo')

  return hasSpanishDebit && hasSpanishCreditOrBalance
}

function isFooterLine(lowerText: string): boolean {
  return FOOTER_PATTERNS.some((pattern) => pattern.test(lowerText))
}

function isCreditCardSectionLabel(lowerText: string): boolean {
  const compact = compactLetters(lowerText)
  return compact === 'purchasesandothercharges' || compact === 'paymentsandothercredits' || compact === 'cashadvances'
}

function isChecksSectionLabel(lowerText: string): boolean {
  return compactLetters(lowerText) === 'checks'
}

function parseChecksLine(line: LogicalLine, context: ParseContext): ParsedTransaction[] {
  const text = normalizeSpaces(line.text)
  const CHECK_RE = /(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\s+(\d{4,6})\*?\s+-?([\d,]+(?:\.\d{2})?)/g
  const results: ParsedTransaction[] = []
  let match: RegExpExecArray | null

  while ((match = CHECK_RE.exec(text)) !== null) {
    const [, rawDate, checkNum, rawAmt] = match
    const normalizedDate = normalizeDate(rawDate, context.dateContext)
    if (!normalizedDate) continue
    const amount = parseFloat(rawAmt.replace(/,/g, ''))
    if (!Number.isFinite(amount) || amount === 0) continue
    results.push({
      date: normalizedDate.normalized,
      dateValue: normalizedDate.value,
      description: checkNum, // cleaned to "Check NNNN" by transactionCleaner
      amount: -Math.abs(amount),
      section: 'checks',
      sectionName: 'Checks',
      flags: []
    })
  }

  return results
}

function shouldAppendDescription(line: LogicalLine, capture: boolean, headerHints: HeaderHints): boolean {
  if (!capture) return false

  const text = normalizeSpaces(line.text)
  if (!text) return false
  if (extractLeadingDate(text)) return false
  if (isHeaderLine(text.toLowerCase()) || isFooterLine(text.toLowerCase())) return false
  if (lineHasAmountToken(line)) return false
  if (isLikelyNoiseLine(text)) return false

  if (headerHints.descriptionX !== null) {
    const firstX = line.chunks?.[0]?.x ?? 0
    if (firstX < headerHints.descriptionX - 15) return false
  }

  if (/^(?:total|subtotal|balance|page\s+\d+)/i.test(text)) return false
  return true
}

// ── Header hints ──────────────────────────────────────────────────────────────

function createHeaderHints(): HeaderHints {
  return {
    hasDebitCredit: false,
    hasBalance: false,
    dateX: null,
    descriptionX: null,
    debitX: null,
    creditX: null,
    amountX: null,
    balanceX: null
  }
}

function inferHeaderHints(line: LogicalLine): HeaderHints {
  const hints = createHeaderHints()
  const lower = normalizeSpaces(line.text.toLowerCase())
  const compact = compactLetters(lower)

  hints.hasDebitCredit = /(debit|withdrawal)/.test(lower) && /(credit|deposit)/.test(lower)
  if (!hints.hasDebitCredit && compact.includes('creditsdebits')) hints.hasDebitCredit = true
  if (
    !hints.hasDebitCredit &&
    (compact.includes('retiros') || compact.includes('dbitos') || compact.includes('debitos')) &&
    (compact.includes('depsitos') || compact.includes('crditos') || compact.includes('depositos') || compact.includes('creditos'))
  ) {
    hints.hasDebitCredit = true
  }

  hints.hasBalance = /\bbalance\b/.test(lower) || compact.includes('balance') || compact.includes('saldo')

  for (const chunk of line.chunks || []) {
    const text = normalizeSpaces(chunk.str.toLowerCase())
    const textCompact = compactLetters(text)

    if (hints.dateX === null && (/\bdate\b/.test(text) || textCompact.includes('date') || textCompact.includes('fecha'))) {
      hints.dateX = chunk.x
    }
    if (
      hints.descriptionX === null &&
      (/(description|memo|transaction|details|narrative|activity|descripci)/.test(text) || textCompact.includes('description'))
    ) {
      hints.descriptionX = chunk.x
    }
    if (
      hints.debitX === null &&
      (/(debit|withdrawal)/.test(text) ||
        textCompact.includes('debit') ||
        textCompact.includes('retiros') ||
        textCompact.includes('dbitos') ||
        textCompact.includes('debitos'))
    ) {
      hints.debitX = chunk.x
    }
    if (
      hints.creditX === null &&
      (/(credit|deposit)/.test(text) ||
        textCompact.includes('credit') ||
        textCompact.includes('depsitos') ||
        textCompact.includes('crditos') ||
        textCompact.includes('depositos') ||
        textCompact.includes('creditos'))
    ) {
      hints.creditX = chunk.x
    }
    if (hints.amountX === null && (/\bamount\b/.test(text) || textCompact.includes('amount'))) {
      hints.amountX = chunk.x
    }
    if (hints.balanceX === null && (/\bbalance\b/.test(text) || textCompact.includes('balance') || textCompact.includes('saldo'))) {
      hints.balanceX = chunk.x
    }
  }

  return hints
}

function mergeHeaderHints(base: HeaderHints, incoming: HeaderHints): HeaderHints {
  return {
    hasDebitCredit: base.hasDebitCredit || incoming.hasDebitCredit,
    hasBalance: base.hasBalance || incoming.hasBalance,
    dateX: base.dateX ?? incoming.dateX,
    descriptionX: base.descriptionX ?? incoming.descriptionX,
    debitX: base.debitX ?? incoming.debitX,
    creditX: base.creditX ?? incoming.creditX,
    amountX: base.amountX ?? incoming.amountX,
    balanceX: base.balanceX ?? incoming.balanceX
  }
}

// ── Dates ─────────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function buildDate(month: number, day: number, year: number): { normalized: string; value: number } | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null
  const d = new Date(year, month - 1, day)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return { normalized: `${pad2(month)}/${pad2(day)}/${year}`, value: d.getTime() }
}

function expandTwoDigitYear(yy: number): number {
  return yy < 70 ? 2000 + yy : 1900 + yy
}

function normalizeDate(dateText: string, dateContext?: DateContext): { normalized: string; value: number } | null {
  const raw = String(dateText || '').trim()
  if (!raw) return null

  // "MonDD" / "Mon DD" (no year) — Wintrust style
  const shortMonthDayMatch = /^([A-Za-z]{3})\s*(\d{1,2})$/.exec(raw)
  if (shortMonthDayMatch) {
    const monthNum = MONTH_MAP[shortMonthDayMatch[1].toLowerCase()]
    if (!monthNum) return null
    const year = resolveYearForMonth(monthNum, dateContext)
    return buildDate(monthNum, Number(shortMonthDayMatch[2]), year)
  }

  // "M/D" (no year)
  const noYear = /^(\d{1,2})[/-](\d{1,2})$/.exec(raw)
  if (noYear) {
    const month = Number(noYear[1])
    const year = resolveYearForMonth(month, dateContext)
    return buildDate(month, Number(noYear[2]), year)
  }

  // "M/D/YY" or "M/D/YYYY" (also with dashes)
  const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(raw)
  if (numeric) {
    let year = Number(numeric[3])
    if (numeric[3].length === 2) year = expandTwoDigitYear(year)
    else if (numeric[3].length === 3) return null
    return buildDate(Number(numeric[1]), Number(numeric[2]), year)
  }

  // "Jan 15, 2024" / "January 15, 2024"
  const named = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$/.exec(raw)
  if (named) {
    const monthNum = MONTH_MAP[named[1].slice(0, 3).toLowerCase()]
    if (!monthNum) return null
    return buildDate(monthNum, Number(named[2]), Number(named[3]))
  }

  // "YYYYMMDD"
  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
  if (compactDate) {
    return buildDate(Number(compactDate[2]), Number(compactDate[3]), Number(compactDate[1]))
  }

  return null
}

function resolveYearForMonth(month: number, dateContext?: DateContext): number {
  let year = dateContext?.anchorYear ?? new Date().getFullYear()
  if (dateContext?.anchorMonth) {
    if (month - dateContext.anchorMonth > 6) year -= 1
    else if (dateContext.anchorMonth - month > 6) year += 1
  }
  return year
}

function inferDateContext(lines: LogicalLine[]): DateContext {
  const hints: number[] = []

  for (const line of lines || []) {
    const text = normalizeSpaces(line.text || '')
    for (const match of text.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g) || []) {
      const normalized = normalizeDate(match)
      if (normalized) hints.push(normalized.value)
    }
    for (const match of text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+\d{1,2},\s+\d{4}\b/g) || []) {
      const normalized = normalizeDate(match.replace(/^([A-Za-z]{3})[A-Za-z]*/, '$1'))
      if (normalized) hints.push(normalized.value)
    }
  }

  if (!hints.length) {
    const now = new Date()
    return { anchorYear: now.getFullYear(), anchorMonth: now.getMonth() + 1 }
  }

  const anchor = new Date(Math.max(...hints))
  return { anchorYear: anchor.getFullYear(), anchorMonth: anchor.getMonth() + 1 }
}

function extractLeadingDate(lineText: string): { raw: string } | null {
  const trimmed = String(lineText || '').trimStart()
  for (const pattern of DATE_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match) return { raw: match[0] }
  }
  return null
}

function stripRepeatedLeadingDate(text: string, normalizedDate: string, dateContext?: DateContext): string {
  const remainder = normalizeSpaces(text)
  const leadingDate = extractLeadingDate(remainder)
  if (!leadingDate) return remainder

  const normalizedLeading = normalizeDate(leadingDate.raw, dateContext)
  if (!normalizedLeading) return remainder
  if (normalizedLeading.normalized !== normalizedDate) return remainder

  return normalizeSpaces(remainder.slice(leadingDate.raw.length))
}

function countDateTokens(text: string): number {
  return (String(text || '').match(INLINE_DATE_PATTERN) || []).length
}

// ── Metadata ──────────────────────────────────────────────────────────────────

function detectAccountId(lines: LogicalLine[]): string | null {
  const counts = new Map<string, number>()

  const bump = (raw: string): void => {
    const normalized = normalizeAccountToken(raw)
    if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }

  const explicitRe = /(?:account|acct)\s*(?:number|no\.?|#)?\s*[:\-]?\s*([Xx*\d\-]{4,})/gi
  const typedRe = /\b(?:checking|savings|business\s+checking|money\s*market)\b.*?([Xx*\d\-]{4,})/gi

  for (const line of lines) {
    for (const m of line.text.matchAll(explicitRe)) bump(m[1])
    for (const m of line.text.matchAll(typedRe)) bump(m[1])
  }

  if (counts.size === 0) return null
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

function normalizeAccountToken(raw: string): string | null {
  const compact = String(raw ?? '').replace(/[^A-Za-z0-9*]/g, '')
  if (compact.length < 4) return null
  if (!/\d/.test(compact) && !compact.includes('*')) return null
  return compact.toLowerCase()
}

function detectStatementPeriod(lines: LogicalLine[]): StatementPeriod | null {
  const periodPatterns: RegExp[] = [
    /\bstatement\s+period\s*[:\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*(?:to|-|through|thru)\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /\bfrom\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*(?:to|-|through|thru)\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /\b([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\s+(?:to|through|thru)\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/
  ]
  const closingDatePattern = /\bclosing\s+date\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i

  for (const line of lines) {
    const text = normalizeSpaces(line.text)
    for (const pattern of periodPatterns) {
      const match = text.match(pattern)
      if (!match) continue
      const start = normalizeDate(shortenMonthName(match[1]))
      const end = normalizeDate(shortenMonthName(match[2]))
      if (start && end) return { start: start.normalized, end: end.normalized }
    }
    const closing = text.match(closingDatePattern)
    if (closing) {
      const end = normalizeDate(closing[1])
      if (end) return { start: null, end: end.normalized }
    }
  }

  return null
}

function shortenMonthName(value: string): string {
  return String(value || '').replace(/^([A-Za-z]{3})[A-Za-z]*/, '$1')
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function normalizeSpaces(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function getAmountTokens(text: string): string[] {
  const regex = new RegExp(AMOUNT_TOKEN_SOURCE, 'gi')
  return Array.from(String(text || '').matchAll(regex)).map((match) => match[0])
}

function tokenHasExplicitSign(rawToken: string | null): boolean {
  const token = String(rawToken || '')
  return /\b(?:CR|DR)\b/i.test(token) || token.includes('(') || token.includes(')') || /^\s*-/.test(token)
}

function lineHasAmountToken(line: LogicalLine): boolean {
  return AMOUNT_SEARCH_REGEX.test(line.text)
}

function isLikelySummaryLine(text: string): boolean {
  return /(daily balance|ending daily|balance summary|beginning balance|new balance|account summary)/i.test(text)
}

function isNonTransactionDescription(description: string, amount: number): boolean {
  if (!almostZero(amount)) return false
  const normalizedDescription = normalizeSpaces(description)
  return NON_TRANSACTION_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(normalizedDescription))
}

function isLikelyNoiseLine(text: string): boolean {
  const normalized = normalizeSpaces(text).toLowerCase()
  if (!normalized) return true
  if (/^(\*start\*|\*end\*)/.test(normalized)) return true
  if (/^(?:c\s*o\s*n\s*t\s*i\s*n\s*u\s*e\s*d|continued)$/i.test(normalized)) return true
  return /(account security you can see|security meter level|message and data rates may apply)/i.test(normalized)
}

function compactLetters(text: string): string {
  return String(text || '').toLowerCase().replace(/[^a-z]/g, '')
}

function sanitizeTransactionDescription(description: string, amount: number): string {
  let cleaned = normalizeSpaces(description)
  if (!cleaned) return ''

  cleaned = cleaned
    .replace(/\s+CHECKING ACCOUNT MONTHLY SUMMARY.*$/i, '')
    .replace(/\s+SAVINGS ACCOUNT MONTHLY SUMMARY.*$/i, '')
    .replace(/\b(ACCTVERIFY\s+[A-Z0-9]+)\s+\1\b/i, '$1')
    .replace(/\s+\.\s*$/, '')
    .replace(/\bR\s+on\b/g, ' on')
    .replace(/\s+R$/g, '')
    .trim()

  cleaned = removeTrailingRepeatedAmount(cleaned, amount)
  return normalizeSpaces(cleaned)
}

function removeTrailingRepeatedAmount(description: string, amount: number): string {
  if (!Number.isFinite(amount)) return description

  const absAmount = Math.abs(amount)
  const moneyPattern = /(\$?\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s*$/
  const trailingMatch = description.match(moneyPattern)
  if (trailingMatch) {
    const trailingValue = parseAmountToken(trailingMatch[1])
    if (Number.isFinite(trailingValue) && Math.abs(Math.abs(trailingValue) - absAmount) <= 0.005) {
      return description.slice(0, trailingMatch.index).trim()
    }
  }

  const amountWithArtifactPattern = /(\$?\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s+\d{12,}\s*$/
  const artifactMatch = description.match(amountWithArtifactPattern)
  if (artifactMatch) {
    const trailingValue = parseAmountToken(artifactMatch[1])
    if (Number.isFinite(trailingValue) && Math.abs(Math.abs(trailingValue) - absAmount) <= 0.005) {
      return description.slice(0, artifactMatch.index).trim()
    }
  }

  return description
}

function almostZero(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) < 0.00001
}
