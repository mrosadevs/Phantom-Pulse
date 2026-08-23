import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import Store from 'electron-store'
import { registerFileHandlers } from './ipc/files'
import { registerQBHandlers } from './ipc/qb'
import { registerLicenseHandlers } from './ipc/license'

const settings = new Store({ name: 'settings' })

// Fix GPU process crash (exit_code=-1) on some AMD/Windows configurations
// Must be called before app ready event
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('no-sandbox')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#020817',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.phantompulse.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register IPC handlers
  registerFileHandlers(ipcMain)
  registerQBHandlers(ipcMain)
  registerLicenseHandlers(ipcMain)

  // Window control handlers
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.restore()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.close())

  createWindow()

  // Must come after createWindow(): it hooks mainWindow's ready-to-show to run
  // the launch-time update check.  Called at module scope it silently did
  // nothing, because mainWindow was still null.
  setupAutoUpdater()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ─── Auto-updater ────────────────────────────────────────────────────────────
/**
 * Two modes, chosen by the user in Settings:
 *
 *   ask  (default) — check on launch, tell the renderer an update exists, and
 *                    download nothing until the user agrees.
 *   auto           — download in the background and install on next quit,
 *                    with no prompt.
 *
 * Either way the check itself runs on every launch.  Note that updates come
 * from GitHub *Releases*, not from pushes: nothing appears here until a
 * release with a matching version and latest.yml is published.
 */
function setupAutoUpdater(): void {
  // Don't run in dev — no packaged app-update.yml exists
  if (is.dev) {
    ipcMain.handle('updater:check', () => ({ error: 'Auto-update is not available in dev mode.' }))
    ipcMain.on('updater:install', () => {})
    ipcMain.handle('updater:download', () => ({ error: 'Not available in dev mode.' }))
    ipcMain.handle('updater:getVersion', () => app.getVersion())
    ipcMain.handle('updater:getAuto', () => settings.get('autoUpdate', false) as boolean)
    ipcMain.handle('updater:setAuto', (_e, value: boolean) => {
      settings.set('autoUpdate', !!value)
      return { success: true }
    })
    return
  }

  const autoMode = (): boolean => settings.get('autoUpdate', false) as boolean

  autoUpdater.autoDownload = autoMode()
  autoUpdater.autoInstallOnAppQuit = true

  const send = (channel: string, payload: unknown): void => {
    mainWindow?.webContents.send(channel, payload)
  }

  autoUpdater.on('checking-for-update', () =>
    send('updater:status', { status: 'checking' })
  )
  autoUpdater.on('update-available', (info) =>
    // `auto` tells the renderer whether a download is already underway, so the
    // prompt can say "downloading…" instead of offering a button that does nothing.
    send('updater:status', { status: 'available', version: info.version, auto: autoMode() })
  )
  autoUpdater.on('update-not-available', (info) =>
    send('updater:status', { status: 'up-to-date', version: info.version })
  )
  autoUpdater.on('download-progress', (progress) =>
    send('updater:progress', { percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    send('updater:status', { status: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) =>
    send('updater:status', { status: 'error', error: err.message })
  )

  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.on('updater:install', () => autoUpdater.quitAndInstall())
  ipcMain.handle('updater:getVersion', () => app.getVersion())

  // Explicit download, for when the user accepts the prompt in `ask` mode.
  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('updater:getAuto', () => autoMode())
  ipcMain.handle('updater:setAuto', (_e, value: boolean) => {
    settings.set('autoUpdate', !!value)
    // Take effect immediately rather than only on next launch.
    autoUpdater.autoDownload = !!value
    return { success: true }
  })

  // Auto-check on launch after window is ready, with a short delay
  mainWindow?.once('ready-to-show', () => {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 4000)
  })
}
