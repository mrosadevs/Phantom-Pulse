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
  /** entityName → accountFullName → total dollars posted there */
  amounts?: Record<string, Record<string, number>>
  /** entityName → coding signature → transaction count (see SIGNATURE_SEP) */
  signatures?: Record<string, Record<string, number>>
  /** entityName → total transactions read from QB */
  txnCounts?: Record<string, number>
}

/** One account of a recurring split, with its share of the entity's dollars. */
export interface SplitShare {
  account: string
  share: number
}

export interface MatchOutcome {
  /** canonical QB entity name, or null when not in QB */
  entity: string | null
  entityKind: EntityKind | null
  /** dominant historical account, or null → Ask My Accountant */
  account: string | null
  /** when QB codes this payee as a recurring split, every account it hits */
  split: SplitShare[] | null
  tier: 'exact' | 'prefix' | 'fuzzy' | 'none'
  needsReview: boolean
  reviewReason: string | null
}

// Professional-entity suffixes belong here with the company ones: a bank line
// reading "Victor M. Portillo, P.A." and a QuickBooks vendor called "Victor
// Portillo" are the same payee.
const DROP_WORDS = new Set([
  'INC', 'LLC', 'CORP', 'CO', 'LTD', 'THE', 'OF',
  'PA', 'PC', 'PLLC', 'PLC', 'LP', 'LLP'
])
const FUZZY_CUTOFF = 0.88
const DOMINANCE_THRESHOLD = 0.7
const DOMINANCE_MIN_TXNS = 3

/** Must match SIGNATURE_SEP in src/main/qb/entityHistory.ts. */
export const SIGNATURE_SEP = ' || '

/**
 * Shortest name the prefix tier will consider.  METHOD.md set this at 4 to keep
 * short fragments from matching everything, but that also excluded real vendor
 * names — a company file whose electric vendor is literally "FPL" could never
 * match "FPL DIRECT DEBIT ELEC PYMT …".  Three is safe here because prefixes
 * must now land on a word boundary.
 */
const MIN_PREFIX_LEN = 3

/**
 * True when `short` is a whole-word prefix of `long`.  Character-level
 * startsWith let a name match partway through a word ("REINCOFL" inside
 * "REINCOFLOWERS"); requiring the boundary keeps the tier tight enough to
 * lower the length floor.
 */
function isWordPrefix(long: string, short: string): boolean {
  if (!long.startsWith(short)) return false
  return long.length === short.length || long[short.length] === ' '
}

