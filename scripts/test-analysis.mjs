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
  ['Zelle payment from Maria Bacon Conf# q1', 'Maria Bacon']
]

for (const [raw, want] of ZELLE_CASES) {
  const got = cleanTransaction(raw)
  ok(`zelle: ${want}`, got === want, `got "${got}"`)
}

ok(
  'no Zelle format resolves to the bare network name',
  !ZELLE_CASES.some(([raw]) => /^zelle$/i.test(cleanTransaction(raw)))
)

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('')
console.log(`  ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
