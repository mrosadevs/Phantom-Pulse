import { create } from 'zustand'
import type { AnalysisResult } from '../types/electron'

/**
 * The last company-file scan, shared across pages.
 *
 * Audit and Clean Up ask different questions of the same underlying data, and
 * a scan of a large file is slow enough that running one per page would be
 * felt.  Holding the result here means the second page opens instantly, and
 * `scannedAt` lets each page say how fresh the answer is rather than quietly
 * presenting a stale one as current.
 */
interface AnalysisStore {
  result: AnalysisResult | null
  isScanning: boolean
  /** Null until the first successful scan. */
  scannedAt: Date | null
  /** What the scan covered, so the UI can caveat its own findings. */
  range: { from?: string; to?: string; includeDeleted: boolean }
  progress: { step: string; detail: string } | null
  error: string | null

  scan: (options?: { from?: string; to?: string; includeDeleted?: boolean }) => Promise<boolean>
  setProgress: (p: { step: string; detail: string } | null) => void
  clear: () => void
}

export const useAnalysisStore = create<AnalysisStore>((set) => ({
  result: null,
  isScanning: false,
  scannedAt: null,
  range: { includeDeleted: false },
  progress: null,
  error: null,

  scan: async (options) => {
    set({ isScanning: true, error: null, progress: null })
    try {
      const res = await window.api.qb.analyze(options)
      if (res.success && res.data) {
        set({
          result: res.data,
          isScanning: false,
          scannedAt: new Date(),
          range: {
            from: options?.from,
            to: options?.to,
            includeDeleted: Boolean(options?.includeDeleted)
          },
          progress: null
        })
        return true
      }
      set({ isScanning: false, error: res.error ?? 'Scan failed', progress: null })
      return false
    } catch (err: unknown) {
      set({
        isScanning: false,
        error: err instanceof Error ? err.message : 'Scan failed',
        progress: null
      })
      return false
    }
  },

  setProgress: (progress) => set({ progress }),

  clear: () => set({ result: null, scannedAt: null, error: null, progress: null })
}))
