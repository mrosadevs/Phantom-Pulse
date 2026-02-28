/**
 * QB Worker Thread
 *
 * All synchronous winax COM calls run here so they never block
 * the Electron main process event loop. The main process communicates
 * via worker_threads postMessage / on('message').
 */
import { parentPort } from 'worker_threads'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WinaxObject = any

let rp: WinaxObject = null
let ticket = ''
let companyFile = ''

/** Send a progress/log message back to the main process */
function log(step: string, detail?: string) {
  parentPort?.postMessage({ type: 'log', step, detail })
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

  log('session', `Calling BeginSession with file: "${companyFile || '(empty — use open file)'}"` +
    '\n⚠️  QB may now show an authorization dialog — switch to QuickBooks!')
  ticket = rp.BeginSession(companyFile, 0) as string
  log('session_ok', `BeginSession returned ticket: ${ticket?.substring(0, 8)}...`)

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
  return rp.ProcessRequest(ticket, xml) as string
}

interface WorkerMessage {
  id: string
  cmd: string
  args?: Record<string, string>
}

if (parentPort) {
  parentPort.on('message', (msg: WorkerMessage) => {
    // Ignore log-type messages (they flow the other way)
    if ((msg as unknown as { type: string }).type === 'log') return

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
          throw new Error(`Unknown QB worker command: ${msg.cmd}`)
      }
      parentPort!.postMessage({ id: msg.id, success: true, result })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      parentPort!.postMessage({ id: msg.id, success: false, error: message })
    }
  })
}
