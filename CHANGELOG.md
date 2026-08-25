# Changelog

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
