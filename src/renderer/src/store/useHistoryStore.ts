import { create } from 'zustand'
import type { HistoryEntry } from '../types/electron'

interface HistoryStore {
  entries: HistoryEntry[]
  isLoading: boolean
  load: () => Promise<void>
  add: (entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => Promise<void>
  clear: () => Promise<void>
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  entries: [],
  isLoading: false,

  load: async () => {
    set({ isLoading: true })
    try {
      const entries = await window.api.history.getAll()
      set({ entries, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  add: async (entry) => {
    await window.api.history.add(entry)
    // Reload from store
    const entries = await window.api.history.getAll()
    set({ entries })
  },

  clear: async () => {
    await window.api.history.clear()
    set({ entries: [] })
  }
}))