export function normalizeEntityName(name: string): string {
  const upper = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = upper.split(' ').filter((w) => w && !DROP_WORDS.has(w))

  // Drop middle initials — "VICTOR M PORTILLO" and "VICTOR PORTILLO" are one
  // person.  Only in the middle: a trailing or leading single letter can be
  // the name itself ("AT&T" normalizes to "AT T").
  const trimmed = words.filter(
    (w, i) => w.length > 1 || i === 0 || i === words.length - 1
  )

  return trimmed.join(' ')
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

export interface AccountChoice {
  account: string | null
  ambiguous: boolean
  split: SplitShare[] | null
}

/**
 * The ambiguity guard (METHOD.md §3), measured per TRANSACTION.
 *
 * The guard exists to catch payees whose transactions disagree with each other
 * — HOME DEPOT coded to a business expense some months and to Shareholder
 * Distributions others.  That is a per-transaction judgment call and belongs in
 * review.  It was never meant to catch a payee whose every transaction is coded
 * the same way across two accounts: a loan payment that always splits principal
 * → Loan Payable and interest → Interest Expense is perfectly consistent
 * bookkeeping, but counting expense LINES scored it 50/50 and dumped twelve
 * identical payments into Ask My Accountant.
 *
 * So compare coding SIGNATURES (the set of accounts one transaction hit).  A
 * dominant signature means consistent coding, whether it names one account or
 * three; only competing signatures are real ambiguity.
 */
export function accountFor(catalog: EntityCatalog, entityName: string): AccountChoice {
  const none: AccountChoice = { account: null, ambiguous: false, split: null }
  const signatures = catalog.signatures?.[entityName]

  if (signatures) {
    const entries = Object.entries(signatures).filter(([, n]) => n > 0)
    if (!entries.length) return none

    entries.sort((a, b) => b[1] - a[1])
    const total = entries.reduce((s, [, n]) => s + n, 0)
    const [topSignature, topCount] = entries[0]

    if (total >= DOMINANCE_MIN_TXNS && topCount / total < DOMINANCE_THRESHOLD) {
      return { account: null, ambiguous: true, split: null }
    }

    const accounts = topSignature.split(SIGNATURE_SEP).filter(Boolean)
    if (accounts.length === 0) return none
    if (accounts.length === 1) return { account: accounts[0], ambiguous: false, split: null }

    // A recurring split: QuickBooks books this payee across several accounts
    // every time.  Consistent, but the statement gives us one line and one
    // amount, so naming a single account would mean choosing which part of the
    // split it represents — a decision Pulse has no business making.  Report
    // the split and let it go to Ask My Accountant.
    const amounts = catalog.amounts?.[entityName] ?? {}
    const weighted = accounts
      .map((account) => ({ account, weight: amounts[account] ?? 0 }))
      .sort((a, b) => b.weight - a.weight)
    const totalWeight = weighted.reduce((s, w) => s + w.weight, 0)
    const split: SplitShare[] = weighted.map((w) => ({
      account: w.account,
      share: totalWeight > 0 ? w.weight / totalWeight : 1 / weighted.length
    }))

    return { account: null, ambiguous: true, split }
  }

  // No signatures (older IPC payload): fall back to the account histogram.
  const stats = catalog.stats[entityName]
  if (!stats) return none

  const entries = Object.entries(stats).filter(([, n]) => n > 0)
  if (!entries.length) return none

  entries.sort((a, b) => b[1] - a[1])
  const total = entries.reduce((s, [, n]) => s + n, 0)
  const [topAccount, topCount] = entries[0]

  if (total >= DOMINANCE_MIN_TXNS && topCount / total < DOMINANCE_THRESHOLD) {
    return { account: null, ambiguous: true, split: null }
  }

  return { account: topAccount, ambiguous: false, split: null }
}

export function matchEntity(rawName: string, catalog: EntityCatalog): MatchOutcome {
  const none: MatchOutcome = {
    entity: null,
    entityKind: null,
    account: null,
    split: null,
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
    return resolveCandidates(catalog, exact, 'exact')
  }

  // Tier 2: prefix — most-supported (highest volume) wins
  if (needle.length >= MIN_PREFIX_LEN) {
    let best: { name: string; volume: number } | null = null
    for (const candidate of prepared.normed) {
      if (candidate.norm.length < MIN_PREFIX_LEN) continue
      const isPrefix = isWordPrefix(candidate.norm, needle) || isWordPrefix(needle, candidate.norm)
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
    const fuzzyNote = `Fuzzy match (${Math.round(bestScore * 100)}%) — verify payee`
    outcome.needsReview = true
    outcome.reviewReason = outcome.reviewReason
      ? `${fuzzyNote} · ${outcome.reviewReason}`
      : fuzzyNote
    return outcome
  }

  return none
}

/**
 * Several QuickBooks records can normalize to the same name — "Reincofl Corp"
 * and "Reincofl, Corp." are two list entries as far as QB is concerned, and in
 * a real file they are often coded to different accounts.  Collapsing them to
 * the highest-volume spelling and using its account means picking one QB record
 * over another, which is a decision about the books, not a reading of them.
 *
 * So: collapse the spelling only when the candidates agree on the account.
 * When they disagree, say which records collide and let it go to Ask My
 * Accountant.
 */
function resolveCandidates(
  catalog: EntityCatalog,
  names: string[],
  tier: MatchOutcome['tier']
): MatchOutcome {
  const canonical = pickCanonical(catalog, names)
  if (names.length < 2) return finalize(catalog, canonical, tier)

  const accounts = new Set(names.map((name) => accountFor(catalog, name).account ?? ''))
  if (accounts.size < 2) return finalize(catalog, canonical, tier)

  const outcome = finalize(catalog, canonical, tier)
  outcome.account = null
  outcome.split = null
  outcome.needsReview = true
  outcome.reviewReason =
    `QuickBooks has ${names.length} records for this name, coded differently ` +
    `(${names.join(' / ')}) — pick one`
  return outcome
}

function finalize(catalog: EntityCatalog, entityName: string, tier: MatchOutcome['tier']): MatchOutcome {
  const { account, ambiguous, split } = accountFor(catalog, entityName)

  let needsReview = ambiguous
  let reviewReason: string | null = ambiguous
    ? 'No dominant account in QB history — pick per transaction'
    : null

  if (split && split.length > 1) {
    // Ask My Accountant, but say what QB normally does with this payee so the
    // split is a one-line decision rather than a lookup.
    needsReview = true
    reviewReason =
      'QB splits this payee — ' +
      split.map((s) => `${Math.round(s.share * 100)}% ${s.account}`).join(', ')
  } else if (!account && !ambiguous) {
    // Matched a name on the vendor/customer list that has never been coded.
    // Worth saying out loud: it is the difference between "QB has no history
    // for this payee" and "Pulse failed to read the history".
    needsReview = true
    reviewReason = 'Matched in QB, but this name has no coded transactions to learn from'
  }

  return {
    entity: entityName,
    entityKind: catalog.kinds[entityName] ?? 'vendor',
    account,
    split,
    tier,
    needsReview,
    reviewReason
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
  amounts?: Record<string, Record<string, number>>
  signatures?: Record<string, Record<string, number>>
  txnCounts?: Record<string, number>
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

  return {
    names: [...names],
    kinds,
    stats: data.stats || {},
    amounts: data.amounts,
    signatures: data.signatures,
    txnCounts: data.txnCounts
  }
}
