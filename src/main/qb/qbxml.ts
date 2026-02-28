/**
 * QBXML Request Builder and Response Parser
 * Builds QBXML 16.0 formatted requests for QuickBooks Desktop
 *
 * CRITICAL: QBXML is ORDER-SENSITIVE.  Elements must appear in the exact
 * sequence defined by the QB SDK schema.  Out-of-order elements cause:
 *   "QuickBooks found an error when parsing the provided XML text stream."
 */

export const QBXML_HEADER = `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="16.0"?>
<QBXML>
  <QBXMLMsgsRq onError="continueOnError">`

export const QBXML_FOOTER = `  </QBXMLMsgsRq>
</QBXML>`

// Transaction type → QBXML request-type mapping
export const TX_TYPE_MAP: Record<string, { add: string; query: string; del: string; type: string }> = {
  Invoice: { add: 'InvoiceAdd', query: 'InvoiceQuery', del: 'Invoice', type: 'Invoice' },
  Bill: { add: 'BillAdd', query: 'BillQuery', del: 'Bill', type: 'Bill' },
  'Bill Payment': {
    add: 'BillPaymentCheckAdd',
    query: 'BillPaymentCheckQuery',
    del: 'BillPaymentCheck',
    type: 'BillPaymentCheck'
  },
  'Bill Payment Credit Card': {
    add: 'BillPaymentCreditCardAdd',
    query: 'BillPaymentCreditCardQuery',
    del: 'BillPaymentCreditCard',
    type: 'BillPaymentCreditCard'
  },
  'Journal Entry': {
    add: 'JournalEntryAdd',
    query: 'JournalEntryQuery',
    del: 'JournalEntry',
    type: 'JournalEntry'
  },
  Check: { add: 'CheckAdd', query: 'CheckQuery', del: 'Check', type: 'Check' },
  Deposit: { add: 'DepositAdd', query: 'DepositQuery', del: 'Deposit', type: 'Deposit' },
  'Sales Receipt': {
    add: 'SalesReceiptAdd',
    query: 'SalesReceiptQuery',
    del: 'SalesReceipt',
    type: 'SalesReceipt'
  },
  'Credit Memo': {
    add: 'CreditMemoAdd',
    query: 'CreditMemoQuery',
    del: 'CreditMemo',
    type: 'CreditMemo'
  },
  'Receive Payment': {
    add: 'ReceivePaymentAdd',
    query: 'ReceivePaymentQuery',
    del: 'ReceivePayment',
    type: 'ReceivePayment'
  },
  'Purchase Order': {
    add: 'PurchaseOrderAdd',
    query: 'PurchaseOrderQuery',
    del: 'PurchaseOrder',
    type: 'PurchaseOrder'
  },
  Estimate: { add: 'EstimateAdd', query: 'EstimateQuery', del: 'Estimate', type: 'Estimate' },
  'Credit Card Charge': {
    add: 'CreditCardChargeAdd',
    query: 'CreditCardChargeQuery',
    del: 'CreditCardCharge',
    type: 'CreditCardCharge'
  },
  'Credit Card Credit': {
    add: 'CreditCardCreditAdd',
    query: 'CreditCardCreditQuery',
    del: 'CreditCardCredit',
    type: 'CreditCardCredit'
  },
  Transfer: { add: 'TransferAdd', query: 'TransferQuery', del: 'Transfer', type: 'Transfer' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic request builder  (AccountQueryRq, CompanyQueryRq, TxnDelRq, etc.)
// Keys MUST be PascalCase already  (e.g. TxnDelType, TxnID — not txnDelType)
// ─────────────────────────────────────────────────────────────────────────────
export function buildQBXMLRequest(requestType: string, fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([key, value]) => `    <${key}>${escapeXML(value)}</${key}>`)
    .join('\n')

  return `${QBXML_HEADER}
    <${requestType} requestID="${Date.now()}">
${body}
    </${requestType}>
${QBXML_FOOTER}`
}

// ─────────────────────────────────────────────────────────────────────────────
// XML element helpers
// "opt*" variants only emit when value is non-empty so we never send
// <RefNumber></RefNumber> which QB rejects as an invalid STRTYPE value.
// ─────────────────────────────────────────────────────────────────────────────

/** Always-emit text element */
function el(tag: string, value: string): string {
  return `<${tag}>${escapeXML(value)}</${tag}>`
}

/** Always-emit FullName ref */
function elRef(tag: string, fullName: string): string {
  return `<${tag}><FullName>${escapeXML(fullName)}</FullName></${tag}>`
}

/** Optional text element — omitted when blank */
function opt(tag: string, value: string | undefined | null): string {
  const v = (value ?? '').trim()
  return v ? `<${tag}>${escapeXML(v)}</${tag}>` : ''
}

/** Optional FullName ref — omitted when blank */
function optRef(tag: string, fullName: string | undefined | null): string {
  const v = (fullName ?? '').trim()
  return v ? `<${tag}><FullName>${escapeXML(v)}</FullName></${tag}>` : ''
}

/** Optional date element — omitted when blank */
function optDate(tag: string, value: string | undefined | null): string {
  const v = (value ?? '').trim()
  return v ? `<${tag}>${escapeXML(formatDate(v))}</${tag}>` : ''
}

/** Always-emit TxnDate (uses today when value is blank) */
function txnDateEl(value: string | undefined | null): string {
  return `<TxnDate>${escapeXML(formatDate((value ?? '').trim()))}</TxnDate>`
}

/** Concatenate non-empty strings (XML needs no whitespace between elements) */
function x(...parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join('')
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer Transactions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * InvoiceAdd  — QB schema order:
 * CustomerRef, ARAccountRef, TxnDate, RefNumber, PONumber,
 * TermsRef, DueDate, Memo, InvoiceLineAdd+
 */
export function buildInvoiceAddXML(invoice: Record<string, string>, requestId: string): string {
  const lines = parseLineItems(invoice)
  const lineXML = lines
    .map((line) =>
      x(
        '<InvoiceLineAdd>',
        optRef('ItemRef', line.item),
        opt('Desc', line.description),
        opt('Quantity', line.quantity !== '1' ? line.quantity : ''),
        opt('Rate', line.rate !== '0' ? line.rate : ''),
        '</InvoiceLineAdd>'
      )
    )
    .filter(Boolean)
    .join('')

  return `${QBXML_HEADER}
    <InvoiceAddRq requestID="${requestId}">
      <InvoiceAdd>${x(
        elRef('CustomerRef', invoice['Customer'] || invoice['CustomerRef'] || ''),
        optRef('ARAccountRef', invoice['Account']),
        txnDateEl(invoice['Date'] || invoice['TxnDate']),
        opt('RefNumber', invoice['Invoice Number'] || invoice['RefNumber']),
        opt('PONumber', invoice['PONumber']),
        optRef('TermsRef', invoice['Terms']),
        optDate('DueDate', invoice['Due Date']),
        opt('Memo', invoice['Memo']),
        lineXML
      )}</InvoiceAdd>
    </InvoiceAddRq>
${QBXML_FOOTER}`
}

/**
 * SalesReceiptAdd  — QB schema order:
 * CustomerRef, TxnDate, RefNumber, PaymentMethodRef,
 * DepositToAccountRef, Memo, SalesReceiptLineAdd+
 */
export function buildSalesReceiptAddXML(
  sr: Record<string, string>,
  requestId: string
): string {
  const lines = parseLineItems(sr)
  const lineXML = lines
    .map((line) =>
      x(
        '<SalesReceiptLineAdd>',
        optRef('ItemRef', line.item),
        opt('Desc', line.description),
        opt('Quantity', line.quantity !== '1' ? line.quantity : ''),
        opt('Rate', line.rate !== '0' ? line.rate : ''),
        opt('Amount', line.amount && line.amount !== '0' ? amt(line.amount) : ''),
        '</SalesReceiptLineAdd>'
      )
    )
    .filter(Boolean)
    .join('')

  return `${QBXML_HEADER}
    <SalesReceiptAddRq requestID="${requestId}">
      <SalesReceiptAdd>${x(
        elRef('CustomerRef', sr['Customer'] || sr['CustomerRef'] || ''),
        txnDateEl(sr['Date'] || sr['TxnDate']),
        opt('RefNumber', sr['Reference Number'] || sr['RefNumber']),
        optRef('PaymentMethodRef', sr['Payment Method']),
        optRef('DepositToAccountRef', sr['Deposit Account']),
        opt('Memo', sr['Memo']),
        lineXML
      )}</SalesReceiptAdd>
    </SalesReceiptAddRq>
${QBXML_FOOTER}`
}

/**
 * ReceivePaymentAdd  — QB schema order:
 * CustomerRef, ARAccountRef, TxnDate, RefNumber,
 * TotalAmount, PaymentMethodRef, Memo, DepositToAccountRef
 */
export function buildReceivePaymentAddXML(
  rp: Record<string, string>,
  requestId: string
): string {
  return `${QBXML_HEADER}
    <ReceivePaymentAddRq requestID="${requestId}">
      <ReceivePaymentAdd>${x(
        elRef('CustomerRef', rp['Customer'] || rp['CustomerRef'] || ''),
        txnDateEl(rp['Date'] || rp['TxnDate']),
        opt('RefNumber', rp['Reference Number'] || rp['RefNumber']),
        opt('TotalAmount', rp['Amount'] ? amt(rp['Amount']) : ''),
        optRef('PaymentMethodRef', rp['Payment Method']),
        opt('Memo', rp['Memo']),
        optRef('DepositToAccountRef', rp['Deposit Account'])
      )}</ReceivePaymentAdd>
    </ReceivePaymentAddRq>
${QBXML_FOOTER}`
}

/**
 * CreditMemoAdd  — QB schema order:
 * CustomerRef, ARAccountRef, TxnDate, RefNumber, Memo, CreditMemoLineAdd+
 */
export function buildCreditMemoAddXML(
  cm: Record<string, string>,
  requestId: string
): string {
  const lines = parseLineItems(cm)
  const lineXML = lines
    .map((line) =>
      x(
        '<CreditMemoLineAdd>',
        optRef('ItemRef', line.item),
        opt('Desc', line.description),
        opt('Quantity', line.quantity !== '1' ? line.quantity : ''),
        opt('Rate', line.rate !== '0' ? line.rate : ''),
        opt('Amount', line.amount && line.amount !== '0' ? amt(line.amount) : ''),
        '</CreditMemoLineAdd>'
      )
    )
    .filter(Boolean)
    .join('')

  return `${QBXML_HEADER}
    <CreditMemoAddRq requestID="${requestId}">
      <CreditMemoAdd>${x(
        elRef('CustomerRef', cm['Customer'] || cm['CustomerRef'] || ''),
        txnDateEl(cm['Date'] || cm['TxnDate']),
        opt('RefNumber', cm['RefNumber']),
        opt('Memo', cm['Memo']),
        lineXML
      )}</CreditMemoAdd>
    </CreditMemoAddRq>
${QBXML_FOOTER}`
}

/**
 * EstimateAdd  — QB schema order:
 * CustomerRef, TxnDate, RefNumber, Memo, EstimateLineAdd+
 */
export function buildEstimateAddXML(est: Record<string, string>, requestId: string): string {
  const lines = parseLineItems(est)
  const lineXML = lines
    .map((line) =>
      x(
        '<EstimateLineAdd>',
        optRef('ItemRef', line.item),
        opt('Desc', line.description),
        opt('Quantity', line.quantity !== '1' ? line.quantity : ''),
        opt('Rate', line.rate !== '0' ? line.rate : ''),
        opt('Amount', line.amount && line.amount !== '0' ? amt(line.amount) : ''),
        '</EstimateLineAdd>'
      )
    )
    .filter(Boolean)
    .join('')

  return `${QBXML_HEADER}
    <EstimateAddRq requestID="${requestId}">
      <EstimateAdd>${x(
        elRef('CustomerRef', est['Customer'] || est['CustomerRef'] || ''),
        txnDateEl(est['Date'] || est['TxnDate']),
        opt('RefNumber', est['Estimate Number'] || est['RefNumber']),
        opt('Memo', est['Memo']),
        lineXML
      )}</EstimateAdd>
    </EstimateAddRq>
${QBXML_FOOTER}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Transactions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BillAdd  — QB schema order:
 * VendorRef, APAccountRef, TxnDate, DueDate, RefNumber,
 * TermsRef, Memo, ExpenseLineAdd+
 *
 * DueDate MUST come BEFORE RefNumber in the QB schema.
 */
export function buildBillAddXML(bill: Record<string, string>, requestId: string): string {
  const lines = parseLineItems(bill)
  const lineXML = lines
    .map((line) => {
      const accountName = line.account || line.item || ''
      if (!accountName) return ''
      return x(
        '<ExpenseLineAdd>',
        elRef('AccountRef', accountName),
        opt('Amount', line.amount && line.amount !== '0' ? amt(line.amount) : ''),
        opt('Memo', line.description),
        '</ExpenseLineAdd>'
      )
    })
    .filter(Boolean)
    .join('')

  return `${QBXML_HEADER}
    <BillAddRq requestID="${requestId}">
      <BillAdd>${x(
        elRef('VendorRef', bill['Vendor'] || bill['VendorRef'] || ''),
        txnDateEl(bill['Date'] || bill['TxnDate']),
        optDate('DueDate', bill['Due Date']),
        opt('RefNumber', bill['Bill Number'] || bill['RefNumber']),
        opt('Memo', bill['Memo']),
        lineXML
      )}</BillAdd>
    </BillAddRq>
${QBXML_FOOTER}`
}

/**
 * BillPaymentCheckAdd  — QB schema order:
 * PayeeEntityRef, APAccountRef, TxnDate, BankAccountRef, RefNumber, Memo,
 * AppliedToTxnAdd+ (requires an existing Bill TxnID)
 *
 * Since we don't have TxnIDs at CSV-import time, we fall back to a plain
 * Check so at least the cash leaves the right bank account.
 * The user can manually apply the payment to the open bill inside QB.
 */
export function buildBillPaymentCheckAddXML(
  bp: Record<string, string>,
  requestId: string
): string {
  return buildCheckAddXML(
    {
      Account: bp['Account'] || '',
      Date: bp['Date'] || bp['TxnDate'] || '',
      'Check Number': bp['Check Number'] || bp['RefNumber'] || '',
      Payee: bp['Vendor'] || '',
      Amount: bp['Amount'] || '',
      'Expense Account': bp['Account'] || '',
      Memo: bp['Memo'] || `Bill Payment to ${bp['Vendor'] || 'vendor'} (link to bill in QB)`
    },
    requestId
  )
}

/**
 * PurchaseOrderAdd  — QB schema order:
 * VendorRef, TxnDate, RefNumber, Memo, PurchaseOrderLineAdd+
 */
export function buildPurchaseOrderAddXML(po: Record<string, string>, requestId: string): string {
  const lines = parseLineItems(po)
  const lineXML = lines
    .map((line) =>
      x(
        '<PurchaseOrderLineAdd>',
        optRef('ItemRef', line.item),
        opt('Desc', line.description),
        opt('Quantity', line.quantity !== '1' ? line.quantity : ''),
        opt('Rate', line.rate !== '0' ? line.rate : ''),
        opt('Amount', line.amount && line.amount !== '0' ? amt(line.amount) : ''),
        '</PurchaseOrderLineAdd>'
      )
    )
    .filter(Boolean)
    .join('')

  return `${QBXML_HEADER}
    <PurchaseOrderAddRq requestID="${requestId}">
      <PurchaseOrderAdd>${x(
        elRef('VendorRef', po['Vendor'] || po['VendorRef'] || ''),
        txnDateEl(po['Date'] || po['TxnDate']),
        opt('RefNumber', po['PO Number'] || po['RefNumber']),
        opt('Memo', po['Memo']),
        lineXML
      )}</PurchaseOrderAdd>
    </PurchaseOrderAddRq>
${QBXML_FOOTER}`
}

/**
 * CreditCardChargeAdd  — QB schema order:
 * AccountRef (CC account), PayeeEntityRef, TxnDate,
 * RefNumber, Memo, ExpenseLineAdd+
 */
export function buildCreditCardChargeAddXML(
  ccc: Record<string, string>,
  requestId: string
): string {
  const expenseAccount = ccc['Expense Account'] || ''
  const lineContent = x(
    optRef('AccountRef', expenseAccount),
    opt('Amount', ccc['Amount'] && ccc['Amount'] !== '0' ? amt(ccc['Amount']) : ''),
    opt('Memo', ccc['Memo'])
  )

  return `${QBXML_HEADER}
    <CreditCardChargeAddRq requestID="${requestId}">
      <CreditCardChargeAdd>${x(
        elRef('AccountRef', ccc['Account'] || ''),
        optRef('PayeeEntityRef', ccc['Vendor']),
        txnDateEl(ccc['Date'] || ccc['TxnDate']),
        opt('RefNumber', ccc['RefNumber']),
        opt('Memo', ccc['Memo']),
        lineContent ? `<ExpenseLineAdd>${lineContent}</ExpenseLineAdd>` : ''
      )}</CreditCardChargeAdd>
    </CreditCardChargeAddRq>
${QBXML_FOOTER}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Banking Transactions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CheckAdd  — QB schema order:
 * AccountRef (bank account — NOT "BankAccountRef"!), PayeeEntityRef,
 * RefNumber, TxnDate, Memo, ExpenseLineAdd+
 *
 * QB QBXML uses plain "AccountRef" for the bank account at the CheckAdd level.
 * "BankAccountRef" only appears in BillPaymentCheckAdd — NOT here.
 * PayeeEntityRef and RefNumber MUST come BEFORE TxnDate.
 */
export function buildCheckAddXML(check: Record<string, string>, requestId: string): string {
  // 'Bank Account' = the QB account picker value (same for all rows) → top-level AccountRef
  // 'Account'      = expense/income account from the file column → ExpenseLineAdd AccountRef
  const bankAccount = check['Bank Account'] || check['BankAccount'] || ''
  const expenseAccount = check['Account'] || check['Expense Account'] || ''
  const amount = amt(check['Amount'])

  const expenseLine = expenseAccount
    ? x(
        '<ExpenseLineAdd>',
        elRef('AccountRef', expenseAccount),
        el('Amount', amount),
        opt('Memo', check['Description'] || check['Memo']),
        '</ExpenseLineAdd>'
      )
    : ''

  return `${QBXML_HEADER}
    <CheckAddRq requestID="${requestId}">
      <CheckAdd>${x(
        elRef('AccountRef', bankAccount),
        optRef('PayeeEntityRef', check['Payee'] || check['PayeeEntityRef']),
        opt('RefNumber', check['Check Number'] || check['RefNumber']),
        txnDateEl(check['Date'] || check['TxnDate']),
        opt('Memo', check['Memo']),
        expenseLine
      )}</CheckAdd>
    </CheckAddRq>
${QBXML_FOOTER}`
}

/**
 * Deposit — DepositAdd via QBXML (fallback only).
 *
 * In QBSDK live mode, deposits are imported via IIF instead (see importer.ts)
 * because IIF lets the customer Name appear on BOTH the bank account (debit)
 * AND the income account (credit) sides of the General Ledger — producing a
 * true DEP-type transaction identical to QB's Batch Enter Transactions.
 *
 * This function is retained for direct QBXML callers / IIF-mode fallback.
 */
export function buildDepositAddXML(deposit: Record<string, string>, requestId: string): string {
  const bankAccount = deposit['Bank Account'] || deposit['DepositToAccount'] || deposit['Account'] || ''
  const lineAccount = deposit['Account'] || deposit['From Account'] || ''
  const payee = (deposit['Payee'] || deposit['Customer'] || deposit['Entity'] || '').trim()
  const lineContent = x(
    optRef('EntityRef', payee),
    optRef('AccountRef', lineAccount),
    opt('Memo', deposit['Memo']),
    el('Amount', amt(deposit['Amount']))
  )
  return `${QBXML_HEADER}
    <DepositAddRq requestID="${requestId}">
      <DepositAdd>${x(
        txnDateEl(deposit['Date'] || deposit['TxnDate']),
        elRef('DepositToAccountRef', bankAccount),
        opt('Memo', deposit['Memo']),
        `<DepositLineAdd>${lineContent}</DepositLineAdd>`
      )}</DepositAdd>
    </DepositAddRq>
${QBXML_FOOTER}`
}

/**
 * TransferAdd  — QB schema order:
 * TransferFromAccountRef, TransferToAccountRef, TxnDate,
 * TransferAmount, Memo
 */
export function buildTransferAddXML(
  transfer: Record<string, string>,
  requestId: string
): string {
  return `${QBXML_HEADER}
    <TransferAddRq requestID="${requestId}">
      <TransferAdd>${x(
        elRef('TransferFromAccountRef', transfer['From Account'] || ''),
        elRef('TransferToAccountRef', transfer['To Account'] || ''),
        txnDateEl(transfer['Date'] || transfer['TxnDate']),
        el('TransferAmount', amt(transfer['Amount'])),
        opt('Memo', transfer['Memo'])
      )}</TransferAdd>
    </TransferAddRq>
${QBXML_FOOTER}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Other Transactions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JournalEntryAdd  — QB schema order:
 * TxnDate, RefNumber, JournalDebitLine+, JournalCreditLine+
 *
 * JournalDebitLine / JournalCreditLine order:
 * AccountRef, Amount, Memo, EntityRef
 */
export function buildJournalEntryAddXML(je: Record<string, string>, requestId: string): string {
  const debitContent = x(
    elRef('AccountRef', je['Debit Account'] || ''),
    el('Amount', amt(je['Debit Amount'])),
    opt('Memo', je['Memo']),
    optRef('EntityRef', je['Entity'])
  )

  const creditContent = x(
    elRef('AccountRef', je['Credit Account'] || ''),
    el('Amount', amt(je['Credit Amount'])),
    opt('Memo', je['Memo'])
  )

  return `${QBXML_HEADER}
    <JournalEntryAddRq requestID="${requestId}">
      <JournalEntryAdd>${x(
        txnDateEl(je['Date'] || je['TxnDate']),
        opt('RefNumber', je['Reference'] || je['RefNumber']),
        je['Debit Account'] ? `<JournalDebitLine>${debitContent}</JournalDebitLine>` : '',
        je['Credit Account'] ? `<JournalCreditLine>${creditContent}</JournalCreditLine>` : ''
      )}</JournalEntryAdd>
    </JournalEntryAddRq>
${QBXML_FOOTER}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Response Parser
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedQBXMLResponse {
  statusCode: string
  statusSeverity: string
  statusMessage: string
  data?: Record<string, string>
  list?: Record<string, string>[]
  txnId?: string
}

export function parseQBXMLResponse(xmlStr: string): ParsedQBXMLResponse {
  const statusCodeMatch = xmlStr.match(/statusCode="(\d+)"/)
  const statusSeverityMatch = xmlStr.match(/statusSeverity="([^"]+)"/)
  const statusMessageMatch = xmlStr.match(/statusMessage="([^"]+)"/)
  const txnIdMatch = xmlStr.match(/<TxnID[^>]*>([^<]+)<\/TxnID>/)

  const result: ParsedQBXMLResponse = {
    statusCode: statusCodeMatch?.[1] || '0',
    statusSeverity: statusSeverityMatch?.[1] || 'Info',
    statusMessage: statusMessageMatch?.[1] || 'Success',
    txnId: txnIdMatch?.[1]
  }

  const listItems = extractListItems(xmlStr)
  if (listItems.length > 0) {
    result.list = listItems
  }

  return result
}

function extractListItems(xmlStr: string): Record<string, string>[] {
  const items: Record<string, string>[] = []
  const matches = xmlStr.matchAll(
    /<(Account|Customer|Vendor|Item|Employee)Ret>([\s\S]*?)<\/\1Ret>/g
  )
  for (const match of matches) {
    const itemXML = match[2]
    const item: Record<string, string> = {}
    const fields = itemXML.matchAll(/<(\w+)>([^<]+)<\/\1>/g)
    for (const field of fields) {
      item[field[1]] = field[2]
    }
    items.push(item)
  }
  return items
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseLineItems(
  row: Record<string, string>
): {
  item: string
  description: string
  quantity: string
  rate: string
  amount: string
  account: string
}[] {
  return [
    {
      item: row['Item'] || row['Product/Service'] || '',
      description: row['Description'] || row['Memo'] || '',
      quantity: row['Quantity'] || row['Qty'] || '1',
      rate: row['Rate'] || row['Price'] || row['Unit Price'] || '0',
      amount: row['Amount'] || row['Line Amount'] || '0',
      account: row['Account'] || row['Income Account'] || ''
    }
  ]
}

function formatDate(date: string): string {
  if (!date) return new Date().toISOString().split('T')[0]

  // MM/DD/YYYY  or  MM/DD/YY  →  YYYY-MM-DD
  const parts = date.split('/')
  if (parts.length === 3) {
    let year = parts[2]
    if (year.length === 2) {
      // 2-digit year: 00-69 → 2000s, 70-99 → 1900s
      const y = parseInt(year, 10)
      year = (y < 70 ? '20' : '19') + year.padStart(2, '0')
    }
    return `${year}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
  }

  // Already YYYY-MM-DD or other ISO-ish format — pass through
  return date
}

/** Normalise an amount string for QB AMTTYPE: "140." → "140.00", "" → "0" */
function amt(value: string | undefined | null): string {
  let v = (value ?? '0').trim()
  if (!v) return '0'
  // Strip commas: "1,200.50" → "1200.50"
  v = v.replace(/,/g, '')
  // Trailing decimal: "140." → "140.00"
  if (v.endsWith('.')) v += '00'
  // Bare integer: "500" → "500.00"  (QB prefers explicit decimal)
  if (!v.includes('.')) v += '.00'
  return v
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-create entities (Customer / Vendor) so imports don't fail on missing names
// ─────────────────────────────────────────────────────────────────────────────

export function buildCustomerAddXML(name: string, requestId: string): string {
  return `${QBXML_HEADER}
    <CustomerAddRq requestID="${requestId}">
      <CustomerAdd><Name>${escapeXML(name)}</Name></CustomerAdd>
    </CustomerAddRq>
${QBXML_FOOTER}`
}

export function buildVendorAddXML(name: string, requestId: string): string {
  return `${QBXML_HEADER}
    <VendorAddRq requestID="${requestId}">
      <VendorAdd><Name>${escapeXML(name)}</Name></VendorAdd>
    </VendorAddRq>
${QBXML_FOOTER}`
}

function escapeXML(str: string): string {
  return str
    .replace(/[^\x20-\x7E\n\r\t]/g, '') // Strip non-ASCII chars (QB parser chokes on them)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
