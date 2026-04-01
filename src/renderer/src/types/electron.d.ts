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
        ) => Promise<{ success: boolean; data?: Record<string, string>[]; error?: string }>
        deleteTransactions: (
          txnIds: string[],
          txnType: string
        ) => Promise<{
          success: boolean
          results?: { txnId: string; success: boolean; error?: string }[]
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
      }
      history: {
        getAll: () => Promise<HistoryEntry[]>
        add: (entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => Promise<{ success: boolean }>
        clear: () => Promise<{ success: boolean }>
      }
    }
  }
}
