import { QBConnection } from './connection'
import {
  buildInvoiceAddXML,
  buildSalesReceiptAddXML,
  buildReceivePaymentAddXML,
  buildCreditMemoAddXML,
  buildEstimateAddXML,
  buildBillAddXML,
  buildBillPaymentCheckAddXML,
  buildPurchaseOrderAddXML,
  buildCreditCardChargeAddXML,
  buildCheckAddXML,
  buildDepositAddXML,
  buildTransferAddXML,
  buildJournalEntryAddXML,
  buildCustomerAddXML,
  buildVendorAddXML,
  parseQBXMLResponse
} from './qbxml'

export interface ImportResult {
  rowIndex: number
  success: boolean
  txnId?: string
  error?: string
  row: Record<string, string>
}

// Track which names we've already tried to create this session
// so we don't spam QB with duplicate add requests
const createdCustomers = new Set<string>()
const createdVendors = new Set<string>()

/**
 * Auto-create a Customer in QB if it doesn't already exist.
 * Silently ignores "already exists" errors (status 3100).
 */
async function ensureCustomer(conn: QBConnection, name: string): Promise<void> {
  if (!name || createdCustomers.has(name)) return
  createdCustomers.add(name)
  try {
    const xml = buildCustomerAddXML(name, `cust_${Date.now()}`)
    const response = await conn.sendRequest(xml)
    const parsed = parseQBXMLResponse(response)
    // 3100 = "already in use" — that's fine, entity already exists
    if (parsed.statusCode !== '0' && parsed.statusCode !== '3100') {
      console.log(`[Auto-create customer] "${name}": ${parsed.statusMessage}`)
    }
  } catch {
    // Ignore — entity might already exist
  }
}

/**
 * Auto-create a Vendor in QB if it doesn't already exist.
 * Silently ignores "already exists" errors (status 3100).
 */
async function ensureVendor(conn: QBConnection, name: string): Promise<void> {
  if (!name || createdVendors.has(name)) return
  createdVendors.add(name)
  try {
    const xml = buildVendorAddXML(name, `vend_${Date.now()}`)
    const response = await conn.sendRequest(xml)
    const parsed = parseQBXMLResponse(response)
    if (parsed.statusCode !== '0' && parsed.statusCode !== '3100') {
      console.log(`[Auto-create vendor] "${name}": ${parsed.statusMessage}`)
    }
  } catch {
    // Ignore
  }
}

/** Get the payee/entity name from a transaction row */
function getPayeeName(row: Record<string, string>): string {
  return (row['Payee'] || row['Customer'] || row['Vendor'] || row['Entity'] || '').trim()
}

export async function importTransactions(
  conn: QBConnection,
  transactions: Record<string, string>[],
  type: string
): Promise<ImportResult[]> {
  const results: ImportResult[] = []

  // Determine which entity type to auto-create based on transaction type
  const customerTypes = ['Deposit', 'Invoice', 'Sales Receipt', 'Receive Payment', 'Credit Memo', 'Estimate']
  const vendorTypes = ['Check', 'Bill', 'Bill Payment', 'Purchase Order', 'Credit Card Charge']

  // Collect unique payee names and auto-create them BEFORE importing
  const uniquePayees = new Set<string>()
  for (const row of transactions) {
    const name = getPayeeName(row)
    if (name) uniquePayees.add(name)
  }

  if (uniquePayees.size > 0) {
    for (const name of uniquePayees) {
      if (customerTypes.includes(type)) {
        await ensureCustomer(conn, name)
      } else if (vendorTypes.includes(type)) {
        await ensureVendor(conn, name)
      }
    }
  }

  for (let i = 0; i < transactions.length; i++) {
    const row = transactions[i]
    const requestId = `${Date.now()}_${i}`

    try {
      const xml = buildTransactionXML(row, type, requestId)
      if (!xml) {
        results.push({
          rowIndex: i,
          success: false,
          error: `Unsupported transaction type: ${type}`,
          row
        })
        continue
      }

      const response = await conn.sendRequest(xml)
      const parsed = parseQBXMLResponse(response)

      if (parsed.statusCode === '0') {
        results.push({ rowIndex: i, success: true, txnId: parsed.txnId, row })
      } else {
        results.push({
          rowIndex: i,
          success: false,
          error: `QB Error ${parsed.statusCode}: ${parsed.statusMessage}`,
          row
        })
      }
    } catch (err: unknown) {
      results.push({
        rowIndex: i,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        row
      })
    }
  }

  return results
}

function buildTransactionXML(
  row: Record<string, string>,
  type: string,
  requestId: string
): string | null {
  switch (type) {
    // Customer
    case 'Invoice':
      return buildInvoiceAddXML(row, requestId)
    case 'Sales Receipt':
      return buildSalesReceiptAddXML(row, requestId)
    case 'Receive Payment':
      return buildReceivePaymentAddXML(row, requestId)
    case 'Credit Memo':
      return buildCreditMemoAddXML(row, requestId)
    case 'Estimate':
      return buildEstimateAddXML(row, requestId)

    // Vendor
    case 'Bill':
      return buildBillAddXML(row, requestId)
    case 'Bill Payment':
      return buildBillPaymentCheckAddXML(row, requestId)
    case 'Purchase Order':
      return buildPurchaseOrderAddXML(row, requestId)
    case 'Credit Card Charge':
      return buildCreditCardChargeAddXML(row, requestId)

    // Banking
    case 'Check':
      return buildCheckAddXML(row, requestId)
    case 'Deposit':
      return buildDepositAddXML(row, requestId)
    case 'Transfer':
      return buildTransferAddXML(row, requestId)

    // Other
    case 'Journal Entry':
      return buildJournalEntryAddXML(row, requestId)

    default:
      return null
  }
}
