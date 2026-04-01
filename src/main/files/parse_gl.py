"""
QuickBooks General Ledger PDF Parser
=====================================
Parses a QB Desktop General Ledger PDF and extracts:
  - Chart of Accounts (from section headers)
  - Customers (names from Credit / money-in transactions in bank sections)
  - Vendors   (names from Debit  / money-out transactions in bank sections)
  - Ambiguous (names that appear on both sides — e.g. owner transfers)

Usage:  python parse_gl.py <path_to_pdf>
Output: JSON on stdout, errors on stderr
"""

import sys
import re
import json
from collections import defaultdict

try:
    import pypdf
except ImportError:
    json.dump({"error": "pypdf not installed. Run: pip install pypdf"}, sys.stdout)
    sys.exit(1)


# ── Account-type inference ─────────────────────────────────────────────────

BANK_KEYWORDS = ("checking", "savings", "chase #1", "chase #5839", "chase #0936",
                 "bank of", "wells fargo", "citibank", "td bank", "capital one",
                 "pnc bank", "usaa", "suntrust", "bb&t", "regions", "truist")
CREDIT_KEYWORDS = ("credit card", "visa", "mastercard", "amex", "american express",
                   "discover", "chase #5", "chase #3", "chase #6", "personal credit")

def infer_account_type(name: str) -> str:
    n = name.lower()
    if any(k in n for k in BANK_KEYWORDS):
        return "Bank"
    if any(k in n for k in CREDIT_KEYWORDS):
        return "CreditCard"
    if any(k in n for k in ("accounts receivable", "a/r ")):
        return "AccountsReceivable"
    if any(k in n for k in ("accounts payable", "accrued expenses", "accrued liab")):
        return "AccountsPayable"
    if any(k in n for k in ("inventory", "prepaid", "other current asset")):
        return "OtherCurrentAsset"
    if any(k in n for k in ("accumulated depreciation", "furniture", "equipment",
                             "vehicle", "building", "property", "- acquisition",
                             "fixed asset")):
        return "FixedAsset"
    if any(k in n for k in ("loan to", "note receivable", "other asset")):
        return "OtherAsset"
    if any(k in n for k in ("loan from", "line of credit", "mortgage",
                             "note payable", "long-term liab")):
        return "LongTermLiability"
    if any(k in n for k in ("sales tax", "payroll liab", "deferred revenue",
                             "other current liab")):
        return "OtherCurrentLiability"
    if any(k in n for k in ("retained", "capital", "drawing", "shareholder",
                             "member", "partner", "owner equity")):
        return "Equity"
    # "Loan to Shareholder" and similar owner ledger accounts → Equity
    if any(k in n for k in ("loan to shareholder", "loan to owner")):
        return "OtherAsset"
    if any(k in n for k in ("income", "revenue", "consulting", "service fee",
                             "rental income", "commission", "sales")):
        return "Income"
    if any(k in n for k in ("cost of goods", "cogs", "cost of sales")):
        return "CostOfGoodsSold"
    if any(k in n for k in ("other income", "interest income", "gain on")):
        return "OtherIncome"
    if any(k in n for k in ("depreciation", "amortization", "interest expense",
                             "loss on")):
        return "OtherExpense"
    return "Expense"

def is_bank_or_cc(account_type: str) -> bool:
    return account_type in ("Bank", "CreditCard")


# ── Name extraction from a transaction line ─────────────────────────────────

BIZ_SUFFIX = re.compile(
    r"\b(Inc\.|Inc$|LLC|Corp\.|Corp$|Corporation|Company|N\.A\.|Ltd\.|"
    r"L\.P\.|LLP|PLLC|P\.A\.|Bank|Bancorp|Financial|Insurance|Technologies|"
    r"Technology|Solutions|Enterprises|Systems|Industries|"
    r"International|Foundation|Trust|Properties|Rewards|"
    r"Market|Markets|Supermarket|Supermarkets|Depot|Center|"
    r"Association|Partners|Group|Services|Institute|Authority)$",
    re.IGNORECASE
)

MEMO_STARTERS = re.compile(
    r"^(Zelle|Service|Payment|Online|Remote|Direct|Transfer|Recurring|"
    r"Subscription|Purchase|Transaction|Orig|Web|ACH|Wire|Charge|Fee|"
    r"Electronic|Auto|Automatic|Monthly|Annual|Weekly|Fedwire|Via:|"
    r"Meals|Expense|Supplies|Utilities|Parking|Travel|Gas|Rent|"
    r"From |To )$",
    re.IGNORECASE
)

