import { QBConnection } from './connection'
import { QBXML_HEADER, QBXML_FOOTER, TX_TYPE_MAP } from './qbxml'

// Types that do NOT support <IncludeLineItems> in their query
const NO_LINE_ITEMS = new Set(['Transfer', 'Receive Payment', 'Bill Payment'])

export async function exportTransactions(
  conn: QBConnection,
  type: string,
  filters: Record<string, string>
): Promise<Record<string, string>[]> {
  const typeMap = TX_TYPE_MAP[type]
  if (!typeMap) throw new Error(`Unsupported transaction type: ${type}`)

  // QB query element order (STRICT):
  //   MaxReturned → ...filters... → TxnDateRangeFilter → IncludeLineItems
  const parts: string[] = []

  parts.push('<MaxReturned>500</MaxReturned>')

  if (filters.fromDate) {
    parts.push(
      `<TxnDateRangeFilter><FromTxnDate>${filters.fromDate}</FromTxnDate>${
        filters.toDate ? `<ToTxnDate>${filters.toDate}</ToTxnDate>` : ''
      }</TxnDateRangeFilter>`
    )
  }

  if (!NO_LINE_ITEMS.has(type)) {
    parts.push('<IncludeLineItems>true</IncludeLineItems>')
  }

  const xml = `${QBXML_HEADER}
    <${typeMap.query}Rq requestID="${Date.now()}">
      ${parts.join('\n      ')}
    </${typeMap.query}Rq>
${QBXML_FOOTER}`

  const response = await conn.sendRequest(xml)
  return parseExportResponse(response, type)
}

function parseExportResponse(xml: string, type: string): Record<string, string>[] {
  const results: Record<string, string>[] = []
  const retTag = type.replace(/\s+/g, '') + 'Ret'

  // Find all transaction blocks
  const regex = new RegExp(`<${retTag}>([\\s\\S]*?)<\\/${retTag}>`, 'g')
  const matches = xml.matchAll(regex)

  for (const match of matches) {
    const block = match[1]
    const row: Record<string, string> = {}

    // Extract all simple fields
    const fieldRegex = /<(\w+)>([^<]+)<\/\1>/g
    const fields = block.matchAll(fieldRegex)
    for (const field of fields) {
      // Don't overwrite already found fields (first occurrence wins for nested)
      if (!row[field[1]]) {
        row[field[1]] = field[2]
      }
    }

    // Add transaction type
    row['TransactionType'] = type
    results.push(row)
  }

  return results
}
