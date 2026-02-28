import { create } from 'zustand'
import type { QBStatus } from '../types/electron'

interface QBStore {
  status: QBStatus
  isConnecting: boolean
  connect: (companyFile?: string) => Promise<boolean>
  cancelConnect: () => Promise<void>
  disconnect: () => Promise<void>
  refreshStatus: () => Promise<void>
}

export const useQBStore = create<QBStore>((set) => ({
  status: { connected: false, mode: 'disconnected' },
  isConnecting: false,

  connect: async (companyFile?: string) => {
    set({ isConnecting: true })
    try {
      const result = await window.api.qb.connect(companyFile)
      set({ status: result.status, isConnecting: false })
      return result.success
    } catch {
      set({
        status: { connected: false, mode: 'disconnected', error: 'Connection failed' },
        isConnecting: false
      })
      return false
    }
  },

  cancelConnect: async () => {
    // Terminate the worker thread mid-connection (kills the blocking BeginSession COM call)
    await window.api.qb.disconnect()
    set({ status: { connected: false, mode: 'disconnected' }, isConnecting: false })
  },

  disconnect: async () => {
    await window.api.qb.disconnect()
    set({ status: { connected: false, mode: 'disconnected' } })
  },

  refreshStatus: async () => {
    try {
      const status = await window.api.qb.status()
      set({ status })
    } catch {
      set({ status: { connected: false, mode: 'disconnected' } })
    }
  }
}))
