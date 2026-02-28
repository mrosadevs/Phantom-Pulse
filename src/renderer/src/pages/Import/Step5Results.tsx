import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileDown,
  XCircle,
  ChevronDown,
  ChevronUp
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
  const [showErrors, setShowErrors] = useState(false)
  const ranRef = useRef(false)

  useEffect(() => {
    // Guard against React 18 Strict Mode double-fire in dev
    if (ranRef.current) return
    ranRef.current = true
    runImport()
  }, [])

  const runImport = async () => {
    setIsRunning(true)
    setProgress(0)

    if (status.mode === 'qbsdk') {
      // Live import via QBSDK
      const batchSize = 10
      const allResults: ImportResult[] = []

      for (let i = 0; i < state.previewRows.length; i += batchSize) {
        const batch = state.previewRows.slice(i, i + batchSize)
        const result = await window.api.qb.importTransactions(batch, state.transactionType)

        if (result.success && result.results) {
          // Offset row indices
          const offsetResults = result.results.map((r) => ({
            ...r,
            rowIndex: r.rowIndex + i
          }))
          allResults.push(...offsetResults)
        } else {
          // Mark whole batch as failed
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

      if (failCount === 0) toast.success(`All ${successCount} transactions imported successfully!`)
      else toast.error(`${failCount} errors. ${successCount} imported successfully.`)
    } else {
      // IIF export mode
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

  const downloadIIF = async () => {
    if (!iifContent) return

    const saveResult = await window.api.files.saveDialog({
      title: 'Save IIF File',
      defaultPath: `${state.transactionType.replace(/\s+/g, '_')}_import.iif`,
      filters: [{ name: 'IIF Files', extensions: ['iif'] }]
    })

    if (!saveResult.canceled && saveResult.filePath) {
      const result = await window.api.files.saveIIF(iifContent, saveResult.filePath)
      if (result.success) {
        toast.success('IIF file saved! Import it in QuickBooks: File → Utilities → Import → IIF Files')
      } else {
        toast.error(result.error || 'Failed to save IIF file')
      }
    }
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.filter((r) => !r.success).length
  const errorResults = results.filter((r) => !r.success)

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-6">
        {/* Status */}
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
                  {status.mode === 'qbsdk' ? 'Importing to QuickBooks...' : 'Generating IIF file...'}
                </p>
                <p className="text-text-muted text-sm mt-1">
                  Processing {state.previewRows.length.toLocaleString()} transactions
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
                  {failCount === 0 ? 'All Done!' : 'Completed with Errors'}
                </p>
                <p className="text-text-muted text-sm mt-1">
                  {status.mode === 'qbsdk'
                    ? `Imported to QuickBooks Desktop`
                    : 'IIF file ready for import'}
                </p>
              </div>
            </div>
          ) : null}
        </motion.div>

        {/* Summary cards */}
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

        {/* Error list */}
        {done && errorResults.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card">
            <button
              onClick={() => setShowErrors(!showErrors)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-danger hover:bg-danger/5 transition-colors rounded-xl"
            >
              <div className="flex items-center gap-2">
                <XCircle size={15} />
                {failCount} errors to review
              </div>
              {showErrors ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>

            {showErrors && (
              <div className="border-t border-white/[0.08] max-h-48 overflow-y-auto">
                {errorResults.map((r) => (
                  <div key={r.rowIndex} className="flex items-start gap-3 px-4 py-2.5 border-b border-white/[0.05] last:border-0">
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

        {/* Actions */}
        {done && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            {status.mode === 'iif' && iifContent && (
              <button
                onClick={downloadIIF}
                className="btn-success flex-1 flex items-center justify-center gap-2 py-3"
              >
                <FileDown size={16} />
                Save IIF File
              </button>
            )}
            <button
              onClick={onReset}
              className="btn-secondary flex-1 flex items-center justify-center gap-2 py-3"
            >
              <RefreshCw size={15} />
              Import Another File
            </button>
          </motion.div>
        )}

        {/* IIF import instructions */}
        {done && status.mode === 'iif' && (
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
