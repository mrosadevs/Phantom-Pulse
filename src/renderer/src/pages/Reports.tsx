import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3,
  Loader2,
  Download,
  WifiOff,
  AlertCircle,
  Calendar,
  Scale,
  FileSpreadsheet
} from 'lucide-react'
import { toast } from 'sonner'
import { useQBStore } from '../store/useQBStore'
import { useHistoryStore } from '../store/useHistoryStore'
import EmptyState from '../components/ui/EmptyState'
import { cn } from '../utils/cn'
import type { ReportSpec, ParsedReport, ReportOptions } from '../types/electron'

/**
 * QuickBooks date macros.
 *
 * Preferred over explicit dates because they keep their meaning: a report saved
 * as "Last Month" stays last month next month, where a frozen date range does
 * not.  "Custom" falls through to the two date inputs.
 */
const DATE_PRESETS: { id: string; label: string }[] = [
  { id: 'ThisMonthToDate', label: 'This month' },
  { id: 'LastMonth', label: 'Last month' },
  { id: 'ThisFiscalQuarterToDate', label: 'This quarter' },
  { id: 'LastFiscalQuarter', label: 'Last quarter' },
  { id: 'ThisFiscalYearToDate', label: 'Year to date' },
  { id: 'LastFiscalYear', label: 'Last year' },
  { id: 'All', label: 'All dates' },
  { id: 'custom', label: 'Custom…' }
]

/** Right-align anything that reads as a figure, so columns line up. */
function isNumeric(value: string): boolean {
  if (!value) return false
  return /^-?[($]?-?[\d,]+\.?\d*%?\)?$/.test(value.trim())
}

