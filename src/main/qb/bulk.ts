/**
 * Bulk write operations.
 *
 * Everything in this module changes a client's books, so it is written to be
 * boring and predictable rather than clever.  Three rules run through all of it:
 *
 * ## 1. A Mod request that touches lines must send ALL of them
 *
 * This is the footgun that makes naive bulk-edit tools destructive.  If a
 * *ModRq includes some ExpenseLineMod elements but not others, QuickBooks does
 * not merge them — the lines you left out are DELETED.  A tool that reads one
 * line, changes its account, and sends that single line back will silently
 * destroy every other split on the transaction.
 *
 * So `modifyTransaction` re-queries the transaction in full immediately before
 * writing, rebuilds every line it finds, and changes only the field asked for.
 * The extra round trip per transaction is the price of not corrupting splits.
 *
 * ## 2. Item lines are a refusal, not a best effort
 *
 * A transaction carrying item lines needs those rebuilt too, and item lines
 * reference inventory, quantities and prices that this module has no business
 * reconstructing.  Rather than rebuild them approximately, transactions with
 * item lines are skipped and reported as skipped.  A visible "8 skipped, here
 * is why" is a good outcome; a quietly mangled inventory transaction is not.
 *
 * ## 3. EditSequence is a concurrency check, and it must be fresh
 *
 * QuickBooks rejects a Mod whose EditSequence does not match the current
 * record.  That is a feature: it means someone editing the transaction in
 * QuickBooks while a batch runs causes a clean failure rather than a silent
 * overwrite.  The value is always taken from the fresh re-query, never from a
 * scan that may be minutes old.
 */

import {
  type QBSender,
  blocks,
  decodeXML,
  escapeXML,
  envelope,
  readStatus,
  tagValue
} from './query'

export interface BulkResult {
  txnId: string
  /** Display label so the UI can report failures without a second lookup. */
  label: string
  status: 'ok' | 'failed' | 'skipped'
  message?: string
}

export interface BulkProgress {
  done: number
  total: number
  current: string
}

// ── Type table ───────────────────────────────────────────────────────────────

interface TypeDef {
  queryRq: string
  ret: string
  modRq: string
  mod: string
  /** TxnVoidType value; absent when QuickBooks cannot void this type. */
  voidType?: string
  /**
   * Header elements to carry across a Mod, IN SCHEMA ORDER.
   * qbXML rejects the whole request on an out-of-order element, and the order
   * differs per type, so this is a per-type list rather than a shared one.
   */
  header: { tag: string; ref?: boolean }[]
}

const TYPES: Record<string, TypeDef> = {
  Check: {
    queryRq: 'CheckQueryRq',
    ret: 'CheckRet',
    modRq: 'CheckModRq',
    mod: 'CheckMod',
    voidType: 'Check',
    header: [
      { tag: 'AccountRef', ref: true },
      { tag: 'PayeeEntityRef', ref: true },
      { tag: 'RefNumber' },
      { tag: 'TxnDate' },
      { tag: 'Memo' }
    ]
  },
  Bill: {
    queryRq: 'BillQueryRq',
    ret: 'BillRet',
    modRq: 'BillModRq',
    mod: 'BillMod',
    voidType: 'Bill',
    header: [
      { tag: 'VendorRef', ref: true },
      { tag: 'APAccountRef', ref: true },
      { tag: 'TxnDate' },
      { tag: 'DueDate' },
      { tag: 'RefNumber' },
      { tag: 'TermsRef', ref: true },
      { tag: 'Memo' }
    ]
  },
  'Credit Card Charge': {
    queryRq: 'CreditCardChargeQueryRq',
    ret: 'CreditCardChargeRet',
    modRq: 'CreditCardChargeModRq',
    mod: 'CreditCardChargeMod',
    voidType: 'CreditCardCharge',
    header: [
      { tag: 'AccountRef', ref: true },
      { tag: 'PayeeEntityRef', ref: true },
      { tag: 'TxnDate' },
      { tag: 'RefNumber' },
      { tag: 'Memo' }
    ]
  },
  'Credit Card Credit': {
    queryRq: 'CreditCardCreditQueryRq',
    ret: 'CreditCardCreditRet',
    modRq: 'CreditCardCreditModRq',
    mod: 'CreditCardCreditMod',
    voidType: 'CreditCardCredit',
    header: [
      { tag: 'AccountRef', ref: true },
      { tag: 'PayeeEntityRef', ref: true },
      { tag: 'TxnDate' },
      { tag: 'RefNumber' },
      { tag: 'Memo' }
    ]
  },
  'Vendor Credit': {
    queryRq: 'VendorCreditQueryRq',
    ret: 'VendorCreditRet',
    modRq: 'VendorCreditModRq',
    mod: 'VendorCreditMod',
    voidType: 'VendorCredit',
    header: [
      { tag: 'VendorRef', ref: true },
      { tag: 'APAccountRef', ref: true },
      { tag: 'TxnDate' },
      { tag: 'RefNumber' },
      { tag: 'Memo' }
    ]
  }
}

