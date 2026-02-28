import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import ImportWizard from './pages/Import'
import ExportPage from './pages/Export'
import DeletePage from './pages/Delete'
import ModifyPage from './pages/Modify'
import HistoryPage from './pages/History'
import SettingsPage from './pages/Settings'

export default function App() {
  return (
    <HashRouter>
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: '#1E293B',
            border: '1px solid #334155',
            color: '#F8FAFC'
          }
        }}
      />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="import" element={<ImportWizard />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="delete" element={<DeletePage />} />
          <Route path="modify" element={<ModifyPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
