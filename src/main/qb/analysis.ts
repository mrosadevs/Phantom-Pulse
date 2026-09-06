/**
 * Read-only company-file analysis.
 *
 * Everything here answers a question about the file without changing it: what
 * is duplicated, what is uncoded, what is never used, which vendors are not
 * ready for 1099s, what was deleted.  Nothing in this module writes.
 *
 * ## One scan, many answers
 *
 * Every one of those questions needs roughly the same raw material — every
 * transaction, with its entity, date, amount and the accounts it touched.
 * Running a separate set of queries per feature would walk a large company
 * file four times and take four times as long, so `scanTransactions` makes one
 * pass and the analyses below are pure functions over its result.
 *
 * ## Why the field extraction is deliberately loose
 *
 * Transaction types disagree about what their fields are called: the payee is
 * VendorRef on a bill, PayeeEntityRef on a check, CustomerRef on an invoice;
 * the total is AmountDue, Amount, Subtotal or TotalAmount depending on type.
 * Hard-coding a table of "type → field name" means every schema difference
 * Intuit has ever shipped becomes a silent zero in someone's report.  Instead
 * each field has an ordered list of candidate tags and the first one present
 * wins, which degrades to "we read the wrong-but-adjacent field" rather than
 * "this transaction type contributes nothing".
 */

import {
  type QBSender,
  type ScanDiagnostic,
  blocks,
  decodeXML,
  escapeXML,
  envelope,
  money,
  newDiagnostic,
  ownFullName,
  readStatus,
  refFullName,
  runPaged,
  tagValue
} from './query'

// ── Scanning ─────────────────────────────────────────────────────────────────

/** Every transaction type that can carry a category or a payee. */
const SCAN_TYPES: { type: string; rq: string; ret: string }[] = [
  { type: 'Bill', rq: 'BillQueryRq', ret: 'BillRet' },
  { type: 'Check', rq: 'CheckQueryRq', ret: 'CheckRet' },
  { type: 'Credit Card Charge', rq: 'CreditCardChargeQueryRq', ret: 'CreditCardChargeRet' },
  { type: 'Credit Card Credit', rq: 'CreditCardCreditQueryRq', ret: 'CreditCardCreditRet' },
  { type: 'Vendor Credit', rq: 'VendorCreditQueryRq', ret: 'VendorCreditRet' },
  { type: 'Invoice', rq: 'InvoiceQueryRq', ret: 'InvoiceRet' },
  { type: 'Sales Receipt', rq: 'SalesReceiptQueryRq', ret: 'SalesReceiptRet' },
  { type: 'Credit Memo', rq: 'CreditMemoQueryRq', ret: 'CreditMemoRet' },
  { type: 'Deposit', rq: 'DepositQueryRq', ret: 'DepositRet' },
  { type: 'Journal Entry', rq: 'JournalEntryQueryRq', ret: 'JournalEntryRet' },
  { type: 'Bill Payment', rq: 'BillPaymentCheckQueryRq', ret: 'BillPaymentCheckRet' },
  { type: 'Receive Payment', rq: 'ReceivePaymentQueryRq', ret: 'ReceivePaymentRet' }
]

/** Ordered candidates — first present wins.  See the module note. */
const ENTITY_REFS = ['VendorRef', 'PayeeEntityRef', 'CustomerRef', 'EntityRef']
const AMOUNT_TAGS = ['AmountDue', 'TotalAmount', 'Amount', 'Subtotal', 'BalanceRemaining']

export interface ScannedTxn {
  type: string
  txnId: string
  /** Required by every *Mod request; without it a later edit cannot be built. */
  editSequence: string
  date: string
  refNumber: string
  memo: string
  entity: string
  amount: number
  /** FullNames of every account the transaction touched, header and lines. */
  accounts: string[]
  cleared: string
}

export interface ScanResult {
  transactions: ScannedTxn[]
  diagnostics: ScanDiagnostic[]
}

export interface ScanOptions {
  /** ISO YYYY-MM-DD. Omit both for the whole file. */
  from?: string
  to?: string
  /** Restrict to these ScannedTxn.type values. Omit for all. */
  types?: string[]
}

