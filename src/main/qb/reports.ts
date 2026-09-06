/**
 * QuickBooks Desktop report queries.
 *
 * QuickBooks owns the arithmetic.  Every number in a P&L — what nets into
 * "Total Income", how a sub-account rolls into its parent, which basis the
 * period was computed on — comes out of the report engine, so this module
 * asks QuickBooks for the finished report rather than summing transactions
 * ourselves.  Anything we recomputed here would eventually disagree with the
 * figure the client sees in QuickBooks, and the client is always right.
 *
 * Two things make report responses awkward compared with the *Query responses
 * the rest of the app parses:
 *
 *  1. Rows are POSITIONAL, not named.  A row carries a label and an array of
 *     <ColData colID="n">; what column 3 means is declared once, up top, in
 *     <ColDesc>.  So the header has to be parsed before the body means
 *     anything.
 *
 *  2. Hierarchy is expressed by NESTING, not by an indent field.  A sub-account
 *     under an account sits inside a <ReportSubReport> wrapper.  Losing that
 *     nesting turns a Balance Sheet into a flat list where sub-accounts and
 *     their parents look like peers and every subtotal appears to double-count.
 *
 * Both are handled below: columns first, then a positional scan that tracks
 * how deep each row sits.
 *
 * Report request schemas differ more between types than the transaction
 * queries do — aging reports take elements the summary reports reject, and
 * vice versa.  Rather than hard-code one body per type and lose a whole report
 * to a schema error, each spec carries ordered body variants and we fall back
 * exactly the way entityHistory.ts does, reporting which variant won.
 */

export type QBSender = (xml: string) => Promise<string>

const QBXML_VERSION = '13.0'

// ── Report catalogue ─────────────────────────────────────────────────────────

/** Which qbXML request wraps this report, and what the type element is called. */
type ReportFamily = 'summary' | 'detail' | 'aging' | 'job'

const FAMILY_REQUEST: Record<ReportFamily, { rq: string; typeEl: string }> = {
  summary: { rq: 'GeneralSummaryReportQueryRq', typeEl: 'GeneralSummaryReportType' },
  detail: { rq: 'GeneralDetailReportQueryRq', typeEl: 'GeneralDetailReportType' },
  aging: { rq: 'AgingReportQueryRq', typeEl: 'AgingReportType' },
  job: { rq: 'JobReportQueryRq', typeEl: 'JobReportType' }
}

export interface ReportSpec {
  /** Stable id used by the renderer and stored in history. */
  id: string
  label: string
  /** Grouping for the report picker. */
  group: 'Financial statements' | 'Receivables & payables' | 'Sales & income' | 'Expenses' | 'Jobs'
  family: ReportFamily
  /** The value of the family's type element, e.g. ProfitAndLossStandard. */
  reportType: string
  /** One-line explanation shown under the report name. */
  blurb: string
  /** False for reports that are always "as of" a single date (balance sheets). */
  ranged: boolean
}

