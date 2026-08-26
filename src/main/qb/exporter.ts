import { QBConnection } from './connection'
import { QBXML_HEADER, QBXML_FOOTER, TX_TYPE_MAP } from './qbxml'

// Types that do NOT support <IncludeLineItems> in their query
const NO_LINE_ITEMS = new Set(['Transfer', 'Receive Payment', 'Bill Payment'])

/** 500 per page — enough headroom for 20,000 transactions of one type. */
const MAX_PAGES = 40

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

  // "Added since" is a MODIFIED-date filter, not a transaction-date one: it
  // finds what was written to the company file recently, whatever dates the
  // transactions themselves carry.  That is what separates an import you just
  // ran from the history that was already there — transaction dates overlap,
  // creation times do not.  Must precede TxnDateRangeFilter in the schema.
  if (filters.addedSince) {
    parts.push(
      `<ModifiedDateRangeFilter><FromModifiedDate>${filters.addedSince}T00:00:00</FromModifiedDate></ModifiedDateRangeFilter>`
    )
  }

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

  // Page through with a qbXML iterator. Without one QuickBooks returns the
  // first MaxReturned and stops, silently — this file was already at 423 checks
  // against a 500 cap, so the next import would have started hiding rows from
  // the delete and modify screens with nothing to show it had happened.
  const results: Record<string, string>[] = []
  const seen = new Set<string>()
  let iteratorID: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const attrs =
      page === 0 ? ' iterator="Start"' : ` iterator="Continue" iteratorID="${iteratorID}"`
    const xml = `${QBXML_HEADER}
    <${typeMap.query}Rq requestID="${Date.now()}_${page}"${attrs}>
      ${parts.join('\n      ')}
    </${typeMap.query}Rq>
${QBXML_FOOTER}`

    const response = await conn.sendRequest(xml)
    for (const row of parseExportResponse(response, type)) {
      // A Ret block can repeat across pages if the file changes mid-query.
      const key = row['TxnID'] || JSON.stringify(row)
      if (seen.has(key)) continue
      seen.add(key)
      results.push(row)
    }

    const remaining = Number(response.match(/iteratorRemainingCount="(\d+)"/)?.[1] ?? '0')
    iteratorID = response.match(/iteratorID="([^"]+)"/)?.[1] ?? null
    if (remaining <= 0 || !iteratorID) break
  }

  return results
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
