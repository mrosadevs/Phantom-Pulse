import { contextBridge, ipcRenderer } from 'electron'

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
      ipcRenderer.invoke('qb:getVendorAccountMap')
  },

  // History/store operations
  history: {
    getAll: () => ipcRenderer.invoke('history:getAll'),
    add: (entry: unknown) => ipcRenderer.invoke('history:add', entry),
    clear: () => ipcRenderer.invoke('history:clear')
  }
})

// Allow renderer to listen to push events from main process
;(contextBridge.exposeInMainWorld as Function)('electronOn', (channel: string, cb: (...args: unknown[]) => void) => {
  ipcRenderer.on(channel, cb)
})
// Type declarations handled in renderer
