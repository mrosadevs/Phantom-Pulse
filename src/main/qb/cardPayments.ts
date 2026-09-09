/**
 * Credit card payment duplicate detection.
 *
 * ## The problem
 *
 * A payment to a credit card exists on two statements at once.  The bank
 * statement shows money leaving checking; the card statement shows the balance
 * coming down.  They are one event, and QuickBooks only wants it once.
 *
 * Which side it was entered from varies by client and by month.  Sometimes the
 * bank statement was imported first and the payment is already sitting in the
 * card account as a Check or a Transfer; sometimes it was paid from an account
 * that is not on the books at all and the card statement is the only record of
 * it.  Uploading the card side blind double-counts the first case; skipping it
 * blind loses the second.  Neither can be assumed, so this module answers the
 * only question that settles it: **is this payment already in the company
 * file?**
 *
 * ## What counts as "already there"
 *
 * Anything that touches the credit card account for the same amount within a
 * few days.  Deliberately not "a Check drawn on a bank account", because the
 * same payment is legitimately recorded as any of:
 *
 *   - a Check written on checking and coded to the card account
 *   - a Transfer from checking to the card
 *   - a Journal Entry crediting the card
 *   - a Credit Card Credit, if the card statement was already imported once
 *
 * The last one is worth having on its own: it makes re-running an import that
 * died partway safe, which is exactly when someone runs one twice.
 *
 * ## Why this does not use scanTransactions
 *
 * It would have to grow `Transfer` to be useful here — a bank-to-card payment
 * is a Transfer as often as it is a Check — and `SCAN_TYPES` is shared with the
 * Audit, Hygiene and Bulk Edit screens, which would all silently start
 * reporting a transaction type they have never shown before.  A read this
 * narrow does not justify changing what those screens contain, so it queries
 * for itself and leaves the shared scan alone.
 *
 * Read-only, like everything else built on query.ts.
 */

import {
  type QBSender,
  type ScanDiagnostic,
  blocks,
  decodeXML,
  escapeXML,
  money,
  newDiagnostic,
  runPaged,
  tagValue
} from './query'

/** A row from the statement that is about to be uploaded. */
export interface PaymentRow {
  id: number
  /** ISO YYYY-MM-DD. */
  date: string
  /** As it came off the statement; only the magnitude is compared. */
  amount: number
}

/** A transaction already in the company file that touches the card account. */
export interface ExistingTxn {
  txnId: string
  type: string
  date: string
  refNumber: string
  memo: string
  amount: number
  /**
   * The other account involved — the bank it was paid from, where the
   * transaction names one.  Display only: it is what makes a flagged row
   * readable ("already paid from Chase Checking on 03/14") rather than a bare
   * assertion the operator has to go and verify by hand.
   */
  otherAccount: string
}

export interface PaymentMatch {
  rowId: number
  existing: ExistingTxn
}

export interface PaymentMatchResult {
  matches: PaymentMatch[]
  diagnostics: ScanDiagnostic[]
  /**
   * True when a query failed, so an empty `matches` means "we could not look",
   * not "there is nothing there".  The caller must not present a silent
   * all-clear on the back of a failed read.
   */
  incomplete: boolean
}

/**
 * Every way a credit card account gets paid down.
 *
 * Transfer and Bill Payment reject <IncludeLineItems>, which is why runPaged
 * is given the variant ladder rather than one body — see rule 3 in query.ts.
 */
const PAYMENT_TYPES: { type: string; rq: string; ret: string }[] = [
  { type: 'Check', rq: 'CheckQueryRq', ret: 'CheckRet' },
  { type: 'Transfer', rq: 'TransferQueryRq', ret: 'TransferRet' },
  { type: 'Journal Entry', rq: 'JournalEntryQueryRq', ret: 'JournalEntryRet' },
  { type: 'Credit Card Credit', rq: 'CreditCardCreditQueryRq', ret: 'CreditCardCreditRet' },
  { type: 'Bill Payment', rq: 'BillPaymentCheckQueryRq', ret: 'BillPaymentCheckRet' }
]

/**
 * Every account named anywhere in the block.
 *
 * Matches any element whose name ends in AccountRef, not just <AccountRef>:
 * a Transfer names its two sides TransferFromAccountRef and
 * TransferToAccountRef, so a plain <AccountRef> search finds a bank-to-card
 * transfer to be touching no accounts at all — and the transfer is the single
 * most common way the payment gets recorded.
 */
