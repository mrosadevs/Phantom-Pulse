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

export async function parseStatementPdfsWithMeta(
  files: File[],
  options: { accountType?: AccountTypeOption } = {}
): Promise<ParsedPdfResult[]> {
  const results: ParsedPdfResult[] = []
  for (const file of files) {
    const buf = await file.arrayBuffer()
    const sha256 = await computeSha256(buf)
    const result = await parser.extractTransactionsFromPdf(new Uint8Array(buf), file.name, options)
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
