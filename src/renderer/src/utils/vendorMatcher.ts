/**
 * Vendor/customer matcher — three-tier matching with an ambiguity guard,
 * ported from AccuracyWork's matching/vendor_match.py (METHOD.md §3).
 *
 * The rule: look the payee up in QuickBooks, code it to whatever its previous
 * transactions were coded to; if it isn't in QuickBooks, leave the account
 * blank ("Ask My Accountant").
 *
 *  1. Normalize — uppercase, strip punctuation, drop INC|LLC|CORP|CO|LTD|THE|OF.
 *  2. Match in three tiers — exact → prefix (≥4 chars, most-supported wins) →
 *     fuzzy (bigram similarity, cutoff 0.88, deliberately tight).  Fuzzy
 *     matches are flagged for review, never silently trusted.
 *  3. Pick the account — most frequent historical account for that entity,
 *     UNLESS the history has no dominant account (top account <70% of ≥3
 *     transactions).  A vendor split between a business expense and an owner
 *     distribution is a per-transaction judgment call — those rows go to
 *     review instead of being silently coded.
 *  4. Rewrite the payee spelling to QuickBooks' own canonical spelling.
 */

export type EntityKind = 'vendor' | 'customer' | 'both'

export interface EntityCatalog {
  /** canonical QB spellings — vendors and customers */
  names: string[]
  kinds: Record<string, EntityKind>
  /** entityName → accountFullName → historical transaction count */
  stats: Record<string, Record<string, number>>
}

export interface MatchOutcome {
  /** canonical QB entity name, or null when not in QB */
  entity: string | null
  entityKind: EntityKind | null
  /** dominant historical account, or null → Ask My Accountant */
  account: string | null
  tier: 'exact' | 'prefix' | 'fuzzy' | 'none'
  needsReview: boolean
  reviewReason: string | null
}

const DROP_WORDS = new Set(['INC', 'LLC', 'CORP', 'CO', 'LTD', 'THE', 'OF'])
const FUZZY_CUTOFF = 0.88
const DOMINANCE_THRESHOLD = 0.7
const DOMINANCE_MIN_TXNS = 3

export function normalizeEntityName(name: string): string {
  const upper = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = upper.split(' ').filter((w) => w && !DROP_WORDS.has(w))
  return words.join(' ')
}

interface PreparedCatalog {
  byNorm: Map<string, string[]> // normalized → canonical names
  normed: { norm: string; name: string; volume: number }[]
}

const prepCache = new WeakMap<EntityCatalog, PreparedCatalog>()

function prepare(catalog: EntityCatalog): PreparedCatalog {
  const cached = prepCache.get(catalog)
  if (cached) return cached

  const byNorm = new Map<string, string[]>()
  const normed: PreparedCatalog['normed'] = []

  for (const name of catalog.names) {
    const norm = normalizeEntityName(name)
    if (!norm) continue
    const list = byNorm.get(norm) ?? []
    list.push(name)
    byNorm.set(norm, list)
    normed.push({ norm, name, volume: totalVolume(catalog, name) })
  }

  const prepared = { byNorm, normed }
  prepCache.set(catalog, prepared)
  return prepared
}

function totalVolume(catalog: EntityCatalog, name: string): number {
  const stats = catalog.stats[name]
  if (!stats) return 0
  return Object.values(stats).reduce((s, n) => s + n, 0)
}

/** Canonical spelling: among duplicate normalized names, the one with most volume. */
function pickCanonical(catalog: EntityCatalog, names: string[]): string {
  if (names.length === 1) return names[0]
  return [...names].sort((a, b) => totalVolume(catalog, b) - totalVolume(catalog, a))[0]
}

/**
 * The ambiguity guard (METHOD.md §3): most frequent historical account,
 * unless the history has no dominant account.
 */
