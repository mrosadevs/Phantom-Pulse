// Type declarations for the Electron preload API

export interface GLAccount {
  name: string
  type: string
  include: boolean
}

export interface GLEntity {
  name: string
  type: 'Customer' | 'Vendor'
  debitTotal: number
  creditTotal: number
  include: boolean
}

export interface GLParseResult {
  accounts: GLAccount[]
  customers: GLEntity[]
  vendors: GLEntity[]
  ambiguous: GLEntity[]
  pageCount: number
}

export interface GLImportEntity {
  category: 'account' | 'customer' | 'vendor'
  name: string
  accountType?: string
}

export interface GLImportResultItem {
  name: string
  category: string
  success: boolean
  error?: string
}

export interface LedgerRow {
  date: string
  clean: string
  account: string
  amount: number
  original: string
}

export interface QBStatus {
  connected: boolean
  companyFile?: string
  companyName?: string
  qbVersion?: string
  error?: string
  mode: 'qbsdk' | 'iif' | 'disconnected'
}

export interface ParsedFile {
  headers: string[]
  rows: Record<string, string>[]
}

export interface ImportResult {
  rowIndex: number
  success: boolean
  txnId?: string
  error?: string
  row: Record<string, string>
}

export interface RenameEntry {
  /** The bank's line, verbatim — what a cleaner rule would have to match. */
  original: string
  /** What the cleaner produced. */
  from: string
  /** What the person corrected it to. */
  to: string
  field: 'payee' | 'account'
  sourceFile: string
  /** How many times this same correction has been made. */
  count: number
  firstSeen: string
  lastSeen: string
}

export interface HistoryEntry {
  id: number
  timestamp: string
  operation: 'import' | 'export' | 'delete' | 'modify'
  type: string
  count: number
  successCount: number
  failCount: number
  fileName?: string
  mode: 'qbsdk' | 'iif'
}

export interface UpdaterStatusPayload {
  status: 'checking' | 'up-to-date' | 'available' | 'downloaded' | 'error'
  version?: string
  error?: string
  /** True when auto-update is on and the download already started. */
  auto?: boolean
}

export interface ReportSpec {
  id: string
  label: string
  group: 'Financial statements' | 'Receivables & payables' | 'Sales & income' | 'Expenses' | 'Jobs'
  family: 'summary' | 'detail' | 'aging' | 'job'
  reportType: string
  blurb: string
  /** False for "as of" reports (balance sheet, trial balance, aging). */
  ranged: boolean
}

export interface ReportRow {
  kind: 'data' | 'subtotal' | 'total' | 'text'
  /** Nesting depth from QuickBooks' <ReportSubReport> wrappers. */
  depth: number
  label: string
  /** Values by column index, aligned to ParsedReport.columns. Sparse. */
  cells: string[]
}

export interface ParsedReport {
  title: string
  subtitle: string
  basis: string
  /** Index 0 is the label column and is always empty. */
  columns: string[]
  rows: ReportRow[]
  /** Which request variant QuickBooks accepted; >0 means elements were dropped. */
  variant: number
  statusCode: string
  statusSeverity: string
  statusMessage: string
}

export interface ReportOptions {
  from?: string
  to?: string
  /** A QuickBooks date macro, e.g. ThisFiscalYear. Wins over from/to. */
  dateMacro?: string
  basis?: 'Accrual' | 'Cash'
}

export interface ScannedTxn {
  type: string
  txnId: string
  /** Required by every *Mod; a stale one makes QuickBooks reject the edit. */
  editSequence: string
  date: string
  refNumber: string
  memo: string
  entity: string
  amount: number
  accounts: string[]
  cleared: string
}

export interface ScanDiagnostic {
  query: string
  statusCode: string
  statusSeverity: string
  statusMessage: string
  pages: number
  records: number
  truncated: boolean
  variant: number
  error?: string
}

export interface Vendor1099Row {
  vendor: string
  listId: string
  paid: number
  eligible: boolean
  hasTaxId: boolean
  issues: string[]
}

export interface DuplicateGroup {
  key: string
  entity: string
  amount: number
  transactions: ScannedTxn[]
}

export interface UncategorizedRow {
  txn: ScannedTxn
  account: string
}

export interface DeadListRow {
  kind: string
  name: string
  listId: string
  isActive: boolean
  detail: string
}

