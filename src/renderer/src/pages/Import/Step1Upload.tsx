import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileSpreadsheet, FileText, AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ImportState } from './index'

const SUPPORTED_EXTENSIONS = ['.csv', '.xls', '.xlsx', '.xlsm', '.txt', '.iif']
const MAX_SIZE_MB = 10

interface Props {
  state: ImportState
  updateState: (u: Partial<ImportState>) => void
  onNext: () => void
}

export default function Step1Upload({ state, updateState, onNext }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleFile = useCallback(
    async (filePath: string, fileName: string) => {
      setError('')
      const ext = '.' + fileName.split('.').pop()?.toLowerCase()

      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        setError(`Unsupported file type: ${ext}. Please use: ${SUPPORTED_EXTENSIONS.join(', ')}`)
        return
      }

      setIsLoading(true)
      try {
        const result = await window.api.files.parse(filePath)
        if (!result.success) {
          setError(result.error || 'Failed to parse file')
          return
        }

        const { headers, rows } = result.data
        if (!headers?.length) {
          setError('File appears to be empty or has no headers')
          return
        }

        updateState({
          filePath,
          fileName,
          parsedFile: { headers, rows }
        })
        toast.success(`Loaded ${rows.length.toLocaleString()} rows from ${fileName}`)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to parse file')
      } finally {
        setIsLoading(false)
      }
    },
    [updateState]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) {
        // In Electron, dropped files have a path property
        const path = (file as unknown as { path: string }).path
        handleFile(path, file.name)
      }
    },
    [handleFile]
  )

  const handleBrowse = async () => {
    const result = await window.api.files.openDialog({
      title: 'Select Transaction File',
      filters: [
        {
          name: 'Transaction Files',
          extensions: ['csv', 'xls', 'xlsx', 'xlsm', 'txt', 'iif']
        },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (!result.canceled && result.filePaths[0]) {
      const filePath = result.filePaths[0]
      const fileName = filePath.split('\\').pop() || filePath.split('/').pop() || 'file'
      handleFile(filePath, fileName)
    }
  }

  const clearFile = () => {
    updateState({ filePath: '', fileName: '', parsedFile: null })
    setError('')
  }

  const hasFile = !!state.parsedFile

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-6">
        {/* Upload zone */}
        <motion.div
          animate={{
            borderColor: isDragging
              ? '#6366F1'
              : hasFile
                ? '#10B981'
                : error
                  ? '#EF4444'
                  : '#334155',
            boxShadow: isDragging
              ? '0 0 0 4px rgba(99,102,241,0.1), 0 0 30px rgba(99,102,241,0.2)'
              : hasFile
                ? '0 0 0 2px rgba(16,185,129,0.1)'
                : 'none'
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className="relative border-2 border-dashed rounded-2xl p-12 text-center transition-colors duration-200 cursor-pointer bg-bg-surface/50"
          onClick={!hasFile ? handleBrowse : undefined}
        >
          {isLoading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={40} className="text-primary animate-spin" />
              <p className="text-text-secondary font-medium">Parsing file...</p>
            </div>
          ) : hasFile ? (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="w-16 h-16 rounded-2xl bg-success/10 border border-success/30 flex items-center justify-center">
                <CheckCircle2 size={32} className="text-success" />
              </div>
              <div>
                <p className="font-semibold text-text-primary text-lg">{state.fileName}</p>
                <p className="text-text-muted text-sm mt-1">
                  {state.parsedFile!.rows.length.toLocaleString()} rows •{' '}
                  {state.parsedFile!.headers.length} columns
                </p>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    clearFile()
                  }}
                  className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <X size={12} />
                  Remove
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleBrowse()
                  }}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  Change File
                </button>
              </div>
            </motion.div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <motion.div
                animate={{ y: isDragging ? -8 : 0 }}
                transition={{ duration: 0.2 }}
                className={`w-20 h-20 rounded-2xl flex items-center justify-center transition-all duration-200 ${
                  isDragging
                    ? 'bg-primary/20 border-2 border-primary'
                    : 'bg-bg-elevated border border-white/[0.12]'
                }`}
              >
                <Upload
                  size={36}
                  className={isDragging ? 'text-primary' : 'text-text-muted'}
                />
              </motion.div>

              <div>
                <p className="text-text-primary font-semibold text-lg">
                  {isDragging ? 'Drop your file here' : 'Drag & drop your file here'}
                </p>
                <p className="text-text-muted text-sm mt-1">
                  or{' '}
                  <span className="text-primary hover:text-primary-hover cursor-pointer underline-offset-2 underline">
                    browse files
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-3 text-text-disabled text-xs">
                <FileSpreadsheet size={14} className="text-success" />
                <span>Excel (.xls, .xlsx, .xlsm)</span>
                <FileText size={14} className="text-warning" />
                <span>CSV, TXT, IIF</span>
              </div>

              <p className="text-text-disabled text-xs">Max {MAX_SIZE_MB}MB per file</p>
            </div>
          )}
        </motion.div>

        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 p-4 rounded-xl bg-danger/10 border border-danger/30"
          >
            <AlertCircle size={16} className="text-danger flex-shrink-0 mt-0.5" />
            <p className="text-danger text-sm">{error}</p>
          </motion.div>
        )}

        {/* File requirements */}
        {!hasFile && (
          <div className="glass-card p-4 space-y-2">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              File Requirements
            </p>
            <ul className="space-y-1.5">
              {[
                'Row 1 must contain column headers',
                'No blank rows above the headers',
                'No merged cells or hidden rows (Excel)',
                'Consistent data in each column'
              ].map((req) => (
                <li key={req} className="flex items-center gap-2 text-xs text-text-muted">
                  <div className="w-1 h-1 rounded-full bg-text-muted flex-shrink-0" />
                  {req}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Next button */}
        {hasFile && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={onNext}
            className="btn-primary w-full py-3 text-base font-semibold"
          >
            Continue to Select Transaction Type →
          </motion.button>
        )}
      </div>
    </div>
  )
}
