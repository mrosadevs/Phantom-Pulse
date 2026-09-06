/**
 * Shared qbXML query plumbing.
 *
 * entityHistory.ts learned three lessons the hard way, and every feature that
 * scans a company file needs all three.  Rather than have each one rediscover
 * them, they live here:
 *
 *  1. **Always paginate with real iterators.**  <MaxReturned>500</MaxReturned>
 *     without an iterator does not mean "the 500 most relevant" — it means the
 *     FIRST 500, and the recent transactions worth analysing fall off the end.
 *
 *  2. **qbXML reports failure INSIDE a 200-equivalent response.**  The transport
 *     resolves normally and the status lives on the *Rs element, so a rejected
 *     request is indistinguishable from an empty company file unless you read
 *     it.  Silently treating one as the other is how a scan reports "nothing
 *     found" on a file that is full of problems.
 *
 *  3. **Query types disagree about which elements are legal.**  A few reject
 *     elements their siblings accept (IncludeLineItems, date filters).  Losing
 *     a whole transaction type to one bad element is worse than running without
 *     it, so bodies are tried in order and the survivor is reported.
 *
 * Everything here is read-only.  Write paths live in bulk.ts, which uses the
 * envelope and status readers below but never the paginator.
 */

export type QBSender = (xml: string) => Promise<string>

export const QBXML_VERSION = '13.0'
const PAGE_SIZE = 500
const MAX_PAGES = 60

export function envelope(inner: string, version = QBXML_VERSION): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<?qbxml version="${version}"?>\n` +
    `<QBXML><QBXMLMsgsRq onError="continueOnError">${inner}</QBXMLMsgsRq></QBXML>`
  )
}

export function escapeXML(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function decodeXML(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export interface QBStatusLine {
  code: string
  severity: string
  message: string
}

/**
 * Read the status off the *Rs element.
 * A missing response element is itself a failure — QuickBooks rejected the
 * request before it produced one.
 */
export function readStatus(xml: string, rq: string): QBStatusLine {
  const rs = rq.replace(/Rq$/, 'Rs')
  const tag = xml.match(new RegExp(`<${rs}\\b[^>]*>`))?.[0]
  if (!tag) {
    return { code: '-1', severity: 'Error', message: `QuickBooks returned no <${rs}>` }
  }
  return {
    code: tag.match(/statusCode="([^"]*)"/)?.[1] ?? '0',
    severity: tag.match(/statusSeverity="([^"]*)"/)?.[1] ?? 'Info',
    message: decodeXML(tag.match(/statusMessage="([^"]*)"/)?.[1] ?? 'Status OK')
  }
}

export interface ScanDiagnostic {
  /** The qbXML request, e.g. "BillQueryRq". */
  query: string
  statusCode: string
  statusSeverity: string
  statusMessage: string
  pages: number
  /** Records read across all pages. */
  records: number
  /** True when MAX_PAGES stopped us before QuickBooks ran out. */
  truncated: boolean
  /** Which body variant succeeded; >0 means a fallback kicked in. */
  variant: number
  /** Transport failure, as opposed to a qbXML status error. */
  error?: string
}

export function newDiagnostic(query: string): ScanDiagnostic {
  return {
    query,
    statusCode: '0',
    statusSeverity: 'Info',
    statusMessage: '',
    pages: 0,
    records: 0,
    truncated: false,
    variant: 0
  }
}

/**
 * Run a query to exhaustion using qbXML iterators.
 *
 * `bodyVariants` are tried in order, but only ever swapped when page 0 fails —
 * once records have been handed to `onPage`, retrying a different body would
 * double-count them.
 */
export async function runPaged(
  send: QBSender,
  rq: string,
  bodyVariants: string[],
  onPage: (xml: string) => number,
  diag: ScanDiagnostic,
  version = QBXML_VERSION
): Promise<void> {
  const variants = bodyVariants.filter((b, i) => bodyVariants.indexOf(b) === i)

  for (let v = 0; v < variants.length; v++) {
    let iteratorID: string | null = null
    let failedOnFirstPage = false

    diag.variant = v
    diag.pages = 0
    diag.records = 0
    diag.truncated = false
    diag.error = undefined

    for (let page = 0; page < MAX_PAGES; page++) {
      const attrs =
        page === 0 ? ' iterator="Start"' : ` iterator="Continue" iteratorID="${iteratorID}"`
      // MaxReturned comes FIRST in every *QueryRq sequence — ahead of the date
      // and entity filters, and well ahead of IncludeLineItems.  qbXML rejects
      // the whole request on an out-of-order element, so it is prepended here
      // rather than left to each caller to remember.
      const xml = envelope(
        `<${rq} requestID="scan_${page}"${attrs}><MaxReturned>${PAGE_SIZE}</MaxReturned>${variants[v]}</${rq}>`,
        version
      )

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

      diag.records += onPage(resp)
      diag.pages = page + 1

      const remaining = Number(resp.match(/iteratorRemainingCount="(\d+)"/)?.[1] ?? '0')
      iteratorID = resp.match(/iteratorID="([^"]+)"/)?.[1] ?? null
      if (remaining <= 0 || !iteratorID) return
      if (page === MAX_PAGES - 1) diag.truncated = true
    }

    if (!failedOnFirstPage) return
  }
}

// ── XML readers ──────────────────────────────────────────────────────────────

/** All complete <tag>…</tag> blocks, non-greedy so siblings stay separate. */
export function blocks(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'g')) ?? []
}

/** A single child element's text. */
export function tagValue(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`))
  return m ? decodeXML(m[1]).trim() : null
}

/**
 * FullName out of a <XxxRef> wrapper.
 *
 * Scoped to the wrapper so the ListID that precedes it, and any FullName
 * belonging to a different Ref later in the block, cannot be picked up.
 */
export function refFullName(xml: string, tag: string): string | null {
  const ref = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  if (!ref) return null
  const name = ref[1].match(/<FullName>([^<]+)<\/FullName>/)?.[1]
  return name ? decodeXML(name).trim() : null
}

/**
 * A list element's own name.
 *
 * Everything before the first <XxxRef> belongs to the record itself, which
 * keeps a job's "Customer:Job" from being overwritten by its ParentRef.
 * VendorRet has no <FullName> — vendors are a flat list — so fall back to
 * <Name>, or the vendor list comes back empty.
 */
export function ownFullName(block: string): string | null {
  const head = block.split(/<\w+Ref>/)[0]
  const full = head.match(/<FullName>([^<]+)<\/FullName>/)?.[1]
  if (full) return decodeXML(full).trim()
  const name = head.match(/<Name>([^<]+)<\/Name>/)?.[1]
  return name ? decodeXML(name).trim() : null
}

/** Parse a QuickBooks amount, which may be negative or absent. */
export function money(value: string | null | undefined): number {
  if (!value) return 0
  const n = Number(String(value).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}
