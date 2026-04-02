import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { registerFileHandlers } from './ipc/files'
import { registerQBHandlers } from './ipc/qb'

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
function setupAutoUpdater(): void {
  // Don't run in dev — no packaged app-update.yml exists
  if (is.dev) {
    ipcMain.handle('updater:check', () => ({ error: 'Auto-update is not available in dev mode.' }))
    ipcMain.on('updater:install', () => {})
    ipcMain.handle('updater:getVersion', () => app.getVersion())
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (channel: string, payload: unknown): void => {
    mainWindow?.webContents.send(channel, payload)
  }

  autoUpdater.on('checking-for-update', () =>
    send('updater:status', { status: 'checking' })
  )
  autoUpdater.on('update-available', (info) =>
    send('updater:status', { status: 'available', version: info.version })
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

  // Auto-check on launch after window is ready, with a short delay
  mainWindow?.once('ready-to-show', () => {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 4000)
  })
}

setupAutoUpdater()
