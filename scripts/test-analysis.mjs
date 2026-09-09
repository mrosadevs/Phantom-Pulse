#!/usr/bin/env node
/**
 * Round-trip the report parser and the analysis heuristics.
 *
 * These run against hand-built qbXML rather than a live company file, because
 * the failure modes worth catching here are shape problems — a nested
 * sub-report read as a flat list, a positional column landing in the wrong
 * place, a recurring monthly bill reported as a duplicate — and those reproduce
 * perfectly from a fixture.
 *
 *   npm run test:analysis
 *
 * The TypeScript is bundled through esbuild first because these modules import
 * each other by extensionless path, which Node's ESM loader will not resolve.
 */
import { parseReport, reportToRows } from '../src/main/qb/reports'
import { findDuplicates, findUncategorized, find1099Issues, runCloseChecks } from '../src/main/qb/analysis'
import { findCardPaymentMatches } from '../src/main/qb/cardPayments'
import { cleanTransaction } from '../src/renderer/src/utils/transactionCleaner'

let passed = 0
let failed = 0

function ok(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
    passed++
  } else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

// ── Report parsing ───────────────────────────────────────────────────────────

// A Balance Sheet shape: two columns, one nested sub-report, a subtotal and a
// total.  The nesting is the point — Checking sits UNDER Bank, and a parser
// that flattens it would make Bank and Checking look like peers.
const REPORT_XML = `<?xml version="1.0"?>
<QBXML><QBXMLMsgsRs>
<GeneralSummaryReportQueryRs requestID="1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">
<ReportRet>
  <ReportTitle>Balance Sheet</ReportTitle>
  <ReportSubtitle>As of December 31, 2026</ReportSubtitle>
  <ReportBasis>Accrual</ReportBasis>
  <ColDesc colID="1"><ColTitle>Dec 31, 26</ColTitle><ColType>Amount</ColType></ColDesc>
  <ReportData>
    <TextRow rowNumber="1"><RowData rowType="text" value="ASSETS"/></TextRow>
    <DataRow rowNumber="2">
      <RowData rowType="account" value="Bank"/>
      <ColData colID="1" value="15000.00"/>
    </DataRow>
    <ReportSubReport>
      <DataRow rowNumber="3">
        <RowData rowType="account" value="Checking"/>
        <ColData colID="1" value="12000.00"/>
      </DataRow>
      <DataRow rowNumber="4">
        <RowData rowType="account" value="Savings"/>
        <ColData colID="1" value="3000.00"/>
      </DataRow>
    </ReportSubReport>
    <SubtotalRow rowNumber="5">
      <RowData rowType="text" value="Total Bank"/>
      <ColData colID="1" value="15000.00"/>
    </SubtotalRow>
    <TotalRow rowNumber="6">
      <RowData rowType="text" value="TOTAL ASSETS"/>
      <ColData colID="1" value="15000.00"/>
    </TotalRow>
  </ReportData>
</ReportRet>
</GeneralSummaryReportQueryRs>
</QBXMLMsgsRs></QBXML>`

const report = parseReport(REPORT_XML, 'GeneralSummaryReportQueryRq')

ok('report title is read', report.title === 'Balance Sheet', report.title)
ok('report subtitle is read', report.subtitle === 'As of December 31, 2026', report.subtitle)
ok('report basis is read', report.basis === 'Accrual', report.basis)
ok('status is parsed as success', report.statusSeverity === 'Info', report.statusSeverity)

ok(
  'column heading lands at its colID, not its position',
  report.columns[1] === 'Dec 31, 26',
  JSON.stringify(report.columns)
)

ok('every row is captured', report.rows.length === 6, `got ${report.rows.length}`)

const byLabel = Object.fromEntries(report.rows.map((r) => [r.label, r]))

