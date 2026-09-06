/**
 * New-client file setup — copying lists from one company file into another.
 *
 * The SDK holds exactly one company file open at a time, so there is no way to
 * read from A and write to B in a single session.  The flow is therefore two
 * connections with a file in between:
 *
 *   1. Connect to the template file  → capture lists to a .pulse-template.json
 *   2. Connect to the new file       → replay that template into it
 *
 * That intermediate file is a feature rather than a workaround: a firm can keep
 * one reviewed template per client type in version control and stop rebuilding
 * a chart of accounts by hand for every new engagement.
 *
 * ## Order matters
 *
 * Accounts are created parent-first.  QuickBooks stores hierarchy as
 * "Parent:Child" in FullName, and creating "Utilities:Electric" before
 * "Utilities" exists fails — so entries are sorted by depth before replay.
 *
 * ## "Already exists" is a success
 *
 * Replaying a template into a file that has some of it already is the normal
 * case, not an error.  QuickBooks reports 3100 for a duplicate name; that is
 * counted as skipped, and the run continues.
 */

import {
  type QBSender,
  type ScanDiagnostic,
  blocks,
  escapeXML,
  envelope,
  newDiagnostic,
  ownFullName,
  readStatus,
  runPaged,
  tagValue
} from './query'

export interface TemplateEntry {
  name: string
  /** Account type, item type — whatever the list needs to be recreated. */
  type?: string
  description?: string
  accountNumber?: string
}

export interface CompanyTemplate {
  /** Schema marker, so a stale template can be recognised rather than misread. */
  format: 'phantom-pulse-template@1'
  createdAt: string
  sourceCompany: string
  accounts: TemplateEntry[]
  customers: TemplateEntry[]
  vendors: TemplateEntry[]
  classes: TemplateEntry[]
  items: TemplateEntry[]
  diagnostics: ScanDiagnostic[]
}

export type TemplateSection = 'accounts' | 'customers' | 'vendors' | 'classes' | 'items'

// ── Capture ──────────────────────────────────────────────────────────────────

const CAPTURE: {
  section: TemplateSection
  rq: string
  ret: string
  typeTag?: string
  descTag?: string
  numberTag?: string
}[] = [
  {
    section: 'accounts',
    rq: 'AccountQueryRq',
    ret: 'AccountRet',
    typeTag: 'AccountType',
    descTag: 'Desc',
    numberTag: 'AccountNumber'
  },
  { section: 'customers', rq: 'CustomerQueryRq', ret: 'CustomerRet' },
  { section: 'vendors', rq: 'VendorQueryRq', ret: 'VendorRet' },
  { section: 'classes', rq: 'ClassQueryRq', ret: 'ClassRet' },
  { section: 'items', rq: 'ItemServiceQueryRq', ret: 'ItemServiceRet', descTag: 'ItemDesc' }
]

/**
 * Read the lists worth carrying to a new file.
 *
 * Only active entries are captured — an inactive account in the template file
 * is one somebody deliberately retired, and recreating it in a fresh file
 * would import that file's clutter along with its structure.
 */
export async function captureTemplate(
  send: QBSender,
  sourceCompany: string,
  sections: TemplateSection[] = ['accounts', 'customers', 'vendors', 'classes', 'items']
): Promise<CompanyTemplate> {
  const template: CompanyTemplate = {
    format: 'phantom-pulse-template@1',
    createdAt: new Date().toISOString(),
    sourceCompany,
    accounts: [],
    customers: [],
    vendors: [],
    classes: [],
    items: [],
    diagnostics: []
  }

  for (const def of CAPTURE) {
    if (!sections.includes(def.section)) continue

    const diag = newDiagnostic(def.rq)

    await runPaged(
      send,
      def.rq,
      ['<ActiveStatus>ActiveOnly</ActiveStatus>', ''],
      (xml) => {
        const found = blocks(xml, def.ret)
        for (const b of found) {
          const name = ownFullName(b)
          if (!name) continue
          template[def.section].push({
            name,
            type: def.typeTag ? (tagValue(b, def.typeTag) ?? undefined) : undefined,
            description: def.descTag ? (tagValue(b, def.descTag) ?? undefined) : undefined,
            accountNumber: def.numberTag ? (tagValue(b, def.numberTag) ?? undefined) : undefined
          })
        }
        return found.length
      },
      diag
    )

    template.diagnostics.push(diag)
  }

  return template
}

// ── Replay ───────────────────────────────────────────────────────────────────

export interface ReplayResult {
  section: TemplateSection
  name: string
  status: 'created' | 'exists' | 'failed'
  message?: string
}

export interface ReplaySummary {
  results: ReplayResult[]
  created: number
  exists: number
  failed: number
}

/** Depth in the Parent:Child hierarchy, so parents can be created first. */
function depth(name: string): number {
  return name.split(':').length
}