AMOUNT_RE = re.compile(r"^-?[\d,]+\.\d{2}$")


def extract_name(tokens: list) -> str:
    """
    Greedy extraction of an entity name from post-NUM tokens.

    Rules (evaluated per token):
      1. Stop at amounts.
      2. If second token is a case-folded duplicate of the first (e.g. "ADT Adt"),
         stop — the memo is echoing the name.
      3. Stop at tokens that contain * or look like transaction codes
         (e.g. "Bp#1465600Sunshine", "Jpm99A7Hfrlo").
      4. Stop at known memo-starter words.
      5. Stop when we've found a business suffix at the end of accumulated tokens.
      6. Hard cap at 8 words.
    """
    if not tokens:
        return ""

    parts: list = [tokens[0]]

    for i, tok in enumerate(tokens[1:8], 1):
        # Rule 1 — amount
        if AMOUNT_RE.match(tok):
            break
        # Rule 2 — memo echoes name
        if i == 1 and tok.lower().rstrip(",") == parts[0].lower().rstrip(","):
            break
        if i == 1 and len(parts[0]) >= 3 and tok.lower().startswith(parts[0].lower()[:3]):
            break
        # Rule 3 — transaction code / URL fragment
        if "*" in tok or re.search(r"#\d", tok):
            break
        if re.match(r"^[A-Z0-9]{8,}$", tok):      # all-caps/digit code like "Jpm99A7Hfrlo"
            break
        if re.match(r"^www\.", tok, re.IGNORECASE):
            break
        # Rule 3b — colon-terminated word (transaction descriptor like "Via:")
        if tok.endswith(":"):
            break
        # Rule 4 — memo starter
        if MEMO_STARTERS.match(tok) and len(parts) >= 1:
            break
        # Rule 4b — token matches first word again (name echo in memo, e.g. "Sushi X Sushi Y")
        if len(parts) >= 2 and tok.lower().rstrip(",") == parts[0].lower().rstrip(","):
            break
        parts.append(tok)
        # Rule 5 — business suffix reached
        if BIZ_SUFFIX.search(" ".join(parts)):
            break
        # Rule 5b — HTML entity (malformed text like &Amp;) signals memo
        if "&" in tok and tok != "&":
            break

    return " ".join(parts).rstrip(" ,")


# ── Amount / balance helpers ────────────────────────────────────────────────

def parse_amount(s: str) -> float:
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return 0.0

def trailing_amounts(tokens: list) -> list:
    """Return the sequence of trailing numeric tokens (up to 3)."""
    result = []
    for tok in reversed(tokens):
        if AMOUNT_RE.match(tok):
            result.insert(0, parse_amount(tok))
        else:
            break
    return result


# ── Canonical name for deduplication ────────────────────────────────────────

def canonical(name: str) -> str:
    """Lower-case, strip punctuation, take first 4 significant words."""
    words = re.sub(r"[^a-z0-9 ]", "", name.lower()).split()
    stop = {"the", "a", "an", "and", "of", "in", "at", "for", "to", "from", "by"}
    sig = [w for w in words if w not in stop]
    return " ".join(sig[:4])


# ── Main parse ───────────────────────────────────────────────────────────────

DATE_RE   = re.compile(r"^\d{2}/\d{2}/\d{4}$")
TOTAL_RE  = re.compile(r"^Total\s+.+?[\d,]+\.\d{2}")
HEADER_RE = re.compile(r"Date\s+Num\s+Name", re.IGNORECASE)