export const REPORTS: ReportSpec[] = [
  // ── Financial statements ──
  {
    id: 'pnl',
    label: 'Profit & Loss',
    group: 'Financial statements',
    family: 'summary',
    reportType: 'ProfitAndLossStandard',
    blurb: 'Income and expenses for the period.',
    ranged: true
  },
  {
    id: 'pnl-prev-year',
    label: 'Profit & Loss vs. Last Year',
    group: 'Financial statements',
    family: 'summary',
    reportType: 'ProfitAndLossPrevYearComp',
    blurb: 'This period beside the same period last year.',
    ranged: true
  },
  {
    id: 'balance-sheet',
    label: 'Balance Sheet',
    group: 'Financial statements',
    family: 'summary',
    reportType: 'BalanceSheetStandard',
    blurb: 'Assets, liabilities and equity as of the end date.',
    ranged: false
  },
  {
    id: 'trial-balance',
    label: 'Trial Balance',
    group: 'Financial statements',
    family: 'summary',
    reportType: 'TrialBalance',
    blurb: 'Every account with its debit and credit balance.',
    ranged: false
  },
  {
    id: 'cash-flows',
    label: 'Statement of Cash Flows',
    group: 'Financial statements',
    family: 'summary',
    reportType: 'StatementOfCashFlows',
    blurb: 'Where cash came from and where it went.',
    ranged: true
  },
  {
    id: 'general-ledger',
    label: 'General Ledger',
    group: 'Financial statements',
    family: 'detail',
    reportType: 'GeneralLedger',
    blurb: 'Every transaction, grouped by account.',
    ranged: true
  },

  // ── Receivables & payables ──
  {
    id: 'ar-aging-summary',
    label: 'A/R Aging Summary',
    group: 'Receivables & payables',
    family: 'aging',
    reportType: 'ARAgingSummary',
    blurb: 'What customers owe, bucketed by how late it is.',
    ranged: false
  },
  {
    id: 'ar-aging-detail',
    label: 'A/R Aging Detail',
    group: 'Receivables & payables',
    family: 'aging',
    reportType: 'ARAgingDetail',
    blurb: 'Each open invoice behind the aging buckets.',
    ranged: false
  },
  {
    id: 'ap-aging-summary',
    label: 'A/P Aging Summary',
    group: 'Receivables & payables',
    family: 'aging',
    reportType: 'APAgingSummary',
    blurb: 'What you owe vendors, bucketed by how late it is.',
    ranged: false
  },
  {
    id: 'ap-aging-detail',
    label: 'A/P Aging Detail',
    group: 'Receivables & payables',
    family: 'aging',
    reportType: 'APAgingDetail',
    blurb: 'Each unpaid bill behind the aging buckets.',
    ranged: false
  },

  // ── Sales & income ──
  {
    id: 'income-by-customer',
    label: 'Income by Customer',
    group: 'Sales & income',
    family: 'summary',
    reportType: 'IncomeByCustomerSummary',
    blurb: 'Which customers the money came from.',
    ranged: true
  },
  {
    id: 'sales-by-item',
    label: 'Sales by Item',
    group: 'Sales & income',
    family: 'summary',
    reportType: 'SalesByItemSummary',
    blurb: 'Which products or services sold.',
    ranged: true
  },

  // ── Expenses ──
  {
    id: 'expense-by-vendor',
    label: 'Expenses by Vendor',
    group: 'Expenses',
    family: 'summary',
    reportType: 'ExpenseByVendorSummary',
    blurb: 'Where the money went, by who you paid.',
    ranged: true
  },
  {
    id: 'txn-list-by-date',
    label: 'Transaction List by Date',
    group: 'Expenses',
    family: 'detail',
    reportType: 'TransactionListByDate',
    blurb: 'Everything that happened, in order.',
    ranged: true
  },

  // ── Jobs ──
  {
    id: 'job-profitability',
    label: 'Job Profitability',
    group: 'Jobs',
    family: 'job',
    reportType: 'JobProfitabilitySummary',
    blurb: 'Revenue against cost, per job.',
    ranged: true
  },
  {
    id: 'job-est-vs-actual',
    label: 'Estimates vs. Actuals',
    group: 'Jobs',
    family: 'job',
    reportType: 'JobEstimatesVsActualsSummary',
    blurb: 'What you quoted against what it cost.',
    ranged: true
  }
]

export function findReport(id: string): ReportSpec | undefined {
  return REPORTS.find((r) => r.id === id)
}

// ── Request building ─────────────────────────────────────────────────────────

export interface ReportOptions {
  /** ISO YYYY-MM-DD.  Ignored when a macro is set. */
  from?: string
  to?: string
  /**
   * A QuickBooks date macro (ThisFiscalYear, LastMonth, ThisMonthToDate …).
   * Preferred over explicit dates when present — it keeps a saved report
   * meaning "last month" rather than freezing to one particular month.
   */
  dateMacro?: string
  /** Accrual (default) or Cash.  Ignored by reports that don't accept a basis. */
  basis?: 'Accrual' | 'Cash'
}

