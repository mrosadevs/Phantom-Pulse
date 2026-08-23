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
  Loader2,
  BookOpen,
  FileSpreadsheet
} from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { useQBStore } from '../../store/useQBStore'
import { cn } from '../../utils/cn'

type NavItem = {
  path: string
  icon: React.ComponentType<{ size?: number | string; className?: string }>
  label: string
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [{ path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' }]
  },
  {
    title: 'Transactions',
    items: [
      { path: '/import', icon: Upload, label: 'Import' },
      { path: '/export', icon: Download, label: 'Export' },
      { path: '/modify', icon: PenLine, label: 'Modify' },
      { path: '/delete', icon: Trash2, label: 'Delete' }
    ]
  },
  {
    title: 'Tools',
    items: [
      { path: '/ledger', icon: FileSpreadsheet, label: 'Ledger' },
      { path: '/gl-import', icon: BookOpen, label: 'GL Import' },
      { path: '/history', icon: History, label: 'History' }
    ]
  }
]

export default function Sidebar() {
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore()
  const { status, isConnecting } = useQBStore()

  return (
    <motion.aside
      animate={{ width: sidebarCollapsed ? 62 : 218 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className="flex flex-col h-full bg-bg-surface/70 backdrop-blur-xl border-r border-white/[0.06] flex-shrink-0 overflow-hidden relative z-10"
    >
      {/* Nav */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto overflow-x-hidden">
        {NAV_SECTIONS.map((section, sectionIndex) => (
          <div key={section.title} className={cn(sectionIndex > 0 && 'mt-4')}>
            <AnimatePresence initial={false}>
              {!sidebarCollapsed && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="px-3 pb-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-text-disabled select-none overflow-hidden"
                >
                  {section.title}
                </motion.p>
              )}
            </AnimatePresence>
            {sidebarCollapsed && sectionIndex > 0 && (
              <div className="mx-3 mb-2 h-px bg-white/[0.06]" />
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <SidebarItem key={item.path} {...item} collapsed={sidebarCollapsed} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* QB status chip */}
      <div className="px-2 pb-2 border-t border-white/[0.05] pt-2.5 overflow-hidden">
        <motion.div
          animate={
            status.mode === 'qbsdk'
              ? { boxShadow: ['0 0 0px rgba(16,185,129,0)', '0 0 14px rgba(16,185,129,0.25)', '0 0 0px rgba(16,185,129,0)'] }
              : { boxShadow: '0 0 0px rgba(16,185,129,0)' }
          }
          transition={{ duration: 3, repeat: status.mode === 'qbsdk' ? Infinity : 0, ease: 'easeInOut' }}
          className={cn(
            'flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors duration-200',
            status.mode === 'qbsdk'
              ? 'border border-emerald-500/25 bg-emerald-500/[0.06]'
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
        </motion.div>
      </div>

      {/* Settings + collapse */}
      <div className="px-2 pb-3 space-y-0.5">
        <SidebarItem to="/settings" path="/settings" icon={Settings} label="Settings" collapsed={sidebarCollapsed} />

        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="w-full h-8 flex items-center justify-center rounded-xl text-text-disabled hover:text-text-muted hover:bg-bg-elevated/60 transition-all duration-150 active:scale-90"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <motion.span
            animate={{ rotate: sidebarCollapsed ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="flex"
          >
            <ChevronLeft size={14} />
          </motion.span>
        </button>

        {/* Version number */}
        <AnimatePresence>
          {!sidebarCollapsed && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center text-[10px] text-text-disabled/50 font-mono pb-0.5 select-none"
            >
              v1.0.0
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.aside>
  )
}

function SidebarItem({
  path,
  icon: Icon,
  label,
  collapsed
}: NavItem & { collapsed: boolean; to?: string }) {
  const location = useLocation()
  const isActive = location.pathname === path

  return (
    <NavLink to={path} className="block">
      <motion.div
        whileTap={{ scale: 0.96 }}
        className={cn(
          'relative flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors duration-150 cursor-pointer group',
          !isActive && 'hover:bg-bg-elevated/60'
        )}
      >
        {/* Shared-element active pill glides between items */}
        {isActive && (
          <motion.div
            layoutId="sidebarActivePill"
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="absolute inset-0 rounded-xl bg-primary/[0.13] border border-primary/25"
            style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 18px -6px rgba(99,102,241,0.45)' }}
          />
        )}

        {/* Icon container */}
        <motion.div
          animate={isActive ? { scale: 1.06 } : { scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          className={cn(
            'relative flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150',
            isActive ? 'bg-primary/20' : 'group-hover:bg-bg-elevated'
          )}
        >
          <Icon
            size={16}
            className={cn(
              'transition-all duration-200 group-hover:scale-110',
              isActive ? 'text-primary-hover' : 'text-text-muted group-hover:text-text-secondary'
            )}
          />
        </motion.div>

        {/* Label */}
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.12 }}
              className={cn(
                'relative text-[13px] font-medium whitespace-nowrap overflow-hidden leading-none',
                isActive ? 'text-text-primary' : 'text-text-muted group-hover:text-text-secondary'
              )}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>

        {/* Active right accent */}
        {isActive && (
          <motion.div
            layoutId="sidebarActiveAccent"
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-[2.5px] h-5 bg-gradient-to-b from-primary to-violet-400 rounded-l-full"
          />
        )}

        {/* Collapsed tooltip */}
        {collapsed && (
          <div className="pointer-events-none absolute left-full ml-2.5 px-2.5 py-1.5 bg-bg-overlay/95 backdrop-blur-md border border-white/[0.1] rounded-lg text-[12px] text-text-primary whitespace-nowrap opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 z-50 shadow-card">
            {label}
          </div>
        )}
      </motion.div>
    </NavLink>
  )
}
