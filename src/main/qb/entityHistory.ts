/**
 * Entity → account history from QuickBooks Desktop.
 *
 * METHOD.md §3: look the payee up in QuickBooks and code it to whatever its
 * previous transactions were coded to.  That rule only works if we actually
 * read the history, which the previous implementation often did not:
 *
 *  1. It queried four transaction types.  A loan payment booked as a journal
 *     entry, a vendor credit, or an item-coded bill contributed nothing.
 *  2. It sent <MaxReturned>500</MaxReturned> with no iterator, so QuickBooks
 *     returned the FIRST 500 of each type and every recent transaction —
 *     exactly the ones worth learning from — fell off the end.
 *  3. qbXML reports failures as statusCode/statusSeverity INSIDE the response;
 *     sendRequest resolves normally.  A rejected request looked identical to
 *     "this company file has no bills", and every row silently landed on
 *     Ask My Accountant with no way to tell which had happened.
 *  4. It counted expense LINES.  A loan payment split principal → Loan Payable
 *     and interest → Interest Expense scores 50/50, trips the ambiguity guard,
 *     and gets dropped — even though every payment is coded identically.
 *
 * So: paginate with real qbXML iterators, read every transaction type that can
 * carry a category, resolve item-coded lines through the item list, count once
 * per TRANSACTION (recording the account set as a signature so a stable split
 * is not mistaken for ambiguity), and report what each query actually did.
 */

export type QBSender = (xml: string) => Promise<string>

/** Joins the accounts of one transaction into a coding signature. */
export const SIGNATURE_SEP = ' || '

const QBXML_VERSION = '13.0'
const PAGE_SIZE = 500
const MAX_PAGES = 40

export interface EntityHistoryDiagnostic {
  /** the qbXML request, e.g. "BillQueryRq" */
  query: string
  statusCode: string
  statusSeverity: string
  statusMessage: string
  /** pages actually fetched */
  pages: number
  /** transactions (or list items) read */
  transactions: number
  /** entity→account facts recorded */
  entries: number
  /** true when MAX_PAGES stopped us before QuickBooks ran out of records */
  truncated: boolean
  /** which request-body variant succeeded (>0 means a schema fallback kicked in) */
  variant: number
  /** transport-level failure, as opposed to a qbXML status error */
  error?: string
}

export interface EntityHistoryResult {
  vendors: string[]
  customers: string[]
  /** entity → account → number of TRANSACTIONS coded to it */
  stats: Record<string, Record<string, number>>
  /** entity → account → total dollars coded to it */
  amounts: Record<string, Record<string, number>>
  /** entity → coding signature → transaction count */
  signatures: Record<string, Record<string, number>>
  /** entity → total transactions seen */
  txnCounts: Record<string, number>
  diagnostics: EntityHistoryDiagnostic[]
}

// ── qbXML plumbing ───────────────────────────────────────────────────────────

