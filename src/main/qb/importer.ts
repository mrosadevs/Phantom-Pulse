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
  buildCreditCardCreditAddXML,
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

/** Names QuickBooks refused to create — their rows are booked without a payee. */
const unusableNames = new Set<string>()

/** Fields a payee name can arrive in. */
const NAME_FIELDS = ['Payee', 'Customer', 'Vendor', 'Entity']

/**
 * QuickBooks list names cap at 41 characters and cannot contain a colon —
 * ':' is reserved for the parent:child separator.  A bank line like
 * "Online Domestic Wire Transfer A/c: Laminate Flooring Inc. Medley Fl-2435
 * Us Ref: Pago Tile Building Trn:es" breaks both rules, so the auto-create
 * silently failed and the transaction was then rejected with error 3140 for
 * referencing a payee that does not exist.  Trim to something QuickBooks will
 * accept before we try.
 */
const QB_NAME_MAX = 41

export function sanitizeEntityName(name: string): string {
  const flat = name.replace(/:/g, ' ').replace(/\s+/g, ' ').trim()
  if (flat.length <= QB_NAME_MAX) return flat
  const cut = flat.slice(0, QB_NAME_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()
}

/**
 * Auto-create a Customer in QB if it doesn't already exist.
 * Returns false when QuickBooks will not accept the name at all.
 */
async function ensureCustomer(conn: QBConnection, name: string): Promise<boolean> {
  if (!name) return false
  if (createdCustomers.has(name)) return !unusableNames.has(name)
  createdCustomers.add(name)
  try {
    const xml = buildCustomerAddXML(name, `cust_${Date.now()}`)
    const response = await conn.sendRequest(xml)
    const parsed = parseQBXMLResponse(response)
    // 3100 = "already in use" — that's fine, entity already exists
    if (parsed.statusCode !== '0' && parsed.statusCode !== '3100') {
      console.log(`[Auto-create customer] "${name}": ${parsed.statusMessage}`)
      unusableNames.add(name)
      return false
    }
    return true
  } catch {
    unusableNames.add(name)
    return false
  }
}

/**
 * Auto-create a Vendor in QB if it doesn't already exist.
 * Returns false when QuickBooks will not accept the name at all.
 */
async function ensureVendor(conn: QBConnection, name: string): Promise<boolean> {
  if (!name) return false
  if (createdVendors.has(name)) return !unusableNames.has(name)
  createdVendors.add(name)
  try {
    const xml = buildVendorAddXML(name, `vend_${Date.now()}`)
    const response = await conn.sendRequest(xml)
    const parsed = parseQBXMLResponse(response)
    if (parsed.statusCode !== '0' && parsed.statusCode !== '3100') {
      console.log(`[Auto-create vendor] "${name}": ${parsed.statusMessage}`)
      unusableNames.add(name)
      return false
    }
    return true
  } catch {
    unusableNames.add(name)
    return false
  }
}

/** Get the payee/entity name from a transaction row */
function getPayeeName(row: Record<string, string>): string {
  return (row['Payee'] || row['Customer'] || row['Vendor'] || row['Entity'] || '').trim()
}

/**
 * Rewrite a row's payee to the name QuickBooks was actually given, or drop it
 * when QuickBooks refused the name.  A transaction with no payee still books;
 * one pointing at a payee that does not exist fails the whole row.
 */
function applyPayee(row: Record<string, string>, name: string, usable: boolean): Record<string, string> {
  const out = { ...row }
  for (const field of NAME_FIELDS) {
    if (!out[field]) continue
    if (usable) out[field] = name
    else delete out[field]
  }
  return out
}

export async function importTransactions(
  conn: QBConnection,
  transactions: Record<string, string>[],
  type: string
): Promise<ImportResult[]> {
  const results: ImportResult[] = []

  // Determine which entity type to auto-create based on transaction type
  const customerTypes = ['Deposit', 'Invoice', 'Sales Receipt', 'Receive Payment', 'Credit Memo', 'Estimate']
  const vendorTypes = ['Check', 'Bill', 'Bill Payment', 'Purchase Order', 'Credit Card Charge', 'Credit Card Credit']

  // Collect unique payee names and auto-create them BEFORE importing.
  // Names are trimmed to what QuickBooks accepts first, and any it still
  // refuses is remembered so those rows book without a payee rather than
  // failing outright.
  const usableByRaw = new Map<string, { name: string; usable: boolean }>()
  for (const row of transactions) {
    const raw = getPayeeName(row)
    if (!raw || usableByRaw.has(raw)) continue
    usableByRaw.set(raw, { name: sanitizeEntityName(raw), usable: false })
  }

  for (const [raw, entry] of usableByRaw) {
    if (!entry.name) continue
    if (customerTypes.includes(type)) {
      entry.usable = await ensureCustomer(conn, entry.name)
    } else if (vendorTypes.includes(type)) {
      entry.usable = await ensureVendor(conn, entry.name)
    } else {
      entry.usable = true
    }
    usableByRaw.set(raw, entry)
  }

  for (let i = 0; i < transactions.length; i++) {
    const raw = getPayeeName(transactions[i])
    const resolved = raw ? usableByRaw.get(raw) : undefined
    const row = resolved
      ? applyPayee(transactions[i], resolved.name, resolved.usable)
      : transactions[i]
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
    case 'Credit Card Credit':
      return buildCreditCardCreditAddXML(row, requestId)

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