export function accountFor(
  catalog: EntityCatalog,
  entityName: string
): { account: string | null; ambiguous: boolean } {
  const stats = catalog.stats[entityName]
  if (!stats) return { account: null, ambiguous: false }

  const entries = Object.entries(stats).filter(([, n]) => n > 0)
  if (!entries.length) return { account: null, ambiguous: false }

  entries.sort((a, b) => b[1] - a[1])
  const total = entries.reduce((s, [, n]) => s + n, 0)
  const [topAccount, topCount] = entries[0]

  if (total >= DOMINANCE_MIN_TXNS && topCount / total < DOMINANCE_THRESHOLD) {
    // e.g. HOME DEPOT: 62% Material Purchase / 28% Shareholder Distributions —
    // business-vs-personal is a per-transaction judgment call.
    return { account: null, ambiguous: true }
  }

  return { account: topAccount, ambiguous: false }
}

export function matchEntity(rawName: string, catalog: EntityCatalog): MatchOutcome {
  const none: MatchOutcome = {
    entity: null,
    entityKind: null,
    account: null,
    tier: 'none',
    needsReview: false,
    reviewReason: null
  }

  const needle = normalizeEntityName(rawName)
  if (!needle || !catalog?.names?.length) return none

  const prepared = prepare(catalog)

  // Tier 1: exact normalized match
  const exact = prepared.byNorm.get(needle)
  if (exact?.length) {
    return finalize(catalog, pickCanonical(catalog, exact), 'exact')
  }

  // Tier 2: prefix (≥4 chars) — most-supported (highest volume) wins
  if (needle.length >= 4) {
    let best: { name: string; volume: number } | null = null
    for (const candidate of prepared.normed) {
      if (candidate.norm.length < 4) continue
      const isPrefix = candidate.norm.startsWith(needle) || needle.startsWith(candidate.norm)
      if (!isPrefix) continue
      if (!best || candidate.volume > best.volume) best = candidate
    }
    if (best) return finalize(catalog, best.name, 'prefix')
  }

  // Tier 3: fuzzy — deliberately tight cutoff, always flagged for review
  let bestScore = 0
  let bestName: string | null = null
  for (const candidate of prepared.normed) {
    const score = bigramSimilarity(needle, candidate.norm)
    if (score > bestScore) {
      bestScore = score
      bestName = candidate.name
    }
  }
  if (bestName && bestScore >= FUZZY_CUTOFF) {
    const outcome = finalize(catalog, bestName, 'fuzzy')
    outcome.needsReview = true
    outcome.reviewReason = `Fuzzy match (${Math.round(bestScore * 100)}%) — verify payee`
    return outcome
  }

  return none
}

function finalize(catalog: EntityCatalog, entityName: string, tier: MatchOutcome['tier']): MatchOutcome {
  const { account, ambiguous } = accountFor(catalog, entityName)
  return {
    entity: entityName,
    entityKind: catalog.kinds[entityName] ?? 'vendor',
    account,
    tier,
    needsReview: ambiguous,
    reviewReason: ambiguous ? 'No dominant account in QB history — pick per transaction' : null
  }
}

/** Sørensen–Dice bigram similarity — 1.0 identical, 0.0 disjoint. */
export function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2)
      map.set(bg, (map.get(bg) ?? 0) + 1)
    }
    return map
  }

  const aBigrams = bigrams(a)
  const bBigrams = bigrams(b)
  let overlap = 0
  for (const [bg, count] of aBigrams) {
    const other = bBigrams.get(bg)
    if (other) overlap += Math.min(count, other)
  }

  return (2 * overlap) / (a.length - 1 + (b.length - 1))
}

/** Build an EntityCatalog from the qb:getEntityAccountStats IPC response. */
export function buildEntityCatalog(data: {
  vendors: string[]
  customers: string[]
  stats: Record<string, Record<string, number>>
}): EntityCatalog {
  const kinds: Record<string, EntityKind> = {}
  const names = new Set<string>()

  for (const v of data.vendors || []) {
    names.add(v)
    kinds[v] = 'vendor'
  }
  for (const c of data.customers || []) {
    names.add(c)
    kinds[c] = kinds[c] ? 'both' : 'customer'
  }
  // Entities that only appear in transaction history
  for (const name of Object.keys(data.stats || {})) {
    if (!names.has(name)) {
      names.add(name)
      kinds[name] = 'vendor'
    }
  }

  return { names: [...names], kinds, stats: data.stats || {} }
}
