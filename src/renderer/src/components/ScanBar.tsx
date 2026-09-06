import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw, Loader2, Calendar, WifiOff, Clock } from 'lucide-react'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { useQBStore } from '../store/useQBStore'
import { cn } from '../utils/cn'

/**
 * Shared scan control for the read-only analysis pages.
 *
 * Audit and Clean Up both read one scan from useAnalysisStore, so the control
 * that produces it lives in one place rather than being duplicated (and drifting)
 * on each page.  It always states when the data was captured: an analysis page
 * that silently shows a twenty-minute-old picture of a file someone is actively
 * working in is worse than one that admits its age.
 */
export default function ScanBar({
  from,
  to,
  onFrom,
  onTo,
  includeDeleted,
  onIncludeDeleted
}: {
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  includeDeleted?: boolean
  onIncludeDeleted?: (v: boolean) => void
}) {
  const { status } = useQBStore()
  const { scan, isScanning, scannedAt, progress, setProgress, result } = useAnalysisStore()

  useEffect(() => {
    const off = window.api.qb.onAnalyzeProgress((p) => setProgress(p))
    return off
  }, [setProgress])

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <RefreshCw size={16} className="text-primary" />
        <h2 className="font-semibold text-text-primary text-sm">Scan Range</h2>
        {scannedAt && !isScanning && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text-muted">
            <Clock size={11} />
            Scanned {scannedAt.toLocaleTimeString()} · {result?.transactionCount.toLocaleString() ?? 0}{' '}
            transactions
          </span>
        )}
      </div>

      {!status.connected && (
        <div className="flex items-center gap-3 p-3 mb-4 rounded-xl bg-warning/10 border border-warning/30">
          <WifiOff size={15} className="text-warning flex-shrink-0" />
          <p className="text-warning text-xs font-medium">
            Connect to QuickBooks Desktop in Settings before scanning.
          </p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 items-end">
        <div>
          <label className="text-xs text-text-muted mb-1.5 block font-medium">From Date</label>
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="date"
              value={from}
              onChange={(e) => onFrom(e.target.value)}
              className="input-field w-full pl-9 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-text-muted mb-1.5 block font-medium">To Date</label>
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="date"
              value={to}
              onChange={(e) => onTo(e.target.value)}
              className="input-field w-full pl-9 text-sm"
            />
          </div>
        </div>

        {onIncludeDeleted && (
          <label className="flex items-center gap-2 h-[38px] px-3 rounded-lg bg-bg-surface border border-white/[0.12] cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(includeDeleted)}
              onChange={(e) => onIncludeDeleted(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-xs text-text-secondary">Include deletion log</span>
          </label>
        )}

        <button
          onClick={() => scan({ from: from || undefined, to: to || undefined, includeDeleted })}
          disabled={!status.connected || isScanning}
          className={cn(
            'flex items-center justify-center gap-2 h-[38px] rounded-lg text-sm font-medium transition-all duration-200',
            status.connected && !isScanning
              ? 'btn-primary'
              : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
          )}
        >
          {isScanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {isScanning ? 'Scanning…' : scannedAt ? 'Rescan' : 'Scan File'}
        </button>
      </div>

      {/* Leaving the date fields empty scans everything, which is what the dead-list
          analysis needs to be trustworthy — so say so rather than let it surprise. */}
      {!from && !to && (
        <p className="text-[11px] text-text-disabled mt-3">
          No dates set — the whole company file will be scanned. That is slower, but it is the only
          way &ldquo;never used&rdquo; findings can be believed.
        </p>
      )}

      {isScanning && progress && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 mt-3 text-[11.5px] text-text-muted"
        >
          <Loader2 size={12} className="animate-spin text-primary" />
          <span className="text-text-secondary font-medium">{progress.step}</span>
          {progress.detail && <span className="text-text-disabled">— {progress.detail}</span>}
        </motion.div>
      )}
    </div>
  )
}
