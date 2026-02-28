import { useState } from 'react'
import { motion } from 'framer-motion'
import { Download, Filter, Calendar, Loader2, FileSpreadsheet, AlertCircle, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { TRANSACTION_TYPES } from '../data/transactionTypes'
import { useQBStore } from '../store/useQBStore'
import { useHistoryStore } from '../store/useHistoryStore'

export default function ExportPage() {
  const { status } = useQBStore()
  const { add: addHistory } = useHistoryStore()
  const [txnType, setTxnType] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx')
  const [isLoading, setIsLoading] = useState(false)
  const [preview, setPreview] = useState<Record<string, string>[]>([])
  const [hasQueried, setHasQueried] = useState(false)

  const handleQuery = async () => {
    if (!txnType) return toast.error('Please select a transaction type')
    if (!status.connected) return toast.error('Connect to QuickBooks Desktop first')

    setIsLoading(true)
    try {
      const result = await window.api.qb.exportTransactions(txnType, { fromDate, toDate })
      if (result.success && result.data) {
        setPreview(result.data)
        setHasQueried(true)
        toast.success(`Found ${result.data.length} transactions`)
      } else {
        toast.error(result.error || 'Query failed')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Query failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleExport = async () => {
    if (!preview.length) return

    const saveResult = await window.api.files.saveDialog({
      title: 'Export Transactions',
      defaultPath: `${txnType.replace(/\s+/g, '_')}_export.${format}`,
      filters:
        format === 'xlsx'
          ? [{ name: 'Excel', extensions: ['xlsx'] }]
          : [{ name: 'CSV', extensions: ['csv'] }]
    })

    if (saveResult.canceled || !saveResult.filePath) return

    const headers = preview.length > 0 ? Object.keys(preview[0]) : []
    const result = await window.api.files.exportExcel(preview, headers, saveResult.filePath)

    if (result.success) {
      toast.success(`Exported ${preview.length} transactions`)
      await addHistory({
        operation: 'export',
        type: txnType,
        count: preview.length,
        successCount: preview.length,
        failCount: 0,
        mode: 'qbsdk'
      })
    } else {
      toast.error(result.error || 'Export failed')
    }
  }

  const previewHeaders = preview.length > 0 ? Object.keys(preview[0]) : []

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-6xl mx-auto w-full flex flex-col h-full gap-4"
      >
        {/* Header */}
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">Export Transactions</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Export transactions from QuickBooks Desktop to Excel or CSV
          </p>
        </div>

        {!status.connected && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-warning/10 border border-warning/30">
            <WifiOff size={16} className="text-warning flex-shrink-0" />
            <div>
              <p className="text-warning text-sm font-medium">Not connected to QuickBooks Desktop</p>
              <p className="text-text-muted text-xs mt-0.5">
                Go to Settings to connect. Export requires a live QB connection.
              </p>
            </div>
          </div>
        )}

        {/* Filter panel */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Filter size={16} className="text-primary" />
            <h2 className="font-semibold text-text-primary text-sm">Filter Options</h2>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-text-muted mb-1.5 block font-medium">
                Transaction Type *
              </label>
              <select
                value={txnType}
                onChange={(e) => setTxnType(e.target.value)}
                className="input-field w-full text-sm"
              >
                <option value="">Select type...</option>
                {TRANSACTION_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-text-muted mb-1.5 block font-medium">From Date</label>
              <div className="relative">
                <Calendar
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="input-field w-full pl-9 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted mb-1.5 block font-medium">To Date</label>
              <div className="relative">
                <Calendar
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="input-field w-full pl-9 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted mb-1.5 block font-medium">
                Export Format
              </label>
              <div className="flex gap-2">
                {(['xlsx', 'csv'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all duration-150 ${
                      format === f
                        ? 'bg-primary/20 border-primary/40 text-primary'
                        : 'bg-bg-surface border-white/[0.12] text-text-muted hover:text-text-primary hover:border-white/[0.18]'
                    }`}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-4">
            <button
              onClick={handleQuery}
              disabled={!txnType || !status.connected || isLoading}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                txnType && status.connected && !isLoading
                  ? 'btn-primary'
                  : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
              }`}
            >
              {isLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Filter size={14} />
              )}
              {isLoading ? 'Querying...' : 'Query Transactions'}
            </button>
          </div>
        </div>

        {/* Preview table */}
        {hasQueried && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col glass-card overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <FileSpreadsheet size={15} className="text-success" />
                {preview.length.toLocaleString()} transactions found
              </div>

              <button
                onClick={handleExport}
                disabled={!preview.length}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  preview.length
                    ? 'btn-success'
                    : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
                }`}
              >
                <Download size={14} />
                Export {format.toUpperCase()}
              </button>
            </div>

            {preview.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-muted">
                <AlertCircle size={32} />
                <p className="text-sm">No transactions found for the selected filters</p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-bg-surface">
                    <tr className="border-b border-white/[0.12]">
                      {previewHeaders.map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2.5 text-text-muted font-medium text-left whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 200).map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-white/[0.05] hover:bg-bg-surface/60"
                      >
                        {previewHeaders.map((h) => (
                          <td key={h} className="px-3 py-2 text-text-secondary truncate max-w-[200px]">
                            {row[h] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 200 && (
                  <p className="text-text-muted text-xs text-center py-3">
                    Showing first 200 of {preview.length} rows. All will be exported.
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