function dateFilter(opts: ScanOptions): string {
  if (!opts.from && !opts.to) return ''
  const from = opts.from ? `<FromTxnDate>${escapeXML(opts.from)}</FromTxnDate>` : ''
  const to = opts.to ? `<ToTxnDate>${escapeXML(opts.to)}</ToTxnDate>` : ''
  return `<TxnDateRangeFilter>${from}${to}</TxnDateRangeFilter>`
}

function firstOf(block: string, tags: string[], read: (b: string, t: string) => string | null): string {
  for (const t of tags) {
    const v = read(block, t)
    if (v) return v
  }
  return ''
}

function parseTxnBlock(block: string, type: string): ScannedTxn {
  const accounts = new Set<string>()
  const accRe = /<AccountRef>([\s\S]*?)<\/AccountRef>/g
  let m: RegExpExecArray | null
  while ((m = accRe.exec(block)) !== null) {
    const name = m[1].match(/<FullName>([^<]+)<\/FullName>/)?.[1]
    if (name) accounts.add(decodeXML(name).trim())
  }

  return {
    type,
    txnId: tagValue(block, 'TxnID') ?? '',
    editSequence: tagValue(block, 'EditSequence') ?? '',
    date: tagValue(block, 'TxnDate') ?? '',
    refNumber: tagValue(block, 'RefNumber') ?? '',
    memo: tagValue(block, 'Memo') ?? '',
    entity: firstOf(block, ENTITY_REFS, refFullName),
    amount: money(firstOf(block, AMOUNT_TAGS, tagValue)),
    accounts: [...accounts],
    cleared: tagValue(block, 'ClearedStatus') ?? ''
  }
}

/**
 * One pass over the company file.
 *
 * Line items are requested because the account coding lives on the lines, not
 * the header — but IncludeLineItems is rejected by a couple of query types, so
 * it is the first thing dropped when a variant fails.
 */
export async function scanTransactions(
  send: QBSender,
  opts: ScanOptions = {}
): Promise<ScanResult> {
  const transactions: ScannedTxn[] = []
  const diagnostics: ScanDiagnostic[] = []

  const wanted = opts.types?.length
    ? SCAN_TYPES.filter((t) => opts.types!.includes(t.type))
    : SCAN_TYPES

  for (const { type, rq, ret } of wanted) {
    const diag = newDiagnostic(rq)
    const filter = dateFilter(opts)

    await runPaged(
      send,
      rq,
      [
        `${filter}<IncludeLineItems>true</IncludeLineItems>`,
        `${filter}`,
        `<IncludeLineItems>true</IncludeLineItems>`,
        ''
      ],
      (xml) => {
        const found = blocks(xml, ret)
        for (const b of found) transactions.push(parseTxnBlock(b, type))
        return found.length
      },
      diag
    )

    diagnostics.push(diag)
  }

  return { transactions, diagnostics }
}

// ── Lists ────────────────────────────────────────────────────────────────────

export interface ListEntry {
  listId: string
  editSequence: string
  name: string
  isActive: boolean
  /** Account type, vendor tax id, etc. — whatever the list carries. */
  extra: Record<string, string>
}

const LIST_TYPES: Record<string, { rq: string; ret: string; extras: string[] }> = {
  Account: {
    rq: 'AccountQueryRq',
    ret: 'AccountRet',
    extras: ['AccountType', 'AccountNumber', 'Balance', 'TotalBalance', 'Desc']
  },
  Vendor: {
    rq: 'VendorQueryRq',
    ret: 'VendorRet',
    extras: [
      'VendorTaxIdent',
      'IsVendorEligibleFor1099',
      'Balance',
      'Email',
      'Phone',
      'CompanyName',
      'AccountNumber'
    ]
  },
  Customer: {
    rq: 'CustomerQueryRq',
    ret: 'CustomerRet',
    extras: ['Balance', 'Email', 'Phone', 'CompanyName']
  },
  Item: { rq: 'ItemQueryRq', ret: 'ItemRet', extras: ['Type', 'Desc'] },
  Class: { rq: 'ClassQueryRq', ret: 'ClassRet', extras: [] }
}

