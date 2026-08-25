/**
 * Phantom Pulse's binding of the shared statement parser.
 *
 * The parsing logic lives in @accuracy/statement-parser so that Pulse and
 * Phantom Ledger read statements identically. The two products stay separate —
 * Pulse connects to QuickBooks, Ledger is online and PDF-only — but a parser
 * fix lands once instead of being ported by hand between a JavaScript and a
 * TypeScript copy that had already drifted apart in both directions.
 *
 * The only platform-specific part is which pdfjs build opens the file. Pulse
 * parses in the renderer (Chromium), so it supplies the ESM legacy build and
 * its worker; Ledger parses in Node and supplies the CommonJS one.
 */

// The LEGACY build is required: the modern pdfjs 5.x build uses JS APIs
// Electron's renderer does not expose.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

import {
  createStatementParser,
  findBatchWarnings as findBatchWarningsShared
} from '@accuracy/statement-parser'
import { ocrDocumentPages } from './statementOcr'
import type {
  ParsedPdfResult as SharedResult,
  AccountType,
  AccountTypeOption,
  ParsedTransaction,
  SectionCheck,
  BalanceCheck,
  StatementValidation,
  StatementPeriod
} from '@accuracy/statement-parser'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export type {
  AccountType,
  AccountTypeOption,
  ParsedTransaction,
  SectionCheck,
  BalanceCheck,
  StatementValidation,
  StatementPeriod
}

/**
 * Pulse's flattened view of a parsed statement, plus the content hash it uses
 * to spot the same file uploaded twice. The UI reads these fields directly.
 */
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

const parser = createStatementParser({
  pdfjs: pdfjsLib,
  documentParams: { isEvalSupported: false }
})

export const PdfParseError = parser.PdfParseError

async function computeSha256(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function flatten(result: SharedResult, fileName: string, sha256: string): ParsedPdfResult {
  return {
    fileName,
    transactions: result.transactions,
    accountId: result.metadata.primaryAccount,
    accountType: result.metadata.accountType,
    accountTypeDetected: result.metadata.accountTypeDetected,
    statementPeriod: result.metadata.statementPeriod,
    validation: result.validation,
    warnings: result.warnings,
    sha256
  }
}

/**
 * Read a statement that has no text layer at all.
 *
 * Citizens ships scans: zero text items, nothing to parse. Rendering each page
 * and recognising it produces the same { str, x, y, width } items pdfjs would
 * have, so the result goes through the shared parser's own sectioning, sign and
 * validation logic. An OCR'd statement still has to reconcile against its own
 * printed totals — it is reported as failing, never quietly trusted.
 */
async function parseScannedPdf(
  data: Uint8Array,
  fileName: string,
  options: { accountType?: AccountTypeOption },
  onProgress?: OcrProgress
): Promise<SharedResult> {
  const document = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise
  try {
    const pages = await ocrDocumentPages(document, (page, pageCount) =>
      onProgress?.({ fileName, page, pageCount })
    )
    const result = parser.extractTransactionsFromItems(pages, fileName, {
      ...options,
      // OCR estimates a baseline per word, so a row of text drifts a point or
      // two where a PDF text layer would not. Rows sit 11pt or more apart.
      lineTolerance: 4.5
    })
    return {
      ...result,
      warnings: [
        `${fileName} has no text layer and was read by OCR — check the figures against the statement.`,
        ...result.warnings
      ]
    }
  } finally {
    await document.destroy()
  }
}

export interface OcrProgressEvent {
  fileName: string
  page: number
  pageCount: number
}

export type OcrProgress = (event: OcrProgressEvent) => void

export async function parseStatementPdfsWithMeta(
  files: File[],
  options: { accountType?: AccountTypeOption; onOcrProgress?: OcrProgress } = {}
): Promise<ParsedPdfResult[]> {
  const { onOcrProgress, ...parseOptions } = options
  const results: ParsedPdfResult[] = []
  for (const file of files) {
    const buf = await file.arrayBuffer()
    const sha256 = await computeSha256(buf)
    const data = new Uint8Array(buf)

    let result: SharedResult
    try {
      result = await parser.extractTransactionsFromPdf(data, file.name, parseOptions)
    } catch (error) {
      // The parser refuses a PDF it found no text in rather than returning an
      // empty statement; that refusal is what tells us to fall back to OCR.
      if ((error as { code?: string })?.code !== 'IMAGE_BASED') throw error
      result = await parseScannedPdf(data, file.name, parseOptions, onOcrProgress)
    }

    results.push(flatten(result, file.name, sha256))
  }
  return results
}

/**
 * Batch-level checks (METHOD.md §7.4): byte-identical uploads, duplicate
 * statement periods, gaps in the monthly sequence, mixed account numbers and
 * mixed account types.
 */
export function findBatchWarnings(results: ParsedPdfResult[]): string[] {
  return findBatchWarningsShared(results)
}
