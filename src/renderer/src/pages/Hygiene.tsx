import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Sparkles,
  Copy,
  HelpCircle,
  Archive,
  Download,
  CheckCircle2,
  ChevronRight
} from 'lucide-react'
import { toast } from 'sonner'
import { useAnalysisStore } from '../store/useAnalysisStore'
import ScanBar from '../components/ScanBar'
import EmptyState from '../components/ui/EmptyState'
import { cn } from '../utils/cn'

type Tab = 'duplicates' | 'uncategorized' | 'dead'

const TABS: { id: Tab; label: string; icon: typeof Copy }[] = [
  { id: 'duplicates', label: 'Possible Duplicates', icon: Copy },
  { id: 'uncategorized', label: 'Uncategorized', icon: HelpCircle },
  { id: 'dead', label: 'Never Used', icon: Archive }
]

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export default function HygienePage() {
  const { result, isScanning, range } = useAnalysisStore()
  const [tab, setTab] = useState<Tab>('duplicates')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const exportRows = async (
    name: string,
    headers: string[],
    rows: Record<string, string>[]
  ): Promise<void> => {
    if (!rows.length) return
    const save = await window.api.files.saveDialog({
      title: `Export ${name}`,
      defaultPath: `${name.replace(/[^\w]+/g, '_')}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (save.canceled || !save.filePath) return
    const res = await window.api.files.exportExcel(rows, headers, save.filePath)
    if (res.success) toast.success(`Exported ${rows.length} rows`)
    else toast.error(res.error || 'Export failed')
  }

  const counts = result
    ? {
        duplicates: result.duplicates.length,
        uncategorized: result.uncategorized.length,
        dead: result.deadListItems.length
      }
    : { duplicates: 0, uncategorized: 0, dead: 0 }

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-6xl mx-auto w-full flex flex-col h-full gap-4"
      >
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">Clean Up</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Find what is duplicated, uncoded, or cluttering the file
          </p>
        </div>

        <ScanBar from={from} to={to} onFrom={setFrom} onTo={setTo} />

        <div className="flex gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border transition-all duration-150',
                tab === t.id
                  ? 'bg-primary/20 border-primary/40 text-primary'
                  : 'bg-bg-surface border-white/[0.12] text-text-muted hover:text-text-primary hover:border-white/[0.18]'
              )}
            >
              <t.icon size={13} />
              {t.label}
              {result && counts[t.id] > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-warning/20 text-warning text-[10px] tabular-nums">
                  {counts[t.id]}
                </span>
              )}
            </button>
          ))}
        </div>

        {!result && !isScanning && (
          <div className="flex-1 flex items-center justify-center glass-card">
            <EmptyState
              icon={Sparkles}
              tone="primary"
              title="Scan the file to begin"
              description="Nothing on this page changes QuickBooks. Findings here are a review queue — send them to Bulk Edit or Delete when you have decided what to do."
            />
          </div>
        )}

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col glass-card overflow-hidden"
          >
            {/* ── Duplicates ── */}
            {tab === 'duplicates' && (
              <>
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08]">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Possible Duplicates</p>
                    <p className="text-[11px] text-text-muted">
                      Same payee, same amount, within a few days of each other
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      exportRows(
                        'Possible Duplicates',
                        ['Payee', 'Amount', 'Type', 'Date', 'Ref', 'TxnID'],
                        result.duplicates.flatMap((g) =>
                          g.transactions.map((t) => ({
                            Payee: g.entity,
                            Amount: g.amount.toFixed(2),
                            Type: t.type,
                            Date: t.date,
                            Ref: t.refNumber,
                            TxnID: t.txnId
                          }))
                        )
                      )
                    }
                    disabled={!result.duplicates.length}
                    className={cn(
                      'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium',
                      result.duplicates.length
                        ? 'btn-success'
                        : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
                    )}
                  >
                    <Download size={14} />
                    Export
                  </button>
                </div>

                {result.duplicates.length === 0 ? (
                  <EmptyState
                    className="flex-1"
                    icon={CheckCircle2}
                    tone="success"
                    title="No apparent duplicates"
                    description="Nothing in range matches another transaction closely enough to look like a double entry."
                  />
                ) : (
                  <div className="flex-1 overflow-auto p-4 flex flex-col gap-2">
                    {result.duplicates.map((g) => {
                      const open = expanded.has(g.key)
                      return (
                        <div
                          key={g.key}
                          className="rounded-xl border border-white/[0.08] bg-bg-surface/60 overflow-hidden"
                        >
                          <button
                            onClick={() => toggle(g.key)}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/[0.05] transition-colors text-left"
                          >
                            <ChevronRight
                              size={14}
                              className={cn(
                                'text-text-muted transition-transform flex-shrink-0',
                                open && 'rotate-90'
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-text-primary truncate">
                                {g.entity || 'No payee'}
                              </p>
                              <p className="text-[11px] text-text-muted">
                                {g.transactions.length} transactions · {g.transactions[0].type}
                              </p>
                            </div>
                            <span className="text-sm tabular-nums text-warning font-medium flex-shrink-0">
                              {money(g.amount)}
                            </span>
                          </button>

                          {open && (
                            <table className="w-full text-xs border-t border-white/[0.06]">
                              <tbody>
                                {g.transactions.map((t) => (
                                  <tr
                                    key={t.txnId}
                                    className="border-b border-white/[0.04] last:border-0 text-text-secondary"
                                  >
                                    <td className="px-4 py-2 w-28 tabular-nums">{t.date}</td>
                                    <td className="px-3 py-2 w-32">{t.refNumber || '—'}</td>
                                    <td className="px-3 py-2 truncate">{t.memo || '—'}</td>
                                    <td className="px-3 py-2 w-56 truncate text-text-muted">
                                      {t.accounts.join(', ') || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                <p className="px-5 py-2 border-t border-white/[0.08] text-[11px] text-text-disabled">
                  Groups where every transaction has a different reference number are excluded — two
                  identical invoices with distinct numbers are usually genuinely distinct.
                </p>
              </>
            )}

            {/* ── Uncategorized ── */}
            {tab === 'uncategorized' && (
              <>
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08]">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Uncategorized</p>
                    <p className="text-[11px] text-text-muted">
                      Sitting in Uncategorized, Ask My Accountant, or a suspense account
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      exportRows(
                        'Uncategorized',
                        ['Date', 'Type', 'Payee', 'Amount', 'Account', 'Ref', 'TxnID'],
                        result.uncategorized.map((u) => ({
                          Date: u.txn.date,
                          Type: u.txn.type,
                          Payee: u.txn.entity,
                          Amount: u.txn.amount.toFixed(2),
                          Account: u.account,
                          Ref: u.txn.refNumber,
                          TxnID: u.txn.txnId
                        }))
                      )
                    }
                    disabled={!result.uncategorized.length}
                    className={cn(
                      'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium',
                      result.uncategorized.length
                        ? 'btn-success'
                        : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
                    )}
                  >
                    <Download size={14} />
                    Export
                  </button>
                </div>

                {result.uncategorized.length === 0 ? (
                  <EmptyState
                    className="flex-1"
                    icon={CheckCircle2}
                    tone="success"
                    title="Nothing is uncategorized"
                    description="No transaction in range is parked in a holding account."
                  />
                ) : (
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 bg-bg-surface z-10">
                        <tr className="border-b border-white/[0.12] text-text-muted">
                          <th className="px-3 py-2.5 text-left font-medium">Date</th>
                          <th className="px-3 py-2.5 text-left font-medium">Type</th>
                          <th className="px-3 py-2.5 text-left font-medium">Payee</th>
                          <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                          <th className="px-3 py-2.5 text-left font-medium">Sitting in</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.uncategorized.slice(0, 500).map((u, i) => (
                          <tr
                            key={`${u.txn.txnId}-${i}`}
                            className="border-b border-white/[0.05] hover:bg-primary/[0.06] text-text-secondary"
                          >
                            <td className="px-3 py-2 tabular-nums">{u.txn.date}</td>
                            <td className="px-3 py-2">{u.txn.type}</td>
                            <td className="px-3 py-2 text-text-primary">{u.txn.entity || '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {money(u.txn.amount)}
                            </td>
                            <td className="px-3 py-2 text-warning">{u.account}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {result.uncategorized.length > 500 && (
                      <p className="text-text-muted text-xs text-center py-3">
                        Showing first 500 of {result.uncategorized.length}. All are exported.
                      </p>
                    )}
                  </div>
                )}

                <p className="px-5 py-2 border-t border-white/[0.08] text-[11px] text-text-disabled">
                  These are the rows the Ledger page&rsquo;s payee-history engine can usually code
                  automatically — it already knows how each payee was coded before.
                </p>
              </>
            )}

            {/* ── Never used ── */}
            {tab === 'dead' && (
              <>
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08]">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Never Used</p>
                    <p className="text-[11px] text-text-muted">
                      List entries with no transactions and a zero balance
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      exportRows(
                        'Never Used',
                        ['Kind', 'Name', 'Detail', 'Active'],
                        result.deadListItems.map((d) => ({
                          Kind: d.kind,
                          Name: d.name,
                          Detail: d.detail,
                          Active: d.isActive ? 'Yes' : 'No'
                        }))
                      )
                    }
                    disabled={!result.deadListItems.length}
                    className={cn(
                      'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium',
                      result.deadListItems.length
                        ? 'btn-success'
                        : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
                    )}
                  >
                    <Download size={14} />
                    Export
                  </button>
                </div>

                {(range.from || range.to) && (
                  <div className="mx-4 mt-3 p-3 rounded-lg bg-warning/10 border border-warning/25">
                    <p className="text-warning text-[11.5px] font-medium">
                      This scan was date-limited, so &ldquo;never used&rdquo; only means &ldquo;not
                      used in that range&rdquo;.
                    </p>
                    <p className="text-text-muted text-[11px] mt-0.5">
                      Clear both dates and rescan before acting on anything here — an account that
                      was busy three years ago will otherwise look dead.
                    </p>
                  </div>
                )}

                {result.deadListItems.length === 0 ? (
                  <EmptyState
                    className="flex-1"
                    icon={CheckCircle2}
                    tone="success"
                    title="No unused list entries"
                    description="Every account, vendor, customer, item and class is referenced by at least one transaction."
                  />
                ) : (
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 bg-bg-surface z-10">
                        <tr className="border-b border-white/[0.12] text-text-muted">
                          <th className="px-3 py-2.5 text-left font-medium">Kind</th>
                          <th className="px-3 py-2.5 text-left font-medium">Name</th>
                          <th className="px-3 py-2.5 text-left font-medium">Detail</th>
                          <th className="px-3 py-2.5 text-center font-medium">Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.deadListItems.map((d) => (
                          <tr
                            key={`${d.kind}-${d.listId || d.name}`}
                            className="border-b border-white/[0.05] hover:bg-primary/[0.06] text-text-secondary"
                          >
                            <td className="px-3 py-2">{d.kind}</td>
                            <td className="px-3 py-2 text-text-primary font-medium">{d.name}</td>
                            <td className="px-3 py-2 text-text-muted">{d.detail || '—'}</td>
                            <td className="px-3 py-2 text-center">
                              {d.isActive ? (
                                <span className="text-success">Yes</span>
                              ) : (
                                <span className="text-text-disabled">No</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className="px-5 py-2 border-t border-white/[0.08] text-[11px] text-text-disabled">
                  Entries carrying a balance are excluded even when unused — those are load-bearing.
                  Make list entries inactive in QuickBooks rather than deleting them.
                </p>
              </>
            )}
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
