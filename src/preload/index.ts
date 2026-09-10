import { contextBridge, ipcRenderer } from 'electron'

interface UpdaterStatus {
  status: 'checking' | 'up-to-date' | 'available' | 'downloaded' | 'error'
  version?: string
  error?: string
  /** True when the update is already downloading because auto-update is on. */
  auto?: boolean
}

// Expose protected methods under the `window.api` namespace
contextBridge.exposeInMainWorld('api', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },

  // File operations
  files: {
    parse: (filePath: string) => ipcRenderer.invoke('files:parse', filePath),
    openDialog: (options: Electron.OpenDialogOptions) =>
      ipcRenderer.invoke('files:openDialog', options),
    saveDialog: (options: Electron.SaveDialogOptions) =>
      ipcRenderer.invoke('files:saveDialog', options),
    exportExcel: (data: unknown[], headers: string[], filePath: string) =>
      ipcRenderer.invoke('files:exportExcel', data, headers, filePath),
    generateIIF: (transactions: unknown[], type: string) =>
      ipcRenderer.invoke('files:generateIIF', transactions, type),
    saveIIF: (content: string, filePath: string) =>
      ipcRenderer.invoke('files:saveIIF', content, filePath),
    generateDepositIIF: (transactions: unknown[]) =>
      ipcRenderer.invoke('files:generateDepositIIF', transactions),
    showInFolder: (filePath: string) =>
      ipcRenderer.invoke('files:showInFolder', filePath),
    parseGLPdf: (pdfPath: string) =>
      ipcRenderer.invoke('files:parseGLPdf', pdfPath),
    exportLedger: (transactions: unknown[], filePath: string) =>
      ipcRenderer.invoke('files:exportLedger', transactions, filePath)
  },

  // QuickBooks Desktop operations
  qb: {
    connect: (companyFile?: string) => ipcRenderer.invoke('qb:connect', companyFile),
    disconnect: () => ipcRenderer.invoke('qb:disconnect'),
    status: () => ipcRenderer.invoke('qb:status'),
    query: (request: string) => ipcRenderer.invoke('qb:query', request),
    importTransactions: (transactions: unknown[], type: string) =>
      ipcRenderer.invoke('qb:importTransactions', transactions, type),
    exportTransactions: (type: string, filters: unknown) =>
      ipcRenderer.invoke('qb:exportTransactions', type, filters),
    deleteTransactions: (txnIds: string[], txnType: string, expectedCompany?: string) =>
      ipcRenderer.invoke('qb:deleteTransactions', txnIds, txnType, expectedCompany),
    getCompanyInfo: () => ipcRenderer.invoke('qb:getCompanyInfo'),
    getAccounts: () => ipcRenderer.invoke('qb:getAccounts'),
    getCustomers: () => ipcRenderer.invoke('qb:getCustomers'),
    getVendors: () => ipcRenderer.invoke('qb:getVendors'),
    getItems: () => ipcRenderer.invoke('qb:getItems'),
    detectCompanyFile: () => ipcRenderer.invoke('qb:detectCompanyFile'),
    importGLEntities: (entities: unknown[]) =>
      ipcRenderer.invoke('qb:importGLEntities', entities),
    getVendorAccountMap: () =>
      ipcRenderer.invoke('qb:getVendorAccountMap'),
    getEntityAccountStats: (options?: { lookbackYears?: number }) =>
      ipcRenderer.invoke('qb:getEntityAccountStats', options),

    // Reports
    listReports: () => ipcRenderer.invoke('qb:listReports'),
    runReport: (
      reportId: string,
      options?: { from?: string; to?: string; dateMacro?: string; basis?: 'Accrual' | 'Cash' }
    ) => ipcRenderer.invoke('qb:runReport', reportId, options),
    reportToRows: (report: unknown) => ipcRenderer.invoke('qb:reportToRows', report),

    // Analysis — one scan, every read-only finding
    analyze: (options?: {
      from?: string
      to?: string
      types?: string[]
      includeDeleted?: boolean
    }) => ipcRenderer.invoke('qb:analyze', options),
    findTransactions: (options?: { from?: string; to?: string; types?: string[] }) =>
      ipcRenderer.invoke('qb:findTransactions', options),
    findCardPaymentMatches: (
      account: string,
      rows: { id: number; date: string; amount: number }[],
      dayTolerance?: number
    ) => ipcRenderer.invoke('qb:findCardPaymentMatches', account, rows, dayTolerance),

    // Bulk writes
    bulkModify: (txns: unknown[], change: unknown) =>
      ipcRenderer.invoke('qb:bulkModify', txns, change),
    bulkVoid: (txns: unknown[]) => ipcRenderer.invoke('qb:bulkVoid', txns),
    bulkStamp: (txns: unknown[], fieldName: string, value: string) =>
      ipcRenderer.invoke('qb:bulkStamp', txns, fieldName, value),

    // New-client template
    captureTemplate: (sections?: string[], filePath?: string) =>
      ipcRenderer.invoke('qb:captureTemplate', sections, filePath),
    readTemplate: (filePath: string) => ipcRenderer.invoke('qb:readTemplate', filePath),
    replayTemplate: (template: unknown, sections: string[]) =>
      ipcRenderer.invoke('qb:replayTemplate', template, sections),

    // Progress streams.  Each returns an unsubscribe — call it on unmount, or
    // a remounting page stacks a listener per mount.
    onAnalyzeProgress: (cb: (p: { step: string; detail: string }) => void) => {
      const handler = (_e: unknown, p: { step: string; detail: string }): void => cb(p)
      ipcRenderer.on('qb:analyzeProgress', handler)
      return () => ipcRenderer.removeListener('qb:analyzeProgress', handler)
    },
    onBulkProgress: (cb: (p: { done: number; total: number; current: string }) => void) => {
      const handler = (_e: unknown, p: { done: number; total: number; current: string }): void =>
        cb(p)
      ipcRenderer.on('qb:bulkProgress', handler)
      return () => ipcRenderer.removeListener('qb:bulkProgress', handler)
    },
    onTemplateProgress: (cb: (p: { done: number; total: number; current: string }) => void) => {
      const handler = (_e: unknown, p: { done: number; total: number; current: string }): void =>
        cb(p)
      ipcRenderer.on('qb:templateProgress', handler)
      return () => ipcRenderer.removeListener('qb:templateProgress', handler)
    }
  },

  // History/store operations
  history: {
    getAll: () => ipcRenderer.invoke('history:getAll'),
    add: (entry: unknown) => ipcRenderer.invoke('history:add', entry),
    clear: () => ipcRenderer.invoke('history:clear')
  },

  // Auto-updater
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.send('updater:install'),
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    getAuto: () => ipcRenderer.invoke('updater:getAuto'),
    setAuto: (value: boolean) => ipcRenderer.invoke('updater:setAuto', value),

    // Each returns an unsubscribe function.  The generic `electronOn` below has
    // no way to remove a listener, so components using it leak one per mount —
    // under React StrictMode that is two listeners per mount in dev.
    onStatus: (cb: (data: UpdaterStatus) => void) => {
      const handler = (_e: unknown, data: UpdaterStatus): void => cb(data)
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    },
    onProgress: (cb: (data: { percent: number }) => void) => {
      const handler = (_e: unknown, data: { percent: number }): void => cb(data)
      ipcRenderer.on('updater:progress', handler)
      return () => ipcRenderer.removeListener('updater:progress', handler)
    }
  },

  // Licence activation
  license: {
    status: () => ipcRenderer.invoke('license:status'),
    machineId: () => ipcRenderer.invoke('license:machineId'),
    activate: (key: string) => ipcRenderer.invoke('license:activate', key),
    deactivate: () => ipcRenderer.invoke('license:deactivate')
  }
})

// Allow renderer to listen to push events from main process
;(contextBridge.exposeInMainWorld as Function)('electronOn', (channel: string, cb: (...args: unknown[]) => void) => {
  ipcRenderer.on(channel, cb)
})
// Type declarations handled in renderer
