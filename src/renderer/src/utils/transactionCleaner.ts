/**
 * Transaction description cleaner — ported from Phantom Ledger's transactionCleaner.js
 * Pure TypeScript, no dependencies. Works in both renderer and main process.
 */

// ── Normalization map (common merchant abbreviations → clean names) ────────────

const normalizeMap: Record<string, string> = {
  'AMAZON MKTPL': 'Amazon',
  'AMAZON MKTP': 'Amazon',
  'AMAZON.COM': 'Amazon',
  'AMZN MKTP': 'Amazon',
  'AMZN': 'Amazon',
  'ATT* BILL': 'AT&T',
  'ATT*': 'AT&T',
  'AT&T': 'AT&T',
  'APPLE.COM/BILL': 'Apple',
  'APPLE CASH': 'Apple Cash',
  'ITUNES': 'Apple iTunes',
  'NETFLIX.COM': 'Netflix',
  'NETFLIX': 'Netflix',
  'HULU': 'Hulu',
  'SPOTIFY': 'Spotify',
  'SPOTIFY USA': 'Spotify',
  'SPOTIFY AB': 'Spotify',
  'GOOGLE *': 'Google',
  'GOOGLE SVCS': 'Google Services',
  'GOOGLE STORAGE': 'Google Storage',
  'GOOGLE PLAY': 'Google Play',
  'YOUTUBE PREMIUM': 'YouTube Premium',
  'NST THE HOME D': 'The Home Depot',
  'HOME DEPOT': 'The Home Depot',
  'HOMEDEPOT.COM': 'The Home Depot',
  'LOWES': "Lowe's",
  "LOWE'S": "Lowe's",
  'WALMART': 'Walmart',
  'WAL-MART': 'Walmart',
  'WAL MART': 'Walmart',
  'SAMSCLUB': "Sam's Club",
  "SAM'S CLUB": "Sam's Club",
  'TARGET': 'Target',
  'COSTCO': 'Costco',
  'COSTCO WHSE': 'Costco',
  'BJS WHOLESALE': "BJ's Wholesale",
  'PUBLIX': 'Publix',
  'WHOLE FOODS': 'Whole Foods',
  'TRADER JOE': "Trader Joe's",
  'KROGER': 'Kroger',
  'ALDI': 'Aldi',
  'WINN-DIXIE': 'Winn-Dixie',
  'CVS PHARMACY': 'CVS',
  'CVS/PHARMACY': 'CVS',
  'WALGREEN': 'Walgreens',
  'WALGREENS': 'Walgreens',
  'RITE AID': 'Rite Aid',
  'CHEVRON': 'Chevron',
  'SHELL OIL': 'Shell',
  'BP#': 'BP',
  'EXXONMOBIL': 'ExxonMobil',
  'SUNOCO': 'Sunoco',
  'CIRCLE K': 'Circle K',
  '7-ELEVEN': '7-Eleven',
  'SEVEN ELEVEN': '7-Eleven',
  'WAWA': 'Wawa',
  'RACETRAC': 'RaceTrac',
  'MCDONALD': "McDonald's",
  "MCDONALD'S": "McDonald's",
  'MCDONALDS': "McDonald's",
  'STARBUCKS': 'Starbucks',
  'SBUX': 'Starbucks',
  'DUNKIN': "Dunkin'",
  'DUNKIN DONUTS': "Dunkin'",
  'CHICK-FIL-A': 'Chick-fil-A',
  'CHICKFILA': 'Chick-fil-A',
  'SUBWAY': 'Subway',
  'CHIPOTLE': 'Chipotle',
  'DOMINO': "Domino's",
  'PIZZA HUT': 'Pizza Hut',
  'DOORDASH': 'DoorDash',
  'DOOR DASH': 'DoorDash',
  'UBEREATS': 'Uber Eats',
  'UBER EATS': 'Uber Eats',
  'GRUBHUB': 'Grubhub',
  'INSTACART': 'Instacart',
  'UBER': 'Uber',
  'LYFT': 'Lyft',
  'PAYPAL': 'PayPal',
  'VENMO': 'Venmo',
  'CASH APP': 'Cash App',
  'SQ *': 'Square',
  'SQUARE': 'Square',
  'TST*': 'Toast POS',
  'CHARCO UTILITIES': 'Charlotte County Utilities',
  'FPL DIRECT': 'Florida Power & Light',
  'FPL GROUP': 'Florida Power & Light',
  'COMCAST': 'Comcast',
  'XFINITY': 'Xfinity',
  'TMOBILE': 'T-Mobile',
  'T-MOBILE': 'T-Mobile',
  'VERIZON': 'Verizon',
  'VZWRLSS': 'Verizon Wireless',
  'GEICO': 'GEICO',
  'STATE FARM': 'State Farm',
  'ALLSTATE': 'Allstate',
  'PROGRESSIVE': 'Progressive',
  'USAA': 'USAA',
  'ZELLE PAYMENT': 'Zelle',
  'ZELLE': 'Zelle',
  'ACH DEBIT': 'ACH Debit',
  'ACH CREDIT': 'ACH Credit',
  'WIRE TRANSFER': 'Wire Transfer',
  'CHECK': 'Check',
  'OVERDRAFT FEE': 'Overdraft Fee',
  'MONTHLY SERVICE FEE': 'Monthly Service Fee',
  'MONTHLY FEE': 'Monthly Fee',
  'FINANCE CHARGE': 'Finance Charge',
  'LATE FEE': 'Late Fee',
  'INTEREST CHARGE': 'Interest Charge',
  'MICROSOFT': 'Microsoft',
  'MSFT': 'Microsoft',
  'OFFICE 365': 'Microsoft 365',
  'MICROSOFT 365': 'Microsoft 365',
  'ADOBE': 'Adobe',
  'DROPBOX': 'Dropbox',
  'ZOOM': 'Zoom',
  'QUICKBOOKS': 'QuickBooks',
  'INTUIT': 'Intuit',
  'OPENAI': 'OpenAI',
  'CHATGPT': 'ChatGPT',
  'INDEED': 'Indeed',
  'LINKEDIN': 'LinkedIn',
  'FACEBOOK ADS': 'Meta Ads',
  'FB ADS': 'Meta Ads',
  'INSTAGRAM ADS': 'Meta Ads',
  'GOOGLE ADS': 'Google Ads',
  'USPS': 'USPS',
  'UPS': 'UPS',
  'FEDEX': 'FedEx',
  'DHL': 'DHL',
  'AIRBNB': 'Airbnb',
  'VRBO': 'VRBO',
  'HOTELS.COM': 'Hotels.com',
  'EXPEDIA': 'Expedia',
  'DELTA AIR': 'Delta Airlines',
  'UNITED AIRLINES': 'United Airlines',
  'AMERICAN AIRLINES': 'American Airlines',
  'SOUTHWEST': 'Southwest Airlines',
  'JETBLUE': 'JetBlue',
  'HERTZ': 'Hertz',
  'ENTERPRISE RENT': 'Enterprise',
  'AVIS': 'Avis',
  'PARKWAY': 'Parkway Parking'
}

