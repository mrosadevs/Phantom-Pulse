import { motion } from 'framer-motion'
import { cn } from '../../utils/cn'

interface EmptyStateProps {
  icon: React.ComponentType<{ size?: number | string; className?: string }>
  title: string
  description?: string
  /** Optional call-to-action rendered under the copy */
  action?: React.ReactNode
  /** Visual tone — tints the halo and icon */
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger'
  className?: string
}

const TONES = {
  neutral: { icon: 'text-text-muted', ring: 'rgba(148,163,184,0.16)' },
  primary: { icon: 'text-primary', ring: 'rgba(99,102,241,0.22)' },
  success: { icon: 'text-success', ring: 'rgba(16,185,129,0.22)' },
  warning: { icon: 'text-warning', ring: 'rgba(245,158,11,0.22)' },
  danger: { icon: 'text-danger', ring: 'rgba(239,68,68,0.22)' }
} as const

/**
 * Idle / no-data state with a gently floating icon and a breathing halo.
 * Gives otherwise-blank screens a sense of life without demanding attention.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'neutral',
  className
}: EmptyStateProps) {
  const t = TONES[tone]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex flex-col items-center justify-center text-center px-6 py-10 gap-3', className)}
    >
      <div className="relative flex items-center justify-center">
        {/* Breathing halo */}
        <motion.div
          animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute w-20 h-20 rounded-full"
          style={{ background: `radial-gradient(circle, ${t.ring}, transparent 70%)` }}
        />
        {/* Floating icon tile */}
        <motion.div
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
          className="relative w-14 h-14 rounded-2xl bg-bg-elevated/80 border border-white/[0.08] flex items-center justify-center backdrop-blur-sm"
        >
          <Icon size={24} className={t.icon} />
        </motion.div>
      </div>

      <div className="space-y-1 max-w-sm">
        <p className="text-text-secondary text-[13px] font-semibold">{title}</p>
        {description && <p className="text-text-muted text-[11.5px] leading-relaxed">{description}</p>}
      </div>

      {action}
    </motion.div>
  )
}
