/**
 * QB Utility Process — runs in Electron utilityProcess (separate OS process)
 *
 * WHY utilityProcess instead of worker_threads:
 *   worker_threads share the same OS process as Electron's main process.
 *   Electron's main process does NOT run a traditional Windows message loop
 *   (GetMessage/DispatchMessage), so COM STA calls on worker threads cannot
 *   receive re-entrant COM callbacks — which is exactly how QuickBooks
 *   dispatches its "Phantom Pulse wants access" authorization dialog.
 *
 *   utilityProcess forks a SEPARATE OS process. libuv in that process runs
 *   MsgWaitForMultipleObjectsEx which pumps Windows messages, allowing COM
 *   STA re-entrancy and the QB authorization dialog to surface correctly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WinaxObject = any

let rp: WinaxObject = null
let ticket = ''
let companyFile = ''

/** Send a progress/log message back to the main process */
function log(step: string, detail?: string): void {
  process.parentPort!.postMessage({ type: 'log', step, detail })
}

function doConnect(cf: string): object {
  doDisconnect()

  log('loading', 'Loading winax COM module...')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const winax = require('winax')

  log('creating', 'Creating QBXMLRP2.RequestProcessor COM object...')
  rp = new winax.Object('QBXMLRP2.RequestProcessor')
  companyFile = cf || ''

  log('opening', 'Calling OpenConnection2...')
  rp.OpenConnection2('', 'Phantom Pulse', 1)

  const fileDesc = companyFile || '(use currently open file)'
  log(
    'session',
    `⚠️ Switch to QuickBooks NOW — look for the authorization dialog INSIDE QB!\nFile: ${fileDesc}`
  )

  // Always use empty string for BeginSession — QB will connect to whatever company
  // file is currently active/focused in QB Accountant. Passing a specific file path
  // causes "already open / path mismatch" errors because QB's internal path format
  // rarely matches exactly what's on disk (case, length, UNC vs local, etc.).
  ticket = rp.BeginSession('', 0) as string

  log('session_ok', `Session open! Ticket: ${ticket?.substring(0, 8)}...`)

  log('query', 'Sending HostQueryRq to verify connection...')
  const hostXML = `<?xml version="1.0" encoding="utf-8"?><?qbxml version="16.0"?><QBXML><QBXMLMsgsRq onError="stopOnError"><HostQueryRq requestID="1" /></QBXMLMsgsRq></QBXML>`
  const response = rp.ProcessRequest(ticket, hostXML) as string

  const companyMatch = response.match(/<CompanyFileName>(.*?)<\/CompanyFileName>/)
  const versionMatch = response.match(/<QBFileVersion>(.*?)<\/QBFileVersion>/)
  const nameMatch = response.match(/<CompanyName>(.*?)<\/CompanyName>/)

  const resolvedFile = companyMatch?.[1] || cf || ''
  const companyName =
    nameMatch?.[1] ||
    resolvedFile.split('\\').pop()?.replace('.qbw', '') ||
    'QuickBooks Company'

  log('connected', `Connected! Company: ${companyName}, QB: ${versionMatch?.[1] || 'Unknown'}`)

  return {
    connected: true,
    mode: 'qbsdk',
    companyFile: resolvedFile,
    companyName,
    qbVersion: versionMatch?.[1] || 'Unknown'
  }
}

function doDisconnect(): void {
  try {
    if (rp && ticket) {
      rp.EndSession(ticket)
      rp.CloseConnection()
    }
  } catch {
    /* ignore */
  } finally {
    rp = null
    ticket = ''
    companyFile = ''
  }
}

function doSendRequest(xml: string): string {
  if (!rp || !ticket) throw new Error('Not connected to QuickBooks Desktop')
  log('xml_sent', `REQUEST XML:\n${xml}`)
  const response = rp.ProcessRequest(ticket, xml) as string
  log('xml_recv', `RESPONSE XML:\n${response}`)
  return response
}

interface ProcessMessage {
  id: string
  cmd: string
  args?: Record<string, string>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
process.parentPort!.on('message', (event: any) => {
  const msg: ProcessMessage = event.data

  // Ignore log-type messages (they flow the other direction)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((msg as any).type === 'log') return

  try {
    let result: unknown
    switch (msg.cmd) {
      case 'connect':
        result = doConnect(msg.args?.companyFile || '')
        break
      case 'disconnect':
        doDisconnect()
        result = null
        break
      case 'sendRequest':
        result = doSendRequest(msg.args?.xml || '')
        break
      case 'isConnected':
        result = !!(rp && ticket)
        break
      default:
        throw new Error(`Unknown QB process command: ${msg.cmd}`)
    }
    process.parentPort!.postMessage({ id: msg.id, success: true, result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    process.parentPort!.postMessage({ id: msg.id, success: false, error: message })
  }
})