export interface DeletedRow {
  kind: 'Transaction' | 'List entry'
  type: string
  txnId: string
  refNumber: string
  name: string
  timeDeleted: string
  timeCreated: string
}

export interface CloseCheck {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
  count: number
}

export interface AnalysisResult {
  transactionCount: number
  vendors1099: Vendor1099Row[]
  threshold1099: number
  duplicates: DuplicateGroup[]
  uncategorized: UncategorizedRow[]
  deadListItems: DeadListRow[]
  deleted: DeletedRow[]
  closeChecks: CloseCheck[]
  accounts: { name: string; type: string; isActive: boolean }[]
  diagnostics: ScanDiagnostic[]
}

export interface BulkResult {
  txnId: string
  label: string
  status: 'ok' | 'failed' | 'skipped'
  message?: string
}

export interface BatchSummary {
  results: BulkResult[]
  ok: number
  failed: number
  skipped: number
}

export interface ModifyChange {
  fromAccount?: string
  toAccount?: string
  memo?: string
  appendMemo?: string
  allLines?: boolean
}

export type TemplateSection = 'accounts' | 'customers' | 'vendors' | 'classes' | 'items'

export interface TemplateEntry {
  name: string
  type?: string
  description?: string
  accountNumber?: string
}

export interface CompanyTemplate {
  format: 'phantom-pulse-template@1'
  createdAt: string
  sourceCompany: string
  accounts: TemplateEntry[]
  customers: TemplateEntry[]
  vendors: TemplateEntry[]
  classes: TemplateEntry[]
  items: TemplateEntry[]
  diagnostics: ScanDiagnostic[]
}

export interface ReplaySummary {
  results: { section: TemplateSection; name: string; status: 'created' | 'exists' | 'failed'; message?: string }[]
  created: number
  exists: number
  failed: number
}

export interface LicenseStatus {
  activated: boolean
  machineId: string
  name?: string
  issued?: string
  expires?: string | null
  /** Set when a previously stored key no longer verifies. */
  reason?: string
}