// ── Cleaning rules ────────────────────────────────────────────────────────────

export function cleanTransaction(raw: string): string {
  if (!raw || raw.trim().length === 0) return raw

  let s = raw.trim()

  // ── Zelle ──
  // "Zelle payment to John Doe Memo: Lunch"
  let m = s.match(/^zelle\s+(?:payment\s+)?(?:to|from)\s+(.+?)(?:\s+memo:.*)?$/i)
  if (m) return titleCase(stripBankCodes(m[1]))

  // "Zelle payment John Doe"
  m = s.match(/^zelle\s+(?:payment\s+)(.+)$/i)
  if (m) return titleCase(stripBankCodes(m[1]))

  // ── Wire transfers ──
  m = s.match(/^(?:funds\s+transfer\s+)?wire\s+(?:type:\s*\S+\s+)?(?:out|in)?\s*(?:benef(?:iciary)?:|to\s+)?(.+?)(?:\s+ref#|\s+routing|\s+aba|\s+srf#|\s+ftr|\s+id:|\s+\d{6,}|$)/i)
  if (m && m[1].trim().length > 2) return titleCase(m[1].trim())

  m = s.match(/^wire\s+(?:from\s+)?\/org=([^/]+)/i)
  if (m) return titleCase(cleanFedWireName(m[1]))

  m = s.match(/\/bnf=([^/\s](?:[^/]*[^/\s])?)/i)
  if (m) return titleCase(cleanFedWireName(m[1]))

  m = s.match(/\/org=([^/\s](?:[^/]*[^/\s])?)/i)
  if (m) return titleCase(cleanFedWireName(m[1]))

  // ── Federal wire "/Ftr/Bnf=" ──
  m = s.match(/\/ftr\/bnf=([^/\s](?:[^/]*[^/\s])?)/i)
  if (m) return titleCase(cleanFedWireName(m[1]))

  // ── ACH / Misc deposits ──
  m = s.match(/^(?:misc|other)\s+(?:deposit|withdrawal|adj(?:ustment)?)[\s:]+(.+)/i)
  if (m) return titleCase(m[1].trim())

  m = s.match(/^book\s+transfer\s+(?:credit|debit)/i)
  if (m) return 'Book Transfer'

  m = s.match(/^business\s+to\s+business\s+ach\s+(?:debit|credit)\s+(?:from\s+)?(.+?)(?:\s+id:|\s+\d{6,}|$)/i)
  if (m) return titleCase(m[1].trim())

  // ── ACH company name ──
  m = s.match(/^ach\s+(?:debit|credit|payment|transfer)[\s:]+(.+?)(?:\s+(?:ppd|ccd|web|tel)\s+id:|\s+\d{6,}|$)/i)
  if (m) return titleCase(m[1].trim())

  m = s.match(/^(?:ppd|ccd|web|tel)\s+(?:debit|credit)[\s:]+(.+?)(?:\s+id:|\s+\d{6,}|$)/i)
  if (m) return titleCase(m[1].trim())

  // ── Debit / Credit card purchases ──
  m = s.match(/^(?:debit\s+card\s+purch(?:ase)?|checkcard\s+purchase|credit\s+card\s+(?:purch(?:ase)?|credit))[\s#*]+(.+)/i)
  if (m) return titleCase(stripCardNoise(m[1]))

  // "Card Purchase MM/DD Name City ST Card XXXX"
  m = s.match(/^card\s+purchase\s+\d{1,2}\/\d{2}\s+(.+?)(?:\s+card\s+\d{4})?$/i)
  if (m) return titleCase(stripCardNoise(m[1]))

  // "POS Purchase" / "POS Debit"
  m = s.match(/^pos\s+(?:purchase|debit|credit)[\s*-]+(.+)/i)
  if (m) return titleCase(stripCardNoise(m[1]))

  // "Recurring Card Purchase"
  m = s.match(/^recurring\s+(?:card|debit|credit)\s+(?:purchase|payment)[\s*]+(.+)/i)
  if (m) return titleCase(stripCardNoise(m[1]))

  // ── Mobile / online transfers ──
  m = s.match(/^mobile\s+transfer\s+from\s+\S+\s+to\s+(.+)/i)
  if (m) return titleCase(m[1].trim())

  m = s.match(/^online\s+transfer\s+to\s+\S+\s+\((.+?)\)/i)
  if (m) return titleCase(m[1].trim())

  m = s.match(/^online\s+(?:banking\s+)?(?:transfer|payment)\s+(?:to|from)\s+(.+?)(?:\s+conf#|\s+\d{6,}|$)/i)
  if (m) return titleCase(m[1].trim())

  // ── Checks ──
  m = s.match(/^check(?:\s+card)?[\s#]+(\d+)/i)
  if (m) return `Check #${m[1]}`

  m = s.match(/^e-?check\s+(?:payment\s+)?(?:to\s+)?(.+)/i)
  if (m) return titleCase(m[1].trim())

  // ── Fees / service charges ──
  if (/^overdraft\s+(?:protection\s+)?fee/i.test(s)) return 'Overdraft Fee'
  if (/^monthly\s+(?:maintenance\s+|service\s+)?fee/i.test(s)) return 'Monthly Fee'
  if (/^finance\s+charge/i.test(s)) return 'Finance Charge'
  if (/^late\s+(?:payment\s+)?fee/i.test(s)) return 'Late Fee'
  if (/^(?:annual|membership)\s+fee/i.test(s)) return 'Annual Fee'
  if (/^returned\s+(?:item|check|payment)/i.test(s)) return 'Returned Item'
  if (/^nsf\s+(?:fee|charge)/i.test(s)) return 'NSF Fee'
  if (/^service\s+charge/i.test(s)) return 'Service Charge'
  if (/^interest\s+(?:charge|payment)/i.test(s)) return 'Interest Charge'
  if (/^wire\s+(?:transfer\s+)?fee/i.test(s)) return 'Wire Fee'

  // ── Direct deposit / payroll ──
  m = s.match(/^(?:direct\s+deposit|payroll)\s+(.+?)(?:\s+(?:ppd|ccd)\s+id:|\s+\d{6,}|$)/i)
  if (m) return titleCase(m[1].trim())

  // ── ATM ──
  m = s.match(/^atm\s+(?:cash\s+)?(?:withdrawal|deposit)[\s*-]+(.+?)(?:\s+\d{6,}|\s+card\s+\d{4}|$)/i)
  if (m) return `ATM - ${titleCase(stripCardNoise(m[1]))}`
  if (/^atm/i.test(s)) return 'ATM Withdrawal'

  // ── Square / Toast POS ──
  m = s.match(/^(?:sq|sq\*|sq \*|square\*)[\s*]+(.+)/i)
  if (m) return titleCase(stripCardNoise(m[1]))

  m = s.match(/^tst\*\s*(.+)/i)
  if (m) return titleCase(stripCardNoise(m[1]))

  // ── Stripe / PayPal ──
  m = s.match(/^stripe\*\s*(.+)/i)
  if (m) return titleCase(m[1].trim())

  m = s.match(/^paypal\s+\*\s*(.+)/i)
  if (m) return titleCase(m[1].trim())

  // ── Generic "Name - City ST Card XXXX" debit pattern ──
  // Strip trailing location/card noise and return merchant
  const cleaned = stripCardNoise(s)
  const normalized = applyNormalizationMap(cleaned)
  if (normalized !== cleaned) return normalized

  return titleCase(cleaned)
}

// ── Apply normalization map ───────────────────────────────────────────────────

export function applyNormalizationMap(name: string): string {
  const upper = name.toUpperCase().trim()
  // Exact match
  if (normalizeMap[upper]) return normalizeMap[upper]
  // Prefix match
  for (const [key, val] of Object.entries(normalizeMap)) {
    if (upper.startsWith(key)) return val
  }
  return name
}

export function cleanAndNormalizeTransaction(raw: string): string {
  const cleaned = cleanTransaction(raw)
  return applyNormalizationMap(cleaned)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function stripBankCodes(s: string): string {
  return s
    .replace(/\b(bac|wfct|usaa|jpmc|citi|boa)\b/gi, '')
    .replace(/\b\d{6,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripCardNoise(s: string): string {
  return s
    // Remove trailing "Card XXXX" / "Card#XXXX"
    .replace(/\s+card[\s#*]*\d{4,}/gi, '')
    // Remove trailing "XX/XX" dates
    .replace(/\s+\d{1,2}\/\d{2}\b/g, '')
    // Remove City ST (two uppercase words at end)
    .replace(/\s+[A-Z][a-zA-Z]+\s+[A-Z]{2}\s*$/, '')
    // Remove state code only at end
    .replace(/\s+[A-Z]{2}\s*$/, '')
    // Remove URLs
    .replace(/\s+\S+\.com\b/gi, '')
    // Remove numeric IDs
    .replace(/\s+#?\d{4,}/g, '')
    // Remove "Par*" / "Sq*" / "Tst*" prefixes (with asterisk)
    .replace(/^[A-Za-z]{2,4}\*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanFedWireName(raw: string): string {
  return raw
    .replace(/\s+srf#\S+/gi, '')
    .replace(/\s+ref#\S+/gi, '')
    .replace(/\s+\d{6,}/g, '')
    .replace(/\b[A-Z]{1,4}\b/g, (m) => (m.length <= 4 && m === m.toUpperCase() ? '' : m))
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase())
    .replace(/\bLlc\b/g, 'LLC')
    .replace(/\bInc\b/g, 'Inc.')
    .replace(/\bCorp\b/g, 'Corp.')
    .replace(/\bLlp\b/g, 'LLP')
    .replace(/\bAch\b/g, 'ACH')
    .replace(/\bAtm\b/g, 'ATM')
    .replace(/\bPos\b/g, 'POS')
    .trim()
}