function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function envelope(inner: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<?qbxml version="${QBXML_VERSION}"?>\n` +
    `<QBXML><QBXMLMsgsRq onError="continueOnError">${inner}</QBXMLMsgsRq></QBXML>`
  )
}

/** The period element, which is the same shape across every report family. */
function periodXML(opts: ReportOptions, ranged: boolean): string {
  if (opts.dateMacro) {
    return `<ReportDateMacro>${escapeXML(opts.dateMacro)}</ReportDateMacro>`
  }
  const from = opts.from ? `<FromReportDate>${escapeXML(opts.from)}</FromReportDate>` : ''
  const to = opts.to ? `<ToReportDate>${escapeXML(opts.to)}</ToReportDate>` : ''
  if (!from && !to) return ''
  // An "as of" report still takes a ReportPeriod; QuickBooks reads the end date
  // and ignores the start, so sending both is harmless and keeps one code path.
  void ranged
  return `<ReportPeriod>${from}${to}</ReportPeriod>`
}

/**
 * Ordered request bodies to try for one report.
 *
 * qbXML is order-sensitive AND type-sensitive: ReportBasis is rejected by
 * reports that have no basis (an aging report is neither cash nor accrual),
 * and a rejected element fails the whole request rather than being ignored.
 * Rather than maintaining a per-report table of which elements are legal —
 * which would rot the moment Intuit changes the schema — try the richest body
 * first and strip elements back until one is accepted.
 */
function bodyVariants(spec: ReportSpec, opts: ReportOptions): string[] {
  const { typeEl } = FAMILY_REQUEST[spec.family]
  const type = `<${typeEl}>${escapeXML(spec.reportType)}</${typeEl}>`
  const period = periodXML(opts, spec.ranged)
  const basis = opts.basis ? `<ReportBasis>${opts.basis}</ReportBasis>` : ''

  return [
    `${type}${period}${basis}`, // everything
    `${type}${period}`, // no basis — aging and some detail reports
    `${type}`, // no period either — report falls back to its default range
    `${type}<ReportDateMacro>ThisFiscalYearToDate</ReportDateMacro>` // last resort
  ]
}

// ── Response parsing ─────────────────────────────────────────────────────────

export type ReportRowKind = 'data' | 'subtotal' | 'total' | 'text'

export interface ReportRow {
  kind: ReportRowKind
  /** Nesting depth — 0 is top level.  Drives indentation in the UI. */
  depth: number
  /** The row's label (account name, customer name, "Total Income"…). */
  label: string
  /**
   * Values by column index, aligned to `columns`.  Sparse: a text row has
   * none, and a subtotal may only populate the last column.
   */
  cells: string[]
}

export interface ParsedReport {
  title: string
  subtitle: string
  basis: string
  /** Column headings from <ColDesc>, index 0 being the label column. */
  columns: string[]
  rows: ReportRow[]
  /** Which body variant QuickBooks accepted; >0 means elements were dropped. */
  variant: number
  statusCode: string
  statusSeverity: string
  statusMessage: string
}

function attr(tag: string, name: string): string {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? ''
}

/** Decode the five XML entities QuickBooks emits. */
function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Column headings.
 *
 * <ColDesc colID="1"><ColTitle>Jan 26</ColTitle>…</ColDesc>.  Index 0 is
 * reserved for the row label, which has no ColDesc of its own, so the returned
 * array is offset by one to line up with ReportRow.cells.
 */
function parseColumns(xml: string): string[] {
  const cols: string[] = ['']
  const re = /<ColDesc\b([^>]*)>([\s\S]*?)<\/ColDesc>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const id = Number(attr(`<ColDesc ${m[1]}>`, 'colID') || '0')
    const title = decode(m[2].match(/<ColTitle>([^<]*)<\/ColTitle>/)?.[1] ?? '').trim()
    if (id > 0) cols[id] = title
    else cols.push(title)
  }
  for (let i = 0; i < cols.length; i++) if (cols[i] === undefined) cols[i] = ''
  return cols
}

const ROW_KIND: Record<string, ReportRowKind> = {
  DataRow: 'data',
  SubtotalRow: 'subtotal',
  TotalRow: 'total',
  TextRow: 'text'
}

/**
 * Walk <ReportData> in document order, tracking nesting depth.
 *
 * Depth comes from how many <ReportSubReport> wrappers are still open at the
 * point a row appears — that is the only place QuickBooks records hierarchy.
 * A single forward scan over both row tags and wrapper tags keeps the two in
 * sync; parsing rows and wrappers separately would lose their interleaving.
 */
function parseRows(xml: string): ReportRow[] {
  const body = xml.match(/<ReportData>([\s\S]*?)<\/ReportData>/)?.[1]
  if (!body) return []

  const rows: ReportRow[] = []
  let depth = 0

  // Matches an opening/closing ReportSubReport, or a complete row element.
  const scanner =
    /<(ReportSubReport)\b[^>]*>|<\/(ReportSubReport)>|<(DataRow|SubtotalRow|TotalRow|TextRow)\b[^>]*>([\s\S]*?)<\/\3>/g

  let m: RegExpExecArray | null
  while ((m = scanner.exec(body)) !== null) {
    if (m[1]) {
      depth++
      continue
    }
    if (m[2]) {
      depth = Math.max(0, depth - 1)
      continue
    }

    const kind = ROW_KIND[m[3]] ?? 'data'
    const inner = m[4]

    const rowDataTag = inner.match(/<RowData\b[^>]*\/?>/)?.[0] ?? ''
    const label = decode(attr(rowDataTag, 'value')).trim()

    const cells: string[] = []
    const colRe = /<ColData\b([^>]*)\/?>/g
    let c: RegExpExecArray | null
    while ((c = colRe.exec(inner)) !== null) {
      const tag = `<ColData ${c[1]}>`
      const id = Number(attr(tag, 'colID') || '0')
      const value = decode(attr(tag, 'value')).trim()
      if (id > 0) cells[id] = value
      else cells.push(value)
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''

    // A row with neither a label nor any values carries no information.
    if (!label && cells.every((v) => !v)) continue

    rows.push({ kind, depth, label, cells })
  }

  return rows
}

export function parseReport(xml: string, rq: string): Omit<ParsedReport, 'variant'> {
  const rs = rq.replace(/Rq$/, 'Rs')
  const tag = xml.match(new RegExp(`<${rs}\\b[^>]*>`))?.[0]

  const statusCode = tag ? attr(tag, 'statusCode') || '0' : '-1'
  const statusSeverity = tag ? attr(tag, 'statusSeverity') || 'Info' : 'Error'
  const statusMessage = tag
    ? decode(attr(tag, 'statusMessage')) || 'Status OK'
    : `QuickBooks returned no <${rs}>`

  return {
    title: decode(xml.match(/<ReportTitle>([^<]*)<\/ReportTitle>/)?.[1] ?? '').trim(),
    subtitle: decode(xml.match(/<ReportSubtitle>([^<]*)<\/ReportSubtitle>/)?.[1] ?? '').trim(),
    basis: decode(xml.match(/<ReportBasis>([^<]*)<\/ReportBasis>/)?.[1] ?? '').trim(),
    columns: parseColumns(xml),
    rows: parseRows(xml),
    statusCode,
    statusSeverity,
    statusMessage
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

/**
 * Fetch one report, falling back through body variants on a schema rejection.
 *
 * Reports are not paginated — QuickBooks returns the whole thing — so unlike
 * the transaction queries there is no iterator to drive here.  A very large
 * General Ledger over a multi-year range can still take QuickBooks a long time
 * to compute, which is why callers should widen the send timeout rather than
 * splitting the range (splitting would break the subtotals).
 */
export async function runReport(
  send: QBSender,
  spec: ReportSpec,
  opts: ReportOptions = {}
): Promise<ParsedReport> {
  const { rq } = FAMILY_REQUEST[spec.family]
  const variants = bodyVariants(spec, opts)

  let last: Omit<ParsedReport, 'variant'> | null = null

  for (let v = 0; v < variants.length; v++) {
    const xml = envelope(`<${rq} requestID="rpt_${spec.id}_${v}">${variants[v]}</${rq}>`)

    let resp: string
    try {
      resp = await send(xml)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      // A transport failure is not a schema problem — another variant will not
      // help, and retrying would just make the user wait through four timeouts.
      return {
        title: spec.label,
        subtitle: '',
        basis: '',
        columns: [],
        rows: [],
        variant: v,
        statusCode: '-1',
        statusSeverity: 'Error',
        statusMessage: message
      }
    }

    const parsed = parseReport(resp, rq)
    last = parsed

    if (parsed.statusSeverity !== 'Error') {
      return { ...parsed, variant: v }
    }
  }

  return {
    ...(last ?? {
      title: spec.label,
      subtitle: '',
      basis: '',
      columns: [],
      rows: [],
      statusCode: '-1',
      statusSeverity: 'Error',
      statusMessage: 'QuickBooks rejected every request variant.'
    }),
    variant: variants.length - 1
  }
}

// ── Flattening, for export ───────────────────────────────────────────────────

/**
 * Turn a report into rows of plain strings for the Excel exporter.
 *
 * Indentation is rendered as leading spaces in the label column so the
 * hierarchy survives the trip into a spreadsheet, where there is no nesting to
 * carry it.
 */
export function reportToRows(report: ParsedReport): { headers: string[]; rows: string[][] } {
  const width = Math.max(report.columns.length, ...report.rows.map((r) => r.cells.length), 1)

  const headers: string[] = []
  for (let i = 0; i < width; i++) headers.push(report.columns[i] ?? '')

  const rows = report.rows.map((r) => {
    const out: string[] = ['  '.repeat(r.depth) + r.label]
    for (let i = 1; i < width; i++) out.push(r.cells[i] ?? '')
    return out
  })

  return { headers, rows }
}
