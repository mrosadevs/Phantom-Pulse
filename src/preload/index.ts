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
    deleteTransactions: (txnIds: string[], txnType: string) =>
      ipcRenderer.invoke('qb:deleteTransactions', txnIds, txnType),
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
      ipcRenderer.invoke('qb:getEntityAccountStats', options)
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