export function canModify(type: string): boolean {
  return type in TYPES
}

export function modifiableTypes(): string[] {
  return Object.keys(TYPES)
}

// ── Fresh fetch ──────────────────────────────────────────────────────────────

interface ExpenseLine {
  txnLineID: string
  account: string
  amount: string
  memo: string
  customer: string
  klass: string
  billable: string
}

interface FreshTxn {
  txnId: string
  editSequence: string
  header: Record<string, string>
  expenseLines: ExpenseLine[]
  hasItemLines: boolean
}

function refName(block: string, tag: string): string {
  const ref = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  if (!ref) return ''
  const n = ref[1].match(/<FullName>([^<]+)<\/FullName>/)?.[1]
  return n ? decodeXML(n).trim() : ''
}

/**
 * Re-read one transaction, with lines, immediately before modifying it.
 *
 * Never reuse a scan for this: see rule 3 in the module note.
 */
async function fetchFresh(send: QBSender, type: string, txnId: string): Promise<FreshTxn | null> {
  const def = TYPES[type]
  if (!def) return null

  const xml = envelope(
    `<${def.queryRq} requestID="fresh"><TxnID>${escapeXML(txnId)}</TxnID>` +
      `<IncludeLineItems>true</IncludeLineItems></${def.queryRq}>`
  )

  const resp = await send(xml)
  if (readStatus(resp, def.queryRq).severity === 'Error') return null

  const block = blocks(resp, def.ret)[0]
  if (!block) return null

  const header: Record<string, string> = {}
  for (const h of def.header) {
    const value = h.ref ? refName(block, h.tag) : (tagValue(block, h.tag) ?? '')
    if (value) header[h.tag] = value
  }

  const expenseLines: ExpenseLine[] = blocks(block, 'ExpenseLineRet').map((l) => ({
    txnLineID: tagValue(l, 'TxnLineID') ?? '',
    account: refName(l, 'AccountRef'),
    amount: tagValue(l, 'Amount') ?? '',
    memo: tagValue(l, 'Memo') ?? '',
    customer: refName(l, 'CustomerRef'),
    klass: refName(l, 'ClassRef'),
    billable: tagValue(l, 'BillableStatus') ?? ''
  }))

  return {
    txnId,
    editSequence: tagValue(block, 'EditSequence') ?? '',
    header,
    expenseLines,
    hasItemLines: blocks(block, 'ItemLineRet').length > 0
  }
}

// ── Mod building ─────────────────────────────────────────────────────────────

function el(tag: string, value: string): string {
  return value ? `<${tag}>${escapeXML(value)}</${tag}>` : ''
}

function elRef(tag: string, fullName: string): string {
  return fullName ? `<${tag}><FullName>${escapeXML(fullName)}</FullName></${tag}>` : ''
}

/**
 * Rebuild every expense line.
 *
 * Element order inside ExpenseLineMod is fixed by the schema, and TxnLineID
 * must lead — it is how QuickBooks matches this to the existing line rather
 * than treating it as an insert.
 */
function buildExpenseLines(lines: ExpenseLine[]): string {
  return lines
    .map(
      (l) =>
        `<ExpenseLineMod>` +
        el('TxnLineID', l.txnLineID) +
        elRef('AccountRef', l.account) +
        el('Amount', l.amount) +
        el('Memo', l.memo) +
        elRef('CustomerRef', l.customer) +
        elRef('ClassRef', l.klass) +
        el('BillableStatus', l.billable) +
        `</ExpenseLineMod>`
    )
    .join('')
}

