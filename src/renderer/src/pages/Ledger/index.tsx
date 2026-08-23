import { useState, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText,
  Upload,
  Download,
  CheckCircle2,
  XCircle,
  FolderOpen,
  RefreshCw,
  X,
  Pencil,
  Check,
  Loader2,
  ArrowRight,
  BadgeCheck,
  Sparkles,
  AlertCircle,
  TriangleAlert,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Landmark,
  CreditCard,
  Send
} from 'lucide-react'
import { toast } from 'sonner'
import { useQBStore } from '../../store/useQBStore'
import {
  parseStatementPdfsWithMeta,
  findBatchWarnings
} from '../../utils/pdfStatementParser'
import type { ParsedPdfResult, AccountType, AccountTypeOption } from '../../utils/pdfStatementParser'
import { cleanAndNormalizeTransaction } from '../../utils/transactionCleaner'
import { matchEntity, buildEntityCatalog } from '../../utils/vendorMatcher'
import type { EntityCatalog, MatchOutcome } from '../../utils/vendorMatcher'
import type { LedgerRow } from '../../types/electron'
import { cn } from '../../utils/cn'

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'review' | 'done'

interface LedgerRowMeta {
  id: number
  date: string
  payee: string
  account: string
  amount: number
  original: string
  sourceFile: string
  matched: boolean
  matchTier: MatchOutcome['tier']
  flags: string[]
  reviewReason: string | null
}

interface QBAccount {
  name: string
  fullName: string
  type: string
}

interface UploadOutcome {
  attempted: number
  succeeded: number
  failed: number
  skipped: { reason: string; count: number }[]
  errors: { row: LedgerRowMeta; error: string }[]
  mode: 'qb' | 'excel'
  savedPath?: string
}

const ASK_MY_ACCOUNTANT = 'Ask My Accountant'

// ── Inline editable cell ──────────────────────────────────────────────────────

