import { Minus, Square, X, Zap, Sun, Moon } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'

export default function TitleBar() {
  const { theme, toggleTheme } = useAppStore()

  return (
    <div className="drag-region h-9 flex items-center justify-between px-4 bg-bg-surface/80 border-b border-white/[0.06] flex-shrink-0 backdrop-blur-sm">
      {/* App name/logo */}
      <div className="no-drag flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-primary flex items-center justify-center shadow-glow-sm">
          <Zap size={12} className="text-white" strokeWidth={2.5} />
        </div>
        <span className="font-heading font-semibold text-[13px] text-text-primary tracking-wide">
          Phantom Pulse
        </span>
        <span className="text-text-disabled text-[11px] font-normal">for QuickBooks Desktop</span>
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
