import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  PackagePlus,
  Download,
  Upload,
  Loader2,
  WifiOff,
  FolderOpen,
  CheckCircle2,
  XCircle,
  MinusCircle,
  ArrowRight
} from 'lucide-react'
import { toast } from 'sonner'
import { useQBStore } from '../store/useQBStore'
import EmptyState from '../components/ui/EmptyState'
import { cn } from '../utils/cn'
import type { CompanyTemplate, TemplateSection, ReplaySummary } from '../types/electron'

const SECTIONS: { id: TemplateSection; label: string; hint: string }[] = [
  { id: 'accounts', label: 'Chart of Accounts', hint: 'Account names, types and numbers' },
  { id: 'classes', label: 'Classes', hint: 'Class list and hierarchy' },
  { id: 'items', label: 'Service Items', hint: 'Names only — map income accounts in QuickBooks' },
  { id: 'customers', label: 'Customers', hint: 'Names only, no balances' },
  { id: 'vendors', label: 'Vendors', hint: 'Names only, no balances' }
]

export default function SetupPage() {
  const { status } = useQBStore()

  const [chosen, setChosen] = useState<Set<TemplateSection>>(
    new Set<TemplateSection>(['accounts', 'classes'])
  )
  const [template, setTemplate] = useState<CompanyTemplate | null>(null)
  const [busy, setBusy] = useState<'capture' | 'replay' | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(
    null
  )
  const [summary, setSummary] = useState<ReplaySummary | null>(null)

  useEffect(() => {
    const off = window.api.qb.onTemplateProgress((p) => setProgress(p))
    return off
  }, [])

  const toggle = (id: TemplateSection): void => {
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCapture = async (): Promise<void> => {
    if (!status.connected) {
      toast.error('Connect to the file you want to copy FROM')
      return
    }
    if (chosen.size === 0) {
      toast.error('Pick at least one list to capture')
      return
    }

    const save = await window.api.files.saveDialog({
      title: 'Save Company Template',
      defaultPath: `${(status.companyName || 'company').replace(/[^\w]+/g, '_')}_template.json`,
      filters: [{ name: 'Pulse Template', extensions: ['json'] }]
    })
    if (save.canceled || !save.filePath) return

    setBusy('capture')
    setSummary(null)
    try {
      const res = await window.api.qb.captureTemplate([...chosen], save.filePath)
      if (res.success && res.data) {
        setTemplate(res.data)
        const total = SECTIONS.reduce((n, s) => n + res.data![s.id].length, 0)
        toast.success(`Captured ${total.toLocaleString()} entries`)
      } else {
        toast.error(res.error || 'Capture failed')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Capture failed')
    } finally {
      setBusy(null)
    }
  }

  const handleLoad = async (): Promise<void> => {
    const open = await window.api.files.openDialog({
      title: 'Open Company Template',
      filters: [{ name: 'Pulse Template', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (open.canceled || !open.filePaths[0]) return

    const res = await window.api.qb.readTemplate(open.filePaths[0])
    if (res.success && res.data) {
      setTemplate(res.data)
      setSummary(null)
      toast.success(`Loaded template from ${res.data.sourceCompany}`)
    } else {
      toast.error(res.error || 'Could not read that template')
    }
  }

  const handleReplay = async (): Promise<void> => {
    if (!template) return
    if (!status.connected) {
      toast.error('Connect to the NEW company file first')
      return
    }
    if (chosen.size === 0) {
      toast.error('Pick at least one list to create')
      return
    }

    setBusy('replay')
    setProgress({ done: 0, total: 0, current: '' })
    try {
      const res = await window.api.qb.replayTemplate(template, [...chosen])
      if (res.success && res.data) {
        setSummary(res.data)
        const { created, exists, failed } = res.data
        if (failed === 0) {
          toast.success(`Created ${created}${exists ? `, ${exists} already existed` : ''}`)
        } else {
          toast.warning(`Created ${created}, ${failed} failed`)
        }
      } else {
        toast.error(res.error || 'Setup failed')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  const templateCount = (id: TemplateSection): number => template?.[id].length ?? 0

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl mx-auto w-full flex flex-col h-full gap-4 overflow-y-auto"
      >
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">New Client Setup</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Copy a chart of accounts and lists from one company file into another
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

        {/* The two-connection flow is the whole mental model, so lead with it. */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-elevated border border-white/[0.08]">
              <span className="w-5 h-5 rounded bg-primary/20 text-primary grid place-items-center font-mono text-[10px]">
                1
              </span>
              <span className="text-text-secondary">Connect to the template file, capture</span>
            </div>
            <ArrowRight size={14} className="text-text-disabled flex-shrink-0" />
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-elevated border border-white/[0.08]">
              <span className="w-5 h-5 rounded bg-primary/20 text-primary grid place-items-center font-mono text-[10px]">
                2
              </span>
              <span className="text-text-secondary">Open the new file in QuickBooks, reconnect</span>
            </div>
            <ArrowRight size={14} className="text-text-disabled flex-shrink-0" />
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-elevated border border-white/[0.08]">
              <span className="w-5 h-5 rounded bg-primary/20 text-primary grid place-items-center font-mono text-[10px]">
                3
              </span>
              <span className="text-text-secondary">Create the lists</span>
            </div>
          </div>
          <p className="text-[11px] text-text-disabled mt-3">
            QuickBooks lets one company file be open at a time, so the template goes through a file
            on disk. Keep that file — it is reusable for every client of the same type.
          </p>
        </div>

        {/* What to copy */}
        <div className="glass-card p-5">
          <h2 className="font-semibold text-text-primary text-sm mb-4">What to copy</h2>
          <div className="grid grid-cols-2 gap-2">
            {SECTIONS.map((s) => (
              <label
                key={s.id}
                className={cn(
                  'flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors',
                  chosen.has(s.id)
                    ? 'bg-primary/[0.10] border-primary/30'
                    : 'bg-bg-surface border-white/[0.10] hover:border-white/[0.18]'
                )}
              >
                <input
                  type="checkbox"
                  checked={chosen.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="accent-primary mt-0.5"
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-primary">
                    {s.label}
                    {template && (
                      <span className="ml-1.5 text-text-muted tabular-nums font-normal">
                        ({templateCount(s.id).toLocaleString()})
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5">{s.hint}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-4">
          <div className="glass-card p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Download size={15} className="text-primary" />
              <h3 className="font-semibold text-text-primary text-sm">Capture</h3>
            </div>
            <p className="text-[11.5px] text-text-muted flex-1">
              Read the connected file&rsquo;s lists and save them as a reusable template. Only active
              entries are captured.
            </p>
            <button
              onClick={handleCapture}
              disabled={!status.connected || busy !== null}
              className={cn(
                'flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all',
                status.connected && busy === null
                  ? 'btn-primary'
                  : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
              )}
            >
              {busy === 'capture' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {busy === 'capture' ? 'Capturing…' : 'Capture from this file'}
            </button>
          </div>

          <div className="glass-card p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Upload size={15} className="text-success" />
              <h3 className="font-semibold text-text-primary text-sm">Create</h3>
            </div>
            <p className="text-[11.5px] text-text-muted flex-1">
              {template
                ? `Ready: ${template.sourceCompany}, captured ${new Date(template.createdAt).toLocaleDateString()}.`
                : 'Load a template, then create its lists in the connected file. Existing names are left alone.'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleLoad}
                disabled={busy !== null}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-bg-elevated border border-white/[0.12] text-text-secondary hover:text-text-primary transition-colors"
              >
                <FolderOpen size={14} />
                Load
              </button>
              <button
                onClick={handleReplay}
                disabled={!template || !status.connected || busy !== null}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all',
                  template && status.connected && busy === null
                    ? 'btn-success'
                    : 'bg-bg-elevated text-text-disabled border border-white/[0.12] cursor-not-allowed'
                )}
              >
                {busy === 'replay' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
                {busy === 'replay' ? 'Creating…' : 'Create in this file'}
              </button>
            </div>
          </div>
        </div>

        {busy === 'replay' && progress && progress.total > 0 && (
          <div className="glass-card p-4">
            <div className="h-1 rounded-full bg-bg-elevated overflow-hidden">
              <motion.div
                className="h-full bg-success"
                animate={{ width: `${(progress.done / progress.total) * 100}%` }}
                transition={{ duration: 0.2 }}
              />
            </div>
            <p className="text-[11px] text-text-muted mt-1.5 truncate">
              {progress.done} of {progress.total} · {progress.current}
            </p>
          </div>
        )}

        {/* Results */}
        {summary && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card overflow-hidden"
          >
            <div className="flex items-center gap-4 px-5 py-3 border-b border-white/[0.08]">
              <p className="text-sm font-semibold text-text-primary">Setup complete</p>
              <div className="flex items-center gap-3 ml-auto text-xs">
                <span className="flex items-center gap-1.5 text-success">
                  <CheckCircle2 size={13} /> {summary.created} created
                </span>
                {summary.exists > 0 && (
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <MinusCircle size={13} /> {summary.exists} already there
                  </span>
                )}
                {summary.failed > 0 && (
                  <span className="flex items-center gap-1.5 text-danger">
                    <XCircle size={13} /> {summary.failed} failed
                  </span>
                )}
              </div>
            </div>

            {summary.failed > 0 && (
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs border-collapse">
                  <tbody>
                    {summary.results
                      .filter((r) => r.status === 'failed')
                      .map((r, i) => (
                        <tr
                          key={`${r.name}-${i}`}
                          className="border-b border-white/[0.05] text-text-secondary"
                        >
                          <td className="px-4 py-2 w-24 text-text-muted">{r.section}</td>
                          <td className="px-3 py-2 w-56 truncate text-text-primary">{r.name}</td>
                          <td className="px-3 py-2 text-danger">{r.message}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

        {!template && !summary && (
          <div className="glass-card">
            <EmptyState
              icon={PackagePlus}
              tone="primary"
              title="Start with a template file"
              description="Capture from a well-built company file once, then reuse it for every new client of that type. Nothing here deletes — names that already exist are skipped."
            />
          </div>
        )}
      </motion.div>
    </div>
  )
}
