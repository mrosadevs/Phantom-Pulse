/**
 * Fuzzy vendor/customer matcher.
 * Given a cleaned transaction name and a QB vendor→account map,
 * returns the best matching vendor name and its account.
 */

export interface MatchResult {
  vendorName: string | null
  account: string | null
  confidence: 'exact' | 'fuzzy' | 'none'
}

/**
 * qbMap: { "Pinecrest Bakery": "Meals and Entertainment", ... }
 * cleanedName: already-cleaned transaction description (e.g. "Pinecrest Bakery")
 */
export function matchToQB(
  cleanedName: string,
  qbMap: Record<string, string>
): MatchResult {
  if (!cleanedName || Object.keys(qbMap).length === 0) {
    return { vendorName: null, account: null, confidence: 'none' }
  }

  const needle = cleanedName.toLowerCase().trim()
  const vendors = Object.keys(qbMap)

  // 1. Exact case-insensitive match
  for (const v of vendors) {
    if (v.toLowerCase() === needle) {
      return { vendorName: v, account: qbMap[v] || null, confidence: 'exact' }
    }
  }

  // 2. Cleaned name contains vendor name (substring, vendor min 4 chars)
  for (const v of vendors) {
    const vl = v.toLowerCase()
    if (vl.length >= 4 && needle.includes(vl)) {
      return { vendorName: v, account: qbMap[v] || null, confidence: 'exact' }
    }
  }

  // 3. Vendor name contains cleaned name (substring, cleaned min 4 chars)
  for (const v of vendors) {
    const vl = v.toLowerCase()
    if (needle.length >= 4 && vl.includes(needle)) {
      return { vendorName: v, account: qbMap[v] || null, confidence: 'exact' }
    }
  }

  // 4. Word-overlap (Jaccard ≥ 0.5)
  const needleWords = tokenize(needle)
  if (needleWords.length === 0) return { vendorName: null, account: null, confidence: 'none' }

  let bestScore = 0
  let bestVendor: string | null = null

  for (const v of vendors) {
    const vWords = tokenize(v.toLowerCase())
    const score = jaccard(needleWords, vWords)
    if (score > bestScore) {
      bestScore = score
      bestVendor = v
    }
  }

  if (bestScore >= 0.5 && bestVendor) {
    return { vendorName: bestVendor, account: qbMap[bestVendor] || null, confidence: 'fuzzy' }
  }

  return { vendorName: null, account: null, confidence: 'none' }
}

// ── Build a lookup-ready map from the raw IPC response ────────────────────────

/**
 * The IPC returns Record<vendorName, accountName>.
 * This function normalizes keys to lowercase for matching while preserving originals.
 */
export function buildLookupMap(
  raw: Record<string, string>
): Record<string, string> {
  // Return as-is; matching is case-insensitive internally
  return raw
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'at', 'for', 'to'])

function tokenize(s: string): string[] {
  return s
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a)
  const sb = new Set(b)
  const intersection = [...sa].filter((x) => sb.has(x)).length
  const union = new Set([...sa, ...sb]).size
  return union === 0 ? 0 : intersection / union
}