function EditableCell({ value, onSave, placeholder }: { value: string; onSave: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = () => {
    onSave(draft.trim())
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
      <span className="truncate">{value || <span className="text-text-disabled italic">{placeholder || '—'}</span>}</span>
      <Pencil size={9} className="opacity-0 group-hover:opacity-40 flex-shrink-0" />
    </button>
  )
}

// ── Validation badge ──────────────────────────────────────────────────────────

function ValidationBadge({ meta }: { meta: ParsedPdfResult }) {
  const v = meta.validation
  if (!v || v.passed === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/[0.06] text-text-muted border border-white/[0.08]">
        <ShieldQuestion size={10} /> Not validated
      </span>
    )
  }
  if (v.passed) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/25">
        <ShieldCheck size={10} /> Tied to the cent
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-danger/10 text-danger border border-danger/30">
      <ShieldAlert size={10} /> Totals mismatch
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LedgerPage() {
  const { status } = useQBStore()
  const qbConnected = status.mode === 'qbsdk'

  const [step, setStep] = useState<Step>('upload')
  const [files, setFiles] = useState<File[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [processStatus, setProcessStatus] = useState('')
  const [rows, setRows] = useState<LedgerRowMeta[]>([])
  const [pdfMetas, setPdfMetas] = useState<ParsedPdfResult[]>([])
  const [batchWarnings, setBatchWarnings] = useState<string[]>([])
  const [accountTypeOption, setAccountTypeOption] = useState<AccountTypeOption>('auto')
  const [effectiveType, setEffectiveType] = useState<AccountType>('bank')
  const [qbAccounts, setQbAccounts] = useState<QBAccount[]>([])
  const [targetAccount, setTargetAccount] = useState('')
  const [catalogSize, setCatalogSize] = useState(0)
  const [search, setSearch] = useState('')
  const [rowFilter, setRowFilter] = useState<'all' | 'review' | 'uncategorized'>('all')
  const [isUploading, setIsUploading] = useState(false)
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('upload'); setFiles([]); setRows([]); setPdfMetas([]); setBatchWarnings([])
    setOutcome(null); setSearch(''); setRowFilter('all'); setTargetAccount('')
  }

  // ── File handling ───────────────────────────────────────────────────────────

  const addFiles = (incoming: FileList | File[]) => {
    const pdfs = Array.from(incoming).filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    if (pdfs.length === 0) { toast.error('Please select PDF files only.'); return }
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name))
      return [...prev, ...pdfs.filter((f) => !existing.has(f.name))]
    })
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    addFiles(e.dataTransfer.files)
  }, [])

  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.name !== name))

  // ── Process: parse → validate → clean → cross-reference QB → categorize ────

  const handleProcess = async () => {
    if (files.length === 0) { toast.error('Add at least one PDF.'); return }
    setIsProcessing(true)
    setOutcome(null)
    try {
      setProcessStatus('Parsing statements…')
      const metasPromise = parseStatementPdfsWithMeta(files, { accountType: accountTypeOption })

      // Pull QB entity history + chart of accounts in parallel with parsing
      let catalog: EntityCatalog | null = null
      let accounts: QBAccount[] = []
      if (qbConnected) {
        setProcessStatus('Parsing statements + reading QuickBooks lists…')
        const [statsRes, acctRes] = await Promise.all([
          window.api.qb.getEntityAccountStats().catch(() => ({ success: false as const })),
          window.api.qb.getAccounts().catch(() => ({ success: false as const, data: [] }))
        ])
        if (statsRes.success && 'data' in statsRes && statsRes.data) {
          catalog = buildEntityCatalog(statsRes.data)
        } else {
          toast.warning('Could not read QuickBooks vendor/customer history — rows will be uncategorized.')
        }
        if (acctRes.success && acctRes.data) {
          accounts = (acctRes.data as Record<string, string>[]).map((a) => ({
            name: a['Name'] || '',
            fullName: a['FullName'] || a['Name'] || '',
            type: a['AccountType'] || ''
          })).filter((a) => a.fullName)
        }
      }
      setQbAccounts(accounts)
      setCatalogSize(catalog ? catalog.names.length : 0)

      const metas = await metasPromise
      setPdfMetas(metas)

      // Batch checks: duplicate PDFs, duplicate/missing periods, mixed accounts
      const warnings = findBatchWarnings(metas)
      setBatchWarnings(warnings)
      for (const w of warnings) toast.warning(w, { duration: 8000 })

      // Per-file validation results
      for (const meta of metas) {
        if (meta.validation.passed === false) {
          toast.error(`${meta.fileName}: extraction does NOT tie to the statement's printed totals.`, { duration: 8000 })
        }
      }

      const parsed = metas.flatMap((meta) =>
        meta.transactions.map((t) => ({ ...t, sourceFile: meta.fileName }))
      )
      parsed.sort((a, b) => a.dateValue - b.dateValue)

      if (parsed.length === 0) {
        toast.error('No transactions found. Make sure these are bank or credit card statement PDFs.')
        return
      }

      // Majority account type across files decides the QB transaction types
      const ccCount = metas.filter((m) => m.accountType === 'credit_card').length
      const resolvedType: AccountType =
        accountTypeOption !== 'auto' ? accountTypeOption : ccCount > metas.length / 2 ? 'credit_card' : 'bank'
      setEffectiveType(resolvedType)

      // Preselect a target account when there is exactly one candidate
      const wanted = resolvedType === 'credit_card' ? 'CreditCard' : 'Bank'
      const candidates = accounts.filter((a) => a.type === wanted)
      setTargetAccount(candidates.length === 1 ? candidates[0].fullName : '')

      setProcessStatus('Cleaning and categorizing…')
      let matched = 0
      const result: LedgerRowMeta[] = parsed.map((t, i) => {
        const cleaned = cleanAndNormalizeTransaction(t.description)
        const match: MatchOutcome = catalog
          ? matchEntity(cleaned, catalog)
          : { entity: null, entityKind: null, account: null, tier: 'none', needsReview: false, reviewReason: null }
        if (match.entity) matched++

        const flags = [...t.flags]
        if (match.needsReview && !flags.includes('match-review')) flags.push('match-review')

        return {
          id: i,
          date: t.date,
          payee: match.entity || cleaned,
          account: match.account || '',
          amount: t.amount,
          original: t.description,
          sourceFile: t.sourceFile,
          matched: Boolean(match.entity),
          matchTier: match.tier,
          flags,
          reviewReason: match.reviewReason
        }
      })

      setRows(result)
      setStep('review')
      const categorized = result.filter((r) => r.account).length
      toast.success(
        `${result.length} transactions · ${matched} matched to QB · ${categorized} auto-categorized`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Processing failed')
    } finally {
      setIsProcessing(false)
      setProcessStatus('')
    }
  }

  // ── Upload to QuickBooks ─────────────────────────────────────────────────────

  const askMyAccountantExists = useMemo(
    () => qbAccounts.some((a) => a.fullName.toLowerCase() === ASK_MY_ACCOUNTANT.toLowerCase()),
    [qbAccounts]
  )

  const handleUploadToQB = async () => {
    if (!qbConnected) { toast.error('Connect to QuickBooks Desktop in Settings first.'); return }
    if (!targetAccount) { toast.error(`Pick the QB ${effectiveType === 'credit_card' ? 'credit card' : 'bank'} account these statements belong to.`); return }

    setIsUploading(true)
    try {
      const zeroRows = rows.filter((r) => Math.abs(r.amount) < 0.005)
      const uncategorized = rows.filter((r) => Math.abs(r.amount) >= 0.005 && !r.account && !askMyAccountantExists)
      const uploadable = rows.filter((r) => Math.abs(r.amount) >= 0.005 && (r.account || askMyAccountantExists))

      const skipped: UploadOutcome['skipped'] = []
      if (zeroRows.length) skipped.push({ reason: 'zero-amount rows (fee waivers)', count: zeroRows.length })
      if (uncategorized.length) {
        skipped.push({
          reason: `uncategorized rows ("${ASK_MY_ACCOUNTANT}" account not found in QB — set an account or create it)`,
          count: uncategorized.length
        })
      }

      const positive = uploadable.filter((r) => r.amount > 0)
      const negative = uploadable.filter((r) => r.amount < 0)

      const toRecord = (r: LedgerRowMeta): Record<string, string> => ({
        Date: r.date,
        Amount: Math.abs(r.amount).toFixed(2),
        Memo: r.original,
        Account: r.account || ASK_MY_ACCOUNTANT,
        Payee: r.payee,
        Vendor: r.payee,
        'Bank Account': targetAccount
      })

      const batches: { type: string; rows: LedgerRowMeta[] }[] =
        effectiveType === 'credit_card'
          ? [
              { type: 'Credit Card Charge', rows: positive },
              { type: 'Credit Card Credit', rows: negative }
            ]
          : [
              { type: 'Deposit', rows: positive },
              { type: 'Check', rows: negative }
            ]

      let succeeded = 0
      const errors: UploadOutcome['errors'] = []
      let attempted = 0

      for (const batch of batches) {
        if (!batch.rows.length) continue
        attempted += batch.rows.length
        const payload = batch.rows.map((r) => {
          const rec = toRecord(r)
          if (effectiveType === 'credit_card') {
            rec['Account'] = targetAccount // CC account at txn level
            rec['Expense Account'] = r.account || ASK_MY_ACCOUNTANT
            delete rec['Bank Account']
          }
          return rec
        })
        const res = await window.api.qb.importTransactions(payload, batch.type)
        if (!res.success || !res.results) {
          for (const r of batch.rows) errors.push({ row: r, error: res.error || 'Import failed' })
          continue
        }
        res.results.forEach((result, idx) => {
          if (result.success) succeeded++
          else errors.push({ row: batch.rows[idx], error: result.error || 'Unknown QB error' })
        })
      }

      await window.api.history.add({
        operation: 'import',
        type: effectiveType === 'credit_card' ? 'Credit Card (Ledger)' : 'Checks + Deposits (Ledger)',
        count: attempted,
        successCount: succeeded,
        failCount: errors.length,
        fileName: files.map((f) => f.name).join(', '),
        mode: 'qbsdk'
      }).catch(() => undefined)

      setOutcome({ attempted, succeeded, failed: errors.length, skipped, errors, mode: 'qb' })
      setStep('done')
      if (errors.length === 0) toast.success(`${succeeded} transactions uploaded to QuickBooks.`)
      else toast.warning(`${succeeded} uploaded, ${errors.length} failed — see details.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  // ── Excel export ─────────────────────────────────────────────────────────────

  const handleExport = async () => {
    const result = await window.api.files.saveDialog({
      title: 'Save Ledger Export',
      defaultPath: 'phantom-ledger.xlsx',
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return

    const exportRows: LedgerRow[] = rows.map((r) => ({
      date: r.date, clean: r.payee, account: r.account, amount: r.amount, original: r.original
    }))

    const res = await window.api.files.exportLedger(exportRows, result.filePath)
    if (!res.success) { toast.error(res.error || 'Export failed'); return }
    setOutcome({ attempted: rows.length, succeeded: rows.length, failed: 0, skipped: [], errors: [], mode: 'excel', savedPath: result.filePath })
    setStep('done')
    toast.success('Excel file saved!')
  }

  // ── Row editing / filtering ─────────────────────────────────────────────────

  const updateRow = (id: number, field: 'payee' | 'account', value: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)))

  const needsReviewCount = rows.filter((r) => r.flags.length > 0 || !r.account).length

  const filtered = useMemo(() => {
    let items = rows
    if (rowFilter === 'review') items = items.filter((r) => r.flags.length > 0)
    if (rowFilter === 'uncategorized') items = items.filter((r) => !r.account)
    if (search) {
      const q = search.toLowerCase()
      items = items.filter(
        (r) =>
          r.payee.toLowerCase().includes(q) ||
          r.original.toLowerCase().includes(q) ||
          r.account.toLowerCase().includes(q)
      )
    }
    return items
  }, [rows, rowFilter, search])

  const totalAmount = rows.reduce((s, r) => s + r.amount, 0)
  const positiveTotal = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0)
  const negativeTotal = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0)

  const accountCandidates = useMemo(
    () => qbAccounts.filter((a) => a.type === (effectiveType === 'credit_card' ? 'CreditCard' : 'Bank')),
    [qbAccounts, effectiveType]
  )

  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="font-heading font-bold text-text-primary text-lg">Ledger</h1>
          <p className="text-text-muted text-xs mt-0.5">
            Statement PDFs → validated transactions → QB-categorized → Deposits & Checks (or card charges & credits)
          </p>
        </div>
        {step !== 'upload' && (
          <button onClick={reset} className="btn-secondary flex items-center gap-2 py-1.5 px-3 text-sm">
            <RefreshCw size={13} /> Start Over
          </button>
        )}
      </div>

      {/* Step indicator */}
      <div className="px-6 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
        {(['upload', 'review', 'done'] as Step[]).map((s, i) => {
          const labels = { upload: 'Upload & Verify', review: 'Review & Categorize', done: 'Send' }
          const passed = (step === 'review' && s === 'upload') || (step === 'done' && s !== 'done')
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors',
                step === s ? 'bg-primary text-white' : passed ? 'bg-success/20 text-success' : 'bg-bg-elevated text-text-disabled'
              )}>
                {passed ? <CheckCircle2 size={13} /> : i + 1}
              </div>
              <span className={cn('text-xs font-medium', step === s ? 'text-primary' : 'text-text-muted')}>
                {labels[s]}
              </span>
              {i < 2 && <div className="w-8 h-px bg-white/[0.08] mx-1" />}
            </div>
          )
        })}
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
              className="h-full overflow-auto flex flex-col items-center p-8 gap-5"
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
                    <p className="font-semibold text-text-primary text-sm">Drop bank or credit card statement PDFs here</p>
                    <p className="text-text-muted text-xs mt-1">or click to browse — multiple files supported</p>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[11px] text-text-disabled">
                  <Upload size={11} />
                  Every statement is verified against its own printed totals
                </div>
              </div>

              {/* Statement type */}
              <div className="w-full max-w-lg glass-card p-4 flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold text-text-muted">Statement type</span>
                <div className="inline-flex bg-bg-elevated rounded-lg p-0.5 gap-0.5 border border-white/[0.08]">
                  {([
                    { v: 'auto' as const, label: 'Auto', icon: Sparkles },
                    { v: 'bank' as const, label: 'Bank', icon: Landmark },
                    { v: 'credit_card' as const, label: 'Credit card', icon: CreditCard }
                  ]).map(({ v, label, icon: Icon }) => (
                    <button
                      key={v}
                      onClick={() => setAccountTypeOption(v)}
                      className={cn(
                        'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors',
                        accountTypeOption === v ? 'bg-primary text-white shadow-glow' : 'text-text-muted hover:text-text-primary'
                      )}
                    >
                      <Icon size={12} /> {label}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-text-disabled basis-full">
                  {accountTypeOption === 'credit_card'
                    ? 'Charges positive → Credit Card Charges · payments negative → Credit Card Credits'
                    : accountTypeOption === 'bank'
                      ? 'Deposits positive → QB Deposits · withdrawals negative → QB Checks'
                      : 'Detected per statement — override if a card statement is misread as a bank account'}
                </span>
              </div>

              {/* File queue */}
              {files.length > 0 && (
                <div className="w-full max-w-lg glass-card divide-y divide-white/[0.05]">
                  {files.map((f) => {
                    const meta = pdfMetas.find((m) => m.fileName === f.name)
                    return (
                      <div key={f.name} className="flex items-center gap-3 px-4 py-2.5">
                        <FileText size={14} className="text-primary flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-text-secondary truncate block">{f.name}</span>
                          {meta && (
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <ValidationBadge meta={meta} />
                              {meta.accountId && (
                                <span className="text-[10px] text-text-disabled font-mono">…{meta.accountId.slice(-4)}</span>
                              )}
                              <span className="text-[10px] text-text-disabled">{meta.transactions.length} txns</span>
                              <span className="text-[10px] text-text-disabled">
                                {meta.accountType === 'credit_card' ? 'credit card' : 'bank'}
                              </span>
                            </div>
                          )}
                        </div>
                        <span className="text-[11px] text-text-disabled flex-shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                        <button onClick={(e) => { e.stopPropagation(); removeFile(f.name) }}
                          className="text-text-disabled hover:text-danger transition-colors">
                          <X size={13} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* QB connection note */}
              {qbConnected ? (
                <div className="w-full max-w-lg flex items-center gap-2.5 px-4 py-2.5 glass-card bg-success/5 border-success/20">
                  <BadgeCheck size={14} className="text-success flex-shrink-0" />
                  <p className="text-xs text-success/90">
                    QB Desktop connected — payees are cross-referenced against your vendor & customer lists and categorized from transaction history
                  </p>
                </div>
              ) : (
                <div className="w-full max-w-lg flex items-center gap-2.5 px-4 py-2.5 glass-card bg-amber-500/5 border-amber-500/15">
                  <AlertCircle size={14} className="text-amber-400 flex-shrink-0" />
                  <p className="text-xs text-amber-300/80">
                    Connect to QB Desktop in Settings to enable auto-categorization and direct upload
                  </p>
                </div>
              )}

              <button
                onClick={handleProcess}
                disabled={files.length === 0 || isProcessing}
                className="btn-primary px-8 py-3 flex items-center gap-2 disabled:opacity-40"
              >
                {isProcessing ? (
                  <><Loader2 size={16} className="animate-spin" /> {processStatus || 'Processing…'}</>
                ) : (
                  <><Sparkles size={16} /> Process Statements</>
                )}
              </button>
            </motion.div>
          )}

          {/* ── Step 2: Review & Categorize ────────────────────────────────── */}
          {step === 'review' && (
            <motion.div
              key="review"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="h-full flex flex-col"
            >
              {/* Validation strip */}
              <div className="px-6 py-2 border-b border-white/[0.06] flex items-center gap-2 flex-wrap flex-shrink-0">
                {pdfMetas.map((meta) => (
                  <div key={meta.fileName} className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-disabled font-mono max-w-[140px] truncate" title={meta.fileName}>
                      {meta.fileName}
                    </span>
                    <ValidationBadge meta={meta} />
                  </div>
                ))}
              </div>

              {/* Batch warnings */}
              {batchWarnings.length > 0 && (
                <div className="mx-6 mt-2 px-4 py-2.5 glass-card bg-danger/5 border-danger/20 flex-shrink-0">
                  {batchWarnings.map((w) => (
                    <div key={w} className="flex items-start gap-2 py-0.5">
                      <TriangleAlert size={13} className="text-danger flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-danger/90">{w}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Toolbar */}
              <div className="px-6 py-2 border-b border-white/[0.06] flex items-center gap-3 flex-shrink-0 flex-wrap">
                <input
                  type="text"
                  placeholder="Search transactions…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 max-w-xs text-xs bg-bg-elevated border border-white/[0.1] rounded-lg px-3 py-1.5 text-text-primary placeholder:text-text-disabled outline-none focus:border-primary/40"
                />
                <div className="inline-flex bg-bg-elevated rounded-lg p-0.5 gap-0.5 border border-white/[0.08]">
                  {([
                    { v: 'all' as const, label: `All (${rows.length})` },
                    { v: 'review' as const, label: `Flagged (${rows.filter((r) => r.flags.length > 0).length})` },
                    { v: 'uncategorized' as const, label: `No account (${rows.filter((r) => !r.account).length})` }
                  ]).map(({ v, label }) => (
                    <button
                      key={v}
                      onClick={() => setRowFilter(v)}
                      className={cn(
                        'text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors',
                        rowFilter === v ? 'bg-primary text-white' : 'text-text-muted hover:text-text-primary'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {catalogSize > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/10 border border-success/20">
                    <BadgeCheck size={12} className="text-success" />
                    <span className="text-[11px] text-success font-medium">{catalogSize} QB names loaded</span>
                  </div>
                )}
                <div className="ml-auto text-xs text-text-muted">{filtered.length} rows</div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-auto px-4 py-2">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-bg-surface">
                    <tr className="border-b border-white/[0.08]">
                      <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-24">Date</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Payee</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-44">Account</th>
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
                          row.flags.includes('sign-review') && 'bg-warning/[0.04]',
                          row.matchTier === 'exact' && !row.flags.length && 'bg-success/[0.03]'
                        )}
                      >
                        <td className="px-3 py-2 text-text-muted font-mono whitespace-nowrap">{row.date}</td>
                        <td className="px-3 py-2 max-w-[220px]">
                          <div className="flex items-center gap-1.5">
                            {row.matched && (
                              <BadgeCheck
                                size={11}
                                className={cn('flex-shrink-0', row.matchTier === 'fuzzy' ? 'text-warning' : 'text-success')}
                              />
                            )}
                            <EditableCell value={row.payee} onSave={(v) => updateRow(row.id, 'payee', v)} />
                          </div>
                          {row.flags.includes('sign-review') && (
                            <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide text-warning bg-warning/10 border border-warning/25 rounded-full px-1.5 py-px">
                              verify sign
                            </span>
                          )}
                          {row.flags.includes('zero-value') && (
                            <span className="inline-block mt-0.5 ml-1 text-[9px] font-bold uppercase tracking-wide text-text-muted bg-white/[0.06] border border-white/[0.1] rounded-full px-1.5 py-px">
                              $0
                            </span>
                          )}
                          {row.reviewReason && (
                            <p className="text-[10px] text-warning/80 mt-0.5">{row.reviewReason}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 max-w-[170px]">
                          <EditableCell
                            value={row.account}
                            onSave={(v) => updateRow(row.id, 'account', v)}
                            placeholder={ASK_MY_ACCOUNTANT}
                          />
                        </td>
                        <td className={cn(
                          'px-3 py-2 text-right font-mono whitespace-nowrap',
                          row.amount >= 0 ? 'text-success' : 'text-danger'
                        )}>
                          {row.amount >= 0 ? '+' : ''}{money(row.amount)}
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
              <div className="px-6 py-3 border-t border-white/[0.06] flex items-center gap-4 flex-shrink-0 flex-wrap">
                <div className="text-xs text-text-muted">
                  <span className="text-text-primary font-semibold">{rows.length}</span> rows ·{' '}
                  <span className="text-success font-mono">{money(positiveTotal)}</span> in ·{' '}
                  <span className="text-danger font-mono">{money(negativeTotal)}</span> out ·{' '}
                  Net <span className={cn('font-semibold font-mono', totalAmount >= 0 ? 'text-success' : 'text-danger')}>{money(totalAmount)}</span>
                  {needsReviewCount > 0 && (
                    <span className="text-warning"> · {needsReviewCount} need attention</span>
                  )}
                </div>

                <div className="ml-auto flex items-center gap-2 flex-wrap">
                  {qbConnected && (
                    <>
                      <select
                        value={targetAccount}
                        onChange={(e) => setTargetAccount(e.target.value)}
                        className="text-xs bg-bg-elevated border border-white/[0.1] rounded-lg px-2.5 py-2 text-text-primary outline-none focus:border-primary/40 max-w-[220px]"
                      >
                        <option value="">
                          {effectiveType === 'credit_card' ? 'Select QB credit card account…' : 'Select QB bank account…'}
                        </option>
                        {accountCandidates.map((a) => (
                          <option key={a.fullName} value={a.fullName}>{a.fullName}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleUploadToQB}
                        disabled={isUploading || !targetAccount}
                        className="btn-primary flex items-center gap-2 py-2 px-5 disabled:opacity-40"
                        title={effectiveType === 'credit_card'
                          ? 'Positive rows → Credit Card Charges, negative rows → Credit Card Credits'
                          : 'Positive rows → Deposits, negative rows → Checks'}
                      >
                        {isUploading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                        Upload to QuickBooks
                      </button>
                    </>
                  )}
                  <button onClick={handleExport} className="btn-secondary flex items-center gap-2 py-2 px-4">
                    <Download size={15} /> Excel
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Done ──────────────────────────────────────────────── */}
          {step === 'done' && outcome && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="h-full overflow-auto flex flex-col items-center justify-center p-8"
            >
              <div className="w-full max-w-lg text-center space-y-6">
                <div className={cn(
                  'w-20 h-20 rounded-full border-2 flex items-center justify-center mx-auto',
                  outcome.failed === 0
                    ? 'bg-success/10 border-success/40 shadow-glow-success'
                    : 'bg-warning/10 border-warning/40'
                )}>
                  {outcome.failed === 0
                    ? <CheckCircle2 size={40} className="text-success" />
                    : <TriangleAlert size={40} className="text-warning" />}
                </div>

                <div>
                  <p className="font-heading font-bold text-text-primary text-xl">
                    {outcome.mode === 'excel' ? 'Export Complete!' : outcome.failed === 0 ? 'Uploaded to QuickBooks!' : 'Upload finished with errors'}
                  </p>
                  <p className="text-text-muted text-sm mt-1">
                    {outcome.mode === 'excel'
                      ? `${outcome.succeeded} transactions saved to Excel`
                      : `${outcome.succeeded} of ${outcome.attempted} transactions created as ${
                          effectiveType === 'credit_card' ? 'Credit Card Charges / Credits' : 'Deposits / Checks'
                        }`}
                  </p>
                </div>

                {outcome.skipped.length > 0 && (
                  <div className="glass-card p-4 text-left space-y-1.5">
                    <p className="text-xs font-semibold text-text-muted">Skipped</p>
                    {outcome.skipped.map((s) => (
                      <p key={s.reason} className="text-xs text-text-secondary">{s.count} {s.reason}</p>
                    ))}
                  </div>
                )}

                {outcome.errors.length > 0 && (
                  <div className="glass-card p-4 text-left space-y-2 max-h-56 overflow-auto">
                    <p className="text-xs font-semibold text-danger">Failed rows</p>
                    {outcome.errors.map(({ row, error }, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <XCircle size={12} className="text-danger flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] text-text-secondary">
                          <span className="font-mono">{row.date}</span> · {row.payee} · {money(row.amount)}
                          <span className="text-danger block">{error}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-3">
                  {outcome.mode === 'excel' && outcome.savedPath ? (
                    <button
                      onClick={() => window.api.files.showInFolder(outcome.savedPath!)}
                      className="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5"
                    >
                      <FolderOpen size={14} /> Open Folder
                    </button>
                  ) : (
                    <button
                      onClick={() => setStep('review')}
                      className="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5"
                    >
                      <ArrowRight size={14} className="rotate-180" /> Back to Review
                    </button>
                  )}
                  <button onClick={reset} className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5">
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
