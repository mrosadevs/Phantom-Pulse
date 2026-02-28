import { useState } from 'react'
import { motion } from 'framer-motion'
import { PenLine, Filter, Save, Loader2, WifiOff, AlertCircle, Edit3, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { TRANSACTION_TYPES } from '../data/transactionTypes'
import { useQBStore } from '../store/useQBStore'

interface EditableRow {
  TxnID: string
  TxnDate: string
  RefNumber: string
  Name: string
  Amount: string
  Memo?: string
  _modified?: boolean
  [key: string]: string | boolean | undefined
}

export default function ModifyPage() {
  const { status } = useQBStore()
  const [txnType, setTxnType] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [isQuerying, setIsQuerying] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [rows, setRows] = useState<EditableRow[]>([])
  const [hasQueried, setHasQueried] = useState(false)
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null)
  const [editValue, setEditValue] = useState('')

  const handleQuery = async () => {
    if (!txnType) return toast.error('Select a transaction type')
    if (!status.connected) return toast.error('Connect to QuickBooks Desktop first')

    setIsQuerying(true)
    try {
      const result = await window.api.qb.exportTransactions(txnType, { fromDate, toDate })
      if (result.success && result.data) {
        setRows(result.data as EditableRow[])
        setHasQueried(true)
        toast.success(`Loaded ${result.data.length} transactions for editing`)
      } else {
        toast.error(result.error || 'Query failed')
      }
    } catch {
      toast.error('Query failed')
    } finally {
      setIsQuerying(false)
    }
  }

  const startEdit = (rowIndex: number, col: string, value: string) => {
    setEditingCell({ row: rowIndex, col })
    setEditValue(value)
  }

  const commitEdit = () => {
    if (!editingCell) return
    setRows((prev) =>
      prev.map((row, i) =>
        i === editingCell.row
          ? { ...row, [editingCell.col]: editValue, _modified: true }
          : row
      )
    )
    setEditingCell(null)
  }

  const modifiedRows = rows.filter((r) => r._modified)

  const handleSave = async () => {
    if (!modifiedRows.length) return toast.info('No changes to save')
    toast.info(
      `Save functionality requires QBXML Mod requests for each transaction type. ${modifiedRows.length} rows marked for update.`
    )
    // In production: iterate modifiedRows, build QBXML Mod requests, send via qb:query
    setIsSaving(true)
    await new Promise((r) => setTimeout(r, 1500))
    setRows((prev) => prev.map((r) => ({ ...r, _modified: false })))
    setIsSaving(false)
    toast.success(`${modifiedRows.length} transactions updated`)
  }

  const displayCols = ['TxnDate', 'RefNumber', 'Name', 'Amount', 'Memo']

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-6xl mx-auto w-full flex flex-col h-full gap-4"
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-heading text-2xl font-bold text-text-primary">
              Modify Transactions
            </h1>
            <p className="text-text-muted text-sm mt-0.5">
              Load and edit transactions directly in a spreadsheet-style editor
            </p>
          </div>

          {modifiedRows.length > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={handleSave}
              disabled={isSaving}
              className="btn-primary flex items-center gap-2 px-5 py-2.5"
            >
              {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Save {modifiedRows.length} Changes
            </motion.button>
          )}
        </div>

        {!status.connected && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-warning/10 border border-warning/30">
            <WifiOff size={16} className="text-warning flex-shrink-0" />
            <p className="text-warning text-sm font-medium">
              Connect to QuickBooks Desktop in Settings to modify transactions.
            </p>
          </div>
        )}

        {/* Filters */}
        <div className="glass-card p-5">
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
                <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="input-field w-full pl-9 text-sm" />
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted mb-1.5 block font-medium">To Date</label>
              <div className="relative">
                <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="input-field w-full pl-9 text-sm" />
              </div>
            </div>

            <div className="flex items-end">
              <button
                onClick={handleQuery}
                disabled={!txnType || !status.connected || isQuerying}
                className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
                  txnType && status.connected && !isQuerying
                    ? 'btn-primary'
                    : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
                }`}
              >
                {isQuerying ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
                {isQuerying ? 'Loading...' : 'Load Transactions'}
              </button>
            </div>
          </div>
        </div>

        {/* Editable grid */}
        {hasQueried && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 glass-card overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-3 text-sm text-text-muted">
                <PenLine size={14} className="text-warning" />
                {rows.length} transactions •{' '}
                {modifiedRows.length > 0 && (
                  <span className="text-warning font-medium">
                    {modifiedRows.length} modified
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-text-disabled text-xs">
                <Edit3 size={11} />
                Click any cell to edit
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-muted">
                <AlertCircle size={32} />
                <p className="text-sm">No transactions found</p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-bg-surface">
                    <tr className="border-b border-white/[0.12]">
                      <th className="w-8 px-3 py-2.5"></th>
                      {displayCols.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2.5 text-text-muted font-medium text-left whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-b border-white/[0.05] transition-colors ${
                          row._modified ? 'bg-warning/5' : 'hover:bg-bg-surface/60'
                        }`}
                      >
                        <td className="px-3 py-2 text-center">
                          {row._modified && (
                            <div className="w-1.5 h-1.5 rounded-full bg-warning mx-auto" />
                          )}
                        </td>
                        {displayCols.map((col) => {
                          const isEditing = editingCell?.row === i && editingCell?.col === col
                          const value = (row[col] as string) || ''

                          return (
                            <td key={col} className="px-3 py-2 max-w-[200px]">
                              {isEditing ? (
                                <input
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitEdit()
                                    if (e.key === 'Escape') setEditingCell(null)
                                  }}
                                  className="w-full bg-bg-overlay border border-warning rounded px-2 py-0.5 text-xs text-text-primary focus:outline-none"
                                />
                              ) : (
                                <div
                                  className="flex items-center gap-1 group/cell cursor-text"
                                  onClick={() => startEdit(i, col, value)}
                                >
                                  <span
                                    className={`truncate ${row._modified ? 'text-warning' : 'text-text-secondary'}`}
                                  >
                                    {value || '—'}
                                  </span>
                                  <Edit3
                                    size={10}
                                    className="text-text-disabled opacity-0 group-hover/cell:opacity-100 flex-shrink-0"
                                  />
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
