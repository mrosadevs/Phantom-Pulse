import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Trash2,
  Filter,
  AlertTriangle,
  CheckSquare,
  Square,
  Loader2,
  WifiOff
} from 'lucide-react'
import { toast } from 'sonner'
import { TRANSACTION_TYPES } from '../data/transactionTypes'
import { useQBStore } from '../store/useQBStore'
import { useHistoryStore } from '../store/useHistoryStore'

interface TxnRow {
  TxnID: string
  TxnDate: string
  RefNumber: string
  Name: string
  Amount: string
  [key: string]: string
}

export default function DeletePage() {
  const { status } = useQBStore()
  const { add: addHistory } = useHistoryStore()
  const [txnType, setTxnType] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [isQuerying, setIsQuerying] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [transactions, setTransactions] = useState<TxnRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showConfirm, setShowConfirm] = useState(false)
  const [hasQueried, setHasQueried] = useState(false)

  const handleQuery = async () => {
    if (!txnType) return toast.error('Select a transaction type')
    if (!status.connected) return toast.error('Connect to QuickBooks Desktop first')

    setIsQuerying(true)
    setSelected(new Set())
    try {
      const result = await window.api.qb.exportTransactions(txnType, { fromDate, toDate })
      if (result.success && result.data) {
        setTransactions(result.data as TxnRow[])
        setHasQueried(true)
        toast.success(`Found ${result.data.length} transactions`)
      } else {
        toast.error(result.error || 'Query failed')
      }
    } catch {
      toast.error('Query failed')
    } finally {
      setIsQuerying(false)
    }
  }

  const toggleRow = (txnId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(txnId)) next.delete(txnId)
      else next.add(txnId)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === transactions.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(transactions.map((t) => t.TxnID)))
    }
  }

  const handleDelete = async () => {
    setShowConfirm(false)
    setIsDeleting(true)

    const txnIds = Array.from(selected)
    try {
      const result = await window.api.qb.deleteTransactions(txnIds, txnType)
      if (result.success && result.results) {
        const successCount = result.results.filter((r) => r.success).length
        const failCount = result.results.filter((r) => !r.success).length

        // Remove deleted from list
        const deletedIds = new Set(
          result.results.filter((r) => r.success).map((r) => r.txnId)
        )
        setTransactions((prev) => prev.filter((t) => !deletedIds.has(t.TxnID)))
        setSelected(new Set())

        await addHistory({
          operation: 'delete',
          type: txnType,
          count: txnIds.length,
          successCount,
          failCount,
          mode: 'qbsdk'
        })

        if (failCount === 0) toast.success(`Deleted ${successCount} transactions`)
        else toast.error(`${failCount} failed to delete. ${successCount} deleted.`)
      } else {
        toast.error(result.error || 'Delete failed')
      }
    } catch {
      toast.error('Delete failed')
    } finally {
      setIsDeleting(false)
    }
  }

  const allSelected = transactions.length > 0 && selected.size === transactions.length
  const someSelected = selected.size > 0 && !allSelected

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
              Delete Transactions
            </h1>
            <p className="text-text-muted text-sm mt-0.5">
              Bulk delete transactions from QuickBooks Desktop
            </p>
          </div>

          {selected.size > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => setShowConfirm(true)}
              disabled={isDeleting}
              className="btn-danger flex items-center gap-2 px-5 py-2.5"
            >
              {isDeleting ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Trash2 size={15} />
              )}
              Delete {selected.size} Selected
            </motion.button>
          )}
        </div>

        {!status.connected && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-warning/10 border border-warning/30">
            <WifiOff size={16} className="text-warning flex-shrink-0" />
            <p className="text-warning text-sm font-medium">
              Connect to QuickBooks Desktop in Settings to delete transactions.
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
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="input-field w-full text-sm cursor-pointer date-picker-dark"
              />
            </div>

            <div>
              <label className="text-xs text-text-muted mb-1.5 block font-medium">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="input-field w-full text-sm cursor-pointer date-picker-dark"
              />
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
                {isQuerying ? 'Querying...' : 'Find Transactions'}
              </button>
            </div>
          </div>
        </div>

        {/* Transaction table */}
        {hasQueried && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 glass-card overflow-hidden flex flex-col"
          >
            {/* Table header bar */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-3">
                <button onClick={toggleAll} className="text-text-muted hover:text-text-primary">
                  {allSelected ? (
                    <CheckSquare size={16} className="text-primary" />
                  ) : someSelected ? (
                    <CheckSquare size={16} className="text-text-muted" />
                  ) : (
                    <Square size={16} />
                  )}
                </button>
                <span className="text-sm text-text-muted">
                  {transactions.length} transactions •{' '}
                  <span className={selected.size > 0 ? 'text-danger font-medium' : ''}>
                    {selected.size} selected
                  </span>
                </span>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-bg-surface">
                  <tr className="border-b border-white/[0.12]">
                    <th className="w-10 px-4 py-2.5"></th>
                    <th className="px-3 py-2.5 text-text-muted font-medium text-left">Date</th>
                    <th className="px-3 py-2.5 text-text-muted font-medium text-left">Ref #</th>
                    <th className="px-3 py-2.5 text-text-muted font-medium text-left">Name</th>
                    <th className="px-3 py-2.5 text-text-muted font-medium text-right">Amount</th>
                    <th className="px-3 py-2.5 text-text-muted font-medium text-left">TxnID</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn) => (
                    <tr
                      key={txn.TxnID}
                      onClick={() => toggleRow(txn.TxnID)}
                      className={`border-b border-white/[0.05] cursor-pointer transition-colors ${
                        selected.has(txn.TxnID)
                          ? 'bg-danger/10 hover:bg-danger/15'
                          : 'hover:bg-bg-surface/60'
                      }`}
                    >
                      <td className="px-4 py-2.5 text-center">
                        {selected.has(txn.TxnID) ? (
                          <CheckSquare size={14} className="text-danger mx-auto" />
                        ) : (
                          <Square size={14} className="text-text-muted mx-auto" />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">{txn.TxnDate || '—'}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{txn.RefNumber || '—'}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{txn.Name || '—'}</td>
                      <td className="px-3 py-2.5 text-text-primary font-medium text-right">
                        {txn.Amount ? `$${parseFloat(txn.Amount).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-text-disabled font-mono truncate max-w-[120px]">
                        {txn.TxnID}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Confirm dialog */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
            onClick={() => setShowConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card p-6 max-w-sm w-full space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-danger/10 border border-danger/30 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={20} className="text-danger" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary">Confirm Deletion</h3>
                  <p className="text-text-muted text-sm mt-1">
                    You are about to permanently delete{' '}
                    <span className="text-danger font-semibold">{selected.size} transactions</span>{' '}
                    from QuickBooks Desktop. This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setShowConfirm(false)} className="btn-secondary flex-1 py-2">
                  Cancel
                </button>
                <button onClick={handleDelete} className="btn-danger flex-1 py-2">
                  Delete {selected.size} Transactions
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