ok('top-level account sits at depth 0', byLabel['Bank']?.depth === 0, String(byLabel['Bank']?.depth))
ok(
  'nested sub-account sits at depth 1',
  byLabel['Checking']?.depth === 1,
  String(byLabel['Checking']?.depth)
)
ok(
  'nesting closes — the subtotal returns to depth 0',
  byLabel['Total Bank']?.depth === 0,
  String(byLabel['Total Bank']?.depth)
)

ok('row kinds are distinguished', byLabel['TOTAL ASSETS']?.kind === 'total')
ok('subtotal rows are distinguished', byLabel['Total Bank']?.kind === 'subtotal')
ok('text rows are distinguished', byLabel['ASSETS']?.kind === 'text')

ok(
  'values line up with their column',
  byLabel['Checking']?.cells[1] === '12000.00',
  JSON.stringify(byLabel['Checking']?.cells)
)

// Flattening for Excel must preserve the hierarchy as indentation, since a
// spreadsheet has no nesting to carry it.
const flat = reportToRows({ ...report, variant: 0 })
const checkingRow = flat.rows.find((r) => r[0].trim() === 'Checking')
ok('flattened rows keep hierarchy as indentation', checkingRow?.[0].startsWith('  '), checkingRow?.[0])
ok('flattened row keeps its value', checkingRow?.[1] === '12000.00', checkingRow?.[1])

// A rejected request must not look like an empty report.
const ERROR_XML = `<QBXML><QBXMLMsgsRs><GeneralSummaryReportQueryRs requestID="1" statusCode="3100" statusSeverity="Error" statusMessage="Invalid report type"/></QBXMLMsgsRs></QBXML>`
const errored = parseReport(ERROR_XML, 'GeneralSummaryReportQueryRq')
ok('a qbXML error is surfaced, not swallowed', errored.statusSeverity === 'Error')
ok('the error message survives', errored.statusMessage === 'Invalid report type', errored.statusMessage)

const MISSING_XML = `<QBXML><QBXMLMsgsRs></QBXMLMsgsRs></QBXML>`
const missing = parseReport(MISSING_XML, 'GeneralSummaryReportQueryRq')
ok('a missing response element counts as failure', missing.statusSeverity === 'Error')

// ── Duplicate detection ──────────────────────────────────────────────────────

const txn = (over) => ({
  type: 'Bill',
  txnId: Math.random().toString(36).slice(2),
  editSequence: '1',
  date: '2026-03-01',
  refNumber: '',
  memo: '',
  entity: 'Acme Supply',
  amount: 250,
  accounts: ['Office Supplies'],
  cleared: '',
  ...over
})

const sameDay = findDuplicates([txn({ date: '2026-03-01' }), txn({ date: '2026-03-02' })])
ok('same payee and amount days apart is flagged', sameDay.length === 1, `got ${sameDay.length}`)

const monthly = findDuplicates([
  txn({ date: '2026-01-01' }),
  txn({ date: '2026-02-01' }),
  txn({ date: '2026-03-01' })
])
ok(
  'a recurring monthly bill is NOT flagged',
  monthly.length === 0,
  `got ${monthly.length} — the date-gap clustering failed`
)

const distinctRefs = findDuplicates([
  txn({ date: '2026-03-01', refNumber: '1001' }),
  txn({ date: '2026-03-02', refNumber: '1002' })
])
ok(
  'identical amounts with different reference numbers are NOT flagged',
  distinctRefs.length === 0,
  `got ${distinctRefs.length}`
)

const sharedRef = findDuplicates([
  txn({ date: '2026-03-01', refNumber: '1001' }),
  txn({ date: '2026-03-02', refNumber: '1001' })
])
ok('a shared reference number IS flagged', sharedRef.length === 1, `got ${sharedRef.length}`)

const differentPayee = findDuplicates([txn({ entity: 'Acme' }), txn({ entity: 'Other Co' })])
ok('different payees are not grouped', differentPayee.length === 0)

const zeroAmount = findDuplicates([txn({ amount: 0 }), txn({ amount: 0 })])
ok('zero-amount transactions are ignored', zeroAmount.length === 0)