def parse_gl_pdf(pdf_path: str) -> dict:
    try:
        reader = pypdf.PdfReader(pdf_path)
    except Exception as exc:
        return {"error": f"Could not open PDF: {exc}"}

    total_pages = len(reader.pages)

    # account_name → account_type
    accounts: dict = {}

    # canonical_name → { "display": str, "debit": float, "credit": float }
    # Only populated from Bank / CreditCard account sections
    entities: dict = defaultdict(lambda: {"display": "", "debit": 0.0, "credit": 0.0})

    gl_started       = False
    current_acct     = ""
    current_acct_type= ""
    prev_balance: float | None = None

    for page in reader.pages:
        text = page.extract_text() or ""
        lines = [l.strip() for l in text.split("\n") if l.strip()]

        for line in lines:

            # ── Detect start of GL section ───────────────────────────
            if HEADER_RE.search(line):
                gl_started = True
                prev_balance = None
                continue

            if not gl_started:
                continue

            # ── Skip totals ──────────────────────────────────────────
            if TOTAL_RE.match(line):
                prev_balance = None
                continue

            tokens = line.split()
            if not tokens:
                continue

            # ── Transaction line ─────────────────────────────────────
            if DATE_RE.match(tokens[0]) and len(tokens) >= 4:
                trail = trailing_amounts(tokens)
                if not trail:
                    continue

                balance = trail[-1]

                # Determine debit vs credit from running balance
                is_credit = is_debit = False
                if prev_balance is not None:
                    delta = balance - prev_balance
                    if delta >  0.005:
                        is_credit = True
                    elif delta < -0.005:
                        is_debit  = True

                prev_balance = balance

                # Only track entities in Bank / CreditCard sections
                if not is_bank_or_cc(current_acct_type):
                    continue

                # Isolate name tokens (everything between NUM and trailing amounts)
                after_num = tokens[2:]
                strip_n   = len(trail)
                if strip_n >= len(after_num):
                    continue
                name_tokens = after_num[: len(after_num) - strip_n]

                name = extract_name(name_tokens)
                if not name or len(name) < 2:
                    continue

                # Skip entries that are just bank account names (internal transfers)
                if any(kw in name.lower() for kw in ("chase #", "personal savings",
                                                       "personal checking")):
                    continue

                key = canonical(name)
                if not key:
                    continue

                ent = entities[key]
                # Keep the "best" (longest/cleanest) display name
                if len(name) > len(ent["display"]):
                    ent["display"] = name

                if is_debit:
                    ent["debit"] += abs(delta) if prev_balance is not None else 0
                elif is_credit:
                    ent["credit"] += abs(delta) if prev_balance is not None else 0

                continue

            # ── Account section header ───────────────────────────────
            # Pattern: text... [single_balance]  (no leading date)
            trail = trailing_amounts(tokens)
            if trail and len(trail) == 1:
                acct_tokens = tokens[:-1]
                acct_name   = " ".join(acct_tokens).strip()
                if (acct_name and len(acct_name) > 1
                        and not acct_name.lower().startswith(("total", "page"))):
                    acct_type = infer_account_type(acct_name)
                    accounts[acct_name] = acct_type
                    current_acct      = acct_name
                    current_acct_type = acct_type
                    prev_balance      = trail[0]

    # ── Classify extracted entities ──────────────────────────────────────────
    account_keys = {canonical(a) for a in accounts}

    customers: list = []
    vendors:   list = []
    ambiguous: list = []

    for key, ent in entities.items():
        name = ent["display"]
        d    = round(ent["debit"], 2)
        c    = round(ent["credit"], 2)

        if not name or len(name) < 2:
            continue
        # Skip if name maps to a known account
        if key in account_keys:
            continue
        # Skip owner/shareholder name when it's also the company name
        if name.lower() in {a.lower() for a in accounts}:
            continue

        entry = {"name": name, "debitTotal": d, "creditTotal": c, "include": True}

        if d == 0 and c == 0:
            continue  # Skip entities with no trackable amounts

        if c > 0 and d == 0:
            customers.append({**entry, "type": "Customer"})
        elif d > 0 and c == 0:
            vendors.append({**entry, "type": "Vendor"})
        else:
            dominant = "Customer" if c > d else "Vendor"
            ambiguous.append({**entry, "type": dominant})

    account_list = [
        {"name": n, "type": t, "include": True}
        for n, t in accounts.items()
        if n and len(n) > 1
    ]

    return {
        "accounts":  account_list,
        "customers": sorted(customers, key=lambda x: x["name"]),
        "vendors":   sorted(vendors,   key=lambda x: x["name"]),
        "ambiguous": sorted(ambiguous, key=lambda x: x["name"]),
        "pageCount": total_pages,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: parse_gl.py <pdf_path>\n")
        sys.exit(1)

    result = parse_gl_pdf(sys.argv[1])
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
