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
import { collectEntityHistory } from '../qb/entityHistory'
import type { EntityHistoryOptions } from '../qb/entityHistory'
import { REPORTS, findReport, runReport, reportToRows } from '../qb/reports'
import type { ReportOptions } from '../qb/reports'
import {
  scanTransactions,
  fetchList,
  find1099Issues,
  findDuplicates,
  findUncategorized,
  findDeadListItems,
  fetchDeleted,
  runCloseChecks,
  THRESHOLD_1099
} from '../qb/analysis'
import type { ScanOptions, ScannedTxn } from '../qb/analysis'
import {
  modifyTransaction,
  voidTransaction,
  stampCustomField,
  runBatch,
  canModify,
  modifiableTypes
} from '../qb/bulk'
import type { ModifyChange } from '../qb/bulk'
import { captureTemplate, replayTemplate } from '../qb/setup'
import type { CompanyTemplate, TemplateSection } from '../qb/setup'
import { BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'

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

  // Entity → account history for the Ledger pipeline.
  //
  // Unlike getVendorAccountMap (vendor → single best account), this returns the
  // full per-entity picture — per-transaction account counts, dollar weights,
  // and the coding signature of each transaction — so the renderer can tell a
  // stable recurring split (loan payment: principal + interest, every time)
  // apart from genuine ambiguity (Home Depot: business expense some months,
  // owner distribution others).  Only the second kind belongs in review.
  //
  // Sources: bills, checks, credit card charges and credits, vendor credits,
  // invoices, sales receipts, deposits, and journal entries — every type that
  // can carry a category.  See src/main/qb/entityHistory.ts for why each of
  // those matters and what the old four-query version was missing.
  ipcMain.handle('qb:getEntityAccountStats', async (_, options?: EntityHistoryOptions) => {
    try {
      if (!qbConnection.isConnected()) {
        return { success: false, error: 'Not connected to QuickBooks Desktop' }
      }

      const data = await collectEntityHistory((xml) => qbConnection.sendRequest(xml), options ?? {})
      return { success: true, data }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // The report catalogue.  Static, but served over IPC so the renderer has one
  // source of truth rather than a second copy that drifts.
  ipcMain.handle('qb:listReports', async () => {
    return { success: true, data: REPORTS }
  })

  // Run one report.  See src/main/qb/reports.ts for why QuickBooks computes the
  // figures rather than us.
  ipcMain.handle('qb:runReport', async (_, reportId: string, options?: ReportOptions) => {
    try {
      if (!qbConnection.isConnected()) {
        return { success: false, error: 'Not connected to QuickBooks Desktop' }
      }

      const spec = findReport(reportId)
      if (!spec) return { success: false, error: `Unknown report "${reportId}".` }

      // 5 minutes: a multi-year General Ledger is slow inside QuickBooks itself,
      // and timing out halfway wastes all of that work.
      const report = await runReport(
        (xml) => qbConnection.sendRequest(xml, 300_000),
        spec,
        options ?? {}
      )

      if (report.statusSeverity === 'Error') {
        return { success: false, error: report.statusMessage, data: report }
      }

      return { success: true, data: report, spec }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Flatten a report for the Excel exporter, preserving hierarchy as indentation.
  ipcMain.handle('qb:reportToRows', async (_, report: unknown) => {
    try {
      return { success: true, data: reportToRows(report as Parameters<typeof reportToRows>[0]) }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Analysis (read-only) ──────────────────────────────────────────────────

  /** Push progress to the renderer so a long scan does not look frozen. */
  const emit = (channel: string, payload: unknown): void => {
    BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)
  }

  const send = (xml: string): Promise<string> => qbConnection.sendRequest(xml, 300_000)

  /**
   * One pass over the company file, feeding every read-only analysis.
   *
   * Deliberately a single IPC call rather than one per feature: walking a large
   * file four times would take four times as long, and the analyses are pure
   * functions over the same scan.
   */
  ipcMain.handle('qb:analyze', async (_, options?: ScanOptions & { includeDeleted?: boolean }) => {
    try {
      if (!qbConnection.isConnected()) {
        return { success: false, error: 'Not connected to QuickBooks Desktop' }
      }

      emit('qb:analyzeProgress', { step: 'Reading transactions', detail: 'This can take a minute on a large file' })
      const scan = await scanTransactions(send, options ?? {})

      emit('qb:analyzeProgress', { step: 'Reading lists', detail: 'Accounts, vendors, customers' })
      const [accounts, vendors, customers, items, classes] = await Promise.all(
        ['Account', 'Vendor', 'Customer', 'Item', 'Class'].map((k) => fetchList(send, k))
      )

      emit('qb:analyzeProgress', { step: 'Analysing', detail: '' })

      const uncategorized = findUncategorized(scan.transactions, accounts.entries)
      const duplicates = findDuplicates(scan.transactions)
      const dead = findDeadListItems(
        [
          { kind: 'Account', entries: accounts.entries },
          { kind: 'Vendor', entries: vendors.entries },
          { kind: 'Customer', entries: customers.entries },
          { kind: 'Item', entries: items.entries },
          { kind: 'Class', entries: classes.entries }
        ],
        scan.transactions
      )

      let deleted: Awaited<ReturnType<typeof fetchDeleted>> = { rows: [], diagnostics: [] }
      if (options?.includeDeleted) {
        emit('qb:analyzeProgress', { step: 'Reading deletion log', detail: 'QuickBooks keeps ~90 days' })
        deleted = await fetchDeleted(send, { from: options.from, to: options.to })
      }

      return {
        success: true,
        data: {
          transactionCount: scan.transactions.length,
          vendors1099: find1099Issues(vendors.entries, scan.transactions),
          threshold1099: THRESHOLD_1099,
          duplicates,
          uncategorized,
          deadListItems: dead,
          deleted: deleted.rows,
          closeChecks: runCloseChecks(
            scan.transactions,
            accounts.entries,
            uncategorized,
            duplicates
          ),
          accounts: accounts.entries.map((a) => ({
            name: a.name,
            type: a.extra['AccountType'] ?? '',
            isActive: a.isActive
          })),
          diagnostics: [
            ...scan.diagnostics,
            accounts.diagnostic,
            vendors.diagnostic,
            customers.diagnostic,
            ...deleted.diagnostics
          ]
        }
      }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** Transactions matching a filter, for the Bulk Edit picker. */
  ipcMain.handle('qb:findTransactions', async (_, options?: ScanOptions) => {
    try {
      if (!qbConnection.isConnected()) {
        return { success: false, error: 'Not connected to QuickBooks Desktop' }
      }
      const scan = await scanTransactions(send, options ?? {})
      return {
        success: true,
        data: scan.transactions,
        diagnostics: scan.diagnostics,
        modifiableTypes: modifiableTypes()
      }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Bulk writes ───────────────────────────────────────────────────────────

  const asItems = (txns: ScannedTxn[]): { type: string; txnId: string; label: string }[] =>
    txns.map((t) => ({
      type: t.type,
      txnId: t.txnId,
      label: `${t.type} ${t.refNumber || t.date} · ${t.entity || 'no payee'}`
    }))

  const progress = (channel: string) => (p: { done: number; total: number; current: string }) =>
    emit(channel, p)

  /**
   * Reclassify, or stamp a memo, across many transactions.
   *
   * See src/main/qb/bulk.ts: each transaction is re-read and rebuilt in full
   * before writing, because a partial line rebuild deletes the omitted lines.
   */
  ipcMain.handle('qb:bulkModify', async (_, txns: ScannedTxn[], change: ModifyChange) => {
    try {
      if (!qbConnection.isConnected()) {
        return { success: false, error: 'Not connected to QuickBooks Desktop' }
      }
      const summary = await runBatch(
        asItems(txns.filter((t) => canModify(t.type))),
        (item) => modifyTransaction(send, item.type, item.txnId, item.label, change),
        progress('qb:bulkProgress')
      )
      return { success: true, data: summary }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('qb:bulkVoid', async (_, txns: ScannedTxn[]) => {
    try {
      if (!qbConnection.isConnected()) {
        return { success: false, error: 'Not connected to QuickBooks Desktop' }
      }
      const summary = await runBatch(
        asItems(txns),
        (item) => voidTransaction(send, item.type, item.txnId, item.label),
        progress('qb:bulkProgress')
      )
      return { success: true, data: summary }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'qb:bulkStamp',
    async (_, txns: ScannedTxn[], fieldName: string, value: string) => {
      try {
        if (!qbConnection.isConnected()) {
          return { success: false, error: 'Not connected to QuickBooks Desktop' }
        }
        const summary = await runBatch(
          asItems(txns),
          (item) =>
            stampCustomField(send, {
              txnType: item.type,
              txnId: item.txnId,
              label: item.label,
              fieldName,
              value
            }),
          progress('qb:bulkProgress')
        )
        return { success: true, data: summary }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ── New-client template ───────────────────────────────────────────────────

  ipcMain.handle('qb:captureTemplate', async (_, sections?: TemplateSection[], filePath?: string) => {
    try {
      if (!qbConnection.isConnected()) {
        return { success: false, error: 'Not connected to QuickBooks Desktop' }
      }
      const template = await captureTemplate(
        send,
        qbConnection.getStatus().companyName ?? 'Unknown company',
        sections
      )
      if (filePath) writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf8')
      return { success: true, data: template }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('qb:readTemplate', async (_, filePath: string) => {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as CompanyTemplate
      if (parsed.format !== 'phantom-pulse-template@1') {
        return { success: false, error: 'That file is not a Phantom Pulse template.' }
      }
      return { success: true, data: parsed }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'qb:replayTemplate',
    async (_, template: CompanyTemplate, sections: TemplateSection[]) => {
      try {
        if (!qbConnection.isConnected()) {
          return { success: false, error: 'Not connected to QuickBooks Desktop' }
        }
        const summary = await replayTemplate(
          send,
          template,
          sections,
          progress('qb:templateProgress')
        )
        return { success: true, data: summary }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

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
