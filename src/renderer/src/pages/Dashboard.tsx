import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  Upload,
  Download,
  Trash2,
  PenLine,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Clock,
  Wifi,
  WifiOff,
  FileText,
  ArrowUpRight,
  Activity,
  BarChart2,
  Zap
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts'
import { useQBStore } from '../store/useQBStore'
import { useHistoryStore } from '../store/useHistoryStore'
import type { HistoryEntry } from '../types/electron'

// Build last-7-days chart data from real history entries
function buildChartData(entries: HistoryEntry[]) {
  const days: { day: string; date: Date; imports: number; exports: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    d.setHours(0, 0, 0, 0)
    days.push({
      day: d.toLocaleDateString('en-US', { weekday: 'short' }),
      date: d,
      imports: 0,
      exports: 0
    })
  }

  for (const entry of entries) {
    const entryDate = new Date(entry.timestamp)
    entryDate.setHours(0, 0, 0, 0)
    const slot = days.find((d) => d.date.getTime() === entryDate.getTime())
    if (!slot) continue
    if (entry.operation === 'import') slot.imports += entry.successCount || 0
    if (entry.operation === 'export') slot.exports += entry.successCount || 0
  }

  return days.map(({ day, imports, exports }) => ({ day, imports, exports }))
}

const QUICK_ACTIONS = [
  {
    label: 'Import',
    description: 'Bulk import from CSV, Excel or IIF',
    icon: Upload,
    gradient: 'from-indigo-500/20 to-violet-500/10',
    border: 'border-indigo-500/20 hover:border-indigo-400/40',
    iconBg: 'bg-indigo-500/15',
    iconColor: 'text-indigo-400',
    arrowColor: 'text-indigo-400',
    path: '/import'
  },
  {
    label: 'Export',
    description: 'Pull data out to Excel or CSV',
    icon: Download,
    gradient: 'from-emerald-500/20 to-teal-500/10',
    border: 'border-emerald-500/20 hover:border-emerald-400/40',
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-400',
    arrowColor: 'text-emerald-400',
    path: '/export'
  },
  {
    label: 'Modify',
    description: 'Edit transactions in-place',
    icon: PenLine,
    gradient: 'from-amber-500/20 to-orange-500/10',
    border: 'border-amber-500/20 hover:border-amber-400/40',
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-amber-400',
    arrowColor: 'text-amber-400',
    path: '/modify'
  },
  {
    label: 'Delete',
    description: 'Bulk remove unwanted entries',
    icon: Trash2,
    gradient: 'from-rose-500/20 to-red-500/10',
    border: 'border-rose-500/20 hover:border-rose-400/40',
    iconBg: 'bg-rose-500/15',
    iconColor: 'text-rose-400',
    arrowColor: 'text-rose-400',
    path: '/delete'
  }
]