/**
 * A list, in full.
 *
 * ActiveStatus=All matters: an inactive account still appears on historical
 * reports and still collides on a name merge, so a scan that only saw active
 * entries would miss real problems.
 */
export async function fetchList(
  send: QBSender,
  kind: keyof typeof LIST_TYPES | string
): Promise<{ entries: ListEntry[]; diagnostic: ScanDiagnostic }> {
  const def = LIST_TYPES[kind]
  const diag = newDiagnostic(def?.rq ?? `${kind}QueryRq`)
  const entries: ListEntry[] = []
  if (!def) return { entries, diagnostic: diag }

  await runPaged(
    send,
    def.rq,
    ['<ActiveStatus>All</ActiveStatus>', ''],
    (xml) => {
      const found = blocks(xml, def.ret)
      for (const b of found) {
        const name = ownFullName(b)
        if (!name) continue
        const extra: Record<string, string> = {}
        for (const e of def.extras) {
          const v = tagValue(b, e)
          if (v !== null) extra[e] = v
        }
        entries.push({
          listId: tagValue(b, 'ListID') ?? '',
          editSequence: tagValue(b, 'EditSequence') ?? '',
          name,
          isActive: (tagValue(b, 'IsActive') ?? 'true') !== 'false',
          extra
        })
      }
      return found.length
    },
    diag
  )

  return { entries, diagnostic: diag }
}

// ── 1099 readiness ───────────────────────────────────────────────────────────

/** The federal reporting threshold. Surfaced so the UI can explain the number. */
export const THRESHOLD_1099 = 600

export interface Vendor1099Row {
  vendor: string
  listId: string
  paid: number
  eligible: boolean
  hasTaxId: boolean
  /** Problems that would stop a 1099 being filed for this vendor. */
  issues: string[]
}

/**
 * Which vendors are over threshold, and what is missing before you could file.
 *
 * Payments are totalled from bills, checks and card charges rather than read
 * off a QuickBooks field, because the 1099 total QuickBooks itself reports
 * depends on account mapping the SDK cannot see.  Treat this as a readiness
 * check — "these vendors need attention" — not as the filing figure.
 */
export function find1099Issues(vendors: ListEntry[], txns: ScannedTxn[]): Vendor1099Row[] {
  const PAY_TYPES = new Set(['Bill', 'Check', 'Credit Card Charge', 'Bill Payment'])

  const paid = new Map<string, number>()
  for (const t of txns) {
    if (!t.entity || !PAY_TYPES.has(t.type)) continue
    paid.set(t.entity, (paid.get(t.entity) ?? 0) + Math.abs(t.amount))
  }

  const rows: Vendor1099Row[] = []
  for (const v of vendors) {
    const total = paid.get(v.name) ?? 0
    const eligible = v.extra['IsVendorEligibleFor1099'] === 'true'
    const hasTaxId = Boolean(v.extra['VendorTaxIdent']?.trim())

    // Under threshold and not flagged is the normal, uninteresting case.
    if (total < THRESHOLD_1099 && !eligible) continue

    const issues: string[] = []
    if (total >= THRESHOLD_1099 && !eligible) {
      issues.push('Paid over threshold but not marked 1099-eligible')
    }
    if (eligible && !hasTaxId) issues.push('Marked 1099-eligible but has no tax ID')
    if (eligible && total > 0 && total < THRESHOLD_1099) {
      issues.push('Marked eligible but under threshold — may not need a form')
    }
    if (!v.isActive && total >= THRESHOLD_1099) issues.push('Inactive vendor with reportable payments')

    if (!issues.length) continue

    rows.push({ vendor: v.name, listId: v.listId, paid: total, eligible, hasTaxId, issues })
  }

  return rows.sort((a, b) => b.paid - a.paid)
}

// ── Duplicate detection ──────────────────────────────────────────────────────

export interface DuplicateGroup {
  key: string
  entity: string
  amount: number
  transactions: ScannedTxn[]
}

/**
 * Transactions that look like the same thing entered twice.
 *
 * The signature is payee + amount + type; dates are compared with a tolerance
 * because the common real-world duplicate is the same bill entered on two
 * days, not at the same instant.  A shared reference number is treated as
 * strong corroboration, and an explicitly *different* reference number is
 * treated as evidence they are genuinely distinct — two identical invoices
 * with different numbers usually are.
 */