// ── Uncategorized sweep ──────────────────────────────────────────────────────

const accounts = [
  { listId: '1', editSequence: '1', name: 'Uncategorized Expense', isActive: true, extra: {} },
  { listId: '2', editSequence: '1', name: 'Ask My Accountant', isActive: true, extra: {} },
  { listId: '3', editSequence: '1', name: 'Office Supplies', isActive: true, extra: {} }
]

const uncat = findUncategorized(
  [
    txn({ accounts: ['Uncategorized Expense'] }),
    txn({ accounts: ['Ask My Accountant'] }),
    txn({ accounts: ['Office Supplies'] })
  ],
  accounts
)
ok('limbo accounts are detected', uncat.length === 2, `got ${uncat.length}`)
ok('a properly coded transaction is left alone', !uncat.some((u) => u.account === 'Office Supplies'))

const splitTxn = findUncategorized([txn({ accounts: ['Office Supplies', 'Ask My Accountant'] })], accounts)
ok('a split touching limbo is reported once', splitTxn.length === 1, `got ${splitTxn.length}`)

// ── 1099 readiness ───────────────────────────────────────────────────────────

const vendors = [
  { listId: 'v1', editSequence: '1', name: 'Big Contractor', isActive: true, extra: {} },
  {
    listId: 'v2',
    editSequence: '1',
    name: 'Flagged No TIN',
    isActive: true,
    extra: { IsVendorEligibleFor1099: 'true' }
  },
  {
    listId: 'v3',
    editSequence: '1',
    name: 'All Good',
    isActive: true,
    extra: { IsVendorEligibleFor1099: 'true', VendorTaxIdent: '12-3456789' }
  },
  { listId: 'v4', editSequence: '1', name: 'Small Fry', isActive: true, extra: {} }
]

const payments = [
  txn({ entity: 'Big Contractor', amount: 5000, type: 'Check' }),
  txn({ entity: 'Flagged No TIN', amount: 2000, type: 'Bill' }),
  txn({ entity: 'All Good', amount: 3000, type: 'Check' }),
  txn({ entity: 'Small Fry', amount: 100, type: 'Check' })
]

const rows1099 = find1099Issues(vendors, payments)
const names = rows1099.map((r) => r.vendor)

ok('over threshold but unflagged is caught', names.includes('Big Contractor'))
ok('flagged without a tax ID is caught', names.includes('Flagged No TIN'))
ok('a correctly set up vendor is not flagged', !names.includes('All Good'), names.join(', '))
ok('a small unflagged vendor is not flagged', !names.includes('Small Fry'))
ok(
  'rows are sorted by amount paid, descending',
  rows1099[0]?.vendor === 'Big Contractor',
  rows1099[0]?.vendor
)
ok(
  'payment totals are summed correctly',
  rows1099.find((r) => r.vendor === 'Big Contractor')?.paid === 5000
)

// ── Close checklist ──────────────────────────────────────────────────────────

const cleanChecks = runCloseChecks([txn({})], accounts, [], [])
ok('a clean file passes the uncategorized check', cleanChecks.find((c) => c.id === 'uncategorized')?.status === 'pass')
ok('a clean file passes the duplicates check', cleanChecks.find((c) => c.id === 'duplicates')?.status === 'pass')

const dirtyChecks = runCloseChecks(
  [txn({ entity: '' }), txn({ type: 'Journal Entry', memo: '' })],
  accounts,
  uncat,
  sameDay
)
ok('uncategorized rows fail the close check', dirtyChecks.find((c) => c.id === 'uncategorized')?.status !== 'pass')
ok('a missing payee is caught', dirtyChecks.find((c) => c.id === 'missing-payee')?.count === 1)
ok('an unexplained journal entry is caught', dirtyChecks.find((c) => c.id === 'je-memo')?.count === 1)

const futureChecks = runCloseChecks([txn({ date: '2099-01-01' })], accounts, [], [])
ok('a future-dated transaction is caught', futureChecks.find((c) => c.id === 'future-dated')?.count === 1)