const stagger = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07 } }
}
const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } }
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { status } = useQBStore()
  const { entries } = useHistoryStore()

  const totalImports = entries.filter((e) => e.operation === 'import').length
  const totalRecords = entries.reduce((sum, e) => sum + (e.successCount || 0), 0)
  const totalErrors = entries.reduce((sum, e) => sum + (e.failCount || 0), 0)
  const todayCount = entries.filter((e) => {
    const d = new Date(e.timestamp)
    return d.toDateString() === new Date().toDateString()
  }).length
  const recentEntries = entries.slice(0, 8)
  const chartData = useMemo(() => buildChartData(entries), [entries])
  const hasChartData = chartData.some((d) => d.imports > 0 || d.exports > 0)

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-7xl mx-auto space-y-5">
        <motion.div variants={stagger} initial="hidden" animate="visible" className="space-y-5">

          {/* ── Header ─────────────────────────────────────────── */}
          <motion.div variants={fadeUp} className="flex items-center justify-between">
            <div>
              <h1 className="font-heading text-[22px] font-bold text-text-primary leading-tight">
                Dashboard
              </h1>
              <p className="text-text-muted text-[13px] mt-0.5">
                {status.mode === 'qbsdk'
                  ? `Connected · ${status.companyName}`
                  : 'Connect QuickBooks Desktop to start syncing'}
              </p>
            </div>

            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                status.mode === 'qbsdk'
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                  : 'bg-bg-elevated border-white/[0.12] text-text-muted'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  status.mode === 'qbsdk' ? 'bg-emerald-400 animate-pulse' : 'bg-text-disabled'
                }`}
              />
              {status.mode === 'qbsdk' ? 'QB Desktop Live' : 'Not Connected'}
            </div>
          </motion.div>

          {/* ── Stat Cards ─────────────────────────────────────── */}
          <motion.div variants={fadeUp} className="grid grid-cols-4 gap-3">
            <StatCard
              label="Total Imports"
              value={totalImports}
              sub="All time"
              icon={Upload}
              accent="#6366F1"
              accentAlpha="rgba(99,102,241,"
            />
            <StatCard
              label="Records Processed"
              value={totalRecords}
              sub="Successful rows"
              icon={TrendingUp}
              accent="#10B981"
              accentAlpha="rgba(16,185,129,"
            />
            <StatCard
              label="Errors"
              value={totalErrors}
              sub={totalErrors === 0 ? 'Clean run' : 'Need review'}
              icon={AlertCircle}
              accent="#EF4444"
              accentAlpha="rgba(239,68,68,"
            />
            <StatCard
              label="Today"
              value={todayCount}
              sub="Operations today"
              icon={Activity}
              accent="#F59E0B"
              accentAlpha="rgba(245,158,11,"
            />
          </motion.div>

          {/* ── Quick Actions ───────────────────────────────────── */}
          <motion.div variants={fadeUp}>
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-2.5">
              Quick Actions
            </p>
            <div className="grid grid-cols-4 gap-3">
              {QUICK_ACTIONS.map(
                ({ label, description, icon: Icon, gradient, border, iconBg, iconColor, arrowColor, path }) => (
                  <motion.button
                    key={label}
                    whileHover={{ y: -3, scale: 1.015 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => navigate(path)}
                    className={`relative overflow-hidden flex flex-col items-start gap-3.5 p-4 rounded-2xl border bg-gradient-to-br ${gradient} ${border} transition-all duration-200 cursor-pointer text-left`}
                  >
                    <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center`}>
                      <Icon size={17} className={iconColor} strokeWidth={2} />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-text-primary text-[13px] leading-snug">{label}</p>
                      <p className="text-text-muted text-[11px] mt-0.5 leading-snug">{description}</p>
                    </div>
                    <ArrowUpRight size={13} className={`${arrowColor} absolute top-3.5 right-3.5 opacity-60`} />
                  </motion.button>
                )
              )}
            </div>
          </motion.div>

          {/* ── Chart + Recent Activity ─────────────────────────── */}
          <motion.div variants={fadeUp} className="grid grid-cols-5 gap-4">
            {/* Chart */}
            <div className="col-span-3 rounded-2xl border border-white/[0.07] bg-bg-elevated/60 p-5">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="font-semibold text-text-primary text-[13px]">Transaction Activity</p>
                  <p className="text-text-muted text-[11px] mt-0.5">Records processed · last 7 days</p>
                </div>
                <div className="flex items-center gap-3">
                  <LegendDot color="#6366F1" label="Imports" />
                  <LegendDot color="#10B981" label="Exports" />
                </div>
              </div>

              {hasChartData ? (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                    <defs>
                      <linearGradient id="gradImport" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366F1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradExport" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1E293B" strokeDasharray="0" vertical={false} />
                    <XAxis
                      dataKey="day"
                      tick={{ fill: '#475569', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#475569', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={30}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#0F172A',
                        border: '1px solid #1E293B',
                        borderRadius: '10px',
                        color: '#F8FAFC',
                        fontSize: '12px',
                        padding: '8px 12px'
                      }}
                      cursor={{ stroke: '#334155', strokeWidth: 1 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="imports"
                      stroke="#6366F1"
                      strokeWidth={2}
                      fill="url(#gradImport)"
                      name="Imports"
                      dot={false}
                      activeDot={{ r: 4, fill: '#6366F1', stroke: '#0F172A', strokeWidth: 2 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="exports"
                      stroke="#10B981"
                      strokeWidth={2}
                      fill="url(#gradExport)"
                      name="Exports"
                      dot={false}
                      activeDot={{ r: 4, fill: '#10B981', stroke: '#0F172A', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[180px] flex flex-col items-center justify-center gap-2.5">
                  <div className="w-12 h-12 rounded-2xl bg-bg-overlay flex items-center justify-center">
                    <BarChart2 size={22} className="text-text-muted" />
                  </div>
                  <p className="text-text-muted text-[13px] font-medium">No activity yet</p>
                  <p className="text-text-disabled text-[11px]">
                    Chart will populate after your first import or export
                  </p>
                  <button
                    onClick={() => navigate('/import')}
                    className="mt-1 flex items-center gap-1.5 text-[11px] text-primary hover:text-indigo-300 transition-colors"
                  >
                    <Zap size={11} />
                    Import your first file
                  </button>
                </div>
              )}
            </div>

            {/* Recent Activity */}
            <div className="col-span-2 rounded-2xl border border-white/[0.07] bg-bg-elevated/60 p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <p className="font-semibold text-text-primary text-[13px]">Recent Activity</p>
                <button
                  onClick={() => navigate('/history')}
                  className="text-[11px] text-primary hover:text-indigo-300 transition-colors flex items-center gap-1"
                >
                  View all <ArrowUpRight size={11} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1 -mx-1">
                {recentEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2.5 py-8">
                    <div className="w-10 h-10 rounded-xl bg-bg-overlay flex items-center justify-center">
                      <FileText size={18} className="text-text-muted" />
                    </div>
                    <p className="text-text-muted text-[12px] font-medium">Nothing yet</p>
                    <p className="text-text-disabled text-[11px] text-center px-4">
                      Your operation history will appear here
                    </p>
                  </div>
                ) : (
                  recentEntries.map((entry, i) => (
                    <ActivityRow key={entry.id} entry={entry} index={i} />
                  ))
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  accentAlpha
}: {
  label: string
  value: number
  sub: string
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
  accent: string
  accentAlpha: string
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-bg-elevated/70 p-4 hover:border-white/[0.14] transition-all duration-200 group"
      style={{ boxShadow: `inset 0 1px 0 ${accentAlpha}0.12)` }}
    >
      {/* Subtle top accent line */}
      <div
        className="absolute top-0 left-4 right-4 h-[1.5px] rounded-b-full"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}90, transparent)` }}
      />

      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-text-muted uppercase tracking-wider">{label}</p>
          <p
            className="text-[28px] font-bold mt-1.5 leading-none font-heading"
            style={{ color: value === 0 ? '#475569' : '#F8FAFC' }}
          >
            {value.toLocaleString()}
          </p>
          <p className="text-[11px] text-text-muted mt-1.5">{sub}</p>
        </div>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${accentAlpha}0.12)` }}
        >
          <Icon size={17} style={{ color: accent }} />
        </div>
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] text-text-muted">{label}</span>
    </div>
  )
}

