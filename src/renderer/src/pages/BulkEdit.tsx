import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Layers,
  Search,
  Loader2,
  WifiOff,
  AlertTriangle,
  ShieldAlert,
  Tag,
  Ban,
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  MinusCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { useQBStore } from '../store/useQBStore'
import { useHistoryStore } from '../store/useHistoryStore'
import EmptyState from '../components/ui/EmptyState'
import { cn } from '../utils/cn'
import type { ScannedTxn, BatchSummary } from '../types/electron'

type Action = 'reclassify' | 'void' | 'stamp'

const ACTIONS: { id: Action; label: string; icon: typeof Tag; danger?: boolean }[] = [
  { id: 'reclassify', label: 'Reclassify', icon: ArrowRightLeft },
  { id: 'stamp', label: 'Stamp Custom Field', icon: Tag },
  { id: 'void', label: 'Void', icon: Ban, danger: true }
]

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export default function BulkEditPage() {
  const { status } = useQBStore()
  const { add: addHistory } = useHistoryStore()

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [txns, setTxns] = useState<ScannedTxn[]>([])
  const [modifiable, setModifiable] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isFinding, setIsFinding] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  const [action, setAction] = useState<Action>('reclassify')
  const [fromAccount, setFromAccount] = useState('')
  const [toAccount, setToAccount] = useState('')
  const [fieldName, setFieldName] = useState('')
  const [fieldValue, setFieldValue] = useState('')

  const [confirming, setConfirming] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(
    null
  )
  const [summary, setSummary] = useState<BatchSummary | null>(null)

  useEffect(() => {
    const off = window.api.qb.onBulkProgress((p) => setProgress(p))
    return off
  }, [])

  const handleFind = async (): Promise<void> => {
    if (!status.connected) {
      toast.error('Connect to QuickBooks Desktop first')
      return
    }
    setIsFinding(true)
    setSummary(null)
    try {
      const res = await window.api.qb.findTransactions({
        from: from || undefined,
        to: to || undefined
      })
      if (res.success && res.data) {
        setTxns(res.data)
        setModifiable(res.modifiableTypes ?? [])
        setSelected(new Set())
        setHasSearched(true)
        toast.success(`Found ${res.data.length.toLocaleString()} transactions`)
      } else {
        toast.error(res.error || 'Search failed')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setIsFinding(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return txns
    return txns.filter(
      (t) =>
        t.entity.toLowerCase().includes(q) ||
        t.memo.toLowerCase().includes(q) ||
        t.refNumber.toLowerCase().includes(q) ||
        t.accounts.some((a) => a.toLowerCase().includes(q))
    )
  }, [txns, search])

  /** Accounts present on the found transactions — the realistic reclassify sources. */
  const accountOptions = useMemo(() => {
    const set = new Set<string>()
    for (const t of txns) for (const a of t.accounts) set.add(a)
    return [...set].sort()
  }, [txns])

  const selectedTxns = useMemo(
    () => filtered.filter((t) => selected.has(t.txnId)),
    [filtered, selected]
  )

  /** Void works on more types than modify does, so eligibility depends on the action. */
  const eligible = useMemo(() => {
    if (action === 'void' || action === 'stamp') return selectedTxns
    return selectedTxns.filter((t) => modifiable.includes(t.type))
  }, [selectedTxns, action, modifiable])

  const ineligibleCount = selectedTxns.length - eligible.length

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (): void => {
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((t) => t.txnId))
    )
  }

  const canRun =
    eligible.length > 0 &&
    (action === 'void' ||
      (action === 'reclassify' && Boolean(toAccount)) ||
      (action === 'stamp' && Boolean(fieldName.trim()) && Boolean(fieldValue.trim())))

  const actionDescription = (): string => {
    if (action === 'void') {
      return `Void ${eligible.length} transaction${eligible.length === 1 ? '' : 's'}. Amounts become zero and the transactions stay in the file for the audit trail.`
    }
    if (action === 'stamp') {
      return `Write "${fieldValue}" into the custom field "${fieldName}" on ${eligible.length} transaction${eligible.length === 1 ? '' : 's'}. Transaction lines are not touched.`
    }
    return `Move ${fromAccount ? `lines coded to "${fromAccount}"` : 'every expense line'} to "${toAccount}" on ${eligible.length} transaction${eligible.length === 1 ? '' : 's'}.`
  }

  const run = async (): Promise<void> => {
    setConfirming(false)
    setIsRunning(true)
    setProgress({ done: 0, total: eligible.length, current: '' })

    try {
      let res: { success: boolean; data?: BatchSummary; error?: string }

      if (action === 'void') {
        res = await window.api.qb.bulkVoid(eligible)
      } else if (action === 'stamp') {
        res = await window.api.qb.bulkStamp(eligible, fieldName.trim(), fieldValue.trim())
      } else {
        res = await window.api.qb.bulkModify(eligible, {
          fromAccount: fromAccount || undefined,
          toAccount,
          allLines: !fromAccount
        })
      }

      if (res.success && res.data) {
        setSummary(res.data)
        const { ok, failed, skipped } = res.data
        if (failed === 0) toast.success(`${ok} updated${skipped ? `, ${skipped} skipped` : ''}`)
        else toast.warning(`${ok} updated, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`)

        await addHistory({
          operation: 'modify',
          type: `Bulk ${action}`,
          count: eligible.length,
          successCount: ok,
          failCount: failed,
          mode: 'qbsdk'
        })

        // The file has changed underneath the list, so force a fresh search
        // rather than let stale EditSequences drive a second batch.
        setSelected(new Set())
        setTxns([])
        setHasSearched(false)
      } else {
        toast.error(res.error || 'Batch failed')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Batch failed')
    } finally {
      setIsRunning(false)
      setProgress(null)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-6xl mx-auto w-full flex flex-col h-full gap-4"
      >
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">Bulk Edit</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Reclassify, stamp or void many transactions at once
          </p>
        </div>

        {!status.connected && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-warning/10 border border-warning/30">
            <WifiOff size={16} className="text-warning flex-shrink-0" />
            <p className="text-warning text-sm font-medium">
              Not connected to QuickBooks Desktop — connect in Settings first.
            </p>
          </div>
        )}

        {/* This page writes to real books. Say so once, clearly, at the top. */}
        <div className="flex items-start gap-3 p-4 rounded-xl bg-danger/[0.07] border border-danger/25">
          <ShieldAlert size={16} className="text-danger flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-danger text-sm font-medium">This page changes the company file</p>
            <p className="text-text-muted text-xs mt-0.5">
              Back up the company file before a large batch. Reclassifying rewrites transactions;
              voiding cannot be undone from Pulse.
            </p>
          </div>
        </div>

        {/* Find */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Search size={16} className="text-primary" />
            <h2 className="font-semibold text-text-primary text-sm">Find Transactions</h2>
          </div>
          <div className="grid grid-cols-4 gap-4 items-end">
            <div>
              <label className="text-xs text-text-muted mb-1.5 block font-medium">From Date</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="input-field w-full text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1.5 block font-medium">To Date</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="input-field w-full text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1.5 block font-medium">
                Filter results
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Payee, memo, account…"
                className="input-field w-full text-sm"
              />
            </div>
            <button
              onClick={handleFind}
              disabled={!status.connected || isFinding}
              className={cn(
                'flex items-center justify-center gap-2 h-[38px] rounded-lg text-sm font-medium transition-all',
                status.connected && !isFinding
                  ? 'btn-primary'
                  : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
              )}
            >
              {isFinding ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {isFinding ? 'Searching…' : 'Find'}
            </button>
          </div>
        </div>

        {/* Results + action */}
        {!hasSearched && !summary && (
          <div className="flex-1 flex items-center justify-center glass-card">
            <EmptyState
              icon={Layers}
              tone="primary"
              title="Find transactions to edit"
              description="Search first, then select what to change. Nothing is written until you confirm."
            />
          </div>
        )}

        {summary && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col glass-card overflow-hidden"
          >
            <div className="flex items-center gap-4 px-5 py-3 border-b border-white/[0.08]">
              <p className="text-sm font-semibold text-text-primary">Batch complete</p>
              <div className="flex items-center gap-3 ml-auto text-xs">
                <span className="flex items-center gap-1.5 text-success">
                  <CheckCircle2 size={13} /> {summary.ok} updated
                </span>
                {summary.skipped > 0 && (
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <MinusCircle size={13} /> {summary.skipped} skipped
                  </span>
                )}
                {summary.failed > 0 && (
                  <span className="flex items-center gap-1.5 text-danger">
                    <XCircle size={13} /> {summary.failed} failed
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs border-collapse">
                <tbody>
                  {summary.results
                    .filter((r) => r.status !== 'ok')
                    .map((r) => (
                      <tr
                        key={r.txnId}
                        className="border-b border-white/[0.05] text-text-secondary"
                      >
                        <td className="px-4 py-2 w-24">
                          <span
                            className={cn(
                              'px-1.5 py-0.5 rounded text-[10px] font-medium',
                              r.status === 'failed'
                                ? 'bg-danger/20 text-danger'
                                : 'bg-bg-overlay text-text-muted'
                            )}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 w-72 truncate text-text-primary">{r.label}</td>
                        <td className="px-3 py-2 text-text-muted">{r.message}</td>
                      </tr>
                    ))}
                  {summary.results.every((r) => r.status === 'ok') && (
                    <tr>
                      <td className="px-4 py-6 text-center text-text-muted">
                        Every transaction updated cleanly.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {hasSearched && !summary && (
          <>
            {/* Action panel */}
            <div className="glass-card p-5">
              <div className="flex gap-1.5 mb-4">
                {ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAction(a.id)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border transition-all duration-150',
                      action === a.id
                        ? a.danger
                          ? 'bg-danger/20 border-danger/40 text-danger'
                          : 'bg-primary/20 border-primary/40 text-primary'
                        : 'bg-bg-surface border-white/[0.12] text-text-muted hover:text-text-primary'
                    )}
                  >
                    <a.icon size={13} />
                    {a.label}
                  </button>
                ))}
              </div>

              {action === 'reclassify' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-text-muted mb-1.5 block font-medium">
                      Move lines coded to
                    </label>
                    <select
                      value={fromAccount}
                      onChange={(e) => setFromAccount(e.target.value)}
                      className="input-field w-full text-sm"
                    >
                      <option value="">Every expense line</option>
                      {accountOptions.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-text-muted mb-1.5 block font-medium">
                      To account *
                    </label>
                    <input
                      type="text"
                      list="account-list"
                      value={toAccount}
                      onChange={(e) => setToAccount(e.target.value)}
                      placeholder="Exact QuickBooks account name"
                      className="input-field w-full text-sm"
                    />
                    <datalist id="account-list">
                      {accountOptions.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </div>
                </div>
              )}

              {action === 'stamp' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-text-muted mb-1.5 block font-medium">
                        Custom field name *
                      </label>
                      <input
                        type="text"
                        value={fieldName}
                        onChange={(e) => setFieldName(e.target.value)}
                        placeholder="e.g. Pulse Batch"
                        className="input-field w-full text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-muted mb-1.5 block font-medium">
                        Value *
                      </label>
                      <input
                        type="text"
                        value={fieldValue}
                        onChange={(e) => setFieldValue(e.target.value)}
                        placeholder="e.g. Reviewed 2026-08"
                        className="input-field w-full text-sm"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-text-disabled mt-3">
                    The field must already exist in QuickBooks (Lists → Custom Fields). The SDK can
                    write a custom field but cannot create its definition.
                  </p>
                </>
              )}

              {action === 'void' && (
                <p className="text-[11.5px] text-text-muted">
                  Voiding zeroes the amounts and leaves the transaction in place, so the audit trail
                  survives. Use Delete instead only when the transaction should never have existed.
                </p>
              )}

              <div className="flex items-center gap-3 mt-4 pt-4 border-t border-white/[0.08]">
                <p className="text-xs text-text-muted">
                  <span className="text-text-primary font-medium tabular-nums">
                    {eligible.length.toLocaleString()}
                  </span>{' '}
                  of {filtered.length.toLocaleString()} selected
                  {ineligibleCount > 0 && (
                    <span className="text-warning">
                      {' '}
                      · {ineligibleCount} cannot be {action === 'reclassify' ? 'reclassified' : action}ed
                    </span>
                  )}
                </p>

                <button
                  onClick={() => setConfirming(true)}
                  disabled={!canRun || isRunning}
                  className={cn(
                    'ml-auto flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all',
                    canRun && !isRunning
                      ? action === 'void'
                        ? 'bg-danger hover:bg-danger-hover text-white'
                        : 'btn-primary'
                      : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
                  )}
                >
                  {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
                  {isRunning ? 'Working…' : 'Review & Apply'}
                </button>
              </div>

              {isRunning && progress && (
                <div className="mt-3">
                  <div className="h-1 rounded-full bg-bg-elevated overflow-hidden">
                    <motion.div
                      className="h-full bg-primary"
                      animate={{
                        width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`
                      }}
                      transition={{ duration: 0.2 }}
                    />
                  </div>
                  <p className="text-[11px] text-text-muted mt-1.5 truncate">
                    {progress.done} of {progress.total} · {progress.current}
                  </p>
                </div>
              )}
            </div>

            {/* Transaction list */}
            <div className="flex-1 flex flex-col glass-card overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-2.5 border-b border-white/[0.08]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleAll}
                    className="accent-primary"
                  />
                  <span className="text-xs text-text-muted">Select all shown</span>
                </label>
              </div>

              {filtered.length === 0 ? (
                <EmptyState
                  className="flex-1"
                  icon={AlertTriangle}
                  tone="warning"
                  title="Nothing matched"
                  description="No transaction fits this date range and filter. Try widening it."
                />
              ) : (
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-bg-surface z-10">
                      <tr className="border-b border-white/[0.12] text-text-muted">
                        <th className="px-3 py-2.5 w-8" />
                        <th className="px-3 py-2.5 text-left font-medium">Date</th>
                        <th className="px-3 py-2.5 text-left font-medium">Type</th>
                        <th className="px-3 py-2.5 text-left font-medium">Payee</th>
                        <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                        <th className="px-3 py-2.5 text-left font-medium">Accounts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 500).map((t) => {
                        const canAct = action !== 'reclassify' || modifiable.includes(t.type)
                        return (
                          <tr
                            key={t.txnId}
                            onClick={() => toggle(t.txnId)}
                            className={cn(
                              'border-b border-white/[0.05] cursor-pointer transition-colors',
                              selected.has(t.txnId)
                                ? 'bg-primary/[0.10]'
                                : 'hover:bg-primary/[0.05]',
                              !canAct && 'opacity-45'
                            )}
                          >
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selected.has(t.txnId)}
                                onChange={() => toggle(t.txnId)}
                                onClick={(e) => e.stopPropagation()}
                                className="accent-primary"
                              />
                            </td>
                            <td className="px-3 py-2 tabular-nums text-text-secondary">{t.date}</td>
                            <td className="px-3 py-2 text-text-secondary">{t.type}</td>
                            <td className="px-3 py-2 text-text-primary">{t.entity || '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                              {money(t.amount)}
                            </td>
                            <td className="px-3 py-2 text-text-muted truncate max-w-[280px]">
                              {t.accounts.join(', ') || '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {filtered.length > 500 && (
                    <p className="text-text-muted text-xs text-center py-3">
                      Showing first 500 of {filtered.length}. Narrow the filter to reach the rest.
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Confirm — the last stop before anything is written */}
        <AnimatePresence>
          {confirming && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
              onClick={() => setConfirming(false)}
            >
              <motion.div
                initial={{ scale: 0.96, y: 8 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.96, y: 8 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-card p-6 max-w-md w-full"
              >
                <div className="flex items-start gap-3 mb-4">
                  <ShieldAlert
                    size={20}
                    className={cn(
                      'flex-shrink-0 mt-0.5',
                      action === 'void' ? 'text-danger' : 'text-warning'
                    )}
                  />
                  <div>
                    <h3 className="font-heading text-lg font-bold text-text-primary">
                      {action === 'void' ? 'Void these transactions?' : 'Apply this change?'}
                    </h3>
                    <p className="text-xs text-text-muted mt-1.5 leading-relaxed">
                      {actionDescription()}
                    </p>
                  </div>
                </div>

                {ineligibleCount > 0 && (
                  <p className="text-[11px] text-warning mb-4">
                    {ineligibleCount} selected transaction{ineligibleCount === 1 ? '' : 's'} will be
                    skipped — Pulse cannot safely edit that type.
                  </p>
                )}

                <p className="text-[11px] text-text-disabled mb-5">
                  This writes to the company file. Pulse cannot undo it.
                </p>

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setConfirming(false)}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-bg-elevated border border-white/[0.12] text-text-secondary hover:text-text-primary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={run}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors',
                      action === 'void' ? 'bg-danger hover:bg-danger-hover' : 'btn-primary'
                    )}
                  >
                    {action === 'void' ? `Void ${eligible.length}` : `Apply to ${eligible.length}`}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
