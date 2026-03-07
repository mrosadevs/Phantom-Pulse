import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileDown,
  XCircle,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  AlertTriangle,
  Banknote
} from 'lucide-react'
import { toast } from 'sonner'
import { useQBStore } from '../../store/useQBStore'
import { useHistoryStore } from '../../store/useHistoryStore'
import type { ImportState } from './index'
import type { ImportResult } from '../../types/electron'

interface Props {
  state: ImportState
  onReset: () => void
}

export default function Step5Results({ state, onReset }: Props) {
  const { status } = useQBStore()
  const { add: addHistory } = useHistoryStore()
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<ImportResult[]>([])
  const [done, setDone] = useState(false)
  const [iifContent, setIifContent] = useState('')
  const [savedIIFPath, setSavedIIFPath] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const ranRef = useRef(false)

  // Deposits must route through IIF (even in QBSDK mode) to get the customer
  // name on BOTH sides of the General Ledger.  QBXML DepositAdd has no
  // header-level EntityRef — this is a confirmed architectural limitation of
  // the QuickBooks SDK across all versions (2.0–20.0).
  const isDepositIIF = state.transactionType === 'Deposit' && status.mode === 'qbsdk'

  useEffect(() => {
    // Guard against React 18 Strict Mode double-fire in dev
    if (ranRef.current) return
    ranRef.current = true
    runImport()
  }, [])

  const runImport = async (): Promise<void> => {
    setIsRunning(true)
    setProgress(0)

    if (state.transactionType === 'Deposit' && status.mode === 'qbsdk') {
      // ── Deposit via IIF (QBSDK mode) ─────────────────────────────────────
      // IIF DEPOSIT format places NAME on the TRNS line (bank account / debit
      // side) AND the SPL line (income account / credit side).  This is
      // identical to what QB's own Batch Enter Transactions screen produces —
      // a true DEP-type transaction with the payee name on both GL sides.
      setProgress(50)
      const result = await window.api.files.generateDepositIIF(state.previewRows)
      setProgress(100)

      if (result.success && result.content) {
        setIifContent(result.content)
        const mockResults: ImportResult[] = state.previewRows.map((row, i) => ({
          rowIndex: i,
          success: true,
          row
        }))
        setResults(mockResults)

        await addHistory({
          operation: 'import',
          type: state.transactionType,
          count: state.previewRows.length,
          successCount: state.previewRows.length,
          failCount: 0,
          fileName: state.fileName,
          mode: 'iif'
        })

        toast.success(
          `Deposit IIF ready for ${state.previewRows.length} transaction${state.previewRows.length !== 1 ? 's' : ''} — save and import below`
        )
      } else {
        const failResults: ImportResult[] = state.previewRows.map((row, i) => ({
          rowIndex: i,
          success: false,
          error: result.error || 'IIF generation failed',
          row
        }))
        setResults(failResults)
        toast.error(result.error || 'Failed to generate Deposit IIF')
      }
    } else if (status.mode === 'qbsdk') {
      // ── Live QBSDK import (all non-deposit transaction types) ─────────────
      const batchSize = 10
      const allResults: ImportResult[] = []

      for (let i = 0; i < state.previewRows.length; i += batchSize) {
        const batch = state.previewRows.slice(i, i + batchSize)
        const result = await window.api.qb.importTransactions(batch, state.transactionType)

        if (result.success && result.results) {
          allResults.push(
            ...result.results.map((r) => ({ ...r, rowIndex: r.rowIndex + i }))
          )
        } else {
          for (let j = 0; j < batch.length; j++) {
            allResults.push({
              rowIndex: i + j,
              success: false,
              error: result.error || 'Import failed',
              row: batch[j]
            })
          }
        }

        setProgress(Math.round(((i + batchSize) / state.previewRows.length) * 100))
      }

      setResults(allResults)

      const successCount = allResults.filter((r) => r.success).length
      const failCount = allResults.filter((r) => !r.success).length

      await addHistory({
        operation: 'import',
        type: state.transactionType,
        count: allResults.length,
        successCount,
        failCount,
        fileName: state.fileName,
        mode: 'qbsdk'
      })

      if (failCount === 0)
        toast.success(`All ${successCount} transactions imported successfully!`)
      else
        toast.error(`${failCount} error${failCount !== 1 ? 's' : ''} — ${successCount} imported successfully.`)
    } else {
      // ── IIF mode (QB disconnected / manual IIF export) ─────────────────────
      const result = await window.api.files.generateIIF(state.previewRows, state.transactionType)

      if (result.success && result.content) {
        setIifContent(result.content)
        const mockResults: ImportResult[] = state.previewRows.map((row, i) => ({
          rowIndex: i,
          success: true,
          row
        }))
        setResults(mockResults)
        setProgress(100)

        await addHistory({
          operation: 'import',
          type: state.transactionType,
          count: state.previewRows.length,
          successCount: state.previewRows.length,
          failCount: 0,
          fileName: state.fileName,
          mode: 'iif'
        })

        toast.success(`IIF file generated for ${state.previewRows.length} transactions`)
      } else {
        toast.error(result.error || 'Failed to generate IIF file')
      }
    }

    setIsRunning(false)
    setDone(true)
  }

  const downloadIIF = async (): Promise<void> => {
    if (!iifContent) return

    const defaultName = isDepositIIF
      ? `Deposits_${new Date().toISOString().split('T')[0]}.iif`
      : `${state.transactionType.replace(/\s+/g, '_')}_import.iif`

    const saveResult = await window.api.files.saveDialog({
      title: 'Save IIF File',
      defaultPath: defaultName,
      filters: [{ name: 'QuickBooks IIF Files', extensions: ['iif'] }]
    })

    if (!saveResult.canceled && saveResult.filePath) {
      const result = await window.api.files.saveIIF(iifContent, saveResult.filePath)
      if (result.success) {
        setSavedIIFPath(saveResult.filePath)
        toast.success(
          isDepositIIF
            ? 'Deposit IIF saved — follow the steps below to import into QuickBooks.'
            : 'IIF saved — import via File → Utilities → Import → IIF Files in QuickBooks.'
        )
      } else {
        toast.error(result.error || 'Failed to save IIF file')
      }
    }
  }

  const openFolder = async (): Promise<void> => {
    if (savedIIFPath) await window.api.files.showInFolder(savedIIFPath)
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.filter((r) => !r.success).length
  const errorResults = results.filter((r) => !r.success)
  const showIIFButtons = (status.mode === 'iif' || isDepositIIF) && iifContent

  const loadingLabel = isDepositIIF
    ? 'Generating Deposit IIF...'
    : status.mode === 'qbsdk'
    ? 'Importing to QuickBooks...'
    : 'Generating IIF file...'

  const doneSubtitle = isDepositIIF
    ? 'Save the IIF file, then import it — payee shows on both GL sides'
    : status.mode === 'qbsdk'
    ? 'Imported to QuickBooks Desktop'
    : 'IIF file ready for import'

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-6">

        {/* ── Status ──────────────────────────────────────────────────── */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center"
        >
          {isRunning ? (
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
                <svg className="w-20 h-20 rotate-[-90deg]" viewBox="0 0 80 80">
                  <circle
                    cx="40"
                    cy="40"
                    r="36"
                    fill="none"
                    stroke="#6366F1"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 36}`}
                    strokeDashoffset={`${2 * Math.PI * 36 * (1 - progress / 100)}`}
                    className="transition-all duration-300"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">{progress}%</span>
                </div>
              </div>
              <div>
                <p className="font-heading font-semibold text-text-primary text-lg">
                  {loadingLabel}
                </p>
                <p className="text-text-muted text-sm mt-1">
                  Processing {state.previewRows.length.toLocaleString()} transaction
                  {state.previewRows.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              >
                {failCount === 0 ? (
                  <div className="w-20 h-20 rounded-full bg-success/10 border-2 border-success/40 flex items-center justify-center shadow-glow-success">
                    <CheckCircle2 size={40} className="text-success" />
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-full bg-warning/10 border-2 border-warning/40 flex items-center justify-center">
                    <AlertCircle size={40} className="text-warning" />
                  </div>
                )}
              </motion.div>
              <div>
                <p className="font-heading font-bold text-text-primary text-xl">
                  {isDepositIIF
                    ? 'Deposit IIF Ready'
                    : failCount === 0
                    ? 'All Done!'
                    : 'Completed with Errors'}
                </p>
                <p className="text-text-muted text-sm mt-1">{doneSubtitle}</p>
              </div>
            </div>
          ) : null}
        </motion.div>

        {/* ── Summary cards ───────────────────────────────────────────── */}
        {done && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-3 gap-3"
          >
            <div className="glass-card p-4 text-center">
              <p className="text-2xl font-bold text-text-primary font-heading">
                {results.length}
              </p>
              <p className="text-xs text-text-muted mt-1">Total</p>
            </div>
            <div className="glass-card p-4 text-center border-success/20 bg-success/5">
              <p className="text-2xl font-bold text-success font-heading">{successCount}</p>
              <p className="text-xs text-text-muted mt-1">Successful</p>
            </div>
            <div
              className={`glass-card p-4 text-center ${failCount > 0 ? 'border-danger/20 bg-danger/5' : ''}`}
            >
              <p
                className={`text-2xl font-bold font-heading ${failCount > 0 ? 'text-danger' : 'text-text-muted'}`}
              >
                {failCount}
              </p>
              <p className="text-xs text-text-muted mt-1">Errors</p>
            </div>
          </motion.div>
        )}

        {/* ── Error list ──────────────────────────────────────────────── */}
        {done && errorResults.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card">
            <button
              onClick={() => setShowErrors(!showErrors)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-danger hover:bg-danger/5 transition-colors rounded-xl"
            >
              <div className="flex items-center gap-2">
                <XCircle size={15} />
                {failCount} error{failCount !== 1 ? 's' : ''} to review
              </div>
              {showErrors ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>

            {showErrors && (
              <div className="border-t border-white/[0.08] max-h-48 overflow-y-auto">
                {errorResults.map((r) => (
                  <div
                    key={r.rowIndex}
                    className="flex items-start gap-3 px-4 py-2.5 border-b border-white/[0.05] last:border-0"
                  >
                    <span className="text-text-muted text-xs flex-shrink-0 mt-0.5">
                      Row {r.rowIndex + 1}
                    </span>
                    <p className="text-danger text-xs">{r.error}</p>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── Actions ─────────────────────────────────────────────────── */}
        {done && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            {showIIFButtons && (
              <button
                onClick={downloadIIF}
                className="btn-primary flex-1 flex items-center justify-center gap-2 py-3"
              >
                <FileDown size={16} />
                Save IIF File
              </button>
            )}

            <AnimatePresence>
              {savedIIFPath && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  onClick={openFolder}
                  className="btn-secondary flex items-center justify-center gap-2 py-3 px-4 flex-shrink-0"
                >
                  <FolderOpen size={15} />
                  Open Folder
                </motion.button>
              )}
            </AnimatePresence>

            <button
              onClick={onReset}
              className={`btn-secondary flex items-center justify-center gap-2 py-3 ${showIIFButtons ? 'px-5 flex-shrink-0' : 'flex-1'}`}
            >
              <RefreshCw size={15} />
              Import Another File
            </button>
          </motion.div>
        )}

        {/* ── Deposit IIF import instructions (special) ───────────────── */}
        {done && isDepositIIF && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-card overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3 bg-primary/10 border-b border-primary/20 flex items-center gap-2.5">
              <Banknote size={15} className="text-primary flex-shrink-0" />
              <p className="text-sm font-semibold text-primary">
                How to Import Deposits into QuickBooks
              </p>
            </div>

            {/* QB 2019+ bug warning */}
            <div className="px-4 py-3 bg-amber-500/5 border-b border-amber-500/15 flex items-start gap-2.5">
              <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300/90 leading-relaxed">
                <span className="font-semibold">QuickBooks 2019+ note:</span> If QB shows a
                review dialog after selecting your IIF file, choose{' '}
                <span className="font-mono text-[11px] bg-white/10 px-1.5 py-0.5 rounded">
                  "Import it for me, I'll fix it later"
                </span>{' '}
                or{' '}
                <span className="font-mono text-[11px] bg-white/10 px-1.5 py-0.5 rounded">
                  "Import without review"
                </span>
                . This preserves the payee name on the bank (debit) side of the GL.
              </p>
            </div>

            {/* Numbered steps */}
            <ol className="p-4 space-y-3">
              {[
                { label: 'Click ', bold: '"Save IIF File"', suffix: ' above and save to your Desktop' },
                { label: 'Open QuickBooks Desktop and ensure your company file is open', bold: null, suffix: '' },
                { label: 'Navigate to ', bold: 'File → Utilities → Import → IIF Files', suffix: '' },
                { label: 'Browse to and select the saved ', bold: '.iif file', suffix: '' },
                { label: 'If a review dialog appears, choose ', bold: '"Import without review"', suffix: '' },
                { label: 'Click ', bold: 'OK', suffix: ' — deposits will be DEP type with the payee name on both GL sides ✓' }
              ].map(({ label, bold, suffix }, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary font-bold text-[10px] mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-xs text-text-muted leading-relaxed">
                    {label}
                    {bold && (
                      <span className="font-semibold text-text-secondary font-mono text-[11px] bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                        {bold}
                      </span>
                    )}
                    {suffix}
                  </span>
                </li>
              ))}
            </ol>
          </motion.div>
        )}

        {/* ── Generic IIF instructions (IIF mode, non-deposit) ────────── */}
        {done && status.mode === 'iif' && !isDepositIIF && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass-card p-4 bg-primary/5 border-primary/20"
          >
            <p className="text-xs font-semibold text-primary mb-2">
              How to import IIF into QuickBooks Desktop:
            </p>
            <ol className="space-y-1">
              {[
                'Save the IIF file to your computer',
                'Open QuickBooks Desktop',
                'Go to File → Utilities → Import → IIF Files',
                'Select the saved IIF file',
                'Click OK to import'
              ].map((step, i) => (
                <li key={i} className="text-xs text-text-muted flex items-start gap-2">
                  <span className="text-primary font-medium flex-shrink-0">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </motion.div>
        )}

      </div>
    </div>
  )
}
