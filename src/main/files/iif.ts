/**
 * IIF (Intuit Interchange Format) Parser and Generator
 * IIF is a tab-separated format native to QuickBooks Desktop
 */

export interface IIFTransaction {
  headers: string[]
  rows: Record<string, string>[]
  type: string
}

// IIF headers for common transaction types
const IIF_HEADERS: Record<string, string[]> = {
  Invoice: [
    '!TRNS',
    'TRNSTYPE',
    'DATE',
    'ACCNT',
    'NAME',
    'AMOUNT',
    'DOCNUM',
    'MEMO',
    'CLEAR',
    'TOPRINT',
    '!SPL',
    'SPL',
    'TRNSTYPE',
    'DATE',
    'ACCNT',
    'NAME',
    'AMOUNT',
    'DOCNUM',
    'MEMO',
    'QNTY',
    'PRICE',
    'INVITEM',
    '!ENDTRNS'
  ],
  Bill: [
    '!TRNS',
    'TRNSTYPE',
    'DATE',
    'ACCNT',
    'NAME',
    'AMOUNT',
    'DOCNUM',
    'MEMO',
    '!SPL',
    'SPL',
    'TRNSTYPE',
    'DATE',
    'ACCNT',
    'NAME',
    'AMOUNT',
    'MEMO',
    '!ENDTRNS'
  ],
  'Journal Entry': [
    '!TRNS',
    'TRNSTYPE',
    'DATE',
    'ACCNT',
    'NAME',
    'AMOUNT',
    'MEMO',
    '!SPL',
    'SPL',
    'TRNSTYPE',
    'DATE',
    'ACCNT',
    'NAME',
    'AMOUNT',
    'MEMO',
    '!ENDTRNS'
  ],
  Check: [
    '!TRNS',
    'TRNSTYPE',
    'DATE',
    'ACCNT',
    'NAME',
    'AMOUNT',
    'DOCNUM',
    'MEMO',
    '!SPL',
    'SPL',
    'TRNSTYPE',
    'DATE',
    'ACCNT',
    'NAME',
    'AMOUNT',
    'MEMO',
    '!ENDTRNS'
  ],
  Deposit: [
    '!TRNS',
    'TRNSTYPE',
    'DATE',
    'ACCNT',
    'NAME',
    'AMOUNT',
    'MEMO',
    '!SPL',
    'SPL',
    'TRNSTYPE',
    'DATE',
    'ACCNT',
    'NAME',
    'AMOUNT',
    'MEMO',
    '!ENDTRNS'
  ]
}

const IIF_TYPE_MAP: Record<string, string> = {
  Invoice: 'INVOICE',
  Bill: 'BILL',
  'Journal Entry': 'GENERAL JOURNAL',
  Check: 'CHECK',
  Deposit: 'DEPOSIT',
  'Sales Receipt': 'CASH SALE',
  'Credit Memo': 'CREDIT MEMO',
  'Receive Payment': 'PAYMENT',
  'Purchase Order': 'PURCH ORD'
}

/**
 * Deposit-specific IIF generator.
 *
 * The key difference vs generic generateIIF:
 *   TRNS line → Bank Account (debit side)  + customer Name
 *   SPL  line → Income Account (credit side) + customer Name   (negative amount)
 *
 * When QB imports this IIF, it creates a true DEP-type transaction with the
 * customer Name on BOTH sides of the General Ledger — matching what QB's own
 * Batch Enter Transactions screen produces.
 */
export function generateDepositIIF(transactions: Record<string, string>[]): string {
  const lines: string[] = []

  // Header declarations (must come first, once per file)
  lines.push('!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO')
  lines.push('!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO')
  lines.push('!ENDTRNS')

  for (const tx of transactions) {
    const date = formatIIFDate(tx['Date'] || tx['TxnDate'] || '')
    // Bank account goes on the TRNS (header) line — this is the debit side
    const bankAccount = (tx['Bank Account'] || tx['DepositToAccount'] || '').trim()
    // Income account goes on the SPL (split) line — this is the credit side
    const incomeAccount = (tx['Account'] || tx['From Account'] || '').trim()
    // Customer/payee name appears on BOTH lines → Name on both GL sides ✓
    const name = (tx['Payee'] || tx['Customer'] || tx['Entity'] || '').trim()
    const amount = (tx['Amount'] || '0').trim()
    const memo = (tx['Memo'] || '').trim()

    // TRNS = bank account debit side with customer name
    lines.push(`TRNS\tDEPOSIT\t${date}\t${bankAccount}\t${name}\t${amount}\t${memo}`)
    // SPL = income account credit side (negative amount) with customer name
    lines.push(`SPL\tDEPOSIT\t${date}\t${incomeAccount}\t${name}\t-${amount}\t${memo}`)
    lines.push('ENDTRNS')
  }

  return lines.join('\n')
}

export function generateIIF(transactions: Record<string, string>[], type: string): string {
  const iifType = IIF_TYPE_MAP[type] || type.toUpperCase()
  const lines: string[] = []

  // Header declaration line
  lines.push('!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tTOPRINT')
  lines.push('!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tQNTY\tPRICE\tINVITEM\tTAXABLE')
  lines.push('!ENDTRNS')

  for (const tx of transactions) {
    // TRNS line (header transaction line)
    const date = formatIIFDate(tx['Date'] || tx['TxnDate'] || '')
    const account = tx['Account'] || tx['ARAccount'] || tx['APAccount'] || 'Accounts Receivable'
    const name = tx['Customer'] || tx['Vendor'] || tx['Name'] || ''
    const amount = tx['Amount'] || tx['Total'] || '0'
    const docNum = tx['Invoice Number'] || tx['Bill Number'] || tx['RefNumber'] || tx['Check Number'] || ''
    const memo = tx['Memo'] || tx['Description'] || ''

    lines.push(
      `TRNS\t${iifType}\t${date}\t${account}\t${name}\t${amount}\t${docNum}\t${memo}\tN\tN`
    )

    // SPL line (split/detail line)
    const splAccount = tx['Expense Account'] || tx['Income Account'] || tx['SplitAccount'] || account
    const splAmount = tx['Amount'] || '0'
    const quantity = tx['Quantity'] || tx['Qty'] || ''
    const price = tx['Rate'] || tx['Price'] || ''
    const item = tx['Item'] || tx['Product/Service'] || ''

    lines.push(
      `SPL\t1\t${iifType}\t${date}\t${splAccount}\t${name}\t-${splAmount}\t${docNum}\t${memo}\t${quantity}\t${price}\t${item}\tN`
    )

    lines.push('ENDTRNS')
  }

  return lines.join('\n')
}

export function parseIIF(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
  const rows: Record<string, string>[] = []
  let trnsHeaders: string[] = []

  for (const line of lines) {
    if (line.startsWith('!TRNS')) {
      trnsHeaders = line.split('\t').slice(1) // remove !TRNS prefix
    } else if (line.startsWith('TRNS')) {
      const values = line.split('\t').slice(1)
      const row: Record<string, string> = {}
      trnsHeaders.forEach((h, i) => {
        row[h] = values[i] || ''
      })
      rows.push(row)
    }
    // Skip SPL lines and !ENDTRNS for simple parsing
  }

  return { headers: trnsHeaders, rows }
}

function formatIIFDate(date: string): string {
  if (!date) return new Date().toLocaleDateString('en-US')
  // Convert YYYY-MM-DD to M/D/YYYY
  const d = new Date(date)
  if (isNaN(d.getTime())) return date
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}