/**
 * Build an Add request for one entry.
 *
 * Parented names are split: QuickBooks wants the leaf in <Name> and the parent
 * path in <ParentRef>, not the full "A:B:C" string in Name.
 */
function buildAdd(section: TemplateSection, entry: TemplateEntry): { rq: string; xml: string } | null {
  const parts = entry.name.split(':')
  const leaf = parts[parts.length - 1]
  const parent = parts.length > 1 ? parts.slice(0, -1).join(':') : ''
  const parentRef = parent ? `<ParentRef><FullName>${escapeXML(parent)}</FullName></ParentRef>` : ''

  switch (section) {
    case 'accounts': {
      const rq = 'AccountAddRq'
      const number = entry.accountNumber
        ? `<AccountNumber>${escapeXML(entry.accountNumber)}</AccountNumber>`
        : ''
      const desc = entry.description ? `<Desc>${escapeXML(entry.description)}</Desc>` : ''
      return {
        rq,
        xml:
          `<${rq} requestID="tpl"><AccountAdd>` +
          `<Name>${escapeXML(leaf)}</Name>` +
          parentRef +
          number +
          `<AccountType>${escapeXML(entry.type || 'Expense')}</AccountType>` +
          desc +
          `</AccountAdd></${rq}>`
      }
    }
    case 'customers': {
      const rq = 'CustomerAddRq'
      return {
        rq,
        xml:
          `<${rq} requestID="tpl"><CustomerAdd>` +
          `<Name>${escapeXML(leaf)}</Name>` +
          parentRef +
          `</CustomerAdd></${rq}>`
      }
    }
    case 'vendors': {
      const rq = 'VendorAddRq'
      // Vendors are a flat list — no ParentRef in the schema.
      return {
        rq,
        xml: `<${rq} requestID="tpl"><VendorAdd><Name>${escapeXML(entry.name)}</Name></VendorAdd></${rq}>`
      }
    }
    case 'classes': {
      const rq = 'ClassAddRq'
      return {
        rq,
        xml:
          `<${rq} requestID="tpl"><ClassAdd>` +
          `<Name>${escapeXML(leaf)}</Name>` +
          parentRef +
          `</ClassAdd></${rq}>`
      }
    }
    case 'items': {
      const rq = 'ItemServiceAddRq'
      const desc = entry.description ? `<Desc>${escapeXML(entry.description)}</Desc>` : ''
      // A service item needs an income account; without one QuickBooks rejects
      // it, and guessing an account name would create junk in the new file.
      // Sales-account mapping is intentionally left to the user in QuickBooks.
      return {
        rq,
        xml:
          `<${rq} requestID="tpl"><ItemServiceAdd>` +
          `<Name>${escapeXML(leaf)}</Name>` +
          parentRef +
          `<SalesOrPurchase>${desc}</SalesOrPurchase>` +
          `</ItemServiceAdd></${rq}>`
      }
    }
    default:
      return null
  }
}

/**
 * Replay a captured template into the currently connected company file.
 *
 * Nothing here is destructive: every operation is an Add, and a name that
 * already exists is left exactly as it is.
 */
export async function replayTemplate(
  send: QBSender,
  template: CompanyTemplate,
  sections: TemplateSection[],
  onProgress?: (p: { done: number; total: number; current: string }) => void
): Promise<ReplaySummary> {
  const results: ReplayResult[] = []

  const queue: { section: TemplateSection; entry: TemplateEntry }[] = []
  for (const section of sections) {
    const entries = [...template[section]].sort(
      (a, b) => depth(a.name) - depth(b.name) || a.name.localeCompare(b.name)
    )
    for (const entry of entries) queue.push({ section, entry })
  }

  for (let i = 0; i < queue.length; i++) {
    const { section, entry } = queue[i]
    onProgress?.({ done: i, total: queue.length, current: entry.name })

    const built = buildAdd(section, entry)
    if (!built) {
      results.push({ section, name: entry.name, status: 'failed', message: 'Unsupported list type.' })
      continue
    }

    try {
      const resp = await send(envelope(built.xml))
      const status = readStatus(resp, built.rq)

      if (status.severity !== 'Error') {
        results.push({ section, name: entry.name, status: 'created' })
      } else if (status.code === '3100') {
        // Name already in use — the expected outcome when topping up a file.
        results.push({ section, name: entry.name, status: 'exists' })
      } else {
        results.push({
          section,
          name: entry.name,
          status: 'failed',
          message: `QB ${status.code}: ${status.message}`
        })
      }
    } catch (err: unknown) {
      results.push({
        section,
        name: entry.name,
        status: 'failed',
        message: err instanceof Error ? err.message : String(err)
      })
    }

    await new Promise((r) => setTimeout(r, 40))
  }

  onProgress?.({ done: queue.length, total: queue.length, current: '' })

  return {
    results,
    created: results.filter((r) => r.status === 'created').length,
    exists: results.filter((r) => r.status === 'exists').length,
    failed: results.filter((r) => r.status === 'failed').length
  }
}