declare global {
  interface Window {
    api: {
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
      }
      files: {
        parse: (filePath: string) => Promise<{ success: boolean; data: ParsedFile; error?: string }>
        openDialog: (
          options: Electron.OpenDialogOptions
        ) => Promise<Electron.OpenDialogReturnValue>
        saveDialog: (
          options: Electron.SaveDialogOptions
        ) => Promise<Electron.SaveDialogReturnValue>
        exportExcel: (
          data: Record<string, unknown>[],
          headers: string[],
          filePath: string
        ) => Promise<{ success: boolean; error?: string }>
        generateIIF: (
          transactions: Record<string, string>[],
          type: string
        ) => Promise<{ success: boolean; content?: string; error?: string }>
        /** Deposit-specific IIF: puts NAME on TRNS (bank/debit) AND SPL (income/credit) lines */
        generateDepositIIF: (
          transactions: Record<string, string>[]
        ) => Promise<{ success: boolean; content?: string; error?: string }>
        saveIIF: (
          content: string,
          filePath: string
        ) => Promise<{ success: boolean; error?: string }>
        /** Reveal a file highlighted in Windows Explorer */
        showInFolder: (filePath: string) => Promise<{ success: boolean }>
        /** Parse a QB General Ledger PDF → accounts / customers / vendors */
        parseGLPdf: (pdfPath: string) => Promise<{
          success: boolean
          data?: GLParseResult
          error?: string
        }>
        /** Export Ledger rows to a 5-column Excel file */
        exportLedger: (
          transactions: LedgerRow[],
          filePath: string
        ) => Promise<{ success: boolean; error?: string }>
      }
      qb: {
        connect: (
          companyFile?: string
        ) => Promise<{ success: boolean; status: QBStatus; error?: string }>
        disconnect: () => Promise<{ success: boolean }>
        status: () => Promise<QBStatus>
        query: (request: string) => Promise<{ success: boolean; data?: unknown; error?: string }>
        importTransactions: (
          transactions: Record<string, string>[],
          type: string
        ) => Promise<{ success: boolean; results?: ImportResult[]; error?: string }>
        exportTransactions: (
          type: string,
          filters: unknown
        ) => Promise<{
          success: boolean
          data?: Record<string, string>[]
          /** The company file these rows were read from. TxnIDs are per-file. */
          company?: string | null
          error?: string
        }>
        /**
         * @param expectedCompany the company the rows were queried from. When it
         *   no longer matches the file QuickBooks has open, the batch is refused
         *   rather than attempted — every TxnID would be unknown in the new file.
         */
        deleteTransactions: (
          txnIds: string[],
          txnType: string,
          expectedCompany?: string
        ) => Promise<{
          success: boolean
          results?: { txnId: string; success: boolean; error?: string }[]
          company?: string | null
          error?: string
        }>
        importGLEntities: (entities: GLImportEntity[]) => Promise<{
          success: boolean
          results?: GLImportResultItem[]
          error?: string
        }>
        getCompanyInfo: () => Promise<{ success: boolean; data?: unknown; error?: string }>
        getAccounts: () => Promise<{
          success: boolean
          data?: Record<string, string>[]
          error?: string
        }>
        getCustomers: () => Promise<{
          success: boolean
          data?: Record<string, string>[]
          error?: string
        }>
        getVendors: () => Promise<{
          success: boolean
          data?: Record<string, string>[]
          error?: string
        }>
        getItems: () => Promise<{
          success: boolean
          data?: Record<string, string>[]
          error?: string
        }>
        /** Detect the open .qbw path from the running QuickBooks process */
        detectCompanyFile: () => Promise<{
          success: boolean
          path?: string
          error?: string
        }>
        /** Scan last 500 Bills+Checks to build vendor→account map */
        getVendorAccountMap: () => Promise<{
          success: boolean
          data?: Record<string, string>
          error?: string
        }>
        /**
         * Entity → account history from every QB transaction type that carries
         * a category (bills, checks, credit card charges and credits, vendor
         * credits, invoices, sales receipts, deposits, journal entries), plus
         * the vendor and customer name lists.  Powers the Ledger pipeline's
         * three-tier matcher and ambiguity guard.
         *
         * `stats` counts TRANSACTIONS, not lines; `signatures` records the set
         * of accounts each transaction hit, so a recurring split can be told
         * apart from a payee that is genuinely coded inconsistently.
         * `diagnostics` reports what each query did — a failed query and an
         * empty company file are otherwise indistinguishable.
         */
        getEntityAccountStats: (options?: { lookbackYears?: number }) => Promise<{
          success: boolean
          data?: {
            vendors: string[]
            customers: string[]
            stats: Record<string, Record<string, number>>
            amounts?: Record<string, Record<string, number>>
            signatures?: Record<string, Record<string, number>>
            txnCounts?: Record<string, number>
            diagnostics?: {
              query: string
              statusCode: string
              statusSeverity: string
              statusMessage: string
              pages: number
              transactions: number
              entries: number
              truncated: boolean
              variant: number
              error?: string
            }[]
          }
          error?: string
        }>
        /** The report catalogue — served from main so there is one copy. */
        listReports: () => Promise<{ success: boolean; data?: ReportSpec[]; error?: string }>
        /**
         * Run one report.  QuickBooks computes every figure; see
         * src/main/qb/reports.ts for why we never recompute them here.
         * On a qbXML error `data` still carries the parsed status.
         */
        runReport: (
          reportId: string,
          options?: ReportOptions
        ) => Promise<{
          success: boolean
          data?: ParsedReport
          spec?: ReportSpec
          error?: string
        }>
        /** Flatten a report for Excel, hierarchy preserved as indentation. */
        reportToRows: (report: ParsedReport) => Promise<{
          success: boolean
          data?: { headers: string[]; rows: string[][] }
          error?: string
        }>
        /**
         * One pass over the company file feeding every read-only finding —
         * 1099 readiness, duplicates, uncategorized, dead list entries, the
         * close checklist, and optionally the deletion log.  A single call
         * because walking a large file once beats walking it five times.
         */
        analyze: (options?: {
          from?: string
          to?: string
          types?: string[]
          /** QuickBooks only retains roughly 90 days of deletions. */
          includeDeleted?: boolean
        }) => Promise<{ success: boolean; data?: AnalysisResult; error?: string }>
        /** Transactions matching a filter, for the Bulk Edit picker. */
        findTransactions: (options?: { from?: string; to?: string; types?: string[] }) => Promise<{
          success: boolean
          data?: ScannedTxn[]
          diagnostics?: ScanDiagnostic[]
          modifiableTypes?: string[]
          error?: string
        }>
        /**
         * Which of these credit card rows are already in the company file.
         *
         * The same payment sits on both the bank statement and the card
         * statement, so whichever is imported second would double it.  Matches
         * anything touching the card account for the same amount within a few
         * days — Check, Transfer, Journal Entry or an earlier import.
         *
         * `incomplete` means a query failed: an empty `matches` then means "we
         * could not look", not "there is nothing there".
         */
        findCardPaymentMatches: (
          account: string,
          rows: { id: number; date: string; amount: number }[],
          dayTolerance?: number
        ) => Promise<{
          success: boolean
          matches?: {
            rowId: number
            existing: {
              txnId: string
              type: string
              date: string
              refNumber: string
              memo: string
              amount: number
              otherAccount: string
            }
          }[]
          diagnostics?: ScanDiagnostic[]
          incomplete?: boolean
          error?: string
        }>
        /**
         * Reclassify and/or stamp a memo across many transactions.  Each one is
         * re-read and rebuilt whole before writing — a partial line rebuild
         * deletes the lines you leave out.
         */
        bulkModify: (
          txns: ScannedTxn[],
          change: ModifyChange
        ) => Promise<{ success: boolean; data?: BatchSummary; error?: string }>
        /** Void, which preserves the audit trail. Not the same as delete. */
        bulkVoid: (
          txns: ScannedTxn[]
        ) => Promise<{ success: boolean; data?: BatchSummary; error?: string }>
        /** Write a QuickBooks custom field. Never touches transaction lines. */
        bulkStamp: (
          txns: ScannedTxn[],
          fieldName: string,
          value: string
        ) => Promise<{ success: boolean; data?: BatchSummary; error?: string }>
        /** Capture the connected file's lists, optionally saving to disk. */
        captureTemplate: (
          sections?: TemplateSection[],
          filePath?: string
        ) => Promise<{ success: boolean; data?: CompanyTemplate; error?: string }>
        readTemplate: (
          filePath: string
        ) => Promise<{ success: boolean; data?: CompanyTemplate; error?: string }>
        /** Replay a template into the connected file. Adds only, never deletes. */
        replayTemplate: (
          template: CompanyTemplate,
          sections: TemplateSection[]
        ) => Promise<{ success: boolean; data?: ReplaySummary; error?: string }>
        /** All three return an unsubscribe function — call it on unmount. */
        onAnalyzeProgress: (cb: (p: { step: string; detail: string }) => void) => () => void
        onBulkProgress: (
          cb: (p: { done: number; total: number; current: string }) => void
        ) => () => void
        onTemplateProgress: (
          cb: (p: { done: number; total: number; current: string }) => void
        ) => () => void
      }
      /**
       * Corrections a person made to what the cleaner produced.
       *
       * Kept with the bank's original line beside them: the raw description is
       * what a cleaner rule would have to match, and the correction is what it
       * should have produced.  Repeats are what make a rule worth writing, so
       * entries carry a count rather than being duplicated.
       */
      renames: {
        getAll: () => Promise<RenameEntry[]>
        record: (
          entries: {
            original: string
            from: string
            to: string
            field?: 'payee' | 'account'
            sourceFile?: string
          }[]
        ) => Promise<{ success: boolean; total?: number }>
        clear: () => Promise<{ success: boolean }>
        /** Path of the file holding them, for reading outside the app. */
        path: () => Promise<string>
      }
      history: {
        getAll: () => Promise<HistoryEntry[]>
        add: (entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => Promise<{ success: boolean }>
        clear: () => Promise<{ success: boolean }>
      }
      updater: {
        check: () => Promise<{ success?: boolean; error?: string }>
        /** Start the download after the user accepts the prompt (ask mode). */
        download: () => Promise<{ success?: boolean; error?: string }>
        install: () => void
        getVersion: () => Promise<string>
        getAuto: () => Promise<boolean>
        setAuto: (value: boolean) => Promise<{ success: boolean }>
        /** Both return an unsubscribe function — call it on unmount. */
        onStatus: (cb: (data: UpdaterStatusPayload) => void) => () => void
        onProgress: (cb: (data: { percent: number }) => void) => () => void
      }
      license: {
        status: () => Promise<LicenseStatus>
        machineId: () => Promise<string>
        activate: (
          key: string
        ) => Promise<{ success: boolean; error?: string; status?: LicenseStatus }>
        deactivate: () => Promise<{ success: boolean }>
      }
    }
  }
}
