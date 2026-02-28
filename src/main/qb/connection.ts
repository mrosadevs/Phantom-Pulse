/**
 * QuickBooks Desktop Connection — utilityProcess bridge
 *
 * All winax COM calls are dispatched to qbProcess.ts running in a
 * SEPARATE OS PROCESS (Electron utilityProcess) so they never block
 * the Electron main process event loop, AND so COM STA re-entrancy
 * (required for the QB authorization dialog) works correctly.
 *
 * worker_threads share the same OS process as Electron and do not run
 * a Windows message loop, so COM re-entrant callbacks (the QB auth
 * dialog) cannot surface. utilityProcess forks a real separate process
 * whose libuv event loop calls MsgWaitForMultipleObjectsEx — which
 * properly pumps Windows messages for COM STA.
 */
import { utilityProcess, UtilityProcess, BrowserWindow } from 'electron'
import { join } from 'path'

export interface QBStatus {
  connected: boolean
  companyFile?: string
  companyName?: string
  qbVersion?: string
  error?: string
  mode: 'qbsdk' | 'iif' | 'disconnected'
}

type PendingRequest = {
  resolve: (val: unknown) => void
  reject: (err: Error) => void
}

export class QBConnection {
  private child: UtilityProcess | null = null
  private pending: Map<string, PendingRequest> = new Map()
  private msgId = 0
  private status: QBStatus = { connected: false, mode: 'disconnected' }

  // ─── Process lifecycle ────────────────────────────────────────────────────

  private getChild(): UtilityProcess {
    if (this.child) return this.child

    // In both dev and production the process script lands next to index.js in out/main/
    const processPath = join(__dirname, 'qbProcess.js')
    this.child = utilityProcess.fork(processPath, [], { stdio: 'pipe' })

    this.child.on(
      'message',
      (msg: {
        type?: string
        id?: string
        success?: boolean
        result?: unknown
        error?: string
        step?: string
        detail?: string
      }) => {
        // Forward log/progress messages to renderer
        if (msg.type === 'log') {
          console.log(`[QB Process] ${msg.step}: ${msg.detail ?? ''}`)
          BrowserWindow.getAllWindows()[0]?.webContents.send('qb:connectProgress', {
            step: msg.step,
            detail: msg.detail
          })
          return
        }
        const p = this.pending.get(msg.id!)
        if (!p) return
        this.pending.delete(msg.id!)
        if (msg.success) p.resolve(msg.result)
        else p.reject(new Error(msg.error ?? 'QB process error'))
      }
    )

    this.child.on('exit', (code) => {
      if (code !== 0) {
        // Reject all pending requests — process died unexpectedly
        for (const [id, p] of this.pending) {
          p.reject(new Error(`QB process exited with code ${code}`))
          this.pending.delete(id)
        }
        this.child = null
        this.status = {
          connected: false,
          mode: 'disconnected',
          error: `QB process exited with code ${code}`
        }
      }
    })

    return this.child
  }

  /**
   * Send a command to the QB utility process.
   * @param timeoutMs How long to wait before giving up and killing the process.
   *   Default 30 s. Use 120 000 for connect (user needs time to approve the
   *   QB authorization dialog).
   */
  private send<T>(cmd: string, args?: Record<string, string>, timeoutMs = 30_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = String(++this.msgId)

      const timer = setTimeout(() => {
        this.pending.delete(id)
        // Kill the child process to unblock any hanging COM call
        this.child?.kill()
        this.child = null
        reject(
          new Error(
            'Timed out waiting for QuickBooks.\n\n' +
              'Common causes:\n' +
              '• No company file is open in QuickBooks (you see a grey/empty workspace) — open your .qbw file first\n' +
              '• The "Phantom Pulse" authorization dialog appeared in QuickBooks but was missed — check the QB taskbar button\n' +
              '• Edit → Preferences → Integrated Applications: make sure "Don\'t allow any applications..." is UNCHECKED'
          )
        )
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (val: unknown) => {
          clearTimeout(timer)
          ;(resolve as (v: unknown) => void)(val)
        },
        reject: (err: Error) => {
          clearTimeout(timer)
          reject(err)
        }
      })

      this.getChild().postMessage({ id, cmd, args })
    })
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  async connect(
    companyFile?: string
  ): Promise<{ success: boolean; status: QBStatus; error?: string }> {
    // Terminate any existing process so we get a clean COM session
    this.disconnect()

    try {
      // 2-minute timeout — user may need time to see and approve the QB auth dialog
      const result = await this.send<QBStatus>(
        'connect',
        { companyFile: companyFile ?? '' },
        120_000
      )
      this.status = { ...result, connected: true, mode: 'qbsdk' }
      return { success: true, status: this.status }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err)

      let message = raw
      if (
        raw.includes('QBXMLRP2') ||
        raw.includes('class not registered') ||
        raw.includes('Invalid class string')
      ) {
        message =
          'QuickBooks Desktop is not installed or is not running. Please open QuickBooks Desktop with a company file and try again.'
      } else if (
        raw.includes('already has a company file open') ||
        raw.includes('open two company files') ||
        raw.includes('already open') ||
        raw.includes('multiple company files') ||
        raw.includes('different from the one requested')
      ) {
        message =
          'QuickBooks has a company file open but the path did not match. Use the ⚡ Auto-detect button to grab the exact path QB is using, then try connecting again.'
      } else if (raw.includes('permission') || raw.includes('access')) {
        message =
          'QuickBooks denied access. Make sure QB is open, then approve the "Phantom Pulse" authorization prompt in QuickBooks.'
      }

      this.status = { connected: false, mode: 'disconnected', error: message }
      return { success: false, status: this.status, error: message }
    }
  }

  disconnect(): void {
    // Reject all pending requests immediately so callers aren't left hanging
    for (const [, p] of this.pending) {
      p.reject(new Error('Disconnected'))
    }
    this.pending.clear()

    if (this.child) {
      // Try graceful EndSession/CloseConnection, then force-kill after 500 ms
      try {
        this.child.postMessage({ id: '__disc__', cmd: 'disconnect' })
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        this.child?.kill()
        this.child = null
      }, 500)
    }
    this.status = { connected: false, mode: 'disconnected' }
  }

  async sendRequest(qbXML: string): Promise<string> {
    if (!this.status.connected) {
      throw new Error('Not connected to QuickBooks Desktop')
    }
    return this.send<string>('sendRequest', { xml: qbXML })
  }

  isConnected(): boolean {
    return this.status.connected && this.status.mode === 'qbsdk'
  }

  getStatus(): QBStatus {
    return this.status
  }
}