function envelope(inner: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<?qbxml version="${QBXML_VERSION}"?>\n` +
    `<QBXML><QBXMLMsgsRq onError="continueOnError">${inner}</QBXMLMsgsRq></QBXML>`
  )
}

interface Status {
  code: string
  severity: string
  message: string
}

/**
 * Read the status off the *Rs element.  A missing response element is itself a
 * failure — QuickBooks rejected the request before it produced one.
 */
function readStatus(xml: string, rq: string): Status {
  const rs = rq.replace(/Rq$/, 'Rs')
  const tag = xml.match(new RegExp(`<${rs}\\b[^>]*>`))?.[0]
  if (!tag) {
    return { code: '-1', severity: 'Error', message: `QuickBooks returned no <${rs}>` }
  }
  return {
    code: tag.match(/statusCode="([^"]*)"/)?.[1] ?? '0',
    severity: tag.match(/statusSeverity="([^"]*)"/)?.[1] ?? 'Info',
    message: tag.match(/statusMessage="([^"]*)"/)?.[1] ?? 'Status OK'
  }
}

interface PageTally {
  transactions: number
  entries: number
}

/**
 * Run a query to exhaustion using qbXML iterators.
 *
 * `bodyVariants` are tried in order, but only ever swapped when page 0 fails —
 * once records are recorded, retrying a different body would double-count.
 * The fallbacks exist because a few query types reject elements their siblings
 * accept (IncludeLineItems, TxnDateRangeFilter); rather than losing the whole
 * type silently, we drop the offending element and say so in the diagnostic.
 */
async function runPaged(
  send: QBSender,
  rq: string,
  bodyVariants: string[],
  onPage: (xml: string) => PageTally,
  diag: EntityHistoryDiagnostic
): Promise<void> {
  const variants = bodyVariants.filter((b, i) => bodyVariants.indexOf(b) === i)

  for (let v = 0; v < variants.length; v++) {
    let iteratorID: string | null = null
    let failedOnFirstPage = false

    diag.variant = v
    diag.pages = 0
    diag.transactions = 0
    diag.entries = 0
    diag.truncated = false
    diag.error = undefined

    for (let page = 0; page < MAX_PAGES; page++) {
      const attrs =
        page === 0 ? ' iterator="Start"' : ` iterator="Continue" iteratorID="${iteratorID}"`
      const xml = envelope(`<${rq} requestID="eh_${page}"${attrs}>${variants[v]}</${rq}>`)

      let resp: string
      try {
        resp = await send(xml)
      } catch (err: unknown) {
        diag.error = err instanceof Error ? err.message : String(err)
        diag.statusCode = '-1'
        diag.statusSeverity = 'Error'
        diag.statusMessage = diag.error
        failedOnFirstPage = page === 0
        break
      }

      const status = readStatus(resp, rq)
      diag.statusCode = status.code
      diag.statusSeverity = status.severity
      diag.statusMessage = status.message

      if (status.severity === 'Error') {
        failedOnFirstPage = page === 0
        break
      }

      const tally = onPage(resp)
      diag.pages = page + 1
      diag.transactions += tally.transactions
      diag.entries += tally.entries

      const remaining = Number(resp.match(/iteratorRemainingCount="(\d+)"/)?.[1] ?? '0')
      iteratorID = resp.match(/iteratorID="([^"]+)"/)?.[1] ?? null
      if (remaining <= 0 || !iteratorID) return
      if (page === MAX_PAGES - 1) diag.truncated = true
    }

    if (!failedOnFirstPage) return
  }
}

// ── XML readers ──────────────────────────────────────────────────────────────

function blocks(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'g')) ?? []
}

/** FullName out of a <XxxRef> wrapper, skipping the ListID that precedes it. */
function refFullName(xml: string, tag: string): string | null {
  const ref = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  if (!ref) return null
  return ref[1].match(/<FullName>([^<]+)<\/FullName>/)?.[1]?.trim() ?? null
}

/**
 * A list element's own name.  Everything before the first <XxxRef> belongs to
 * the record itself, which keeps a job's "Customer:Job" from being overwritten
 * by its ParentRef's FullName.
 *
 * VendorRet has no <FullName> — vendors are a flat list and QuickBooks returns
 * only <Name> — so fall back to it, or the vendor list comes back empty.
 */
function ownFullName(block: string): string | null {
  const head = block.split(/<\w+Ref>/)[0]
  const full = head.match(/<FullName>([^<]+)<\/FullName>/)?.[1]?.trim()
  if (full) return full
  return head.match(/<Name>([^<]+)<\/Name>/)?.[1]?.trim() ?? null
}

function amountOf(xml: string): number {
  const m = xml.match(/<Amount>(-?[\d.]+)<\/Amount>/)
  return m ? Math.abs(parseFloat(m[1])) || 0 : 0
}

interface AccountLine {
  account: string
  amount: number
}

/**
 * Every categorized line in a transaction block.  Item-coded lines carry an
 * ItemRef rather than an AccountRef, so they are resolved through the item
 * list — without that, item-based bills and every invoice look uncategorized.
 */
function accountLines(
  block: string,
  itemAccounts: Record<string, string>,
  lineTags: string[]
): AccountLine[] {
  const out: AccountLine[] = []
  for (const tag of lineTags) {
    for (const line of blocks(block, tag)) {
      const direct = refFullName(line, 'AccountRef')
      const item = refFullName(line, 'ItemRef')
      const account = direct ?? (item ? itemAccounts[item] : undefined)
      if (account) out.push({ account, amount: amountOf(line) })
    }
  }
  return out
}

// ── Aggregation ──────────────────────────────────────────────────────────────

class Aggregator {
  stats: Record<string, Record<string, number>> = {}
  amounts: Record<string, Record<string, number>> = {}
  signatures: Record<string, Record<string, number>> = {}
  txnCounts: Record<string, number> = {}

  /**
   * Record ONE transaction.  Accounts are deduped within the transaction and
   * the whole account set is stored as a signature, so twelve identical loan
   * payments read as "twelve transactions coded the same way" rather than
   * "twenty-four lines split evenly between two accounts".
   */
  addTxn(entity: string | null, lines: AccountLine[]): number {
    const name = entity?.trim()
    if (!name || lines.length === 0) return 0

    const perAccount = new Map<string, number>()
    for (const line of lines) {
      const account = line.account.trim()
      if (!account) continue
      perAccount.set(account, (perAccount.get(account) ?? 0) + line.amount)
    }
    if (perAccount.size === 0) return 0

    if (!this.stats[name]) this.stats[name] = {}
    if (!this.amounts[name]) this.amounts[name] = {}
    for (const [account, amount] of perAccount) {
      this.stats[name][account] = (this.stats[name][account] ?? 0) + 1
      this.amounts[name][account] = (this.amounts[name][account] ?? 0) + amount
    }

    const signature = [...perAccount.keys()].sort().join(SIGNATURE_SEP)
    if (!this.signatures[name]) this.signatures[name] = {}
    this.signatures[name][signature] = (this.signatures[name][signature] ?? 0) + 1
    this.txnCounts[name] = (this.txnCounts[name] ?? 0) + 1

    return perAccount.size
  }
}

// ── Scanners ─────────────────────────────────────────────────────────────────

/** Bills, checks, credit card charges/credits, vendor credits, invoices, sales receipts. */
function scanHeaderEntity(
  xml: string,
  retTag: string,
  entityTags: string[],
  lineTags: string[],
  itemAccounts: Record<string, string>,
  agg: Aggregator
): PageTally {
  let transactions = 0
  let entries = 0
  for (const block of blocks(xml, retTag)) {
    transactions++
    let entity: string | null = null
    for (const tag of entityTags) {
      entity = refFullName(block, tag)
      if (entity) break
    }
    entries += agg.addTxn(entity, accountLines(block, itemAccounts, lineTags))
  }
  return { transactions, entries }
}

/**
 * Deposits and journal entries carry the entity on each LINE, so one document
 * can hold facts about several payees.  Group the lines per entity and record
 * each group as that entity's transaction.
 */
function scanLineEntity(
  xml: string,
  retTag: string,
  lineTags: string[],
  itemAccounts: Record<string, string>,
  agg: Aggregator
): PageTally {
  let transactions = 0
  let entries = 0

  for (const block of blocks(xml, retTag)) {
    transactions++
    const byEntity = new Map<string, AccountLine[]>()

    for (const tag of lineTags) {
      for (const line of blocks(block, tag)) {
        const entity = refFullName(line, 'EntityRef')
        if (!entity) continue
        const item = refFullName(line, 'ItemRef')
        const account = refFullName(line, 'AccountRef') ?? (item ? itemAccounts[item] : undefined)
        if (!account) continue
        const list = byEntity.get(entity) ?? []
        list.push({ account, amount: amountOf(line) })
        byEntity.set(entity, list)
      }
    }

    for (const [entity, lines] of byEntity) entries += agg.addTxn(entity, lines)
  }

  return { transactions, entries }
}

// ── List loaders ─────────────────────────────────────────────────────────────

function newDiagnostic(query: string): EntityHistoryDiagnostic {
  return {
    query,
    statusCode: '',
    statusSeverity: '',
    statusMessage: 'not run',
    pages: 0,
    transactions: 0,
    entries: 0,
    truncated: false,
    variant: 0
  }
}

async function loadNames(
  send: QBSender,
  rq: string,
  retTag: string,
  diagnostics: EntityHistoryDiagnostic[]
): Promise<string[]> {
  const names: string[] = []
  const diag = newDiagnostic(rq)
  diagnostics.push(diag)

  await runPaged(
    send,
    rq,
    [`<MaxReturned>${PAGE_SIZE}</MaxReturned>`],
    (xml) => {
      let n = 0
      for (const block of blocks(xml, retTag)) {
        const name = ownFullName(block)
        if (name) {
          names.push(name)
          n++
        }
      }
      return { transactions: n, entries: n }
    },
    diag
  )

  return names
}

/**
 * item FullName → the account it posts to.  Income account first: for a bank
 * deposit matched to a customer, the category we want is what their invoices
 * credit, not the COGS side.
 */
async function loadItemAccounts(
  send: QBSender,
  diagnostics: EntityHistoryDiagnostic[]
): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  const diag = newDiagnostic('ItemQueryRq')
  diagnostics.push(diag)

  await runPaged(
    send,
    'ItemQueryRq',
    [`<MaxReturned>${PAGE_SIZE}</MaxReturned>`],
    (xml) => {
      let transactions = 0
      let entries = 0
      for (const match of xml.matchAll(/<Item(\w+)Ret>([\s\S]*?)<\/Item\1Ret>/g)) {
        transactions++
        const body = match[2]
        const name = ownFullName(body)
        if (!name) continue
        const account = refFullName(body, 'IncomeAccountRef') ?? refFullName(body, 'AccountRef')
        if (!account) continue
        map[name] = account
        entries++
      }
      return { transactions, entries }
    },
    diag
  )

  return map
}

// ── Entry point ──────────────────────────────────────────────────────────────

export interface EntityHistoryOptions {
  /** Only read transactions this recent.  0/undefined reads all history. */
  lookbackYears?: number
}

export async function collectEntityHistory(
  send: QBSender,
  options: EntityHistoryOptions = {}
): Promise<EntityHistoryResult> {
  const diagnostics: EntityHistoryDiagnostic[] = []
  const agg = new Aggregator()

  const from =
    options.lookbackYears && options.lookbackYears > 0
      ? new Date(Date.now() - options.lookbackYears * 365.25 * 864e5).toISOString().slice(0, 10)
      : null

  const dateFilter = from
    ? `<TxnDateRangeFilter><FromTxnDate>${from}</FromTxnDate></TxnDateRangeFilter>`
    : ''
  const max = `<MaxReturned>${PAGE_SIZE}</MaxReturned>`

  // Fallback chain: full body → drop IncludeLineItems → drop the date filter.
  const withLines = [
    `${max}${dateFilter}<IncludeLineItems>true</IncludeLineItems>`,
    `${max}${dateFilter}`,
    `${max}<IncludeLineItems>true</IncludeLineItems>`
  ]
  const withoutLines = [`${max}${dateFilter}`, max]

  const itemAccounts = await loadItemAccounts(send, diagnostics)

  const expenseLines = ['ExpenseLineRet', 'ItemLineRet']

  const scans: { rq: string; bodies: string[]; run: (xml: string) => PageTally }[] = [
    // Vendor side — the payee sits on the transaction header.
    {
      rq: 'BillQueryRq',
      bodies: withLines,
      run: (x) => scanHeaderEntity(x, 'BillRet', ['VendorRef'], expenseLines, itemAccounts, agg)
    },
    {
      rq: 'CheckQueryRq',
      bodies: withLines,
      run: (x) => scanHeaderEntity(x, 'CheckRet', ['PayeeEntityRef'], expenseLines, itemAccounts, agg)
    },
    {
      rq: 'CreditCardChargeQueryRq',
      bodies: withLines,
      run: (x) =>
        scanHeaderEntity(x, 'CreditCardChargeRet', ['PayeeEntityRef'], expenseLines, itemAccounts, agg)
    },
    {
      rq: 'CreditCardCreditQueryRq',
      bodies: withLines,
      run: (x) =>
        scanHeaderEntity(x, 'CreditCardCreditRet', ['PayeeEntityRef'], expenseLines, itemAccounts, agg)
    },
    {
      rq: 'VendorCreditQueryRq',
      bodies: withLines,
      run: (x) => scanHeaderEntity(x, 'VendorCreditRet', ['VendorRef'], expenseLines, itemAccounts, agg)
    },

    // Customer side — income accounts reach us through the item list.
    {
      rq: 'InvoiceQueryRq',
      bodies: withLines,
      run: (x) => scanHeaderEntity(x, 'InvoiceRet', ['CustomerRef'], ['InvoiceLineRet'], itemAccounts, agg)
    },
    {
      rq: 'SalesReceiptQueryRq',
      bodies: withLines,
      run: (x) =>
        scanHeaderEntity(x, 'SalesReceiptRet', ['CustomerRef'], ['SalesReceiptLineRet'], itemAccounts, agg)
    },

    // Entity lives on the line, not the header.
    {
      rq: 'DepositQueryRq',
      bodies: withLines,
      run: (x) => scanLineEntity(x, 'DepositRet', ['DepositLineRet'], itemAccounts, agg)
    },
    // Journal entries have no IncludeLineItems element — lines always come back.
    // This is where accountants book loan payments, so missing it costs real coverage.
    {
      rq: 'JournalEntryQueryRq',
      bodies: withoutLines,
      run: (x) =>
        scanLineEntity(x, 'JournalEntryRet', ['JournalDebitLine', 'JournalCreditLine'], itemAccounts, agg)
    }
  ]

  for (const scan of scans) {
    const diag = newDiagnostic(scan.rq)
    diagnostics.push(diag)
    await runPaged(send, scan.rq, scan.bodies, scan.run, diag)
  }

  const vendors = await loadNames(send, 'VendorQueryRq', 'VendorRet', diagnostics)
  const customers = await loadNames(send, 'CustomerQueryRq', 'CustomerRet', diagnostics)

  return {
    vendors,
    customers,
    stats: agg.stats,
    amounts: agg.amounts,
    signatures: agg.signatures,
    txnCounts: agg.txnCounts,
    diagnostics
  }
}