export interface ModifyChange {
  /** Move lines currently coded here… */
  fromAccount?: string
  /** …to here. Both required to reclassify. */
  toAccount?: string
  /** Replace the header memo. */
  memo?: string
  /** Append to the header memo instead of replacing it. */
  appendMemo?: string
  /** Move every line, regardless of its current account. */
  allLines?: boolean
}

/**
 * Apply one change to one transaction, preserving everything else.
 *
 * Returns a `skipped` result rather than a failure when there is nothing to do
 * or the transaction is not safe to touch — the caller reports those separately
 * so a batch of 200 does not look like it half-failed.
 */
export async function modifyTransaction(
  send: QBSender,
  type: string,
  txnId: string,
  label: string,
  change: ModifyChange
): Promise<BulkResult> {
  const def = TYPES[type]
  if (!def) {
    return { txnId, label, status: 'skipped', message: `Pulse cannot modify a ${type} yet.` }
  }

  let fresh: FreshTxn | null
  try {
    fresh = await fetchFresh(send, type, txnId)
  } catch (err: unknown) {
    return {
      txnId,
      label,
      status: 'failed',
      message: err instanceof Error ? err.message : String(err)
    }
  }

  if (!fresh) {
    return { txnId, label, status: 'failed', message: 'QuickBooks no longer has this transaction.' }
  }

  // Rule 2: item lines would have to be rebuilt too, and rebuilding them
  // approximately is worse than declining.
  if (fresh.hasItemLines) {
    return {
      txnId,
      label,
      status: 'skipped',
      message: 'Has item lines — edit this one in QuickBooks so quantities and prices stay intact.'
    }
  }

  const lines = fresh.expenseLines.map((l) => ({ ...l }))
  let touched = false

  if (change.toAccount) {
    for (const l of lines) {
      const matches = change.allLines || (change.fromAccount && l.account === change.fromAccount)
      if (matches && l.account !== change.toAccount) {
        l.account = change.toAccount
        touched = true
      }
    }
  }

  const header = { ...fresh.header }
  if (change.memo !== undefined) {
    header['Memo'] = change.memo
    touched = true
  } else if (change.appendMemo) {
    const existing = header['Memo'] ?? ''
    // Don't stamp the same marker twice if a batch is re-run.
    if (!existing.includes(change.appendMemo)) {
      header['Memo'] = existing ? `${existing} ${change.appendMemo}` : change.appendMemo
      touched = true
    }
  }

  if (!touched) {
    return { txnId, label, status: 'skipped', message: 'Already as requested — nothing to change.' }
  }

  const headerXML = def.header
    .map((h) => {
      const value = header[h.tag] ?? ''
      return h.ref ? elRef(h.tag, value) : el(h.tag, value)
    })
    .join('')

  const body =
    `<${def.mod}>` +
    el('TxnID', fresh.txnId) +
    el('EditSequence', fresh.editSequence) +
    headerXML +
    buildExpenseLines(lines) +
    `</${def.mod}>`

  const xml = envelope(`<${def.modRq} requestID="mod_${txnId}">${body}</${def.modRq}>`)

  try {
    const resp = await send(xml)
    const status = readStatus(resp, def.modRq)
    if (status.severity === 'Error') {
      return { txnId, label, status: 'failed', message: `QB ${status.code}: ${status.message}` }
    }
    return { txnId, label, status: 'ok' }
  } catch (err: unknown) {
    return {
      txnId,
      label,
      status: 'failed',
      message: err instanceof Error ? err.message : String(err)
    }
  }
}

// ── Void ─────────────────────────────────────────────────────────────────────

/**
 * Void, which is not delete.
 *
 * Voiding zeroes the amounts and leaves the transaction in place; deleting
 * removes it entirely.  Most accountants want the former for anything in a
 * reported period, because the audit trail survives — which is why this lives
 * apart from the existing delete path rather than being an option on it.
 */
export async function voidTransaction(
  send: QBSender,
  type: string,
  txnId: string,
  label: string
): Promise<BulkResult> {
  const voidType = TYPES[type]?.voidType
  if (!voidType) {
    return { txnId, label, status: 'skipped', message: `QuickBooks cannot void a ${type}.` }
  }

  const xml = envelope(
    `<TxnVoidRq requestID="void_${txnId}">` +
      `<TxnVoidType>${voidType}</TxnVoidType>` +
      `<TxnID>${escapeXML(txnId)}</TxnID>` +
      `</TxnVoidRq>`
  )

  try {
    const resp = await send(xml)
    const status = readStatus(resp, 'TxnVoidRq')
    if (status.severity === 'Error') {
      return { txnId, label, status: 'failed', message: `QB ${status.code}: ${status.message}` }
    }
    return { txnId, label, status: 'ok' }
  } catch (err: unknown) {
    return {
      txnId,
      label,
      status: 'failed',
      message: err instanceof Error ? err.message : String(err)
    }
  }
}