export default function ReportsPage() {
  const { status } = useQBStore()
  const { add: addHistory } = useHistoryStore()

  const [specs, setSpecs] = useState<ReportSpec[]>([])
  const [selectedId, setSelectedId] = useState('pnl')
  const [preset, setPreset] = useState('ThisFiscalYearToDate')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [basis, setBasis] = useState<'Accrual' | 'Cash'>('Accrual')

  const [isRunning, setIsRunning] = useState(false)
  const [report, setReport] = useState<ParsedReport | null>(null)
  const [ranSpec, setRanSpec] = useState<ReportSpec | null>(null)

  useEffect(() => {
    window.api.qb.listReports().then((r) => {
      if (r.success && r.data) setSpecs(r.data)
    })
  }, [])

  const selected = specs.find((s) => s.id === selectedId)

  /** Aging reports have no cash/accrual basis — hide the control rather than send something QB rejects. */
  const acceptsBasis = selected ? selected.family === 'summary' || selected.family === 'detail' : true

  const grouped = useMemo(() => {
    const out: Record<string, ReportSpec[]> = {}
    for (const s of specs) (out[s.group] ??= []).push(s)
    return out
  }, [specs])

  const handleRun = async () => {
    if (!status.connected) {
      toast.error('Connect to QuickBooks Desktop first')
      return
    }
    if (!selected) return

    if (preset === 'custom' && !fromDate && !toDate) {
      toast.error('Pick at least one date, or choose a preset range')
      return
    }

    setIsRunning(true)
    try {
      const options: ReportOptions =
        preset === 'custom'
          ? { from: fromDate || undefined, to: toDate || undefined }
          : { dateMacro: preset }

      if (acceptsBasis) options.basis = basis

      const result = await window.api.qb.runReport(selected.id, options)

      if (result.success && result.data) {
        setReport(result.data)
        setRanSpec(selected)

        if (result.data.rows.length === 0) {
          toast.info('QuickBooks returned an empty report for this period')
        } else {
          toast.success(`${selected.label} — ${result.data.rows.length} rows`)
        }

        // A variant above 0 means QuickBooks rejected part of the request and we
        // retried without it.  The numbers are still QuickBooks' own, but the
        // user asked for something they did not get, so say so.
        if (result.data.variant > 0) {
          toast.warning(
            'QuickBooks did not accept every option for this report — it ran with the ones it allows.'
          )
        }
      } else {
        setReport(null)
        toast.error(result.error || 'QuickBooks could not run that report')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Report failed')
    } finally {
      setIsRunning(false)
    }
  }

  const handleExport = async () => {
    if (!report || !ranSpec) return

    const flat = await window.api.qb.reportToRows(report)
    if (!flat.success || !flat.data) {
      toast.error(flat.error || 'Could not prepare the export')
      return
    }

    const save = await window.api.files.saveDialog({
      title: 'Export Report',
      defaultPath: `${ranSpec.label.replace(/[^\w]+/g, '_')}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (save.canceled || !save.filePath) return

    // exportExcel takes objects keyed by header, so rebuild each row against the
    // header list.  Blank headings get a positional key or they would collide.
    const headers = flat.data.headers.map((h, i) => h || `Column ${i + 1}`)
    const objects = flat.data.rows.map((cells) => {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => {
        obj[h] = cells[i] ?? ''
      })
      return obj
    })

    const result = await window.api.files.exportExcel(objects, headers, save.filePath)
    if (result.success) {
      toast.success(`Exported ${objects.length} rows`)
      await addHistory({
        operation: 'export',
        type: ranSpec.label,
        count: objects.length,
        successCount: objects.length,
        failCount: 0,
        mode: 'qbsdk'
      })
    } else {
      toast.error(result.error || 'Export failed')
    }
  }

  const width = report
    ? Math.max(report.columns.length, ...report.rows.map((r) => r.cells.length), 1)
    : 0

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-6xl mx-auto w-full flex flex-col h-full gap-4"
      >
        {/* Header */}
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">Reports</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Financial statements and analysis, calculated by QuickBooks itself
          </p>
        </div>

        {!status.connected && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-warning/10 border border-warning/30">
            <WifiOff size={16} className="text-warning flex-shrink-0" />
            <div>
              <p className="text-warning text-sm font-medium">Not connected to QuickBooks Desktop</p>
              <p className="text-text-muted text-xs mt-0.5">
                Go to Settings to connect. Reports are read from a live QB connection.
              </p>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} className="text-primary" />
            <h2 className="font-semibold text-text-primary text-sm">Report Options</h2>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-text-muted mb-1.5 block font-medium">Report</label>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="input-field w-full text-sm"
              >
                {Object.entries(grouped).map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {selected && <p className="text-[11px] text-text-muted mt-1.5">{selected.blurb}</p>}
            </div>

            <div>
              <label className="text-xs text-text-muted mb-1.5 block font-medium">
                {selected && !selected.ranged ? 'As of' : 'Period'}
              </label>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                className="input-field w-full text-sm"
              >
                {DATE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-text-muted mb-1.5 block font-medium">Basis</label>
              {acceptsBasis ? (
                <div className="flex gap-2">
                  {(['Accrual', 'Cash'] as const).map((b) => (
                    <button
                      key={b}
                      onClick={() => setBasis(b)}
                      className={cn(
                        'flex-1 py-2 rounded-lg text-xs font-medium border transition-all duration-150',
                        basis === b
                          ? 'bg-primary/20 border-primary/40 text-primary'
                          : 'bg-bg-surface border-white/[0.12] text-text-muted hover:text-text-primary hover:border-white/[0.18]'
                      )}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 h-[38px] px-3 rounded-lg bg-bg-elevated/60 border border-white/[0.08]">
                  <Scale size={13} className="text-text-disabled flex-shrink-0" />
                  <span className="text-[11px] text-text-disabled">Not used by this report</span>
                </div>
              )}
            </div>
          </div>

          {preset === 'custom' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="grid grid-cols-4 gap-4 mt-4 overflow-hidden"
            >
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
            </motion.div>
          )}

          <div className="flex justify-end mt-4">
            <button
              onClick={handleRun}
              disabled={!status.connected || isRunning || !selected}
              className={cn(
                'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                status.connected && !isRunning && selected
                  ? 'btn-primary'
                  : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
              )}
            >
              {isRunning ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
              {isRunning ? 'Running…' : 'Run Report'}
            </button>
          </div>
        </div>

        {/* Idle */}
        {!report && !isRunning && (
          <div className="flex-1 flex items-center justify-center glass-card">
            <EmptyState
              icon={BarChart3}
              tone="primary"
              title="Pick a report to begin"
              description="Every figure comes straight from QuickBooks' own report engine, so the numbers here always match what your client sees in QuickBooks."
            />
          </div>
        )}

        {/* Running — a wide General Ledger can take QuickBooks a while, so say so */}
        {isRunning && (
          <div className="flex-1 flex items-center justify-center glass-card">
            <EmptyState
              icon={Loader2}
              tone="primary"
              title="QuickBooks is building the report"
              description="Large date ranges take a moment — QuickBooks computes the whole report before sending any of it back."
            />
          </div>
        )}

        {/* Result */}
        {report && !isRunning && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col glass-card overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08] gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">
                  {report.title || ranSpec?.label}
                </p>
                <p className="text-[11px] text-text-muted truncate">
                  {[report.subtitle, report.basis && `${report.basis} basis`]
                    .filter(Boolean)
                    .join(' · ') || ' '}
                </p>
              </div>

              <button
                onClick={handleExport}
                disabled={!report.rows.length}
                className={cn(
                  'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex-shrink-0',
                  report.rows.length
                    ? 'btn-success'
                    : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
                )}
              >
                <Download size={14} />
                Export XLSX
              </button>
            </div>

            {report.rows.length === 0 ? (
              <EmptyState
                className="flex-1"
                icon={AlertCircle}
                tone="warning"
                title="Nothing to show for this period"
                description="QuickBooks ran the report but found no activity in the range you picked. Try widening the period."
              />
            ) : (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-bg-surface z-10">
                    <tr className="border-b border-white/[0.12]">
                      {Array.from({ length: width }).map((_, i) => (
                        <th
                          key={i}
                          className={cn(
                            'px-3 py-2.5 text-text-muted font-medium whitespace-nowrap',
                            i === 0 ? 'text-left' : 'text-right'
                          )}
                        >
                          {report.columns[i] || (i === 0 ? '' : ' ')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, i) => (
                      <tr
                        key={i}
                        className={cn(
                          'border-b transition-colors duration-150',
                          row.kind === 'total'
                            ? 'border-white/[0.14] bg-primary/[0.05] font-semibold text-text-primary'
                            : row.kind === 'subtotal'
                              ? 'border-white/[0.10] font-medium text-text-secondary'
                              : row.kind === 'text'
                                ? 'border-transparent text-text-muted'
                                : 'border-white/[0.05] text-text-secondary hover:bg-primary/[0.06]'
                        )}
                      >
                        {Array.from({ length: width }).map((_, c) => {
                          const value = c === 0 ? row.label : (row.cells[c] ?? '')
                          return (
                            <td
                              key={c}
                              className={cn(
                                'px-3 py-1.5',
                                c === 0
                                  ? 'text-left max-w-[420px] truncate'
                                  : 'text-right tabular-nums whitespace-nowrap',
                                c === 0 && row.kind === 'text' && 'italic'
                              )}
                              // Hierarchy comes from QuickBooks' nesting; indent
                              // the label column so parents and children read
                              // correctly rather than as peers.
                              style={c === 0 ? { paddingLeft: 12 + row.depth * 16 } : undefined}
                            >
                              {c > 0 && isNumeric(value) ? value : value || (c === 0 ? '' : '')}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center gap-2 px-5 py-2 border-t border-white/[0.08] text-[11px] text-text-disabled">
              <FileSpreadsheet size={12} />
              {report.rows.length.toLocaleString()} rows · computed by QuickBooks
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