export function findDuplicates(txns: ScannedTxn[], dayTolerance = 5): DuplicateGroup[] {
  const buckets = new Map<string, ScannedTxn[]>()

  for (const t of txns) {
    if (!t.amount) continue
    const key = `${t.type}|${t.entity.toLowerCase()}|${t.amount.toFixed(2)}`
    const list = buckets.get(key)
    if (list) list.push(t)
    else buckets.set(key, [t])
  }

  const groups: DuplicateGroup[] = []

  for (const [key, list] of buckets) {
    if (list.length < 2) continue

    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))

    // Walk the sorted run and cut a new cluster whenever the gap exceeds the
    // tolerance, so a monthly recurring bill does not collapse into one group.
    let cluster: ScannedTxn[] = [sorted[0]]
    const flush = (): void => {
      if (cluster.length < 2) return

      const refs = cluster.map((c) => c.refNumber).filter(Boolean)
      const distinct = new Set(refs)
      // Every member carries a reference number and they all differ: separate
      // documents, not a double entry.
      if (refs.length === cluster.length && distinct.size === cluster.length) return

      groups.push({
        key,
        entity: cluster[0].entity,
        amount: cluster[0].amount,
        transactions: [...cluster]
      })
    }

    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(sorted[i - 1].date, sorted[i].date)
      if (gap > dayTolerance) {
        flush()
        cluster = [sorted[i]]
      } else {
        cluster.push(sorted[i])
      }
    }
    flush()
  }

  return groups.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY
  return Math.abs(tb - ta) / 86_400_000
}

// ── Uncategorized sweep ──────────────────────────────────────────────────────

/** Accounts QuickBooks creates for "I don't know where this goes". */
const LIMBO_PATTERNS = [
  /uncategorized\s+(income|expense|asset)/i,
  /ask\s+my\s+accountant/i,
  /^suspense/i,
  /unapplied/i,
  /misc(ellaneous)?\s+expense/i
]

export interface UncategorizedRow {
  txn: ScannedTxn
  account: string
}

/**
 * Transactions parked in a limbo account.
 *
 * These are exactly the rows the Ledger pipeline's payee-history engine can
 * usually code automatically, which is why the UI offers to hand them to it.
 */
export function findUncategorized(txns: ScannedTxn[], accounts: ListEntry[]): UncategorizedRow[] {
  const limbo = new Set(
    accounts.filter((a) => LIMBO_PATTERNS.some((p) => p.test(a.name))).map((a) => a.name)
  )
  // Some files have no such account at all, but a transaction can still name one
  // that was since renamed, so also test the names on the transactions.
  const rows: UncategorizedRow[] = []

  for (const t of txns) {
    for (const acc of t.accounts) {
      if (limbo.has(acc) || LIMBO_PATTERNS.some((p) => p.test(acc))) {
        rows.push({ txn: t, account: acc })
        break
      }
    }
  }

  return rows.sort((a, b) => b.txn.date.localeCompare(a.txn.date))
}

// ── Dead list items ──────────────────────────────────────────────────────────

export interface DeadListRow {
  kind: string
  name: string
  listId: string
  isActive: boolean
  detail: string
}

/**
 * List entries no transaction in the scanned range refers to.
 *
 * Scoped honestly: this can only prove "unused within what we scanned".  A
 * date-limited scan will flag accounts that were busy years ago, so the UI
 * runs this against the whole file by default and says so.
 */
export function findDeadListItems(
  lists: { kind: string; entries: ListEntry[] }[],
  txns: ScannedTxn[]
): DeadListRow[] {
  const usedAccounts = new Set<string>()
  const usedEntities = new Set<string>()

  for (const t of txns) {
    for (const a of t.accounts) usedAccounts.add(a)
    if (t.entity) usedEntities.add(t.entity)
  }

  const rows: DeadListRow[] = []

  for (const { kind, entries } of lists) {
    for (const e of entries) {
      const used = kind === 'Account' ? usedAccounts.has(e.name) : usedEntities.has(e.name)
      if (used) continue

      // A non-zero balance means the entry is load-bearing even with no
      // transaction in range — never suggest touching those.
      const balance = money(e.extra['TotalBalance'] ?? e.extra['Balance'])
      if (balance !== 0) continue

      rows.push({
        kind,
        name: e.name,
        listId: e.listId,
        isActive: e.isActive,
        detail:
          kind === 'Account'
            ? (e.extra['AccountType'] ?? '')
            : e.isActive
              ? 'Active, never used'
              : 'Already inactive'
      })
    }
  }

  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
}

