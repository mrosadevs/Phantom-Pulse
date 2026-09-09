# Changelog

## v1.3.3 — September 9, 2026

**Fixed — credit card charges can be deleted.** The Delete screen sends the
transaction type QuickBooks asks for by name, and it was sending the label
shown in the dropdown rather than the name the SDK accepts: "Credit Card
Charge" where QuickBooks wants "CreditCardCharge". QuickBooks rejected the
whole request as malformed, so nothing was deleted and the reason given back
was the generic parsing error. It applied to one transaction exactly as it
applied to a hundred. Every multi-word type was affected — credit card charges
and credits, journal entries, bill payments, sales receipts, purchase orders —
while checks, bills and deposits worked, because for those the label and the
SDK name happen to be the same word. Finding and exporting those types was
never affected, which is why the screen could list transactions it then refused
to delete.

**Fixed — a slow write no longer takes QuickBooks down mid-import.** Pulse gave
each write thirty seconds and, when that ran out, killed the connection to get
control back. Thirty seconds is less than a single transaction can honestly
take against a large company file — the first write after the file is opened,
one arriving while QuickBooks is rebuilding an index, or any write QuickBooks
parks behind a dialog of its own. QuickBooks was then left holding a request
whose caller had vanished, which is what crashed it, and the import stopped
partway with the rows written so far still in the file. Writes now have three
minutes, which is longer than the slow cases and still short enough to report a
genuine hang.

**Fixed — an interrupted import stops instead of failing every remaining row.**
Once the connection was lost, Pulse kept sending the rest of the batch into it
and reported each row as its own failure, burying the one error that mattered.
A lost connection now ends the run and says so plainly, naming the rows that
were never attempted so it is clear what still has to be imported.

**Fixed — payees survive a retry.** Names QuickBooks had accepted or refused
were remembered for as long as Pulse stayed open, and a name that failed only
because the connection dropped was remembered as refused. Re-running the import
without restarting Pulse booked those rows with no payee at all, silently. What
QuickBooks said about a name is no longer remembered past the run it was said
in, and a name that never reached QuickBooks is not treated as an answer.

## v1.3.2 — September 9, 2026

**Fixed — Spanish-language statements are read as statements.** Chase issues
the same statement in Spanish, and Pulse got it wrong in every way at once. The
accented column heading "DESCRIPCIÓN" was not recognised, so no section was
found — and without a section, deposits and withdrawals could not be told
apart, surnames printed on the following line were dropped, and any row showing
a second date was discarded outright. One August statement extracted 44 rows
where the bank counts 51, with six ACH debits posted as deposits, and not one
of the statement's printed totals could be reconciled. It now extracts all 51
and ties to the cent against all four of the statement's own checks.

Every payee on that file also arrived as the whole Spanish sentence, so nothing
matched an existing QuickBooks name. The translated clause naming the
transaction type is now stripped, and the English rules run on the detail
behind it — the same detail a US statement carries.

**Fixed — Zelle payments are named wherever the network appears.** The rule
only looked at the start of the line, so a Zelle payment introduced by anything
else went unread. Payment reference codes are now recognised by their shape
rather than by a list of issuer prefixes, so a new one no longer ends up inside
the payee's name.

**Fixed — ACH transfers name the company again.** "Orig CO Name:" was matched
case-sensitively, so a fifth of a Spanish statement arrived as its own raw ACH
trace record instead of a payee.

Verified against 220 client statements with no regressions; two further Spanish
files now validate that previously could not.

## v1.3.1 — September 6, 2026

**Fixed — every Zelle transfer keeps its own name.** Banks each wrap the same
sentence differently, and Truist's "ZELLE BUSINESS PAYMENT FROM ..." matched
none of the patterns Pulse knew, so those lines fell back to the bare network
name. Every sender in a statement then arrived as one payee called "Zelle" —
and because that is a prefix of any badly named payee already in the file, the
matcher filed hundreds of unrelated people under one of them. Zelle lines are
now read by direction rather than by any one bank's phrasing, so the person on
the other end is the payee. On the statements that surfaced this, 306
transfers now resolve to 269 distinct payees.

A payment method is no longer allowed to stand in for a payee at all. Where a
bank names no counterparty, the transaction goes to review uncoded instead of
being attached to whoever happens to share the first word.

**Fixed — Clean Up shows its duplicates again.** A long list of findings
compressed into a grid of empty rows rather than scrolling. Separate findings
that shared a payee and amount could also collide with each other.