function accountsIn(block: string): string[] {
  const found = new Set<string>()
  const re = /<([A-Za-z]*AccountRef)>([\s\S]*?)<\/\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) {
    const name = m[2].match(/<FullName>([^<]+)<\/FullName>/)?.[1]
    if (name) found.add(decodeXML(name).trim())
  }
  return [...found]
}

/**
 * Every amount named anywhere in the block.
 *
 * A Check's header Amount is the payment, but a Journal Entry has no header
 * total at all — the figure lives on whichever line credits the card.  Rather
 * than a per-type table of where the number hides, every Amount in the block is
 * a candidate and the match also has to agree on account and date.
 */
function amountsIn(block: string): number[] {
  const out: number[] = []
  const re = /<Amount>([^<]*)<\/Amount>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) {
    const v = Math.abs(money(decodeXML(m[1]).trim()))
    if (v > 0) out.push(v)
  }
  return out
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function daysApart(a: string, b: string): number {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY
  return Math.abs(ta - tb) / 86_400_000
}

/** Shift an ISO date by whole days, staying in ISO. */
function shiftDate(iso: string, days: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10)
}

export interface FindMatchesOptions {
  /** QuickBooks FullName of the credit card account being imported into. */
  account: string
  rows: PaymentRow[]
  /** How far a posting date may drift between the two statements. */
  dayTolerance?: number
}

/**
 * Find, for each row, a transaction already in the file that looks like the
 * same payment.
 *
 * Returns at most one match per row — the closest in date — because the
 * question being answered is "is this already here?", and a second candidate
 * adds nothing to the answer while making the review screen harder to read.
 */
export async function findCardPaymentMatches(
  send: QBSender,
  opts: FindMatchesOptions
): Promise<PaymentMatchResult> {
  const { account, rows } = opts
  const tolerance = opts.dayTolerance ?? 5
  const diagnostics: ScanDiagnostic[] = []

  if (!account || !rows.length) {
    return { matches: [], diagnostics, incomplete: false }
  }

  const dates = rows.map((r) => r.date).filter(Boolean).sort()
  if (!dates.length) return { matches: [], diagnostics, incomplete: false }

  // Widen the window by the tolerance at both ends, or a payment posted three
  // days after the statement closed is outside the range that would match it.
  const from = shiftDate(dates[0], -tolerance)
  const to = shiftDate(dates[dates.length - 1], tolerance)
  const filter =
    `<TxnDateRangeFilter>` +
    `<FromTxnDate>${escapeXML(from)}</FromTxnDate>` +
    `<ToTxnDate>${escapeXML(to)}</ToTxnDate>` +
    `</TxnDateRangeFilter>`

  const candidates: ExistingTxn[] = []

  for (const { type, rq, ret } of PAYMENT_TYPES) {
    const diag = newDiagnostic(rq)

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
        for (const b of found) {
          const accounts = accountsIn(b)
          if (!accounts.some((a) => sameName(a, account))) continue

          const date = tagValue(b, 'TxnDate') ?? ''
          for (const amount of amountsIn(b)) {
            candidates.push({
              txnId: tagValue(b, 'TxnID') ?? '',
              type,
              date,
              refNumber: tagValue(b, 'RefNumber') ?? '',
              memo: tagValue(b, 'Memo') ?? '',
              amount,
              otherAccount: accounts.find((a) => !sameName(a, account)) ?? ''
            })
          }
        }
        return found.length
      },
      diag
    )

    diagnostics.push(diag)
  }

  const incomplete = diagnostics.some((d) => d.statusSeverity === 'Error' || d.truncated)

  // One existing transaction can only account for one row.  Without this, three
  // identical monthly payments all match the same Check and two real payments
  // get withheld on the strength of one.
  const claimed = new Set<string>()
  const matches: PaymentMatch[] = []

  for (const row of rows) {
    const target = Math.abs(row.amount)
    if (!(target > 0) || !row.date) continue

    let best: ExistingTxn | null = null
    let bestGap = Number.POSITIVE_INFINITY

    for (const c of candidates) {
      const key = `${c.txnId}|${c.amount.toFixed(2)}`
      if (claimed.has(key)) continue
      if (Math.abs(c.amount - target) > 0.005) continue

      const gap = daysApart(c.date, row.date)
      if (gap > tolerance) continue
      if (gap < bestGap) {
        best = c
        bestGap = gap
      }
    }

    if (best) {
      claimed.add(`${best.txnId}|${best.amount.toFixed(2)}`)
      matches.push({ rowId: row.id, existing: best })
    }
  }

  return { matches, diagnostics, incomplete }
}
