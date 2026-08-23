import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, RefreshCw, X, Loader2 } from 'lucide-react'
import type { UpdaterStatusPayload } from '../types/electron'

/**
 * App-wide update prompt.
 *
 * Settings has its own update panel for deliberate checking; this is the part
 * that speaks up on launch, so an update is not something you only find by
 * going looking for it.  Dismissing hides it until the next launch.
 */
export default function UpdatePrompt() {
  const [version, setVersion] = useState('')
  const [phase, setPhase] = useState<'hidden' | 'available' | 'downloading' | 'ready'>('hidden')
  const [percent, setPercent] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const offStatus = window.api.updater.onStatus((data: UpdaterStatusPayload) => {
      if (data.version) setVersion(data.version)
      if (data.status === 'available') {
        // In auto mode the download has already started — show progress
        // rather than a button that has nothing left to do.
        setPhase(data.auto ? 'downloading' : 'available')
      } else if (data.status === 'downloaded') {
        setPhase('ready')
      }
    })
    const offProgress = window.api.updater.onProgress(({ percent }) => {
      setPercent(percent)
      setPhase((p) => (p === 'ready' ? p : 'downloading'))
    })
    return () => {
      offStatus()
      offProgress()
    }
  }, [])

  const startDownload = async () => {
    setPhase('downloading')
    const result = await window.api.updater.download()
    if (result.error) setPhase('available')
  }

  const visible = phase !== 'hidden' && !dismissed

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-5 right-5 z-50 w-[330px] rounded-xl bg-bg-elevated/95 border border-white/[0.09] shadow-card-hover backdrop-blur-xl overflow-hidden"
        >
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary-muted/30 flex items-center justify-center flex-shrink-0">
                {phase === 'ready' ? (
                  <RefreshCw size={16} className="text-primary" />
                ) : phase === 'downloading' ? (
                  <Loader2 size={16} className="text-primary animate-spin" />
                ) : (
                  <Download size={16} className="text-primary" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-[13px] font-semibold leading-tight">
                  {phase === 'ready'
                    ? `Version ${version} is ready`
                    : phase === 'downloading'
                      ? `Downloading ${version}…`
                      : `Version ${version} is available`}
                </p>
                <p className="text-text-muted text-[11.5px] mt-0.5 leading-relaxed">
                  {phase === 'ready'
                    ? 'Restart to finish installing.'
                    : phase === 'downloading'
                      ? `${percent}% complete`
                      : 'Update now, or next time you quit.'}
                </p>
              </div>

              <button
                onClick={() => setDismissed(true)}
                className="text-text-muted hover:text-text-secondary transition-colors flex-shrink-0"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>

            {phase === 'downloading' && (
              <div className="mt-3 h-1 rounded-full bg-bg-surface overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-primary"
                  animate={{ width: `${percent}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}

            {(phase === 'available' || phase === 'ready') && (
              <div className="flex gap-2 mt-3.5">
                <button
                  onClick={phase === 'ready' ? () => window.api.updater.install() : startDownload}
                  className="flex-1 py-1.5 rounded-lg bg-gradient-primary text-white text-[12px] font-medium hover:shadow-glow-sm transition-shadow"
                >
                  {phase === 'ready' ? 'Restart now' : 'Update'}
                </button>
                <button
                  onClick={() => setDismissed(true)}
                  className="px-3 py-1.5 rounded-lg bg-bg-surface border border-border-subtle text-text-secondary text-[12px] hover:border-border-bright transition-colors"
                >
                  Later
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