## v1.3.0 — September 6, 2026

**New — Reports.** Profit & Loss, Balance Sheet, Trial Balance, Cash Flows,
General Ledger, A/R and A/P aging, income and expense breakdowns, and job
profitability, run against the connected company file and exportable to Excel.
QuickBooks computes every figure — Pulse asks the report engine rather than
summing transactions itself, because anything recomputed here would eventually
disagree with what the client sees in QuickBooks, and the client is right.

**New — Audit.** 1099 readiness flags vendors over the $600 threshold that are
not marked eligible, and vendors marked eligible with no tax ID on file, in
November rather than January. A period-close checklist runs the standard
pre-close tests as one pass. The deletion log surfaces what QuickBooks still
remembers being removed, which answers "what happened to invoice 1042?" without
a support call.

**New — Clean Up.** Whole-file duplicate detection, an uncategorized sweep that
finds everything parked in Uncategorized Expense or Ask My Accountant, and a
never-used report for list entries no transaction references. Duplicate
detection clusters by date gap so a recurring monthly bill is not reported as a
double entry, and ignores groups where every transaction carries a distinct
reference number.

**New — Bulk Edit.** Reclassify expense lines, stamp QuickBooks custom fields,
and void transactions across a selection. Each transaction is re-read and
rebuilt in full immediately before writing: a *Mod request that sends some
expense lines but not others causes QuickBooks to DELETE the omitted ones, so a
naive bulk edit destroys splits. Transactions carrying item lines are skipped
and reported rather than rebuilt approximately. Voiding is kept separate from
deleting, because voiding preserves the audit trail.

**New — New Client Setup.** Capture a chart of accounts, classes, service items,
customers and vendors from one company file and recreate them in another.
QuickBooks allows one open company file at a time, so the template goes through
a reusable file on disk. Accounts are created parent-first, and a name that
already exists is left exactly as it is.

Analysis is one pass over the file shared by Audit and Clean Up, rather than one
scan per page. `npm run test:analysis` covers the report parser and the
analysis heuristics against fixture qbXML.

## v1.2.2 — August 26, 2026

**New — "Added to QB since" on the Delete screen.** Undoing an import meant
picking it out by transaction date, which does not separate what an import just
added from the history that was already in the file — those dates overlap. This
filter matches on when a transaction was written to QuickBooks instead, so an
import can be selected and removed on its own without touching anything that
was there before.

## v1.2.1 — August 26, 2026

**Fixed — a wire transfer failed the upload with QuickBooks error 3140.**
QuickBooks list names cap at 41 characters and cannot contain a colon, so a
payee taken from `Online Domestic Wire Transfer A/c: … Us Ref: … Trn:es` could
never be created, and the check that referenced it was rejected. Wire lines now
read the beneficiary out of the `A/c:` field, payee names are trimmed to
something QuickBooks accepts before they are created, and a name QuickBooks
still refuses no longer takes the transaction down with it — the row books
without a payee instead.

**Fixed — Ledger uploads did not reach the dashboard or History until the app
was restarted.** The upload wrote its history entry straight to disk, past the
in-memory store the dashboard renders from.

**Fixed — Delete and Modify silently stopped at 500 transactions per type.**
The query asked for the first 500 with no iterator, so anything past that was
invisible with nothing to say so. Both page through to the end now.

**Fixed — a name that already ended in "Inc." came out as "Inc..".**

## v1.2.0 — August 25, 2026

### Statement lines inherit the account their payee is already coded to

The Ledger has always been meant to look a payee up in QuickBooks and code it
to whatever that payee's previous transactions were coded to. It was reading
almost none of that history, so nearly everything landed on Ask My Accountant
— including payees whose every transaction in QuickBooks sits on one account.

Measured against a live company file's own 334 checks and deposits: 90% of
lines now resolve to the QuickBooks record QuickBooks itself uses, 64% land on
the account already on those transactions, 1.5% differ, and the rest go to Ask
My Accountant untouched.

**Fixed — most of the history was never read.** Only bills, checks, credit
card charges and deposits were queried, so a payee coded through a journal
entry, a vendor credit, an invoice or an item-coded bill looked like it had no
history at all. Nine transaction types are read now, the customer side
included, and item-coded lines resolve through the item list.

**Fixed — only the first 500 of each type came back.** The queries asked for
MaxReturned with no iterator, so QuickBooks returned the oldest 500 and every
recent transaction — the ones worth learning from — fell off the end. Queries
page through to the end.

