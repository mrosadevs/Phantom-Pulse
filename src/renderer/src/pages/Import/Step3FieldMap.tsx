import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Wand2,
  Save,
  AlertCircle,
  CheckCircle2,
  Info,
  BookOpen,
  Loader2
} from 'lucide-react'
import { toast } from 'sonner'
import { getTransactionType } from '../../data/transactionTypes'
import { useQBStore } from '../../store/useQBStore'
import type { ImportState } from './index'

interface Props {
  state: ImportState
  updateState: (u: Partial<ImportState>) => void
  onNext: () => void
  onBack: () => void
}

interface QBAccount {
  Name?: string
  FullName?: string
  AccountType?: string
}

export default function Step3FieldMap({ state, updateState, onNext, onBack }: Props) {
  const [mapping, setMapping] = useState<Record<string, string>>(state.fieldMapping || {})
  const [templateName, setTemplateName] = useState('')
  const [showSave, setShowSave] = useState(false)
  const [qbAccounts, setQbAccounts] = useState<QBAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  const { status } = useQBStore()
  const isQBConnected = status.mode === 'qbsdk'

  const txType = getTransactionType(state.transactionType)
  const fileColumns = state.parsedFile?.headers || []

  // Fetch QB accounts if connected
  useEffect(() => {
    if (!isQBConnected) return
    fetchAccounts()
  }, [isQBConnected])

  const fetchAccounts = () => {
    setLoadingAccounts(true)
    window.api.qb
      .getAccounts()
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          setQbAccounts(res.data as QBAccount[])
        } else {
          // Response came back but had no accounts — show a warning toast
          toast.warning(
            res.error
              ? `Could not load QB accounts: ${res.error}`
              : 'No accounts returned from QuickBooks. You can still pick from your file columns.'
          )
        }
      })
      .catch((err: unknown) => {
        toast.error(`Failed to load QB accounts: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => setLoadingAccounts(false))
  }

  // Auto-map: match QB field names to file column names (case-insensitive)
  // Skip account-type fields — those come from QB, not file columns
  useEffect(() => {
    if (!txType || Object.keys(mapping).length > 0) return

    const autoMapping: Record<string, string> = {}
    for (const field of txType.fields) {
      if (field.fieldType === 'qb-account') continue // QB account — not auto-mappable from columns
      const match = fileColumns.find(
        (col) =>
          col.toLowerCase() === field.name.toLowerCase() ||
          col.toLowerCase().replace(/\s+/g, '') === field.name.toLowerCase().replace(/\s+/g, '')
      )
      if (match) {
        autoMapping[field.name] = match
      }
    }

    if (Object.keys(autoMapping).length > 0) {
      setMapping(autoMapping)
      toast.success(`Auto-mapped ${Object.keys(autoMapping).length} fields`)
    }
  }, [txType, fileColumns])

  const autoMapAll = () => {
    if (!txType) return
    const autoMapping: Record<string, string> = { ...mapping }
    for (const field of txType.fields) {
      if (field.fieldType === 'qb-account') continue
      const match = fileColumns.find(
        (col) =>
          col.toLowerCase() === field.name.toLowerCase() ||
          col.toLowerCase().replace(/\s+/g, '') === field.name.toLowerCase().replace(/\s+/g, '')
      )
      if (match) autoMapping[field.name] = match
    }
    setMapping(autoMapping)
    const mapped = Object.keys(autoMapping).filter(
      (k) => !txType.fields.find((f) => f.name === k)?.fieldType
    ).length
    toast.success(`Auto-mapped ${mapped} column fields`)
  }

  const mappedRequired = txType?.fields.filter((f) => f.required && mapping[f.name]).length || 0
  const totalRequired = txType?.fields.filter((f) => f.required).length || 0
  const canProceed = mappedRequired === totalRequired

  const handleNext = () => {
    updateState({ fieldMapping: mapping })

    // Build preview rows using mapping
    // For qb-account fields: the value IS the account name (used directly)
    // For column fields: the value is a file column name (look up in row)
    const rows = (state.parsedFile?.rows || []).map((row) => {
      const mapped: Record<string, string> = {}
      for (const [qbField, value] of Object.entries(mapping)) {
        const fieldDef = txType?.fields.find((f) => f.name === qbField)
        if (fieldDef?.fieldType === 'qb-account') {
          mapped[qbField] = value // Use QB account name directly
        } else {
          mapped[qbField] = row[value] || '' // Look up from file column
        }
      }
      return mapped
    })

    updateState({ previewRows: rows })
    onNext()
  }

  const getAccountDisplayName = (acc: QBAccount) => acc.FullName || acc.Name || ''

  // Group accounts by type for optgroup display
  const accountsByType = qbAccounts.reduce<Record<string, QBAccount[]>>((groups, acc) => {
    const type = acc.AccountType || 'Other'
    if (!groups[type]) groups[type] = []
    groups[type].push(acc)
    return groups
  }, {})

  if (!txType) return null

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header info */}
      <div className="flex-shrink-0 px-6 py-3 bg-bg-surface/50 border-b border-white/[0.08]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${canProceed ? 'bg-success' : 'bg-warning'}`}
              />
              <span className="text-sm text-text-muted">
                {mappedRequired}/{totalRequired} required fields mapped
              </span>
            </div>

            {/* QB accounts status */}
            {isQBConnected && (
              <div className="flex items-center gap-1.5 text-xs">
                {loadingAccounts ? (
                  <span className="flex items-center gap-1 text-text-disabled">
                    <Loader2 size={11} className="animate-spin" />
                    Loading QB accounts...
                  </span>
                ) : qbAccounts.length > 0 ? (
                  <span className="flex items-center gap-1 text-primary">
                    <BookOpen size={11} />
                    {qbAccounts.length} QB accounts loaded
                  </span>
                ) : (
                  <button
                    onClick={fetchAccounts}
                    className="flex items-center gap-1 text-warning hover:text-warning/80 transition-colors"
                  >
                    <AlertCircle size={11} />
                    Accounts not loaded — click to retry
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={autoMapAll}
              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
            >
              <Wand2 size={13} />
              Auto-Map
            </button>
            <button
              onClick={() => setShowSave(!showSave)}
              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
            >
              <Save size={13} />
              Save Template
            </button>
          </div>
        </div>

        {showSave && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex items-center gap-2 mt-2"
          >
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name..."
              className="input-field text-xs flex-1"
            />
            <button
              onClick={() => {
                if (templateName) {
                  toast.success(`Template "${templateName}" saved`)
                  setShowSave(false)
                  setTemplateName('')
                }
              }}
              className="btn-primary text-xs px-3 py-1.5"
            >
              Save
            </button>
          </motion.div>
        )}
      </div>

      {/* Mapping table */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Column headers */}
          <div className="grid grid-cols-2 gap-4 mb-3 px-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                QuickBooks Field
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Your File Column / QB Account
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {txType.fields.map((field) => {
              const isMapped = !!mapping[field.name]
              const isRequired = field.required
              const isAccountField = field.fieldType === 'qb-account'

              return (
                <motion.div
                  key={field.name}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`grid grid-cols-2 gap-4 items-center p-3 rounded-xl border transition-all duration-150 ${
                    isMapped
                      ? 'bg-success/5 border-success/20'
                      : isRequired
                        ? 'bg-bg-surface border-white/[0.12]'
                        : 'bg-bg-surface border-white/[0.08]'
                  }`}
                >
                  {/* QB Field */}
                  <div className="flex items-center gap-2 min-w-0">
                    {isMapped ? (
                      <CheckCircle2 size={14} className="text-success flex-shrink-0" />
                    ) : isRequired ? (
                      <AlertCircle size={14} className="text-warning flex-shrink-0" />
                    ) : (
                      <Info size={14} className="text-text-disabled flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-text-primary truncate">
                          {field.name}
                        </span>
                        {isRequired && (
                          <span className="text-[10px] badge-warning px-1.5 py-0.5 rounded-full flex-shrink-0">
                            Required
                          </span>
                        )}
                        {isAccountField && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 bg-primary/15 text-primary border border-primary/25">
                            QB Account
                          </span>
                        )}
                      </div>
                      {field.example && (
                        <span className="text-[10px] text-text-disabled truncate block">
                          e.g. {field.example}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right side: QB Account picker OR file column dropdown */}
                  {isAccountField && isQBConnected && qbAccounts.length > 0 ? (
                    /* ── QB Account picker (connected + accounts loaded) ── */
                    <select
                      value={mapping[field.name] || ''}
                      onChange={(e) => {
                        const newMapping = { ...mapping }
                        if (e.target.value) {
                          newMapping[field.name] = e.target.value
                        } else {
                          delete newMapping[field.name]
                        }
                        setMapping(newMapping)
                      }}
                      className={`input-field text-sm w-full ${
                        isMapped ? 'border-success/40 text-text-primary' : 'border-primary/30'
                      }`}
                    >
                      <option value="">— Select QB Account —</option>
                      {Object.entries(accountsByType).map(([type, accounts]) => (
                        <optgroup key={type} label={type}>
                          {accounts.map((acc) => {
                            const name = getAccountDisplayName(acc)
                            if (!name) return null
                            return (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            )
                          })}
                        </optgroup>
                      ))}
                    </select>
                  ) : isAccountField && loadingAccounts ? (
                    /* ── Loading state ── */
                    <div className="input-field text-sm w-full flex items-center gap-2 text-text-disabled cursor-wait">
                      <Loader2 size={13} className="animate-spin flex-shrink-0" />
                      Loading QB accounts...
                    </div>
                  ) : (
                    /* ── File column dropdown (fallback: not connected, loading failed, or non-account field) ── */
                    // For account fields when QB isn't ready: let user pick a file column as fallback
                    // They can retry loading accounts from the header button
                    <select
                      value={mapping[field.name] || ''}
                      onChange={(e) => {
                        const newMapping = { ...mapping }
                        if (e.target.value) {
                          newMapping[field.name] = e.target.value
                        } else {
                          delete newMapping[field.name]
                        }
                        setMapping(newMapping)
                      }}
                      className={`input-field text-sm w-full ${
                        isMapped ? 'border-success/40 text-text-primary' : ''
                      }`}
                    >
                      <option value="">
                        {isAccountField && isQBConnected
                          ? '— Retry loading accounts above —'
                          : isAccountField
                            ? '— Connect to QB for account picker —'
                            : '— Not mapped —'}
                      </option>
                      {fileColumns.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  )}

                </motion.div>
              )
            })}
          </div>

          {/* Preview of mapped values */}
          {Object.keys(mapping).length > 0 && state.parsedFile?.rows[0] && (
            <div className="mt-6 glass-card p-4">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                First Row Preview
              </p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(mapping).map(([qbField, value]) => {
                  const fieldDef = txType.fields.find((f) => f.name === qbField)
                  const displayValue =
                    fieldDef?.fieldType === 'qb-account'
                      ? value // QB account name used directly
                      : state.parsedFile!.rows[0][value] || '—' // look up from file row
                  return (
                    <div key={qbField} className="flex items-baseline gap-2">
                      <span className="text-xs text-text-muted min-w-[100px] flex-shrink-0">
                        {qbField}:
                      </span>
                      <span className="text-xs text-text-primary font-mono truncate">
                        {displayValue}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-t border-white/[0.08] bg-bg-surface/50">
        <button onClick={onBack} className="btn-secondary px-5">
          ← Back
        </button>

        {!canProceed && (
          <p className="text-warning text-xs flex items-center gap-1">
            <AlertCircle size={12} />
            Map all required fields to continue
          </p>
        )}

        <button
          onClick={handleNext}
          disabled={!canProceed}
          className={`px-5 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
            canProceed
              ? 'btn-primary'
              : 'bg-bg-elevated text-text-disabled cursor-not-allowed border border-white/[0.12]'
          }`}
        >
          Preview Data →
        </button>
      </div>
    </div>
  )
}
