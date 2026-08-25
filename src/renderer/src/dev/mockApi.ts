/**
 * Browser-only mock of the Electron preload API.
 *
 * Lets the renderer run in a plain browser (vite dev server) for UI work and
 * design review — window.api is normally injected by the Electron preload, so
 * outside Electron every page would crash on first API call.
 *
 * Installed ONLY when running in dev AND window.api is absent; inside the real
 * app this module is inert.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

function daysAgo(days: number, hour = 10): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(hour, 24, 0, 0)
  return d.toISOString()
}

const MOCK_HISTORY = [
  { id: 1, timestamp: daysAgo(0, 9), operation: 'import', type: 'Checks + Deposits (Ledger)', count: 118, successCount: 116, failCount: 2, fileName: 'BOA_Nov.pdf, BOA_Dec.pdf', mode: 'qbsdk' },
  { id: 2, timestamp: daysAgo(0, 8), operation: 'export', type: 'Invoice', count: 85, successCount: 85, failCount: 0, fileName: 'invoices_q4.xlsx', mode: 'qbsdk' },
  { id: 3, timestamp: daysAgo(1, 15), operation: 'import', type: 'Bill', count: 42, successCount: 42, failCount: 0, fileName: 'vendor_bills.csv', mode: 'qbsdk' },
  { id: 4, timestamp: daysAgo(1, 11), operation: 'modify', type: 'Check', count: 12, successCount: 12, failCount: 0, mode: 'qbsdk' },
  { id: 5, timestamp: daysAgo(2, 16), operation: 'import', type: 'Credit Card (Ledger)', count: 96, successCount: 94, failCount: 2, fileName: 'amex_oct.pdf', mode: 'qbsdk' },
  { id: 6, timestamp: daysAgo(3, 10), operation: 'delete', type: 'Journal Entry', count: 6, successCount: 6, failCount: 0, mode: 'qbsdk' },
  { id: 7, timestamp: daysAgo(4, 13), operation: 'export', type: 'Check', count: 210, successCount: 210, failCount: 0, fileName: 'checks_2026.csv', mode: 'qbsdk' },
  { id: 8, timestamp: daysAgo(5, 9), operation: 'import', type: 'Deposit', count: 64, successCount: 61, failCount: 3, fileName: 'deposits.iif', mode: 'iif' },
  { id: 9, timestamp: daysAgo(6, 14), operation: 'import', type: 'Invoice', count: 33, successCount: 33, failCount: 0, fileName: 'invoices.csv', mode: 'qbsdk' }
]

const MOCK_ACCOUNTS = [
  { Name: 'Business Checking', FullName: 'Business Checking', AccountType: 'Bank' },
  { Name: 'Payroll Account', FullName: 'Payroll Account', AccountType: 'Bank' },
  { Name: 'AMEX 7-02008', FullName: 'AMEX 7-02008', AccountType: 'CreditCard' },
  { Name: 'Fuel Expense', FullName: 'Fuel Expense', AccountType: 'Expense' },
  { Name: 'Repairs & Maintenance', FullName: 'Repairs & Maintenance', AccountType: 'Expense' },
  { Name: 'Trucking Income', FullName: 'Trucking Income', AccountType: 'Income' },
  { Name: 'Ask My Accountant', FullName: 'Ask My Accountant', AccountType: 'OtherExpense' }
]

// Mirrors qb:getEntityAccountStats. `stats` counts transactions and
// `signatures` records the account set of each one.  Ally Bank Loan is the
// recurring-split case (principal + interest on every payment): consistent
// coding, but one statement line cannot be assigned to one side of it, so it
// goes to Ask My Accountant carrying the breakdown.  The Home Depot is the
// other reason to hold back — the same payee coded differently month to month.
const MOCK_STATS = {
  vendors: ['Pilot Travel Centers', 'The Home Depot', 'FPL Direct', 'Barclaycard US', 'Ally Bank Loan'],
  customers: ['ACME Logistics', 'Sunbelt Produce'],
  stats: {
    'Pilot Travel Centers': { 'Fuel Expense': 48 },
    'The Home Depot': { 'Repairs & Maintenance': 9, 'Shareholder Distributions': 5 },
    'FPL Direct': { Utilities: 12 },
    'Ally Bank Loan': { 'Interest Expense': 12, 'Loan Payable': 12 },
    'ACME Logistics': { 'Trucking Income': 22 },
    'Sunbelt Produce': { 'Trucking Income': 7 }
  },
  amounts: {
    'Pilot Travel Centers': { 'Fuel Expense': 21400 },
    'The Home Depot': { 'Repairs & Maintenance': 4300, 'Shareholder Distributions': 2600 },
    'FPL Direct': { Utilities: 3900 },
    'Ally Bank Loan': { 'Interest Expense': 3600, 'Loan Payable': 10800 },
    'ACME Logistics': { 'Trucking Income': 88000 },
    'Sunbelt Produce': { 'Trucking Income': 24500 }
  },
  signatures: {
    'Pilot Travel Centers': { 'Fuel Expense': 48 },
    'The Home Depot': { 'Repairs & Maintenance': 9, 'Shareholder Distributions': 5 },
    'FPL Direct': { Utilities: 12 },
    'Ally Bank Loan': { 'Interest Expense || Loan Payable': 12 },
    'ACME Logistics': { 'Trucking Income': 22 },
    'Sunbelt Produce': { 'Trucking Income': 7 }
  },
  txnCounts: {
    'Pilot Travel Centers': 48,
    'The Home Depot': 14,
    'FPL Direct': 12,
    'Ally Bank Loan': 12,
    'ACME Logistics': 22,
    'Sunbelt Produce': 7
  },
  diagnostics: [
    { query: 'BillQueryRq', statusCode: '0', statusSeverity: 'Info', statusMessage: 'Status OK',
      pages: 1, transactions: 64, entries: 71, truncated: false, variant: 0 },
    { query: 'CheckQueryRq', statusCode: '0', statusSeverity: 'Info', statusMessage: 'Status OK',
      pages: 1, transactions: 52, entries: 66, truncated: false, variant: 0 }
  ]
}

const ok = <T extends object>(data: T) => Promise.resolve({ success: true, ...data })

export function installMockApi(): void {
  if (!import.meta.env.DEV || (window as any).api) return

  let history = [...MOCK_HISTORY]

  ;(window as any).api = {
    window: { minimize: () => {}, maximize: () => {}, close: () => {} },
    files: {
      parse: () => ok({ data: { headers: [], rows: [] } }),
      openDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
      saveDialog: () => Promise.resolve({ canceled: false, filePath: 'C:/mock/phantom-ledger.xlsx' }),
      exportExcel: () => ok({}),
      generateIIF: () => ok({ content: '' }),
      generateDepositIIF: () => ok({ content: '' }),
      saveIIF: () => ok({}),
      showInFolder: () => ok({}),
      parseGLPdf: () => ok({ data: { accounts: [], customers: [], vendors: [], ambiguous: [], pageCount: 0 } }),
      exportLedger: () => ok({})
    },
    qb: {
      connect: () =>
        ok({ status: { connected: true, mode: 'qbsdk', companyName: 'JWH Trucking LLC', companyFile: 'C:/QB/jwh.qbw' } }),
      disconnect: () => ok({}),
      status: () =>
        Promise.resolve({ connected: true, mode: 'qbsdk', companyName: 'JWH Trucking LLC', companyFile: 'C:/QB/jwh.qbw' }),
      query: () => ok({ data: '' }),
      importTransactions: (transactions: unknown[]) =>
        ok({
          results: (transactions as any[]).map((row, i) => ({
            rowIndex: i,
            success: i % 17 !== 16, // sprinkle a failure so error UI is visible
            txnId: `MOCK-${i}`,
            error: i % 17 === 16 ? 'QB Error 3140: Invalid AccountRef' : undefined,
            row
          }))
        }),
      exportTransactions: () => ok({ data: [] }),
      deleteTransactions: (ids: string[]) => ok({ results: ids.map((txnId) => ({ txnId, success: true })) }),
      importGLEntities: () => ok({ results: [] }),
      getCompanyInfo: () => ok({ data: {} }),
      getAccounts: () => ok({ data: MOCK_ACCOUNTS }),
      getCustomers: () => ok({ data: MOCK_STATS.customers.map((n) => ({ FullName: n })) }),
      getVendors: () => ok({ data: MOCK_STATS.vendors.map((n) => ({ FullName: n })) }),
      getItems: () => ok({ data: [] }),
      detectCompanyFile: () => ok({ path: 'C:/QB/jwh.qbw' }),
      getVendorAccountMap: () => ok({ data: {} }),
      getEntityAccountStats: () => ok({ data: MOCK_STATS })
    },
    history: {
      getAll: () => Promise.resolve(history),
      add: (entry: any) => {
        history = [{ ...entry, id: Date.now(), timestamp: new Date().toISOString() }, ...history]
        return ok({})
      },
      clear: () => {
        history = []
        return ok({})
      }
    },
    updater: {
      check: () => ok({}),
      install: () => {},
      getVersion: () => Promise.resolve('1.0.0 (preview)')
    }
  }

  console.info('[mockApi] Browser preview mode — Electron API mocked')
}
