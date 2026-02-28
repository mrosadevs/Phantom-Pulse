import { motion } from 'framer-motion'
import {
  FileText,
  Receipt,
  CreditCard,
  FileMinus,
  ClipboardList,
  FileInput,
  Send,
  ShoppingCart,
  Wallet,
  BookOpen,
  ArrowDownCircle,
  ArrowLeftRight,
  BookMarked
} from 'lucide-react'
import { TRANSACTION_TYPES, TRANSACTION_CATEGORIES } from '../../data/transactionTypes'
import type { ImportState } from './index'

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  FileText,
  Receipt,
  CreditCard,
  FileMinus,
  ClipboardList,
  FileInput,
  Send,
  ShoppingCart,
  Wallet,
  BookOpen,
  ArrowDownCircle,
  ArrowLeftRight,
  BookMarked
}

interface Props {
  state: ImportState
  updateState: (u: Partial<ImportState>) => void
  onNext: () => void
  onBack: () => void
}

export default function Step2TypeSelect({ state, updateState, onNext, onBack }: Props) {
  const grouped = TRANSACTION_CATEGORIES.map((cat) => ({
    ...cat,
    types: TRANSACTION_TYPES.filter((t) => t.category === cat.id)
  }))

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h2 className="font-heading text-lg font-semibold text-text-primary">
              Select Transaction Type
            </h2>
            <p className="text-text-muted text-sm mt-1">
              Choose the type of transaction you are importing from{' '}
              <span className="text-primary font-medium">{state.fileName}</span>
            </p>
          </div>

          {grouped.map(({ id, label, color, types }) => (
            <div key={id}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-4 rounded-full" style={{ backgroundColor: color }} />
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  {label}
                </h3>
              </div>

              <div className="type-grid">
                {types.map((type) => {
                  const Icon = ICON_MAP[type.icon] || FileText
                  const isSelected = state.transactionType === type.id

                  return (
                    <motion.button
                      key={type.id}
                      whileHover={{ scale: 1.03, y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => updateState({ transactionType: type.id })}
                      className={`relative flex flex-col items-start gap-2 p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? 'border-2 bg-primary/10'
                          : 'border-white/[0.12] bg-bg-surface hover:bg-bg-elevated hover:border-white/[0.18]'
                      }`}
                      style={isSelected ? { borderColor: type.color } : undefined}
                    >
                      {isSelected && (
                        <motion.div
                          layoutId="selectedIndicator"
                          className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: type.color }}
                        >
                          <div className="w-2 h-2 rounded-full bg-white" />
                        </motion.div>
                      )}

                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${type.color}20` }}
                      >
                        <Icon size={18} style={{ color: type.color }} />
                      </div>

                      <div className="min-w-0">
                        <p className="text-text-primary text-xs font-semibold leading-tight">
                          {type.label}
                        </p>
                        <p className="text-text-disabled text-[10px] mt-0.5 line-clamp-2 leading-tight">
                          {type.description}
                        </p>
                      </div>
                    </motion.button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-t border-white/[0.08] bg-bg-surface/50">
        <button onClick={onBack} className="btn-secondary px-5">
          ← Back
        </button>

        {state.transactionType && (
          <div className="text-sm text-text-muted">
            Selected:{' '}
            <span className="text-primary font-medium">{state.transactionType}</span>
          </div>
        )}

        <button
          onClick={onNext}
          disabled={!state.transactionType}
          className={`px-5 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
            state.transactionType
              ? 'btn-primary'
              : 'bg-bg-elevated text-text-disabled cursor-not-allowed border border-white/[0.12]'
          }`}
        >
          Continue to Map Fields →
        </button>
      </div>
    </div>
  )
}
