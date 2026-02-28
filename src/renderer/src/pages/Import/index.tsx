import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, List, GitMerge, Eye, CheckCircle2 } from 'lucide-react'
import Step1Upload from './Step1Upload'
import Step2TypeSelect from './Step2TypeSelect'
import Step3FieldMap from './Step3FieldMap'
import Step4Preview from './Step4Preview'
import Step5Results from './Step5Results'
import type { ParsedFile, ImportResult } from '../../types/electron'

export type ImportStep = 1 | 2 | 3 | 4 | 5

export interface ImportState {
  filePath: string
  fileName: string
  parsedFile: ParsedFile | null
  transactionType: string
  fieldMapping: Record<string, string> // qbField -> fileColumn
  previewRows: Record<string, string>[]
  results: ImportResult[]
  mode: 'qbsdk' | 'iif'
}

const STEPS = [
  { num: 1, label: 'Upload File', icon: Upload },
  { num: 2, label: 'Select Type', icon: List },
  { num: 3, label: 'Map Fields', icon: GitMerge },
  { num: 4, label: 'Preview', icon: Eye },
  { num: 5, label: 'Results', icon: CheckCircle2 }
]

export default function ImportWizard() {
  const [step, setStep] = useState<ImportStep>(1)
  const [state, setState] = useState<ImportState>({
    filePath: '',
    fileName: '',
    parsedFile: null,
    transactionType: '',
    fieldMapping: {},
    previewRows: [],
    results: [],
    mode: 'iif'
  })

  const updateState = (updates: Partial<ImportState>) => {
    setState((prev) => ({ ...prev, ...updates }))
  }

  const goNext = () => setStep((s) => (Math.min(s + 1, 5) as ImportStep))
  const goPrev = () => setStep((s) => (Math.max(s - 1, 1) as ImportStep))
  const goToStep = (s: ImportStep) => {
    // Only allow going back
    if (s < step) setStep(s)
  }

  const reset = () => {
    setStep(1)
    setState({
      filePath: '',
      fileName: '',
      parsedFile: null,
      transactionType: '',
      fieldMapping: {},
      previewRows: [],
      results: [],
      mode: 'iif'
    })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Step progress indicator */}
      <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-white/[0.08] bg-bg-surface/50">
        <h1 className="font-heading text-xl font-bold text-text-primary mb-4">Import Transactions</h1>
        <div className="flex items-center">
          {STEPS.map(({ num, label, icon: Icon }, i) => {
            const isActive = step === num
            const isDone = step > num
            const isClickable = num < step

            return (
              <div key={num} className="flex items-center flex-1 min-w-0">
                <button
                  onClick={() => isClickable && goToStep(num as ImportStep)}
                  disabled={!isClickable}
                  className={`flex items-center gap-2 flex-shrink-0 transition-all duration-200 ${
                    isClickable ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  {/* Circle */}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 flex-shrink-0 ${
                      isDone
                        ? 'bg-gradient-success text-white shadow-glow-success'
                        : isActive
                          ? 'bg-gradient-primary text-white shadow-glow-primary'
                          : 'bg-bg-elevated text-text-muted border border-white/[0.12]'
                    }`}
                  >
                    {isDone ? <CheckCircle2 size={14} /> : <Icon size={13} />}
                  </div>

                  {/* Label - only show for active or done on larger screens */}
                  <span
                    className={`text-xs font-medium hidden sm:block whitespace-nowrap ${
                      isActive ? 'text-primary' : isDone ? 'text-success' : 'text-text-muted'
                    }`}
                  >
                    {label}
                  </span>
                </button>

                {/* Connector line */}
                {i < STEPS.length - 1 && (
                  <div className="flex-1 mx-2 h-[1px] overflow-hidden">
                    <motion.div
                      animate={{ width: isDone ? '100%' : '0%' }}
                      transition={{ duration: 0.5, ease: 'easeInOut' }}
                      className="h-full bg-gradient-to-r from-success to-primary"
                    />
                    <div className="h-full bg-border-bright -mt-[1px]" style={{ width: '100%' }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="h-full"
          >
            {step === 1 && (
              <Step1Upload state={state} updateState={updateState} onNext={goNext} />
            )}
            {step === 2 && (
              <Step2TypeSelect state={state} updateState={updateState} onNext={goNext} onBack={goPrev} />
            )}
            {step === 3 && (
              <Step3FieldMap state={state} updateState={updateState} onNext={goNext} onBack={goPrev} />
            )}
            {step === 4 && (
              <Step4Preview state={state} updateState={updateState} onNext={goNext} onBack={goPrev} />
            )}
            {step === 5 && <Step5Results state={state} onReset={reset} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
