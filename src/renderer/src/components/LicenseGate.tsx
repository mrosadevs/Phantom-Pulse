import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { KeyRound, Copy, Check, Loader2, ShieldCheck, X, Minus } from 'lucide-react'
import { toast } from 'sonner'
import type { LicenseStatus } from '../types/electron'

/**
 * Blocks the app until a valid licence key for THIS machine is stored.
 *
 * The window is frameless, so this screen carries its own minimise/close
 * controls and drag region — without them an unactivated user would have no
 * way to move or close the window.
 */
export default function LicenseGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.api.license
      .status()
      .then(setStatus)
      .catch(() => setStatus({ activated: false, machineId: 'unavailable' }))
  }, [])

  const handleActivate = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await window.api.license.activate(key)
      if (result.success && result.status) {
        setStatus(result.status)
        toast.success('Phantom Pulse activated.')
      } else {
        setError(result.error ?? 'Activation failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  const copyMachineId = async () => {
    if (!status) return
    await navigator.clipboard.writeText(status.machineId)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  // Still checking — hold a blank canvas rather than flashing the gate at
  // someone who is already activated.
  if (!status) {
    return (
      <div className="h-screen w-screen bg-bg-base flex items-center justify-center">
        <Loader2 className="animate-spin text-text-muted" size={22} />
      </div>
    )
  }

  if (status.activated) return <>{children}</>

  return (
    <div className="h-screen w-screen bg-bg-base flex flex-col overflow-hidden">
      {/* Frameless window still needs a way to move and close */}
      <div className="drag-region h-9 flex items-center justify-end px-2 flex-shrink-0">
        <div className="no-drag flex items-center gap-1">
          <button
            onClick={() => window.api.window.minimize()}
            className="w-8 h-7 rounded-md hover:bg-white/[0.06] text-text-muted flex items-center justify-center transition-colors"
            aria-label="Minimise"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => window.api.window.close()}
            className="w-8 h-7 rounded-md hover:bg-danger/80 hover:text-white text-text-muted flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 pb-10">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <div className="flex flex-col items-center text-center mb-7">
            <div className="w-14 h-14 rounded-2xl bg-bg-elevated border border-white/[0.08] flex items-center justify-center mb-4">
              <ShieldCheck size={26} className="text-primary" />
            </div>
            <h1 className="font-heading text-xl font-semibold text-text-primary">
              Activate Phantom Pulse
            </h1>
            <p className="text-text-muted text-[12.5px] mt-1.5 leading-relaxed max-w-sm">
              Send the machine ID below to get a licence key. Each key works on one
              machine only.
            </p>
          </div>

          {/* Machine ID */}
          <div className="mb-5">
            <label className="block text-[11px] uppercase tracking-wide text-text-muted mb-1.5">
              This machine
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2.5 rounded-lg bg-bg-surface border border-border-subtle font-mono text-[13px] text-text-secondary tracking-wider">
                {status.machineId}
              </code>
              <button
                onClick={copyMachineId}
                className="px-3 py-2.5 rounded-lg bg-bg-surface border border-border-subtle hover:border-border-bright text-text-secondary transition-colors"
                aria-label="Copy machine ID"
              >
                {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />}
              </button>
            </div>
          </div>

          {/* Key entry */}
          <div className="mb-4">
            <label className="block text-[11px] uppercase tracking-wide text-text-muted mb-1.5">
              Licence key
            </label>
            <textarea
              value={key}
              onChange={(e) => {
                setKey(e.target.value)
                if (error) setError('')
              }}
              spellCheck={false}
              rows={3}
              placeholder="PP1...."
              className="w-full px-3 py-2.5 rounded-lg bg-bg-surface border border-border-subtle focus:border-primary/60 focus:outline-none font-mono text-[11.5px] text-text-secondary resize-none break-all transition-colors"
            />
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-danger text-[12px] mb-4"
            >
              {error}
            </motion.p>
          )}

          <button
            onClick={handleActivate}
            disabled={busy || !key.trim()}
            className="w-full py-2.5 rounded-lg bg-gradient-primary text-white font-medium text-[13px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-glow-primary transition-shadow"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
            {busy ? 'Checking…' : 'Activate'}
          </button>

          {/* A previously working key that stopped verifying — usually a
              reinstalled Windows, which changes the machine ID. */}
          {status.reason && (
            <p className="text-warning/90 text-[11.5px] mt-4 text-center leading-relaxed">
              {status.reason}
            </p>
          )}
        </motion.div>
      </div>
    </div>
  )
}