// ── Deleted-transaction audit ────────────────────────────────────────────────

export interface DeletedRow {
  kind: 'Transaction' | 'List entry'
  type: string
  txnId: string
  refNumber: string
  name: string
  timeDeleted: string
  timeCreated: string
}

/** Every transaction type TxnDeletedQuery accepts, as one request per call. */
const DELETED_TXN_TYPES = [
  'Bill',
  'BillPaymentCheck',
  'Check',
  'CreditCardCharge',
  'CreditCardCredit',
  'CreditMemo',
  'Deposit',
  'Estimate',
  'Invoice',
  'JournalEntry',
  'PurchaseOrder',
  'ReceivePayment',
  'SalesReceipt',
  'Transfer',
  'VendorCredit'
]

const DELETED_LIST_TYPES = ['Account', 'Customer', 'Vendor', 'Item', 'Class', 'Employee']

/**
 * What has been deleted recently.
 *
 * Two caveats worth surfacing in the UI rather than hiding: QuickBooks only
 * retains this for a limited window (about 90 days), and these queries are not
 * iterator-capable, so there is no pagination to do — you get what QuickBooks
 * keeps or nothing.
 */
export async function fetchDeleted(
  send: QBSender,
  opts: { from?: string; to?: string } = {}
): Promise<{ rows: DeletedRow[]; diagnostics: ScanDiagnostic[] }> {
  const rows: DeletedRow[] = []
  const diagnostics: ScanDiagnostic[] = []

  const range =
    opts.from || opts.to
      ? `<DeletedDateRangeFilter>${
          opts.from ? `<FromDeletedDate>${escapeXML(opts.from)}</FromDeletedDate>` : ''
        }${opts.to ? `<ToDeletedDate>${escapeXML(opts.to)}</ToDeletedDate>` : ''}</DeletedDateRangeFilter>`
      : ''

  const run = async (
    rq: string,
    typeEl: string,
    type: string,
    ret: string,
    kind: DeletedRow['kind']
  ): Promise<void> => {
    const diag = newDiagnostic(rq)
    const xml = envelope(
      `<${rq} requestID="del_${type}"><${typeEl}>${type}</${typeEl}>${range}</${rq}>`
    )

    try {
      const resp = await send(xml)
      const status = readStatus(resp, rq)
      diag.statusCode = status.code
      diag.statusSeverity = status.severity
      diag.statusMessage = status.message

      if (status.severity !== 'Error') {
        const found = blocks(resp, ret)
        diag.records = found.length
        diag.pages = 1
        for (const b of found) {
          rows.push({
            kind,
            type,
            txnId: tagValue(b, 'TxnID') ?? tagValue(b, 'ListID') ?? '',
            refNumber: tagValue(b, 'RefNumber') ?? '',
            name: tagValue(b, 'FullName') ?? tagValue(b, 'Name') ?? '',
            timeDeleted: tagValue(b, 'TimeDeleted') ?? '',
            timeCreated: tagValue(b, 'TimeCreated') ?? ''
          })
        }
      }
    } catch (err: unknown) {
      diag.error = err instanceof Error ? err.message : String(err)
      diag.statusCode = '-1'
      diag.statusSeverity = 'Error'
      diag.statusMessage = diag.error
    }

    // Only keep diagnostics that say something — one per type would bury the UI.
    if (diag.statusSeverity === 'Error' || diag.records > 0) diagnostics.push(diag)
  }

  for (const t of DELETED_TXN_TYPES) {
    await run('TxnDeletedQueryRq', 'TxnDelType', t, 'TxnDeletedRet', 'Transaction')
  }
  for (const t of DELETED_LIST_TYPES) {
    await run('ListDeletedQueryRq', 'ListDelType', t, 'ListDeletedRet', 'List entry')
  }

  rows.sort((a, b) => b.timeDeleted.localeCompare(a.timeDeleted))
  return { rows, diagnostics }
}

