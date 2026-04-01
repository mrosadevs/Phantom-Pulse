import { IpcMain } from 'electron'
import { execSync } from 'child_process'
import { QBConnection } from '../qb/connection'
import {
  buildQBXMLRequest,
  parseQBXMLResponse,
  buildAccountAddXML,
  buildCustomerAddXML,
  buildVendorAddXML
} from '../qb/qbxml'
import { importTransactions } from '../qb/importer'
import { exportTransactions } from '../qb/exporter'

const qbConnection = new QBConnection()

export function registerQBHandlers(ipcMain: IpcMain): void {
  // Connect to QuickBooks Desktop
  ipcMain.handle('qb:connect', async (_, companyFile?: string) => {
    try {
      const result = await qbConnection.connect(companyFile)
      return result
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Disconnect
  ipcMain.handle('qb:disconnect', async () => {
    try {
      qbConnection.disconnect()
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Get connection status
  ipcMain.handle('qb:status', async () => {
    return qbConnection.getStatus()
  })

  // Raw QBXML query
  ipcMain.handle('qb:query', async (_, request: string) => {
    try {
      const response = await qbConnection.sendRequest(request)
      return { success: true, data: response }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Import transactions into QuickBooks Desktop
  ipcMain.handle(
    'qb:importTransactions',
    async (_, transactions: Record<string, string>[], type: string) => {
      try {
        if (!qbConnection.isConnected()) {
          return { success: false, error: 'Not connected to QuickBooks Desktop' }
        }
        const results = await importTransactions(qbConnection, transactions, type)
        return { success: true, results }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Export transactions from QuickBooks Desktop
  ipcMain.handle('qb:exportTransactions', async (_, type: string, filters: unknown) => {
    try {
      if (!qbConnection.isConnected()) {
        return { success: false, error: 'Not connected to QuickBooks Desktop' }
      }
      const data = await exportTransactions(qbConnection, type, filters as Record<string, string>)
      return { success: true, data }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Delete transactions
  ipcMain.handle('qb:deleteTransactions', async (_, txnIds: string[], txnType: string) => {
    try {
      if (!qbConnection.isConnected()) {
        return { success: false, error: 'Not connected to QuickBooks Desktop' }
      }

      const results: { txnId: string; success: boolean; error?: string }[] = []
      for (const txnId of txnIds) {
        try {
          const xml = buildQBXMLRequest('TxnDelRq', { TxnDelType: txnType, TxnID: txnId })
          const response = await qbConnection.sendRequest(xml)
          const parsed = parseQBXMLResponse(response)
          results.push({
            txnId,
            success: parsed.statusCode === '0',
            error: parsed.statusCode !== '0' ? parsed.statusMessage : undefined
          })
        } catch (e: unknown) {
          results.push({ txnId, success: false, error: e instanceof Error ? e.message : String(e) })
        }
      }
      return { success: true, results }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Get company info
  ipcMain.handle('qb:getCompanyInfo', async () => {
    try {
      if (!qbConnection.isConnected()) return { success: false, error: 'Not connected' }
      const xml = buildQBXMLRequest('CompanyQueryRq', {})
      const response = await qbConnection.sendRequest(xml)
      return { success: true, data: parseQBXMLResponse(response) }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Get chart of accounts
  ipcMain.handle('qb:getAccounts', async () => {
    try {
      if (!qbConnection.isConnected()) return { success: false, data: [] }
      const xml = buildQBXMLRequest('AccountQueryRq', {})
      const response = await qbConnection.sendRequest(xml)
      const parsed = parseQBXMLResponse(response)
      return { success: true, data: parsed.list || [] }
    } catch (err: unknown) {
      return { success: false, data: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Get customers
  ipcMain.handle('qb:getCustomers', async () => {
    try {
      if (!qbConnection.isConnected()) return { success: false, data: [] }
      const xml = buildQBXMLRequest('CustomerQueryRq', {})
      const response = await qbConnection.sendRequest(xml)
      const parsed = parseQBXMLResponse(response)
      return { success: true, data: parsed.list || [] }
    } catch (err: unknown) {
      return { success: false, data: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Get vendors
  ipcMain.handle('qb:getVendors', async () => {
    try {
      if (!qbConnection.isConnected()) return { success: false, data: [] }
      const xml = buildQBXMLRequest('VendorQueryRq', {})
      const response = await qbConnection.sendRequest(xml)
      const parsed = parseQBXMLResponse(response)
      return { success: true, data: parsed.list || [] }
    } catch (err: unknown) {
      return { success: false, data: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Get items
  ipcMain.handle('qb:getItems', async () => {
    try {
      if (!qbConnection.isConnected()) return { success: false, data: [] }
      const xml = buildQBXMLRequest('ItemQueryRq', {})
      const response = await qbConnection.sendRequest(xml)
      const parsed = parseQBXMLResponse(response)
      return { success: true, data: parsed.list || [] }
    } catch (err: unknown) {
      return { success: false, data: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Import GL entities (accounts, customers, vendors) extracted from a GL PDF
  ipcMain.handle(
    'qb:importGLEntities',
    async (
      _,
      entities: { category: 'account' | 'customer' | 'vendor'; name: string; accountType?: string }[]
    ) => {
      try {
        if (!qbConnection.isConnected()) {
          return { success: false, error: 'Not connected to QuickBooks Desktop' }
        }

        const results: { name: string; category: string; success: boolean; error?: string }[] = []

        for (const entity of entities) {
          const requestId = `gl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
          let xml: string

          if (entity.category === 'account') {
            xml = buildAccountAddXML(entity.name, entity.accountType || 'Expense', requestId)
          } else if (entity.category === 'customer') {
            xml = buildCustomerAddXML(entity.name, requestId)
          } else {
            xml = buildVendorAddXML(entity.name, requestId)
          }

          try {
            const response = await qbConnection.sendRequest(xml)
            const parsed = parseQBXMLResponse(response)
            const ok = parsed.statusCode === '0' || parsed.statusCode === '3100' // 3100 = already exists
            results.push({
              name: entity.name,
              category: entity.category,
              success: ok,
              error: ok ? undefined : `QB error ${parsed.statusCode}: ${parsed.statusMessage}`
            })
          } catch (e: unknown) {
            results.push({
              name: entity.name,
              category: entity.category,
              success: false,
              error: e instanceof Error ? e.message : String(e)
            })
          }

          // Small delay between requests to avoid overwhelming QB
          await new Promise((r) => setTimeout(r, 50))
        }

        return { success: true, results }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Build vendor→account map by scanning last 500 Bills + Checks
  // Returns Record<vendorName, mostUsedAccountName>
  ipcMain.handle('qb:getVendorAccountMap', async () => {
    try {
      if (!qbConnection.isConnected()) {
        return { success: false, error: 'Not connected to QuickBooks Desktop' }
      }

      // Tally: vendorName → { accountName → count }
      const tally: Record<string, Record<string, number>> = {}

      const addEntry = (vendor: string, account: string) => {
        if (!vendor || !account) return
        if (!tally[vendor]) tally[vendor] = {}
        tally[vendor][account] = (tally[vendor][account] || 0) + 1
      }

      // Helper: extract all occurrences of a tag value from XML
      const extractAll = (xml: string, tag: string): string[] => {
        const re = new RegExp(`<${tag}>([^<]+)<\\/${tag}>`, 'g')
        const results: string[] = []
        let m: RegExpExecArray | null
        while ((m = re.exec(xml)) !== null) results.push(m[1].trim())
        return results
      }

      // Helper: parse vendor→account pairs from a transaction list XML response
      // Each <BillRet> or <CheckRet> block contains <VendorRef><FullName> and
      // one or more <ExpenseLineRet><AccountRef><FullName>
      const parseTransactionXML = (xml: string, vendorTag: string, lineTag: string) => {
        // Split into individual transaction blocks
        const blockRe = new RegExp(`<${vendorTag}Ret>[\\s\\S]*?<\\/${vendorTag}Ret>`, 'g')
        let block: RegExpExecArray | null
        while ((block = blockRe.exec(xml)) !== null) {
          const blockXml = block[0]
          // Get vendor name
          const vendorMatch = blockXml.match(/<VendorRef>\s*<FullName>([^<]+)<\/FullName>/)
          const vendor = vendorMatch?.[1]?.trim()
          if (!vendor) continue
          // Get all expense line accounts
          const lineRe = new RegExp(`<${lineTag}>[\\s\\S]*?<\\/${lineTag}>`, 'g')
          let line: RegExpExecArray | null
          while ((line = lineRe.exec(blockXml)) !== null) {
            const acctMatch = line[0].match(/<AccountRef>\s*<FullName>([^<]+)<\/FullName>/)
            if (acctMatch?.[1]) addEntry(vendor, acctMatch[1].trim())
          }
        }
      }

      // Query Bills
      try {
        const billXml = `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML><QBXMLMsgsRq onError="stopOnError">
  <BillQueryRq requestID="bill_acct_map">
    <MaxReturned>500</MaxReturned>
    <IncludeLineItems>true</IncludeLineItems>
  </BillQueryRq>
</QBXMLMsgsRq></QBXML>`
        const billResponse = await qbConnection.sendRequest(billXml)
        parseTransactionXML(billResponse, 'Bill', 'ExpenseLineRet')
        // Also handle item lines
        const itemLineRe = /<ItemLineRet>[\s\S]*?<\/ItemLineRet>/g
        const vendorBlocks = billResponse.match(/<BillRet>[\s\S]*?<\/BillRet>/g) || []
        for (const blk of vendorBlocks) {
          const vm = blk.match(/<VendorRef>\s*<FullName>([^<]+)<\/FullName>/)
          const vendor = vm?.[1]?.trim()
          if (!vendor) continue
          let il: RegExpExecArray | null
          while ((il = itemLineRe.exec(blk)) !== null) {
            const am = il[0].match(/<AccountRef>\s*<FullName>([^<]+)<\/FullName>/)
            if (am?.[1]) addEntry(vendor, am[1].trim())
          }
        }
      } catch { /* QB might not have any bills — non-fatal */ }

      // Query Checks
      try {
        const checkXml = `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML><QBXMLMsgsRq onError="stopOnError">
  <CheckQueryRq requestID="check_acct_map">
    <MaxReturned>500</MaxReturned>
    <IncludeLineItems>true</IncludeLineItems>
  </CheckQueryRq>
</QBXMLMsgsRq></QBXML>`
        const checkResponse = await qbConnection.sendRequest(checkXml)
        // Checks use PayeeEntityRef instead of VendorRef
        const checkBlockRe = /<CheckRet>[\s\S]*?<\/CheckRet>/g
        let cb: RegExpExecArray | null
        while ((cb = checkBlockRe.exec(checkResponse)) !== null) {
          const blk = cb[0]
          const payeeMatch = blk.match(/<PayeeEntityRef>\s*<FullName>([^<]+)<\/FullName>/)
          const vendor = payeeMatch?.[1]?.trim()
          if (!vendor) continue
          const expRe = /<ExpenseLineRet>[\s\S]*?<\/ExpenseLineRet>/g
          let el: RegExpExecArray | null
          while ((el = expRe.exec(blk)) !== null) {
            const am = el[0].match(/<AccountRef>\s*<FullName>([^<]+)<\/FullName>/)
            if (am?.[1]) addEntry(vendor, am[1].trim())
          }
        }
      } catch { /* non-fatal */ }

      // Build final map: vendor → most-used account
      const result: Record<string, string> = {}
      for (const [vendor, accounts] of Object.entries(tally)) {
        const best = Object.entries(accounts).sort((a, b) => b[1] - a[1])[0]
        if (best) result[vendor] = best[0]
      }

      // Also include vendors with no transaction history (name only, empty account)
      try {
        const vendorXml = buildQBXMLRequest('VendorQueryRq', {})
        const vendorResp = await qbConnection.sendRequest(vendorXml)
        const vendorParsed = parseQBXMLResponse(vendorResp)
        const vendors: Record<string, string>[] = vendorParsed.list || []
        for (const v of vendors) {
          const name = v['FullName'] || v['Name']
          if (name && !result[name]) result[name] = ''
        }
      } catch { /* non-fatal */ }

      // Same for customers
      try {
        const custXml = buildQBXMLRequest('CustomerQueryRq', {})
        const custResp = await qbConnection.sendRequest(custXml)
        const custParsed = parseQBXMLResponse(custResp)
        const customers: Record<string, string>[] = custParsed.list || []
        for (const c of customers) {
          const name = c['FullName'] || c['Name']
          if (name && !result[name]) result[name] = ''
        }
      } catch { /* non-fatal */ }

      void extractAll // suppress unused warning

      return { success: true, data: result }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Auto-detect QB company file path from the running QB process
  ipcMain.handle('qb:detectCompanyFile', async () => {
    try {
      // Query WMI for QB process command line — it contains the .qbw path
      const ps = `powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -like 'qbw*' -or $_.Name -like 'QBW*' } | Select-Object -ExpandProperty CommandLine"`
      const output = execSync(ps, { timeout: 8000 }).toString().trim()

      // Extract .qbw path from the command line string
      const match = output.match(/"?([^"]+\.qbw)"?/i)
      if (match?.[1]) {
        return { success: true, path: match[1] }
      }

      // Fallback: check QB recent files in registry
      const reg = `powershell -NoProfile -Command "Get-ItemProperty 'HKCU:\\Software\\Intuit\\QuickBooks' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LastOpenFile 2>$null"`
      const regOut = execSync(reg, { timeout: 5000 }).toString().trim()
      if (regOut && regOut.toLowerCase().endsWith('.qbw')) {
        return { success: true, path: regOut }
      }

      return { success: false, error: 'QuickBooks is not running or no company file is open.' }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
