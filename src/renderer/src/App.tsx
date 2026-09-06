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
import GLImportPage from './pages/GLImport'
import LedgerPage from './pages/Ledger'
import ReportsPage from './pages/Reports'
import AuditPage from './pages/Audit'
import HygienePage from './pages/Hygiene'
import BulkEditPage from './pages/BulkEdit'
import SetupPage from './pages/Setup'
import LicenseGate from './components/LicenseGate'
import UpdatePrompt from './components/UpdatePrompt'

export default function App() {
  return (
    <>
      {/* Outside the gate: the activation screen raises toasts of its own, so
          the Toaster has to be mounted before the app is unlocked. */}
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
      <LicenseGate>
        <HashRouter>
          <UpdatePrompt />
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="import" element={<ImportWizard />} />
              <Route path="export" element={<ExportPage />} />
              <Route path="delete" element={<DeletePage />} />
              <Route path="modify" element={<ModifyPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="gl-import" element={<GLImportPage />} />
              <Route path="ledger" element={<LedgerPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="hygiene" element={<HygienePage />} />
              <Route path="bulk" element={<BulkEditPage />} />
              <Route path="setup" element={<SetupPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </HashRouter>
      </LicenseGate>
    </>
  )
}