**Fixed — a rejected query was indistinguishable from an empty company file.**
qbXML reports failures inside the response body rather than throwing, and every
query was wrapped in a silent catch, so a request QuickBooks turned down
produced no history and no explanation. Each query's status is checked, and the
review screen names any query that failed and how many transactions were read.

**Fixed — a consistent split was read as ambiguity.** The guard that holds back
payees with no dominant account counted expense lines, so a loan payment split
between principal and interest scored 50/50 across twelve identically coded
payments and was dropped.  It compares whole transactions now.

**Fixed — the vendor list came back empty.** Vendor records carry `Name` and no
`FullName`, so nothing was read from them.

**Changed — Pulse no longer picks between accounts.** A payee QuickBooks books
across several accounts every time, and a name with two QuickBooks records
coded differently, both go to Ask My Accountant carrying the breakdown rather
than Pulse choosing one. Uncategorized rows now say which case they are: not in
QuickBooks, no coded history, a recurring split, or colliding records.

**Improved — payees are recognised from the bank's own wording.** `Zelle From`
lines kept the whole free-text memo as part of the name; `Online Transfer to`
prefixed names with "Transfer to", which no QuickBooks record starts with;
`Orig CO Name:` preferred the entry description over the originating company,
turning "Panzarella Waste" into "Chckng"; and card purchases carried acquirer
prefixes and merchant phone numbers. Middle initials and professional suffixes
are dropped, so "Victor M. Portillo, P.A." reaches "Victor Portillo". Prefix
matches must land on a word boundary, which lets short real names like "FPL"
match. Where the merchant map disagrees with the company file — "Florida Power
& Light" against a vendor named "FPL" — the company file wins.

## v1.1.0 — August 25, 2026

### Eight banks now tie to the cent

Pulse read statements through its own copy of the parser, which had drifted
away from Phantom Ledger's since April. Both now read through one shared
parser, so Pulse gains every fix made to Ledger and the next one is written
once. The two apps stay separate — only the reading of statements is shared.

**Fixed — Bank of America was silently dropping transactions.** Some BofA rows
carry a date and an amount and no description at all, and those were being
discarded. The same $985.86 vanished from six consecutive months, and April
and June lost $1,401.14 and $1,008.36. Every recovered row is kept and flagged
for review. **Worth re-checking any BofA export made before this release.**

**Fixed — Wintrust was counting each check twice.** Wintrust lists every check
three times: a summary index at the top, the Debits section, and scanned
check-image captions at the end. Two of those were being banked, overstating
April by $5,750.00 and May by $4,450.00.

**New — Truist statements can be read at all.** Truist writes its PDFs one
letter at a time, so section headings arrived as `O t h e r  w i t h d r a w a
l s` and nothing was recognisable. All 2,597 transactions now take their sign
from the statement's own structure rather than guessing from the description —
sign-review flags across all banks fell from 2,146 to 10.

**New — Spanish-language Wells Fargo and multi-account Navy Federal statements
are validated.** Both were extracting correctly but had no way to prove it, so
every file reported "not validated".

**Fixed — Chase no longer reports months as missing when they are present.**
Any statement starting on the 1st through the 9th lost its statement period
entirely, which made the gap detector invent missing months.

**Improved — statement periods are read from every bank's wording**: a printed
range, the dates on the balance lines, or the closing date alone. 48 files that
reported no period now report one.

### Scanned statements

**New — PDFs with no text layer are read by OCR.** Citizens ships statements as
images, so twelve files previously reported no transactions at all. Recognised
pages go through the same sectioning, sign and validation logic as any other
statement, so an OCR'd statement still has to reconcile against its own printed
totals.

OCR needs an internet connection the first time it runs, to fetch its language
model.

**Known limitation:** four of twelve Citizens statements reconcile. The busier
months extract but do not yet tie — their checks section is not read. Those are
reported as mismatched rather than passed, but do not book them.

### Batch checks

Duplicate uploads, repeated statement periods, gaps in the month sequence,
mixed account numbers and mixed account types are all detected. Ledger and
Pulse had each grown half of these; both now have all five.

---

## v1.0.2

Re-enabled GPU acceleration via the high-performance adapter.

## v1.0.1

Machine-bound licensing and the auto-update flow.

## v1.0.0

Initial release — QuickBooks Desktop transaction manager with statement PDF
import, vendor matching and General Ledger import.
