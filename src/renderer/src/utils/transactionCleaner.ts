/**
 * Transaction description cleaner — merges Phantom Ledger (server/transactionCleaner.js)
 * patterns with Phantom Pulse's extended normalization map.
 *
 * Order: specific named patterns first (wire, Zelle, ACH, card), then generic fallbacks,
 * then the normalization map.
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
  'WHOLEFDS': 'Whole Foods',
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
  'CHARLOTTE UTILTY': 'Charlotte County Utilities',
  'FPL DIRECT': 'Florida Power & Light',
  'FPL GROUP': 'Florida Power & Light',
  'FPL DIRECT DEBIT': 'Florida Power & Light',
  'LEE COUNTY': 'Lee County Tax Collector',
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
  'PARKWAY': 'Parkway Parking',
  'MOTORCYCLE SPARE PARTS MAX IMPORT': 'Motorcycle Spare Parts Max Import LLC',
  'MOTORCYCLE SPARE PARTS MAX IMPORT L': 'Motorcycle Spare Parts Max Import LLC',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip Srf# references and trailing short bank codes (≤4 chars) — Phantom Ledger logic */
function cleanFedWireName(raw: string): string {
  let name = String(raw || '').trim()
  const srfIdx = name.toLowerCase().indexOf(' srf#')
  if (srfIdx !== -1) {
    const parts = name.substring(0, srfIdx).split(' ')
    while (parts.length && parts[parts.length - 1].length <= 4) parts.pop()
    name = parts.join(' ')
  }
  // Additional cleanup
  name = name
    .replace(/\s+ref#\S+/gi, '')
    .replace(/\s+\d{6,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return name
}

function stripBankCodes(s: string): string {
  return s
    .replace(/\b(bac|wfct|usaa|jpmc|citi|boa)\b/gi, '')
    .replace(/\b\d{6,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripCardNoise(s: string): string {
  return s
    .replace(/\s+card[\s#*]*\d{4,}/gi, '')
    .replace(/\s+\d{1,2}\/\d{2}\b/g, '')
    .replace(/\s+[A-Z][a-zA-Z]+\s+[A-Z]{2}\s*$/, '')
    .replace(/\s+[A-Z]{2}\s*$/, '')
    .replace(/\s+\S+\.com\b/gi, '')
    .replace(/\s+#?\d{4,}/g, '')
    .replace(/^[A-Za-z]{2,4}\*/i, '')
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

// ── Main cleaner ──────────────────────────────────────────────────────────────

export function cleanTransaction(raw: string): string {
  if (!raw || raw.trim().length === 0) return raw

  const m = raw.trim()

  // ── MISC DEPOSIT PAY ID ... ORG ID ... NAME <person> ──
  const miscDepositName = m.match(/^MISC DEPOSIT PAY ID \S+ ORG ID \S+ NAME (.+)$/i)
  if (miscDepositName) return titleCase(miscDepositName[1].trim())

  // ── OTHER/WITHDRAWAL/ADJ PAY ID ... NAME <person> ──
  const adjName = m.match(/^OTHER\/WITHDRAWAL\/ADJ PAY ID \S+ ORG ID \S+ NAME (.+)$/i)
  if (adjName) return titleCase(adjName[1].trim())

  // ── INSTANT PAYMENT DEBIT <trackingId> <merchant> ──
  const instantPayment = m.match(/^INSTANT PAYMENT DEBIT\s+\d{12,}\S*\s+(.+)$/i)
  if (instantPayment) return titleCase(instantPayment[1].trim())

  // ── WIRE TYPE:WIRE IN ──
  if (/^WIRE TYPE:WIRE IN/i.test(m)) {
    const orig = m.match(/ORIG:(.+?)\s+ID:/i)
    if (orig) return titleCase(orig[1].trim())
    return 'Wire In'
  }

  // ── WIRE TYPE:WIRE OUT ──
  if (/^WIRE TYPE:WIRE OUT/i.test(m)) {
    const bnf = m.match(/BNF:(.+?)\s+ID:/i)
    if (bnf) return titleCase(bnf[1].trim())
    return 'Wire Out'
  }

  // ── WT Fed# (Chase wire format) ──
  // Examples: "WT Fed#02946 Bank of America /Org=1/Gizel Anabel → Gizel Anabel"
  //           "WT Fed#01328 National Bank /Ftr/Bnf=Nicolas Jose → Nicolas Jose"
  if (/^WT Fed#/i.test(m)) {
    const ftrBnf = m.match(/\/Ftr\/Bnf=(.+?)(?:\s+Srf#|\s*$)/i)
    if (ftrBnf) return titleCase(cleanFedWireName(ftrBnf[1]))

    const bnf = m.match(/\/Bnf=(.+?)(?:\s+Srf#|\s*$)/i)
    if (bnf) return titleCase(cleanFedWireName(bnf[1]))

    // /Org= may have a leading digit-slash prefix (e.g. "1/Gizel Anabel")
    const org = m.match(/\/Org=(?:\d+\/)?(.+)/i)
    if (org) return titleCase(cleanFedWireName(org[1]))
  }

  // ── WT <date-ref> format (e.g. "WT 250218-211513 Bank of China /Bnf=Linyi United") ──
  if (/^WT\s+\d/.test(m)) {
    const bnfSrf = m.match(/\/Bnf=(.+?)\s+Srf#/i)
    if (bnfSrf) {
      let name = bnfSrf[1].trim()
      name = name.replace(/^G\s+/, '').replace(/\s+CO,.*/, '').replace(/\s+CA,.*/, '')
      return titleCase(name.trim())
    }
    const bankBnf = m.match(/^WT\s+\S+\s+(.+?)\s+\/Bnf=/i)
    if (bankBnf) return titleCase(bankBnf[1].trim())

    const beforeOrg = m.match(/^WT\s+\S+\s+(.+?)\s+\/Org=/i)
    if (beforeOrg) return titleCase(beforeOrg[1].trim())
  }

  // ── FUNDS TRANSFER WIRE FROM <name> <Month DD> ──
  const wireFrom = m.match(/^FUNDS TRANSFER WIRE FROM (.+?) [A-Za-z]{3} \d{1,2}$/i)
  if (wireFrom) {
    const wfName = wireFrom[1].trim()
    // Strip leading digit-slash prefix
    return titleCase((/^\d\//.test(wfName) && !wfName.includes(',')) ? wfName.replace(/^\d\//, '') : wfName)
  }

  // ── FUNDS TRN OUT CBOL / INT'L WIRE OUT CBOL WIRE TO <name> ──
  const wireTo = m.match(/^(?:FUNDS TRN OUT CBOL|INT'L WIRE OUT CBOL) WIRE TO (.+?)(?:\s+#\S+)?$/i)
  if (wireTo) return titleCase(wireTo[1].replace(/\s+SA$/i, '').trim())

  // ── SERVICE CHARGES INCOMING WIRE FEE ──
  if (/^SERVICE CHARGES INCOMING WIRE FEE\b/i.test(m)) return 'Incoming Wire Fee'

  // ── SERVICE FEE CHARGES FOR DOMESTIC / INTERNATIONAL FUNDS TRANSFER ──
  if (/^SERVICE FEE CHARGES FOR (?:DOMESTIC|INTERNATIONAL) FUNDS TRANSFER$/i.test(m)) return 'Service Fee'

  // ── External transfer fee ──
  if (/^External transfer fee/i.test(m)) return 'External Transfer Fee'

  // ── Wire Trans Svc Charge ──
  if (m.startsWith('Wire Trans Svc Charge')) return 'Wire Trans Svc Charge'

  // ── Wire fee exact matches ──
  if (m === 'Wire Transfer Fee') return 'Wire Transfer Fee'
  if (m === 'Domestic Incoming Wire Fee') return 'Domestic Wire Fee'
  if (m === 'Online Fx International Wire Fee') return 'International Wire Fee'
  if (m === 'Online US Dollar Intl Wire Fee') return 'Intl Wire Fee'

  // ── Fedwire Credit ──
  if (/^Fedwire Credit/i.test(m)) {
    const bo = m.match(/B\/O:\s*\d+\/(.+?)\s*\d\/US\//i)
    if (bo) return titleCase(bo[1].trim())
    const bnf = m.match(/Bnf=([^/]+)/i)
    if (bnf) return titleCase(bnf[1].replace(/\s+Miramar\s+FL.*/i, '').trim())
    return 'Fedwire Credit'
  }

  // ── Book Transfer Credit (specific) ──
  if (/^Book Transfer Credit/i.test(m)) {
    const org = m.match(/Org:\/\d+\s+(.+?)\s+Ref:/i)
    if (org) return titleCase(org[1].trim())
    const bo = m.match(/B\/O:\s*(.+?)(?:\s+(?:Ocala|Columbus|Miramar)\s)/i)
    if (bo) return titleCase(bo[1].trim())
    const bo2 = m.match(/B\/O:\s*(.+?)(?:\s+\w+\s+\w{2}\s+\d{5})/i)
    if (bo2) return titleCase(bo2[1].trim())
    return 'Book Transfer Credit'
  }

  // ── Online International Wire Transfer ──
  if (/^Online International Wire Transfer/i.test(m)) {
    const ben = m.match(/Ben:\/\d+\s+(.+?)\s+Ref:/i)
    if (ben) return titleCase(ben[1].trim())
    const ac = m.match(/A\/C:\s*(.+?)\s+Medellin/i)
    if (ac) return titleCase(ac[1].trim())
    return 'Online International Wire Transfer'
  }

  // ── Generic /Bnf= / /Org= / /Ftr/Bnf= wire fallback ──
  const ftrBnfGen = m.match(/\/ftr\/bnf=([^/\s](?:[^/]*[^/\s])?)/i)
  if (ftrBnfGen) return titleCase(cleanFedWireName(ftrBnfGen[1]))

  const bnfGen = m.match(/\/bnf=([^/\s](?:[^/]*[^/\s])?)/i)
  if (bnfGen) return titleCase(cleanFedWireName(bnfGen[1]))

  const orgGen = m.match(/\/org=([^/\s](?:[^/]*[^/\s])?)/i)
  if (orgGen) return titleCase(cleanFedWireName(orgGen[1]))

  // ── TRANSFER <direction>:<name> Confirmation# ──
  if (/^TRANSFER .+Confirmation#/i.test(m)) {
    const tfr = m.match(/^TRANSFER (.+?):(.+?)\s+Confirmation#/i)
    if (tfr) return `${titleCase(tfr[1].trim())} to ${titleCase(tfr[2].trim())}`
  }

  // ── Online Banking payment to CRD ──
  if (/^Online Banking payment to CRD/i.test(m)) {
    const crd = m.match(/CRD\s+(\S+)/i)
    return crd ? `Online Banking payment to CRD ${crd[1]}` : 'Online Banking payment'
  }

  // ── Zelle payment from <name> for "<memo>" ──
  if (/^Zelle payment from .+ for "/i.test(m)) {
    const z = m.match(/^Zelle payment from (.+?)\s+for\s+"/i)
    if (z) return titleCase(stripBankCodes(z[1]))
  }

  // ── Zelle payment from <name> [Conf#] ──
  if (/^Zelle payment from /i.test(m)) {
    const zConf = m.match(/^Zelle payment from (.+?)\s+Conf#/i)
    if (zConf) return titleCase(stripBankCodes(zConf[1]))
    let name = m.replace(/^Zelle payment from /i, '').trim()
    name = name.replace(/\s+(?:Bac|Wfct|Cof|Cti|Mac|Hna|H50|Bbt|0Ou)\S+.*/i, '')
    name = name.replace(/\s+\d{8,}.*/, '')
    return titleCase(name.trim())
  }

  // ── Zelle payment to <name> for "<memo>" ──
  if (/^Zelle payment to .+ for "/i.test(m)) {
    const z = m.match(/^Zelle payment to (.+?)\s+for\s+"/i)
    if (z) return titleCase(stripBankCodes(z[1]))
  }

  // ── Zelle payment to <name> [Conf#] ──
  if (/^Zelle payment to /i.test(m)) {
    const zConf = m.match(/^Zelle payment to (.+?)\s+Conf#/i)
    if (zConf) return titleCase(stripBankCodes(zConf[1]))
    let name = m.replace(/^Zelle payment to /i, '').trim()
    name = name.replace(/\s+(?:Bac|Wfct|Cof|Cti|Mac|Hna|H50|Bbt|0Ou)\S+.*/i, '')
    name = name.replace(/\s+\d{8,}.*/, '')
    return titleCase(name.trim())
  }

  // ── Zelle to <name> on MM/DD Ref# (old format) ──
  if (/^Zelle to /i.test(m)) {
    const zRef = m.match(/^Zelle to (.+?)\s+on\s+\d+\/\d+\s+Ref\s+#/i)
    if (zRef) return titleCase(stripBankCodes(zRef[1]))
    return titleCase(m.replace(/^Zelle to /i, '').replace(/\s+Ref\s+#\S+.*/i, '').trim())
  }

  // ── Zelle Payment From (old capitalized format) ──
  if (m.startsWith('Zelle Payment From ')) {
    let name = m.replace(/^Zelle Payment From /, '')
    name = name.replace(/\s+(?:Bac|Wfct|Cof|Cti|Mac|Hna|H50|Bbt|0Ou)\S+.*/, '')
    name = name.replace(/\s+\d{8,}.*/, '')
    name = name.replace(/\s+CA$/, '').trim()
    return titleCase(name)
  }

  // ── Mobile transfer from CHK N Confirmation#; Last, First ──
  if (/^Mobile transfer from CHK/i.test(m)) {
    const conf = m.match(/^Mobile transfer from CHK \d+ Confirmation#\s*\S+;\s*(.+)$/i)
    if (conf) {
      const namePart = conf[1].trim()
      const commaIdx = namePart.indexOf(',')
      if (commaIdx !== -1) {
        const last = namePart.substring(0, commaIdx).trim()
        const first = namePart.substring(commaIdx + 1).trim()
        return last === first ? titleCase(last) : titleCase(`${first} ${last}`)
      }
      return titleCase(namePart)
    }
    return 'Mobile Transfer'
  }

  // ── Online transfer from CHK N Confirmation#; Last, First ──
  if (/^Online transfer from CHK/i.test(m)) {
    const conf = m.match(/^Online transfer from CHK \d+ Confirmation#\s*\S+;\s*(.+)$/i)
    if (conf) {
      const namePart = conf[1].trim()
      const commaIdx = namePart.indexOf(',')
      if (commaIdx !== -1) {
        const last = namePart.substring(0, commaIdx).trim()
        const first = namePart.substring(commaIdx + 1).trim()
        return last === first ? titleCase(last) : titleCase(`${first} ${last}`)
      }
      return titleCase(namePart)
    }
    return 'Online Transfer'
  }

  // ── Online transfer to CHK ──
  if (/^Online transfer to CHK/i.test(m)) {
    const acct = m.match(/^Online transfer to CHK\s+\.{0,3}(\d+)/i)
    if (acct) return `Transfer to CHK ${acct[1]}`
    return 'Online Transfer'
  }

  // ── Mobile transfer to chk (old format) ──
  if (/^Mobile transfer to chk/i.test(m)) {
    const acct = m.match(/CHK\s+(\S+)/i)
    if (acct) return `Transfer to CHK ${acct[1].replace(/;$/, '')}`
    return 'Mobile Transfer'
  }

  // ── Online Transfer to <account name> ──
  if (m.startsWith('Online Transfer to ')) {
    let rest = m.replace(/^Online Transfer to /, '')
    rest = rest.replace(/\s+(?:Everyday|Business|Savings|Personal)\s+(?:Checking|Savings).*/i, '')
    rest = rest.replace(/\s+xxxxxx\d+.*/i, '')
    rest = rest.replace(/\s+Ref\s+#.*/i, '')
    return titleCase('Transfer to ' + rest.trim())
  }

  // ── Online Transfer To Chk (old format) ──
  if (/^Online Transfer To Chk/i.test(m)) return 'Online Transfer'

  // ── Orig CO Name: <name> CO Entry Descr: <descr> ──
  if (m.startsWith('Orig CO Name:')) {
    const descr = m.match(/CO Entry Descr:(\w+)/i)
    if (descr && !['ACH', 'PMT', 'ACHPMT'].includes(descr[1].toUpperCase())) {
      return titleCase(descr[1])
    }
    const co = m.match(/Orig CO Name:(.+?)\s+Orig\s+ID:/i)
    if (co) return titleCase(co[1].trim())
    return m
  }

  // ── Business to Business ACH Debit ──
  if (m.includes('Business to Business ACH Debit')) {
    const match1 = m.match(/Business to Business ACH Debit\s*-\s*(.+?)(?:\s+ACH\s+|\s+Retry|\s+\d)/i)
    if (match1) return titleCase(`${match1[1].trim()} ACH`)
    const match2 = m.match(/-\s*(.+)/i)
    if (match2) return titleCase(match2[1].trim())
    return 'Business to Business ACH'
  }

  // ── DEBIT CARD PURCH Card Ending in XX/XX DATE <merchant> ──
  if (/^DEBIT CARD PURCH Card Ending in /i.test(m)) {
    let rest = m.replace(/^DEBIT CARD PURCH Card Ending in \d+\s+\S+\s+\d+\s+[A-Za-z]{3}\s+\d{1,2}\s+/i, '')
    rest = rest.replace(/\s+[A-Za-z]{3}\s+\d{4}\b.*$/i, '')
    rest = rest.replace(/\s+\d{7,}.*$/i, '')
    rest = rest.replace(/\s+[A-Z]{2}\s+\d+\s*$/i, '')
    if (rest.trim()) return titleCase(rest.trim())
  }

  // ── Purchase authorized on / Recurring Payment authorized on / Purchase Intl ──
  for (const prefix of [
    'Purchase authorized on ',
    'Recurring Payment authorized on ',
    'Purchase Intl authorized on '
  ]) {
    if (m.startsWith(prefix)) {
      let rest = m.slice(prefix.length)
      rest = rest.replace(/^\d{2}\/\d{2}\s+/, '')
      rest = rest.replace(/\s+S\d{10,}\s+Card\s+\d+.*/, '')
      rest = rest.replace(/\s+[A-Z][a-z]{2}$/, '')
      rest = rest.replace(/\s+[A-Z]{2}$/, '')
      rest = rest.replace(/\s+\S+@\S+/, '')
      rest = rest.replace(/\s+Https?:\/\/\S+/i, '')
      return titleCase(rest.trim())
    }
  }

  // ── PURCHASE MMDD <merchant> ──
  if (m.startsWith('PURCHASE ')) {
    let rest = m.replace(/^PURCHASE\s+\d{4}\s+/, '')
    rest = rest.replace(/\s+\d{10,}.*/, '')
    rest = rest.replace(/\s+[A-Z]{2}$/, '')
    rest = rest.replace(/\*\S+/g, '').trim()
    return titleCase(rest.trim())
  }

  // ── CHECKCARD MMDD <merchant> ──
  if (m.startsWith('CHECKCARD ')) {
    let rest = m.replace(/^CHECKCARD\s+\d{4}\s+/, '')
    rest = rest.replace(/\s+\d{15,}.*/, '')
    rest = rest.replace(/\s+RECURRING\s+.*/, '')
    rest = rest.replace(/\s+CKCD\s+.*/, '')
    rest = rest.replace(/\s+\d{10}\s*.*/, '')
    rest = rest.replace(/\s+[A-Z]{2}$/, '')
    return titleCase(rest.trim())
  }

  // ── DEBIT CARD Card Ending in XXXX ──
  if (m.startsWith('DEBIT CARD Card Ending in ')) {
    let rest = m.replace(/^DEBIT CARD Card Ending in \d+\s+/, '')
    rest = rest.replace(/\s+[A-Z]{2,}(?:US)?\d{4}$/, '')
    rest = rest.replace(/\s+\d{4,}$/, '')
    rest = rest.replace(/\s+\d+\s+[A-Z]+\s+[A-Z]{2}$/, '')
    return titleCase(rest.trim())
  }

  // ── 4-digit check number only ──
  if (/^\d{4}$/.test(m)) return `Check ${m}`

  // ── DES: ACH fallback ──
  if (m.includes(' DES:')) {
    const before = m.match(/^(.+?)\s+DES:/i)
    if (before) return titleCase(before[1].trim())
  }

  // ── Raw store format — ends with STATE CODE + 15-digit tracking ──
  if (/\s[A-Z]{2}\s\d{15,}$/.test(m)) {
    let rest = m.replace(/\s[A-Z]{2}\s\d{15,}$/, '')
    rest = rest.replace(/\s+\d{10}\s*$/, '')
    rest = rest.replace(/\*+/g, ' ').trim()
    rest = rest.replace(/\s{2,}/g, ' ').trim()
    return titleCase(rest)
  }

  // ── Generic wire mention ──
  let match = m.match(/^(?:funds\s+transfer\s+)?wire\s+(?:type:\s*\S+\s+)?(?:out|in)?\s*(?:benef(?:iciary)?:|to\s+)?(.+?)(?:\s+ref#|\s+routing|\s+aba|\s+srf#|\s+ftr|\s+id:|\s+\d{6,}|$)/i)
  if (match && match[1].trim().length > 2) return titleCase(match[1].trim())

  // ── ACH company name ──
  match = m.match(/^ach\s+(?:debit|credit|payment|transfer)[\s:]+(.+?)(?:\s+(?:ppd|ccd|web|tel)\s+id:|\s+\d{6,}|$)/i)
  if (match) return titleCase(match[1].trim())

  match = m.match(/^(?:ppd|ccd|web|tel)\s+(?:debit|credit)[\s:]+(.+?)(?:\s+id:|\s+\d{6,}|$)/i)
  if (match) return titleCase(match[1].trim())

  // ── Misc / other deposit ──
  match = m.match(/^(?:misc|other)\s+(?:deposit|withdrawal|adj(?:ustment)?)[\s:]+(.+)/i)
  if (match) return titleCase(match[1].trim())

  // ── Generic debit/credit card purchase prefixes ──
  match = m.match(/^(?:debit\s+card\s+purch(?:ase)?|checkcard\s+purchase|credit\s+card\s+(?:purch(?:ase)?|credit))[\s#*]+(.+)/i)
  if (match) return titleCase(stripCardNoise(match[1]))

  match = m.match(/^card\s+purchase\s+\d{1,2}\/\d{2}\s+(.+?)(?:\s+card\s+\d{4})?$/i)
  if (match) return titleCase(stripCardNoise(match[1]))

  match = m.match(/^pos\s+(?:purchase|debit|credit)[\s*-]+(.+)/i)
  if (match) return titleCase(stripCardNoise(match[1]))

  match = m.match(/^recurring\s+(?:card|debit|credit)\s+(?:purchase|payment)[\s*]+(.+)/i)
  if (match) return titleCase(stripCardNoise(match[1]))

  // ── Mobile / online transfers (generic) ──
  match = m.match(/^mobile\s+transfer\s+from\s+\S+\s+to\s+(.+)/i)
  if (match) return titleCase(match[1].trim())

  match = m.match(/^online\s+transfer\s+to\s+\S+\s+\((.+?)\)/i)
  if (match) return titleCase(match[1].trim())

  match = m.match(/^online\s+(?:banking\s+)?(?:transfer|payment)\s+(?:to|from)\s+(.+?)(?:\s+conf#|\s+\d{6,}|$)/i)
  if (match) return titleCase(match[1].trim())

  // ── Checks ──
  match = m.match(/^check(?:\s+card)?[\s#]+(\d+)/i)
  if (match) return `Check #${match[1]}`

  match = m.match(/^e-?check\s+(?:payment\s+)?(?:to\s+)?(.+)/i)
  if (match) return titleCase(match[1].trim())

  // ── Fee patterns ──
  if (/^overdraft\s+(?:protection\s+)?fee/i.test(m)) return 'Overdraft Fee'
  if (/^OVERDRAFT ITEM FEE/i.test(m)) return 'Overdraft Fee'
  if (/^monthly\s+(?:maintenance\s+|service\s+)?fee/i.test(m)) return 'Monthly Fee'
  if (/^Monthly Fee Business/i.test(m)) return 'Monthly Fee'
  if (/^finance\s+charge/i.test(m)) return 'Finance Charge'
  if (/^late\s+(?:payment\s+)?fee/i.test(m)) return 'Late Fee'
  if (/^LATE PAYMENT FEE/i.test(m)) return 'Late Payment Fee'
  if (/^(?:annual|membership)\s+fee/i.test(m)) return 'Annual Fee'
  if (/^returned\s+(?:item|check|payment)/i.test(m)) return 'Returned Item'
  if (m === 'RETURN ITEM CHARGEBACK') return 'Return Item Chargeback'
  if (/^nsf\s+(?:fee|charge)/i.test(m)) return 'NSF Fee'
  if (/^service\s+charge/i.test(m)) return 'Service Charge'
  if (/^SERVICE CHARGE ACCT/i.test(m)) return m
  if (/^interest\s+(?:charge|payment)/i.test(m)) return 'Interest Charge'
  if (/^wire\s+(?:transfer\s+)?fee/i.test(m)) return 'Wire Fee'

  // ── Direct deposit / payroll ──
  match = m.match(/^(?:direct\s+deposit|payroll)\s+(.+?)(?:\s+(?:ppd|ccd)\s+id:|\s+\d{6,}|$)/i)
  if (match) return titleCase(match[1].trim())

  // ── ATM ──
  match = m.match(/^atm\s+(?:cash\s+)?(?:withdrawal|deposit)[\s*-]+(.+?)(?:\s+\d{6,}|\s+card\s+\d{4}|$)/i)
  if (match) return `ATM - ${titleCase(stripCardNoise(match[1]))}`
  if (/^atm/i.test(m)) return 'ATM Withdrawal'

  // ── Square / Toast POS ──
  match = m.match(/^(?:sq|sq\*|sq \*|square\*)[\s*]+(.+)/i)
  if (match) return titleCase(stripCardNoise(match[1]))

  match = m.match(/^tst\*\s*(.+)/i)
  if (match) return titleCase(stripCardNoise(match[1]))

  // ── Stripe / PayPal ──
  match = m.match(/^stripe\*\s*(.+)/i)
  if (match) return titleCase(match[1].trim())

  match = m.match(/^paypal\s+\*\s*(.+)/i)
  if (match) return titleCase(match[1].trim())

  // ── Zelle (generic) ──
  match = m.match(/^zelle\s+(?:payment\s+)?(?:to|from)\s+(.+?)(?:\s+memo:.*)?$/i)
  if (match) return titleCase(stripBankCodes(match[1]))

  match = m.match(/^zelle\s+(?:payment\s+)(.+)$/i)
  if (match) return titleCase(stripBankCodes(match[1]))

  // ── Book Transfer (generic) ──
  match = m.match(/^book\s+transfer\s+(?:credit|debit)/i)
  if (match) return 'Book Transfer'

  // ── OTHER/WITHDRAWAL/ADJ with NAME field ──
  if (/^(?:OTHER|WITHDRAWAL|ADJ)/i.test(m)) {
    const nameMatch = m.match(/NAME:\s*(.+?)(?:\s+(?:ID:|MEMO:|$))/i)
    if (nameMatch) return titleCase(nameMatch[1].trim())
  }

  // ── Generic: apply normalization map then return ──
  const cleaned = stripCardNoise(m)
  const normalized = applyNormalizationMap(cleaned)
  if (normalized !== cleaned) return normalized

  return titleCase(cleaned)
}

// ── Normalization map lookup ──────────────────────────────────────────────────

export function applyNormalizationMap(name: string): string {
  const upper = name.toUpperCase().trim()
  if (normalizeMap[upper]) return normalizeMap[upper]
  for (const [key, val] of Object.entries(normalizeMap)) {
    if (upper.startsWith(key)) return val
  }
  return name
}

export function cleanAndNormalizeTransaction(raw: string): string {
  const cleaned = cleanTransaction(raw)
  return applyNormalizationMap(cleaned)
}