const OP_STYLE: Record<string, { icon: typeof Upload; color: string; bg: string }> = {
  import: { icon: Upload, color: '#818CF8', bg: 'rgba(99,102,241,0.1)' },
  export: { icon: Download, color: '#34D399', bg: 'rgba(16,185,129,0.1)' },
  delete: { icon: Trash2, color: '#F87171', bg: 'rgba(239,68,68,0.1)' },
  modify: { icon: PenLine, color: '#FCD34D', bg: 'rgba(245,158,11,0.1)' }
}

function ActivityRow({ entry, index }: { entry: HistoryEntry; index: number }) {
  const style = OP_STYLE[entry.operation] ?? {
    icon: FileText,
    color: '#94A3B8',
    bg: 'rgba(148,163,184,0.1)'
  }
  const Icon = style.icon

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-bg-overlay/50 transition-colors duration-100"
    >
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: style.bg }}
      >
        <Icon size={13} style={{ color: style.color }} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-text-secondary text-[12px] font-medium truncate leading-tight">
          {entry.operation.charAt(0).toUpperCase() + entry.operation.slice(1)}{' '}
          <span className="text-text-muted font-normal">{entry.type}</span>
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {entry.successCount > 0 && (
            <span className="text-emerald-400 text-[10px]">{entry.successCount} ok</span>
          )}
          {entry.failCount > 0 && (
            <span className="text-rose-400 text-[10px]">{entry.failCount} failed</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 text-text-disabled text-[10px] flex-shrink-0">
        <Clock size={9} />
        {formatRelative(entry.timestamp)}
      </div>
    </motion.div>
  )
}

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}