// ── Custom fields (DataExt) ──────────────────────────────────────────────────

/**
 * Stamp a QuickBooks custom field.
 *
 * The safest write in this module, and the most useful: DataExt touches only
 * the named field, never the transaction's lines, so none of rule 1 applies.
 * That makes it the right place to record where a batch came from — an import
 * batch id, a source statement, "coded automatically, review me" — metadata
 * that then rides along inside the company file and is visible in QuickBooks
 * long after Pulse has closed.
 *
 * The field must already exist in QuickBooks (Lists → Custom Fields); the SDK
 * can write one but cannot create the definition, which is why a missing field
 * is reported as a clear instruction rather than an error code.
 */
export async function stampCustomField(
  send: QBSender,
  opts: {
    /** Transaction type as QuickBooks names it, e.g. Check, Bill. */
    txnType: string
    txnId: string
    label: string
    fieldName: string
    value: string
  }
): Promise<BulkResult> {
  const { txnId, label, fieldName, value } = opts
  const voidType = TYPES[opts.txnType]?.voidType ?? opts.txnType.replace(/\s+/g, '')

  // DataExtMod updates an existing value; DataExtAdd creates the first one.
  // Which is needed depends on whether the field has ever been set on this
  // record, and asking is another round trip — so try Mod, fall back to Add.
  const common =
    `<OwnerID>0</OwnerID>` +
    `<DataExtName>${escapeXML(fieldName)}</DataExtName>` +
    `<TxnDataExtType>${escapeXML(voidType)}</TxnDataExtType>` +
    `<TxnID>${escapeXML(txnId)}</TxnID>` +
    `<DataExtValue>${escapeXML(value)}</DataExtValue>`

  const attempt = async (verb: 'Mod' | 'Add'): Promise<{ ok: boolean; message: string }> => {
    const rq = `DataExt${verb}Rq`
    const xml = envelope(
      `<${rq} requestID="ext_${verb}_${txnId}"><DataExt${verb}>${common}</DataExt${verb}></${rq}>`
    )
    const resp = await send(xml)
    const status = readStatus(resp, rq)
    return { ok: status.severity !== 'Error', message: `QB ${status.code}: ${status.message}` }
  }

  try {
    const mod = await attempt('Mod')
    if (mod.ok) return { txnId, label, status: 'ok' }

    const add = await attempt('Add')
    if (add.ok) return { txnId, label, status: 'ok' }

    // 3180/500 here almost always means the custom field does not exist yet.
    const hint = /not found|does not exist|3180|invalid/i.test(add.message)
      ? `Create the custom field "${fieldName}" in QuickBooks first: Lists → Custom Fields.`
      : add.message

    return { txnId, label, status: 'failed', message: hint }
  } catch (err: unknown) {
    return {
      txnId,
      label,
      status: 'failed',
      message: err instanceof Error ? err.message : String(err)
    }
  }
}

// ── Batch runner ─────────────────────────────────────────────────────────────

export interface BatchSummary {
  results: BulkResult[]
  ok: number
  failed: number
  skipped: number
}

/**
 * Run one operation across many transactions, sequentially.
 *
 * Sequential on purpose: the QuickBooks SDK is a single COM session and
 * parallel requests do not make it faster, they make it fail.  The small pause
 * between writes mirrors the existing import path, which found QuickBooks
 * unhappy without it.
 */
export async function runBatch(
  items: { type: string; txnId: string; label: string }[],
  op: (item: { type: string; txnId: string; label: string }) => Promise<BulkResult>,
  onProgress?: (p: BulkProgress) => void
): Promise<BatchSummary> {
  const results: BulkResult[] = []

  for (let i = 0; i < items.length; i++) {
    onProgress?.({ done: i, total: items.length, current: items[i].label })
    results.push(await op(items[i]))
    await new Promise((r) => setTimeout(r, 50))
  }

  onProgress?.({ done: items.length, total: items.length, current: '' })

  return {
    results,
    ok: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length
  }
}
