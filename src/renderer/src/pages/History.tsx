import { motion } from 'framer-motion'
import { History, Upload, Download, Trash2, PenLine, Clock, Wifi, FileText, RefreshCw, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useHistoryStore } from '../store/useHistoryStore'
import type { HistoryEntry } from '../types/electron'

const OP_CONFIG = {
  import: { icon: Upload, color: 'text-primary', bg: 'bg-primary/10', label: 'Import' },
  export: { icon: Download, color: 'text-success', bg: 'bg-success/10', label: 'Export' },
  delete: { icon: Trash2, color: 'text-danger', bg: 'bg-danger/10', label: 'Delete' },
  modify: { icon: PenLine, color: 'text-warning', bg: 'bg-warning/10', label: 'Modify' }
}

export default function HistoryPage() {
  const { entries, clear, load } = useHistoryStore()

  const handleClear = async () => {
    if (confirm('Clear all history? This cannot be undone.')) {
      await clear()
      toast.success('History cleared')
    }
  }

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-5xl mx-auto w-full flex flex-col h-full gap-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-2xl font-bold text-text-primary">History</h1>
            <p className="text-text-muted text-sm mt-0.5">
              Audit trail of all import, export, delete, and modify operations
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
            {entries.length > 0 && (
              <button
                onClick={handleClear}
                className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1.5"
              >
                <Trash2 size={12} />
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        {entries.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {Object.entries(OP_CONFIG).map(([op, cfg]) => {
              const count = entries.filter((e) => e.operation === op).length
              return (
                <div key={op} className="glass-card p-4 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl ${cfg.bg} flex items-center justify-center`}>
                    <cfg.icon size={16} className={cfg.color} />
                  </div>
                  <div>
                    <p className="text-text-muted text-xs">{cfg.label}</p>
                    <p className="text-text-primary font-bold text-lg font-heading">{count}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* History table */}
        <div className="flex-1 glass-card overflow-hidden flex flex-col">
          {entries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
              <History size={40} className="text-text-disabled" />
              <p className="text-sm font-medium">No operations recorded yet</p>
              <p className="text-text-disabled text-xs">
                Import, export, or delete transactions to see history here
              </p>
            </div>
          ) : (
            <>
              {/* Table header */}
              <div className="grid grid-cols-[auto_1fr_1fr_auto_auto_auto_auto] gap-3 px-5 py-3 border-b border-white/[0.08] text-xs text-text-muted font-medium uppercase tracking-wider">
                <span className="w-8"></span>
                <span>Operation</span>
                <span>File</span>
                <span>Total</span>
                <span>Success</span>
                <span>Errors</span>
                <span>Time</span>
              </div>

              <div className="flex-1 overflow-y-auto">
                {entries.map((entry, i) => (
                  <HistoryRow key={entry.id} entry={entry} index={i} />
                ))}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function HistoryRow({ entry, index }: { entry: HistoryEntry; index: number }) {
  const cfg = OP_CONFIG[entry.operation] || {
    icon: FileText,
    color: 'text-text-muted',
    bg: 'bg-bg-overlay',
    label: entry.operation
  }
  const Icon = cfg.icon

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      className="grid grid-cols-[auto_1fr_1fr_auto_auto_auto_auto] gap-3 items-center px-5 py-3.5 border-b border-white/[0.05] hover:bg-bg-surface/60 transition-colors"
    >
      {/* Icon */}
      <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center`}>
        <Icon size={14} className={cfg.color} />
      </div>

      {/* Operation + type */}
      <div className="min-w-0">
        <p className="text-text-primary text-sm font-medium truncate">
          {cfg.label} — {entry.type}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {entry.mode === 'qbsdk' ? (
            <Wifi size={10} className="text-success" />
          ) : (
            <FileText size={10} className="text-warning" />
          )}
          <span className="text-text-disabled text-[10px]">
            {entry.mode === 'qbsdk' ? 'QuickBooks SDK' : 'IIF File'}
          </span>
        </div>
      </div>

      {/* File name */}
      <span className="text-text-muted text-xs truncate">{entry.fileName || '—'}</span>

      {/* Total */}
      <span className="text-text-muted text-sm font-medium w-12 text-right">{entry.count}</span>

      {/* Success */}
      <span className="text-success text-sm font-medium w-16 text-right">
        {entry.successCount}
      </span>

      {/* Errors */}
      <div className="w-16 text-right">
        {entry.failCount > 0 ? (
          <span className="flex items-center justify-end gap-1 text-danger text-sm font-medium">
            <AlertCircle size={11} />
            {entry.failCount}
          </span>
        ) : (
          <span className="text-text-disabled text-sm">0</span>
        )}
      </div>

      {/* Time */}
      <div className="flex items-center gap-1 text-text-disabled text-xs w-20 justify-end">
        <Clock size={10} />
        {formatDate(entry.timestamp)}
      </div>
    </motion.div>
  )
}

function formatDate(ts: string): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