// Two clusters out of one bucket must not share a key.  The UI keys its rows
// and tracks which group is expanded by this value, so a repeat merges two
// separate findings into one row.
const twoClusters = findDuplicates([
  txn({ date: '2026-03-01' }),
  txn({ date: '2026-03-02' }),
  txn({ date: '2026-06-01' }),
  txn({ date: '2026-06-02' })
])
ok('a bucket splits into two clusters', twoClusters.length === 2, `got ${twoClusters.length}`)
ok(
  'cluster keys are unique',
  new Set(twoClusters.map((g) => g.key)).size === twoClusters.length,
  twoClusters.map((g) => g.key).join(' | ')
)

// ── Zelle payee extraction ───────────────────────────────────────────────────
//
// Every bank wraps the same sentence differently.  What must never happen is a
// fall through to the bare network name: "Zelle" is a prefix of any badly
// named QuickBooks payee like "Zelle From Omar Aguilera on 09/22 Ref # B", and
// the matcher will then file every unrelated sender in the statement under
// that one person.
const ZELLE_CASES = [
  ['ZELLE BUSINESS PAYMENT FROM DESIREE GOMEZ PAYMENT ID BACziwebiabt', 'Desiree Gomez'],
  ['ZELLE BUSINESS PAYMENT FROM LEONARDO BRACHO PAYMENT ID JPM99bwo576l', 'Leonardo Bracho'],
  ['ZELLE BUSINESS PAYMENT FROM ANGEL JOSE ARAUJO ROMERO PAYMENT ID 0OU0QBO1TZMD', 'Angel Jose Araujo Romero'],
  ['ZELLE BUSINESS PAYMENT TO Becxi Santos PAYMENT ID BBT353897335', 'Becxi Santos'],
  ['Zelle payment from JOHN DOE Conf# abc123', 'John Doe'],
  ['Zelle payment from JOHN DOE for "rent"', 'John Doe'],
  ['Zelle payment to JANE ROE Conf# xyz', 'Jane Roe'],
  ['Zelle to JANE ROE on 03/12 Ref # abc123', 'Jane Roe'],
  ['Zelle From Christine Taylor on 03/12 Ref # Ctz01Zf2Hn5C One Month Security', 'Christine Taylor'],
  ['Zelle Payment From MARIA LOPEZ CA', 'Maria Lopez'],
  // A reference code prefix is also the start of a surname; six trailing
  // characters is what separates "BACziwebiabt" from "Bacon".
  ['Zelle payment from Maria Bacon Conf# q1', 'Maria Bacon'],

  // Chase's Spanish statements wrap the same sentence in a translated clause
  // naming the transaction type, and mint payment IDs under prefixes no list
  // will finish enumerating.  The counterparty is still the payee.
  [
    'Transferencia externa para depÓsito quickpay por internet. Zelle payment from david mejiasanchez pncaa0cjm61X',
    'David Mejiasanchez'
  ],
  ['DepÓsito quickpay por internet. Zelle payment from marco cassabgi 30263857088', 'Marco Cassabgi'],
  ['Retiro quickpay por internet. Zelle payment to marcos touma 30265805496', 'Marcos Touma'],
  [
    'Retiro quickpay por internet para transferencia externa. Zelle payment to accuracy consulting group inc jpm99csp53im',
    'Accuracy Consulting Group Inc.'
  ],
  // A payee whose own name opens with digits must survive the payment-ID rule.
  ['Retiro quickpay por internet. Zelle payment to 2912 downtown LLC 30264530841', '2912 Downtown LLC'],
  ['Retiro quickpay por internet. Zelle payment to 414 all services LLC 30291026329', '414 All Services LLC']
]

for (const [raw, want] of ZELLE_CASES) {
  const got = cleanTransaction(raw)
  ok(`zelle: ${want}`, got === want, `got "${got}"`)
}

