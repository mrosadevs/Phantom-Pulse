/**
 * Returned items code back to whatever they reversed.
 *
 * ## The problem this exists for
 *
 * When an ACH payment fails, the bank statement carries the event twice: the
 * debit that went out, and a credit a day or two later putting the money back.
 * The two are one non-event, and they have to land on the same account or the
 * books are left holding a payment that never happened.
 *
 * Nothing in the return's own description says where it belongs.
 * "RETURN OF POSTED CHECK / ITEM (RECEIVED ON 06-17)" names no payee and no
 * category, so it categorised as uncategorised and went to Ask My Accountant
 * while the payment it reversed sat in a credit card account.  On one client
 * file three bounced AmEx payments did exactly that: the card was debited
 * $4,124.17 it had never been credited back, and the card would not reconcile
 * against any statement for the rest of the year.
 *
 * ## The rule
 *
 * A returned item reverses the transaction it names.  Find that transaction —
 * same amount, opposite direction, on or just before the date the return says
 * it was received — and give the return the same account and payee.  Then a
 * bounced credit card payment reverses inside the credit card account, a
 * bounced vendor payment reverses against the vendor's expense account, and
 * neither needs a human to work out what the bank meant.
 *
 * Nothing is guessed: with no matching debit in the batch the return is left
 * exactly as it was, for a person to code.
 */

/** Enough of a statement row to match a return to its original. */
export interface ReturnCandidate {
  id: number
  /** ISO YYYY-MM-DD. */
  date: string
  /** Signed as the statement had it: money out is negative. */
  amount: number
  /** The raw description, before cleaning. */
  original: string
  account: string
  payee: string
}

export interface ReturnLink {
  /** The returned-item row. */
  rowId: number
  /** The debit it reverses. */
  sourceRowId: number
  account: string
  payee: string
  /** Shown in the review screen so the decision is visible, not silent. */
  note: string
}

/**
 * A returned item, in the wordings banks actually print.
 *
 * "Return" alone is far too broad — a merchant refund is a return, and a
 * purchase return must not be dragged onto the account of some unrelated debit
 * of the same size.  Each pattern names a returned *instrument*.
 */
const RETURN_PATTERNS: RegExp[] = [
  /\breturn(?:ed)?\s+(?:of\s+)?(?:posted\s+)?(?:check|item|deposit|payment)\b/i,
  /\breturn(?:ed)?\s+item\s+chargeback\b/i,
  /\bnsf\s+(?:return|item|check)\b/i,
  /\bach\s+return\b/i
]

export function isReturnedItem(description: string): boolean {
  return RETURN_PATTERNS.some((re) => re.test(description))
}

/**
 * The date a return says the item was originally received.
 *
 * Banks print it inside the description — "(RECEIVED ON 06-17)" — which is a
 * better anchor than the return's own date, because the gap between the two is
 * whatever the ACH network took.  The year is absent, so it comes from the
 * return's own date, rolling back a year when that would put the original in
 * the future (a return on 01-02 of an item received on 12-30).
 */
export function receivedDate(description: string, returnDate: string): string | null {
  const m = description.match(/received\s+on\s+(\d{1,2})[-/](\d{1,2})/i)
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null

  const year = Number(returnDate.slice(0, 4))
  if (!Number.isFinite(year)) return null

  const iso = (y: number): string =>
    `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  return iso(iso(year) > returnDate ? year - 1 : year)
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY
  return Math.abs(ta - tb) / 86_400_000
}

export interface LinkOptions {
  /**
   * How far back to look when the description does not name a received date.
   * Returns arrive within a few business days; beyond that the match is a
   * coincidence of amount rather than the same event.
   */
  windowDays?: number
}

/**
 * Match every returned item in the batch to the debit it reverses.
 *
 * Only rows already carrying an account can be reversed onto — copying a blank
 * account achieves nothing and would hide the row from the uncategorised
 * filter, which is where a person needs to see it.
 */
export function linkReturnedItems(
  rows: ReturnCandidate[],
  opts: LinkOptions = {}
): ReturnLink[] {
  const windowDays = opts.windowDays ?? 6
  const links: ReturnLink[] = []

  // One debit can only be reversed once: two identical payments that both
  // bounce are two events, and letting both returns claim the same debit would
  // leave the second reversing nothing.
  const claimed = new Set<number>()

  const returns = rows
    .filter((r) => r.amount > 0 && isReturnedItem(r.original))
    .sort((a, b) => a.date.localeCompare(b.date))

  for (const ret of returns) {
    const anchor = receivedDate(ret.original, ret.date) ?? ret.date
    const target = Math.abs(ret.amount)

    let best: ReturnCandidate | null = null
    let bestGap = Number.POSITIVE_INFINITY

    for (const row of rows) {
      if (row.id === ret.id || claimed.has(row.id)) continue
      // The original went the other way, and had to happen first.
      if (!(row.amount < 0)) continue
      if (row.date > ret.date) continue
      if (Math.abs(Math.abs(row.amount) - target) > 0.005) continue
      if (!row.account) continue

      const gap = daysBetween(row.date, anchor)
      if (gap > windowDays) continue
      if (gap < bestGap) {
        best = row
        bestGap = gap
      }
    }

    if (!best) continue

    claimed.add(best.id)
    links.push({
      rowId: ret.id,
      sourceRowId: best.id,
      account: best.account,
      payee: best.payee || ret.payee,
      note: `reverses the ${Math.abs(best.amount).toFixed(2)} payment of ${best.date} — coded back to ${best.account}`
    })
  }

  return links
}
