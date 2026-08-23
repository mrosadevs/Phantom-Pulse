import { useLocation, useOutlet } from 'react-router-dom'
import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TitleBar from './TitleBar'
import Sidebar from './Sidebar'
import { useQBStore } from '../../store/useQBStore'
import { useHistoryStore } from '../../store/useHistoryStore'
import { useAppStore } from '../../store/useAppStore'

export default function Layout() {
  const { refreshStatus } = useQBStore()
  const { load } = useHistoryStore()
  const { theme } = useAppStore()
  const location = useLocation()
  // Snapshot of the matched route element — unlike <Outlet/>, this stays
  // pinned to its own location during exit animations, so the outgoing page
  // doesn't flash the incoming route's content.
  const outlet = useOutlet()

  useEffect(() => {
    refreshStatus()
    load()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-base">
      {/* Ambient background — slow-drifting aurora + fine noise */}
      <div className="app-aurora">
        <div className="app-aurora-accent" />
      </div>
      <div className="app-noise" />

      <TitleBar />
      <div className="flex flex-1 overflow-hidden relative z-10">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {/* Route transitions — quick fade/lift so navigation feels alive
              without ever getting in the way */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10, scale: 0.995 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.998 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="h-full"
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
