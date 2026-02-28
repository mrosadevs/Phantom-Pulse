import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle2,
  Search,
  Filter,
  Edit3,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { useQBStore } from '../../store/useQBStore'
import type { ImportState } from './index'

const PAGE_SIZE = 50

interface Props {
  state: ImportState
  updateState: (u: Partial<ImportState>) => void
  onNext: () => void
  onBack: () => void
}

export default function Step4Preview({ state, updateState, onNext, onBack }: Props) {
  const { status } = useQBStore()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [rows, setRows] = useState<Record<string, string>[]>(state.previewRows)

  const fields = Object.keys(rows[0] || {})

  const filtered = useMemo(() => {
    if (!search) return rows
    return rows.filter((row) =>
      Object.values(row).some((v) => v.toLowerCase().includes(search.toLowerCase()))
    )
  }, [rows, search])

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const startEdit = (rowIndex: number, col: string, value: string) => {
    setEditingCell({ row: rowIndex + page * PAGE_SIZE, col })
    setEditValue(value)
  }

  const commitEdit = () => {
    if (!editingCell) return
    const newRows = [...rows]
    newRows[editingCell.row] = { ...newRows[editingCell.row], [editingCell.col]: editValue }
    setRows(newRows)
    setEditingCell(null)
  }

  const handleImport = async () => {
    updateState({ previewRows: rows, mode: status.mode === 'qbsdk' ? 'qbsdk' : 'iif' })
    onNext()
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Controls */}
      <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 bg-bg-surface/50 border-b border-white/[0.08]">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            placeholder="Search rows..."
            className="input-field pl-9 w-full text-sm"
          />
        </div>

        <div className="flex items-center gap-2 text-text-muted text-sm">
          <Filter size={13} />
          <span>
            {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} rows
          </span>
        </div>

        {/* Import mode badge */}
        <div
          className={`px-3 py-1 rounded-lg text-xs font-medium border ${
            status.mode === 'qbsdk'
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-warning/10 border-warning/30 text-warning'
          }`}
        >
          {status.mode === 'qbsdk' ? '● Live QB Import' : '● IIF File Export'}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg-surface border-b border-white/[0.12]">
              <th className="w-12 px-3 py-2.5 text-text-muted font-medium text-left">#</th>
              {fields.map((f) => (
                <th
                  key={f}
                  className="px-3 py-2.5 text-text-muted font-medium text-left whitespace-nowrap min-w-[120px]"
                >
                  {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => {
              const globalIndex = i + page * PAGE_SIZE
              return (
                <tr
                  key={globalIndex}
                  className="border-b border-white/[0.05] hover:bg-bg-surface/60 transition-colors group"
                >
                  <td className="px-3 py-2 text-text-disabled">{globalIndex + 1}</td>
                  {fields.map((col) => {
                    const isEditing =
                      editingCell?.row === globalIndex && editingCell?.col === col
                    const value = row[col] || ''

                    return (
                      <td key={col} className="px-3 py-2 max-w-[200px]">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              if (e.key === 'Escape') setEditingCell(null)
                            }}
                            className="w-full bg-bg-overlay border border-primary rounded px-2 py-0.5 text-xs text-text-primary focus:outline-none"
                          />
                        ) : (
                          <div
                            className="flex items-center gap-1 group/cell cursor-text"
                            onClick={() => startEdit(i, col, value)}
                          >
                            <span className="truncate text-text-secondary">{value || '—'}</span>
                            <Edit3
                              size={10}
                              className="text-text-disabled opacity-0 group-hover/cell:opacity-100 flex-shrink-0 transition-opacity"
                            />
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination + Footer */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-t border-white/[0.08] bg-bg-surface/50">
        <button onClick={onBack} className="btn-secondary px-4 text-sm">
          ← Back
        </button>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded hover:bg-bg-elevated disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1 rounded hover:bg-bg-elevated disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="text-xs text-text-muted flex items-center gap-1.5">
            <CheckCircle2 size={12} className="text-success" />
            {rows.length.toLocaleString()} rows ready
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleImport}
            className="btn-primary px-6 py-2.5 font-semibold"
          >
            {status.mode === 'qbsdk' ? 'Import to QuickBooks →' : 'Export IIF File →'}
          </motion.button>
        </div>
      </div>
    </div>
  )
}