ok(
  'no Zelle format resolves to the bare network name',
  !ZELLE_CASES.some(([raw]) => /^zelle$/i.test(cleanTransaction(raw)))
)

// ── Spanish-language statements ──────────────────────────────────────────────
//
// Chase issues the same statement in Spanish and translates only the leading
// clause; the detail after the full stop is the identical English text.  The
// clause has to be stripped for any of the English rules to fire — without it
// every payee arrived as the whole Spanish sentence and nothing matched.

const SPANISH_CASES = [
  [
    'DÉbito de cÁmara de compensaciÓn automatizada. Orig CO name:fpl direct debit orig ID:3590247775 desc date:08/26',
    'Florida Power & Light'
  ],
  [
    'DepÓsito de cÁmara de compensaciÓn automatizada. Orig CO name:airbnb 4977 orig ID:1463165559 desc date:aug 17',
    'Airbnb'
  ],
  ['Compra con tarjeta. Card purchase 08/04 staples 1831 miami FL card 1796', 'Staples Miami'],
  [
    'DevoluciÓn de compra con tarjeta. Card purchase return 08/19 amazon mktplace pmts amzn.Com/bill WA card 1796',
    'Amazon Mktplace Pmts'
  ],
  // English lines that merely contain a full stop must not be read as Spanish
  // and have their opening clause thrown away.  The Spanish nouns are chosen
  // so that none of them is also an English word: "depósito" is matched, but
  // "deposit" is not, and neither is "debit", "transfer" or "check".
  ['Purchase authorized on 04/12 Cargo Express Inc. Miami FL', 'Cargo Express Inc. Miami'],
  ['Deposit from Compass Inc. ref 8812', 'Deposit From Compass Inc. Ref'],
  ['Debit for Sunshine Co. monthly', 'Debit For Sunshine Co. Monthly']
]

for (const [raw, want] of SPANISH_CASES) {
  const got = cleanTransaction(raw)
  ok(`spanish: ${want}`, got === want, `got "${got}"`)
}

// ── Credit card payment duplicates ───────────────────────────────────────────

// A payment to a card is on two statements at once.  These fixtures are the
// four shapes it takes in a company file — and the fifth case, a refund, which
// has no bank-side counterpart and must never be withheld.

const CARD = 'Chase Credit Card'

/** Wrap Ret blocks in the response envelope runPaged expects. */
function qbResponse(rq, inner) {
  const rs = rq.replace(/Rq$/, 'Rs')
  return (
    `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>` +
    `<${rs} requestID="scan_0" statusCode="0" statusSeverity="Info" statusMessage="Status OK">` +
    inner +
    `</${rs}></QBXMLMsgsRs></QBXML>`
  )
}

/** A sender that answers each query type from a fixture table. */
function senderFor(byRq) {
  return async (xml) => {
    const rq = xml.match(/<(\w+QueryRq)\b/)?.[1] ?? ''
    return qbResponse(rq, byRq[rq] ?? '')
  }
}

// A Check drawn on checking and coded to the card account.
const CHECK_TO_CARD = `<CheckRet>
  <TxnID>CHK-1</TxnID><TxnDate>2026-03-14</TxnDate><RefNumber>1042</RefNumber>
  <AccountRef><FullName>Chase Checking</FullName></AccountRef>
  <Amount>2450.00</Amount>
  <ExpenseLineRet><TxnLineID>1</TxnLineID>
    <AccountRef><FullName>${CARD}</FullName></AccountRef><Amount>2450.00</Amount>
  </ExpenseLineRet>
</CheckRet>`

// A Transfer, which names its accounts TransferFrom/ToAccountRef — the shape a
// plain <AccountRef> search misses entirely.
const TRANSFER_TO_CARD = `<TransferRet>
  <TxnID>TRF-1</TxnID><TxnDate>2026-03-28</TxnDate>
  <TransferFromAccountRef><FullName>Chase Checking</FullName></TransferFromAccountRef>
  <TransferToAccountRef><FullName>${CARD}</FullName></TransferToAccountRef>
  <Amount>1100.00</Amount>
</TransferRet>`