// ── Period-close checklist ───────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface CloseCheck {
  id: string
  label: string
  status: CheckStatus
  /** What was found, in the user's terms. */
  detail: string
  /** How many items are implicated, for the badge. */
  count: number
}

/**
 * The standard pre-close tests, run as one pass.
 *
 * Each check is deliberately conservative about calling something a failure:
 * an accountant who is told five things are broken and finds three of them
 * fine stops reading the list.
 */
export function runCloseChecks(
  txns: ScannedTxn[],
  accounts: ListEntry[],
  uncategorized: UncategorizedRow[],
  duplicates: DuplicateGroup[]
): CloseCheck[] {
  const checks: CloseCheck[] = []

  checks.push({
    id: 'uncategorized',
    label: 'Nothing left uncategorized',
    status: uncategorized.length === 0 ? 'pass' : uncategorized.length > 20 ? 'fail' : 'warn',
    detail:
      uncategorized.length === 0
        ? 'No transactions are sitting in Uncategorized or Ask My Accountant.'
        : `${uncategorized.length} transaction${uncategorized.length === 1 ? ' is' : 's are'} still in a holding account.`,
    count: uncategorized.length
  })

  checks.push({
    id: 'duplicates',
    label: 'No apparent duplicates',
    status: duplicates.length === 0 ? 'pass' : duplicates.length > 5 ? 'fail' : 'warn',
    detail:
      duplicates.length === 0
        ? 'No transactions match another closely enough to look like a double entry.'
        : `${duplicates.length} group${duplicates.length === 1 ? '' : 's'} of possible double entries — review before closing.`,
    count: duplicates.length
  })

  const noPayee = txns.filter((t) => !t.entity && t.type !== 'Journal Entry' && t.amount !== 0)
  checks.push({
    id: 'missing-payee',
    label: 'Every transaction names a payee',
    status: noPayee.length === 0 ? 'pass' : noPayee.length > 25 ? 'fail' : 'warn',
    detail:
      noPayee.length === 0
        ? 'Every transaction in range has a payee or customer.'
        : `${noPayee.length} transaction${noPayee.length === 1 ? ' has' : 's have'} no payee, which will leave them off vendor reports and 1099 totals.`,
    count: noPayee.length
  })

  const undeposited = accounts.filter((a) => /undeposited\s+funds/i.test(a.name))
  const undepositedBalance = undeposited.reduce(
    (sum, a) => sum + money(a.extra['TotalBalance'] ?? a.extra['Balance']),
    0
  )
  checks.push({
    id: 'undeposited',
    label: 'Undeposited Funds is clear',
    status: undepositedBalance === 0 ? 'pass' : 'warn',
    detail:
      undeposited.length === 0
        ? 'This file has no Undeposited Funds account.'
        : undepositedBalance === 0
          ? 'Undeposited Funds is at zero.'
          : `${formatMoney(undepositedBalance)} is sitting in Undeposited Funds — payments received but never deposited.`,
    count: undepositedBalance === 0 ? 0 : 1
  })

  const noMemo = txns.filter((t) => t.type === 'Journal Entry' && !t.memo)
  checks.push({
    id: 'je-memo',
    label: 'Journal entries are explained',
    status: noMemo.length === 0 ? 'pass' : 'warn',
    detail:
      noMemo.length === 0
        ? 'Every journal entry in range carries a memo.'
        : `${noMemo.length} journal entr${noMemo.length === 1 ? 'y has' : 'ies have'} no memo — the reviewer will not know why they exist.`,
    count: noMemo.length
  })

  const future = txns.filter((t) => t.date > new Date().toISOString().slice(0, 10))
  checks.push({
    id: 'future-dated',
    label: 'Nothing is dated in the future',
    status: future.length === 0 ? 'pass' : 'warn',
    detail:
      future.length === 0
        ? 'No transaction in range is dated after today.'
        : `${future.length} transaction${future.length === 1 ? ' is' : 's are'} dated in the future, which usually means a typo in the year.`,
    count: future.length
  })

  return checks
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
