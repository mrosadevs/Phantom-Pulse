import { NavLink, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Upload,
  Download,
  Trash2,
  PenLine,
  History,
  Settings,
  ChevronLeft,
  ChevronRight,
  Loader2,
  BookOpen,
  FileSpreadsheet
} from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { useQBStore } from '../../store/useQBStore'
import { cn } from '../../utils/cn'

const NAV_ITEMS = [
  { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/import', icon: Upload, label: 'Import' },
  { path: '/export', icon: Download, label: 'Export' },
  { path: '/modify', icon: PenLine, label: 'Modify' },
  { path: '/delete', icon: Trash2, label: 'Delete' },
  { path: '/history', icon: History, label: 'History' },
  { path: '/gl-import', icon: BookOpen, label: 'GL Import' },
  { path: '/ledger', icon: FileSpreadsheet, label: 'Ledger' }
]

export default function Sidebar() {
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore()
  const { status, isConnecting } = useQBStore()

  return (
    <motion.aside
      animate={{ width: sidebarCollapsed ? 60 : 216 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="flex flex-col h-full bg-bg-surface border-r border-white/[0.06] flex-shrink-0 overflow-hidden"
    >
      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(({ path, icon: Icon, label }) => (
          <SidebarItem
            key={path}
            to={path}
            icon={Icon}
            label={label}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>

      {/* QB status chip */}
      <div className="px-2 pb-2 border-t border-white/[0.05] pt-2.5 overflow-hidden">
        <div
          className={cn(
            'flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors duration-200',
            status.mode === 'qbsdk'
              ? 'border border-emerald-500/20'
              : 'bg-bg-elevated/60 border border-white/[0.07]'
          )}
        >
          {/* Pulse dot */}
          <div className="flex-shrink-0 relative w-2 h-2 ml-0.5">
            {isConnecting ? (
              <Loader2 size={13} className="text-primary animate-spin absolute -top-[3px] -left-[3px]" />
            ) : status.mode === 'qbsdk' ? (
              <>
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-40" />
              </>
            ) : (
              <div className="w-2 h-2 rounded-full bg-text-disabled" />
            )}
          </div>

          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: 0.15 }}
                className="min-w-0"
              >
                <p
                  className={cn(
                    'text-[11px] font-semibold truncate leading-tight',
                    status.mode === 'qbsdk' ? 'text-emerald-400' : 'text-text-muted'
                  )}
                >
                  {isConnecting
                    ? 'Connecting…'
                    : status.mode === 'qbsdk'
                      ? status.companyName || 'Connected'
                      : status.mode === 'iif'
                        ? 'IIF Mode'
                        : 'Not Connected'}
                </p>
                <p className="text-[10px] text-text-disabled truncate leading-tight mt-0.5">
                  {status.mode === 'qbsdk'
                    ? 'QuickBooks Desktop'
                    : status.mode === 'iif'
                      ? 'File-based mode'
                      : 'Settings → Connect'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Settings + collapse */}
      <div className="px-2 pb-3 space-y-0.5">
        <SidebarItem to="/settings" icon={Settings} label="Settings" collapsed={sidebarCollapsed} />

        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="w-full h-8 flex items-center justify-center rounded-xl text-text-disabled hover:text-text-muted hover:bg-bg-elevated/60 transition-all duration-150"
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </motion.aside>
  )
}

function SidebarItem({
  to,
  icon: Icon,
  label,
  collapsed
}: {
  to: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  collapsed: boolean
}) {
  const location = useLocation()
  const isActive = location.pathname === to

  return (
    <NavLink to={to} className="block">
      <div
        className={cn(
          'relative flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all duration-150 cursor-pointer group',
          isActive
            ? 'bg-primary/12'
            : 'hover:bg-bg-elevated/60'
        )}
      >
        {/* Icon container */}
        <div
          className={cn(
            'flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150',
            isActive ? 'bg-primary/18' : 'group-hover:bg-bg-elevated'
          )}
        >
          <Icon
            size={16}
            className={cn(
              'transition-colors duration-150',
              isActive ? 'text-primary' : 'text-text-muted group-hover:text-text-secondary'
            )}
          />
        </div>

        {/* Label */}
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.12 }}
              className={cn(
                'text-[13px] font-medium whitespace-nowrap overflow-hidden leading-none',
                isActive ? 'text-primary' : 'text-text-muted group-hover:text-text-secondary'
              )}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>

        {/* Active right accent */}
        {isActive && (
          <motion.div
            layoutId="sidebarActive"
            className="absolute right-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-primary rounded-l-full"
          />
        )}

        {/* Collapsed tooltip */}
        {collapsed && (
          <div className="pointer-events-none absolute left-full ml-2.5 px-2.5 py-1.5 bg-bg-overlay border border-white/[0.1] rounded-lg text-[12px] text-text-primary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-card">
            {label}
          </div>
        )}
      </div>
    </NavLink>
  )
}
