import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText,
  Upload,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Users,
  Store,
  LayoutList,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Pencil,
  Check,
  X,
  ArrowRight,
  Loader2
} from 'lucide-react'
import { toast } from 'sonner'
import { useQBStore } from '../../store/useQBStore'
import { useHistoryStore } from '../../store/useHistoryStore'
import type {
  GLParseResult,
  GLAccount,
  GLEntity,
  GLImportEntity,
  GLImportResultItem
} from '../../types/electron'

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'preview' | 'results'
type PreviewTab = 'accounts' | 'customers' | 'vendors' | 'ambiguous'

// ── QB Account type options ───────────────────────────────────────────────────
const ACCOUNT_TYPES = [
  'Bank', 'CreditCard', 'AccountsReceivable', 'OtherCurrentAsset',
  'FixedAsset', 'OtherAsset', 'AccountsPayable', 'CreditCard',
  'OtherCurrentLiability', 'LongTermLiability', 'Equity',
  'Income', 'CostOfGoodsSold', 'Expense', 'OtherIncome', 'OtherExpense'
]

// ── Inline editable cell ──────────────────────────────────────────────────────
function EditableCell({
  value,
  onSave
}: {
  value: string
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = () => {
    onSave(draft.trim() || value)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(value); setEditing(false) }
          }}
          className="flex-1 text-xs bg-bg-elevated border border-primary/40 rounded px-2 py-0.5 text-text-primary outline-none"
        />
        <button onClick={commit} className="text-success hover:text-success/80">
          <Check size={12} />
        </button>
        <button onClick={() => { setDraft(value); setEditing(false) }} className="text-text-muted hover:text-danger">
          <X size={12} />
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true) }}
      className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary group text-left"
    >
      <span>{value}</span>
      <Pencil size={10} className="opacity-0 group-hover:opacity-50 flex-shrink-0" />
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GLImportPage() {
  const { status } = useQBStore()
  const { add: addHistory } = useHistoryStore()

  const [step, setStep] = useState<Step>('upload')
  const [isParsing, setIsParsing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [fileName, setFileName] = useState('')
  const [pdfPath, setPdfPath] = useState('')

  // Parsed data — user can edit before importing
  const [accounts, setAccounts] = useState<GLAccount[]>([])
  const [customers, setCustomers] = useState<GLEntity[]>([])
  const [vendors, setVendors] = useState<GLEntity[]>([])
  const [ambiguous, setAmbiguous] = useState<GLEntity[]>([])
  const [pageCount, setPageCount] = useState(0)

  const [activeTab, setActiveTab] = useState<PreviewTab>('accounts')
  const [importResults, setImportResults] = useState<GLImportResultItem[]>([])
  const [showErrors, setShowErrors] = useState(false)

  // ── Upload & parse ──────────────────────────────────────────────────────────
  const handlePickFile = async () => {
    const result = await window.api.files.openDialog({
      title: 'Select General Ledger PDF',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return
    const fp = result.filePaths[0]
    setPdfPath(fp)
    setFileName(fp.split(/[\\/]/).pop() || fp)
  }

  const handleParse = async () => {
    if (!pdfPath) { toast.error('Please select a PDF file first.'); return }
    setIsParsing(true)
    try {
      const res = await window.api.files.parseGLPdf(pdfPath)
      if (!res.success || !res.data) {
        toast.error(res.error || 'Failed to parse PDF')
        return
      }
      const d = res.data as GLParseResult
      setAccounts(d.accounts)
      setCustomers(d.customers)
      setVendors(d.vendors)
      setAmbiguous(d.ambiguous)
      setPageCount(d.pageCount)
      setStep('preview')
      toast.success(
        `Extracted ${d.accounts.length} accounts, ${d.customers.length} customers, ${d.vendors.length} vendors`
      )
    } finally {
      setIsParsing(false)
    }
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file?.name.endsWith('.pdf')) {
        setPdfPath(file.path)
        setFileName(file.name)
      } else {
        toast.error('Please drop a PDF file.')
      }
    },
    []
  )

  // ── Entity editing helpers ──────────────────────────────────────────────────
  const toggleAccount = (i: number) =>
    setAccounts((prev) => prev.map((a, idx) => idx === i ? { ...a, include: !a.include } : a))
  const updateAccountName = (i: number, name: string) =>
    setAccounts((prev) => prev.map((a, idx) => idx === i ? { ...a, name } : a))
  const updateAccountType = (i: number, type: string) =>
    setAccounts((prev) => prev.map((a, idx) => idx === i ? { ...a, type } : a))

  const toggleCustomer = (i: number) =>
    setCustomers((prev) => prev.map((c, idx) => idx === i ? { ...c, include: !c.include } : c))
  const updateCustomerName = (i: number, name: string) =>
    setCustomers((prev) => prev.map((c, idx) => idx === i ? { ...c, name } : c))

  const toggleVendor = (i: number) =>
    setVendors((prev) => prev.map((v, idx) => idx === i ? { ...v, include: !v.include } : v))
  const updateVendorName = (i: number, name: string) =>
    setVendors((prev) => prev.map((v, idx) => idx === i ? { ...v, name } : v))

  const toggleAmbiguous = (i: number) =>
    setAmbiguous((prev) => prev.map((a, idx) => idx === i ? { ...a, include: !a.include } : a))
  const updateAmbiguousType = (i: number, type: 'Customer' | 'Vendor') =>
    setAmbiguous((prev) => prev.map((a, idx) => idx === i ? { ...a, type } : a))
  const updateAmbiguousName = (i: number, name: string) =>
    setAmbiguous((prev) => prev.map((a, idx) => idx === i ? { ...a, name } : a))

  // ── Import ──────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (status.mode !== 'qbsdk') {
      toast.error('Connect to QuickBooks Desktop first.')
      return
    }

    const entities: GLImportEntity[] = [
      ...accounts.filter((a) => a.include).map((a) => ({
        category: 'account' as const,
        name: a.name,
        accountType: a.type
      })),
      ...customers.filter((c) => c.include).map((c) => ({
        category: 'customer' as const,
        name: c.name
      })),
      ...vendors.filter((v) => v.include).map((v) => ({
        category: 'vendor' as const,
        name: v.name
      })),
      ...ambiguous.filter((a) => a.include).map((a) => ({
        category: a.type === 'Customer' ? ('customer' as const) : ('vendor' as const),
        name: a.name
      }))
    ]

    if (entities.length === 0) {
      toast.error('Nothing selected to import.')
      return
    }

    setIsImporting(true)
    try {
      const res = await window.api.qb.importGLEntities(entities)
      if (!res.success) {
        toast.error(res.error || 'Import failed')
        return
      }
      const results = res.results || []
      setImportResults(results)

      const successCount = results.filter((r) => r.success).length
      const failCount = results.filter((r) => !r.success).length

      await addHistory({
        operation: 'import',
        type: 'GL Entities',
        count: results.length,
        successCount,
        failCount,
        fileName,
        mode: 'qbsdk'
      })

      if (failCount === 0) toast.success(`All ${successCount} entities imported!`)
      else toast.error(`${failCount} errors — ${successCount} imported.`)

      setStep('results')
    } finally {
      setIsImporting(false)
    }
  }

  const totalSelected =
    accounts.filter((a) => a.include).length +
    customers.filter((c) => c.include).length +
    vendors.filter((v) => v.include).length +
    ambiguous.filter((a) => a.include).length

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="font-heading font-bold text-text-primary text-lg">GL Import</h1>
          <p className="text-text-muted text-xs mt-0.5">
            Import Chart of Accounts, Customers &amp; Vendors from a QuickBooks General Ledger PDF
          </p>
        </div>
        {step !== 'upload' && (
          <button
            onClick={() => { setStep('upload'); setPdfPath(''); setFileName('') }}
            className="btn-secondary flex items-center gap-2 py-1.5 px-3 text-sm"
          >
            <RefreshCw size={13} />
            Start Over
          </button>
        )}
      </div>

      {/* Step indicator */}
      <div className="px-6 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
        {(['upload', 'preview', 'results'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
                step === s
                  ? 'bg-primary text-white'
                  : (step === 'preview' && s === 'upload') || step === 'results'
                  ? 'bg-success/20 text-success'
                  : 'bg-bg-elevated text-text-disabled'
              }`}
            >
              {(step === 'preview' && s === 'upload') || (step === 'results' && s !== 'results')
                ? <CheckCircle2 size={13} />
                : i + 1}
            </div>
            <span
              className={`text-xs font-medium capitalize ${
                step === s ? 'text-primary' : 'text-text-muted'
              }`}
            >
              {s === 'upload' ? 'Upload PDF' : s === 'preview' ? 'Review & Edit' : 'Results'}
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
              className="h-full flex flex-col items-center justify-center p-8 gap-6"
            >
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={handlePickFile}
                className="w-full max-w-lg glass-card border-2 border-dashed border-white/[0.12] hover:border-primary/40 transition-colors cursor-pointer p-10 flex flex-col items-center gap-4 group"
              >
                <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                  <FileText size={28} className="text-primary" />
                </div>
                {fileName ? (
                  <div className="text-center">
                    <p className="font-semibold text-text-primary text-sm">{fileName}</p>
                    <p className="text-text-muted text-xs mt-1">Click to change file</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="font-semibold text-text-primary text-sm">
                      Drop your General Ledger PDF here
                    </p>
                    <p className="text-text-muted text-xs mt-1">
                      or click to browse — exported from QuickBooks Desktop
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[11px] text-text-disabled">
                  <Upload size={11} />
                  QB Desktop: Reports → Accountant &amp; Taxes → General Ledger
                </div>
              </div>

              {/* Info card */}
              <div className="w-full max-w-lg glass-card p-4 bg-primary/5 border-primary/20">
                <p className="text-xs font-semibold text-primary mb-2">What gets extracted:</p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: LayoutList, label: 'Chart of Accounts', desc: 'All GL account sections' },
                    { icon: Users, label: 'Customers', desc: 'Names from credit (money-in) entries' },
                    { icon: Store, label: 'Vendors', desc: 'Names from debit (money-out) entries' }
                  ].map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="text-center">
                      <Icon size={18} className="text-primary mx-auto mb-1" />
                      <p className="text-xs font-semibold text-text-primary">{label}</p>
                      <p className="text-[10px] text-text-muted mt-0.5">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={handleParse}
                disabled={!pdfPath || isParsing}
                className="btn-primary px-8 py-3 flex items-center gap-2 disabled:opacity-40"
              >
                {isParsing ? (
                  <><Loader2 size={16} className="animate-spin" /> Parsing PDF...</>
                ) : (
                  <><ArrowRight size={16} /> Parse &amp; Extract</>
                )}
              </button>
            </motion.div>
          )}

          {/* ── Step 2: Preview / Edit ──────────────────────────────────────── */}
          {step === 'preview' && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="h-full flex flex-col"
            >
              {/* Tabs */}
              <div className="flex items-center gap-1 px-6 pt-2 border-b border-white/[0.06] flex-shrink-0">
                {([
                  { key: 'accounts',  icon: LayoutList, label: 'Accounts',  count: accounts.length },
                  { key: 'customers', icon: Users,      label: 'Customers', count: customers.length },
                  { key: 'vendors',   icon: Store,      label: 'Vendors',   count: vendors.length },
                  ...(ambiguous.length > 0
                    ? [{ key: 'ambiguous', icon: HelpCircle, label: 'Review', count: ambiguous.length }]
                    : [])
                ] as { key: PreviewTab; icon: React.ComponentType<{ size?: number; className?: string }>; label: string; count: number }[]).map(
                  ({ key, icon: Icon, label, count }) => (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                        activeTab === key
                          ? 'border-primary text-primary'
                          : 'border-transparent text-text-muted hover:text-text-secondary'
                      }`}
                    >
                      <Icon size={13} />
                      {label}
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                          activeTab === key
                            ? 'bg-primary/20 text-primary'
                            : 'bg-bg-elevated text-text-disabled'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  )
                )}
                <div className="ml-auto text-[11px] text-text-muted pb-1">
                  {pageCount} pages · {fileName}
                </div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-y-auto px-6 py-3">

                {/* Accounts tab */}
                {activeTab === 'accounts' && (
                  <AccountsTable
                    accounts={accounts}
                    onToggle={toggleAccount}
                    onName={updateAccountName}
                    onType={updateAccountType}
                  />
                )}

                {/* Customers tab */}
                {activeTab === 'customers' && (
                  <EntityTable
                    entities={customers}
                    onToggle={toggleCustomer}
                    onName={updateCustomerName}
                    showType={false}
                  />
                )}

                {/* Vendors tab */}
                {activeTab === 'vendors' && (
                  <EntityTable
                    entities={vendors}
                    onToggle={toggleVendor}
                    onName={updateVendorName}
                    showType={false}
                  />
                )}

                {/* Ambiguous tab */}
                {activeTab === 'ambiguous' && (
                  <AmbiguousTable
                    entities={ambiguous}
                    onToggle={toggleAmbiguous}
                    onName={updateAmbiguousName}
                    onType={updateAmbiguousType}
                  />
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-3 border-t border-white/[0.06] flex items-center justify-between flex-shrink-0">
                <p className="text-xs text-text-muted">
                  <span className="text-text-primary font-semibold">{totalSelected}</span> items
                  selected to import
                  {status.mode !== 'qbsdk' && (
                    <span className="text-warning ml-2">— connect to QB Desktop to import</span>
                  )}
                </p>
                <button
                  onClick={handleImport}
                  disabled={isImporting || totalSelected === 0 || status.mode !== 'qbsdk'}
                  className="btn-primary flex items-center gap-2 py-2 px-5 disabled:opacity-40"
                >
                  {isImporting ? (
                    <><Loader2 size={15} className="animate-spin" /> Importing...</>
                  ) : (
                    <><ArrowRight size={15} /> Import to QuickBooks</>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Results ──────────────────────────────────────────────── */}
          {step === 'results' && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="h-full flex flex-col items-center justify-center p-8"
            >
              <div className="w-full max-w-2xl space-y-6">
                {/* Icon + title */}
                <div className="text-center">
                  {importResults.filter((r) => !r.success).length === 0 ? (
                    <div className="w-20 h-20 rounded-full bg-success/10 border-2 border-success/40 flex items-center justify-center mx-auto mb-4 shadow-glow-success">
                      <CheckCircle2 size={40} className="text-success" />
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-warning/10 border-2 border-warning/40 flex items-center justify-center mx-auto mb-4">
                      <AlertCircle size={40} className="text-warning" />
                    </div>
                  )}
                  <p className="font-heading font-bold text-text-primary text-xl">
                    {importResults.filter((r) => !r.success).length === 0
                      ? 'Import Complete!'
                      : 'Completed with Errors'}
                  </p>
                  <p className="text-text-muted text-sm mt-1">
                    Entities added to QuickBooks Desktop
                  </p>
                </div>

                {/* Summary by category */}
                {(['account', 'customer', 'vendor'] as const).map((cat) => {
                  const catResults = importResults.filter((r) => r.category === cat)
                  if (catResults.length === 0) return null
                  const ok = catResults.filter((r) => r.success).length
                  return (
                    <div key={cat} className="glass-card p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {cat === 'account' ? <LayoutList size={16} className="text-primary" />
                          : cat === 'customer' ? <Users size={16} className="text-emerald-400" />
                          : <Store size={16} className="text-amber-400" />}
                        <span className="text-sm font-medium text-text-primary capitalize">
                          {cat}s
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-success font-semibold">{ok} imported</span>
                        {catResults.length - ok > 0 && (
                          <span className="text-danger font-semibold">
                            {catResults.length - ok} failed
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Error accordion */}
                {importResults.some((r) => !r.success) && (
                  <div className="glass-card">
                    <button
                      onClick={() => setShowErrors(!showErrors)}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-danger hover:bg-danger/5 transition-colors rounded-xl"
                    >
                      <div className="flex items-center gap-2">
                        <XCircle size={15} />
                        {importResults.filter((r) => !r.success).length} errors
                      </div>
                      {showErrors ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {showErrors && (
                      <div className="border-t border-white/[0.08] max-h-48 overflow-y-auto">
                        {importResults.filter((r) => !r.success).map((r, i) => (
                          <div key={i} className="flex items-start gap-3 px-4 py-2.5 border-b border-white/[0.05] last:border-0">
                            <span className="text-text-muted text-xs flex-shrink-0 mt-0.5 capitalize">{r.category}</span>
                            <span className="text-text-secondary text-xs flex-shrink-0">{r.name}</span>
                            <p className="text-danger text-xs ml-auto">{r.error}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={() => { setStep('upload'); setPdfPath(''); setFileName('') }}
                  className="btn-secondary w-full flex items-center justify-center gap-2 py-3"
                >
                  <RefreshCw size={15} />
                  Import Another PDF
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Sub-tables ─────────────────────────────────────────────────────────────────

function AccountsTable({
  accounts,
  onToggle,
  onName,
  onType
}: {
  accounts: GLAccount[]
  onToggle: (i: number) => void
  onName: (i: number, v: string) => void
  onType: (i: number, v: string) => void
}) {
  const allOn = accounts.every((a) => a.include)
  const toggleAll = () => accounts.forEach((_, i) => { if (accounts[i].include !== !allOn) onToggle(i) })

  return (
    <div className="glass-card overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.08]">
            <th className="px-3 py-2.5 text-left w-8">
              <input type="checkbox" checked={allOn} onChange={toggleAll}
                className="w-3.5 h-3.5 rounded accent-primary" />
            </th>
            <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Account Name</th>
            <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-48">Type</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a, i) => (
            <tr key={i} className={`border-b border-white/[0.04] last:border-0 ${!a.include ? 'opacity-40' : ''}`}>
              <td className="px-3 py-2">
                <input type="checkbox" checked={a.include} onChange={() => onToggle(i)}
                  className="w-3.5 h-3.5 rounded accent-primary" />
              </td>
              <td className="px-3 py-2">
                <EditableCell value={a.name} onSave={(v) => onName(i, v)} />
              </td>
              <td className="px-3 py-2">
                <select
                  value={a.type}
                  onChange={(e) => onType(i, e.target.value)}
                  className="text-xs bg-bg-elevated border border-white/[0.1] rounded px-2 py-0.5 text-text-secondary w-full"
                >
                  {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EntityTable({
  entities,
  onToggle,
  onName,
  showType
}: {
  entities: GLEntity[]
  onToggle: (i: number) => void
  onName: (i: number, v: string) => void
  showType: boolean
}) {
  const allOn = entities.every((e) => e.include)
  const toggleAll = () => entities.forEach((_, i) => { if (entities[i].include !== !allOn) onToggle(i) })

  return (
    <div className="glass-card overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.08]">
            <th className="px-3 py-2.5 text-left w-8">
              <input type="checkbox" checked={allOn} onChange={toggleAll}
                className="w-3.5 h-3.5 rounded accent-primary" />
            </th>
            <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Name</th>
            {showType && <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-28">Type</th>}
          </tr>
        </thead>
        <tbody>
          {entities.map((e, i) => (
            <tr key={i} className={`border-b border-white/[0.04] last:border-0 ${!e.include ? 'opacity-40' : ''}`}>
              <td className="px-3 py-2">
                <input type="checkbox" checked={e.include} onChange={() => onToggle(i)}
                  className="w-3.5 h-3.5 rounded accent-primary" />
              </td>
              <td className="px-3 py-2">
                <EditableCell value={e.name} onSave={(v) => onName(i, v)} />
              </td>
              {showType && (
                <td className="px-3 py-2 text-text-muted capitalize">{e.type.toLowerCase()}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AmbiguousTable({
  entities,
  onToggle,
  onName,
  onType
}: {
  entities: GLEntity[]
  onToggle: (i: number) => void
  onName: (i: number, v: string) => void
  onType: (i: number, t: 'Customer' | 'Vendor') => void
}) {
  return (
    <div className="space-y-3">
      <div className="glass-card p-3 bg-amber-500/5 border-amber-500/15 flex items-start gap-2.5">
        <AlertCircle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/90">
          These names appeared on <strong>both</strong> debit and credit sides of the GL.
          Review each one and select whether it should be a Customer or Vendor before importing.
        </p>
      </div>
      <div className="glass-card overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.08]">
              <th className="px-3 py-2.5 text-left w-8">✓</th>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Name</th>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-36">Import As</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((e, i) => (
              <tr key={i} className={`border-b border-white/[0.04] last:border-0 ${!e.include ? 'opacity-40' : ''}`}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={e.include} onChange={() => onToggle(i)}
                    className="w-3.5 h-3.5 rounded accent-primary" />
                </td>
                <td className="px-3 py-2">
                  <EditableCell value={e.name} onSave={(v) => onName(i, v)} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex rounded-lg overflow-hidden border border-white/[0.08] w-fit">
                    {(['Customer', 'Vendor'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => onType(i, t)}
                        className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          e.type === t
                            ? t === 'Customer'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-amber-500/20 text-amber-300'
                            : 'text-text-disabled hover:text-text-muted'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
