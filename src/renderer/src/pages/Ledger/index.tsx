import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText,
  Upload,
  Download,
  CheckCircle2,
  FolderOpen,
  RefreshCw,
  X,
  Pencil,
  Check,
  Loader2,
  ArrowRight,
  BadgeCheck,
  Sparkles,
  AlertCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { useQBStore } from '../../store/useQBStore'
import { parseStatementPdfs } from '../../utils/pdfStatementParser'
import { cleanAndNormalizeTransaction } from '../../utils/transactionCleaner'
import { matchToQB } from '../../utils/vendorMatcher'
import type { LedgerRow } from '../../types/electron'
import { cn } from '../../utils/cn'

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'review' | 'export'

interface LedgerRowWithMeta extends LedgerRow {
  id: number
  confidence: 'exact' | 'fuzzy' | 'none'
}

// ── Inline editable cell ──────────────────────────────────────────────────────

function EditableCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = () => {
    onSave(draft.trim() || value)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(value); setEditing(false) }
          }}
          className="flex-1 min-w-0 text-xs bg-bg-elevated border border-primary/40 rounded px-2 py-0.5 text-text-primary outline-none"
        />
        <button onClick={commit} className="text-success hover:text-success/80 flex-shrink-0"><Check size={11} /></button>
        <button onClick={() => { setDraft(value); setEditing(false) }} className="text-text-muted hover:text-danger flex-shrink-0"><X size={11} /></button>
      </div>
    )
  }

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true) }}
      className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary group text-left w-full min-w-0"
    >
      <span className="truncate">{value || <span className="text-text-disabled italic">—</span>}</span>
      <Pencil size={9} className="opacity-0 group-hover:opacity-40 flex-shrink-0" />
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LedgerPage() {
  const { status } = useQBStore()

  const [step, setStep] = useState<Step>('upload')
  const [files, setFiles] = useState<File[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [rows, setRows] = useState<LedgerRowWithMeta[]>([])
  const [savedPath, setSavedPath] = useState('')
  const [search, setSearch] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── File handling ───────────────────────────────────────────────────────────

  const addFiles = (incoming: FileList | File[]) => {
    const pdfs = Array.from(incoming).filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    if (pdfs.length === 0) { toast.error('Please select PDF files only.'); return }
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name))
      const newOnes = pdfs.filter((f) => !existing.has(f.name))
      return [...prev, ...newOnes]
    })
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    addFiles(e.dataTransfer.files)
  }, [])

  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.name !== name))

  // ── Process ─────────────────────────────────────────────────────────────────

  const handleProcess = async () => {
    if (files.length === 0) { toast.error('Add at least one PDF.'); return }
    setIsProcessing(true)
    try {
      // 1. Parse PDFs
      const parsed = await parseStatementPdfs(files)
      if (parsed.length === 0) {
        toast.error('No transactions found. Make sure these are QuickBooks or bank statement PDFs.')
        return
      }

      // 2. Clean descriptions
      const cleaned = parsed.map((t) => ({ ...t, clean: cleanAndNormalizeTransaction(t.description) }))

      // 3. Try QB vendor/account map if connected
      let qbMap: Record<string, string> = {}
      if (status.mode === 'qbsdk') {
        try {
          const res = await window.api.qb.getVendorAccountMap()
          if (res.success && res.data) qbMap = res.data
        } catch { /* non-fatal */ }
      }

      // 4. Match and build rows
      let matched = 0
      const result: LedgerRowWithMeta[] = cleaned.map((t, i) => {
        const match = matchToQB(t.clean, qbMap)
        if (match.confidence !== 'none') matched++
        return {
          id: i,
          date: t.date,
          clean: match.vendorName || t.clean,
          account: match.account || '',
          amount: t.amount,
          original: t.original,
          confidence: match.confidence
        }
      })

      setMatchCount(matched)
      setRows(result)
      setStep('review')
      toast.success(
        `${result.length} transactions processed${matched > 0 ? ` · ${matched} matched to QB` : ''}`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Processing failed')
    } finally {
      setIsProcessing(false)
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    const result = await window.api.files.saveDialog({
      title: 'Save Ledger Export',
      defaultPath: 'phantom-ledger.xlsx',
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return

    const exportRows: LedgerRow[] = rows.map(({ date, clean, account, amount, original }) => ({
      date, clean, account, amount, original
    }))

    const res = await window.api.files.exportLedger(exportRows, result.filePath)
    if (!res.success) {
      toast.error(res.error || 'Export failed')
      return
    }
    setSavedPath(result.filePath)
    setStep('export')
    toast.success('Excel file saved!')
  }

  // ── Row editing ─────────────────────────────────────────────────────────────

  const updateRow = (id: number, field: keyof LedgerRow, value: string) =>
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r))

  // ── Filtered rows ────────────────────────────────────────────────────────────

  const filtered = search
    ? rows.filter(
        (r) =>
          r.clean.toLowerCase().includes(search.toLowerCase()) ||
          r.original.toLowerCase().includes(search.toLowerCase()) ||
          r.account.toLowerCase().includes(search.toLowerCase())
      )
    : rows

  const totalAmount = rows.reduce((s, r) => s + r.amount, 0)

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="font-heading font-bold text-text-primary text-lg">Ledger</h1>
          <p className="text-text-muted text-xs mt-0.5">
            Parse bank statement PDFs, auto-clean transactions, and export with QB account mapping
          </p>
        </div>
        {step !== 'upload' && (
          <button
            onClick={() => { setStep('upload'); setFiles([]); setRows([]); setSavedPath('') }}
            className="btn-secondary flex items-center gap-2 py-1.5 px-3 text-sm"
          >
            <RefreshCw size={13} /> Start Over
          </button>
        )}
      </div>

      {/* Step indicator */}
      <div className="px-6 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
        {(['upload', 'review', 'export'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={cn(
              'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors',
              step === s ? 'bg-primary text-white'
                : (step === 'review' && s === 'upload') || step === 'export'
                ? 'bg-success/20 text-success'
                : 'bg-bg-elevated text-text-disabled'
            )}>
              {(step === 'review' && s === 'upload') || (step === 'export' && s !== 'export')
                ? <CheckCircle2 size={13} />
                : i + 1}
            </div>
            <span className={cn('text-xs font-medium capitalize', step === s ? 'text-primary' : 'text-text-muted')}>
              {s === 'upload' ? 'Upload PDFs' : s === 'review' ? 'Review & Edit' : 'Export'}
            </span>
            {i < 2 && <div className="w-8 h-px bg-white/[0.08] mx-1" />}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">

          {/* ── Step 1: Upload ─────────────────────────────────────────────── */}
          {step === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="h-full flex flex-col items-center justify-center p-8 gap-5"
            >
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="w-full max-w-lg glass-card border-2 border-dashed border-white/[0.12] hover:border-primary/40 transition-colors cursor-pointer p-10 flex flex-col items-center gap-4 group"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && addFiles(e.target.files)}
                />
                <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                  <FileText size={28} className="text-primary" />
                </div>
                {files.length > 0 ? (
                  <div className="text-center">
                    <p className="font-semibold text-text-primary text-sm">{files.length} PDF{files.length > 1 ? 's' : ''} ready</p>
                    <p className="text-text-muted text-xs mt-1">Click to add more</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="font-semibold text-text-primary text-sm">Drop bank statement PDFs here</p>
                    <p className="text-text-muted text-xs mt-1">or click to browse — multiple files supported</p>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[11px] text-text-disabled">
                  <Upload size={11} />
                  Exports from any major US bank or QB Desktop
                </div>
              </div>

              {/* File queue */}
              {files.length > 0 && (
                <div className="w-full max-w-lg glass-card divide-y divide-white/[0.05]">
                  {files.map((f) => (
                    <div key={f.name} className="flex items-center gap-3 px-4 py-2.5">
                      <FileText size={14} className="text-primary flex-shrink-0" />
                      <span className="text-xs text-text-secondary flex-1 truncate">{f.name}</span>
                      <span className="text-[11px] text-text-disabled flex-shrink-0">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                      <button onClick={(e) => { e.stopPropagation(); removeFile(f.name) }}
                        className="text-text-disabled hover:text-danger transition-colors">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* QB note */}
              {status.mode === 'qbsdk' && (
                <div className="w-full max-w-lg flex items-center gap-2.5 px-4 py-2.5 glass-card bg-success/5 border-success/20">
                  <BadgeCheck size={14} className="text-success flex-shrink-0" />
                  <p className="text-xs text-success/90">
                    QB Desktop connected — vendor accounts will be auto-mapped
                  </p>
                </div>
              )}
              {status.mode !== 'qbsdk' && (
                <div className="w-full max-w-lg flex items-center gap-2.5 px-4 py-2.5 glass-card bg-amber-500/5 border-amber-500/15">
                  <AlertCircle size={14} className="text-amber-400 flex-shrink-0" />
                  <p className="text-xs text-amber-300/80">
                    Connect to QB Desktop in Settings to enable automatic account mapping
                  </p>
                </div>
              )}

              <button
                onClick={handleProcess}
                disabled={files.length === 0 || isProcessing}
                className="btn-primary px-8 py-3 flex items-center gap-2 disabled:opacity-40"
              >
                {isProcessing ? (
                  <><Loader2 size={16} className="animate-spin" /> Processing…</>
                ) : (
                  <><Sparkles size={16} /> Process Statements</>
                )}
              </button>
            </motion.div>
          )}

          {/* ── Step 2: Review ─────────────────────────────────────────────── */}
          {step === 'review' && (
            <motion.div
              key="review"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="h-full flex flex-col"
            >
              {/* Toolbar */}
              <div className="px-6 py-2 border-b border-white/[0.06] flex items-center gap-3 flex-shrink-0">
                <input
                  type="text"
                  placeholder="Search transactions…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 max-w-xs text-xs bg-bg-elevated border border-white/[0.1] rounded-lg px-3 py-1.5 text-text-primary placeholder:text-text-disabled outline-none focus:border-primary/40"
                />
                {matchCount > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/10 border border-success/20">
                    <BadgeCheck size={12} className="text-success" />
                    <span className="text-[11px] text-success font-medium">{matchCount} QB matched</span>
                  </div>
                )}
                <div className="ml-auto text-xs text-text-muted">
                  {filtered.length} rows
                </div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-auto px-4 py-2">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-bg-surface">
                    <tr className="border-b border-white/[0.08]">
                      <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-24">Date</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Clean Transaction</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-40">Account</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-text-muted w-24">Amount</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-64">Original</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr
                        key={row.id}
                        className={cn(
                          'border-b border-white/[0.03] hover:bg-bg-elevated/30 transition-colors',
                          row.confidence === 'exact' && 'bg-success/[0.03]',
                          row.confidence === 'fuzzy' && 'bg-primary/[0.03]'
                        )}
                      >
                        <td className="px-3 py-2 text-text-muted font-mono whitespace-nowrap">{row.date}</td>
                        <td className="px-3 py-2 max-w-[200px]">
                          <div className="flex items-center gap-1.5">
                            {row.confidence !== 'none' && (
                              <BadgeCheck
                                size={11}
                                className={row.confidence === 'exact' ? 'text-success flex-shrink-0' : 'text-primary flex-shrink-0'}
                                title={row.confidence === 'exact' ? 'Exact QB match' : 'Fuzzy QB match'}
                              />
                            )}
                            <EditableCell
                              value={row.clean}
                              onSave={(v) => updateRow(row.id, 'clean', v)}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 max-w-[160px]">
                          <EditableCell
                            value={row.account}
                            onSave={(v) => updateRow(row.id, 'account', v)}
                          />
                        </td>
                        <td className={cn(
                          'px-3 py-2 text-right font-mono whitespace-nowrap',
                          row.amount >= 0 ? 'text-success' : 'text-danger'
                        )}>
                          {row.amount >= 0 ? '+' : ''}
                          {row.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                        </td>
                        <td className="px-3 py-2 text-text-disabled max-w-[250px]">
                          <span className="truncate block" title={row.original}>{row.original}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="px-6 py-3 border-t border-white/[0.06] flex items-center justify-between flex-shrink-0">
                <div className="text-xs text-text-muted">
                  <span className="text-text-primary font-semibold">{rows.length}</span> transactions ·{' '}
                  Net: <span className={cn('font-semibold font-mono', totalAmount >= 0 ? 'text-success' : 'text-danger')}>
                    {totalAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                  </span>
                </div>
                <button
                  onClick={handleExport}
                  className="btn-primary flex items-center gap-2 py-2 px-5"
                >
                  <Download size={15} /> Export to Excel
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Export done ───────────────────────────────────────── */}
          {step === 'export' && (
            <motion.div
              key="export"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="h-full flex flex-col items-center justify-center p-8"
            >
              <div className="w-full max-w-md text-center space-y-6">
                <div className="w-20 h-20 rounded-full bg-success/10 border-2 border-success/40 flex items-center justify-center mx-auto shadow-glow-success">
                  <CheckCircle2 size={40} className="text-success" />
                </div>
                <div>
                  <p className="font-heading font-bold text-text-primary text-xl">Export Complete!</p>
                  <p className="text-text-muted text-sm mt-1">
                    {rows.length} transactions saved as <span className="font-mono text-xs bg-bg-elevated px-1.5 py-0.5 rounded">phantom-ledger.xlsx</span>
                  </p>
                </div>

                {/* Column summary */}
                <div className="glass-card p-4 text-left space-y-2">
                  <p className="text-xs font-semibold text-text-muted mb-3">Columns exported</p>
                  {[
                    { col: 'Date', desc: 'Parsed transaction date' },
                    { col: 'Clean Transaction', desc: 'Cleaned & normalized merchant name' },
                    { col: 'Account', desc: 'QB expense/income account (when matched)' },
                    { col: 'Amount', desc: 'Transaction amount (negative = debit)' },
                    { col: 'Original Transaction', desc: 'Raw bank statement text' }
                  ].map(({ col, desc }) => (
                    <div key={col} className="flex items-start gap-2.5">
                      <CheckCircle2 size={12} className="text-success flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-xs font-semibold text-text-primary">{col}</span>
                        <span className="text-[11px] text-text-muted ml-1.5">{desc}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => window.api.files.showInFolder(savedPath)}
                    className="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5"
                  >
                    <FolderOpen size={14} /> Open Folder
                  </button>
                  <button
                    onClick={() => { setStep('upload'); setFiles([]); setRows([]); setSavedPath('') }}
                    className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5"
                  >
                    <ArrowRight size={14} /> Process Another
                  </button>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
