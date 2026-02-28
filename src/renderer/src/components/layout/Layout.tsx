import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import TitleBar from './TitleBar'
import Sidebar from './Sidebar'
import { useQBStore } from '../../store/useQBStore'
import { useHistoryStore } from '../../store/useHistoryStore'
import { useAppStore } from '../../store/useAppStore'

export default function Layout() {
  const { refreshStatus } = useQBStore()
  const { load } = useHistoryStore()
  const { theme } = useAppStore()

  useEffect(() => {
    refreshStatus()
    load()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-base">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden bg-bg-base">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
