import { Minus, Square, X, Zap, Sun, Moon } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../store/useAppStore'
import { useEffect, useState } from 'react'

export default function TitleBar() {
  const { theme, toggleTheme } = useAppStore()
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.updater.getVersion().then(setVersion).catch(() => {})
  }, [])

  return (
    <div className="drag-region h-9 flex items-center justify-between px-4 bg-bg-surface/70 border-b border-white/[0.06] flex-shrink-0 backdrop-blur-xl relative z-20">
      {/* App name/logo */}
      <div className="no-drag flex items-center gap-2">
        <motion.div
          animate={{
            boxShadow: [
              '0 0 8px rgba(99,102,241,0.35)',
              '0 0 16px rgba(139,92,246,0.55)',
              '0 0 8px rgba(99,102,241,0.35)'
            ]
          }}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
          whileHover={{ scale: 1.15, rotate: -8 }}
          className="w-6 h-6 rounded-lg bg-gradient-primary flex items-center justify-center"
        >
          <Zap size={12} className="text-white" strokeWidth={2.5} />
        </motion.div>
        <span className="font-heading font-semibold text-[13px] tracking-wide gradient-text">
          Phantom Pulse
        </span>
        <span className="text-text-disabled text-[11px] font-normal">for QuickBooks Desktop</span>
        {version && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-elevated border border-white/[0.08] text-text-disabled">
            v{version}
          </span>
        )}
      </div>

      {/* Window controls */}
      <div className="no-drag flex items-center gap-1">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-all duration-150 mr-1"
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>

        <div className="w-px h-4 bg-white/[0.08] mx-0.5" />

        <button
          onClick={() => window.api.window.minimize()}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-all duration-150"
        >
          <Minus size={12} />
        </button>
        <button
          onClick={() => window.api.window.maximize()}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-all duration-150"
        >
          <Square size={11} />
        </button>
        <button
          onClick={() => window.api.window.close()}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-danger/80 text-text-muted hover:text-white transition-all duration-150"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