// A Journal Entry crediting the card: no header total at all.
const JE_TO_CARD = `<JournalEntryRet>
  <TxnID>JE-1</TxnID><TxnDate>2026-03-05</TxnDate>
  <JournalDebitLine><AccountRef><FullName>${CARD}</FullName></AccountRef><Amount>500.00</Amount></JournalDebitLine>
  <JournalCreditLine><AccountRef><FullName>Chase Checking</FullName></AccountRef><Amount>500.00</Amount></JournalCreditLine>
</JournalEntryRet>`

const rowsIn = [
  { id: 1, date: '2026-03-15', amount: -2450.0 }, // paid by check on the 14th
  { id: 2, date: '2026-03-28', amount: -1100.0 }, // paid by transfer, same day
  { id: 3, date: '2026-03-06', amount: -500.0 }, // journal entry on the 5th
  { id: 4, date: '2026-03-22', amount: -84.19 } // a refund — nothing to match
]

const full = await findCardPaymentMatches(
  senderFor({
    CheckQueryRq: CHECK_TO_CARD,
    TransferQueryRq: TRANSFER_TO_CARD,
    JournalEntryQueryRq: JE_TO_CARD
  }),
  { account: CARD, rows: rowsIn }
)

const matchedIds = full.matches.map((m) => m.rowId).sort()
ok('card: check, transfer and journal entry all match', String(matchedIds) === '1,2,3', String(matchedIds))
ok('card: a refund with no counterpart is not withheld', !full.matches.some((m) => m.rowId === 4))
ok(
  'card: the match names the account it was paid from',
  full.matches.find((m) => m.rowId === 1)?.existing.otherAccount === 'Chase Checking'
)
ok('card: a clean read is not reported incomplete', full.incomplete === false)

// The card account is the whole point of the filter: an identical payment to a
// DIFFERENT card must not suppress this one.
const otherCard = await findCardPaymentMatches(
  senderFor({ CheckQueryRq: CHECK_TO_CARD.replace(CARD, 'Amex Card') }),
  { account: CARD, rows: [rowsIn[0]] }
)
ok('card: a payment to another card is not a match', otherCard.matches.length === 0)

// Outside the tolerance window it is a different payment, not this one.
const stale = await findCardPaymentMatches(senderFor({ CheckQueryRq: CHECK_TO_CARD }), {
  account: CARD,
  rows: [{ id: 1, date: '2026-04-20', amount: -2450.0 }]
})
ok('card: same amount five weeks later is not a match', stale.matches.length === 0)

// Two identical payments in one month against one recorded check: the check can
// only account for one of them, or a real payment goes missing.
const twice = await findCardPaymentMatches(senderFor({ CheckQueryRq: CHECK_TO_CARD }), {
  account: CARD,
  rows: [
    { id: 1, date: '2026-03-14', amount: -2450.0 },
    { id: 2, date: '2026-03-16', amount: -2450.0 }
  ]
})
ok('card: one existing payment claims only one row', twice.matches.length === 1, `matched ${twice.matches.length}`)

// A failed query must not read as "nothing found".
const broken = await findCardPaymentMatches(
  async (xml) => {
    const rq = xml.match(/<(\w+QueryRq)\b/)?.[1] ?? ''
    if (rq === 'CheckQueryRq') {
      return `<?xml version="1.0"?><QBXML><QBXMLMsgsRs><CheckQueryRs requestID="scan_0" statusCode="3100" statusSeverity="Error" statusMessage="Query failed"/></QBXMLMsgsRs></QBXML>`
    }
    return qbResponse(rq, '')
  },
  { account: CARD, rows: [rowsIn[0]] }
)
ok('card: a failed query reports incomplete rather than all-clear', broken.incomplete === true)


// ── Summary ──────────────────────────────────────────────────────────────────

console.log('')
console.log(`  ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
