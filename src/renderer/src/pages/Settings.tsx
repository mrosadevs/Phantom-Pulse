import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wifi,
  WifiOff,
  Loader2,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Info,
  Database,
  Shield,
  X,
  Zap,
  TriangleAlert,
  RefreshCw,
  Download,
  Sparkles,
  Tag
} from 'lucide-react'
import { toast } from 'sonner'
import { useQBStore } from '../store/useQBStore'

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

const STORAGE_KEY = 'qb_company_file_path'

export default function SettingsPage() {
  const { status, isConnecting, connect, cancelConnect, disconnect } = useQBStore()
  const [companyFile, setCompanyFile] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '')
  const [hoveringConnect, setHoveringConnect] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [connectStep, setConnectStep] = useState('')
  const listenerRef = useRef(false)

  // Updater state
  const [appVersion, setAppVersion] = useState<string>('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [updateVersion, setUpdateVersion] = useState<string>('')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [updateError, setUpdateError] = useState<string>('')

  // Persist path whenever it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, companyFile)
  }, [companyFile])

  // Listen for progress updates from the worker thread
  useEffect(() => {
    if (listenerRef.current) return
    listenerRef.current = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electronOn = (window as any).electronOn
    if (electronOn) {
      electronOn('qb:connectProgress', (_: unknown, data: { step: string; detail: string }) => {
        setConnectStep(data.detail ?? data.step)
      })
      electronOn(
        'updater:status',
        (
          _: unknown,
          data: { status: UpdateStatus; version?: string; error?: string }
        ) => {
          setUpdateStatus(data.status)
          if (data.version) setUpdateVersion(data.version)
          if (data.error) setUpdateError(data.error)
          if (data.status === 'available') {
            toast.info(`Update v${data.version} is available — downloading…`)
          } else if (data.status === 'downloaded') {
            toast.success(`v${data.version} downloaded — restart to install.`)
          } else if (data.status === 'error') {
            toast.error(`Update error: ${data.error}`)
          }
        }
      )
      electronOn('updater:progress', (_: unknown, data: { percent: number }) => {
        setUpdateStatus('downloading')
        setDownloadPercent(data.percent)
      })
    }
  }, [])

  // Fetch current app version on mount
  useEffect(() => {
    window.api.updater.getVersion().then(setAppVersion).catch(() => {})
  }, [])

  const setPath = (raw: string) => {
    setCompanyFile(raw.replace(/^"|"$/g, '').trim())
  }

  const handleBrowse = async () => {
    const result = await window.api.files.openDialog({
      title: 'Select QuickBooks Company File',
      filters: [{ name: 'QuickBooks Files', extensions: ['qbw', 'qbm', 'qbb'] }],
      properties: ['openFile']
    })
    if (!result.canceled && result.filePaths[0]) {
      setPath(result.filePaths[0])
    }
  }

  const handleDetect = async () => {
    setDetecting(true)
    try {
      const result = await window.api.qb.detectCompanyFile()
      if (result.success && result.path) {
        setPath(result.path)
        toast.success('Company file detected from QuickBooks!')
      } else {
        toast.error(result.error ?? 'Could not detect QB file. Make sure QuickBooks is open.')
      }
    } catch {
      toast.error('Detection failed. Make sure QuickBooks is running.')
    } finally {
      setDetecting(false)
    }
  }

  const handleConnect = async () => {
    const success = await connect(companyFile || undefined)
    if (success) {
      toast.success('Connected to QuickBooks Desktop!')
    } else {
      toast.error(status.error || 'Connection failed. Make sure QuickBooks Desktop is running.')
    }
  }

  const handleDisconnect = async () => {
    await disconnect()
    toast.info('Disconnected from QuickBooks Desktop')
  }

  const handleCancelConnect = async () => {
    await cancelConnect()
    toast.info('Connection cancelled')
  }

  const handleCheckForUpdates = async () => {
    setUpdateStatus('checking')
    setUpdateError('')
    const result = await window.api.updater.check()
    if (result?.error) {
      setUpdateStatus('error')
      setUpdateError(result.error)
      toast.error(`Could not check for updates: ${result.error}`)
    }
  }

  const handleInstallUpdate = () => {
    window.api.updater.install()
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl mx-auto space-y-6"
      >
        {/* Header */}
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">Settings</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Configure your QuickBooks Desktop connection and application preferences
          </p>
        </div>

        {/* QB Connection section */}
        <div className="glass-card p-6 space-y-5">
          <div className="flex items-center gap-3 pb-4 border-b border-white/[0.08]">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Database size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-text-primary">QuickBooks Desktop Connection</h2>
              <p className="text-text-muted text-xs mt-0.5">
                Connect via QuickBooks SDK (QBSDK) for live read/write access
              </p>
            </div>

            {/* Status badge */}
            <div className="ml-auto">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                  status.mode === 'qbsdk'
                    ? 'bg-success/10 border-success/30 text-success'
                    : status.mode === 'iif'
                      ? 'bg-warning/10 border-warning/30 text-warning'
                      : 'bg-bg-elevated border-white/[0.12] text-text-muted'
                }`}
              >
                {status.mode === 'qbsdk' ? (
                  <CheckCircle2 size={13} />
                ) : status.mode === 'iif' ? (
                  <AlertCircle size={13} />
                ) : (
                  <WifiOff size={13} />
                )}
                {status.mode === 'qbsdk'
                  ? 'Connected'
                  : status.mode === 'iif'
                    ? 'IIF Mode'
                    : 'Disconnected'}
              </div>
            </div>
          </div>

          {/* Connection info when connected */}
          {status.mode === 'qbsdk' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 rounded-xl bg-success/5 border border-success/20 space-y-2"
            >
              <div className="flex items-center gap-2">
                <Wifi size={16} className="text-success" />
                <span className="text-success font-medium text-sm">
                  Connected to QuickBooks Desktop
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-text-muted">Company: </span>
                  <span className="text-text-primary font-medium">
                    {status.companyName || 'Unknown'}
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">QB Version: </span>
                  <span className="text-text-primary font-medium">
                    {status.qbVersion || 'Unknown'}
                  </span>
                </div>
                {status.companyFile && (
                  <div className="col-span-2">
                    <span className="text-text-muted">File: </span>
                    <span className="text-text-secondary font-mono text-[10px]">
                      {status.companyFile}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Company file selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-text-muted block font-medium">
                Company File Path
              </label>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning border border-warning/25 font-medium">
                Required for QB Accountant
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={companyFile}
                onChange={(e) => setPath(e.target.value)}
                onPaste={(e) => {
                  e.preventDefault()
                  setPath(e.clipboardData.getData('text'))
                }}
                placeholder="C:\Users\...\CompanyFile.qbw"
                className="input-field flex-1 text-sm font-mono"
              />
              <button
                onClick={handleDetect}
                disabled={detecting}
                title="Auto-detect from running QuickBooks"
                className="btn-secondary px-3 flex items-center gap-1.5 text-sm flex-shrink-0 text-primary border-primary/30 hover:bg-primary/10"
              >
                {detecting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Zap size={14} />
                )}
                {detecting ? 'Detecting...' : 'Auto-detect'}
              </button>
              <button
                onClick={handleBrowse}
                className="btn-secondary px-3 flex items-center gap-1.5 text-sm flex-shrink-0"
              >
                <FolderOpen size={14} />
                Browse
              </button>
            </div>
            <p className="text-text-disabled text-xs mt-1.5">
              Click <span className="text-primary font-medium">Auto-detect</span> to read the path
              directly from your running QuickBooks, or paste the path manually.
            </p>

            {/* Pre-connect requirement notice */}
            {status.mode !== 'qbsdk' && (
              <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-bg-surface border border-white/[0.06]">
                <TriangleAlert size={13} className="text-warning flex-shrink-0 mt-0.5" />
                <p className="text-text-muted text-xs leading-relaxed">
                  <span className="text-warning font-medium">Before connecting:</span> make sure
                  QuickBooks Desktop is open{' '}
                  <span className="text-text-secondary font-medium">
                    with the company file loaded
                  </span>{' '}
                  (not the grey empty workspace). QuickBooks will prompt you to authorize Phantom
                  Pulse on the first connection.
                </p>
              </div>
            )}
          </div>

          {/* Connect/Disconnect buttons */}
          <div className="flex gap-3">
            {status.mode !== 'qbsdk' ? (
              isConnecting ? (
                <button
                  onClick={handleCancelConnect}
                  onMouseEnter={() => setHoveringConnect(true)}
                  onMouseLeave={() => setHoveringConnect(false)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all duration-150 ${
                    hoveringConnect
                      ? 'bg-danger/15 border border-danger/30 text-danger'
                      : 'bg-primary/10 border border-primary/30 text-primary'
                  }`}
                >
                  {hoveringConnect ? (
                    <>
                      <X size={15} />
                      Cancel Connection
                    </>
                  ) : (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      {connectStep ? connectStep.split('\n')[0] : 'Connecting...'}
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  className="btn-primary flex items-center gap-2 px-5 py-2.5"
                >
                  <Wifi size={15} />
                  Connect to QuickBooks Desktop
                </button>
              )
            ) : (
              <button
                onClick={handleDisconnect}
                className="btn-secondary flex items-center gap-2 px-5 py-2.5"
              >
                <WifiOff size={15} />
                Disconnect
              </button>
            )}
          </div>

          {/* BeginSession — waiting for QB auth dialog banner */}
          <AnimatePresence>
            {isConnecting && connectStep.toLowerCase().includes('switch to quickbooks') && (
              <motion.div
                key="auth-banner"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="p-4 rounded-xl bg-warning/8 border border-warning/30 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <TriangleAlert size={15} className="text-warning flex-shrink-0" />
                  <span className="text-warning font-semibold text-sm">
                    Action required in QuickBooks
                  </span>
                </div>
                <ul className="space-y-1 text-xs text-text-secondary pl-1">
                  <li className="flex items-start gap-1.5">
                    <span className="text-warning mt-0.5">1.</span>
                    <span>
                      <strong className="text-text-primary">Open your company file</strong> in
                      QuickBooks — if you see a grey/empty workspace, go to{' '}
                      <span className="font-mono text-[10px] text-text-primary">
                        File → Open or Restore Company
                      </span>
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-warning mt-0.5">2.</span>
                    <span>
                      Watch for an{' '}
                      <strong className="text-text-primary">
                        "Application Certificate" authorization dialog
                      </strong>{' '}
                      — click <em>Yes, always allow access</em>
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-warning mt-0.5">3.</span>
                    <span>
                      If no dialog appears, check{' '}
                      <span className="font-mono text-[10px] text-text-primary">
                        Edit → Preferences → Integrated Applications
                      </span>{' '}
                      and make sure{' '}
                      <em>"Don't allow any applications to access this company file"</em> is{' '}
                      <strong className="text-text-primary">unchecked</strong>
                    </span>
                  </li>
                </ul>
                <p className="text-text-disabled text-[10px] pt-1">
                  Connection will time out in ~2 minutes if no response.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error display */}
          {status.error && status.mode !== 'qbsdk' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20">
              <AlertCircle size={14} className="text-danger flex-shrink-0 mt-0.5" />
              <p className="text-danger text-xs whitespace-pre-wrap">{status.error}</p>
            </div>
          )}
        </div>

        {/* IIF Mode info */}
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <Info size={20} className="text-warning" />
            </div>
            <div>
              <h2 className="font-semibold text-text-primary">IIF File Mode</h2>
              <p className="text-text-muted text-xs mt-0.5">
                Use IIF export when QuickBooks Desktop is not running
              </p>
            </div>
          </div>

          <p className="text-text-muted text-sm leading-relaxed">
            When not connected to QuickBooks Desktop, Phantom Pulse generates{' '}
            <span className="text-warning font-medium">IIF (Intuit Interchange Format)</span> files
            from your data. You can then import these files manually into QuickBooks Desktop via{' '}
            <span className="font-mono text-text-primary text-xs">
              File → Utilities → Import → IIF Files
            </span>
            .
          </p>

          <div className="space-y-1.5">
            {[
              'No QuickBooks connection required for IIF mode',
              'Generated IIF files are compatible with all QB Desktop versions',
              'Supports all major transaction types',
              'Connect via QBSDK for live read/write without manual import'
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 text-xs text-text-muted">
                <CheckCircle2 size={12} className="text-success flex-shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Requirements section */}
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-bg-overlay flex items-center justify-center">
              <Shield size={20} className="text-text-muted" />
            </div>
            <h2 className="font-semibold text-text-primary">QBSDK Requirements</h2>
          </div>

          <div className="space-y-2">
            {[
              {
                label: 'QuickBooks Desktop must be running',
                sub: 'Pro, Premier, Enterprise, or Accountant edition'
              },
              {
                label: 'Open the company file before connecting',
                sub: 'QuickBooks must have a company file open'
              },
              {
                label: 'Authorize Phantom Pulse on first connect',
                sub: 'QuickBooks will show a certificate authorization dialog'
              },
              {
                label: 'Run QuickBooks as Administrator',
                sub: 'Required for COM/QBSDK access on Windows 10/11'
              }
            ].map(({ label, sub }) => (
              <div key={label} className="flex items-start gap-3 p-3 rounded-lg bg-bg-surface">
                <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                <div>
                  <p className="text-text-secondary text-sm font-medium">{label}</p>
                  <p className="text-text-disabled text-xs mt-0.5">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Application Updates section */}
        <div className="glass-card p-6 space-y-5">
          <div className="flex items-center gap-3 pb-4 border-b border-white/[0.08]">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Download size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-text-primary">Application Updates</h2>
              <p className="text-text-muted text-xs mt-0.5">
                Automatically checks GitHub Releases for new versions on launch
              </p>
            </div>
            {appVersion && (
              <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-elevated border border-white/[0.10] text-xs text-text-muted">
                <Tag size={11} />
                v{appVersion}
              </div>
            )}
          </div>

          {/* Status display */}
          <AnimatePresence mode="wait">
            {updateStatus === 'up-to-date' && (
              <motion.div
                key="up-to-date"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-3 p-4 rounded-xl bg-success/5 border border-success/20"
              >
                <CheckCircle2 size={18} className="text-success flex-shrink-0" />
                <div>
                  <p className="text-success font-medium text-sm">You're up to date</p>
                  <p className="text-text-muted text-xs mt-0.5">
                    v{updateVersion || appVersion} is the latest version
                  </p>
                </div>
              </motion.div>
            )}

            {updateStatus === 'available' && (
              <motion.div
                key="available"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20"
              >
                <Sparkles size={18} className="text-primary flex-shrink-0" />
                <div>
                  <p className="text-primary font-medium text-sm">
                    v{updateVersion} is available — downloading…
                  </p>
                  <p className="text-text-muted text-xs mt-0.5">
                    The update will install automatically when it's ready
                  </p>
                </div>
              </motion.div>
            )}

            {updateStatus === 'downloading' && (
              <motion.div
                key="downloading"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-3 p-4 rounded-xl bg-primary/5 border border-primary/20"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Loader2 size={16} className="text-primary animate-spin flex-shrink-0" />
                    <p className="text-primary font-medium text-sm">
                      Downloading v{updateVersion}…
                    </p>
                  </div>
                  <span className="text-primary text-xs font-mono">{downloadPercent}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-primary/20 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    animate={{ width: `${downloadPercent}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </motion.div>
            )}

            {updateStatus === 'downloaded' && (
              <motion.div
                key="downloaded"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-3 p-4 rounded-xl bg-success/5 border border-success/20"
              >
                <CheckCircle2 size={18} className="text-success flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-success font-medium text-sm">
                    v{updateVersion} is ready to install
                  </p>
                  <p className="text-text-muted text-xs mt-0.5">
                    Restart the app to apply the update
                  </p>
                </div>
              </motion.div>
            )}

            {updateStatus === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-start gap-3 p-4 rounded-xl bg-danger/5 border border-danger/20"
              >
                <AlertCircle size={18} className="text-danger flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-danger font-medium text-sm">Update check failed</p>
                  <p className="text-text-muted text-xs mt-0.5 break-all">{updateError}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleCheckForUpdates}
              disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
              className="btn-secondary flex items-center gap-2 px-5 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateStatus === 'checking' ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              {updateStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
            </button>

            {updateStatus === 'downloaded' && (
              <motion.button
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={handleInstallUpdate}
                className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm"
              >
                <Download size={15} />
                Restart &amp; Install
              </motion.button>
            )}
          </div>

          <p className="text-text-disabled text-xs">
            Updates are downloaded automatically in the background. You'll be notified when a new
            version is ready to install.
          </p>
        </div>
      </motion.div>
    </div>
  )
}
