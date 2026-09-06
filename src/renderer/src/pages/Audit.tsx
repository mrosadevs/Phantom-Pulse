import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  FileWarning,
  Trash2,
  Receipt
} from 'lucide-react'
import { toast } from 'sonner'
import { useAnalysisStore } from '../store/useAnalysisStore'
import ScanBar from '../components/ScanBar'
import EmptyState from '../components/ui/EmptyState'
import { cn } from '../utils/cn'
import type { CloseCheck } from '../types/electron'

type Tab = '1099' | 'close' | 'deleted'

const TABS: { id: Tab; label: string; icon: typeof Receipt }[] = [
  { id: '1099', label: '1099 Readiness', icon: Receipt },
  { id: 'close', label: 'Period Close', icon: ShieldCheck },
  { id: 'deleted', label: 'Deletion Log', icon: Trash2 }
]

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

const STATUS_STYLE: Record<CloseCheck['status'], { icon: typeof CheckCircle2; cls: string }> = {
  pass: { icon: CheckCircle2, cls: 'text-success' },
  warn: { icon: AlertTriangle, cls: 'text-warning' },
  fail: { icon: XCircle, cls: 'text-danger' }
}

export default function AuditPage() {
  const { result, isScanning } = useAnalysisStore()
  const [tab, setTab] = useState<Tab>('1099')
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)

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

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-6xl mx-auto w-full flex flex-col h-full gap-4"
      >
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">Audit</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Compliance checks that read the file and change nothing
          </p>
        </div>

        <ScanBar
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          includeDeleted={includeDeleted}
          onIncludeDeleted={setIncludeDeleted}
        />

        {/* Tabs */}
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
              {result && t.id === '1099' && result.vendors1099.length > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-warning/20 text-warning text-[10px]">
                  {result.vendors1099.length}
                </span>
              )}
              {result && t.id === 'deleted' && result.deleted.length > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-bg-overlay text-text-muted text-[10px]">
                  {result.deleted.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {!result && !isScanning && (
          <div className="flex-1 flex items-center justify-center glass-card">
            <EmptyState
              icon={ShieldCheck}
              tone="primary"
              title="Scan the file to begin"
              description="Nothing here writes to QuickBooks. Every check below reads the company file and reports what it finds."
            />
          </div>
        )}

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col glass-card overflow-hidden"
          >
            {/* ── 1099 readiness ── */}
            {tab === '1099' && (
              <>
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08]">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">1099 Readiness</p>
                    <p className="text-[11px] text-text-muted">
                      Vendors at or over {money(result.threshold1099)}, or already flagged
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      exportRows(
                        '1099 Readiness',
                        ['Vendor', 'Paid', 'Eligible', 'Has Tax ID', 'Issues'],
                        result.vendors1099.map((v) => ({
                          Vendor: v.vendor,
                          Paid: v.paid.toFixed(2),
                          Eligible: v.eligible ? 'Yes' : 'No',
                          'Has Tax ID': v.hasTaxId ? 'Yes' : 'No',
                          Issues: v.issues.join('; ')
                        }))
                      )
                    }
                    disabled={!result.vendors1099.length}
                    className={cn(
                      'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium',
                      result.vendors1099.length
                        ? 'btn-success'
                        : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
                    )}
                  >
                    <Download size={14} />
                    Export
                  </button>
                </div>

                {result.vendors1099.length === 0 ? (
                  <EmptyState
                    className="flex-1"
                    icon={CheckCircle2}
                    tone="success"
                    title="No 1099 problems found"
                    description="Every vendor over the threshold is flagged correctly and has a tax ID on file."
                  />
                ) : (
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 bg-bg-surface z-10">
                        <tr className="border-b border-white/[0.12] text-text-muted">
                          <th className="px-3 py-2.5 text-left font-medium">Vendor</th>
                          <th className="px-3 py-2.5 text-right font-medium">Paid</th>
                          <th className="px-3 py-2.5 text-center font-medium">1099</th>
                          <th className="px-3 py-2.5 text-center font-medium">Tax ID</th>
                          <th className="px-3 py-2.5 text-left font-medium">Needs attention</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.vendors1099.map((v) => (
                          <tr
                            key={v.listId || v.vendor}
                            className="border-b border-white/[0.05] hover:bg-primary/[0.06] text-text-secondary"
                          >
                            <td className="px-3 py-2 font-medium text-text-primary">{v.vendor}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{money(v.paid)}</td>
                            <td className="px-3 py-2 text-center">
                              {v.eligible ? (
                                <CheckCircle2 size={13} className="text-success inline" />
                              ) : (
                                <XCircle size={13} className="text-text-disabled inline" />
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {v.hasTaxId ? (
                                <CheckCircle2 size={13} className="text-success inline" />
                              ) : (
                                <XCircle size={13} className="text-danger inline" />
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-col gap-0.5">
                                {v.issues.map((i) => (
                                  <span key={i} className="text-warning text-[11px]">
                                    {i}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className="px-5 py-2 border-t border-white/[0.08] text-[11px] text-text-disabled">
                  Totals are summed from bills, checks and card charges. QuickBooks&rsquo; own 1099
                  figure depends on account mapping the SDK cannot read — treat this as a readiness
                  check, not the filing number.
                </p>
              </>
            )}

            {/* ── Period close ── */}
            {tab === 'close' && (
              <div className="flex-1 overflow-auto p-5">
                <div className="flex flex-col gap-2.5">
                  {result.closeChecks.map((c, i) => {
                    const s = STATUS_STYLE[c.status]
                    return (
                      <motion.div
                        key={c.id}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className={cn(
                          'flex items-start gap-3 p-4 rounded-xl border',
                          c.status === 'pass'
                            ? 'bg-success/[0.06] border-success/20'
                            : c.status === 'warn'
                              ? 'bg-warning/[0.06] border-warning/20'
                              : 'bg-danger/[0.06] border-danger/20'
                        )}
                      >
                        <s.icon size={16} className={cn('flex-shrink-0 mt-0.5', s.cls)} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text-primary">{c.label}</p>
                          <p className="text-xs text-text-muted mt-0.5">{c.detail}</p>
                        </div>
                        {c.count > 0 && (
                          <span
                            className={cn(
                              'ml-auto flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-medium tabular-nums',
                              c.status === 'fail'
                                ? 'bg-danger/20 text-danger'
                                : 'bg-warning/20 text-warning'
                            )}
                          >
                            {c.count.toLocaleString()}
                          </span>
                        )}
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Deletion log ── */}
            {tab === 'deleted' && (
              <>
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08]">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Deletion Log</p>
                    <p className="text-[11px] text-text-muted">
                      What QuickBooks still remembers being removed
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      exportRows(
                        'Deletion Log',
                        ['Kind', 'Type', 'Name', 'Ref', 'Deleted', 'Created'],
                        result.deleted.map((d) => ({
                          Kind: d.kind,
                          Type: d.type,
                          Name: d.name,
                          Ref: d.refNumber,
                          Deleted: d.timeDeleted,
                          Created: d.timeCreated
                        }))
                      )
                    }
                    disabled={!result.deleted.length}
                    className={cn(
                      'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium',
                      result.deleted.length
                        ? 'btn-success'
                        : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
                    )}
                  >
                    <Download size={14} />
                    Export
                  </button>
                </div>

                {!includeDeleted ? (
                  <EmptyState
                    className="flex-1"
                    icon={FileWarning}
                    tone="neutral"
                    title="Deletion log not included in this scan"
                    description="Tick “Include deletion log” above and rescan. It is off by default because it adds a request per transaction type."
                  />
                ) : result.deleted.length === 0 ? (
                  <EmptyState
                    className="flex-1"
                    icon={CheckCircle2}
                    tone="success"
                    title="Nothing deleted in this window"
                    description="QuickBooks retains roughly 90 days of deletions, so an empty result means nothing was removed recently — not that nothing ever was."
                  />
                ) : (
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 bg-bg-surface z-10">
                        <tr className="border-b border-white/[0.12] text-text-muted">
                          <th className="px-3 py-2.5 text-left font-medium">Kind</th>
                          <th className="px-3 py-2.5 text-left font-medium">Type</th>
                          <th className="px-3 py-2.5 text-left font-medium">Name / Ref</th>
                          <th className="px-3 py-2.5 text-left font-medium">Deleted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.deleted.map((d, i) => (
                          <tr
                            key={`${d.txnId}-${i}`}
                            className="border-b border-white/[0.05] hover:bg-primary/[0.06] text-text-secondary"
                          >
                            <td className="px-3 py-2">{d.kind}</td>
                            <td className="px-3 py-2 text-text-primary font-medium">{d.type}</td>
                            <td className="px-3 py-2">{d.name || d.refNumber || d.txnId}</td>
                            <td className="px-3 py-2 tabular-nums">
                              {d.timeDeleted ? new Date(d.timeDeleted).toLocaleString() : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
