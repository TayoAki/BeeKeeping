_SlowBooks Pro 2026 feature inventory — [← 6. Nonprofit Mode, Jobs & Job Costing](06-nonprofit-jobs-job-costing.md) · [Index](README.md) · [8. Platform, Security & Administration →](08-platform-security-administration.md)_

## 7. Import, Export, Migration & Interoperability

SlowBooks Pro exchanges data with QuickBooks Desktop (IIF files both ways, plus three Desktop report CSVs), QuickBooks Online (OAuth 2.0 REST API through `intuit-oauth` + `python-quickbooks`: list, document, journal and posted-ledger import with a live background log, and an update-aware export), six other bookkeeping systems through the dry-run-gated **Migrate Data** wizard (Xero, MYOB, Sage 50, Wave, Zoho Books, GnuCash), and spreadsheets (CSV lists and documents, a chart-of-accounts importer that also reads hledger output, and ledger-report CSVs). Importers are built to be re-run: rows and transaction blocks are isolated in savepoints so one bad record is reported and the rest continue, and every path has its own duplicate key so a second import adds nothing. Exports are neutralised against spreadsheet formula injection and encoded for their consumer (Windows-1252 for IIF, UTF-8 with a byte-order mark for CSV).

### QuickBooks Desktop IIF import — upload, parsing and validation

- **Upload** — `POST /api/iif/import` and `POST /api/iif/validate` take a multipart `file` whose name must end in `.iif` (400 "File must have .iif extension"; the page's drop zone also refuses other extensions with a toast). Body capped at 20 MB (413, shared `read_limited` guard).
  - Decoded as UTF-8, falling back to Windows-1252 (`cp1252`, undecodable bytes replaced) because QuickBooks 2003 writes ANSI files.
- **Parser (`parse_iif`)** — CRLF/CR normalised to LF; each line split on tabs; a `!`-prefixed row defines the column names for that record type until the next header of the same type (so a file can carry several `!TRNS` column sets); rows are mapped to dicts by header name, missing trailing fields read as blank.
  - List sections read: `!ACCNT`, `!CLASS`, `!CUST`, `!VEND`, `!INVITEM`. Every other section (`!HDR`, `!BUD`, `!EMP`, `!OTHERNAME`, `!TERMS`, `!PAYMETH`, `!CTYPE`, `!VTYPE`, `!SALESREP`, `!SHIPMETH`, `!TODO`, `!VEHICLE`, `!INVMEMO`, `!ENDGRP`, …) is skipped.
  - Transactions: a `TRNS` row opens a block, `SPL` rows attach to it, `ENDTRNS` closes it; an unclosed block is closed by the next `TRNS` or end of file; an `SPL` before any `TRNS` is dropped.
- **Quoted fields (v2.18.1, #195)** — a value wrapped in a matched pair of double quotes (QuickBooks quotes anything containing a comma: `"JONES, BOB"`, `"99,250.02"`) loses the quotes and has `""` unescaped to `"`; a value that only ends in a quote keeps it.
- **Formula guard removed** — a leading apostrophe in front of `=`, `+`, `-`, `@`, TAB or CR (what SlowBooks' own exports add) is stripped from every field, so a re-imported `'=HYPERLINK(...)` name comes back as typed.
- **Amounts and dates** — amounts drop surrounding quotes and thousands separators (QuickBooks for Mac's `"-1,725.00"` → -1725.00; unreadable → 0). Dates accept `MM/DD/YYYY`, `MM/DD/YY`, `YYYY-MM-DD`; a missing date on a document falls back to today.
- **Validate (writes nothing)** — returns `valid`, `sections_found`, `record_counts` (keys `ACCNT`, `CLASS`, `CUST`, `VEND`, `INVITEM`, `TRNS`), `errors`, `warnings`, `caps_names` and up to six `caps_name_examples` (`{name, becomes}`).
  - Errors (fail the check): file not parseable ("does not look like valid IIF"); no recognised section; list row without `NAME`; class name over 100 characters; transaction block without `TRNSTYPE`.
  - Warnings: unrecognised `ACCNTTYPE` ("will default to Expense"); unrecognised `INVITEMTYPE` ("will default to Service"); block without `DATE`; block whose `TRNS` + ΣSPL is off by more than $0.01.
  - It does not check whether a `TRNSTYPE` is one the importer handles, or whether names and accounts exist.
- **Page (`#/iif`, sidebar → Interop → QuickBooks Interop)** — click-to-browse or drag-and-drop; shows file name and size; **Validate** prints PASS/FAIL, sections, per-section record counts, errors and warnings; **Import** stays disabled until a passing Validate; **Clear** resets. The import result lists "N imported" per type, "Already here, skipped", "ALL-CAPS names changed to normal capitalization", warnings (with count) and errors as `Row N: message`; toast "Imported N records".

_Key files: `app/routes/iif.py`, `app/services/iif_import.py`, `app/schemas/iif.py`, `app/static/js/iif.js`, `app/services/upload_limits.py`_

### IIF import — lists, accounts and opening balances

- **Import order** — classes → accounts → customers → vendors → items → transactions, then one commit. Each row runs in its own savepoint; a failure becomes `{row, message}` in `errors` and the rest continue (a data problem shows its own sentence; any other exception is logged and answered generically).
- **Classes (`!CLASS`)** — `NAME` stored verbatim, including QuickBooks `Parent:Child` subclass paths (classes are flat here; transaction `CLASS` columns cite the same path). `HIDDEN` = `Y`/`YES`/`TRUE` → archived. Case-insensitive dedup (re-importing the list is a no-op). A name over 100 characters is refused for that row rather than truncated, so it can never silently fail to match a transaction's `CLASS`.
- **Accounts (`!ACCNT`)** — rows sorted parents first (fewest colons). Reads `NAME`, `ACCNTTYPE`, `ACCNUM` → account number, `DESC` → description; other columns (`REFNUM`, `TIMESTAMP`, `SCD`, `EXTRA`, …) are ignored.
  - Type map (`IIF_TO_ACCOUNT_TYPE`): `BANK`, `AR`, `OCASSET`, `OASSET`, `FIXASSET`, `NONPOSTING` → Asset; `AP`, `OCLIAB`, `LTLIAB` → Liability; `EQUITY` → Equity; `INC`, `EXINC` → Income; `EXP`, `EXEXP` → Expense; `COGS` → COGS; anything else (including QuickBooks' `CCARD`) → Expense.
  - `Parent:Child` names: stored under the leaf name, with the parent found by the immediate parent segment's name (exact, then any case).
  - Dedup: same name or same `ACCNUM` (account numbers are unique), then same name in any case — skipped without being counted.
- **Opening balances from `OBAMOUNT`** — QuickBooks for Mac exports carry balances in the `ACCNT` rows and no `TRNS` section. Each non-zero `OBAMOUNT` (positive = debit side) is collected for new and matched accounts; two file rows that collapse onto one account (e.g. `Opening Bal Equity` #3200 onto the seeded #3200) are summed with a warning. One balanced journal entry "Opening balances (IIF import)" is posted, dated today, reference `IIF-OPENING`, source `iif_import`; any residual is plugged to account 3200, else an account named like "Opening Balance Equity", else "Retained Earnings". With no plug account the balances are skipped with a warning.
  - Verified against a real QuickBooks 2019 for Mac export (105 `ACCNT` rows with quoted thousands; $336,050.25 on each side of the opening entry) in `tests/fixtures/sample_qbmac_opening_balances.iif`.
- **Customers (`!CUST`)** — matched by name in any case; names cut to 200 characters.
  - A `Customer:Job` row becomes a Job under its customer (the customer is created first when the list lacks it); a job already present is not counted again (v2.18.1). Only the first colon splits, so `A:B:C` is job `B:C` under `A`.
  - Field map: `COMPANYNAME` → company, `EMAIL`, `PHONE1` → phone, `PHONE2` → mobile, `ADDR2`/`ADDR3` → billing street lines, `ADDR4` parsed as "City, ST ZIP" (no comma → the whole value is the city), `TERMS` (blank → Net 30), `TAXID`, `LIMIT` → credit limit.
- **Vendors (`!VEND`)** — matched by name in any case; `ADDR1` → company, `ADDR2`/`ADDR3` → street, `ADDR4` → city/state/ZIP, `PHONE1` → phone, `PHONE2` → fax, `EMAIL`, `TERMS` (blank → Net 30), `TAXID`.
- **Items (`!INVITEM`)** — matched by exact name only (item names are often part numbers). Type map: `SERV` → Service, `PART` and `INVENTORY` → Product, `NON-INVENTORY` → Material, `OTHC` → Labor, anything else (`GRP`, `DISC`, `STAX`, `SUBT`, `COMPTAX`, …) → Service. Reads `DESC`, `PRICE` → rate, `TAXABLE` = `Y`, and `ACCNT` → income account.
- **Account lookup used by items and every transaction (`_find_account`)** — exact name → case-insensitive name → well-known QuickBooks name → account number → sub-account path:
  - Well-known names: `accounts receivable`/`a/r`/`trade receivables` → 1100; `undeposited funds` → 1200; `accounts payable`/`a/p`/`trade payables` → 2000; `sales tax payable` → 2200; `checking` → 1000; `savings` → 1010; `service income` → 4000; `product sales` → 4100; `material income` → 4200; `labor income` → 4300; `other income` → 4900; `cost of goods sold`/`cogs` → 5000.
  - `Parent:Child` paths (v2.18.1): the account whose parent chain matches the path in any case, or the only account with that leaf name when it has no parent; one under a different parent is refused (`Automobile:Gas` never posts to `Utilities:Gas`).

_Key files: `app/services/iif_import.py`, `app/services/iif_common.py`, `app/services/jobs_service.py`, `app/services/classes_service.py`, `tests/fixtures/sample_qbmac_opening_balances.iif`_

### IIF import — transaction blocks

- **Dispatch by `TRNSTYPE`** — `INVOICE`, `PAYMENT`, `CASH SALE` (also `CASHSALE`, `SALES RECEIPT`), `ESTIMATE`, `BILL`, `DEPOSIT`. Any other type (`GENERAL JOURNAL`, `CHECK`, `CREDIT CARD`, `TRANSFER`, …) is skipped: not counted, no warning. Each block runs in its own savepoint; a failure is reported as `Transaction block N: …`.
- **INVOICE** — `DOCNUM` is the invoice number; an invoice with that number already here → skipped and counted.
  - `NAME` is required (else "INVOICE … missing customer NAME on TRNS line"); it is resolved as `Customer:Job`, creating the customer and job on first sight and tagging the invoice to the job so job costing survives.
  - Header: `DATE` (blank → today), `DUEDATE` (blank → invoice date), `TERMS` (blank → Net 30), status Sent. The TRNS `ACCNT` is not used — A/R is always control account 1100.
  - Each SPL: amount = |AMOUNT| rounded to the cent. A split whose `ACCNT` contains "tax" becomes the sales-tax amount; every other split becomes a line with `INVITEM` (exact item name), `QNTY` (default 1), `PRICE` (else amount ÷ qty) and `MEMO` as description. Total = lines + tax.
  - Journal: DR A/R for the total, CR each split's account (lookup above). Posted only when balanced; a split whose account can't be found has its amount credited to Service Income (4000) with "(unmatched: …)" in the description. No subtotal → no journal and the warning "imported but journal entry could not be created (account mismatch)".
  - Inventory-tracked items move stock and post cost of goods (`post_sale_for_invoice`).
  - Mixed-sign splits (a positive discount line) are not supported: amounts are read as absolute values (documented in the code).
- **PAYMENT** — duplicate test first: same customer (exact or any case) + date + amount (+ `DOCNUM` as the reference when present) → skipped and counted.
  - The customer must already exist (`Customer:Job` resolves to the customer; nothing is created); otherwise an error naming the document (v2.18.1 — such payments used to vanish silently).
  - Deposit account = TRNS `ACCNT` via the lookup, else Undeposited Funds (1200).
  - Each SPL whose `DOCNUM` matches an invoice number becomes an allocation of |AMOUNT| (or the whole payment), updating the invoice's paid amount, balance and status (Partial/Paid).
  - Journal: DR deposit account / CR A/R for the full amount.
- **CASH SALE (sales receipt)** — blank `NAME` → the bucket customer "Walk-In Customer" (warned per block); blank `TERMS` → Due on Receipt.
  - No `DOCNUM` (unnumbered POS receipts): duplicate test on customer + date + total among sales receipts, then the next invoice number is assigned.
  - Imported as an INVOICE (above) flagged `is_sales_receipt`, plus a same-day payment for the full total (`PAYMETH` → method, reference = receipt number, deposit account = TRNS `ACCNT` else Undeposited Funds) fully allocated so the receipt is Paid; the payment journal DR deposit / CR A/R nets the ledger to cash + income, exactly like the Enter Sales Receipts screen.
- **ESTIMATE** — `DOCNUM` duplicate test against estimate numbers; `NAME` required and resolved as `Customer:Job` (created on first sight); status Pending; lines and tax built like an invoice; no journal (estimates don't post).
- **BILL (deliberately strict)** — TRNS + ΣSPL must net to within $0.01 (error explains the opposite-sign convention); either sign convention imports because amounts are taken as absolute values.
  - The vendor must exist (any case) — never auto-created; the TRNS `ACCNT` (A/P) must resolve; `DOCNUM` is required (bill number); every SPL `ACCNT` must resolve. All of this is checked before anything is written, so no half-created bill.
  - Duplicate key: (vendor, bill number).
  - Creates an Unpaid bill (total = |TRNS AMOUNT|, tax 0, `MEMO` → notes), one line per split (qty 1, rate = amount, `MEMO` → description), and a journal DR each line's account / CR the TRNS A/P account, source `bill`.
- **DEPOSIT** — same balance check; the bank account (TRNS `ACCNT`) and every split account must resolve.
  - Duplicate key (date, `DOCNUM`) among deposits — only when `DOCNUM` is present; unnumbered deposits re-import (two same-day deposits of one amount can be genuine).
  - Posted as a journal-only transaction with source `deposit` (what Make Deposits produces): DR bank for |TRNS|, CR each split for |AMOUNT| with its `MEMO`; description = TRNS `MEMO` or "Deposit to <bank>"; reference = `DOCNUM`.
- **Classes on transactions** — for BILL and DEPOSIT the SPL `CLASS` values collapse to one document class: all blank → none; one distinct value → exact then case-insensitive lookup, and an unknown class is an error that points at File → Utilities → Export → Lists → Class List or Settings → Classes; several distinct values → error ("classes apply per document"). INVOICE, PAYMENT, ESTIMATE and CASH SALE do not read `CLASS`.
- **"A second import says what it skipped" (v2.18.1)** — every document type (invoice, payment, sales receipt, estimate, bill, deposit) counts what it skips as a duplicate in `duplicates_skipped`, shown as "Already here, skipped" instead of the old "Duplicates skipped: 1 imported". List rows that already exist are skipped without a count.
- **Result (`IIFImportResult`)** — `classes`, `accounts`, `customers`, `vendors`, `items`, `invoices`, `payments`, `sales_receipts`, `estimates`, `bills`, `deposits`, `duplicates_skipped`, `names_changed`, `errors[{row, message}]`, `warnings[]`. A crash outside the per-row isolation rolls back and returns 500 "Import failed — the server log has the details".

_Key files: `app/services/iif_import.py`, `app/services/jobs_service.py`, `app/services/inventory_hooks.py`, `app/services/safe_errors.py`, `app/schemas/iif.py`_

### ALL-CAPS name retitling on IIF import (v2.18.1, #195)

- **Offered by Validate** — the report counts the file's distinct ALL-CAPS names (`caps_names`) and returns up to six as they would import; the page then shows an unticked box "Change N ALL-CAPS name(s) to normal capitalization" with those examples and a caution that initialisms may not survive. Shown only for a file that validated.
- **Applied by `retitle_names=true`** (form field on `POST /api/iif/import`, default false) — the parsed file is rewritten before import: `NAME` on `ACCNT`, `CUST` and `VEND` rows, the `ACCNT` of `INVITEM` rows, and `NAME` + `ACCNT` on every `TRNS` and `SPL` row, the same way everywhere, so a bill for `ACME TOOLING, INC.` still finds the vendor that became `ACME Tooling, Inc.`.
  - Item names and `INVITEM` references are kept as typed; `CLASS` values are not touched; `names_changed` reports the number of distinct names changed.
- **Existing records** — nothing already in the books is renamed; and with or without the box, a file's name matches an existing customer, vendor, job or account in any case, so `ACME CO` beside `Acme Co` no longer makes a second record and a transactions file imported later finds every list name (items still match exactly).

_Key files: `app/services/iif_import.py`, `app/services/name_case.py`, `app/static/js/iif.js`_

### Name capitalization service (`name_case.normalize_name`)

- **Scope** — used by the IIF import's retitling and by `tools/clean_iif.py`; nothing else calls it.
- **Only shouted names change** — a name (or each side of a `Parent:Child` name, judged separately) containing any lowercase letter is returned untouched (`Contoso`, `Model-X42`, `BOB JONES:Kitchen` → `Bob Jones:Kitchen`).
- **Left alone** — names starting with `=`, `+`, `-` or `@` (formula-shaped or handles); literal two-character `\n`, `\r`, `\t` escapes are removed first.
- **Word rules** (separators such as spaces, commas, `&`, `/`, `-`, parentheses are preserved):
  - Brands written their own way: FedEx, PayPal, eBay, LinkedIn, YouTube, QuickBooks.
  - Acronyms kept in capitals (131 entries): e.g. IBM, NYC, USA, IRS, HSBC, AMEX, `NA` (National Association), UPS, USPS, DHL, HP, LG, BMW, ACME, AAA, CVS, HVAC, YMCA, CPA, DDS, MD, AP, AR, COGS, FICA, FUTA, SUTA, YTD, roman numerals II–VIII, `WWW`, and US state codes except those that are also words (IN, OR, ME, HI, OH, OK, CO, DE, AL, MI, MO, MS, MT, PA).
  - Legal forms kept in capitals: LLC, LLP, L.L.C., L.L.P., DBA, D/B/A, PLLC, PCLP, LP, L.P., PC, P.C.; title-cased: Inc, Inc., Corp, Corp., Co, Co., Ltd, Ltd., Limited, Company.
  - Words with both letters and digits are codes and keep their case (`MSC-3800`, `22QT`).
  - Connectives (of, the, and, for, to, in, on, at, by, or, a, an) go lower-case except as the first word (`DEPARTMENT OF FINANCE` → `Department of Finance`).
  - Initials: a single letter beside a full stop (`N.A.`, `J. SMITH`) and a run of up to three letters glued by `&` or `/` (`AT&T`, `H&R`, `A/R`, `C/O`) keep their capitals.
  - Apostrophes: `O'BRIEN` → `O'Brien`, possessive `SMITH'S` → `Smith's`, `MCDONALD'S` → `McDonald's`.
  - A whole name that is one dotted token with no spaces or apostrophes is cased as a domain: `AMAZON.COM` → `Amazon.com`, `WWW.EXAMPLE.COM` → `WWW.Example.com` (TLDs com, net, org, co, uk, de, fr, nl, eu, us, ca, info, biz, io, app, dev lower-cased).
- **Examples (verified)** — `ACME TOOLING, INC.` → `ACME Tooling, Inc.`; `WELLS FARGO BANK, N.A.` → `Wells Fargo Bank, N.A.`; `BANK OF AMERICA` → `Bank of America`; `TAXES:FICA` → `Taxes:FICA`; `ABC PLUMBING NJ` → `ABC Plumbing NJ`; `160 PARKING CORP` → `160 Parking Corp`.

_Key files: `app/services/name_case.py`_

### `tools/clean_iif.py` (source installs)

- **Usage** — `python tools/clean_iif.py INPUT.iif OUTPUT.iif` writes a cleaned copy and prints records scanned, name fields fixed and a per-section count. Exit 2 with usage on wrong arguments; exit 1 when the input is missing or when OUTPUT is the input ("refusing to write over the input file").
- **What changes** — only the `NAME`, `COMPANYNAME`, `PRINTNAME` and `FULLNAME` columns (located through each section's own `!` header) of every section except `INVITEM`, run through `normalize_name`; every other column is copied byte for byte and row/field counts are unchanged.
  - A value starting with an apostrophe (formula guard) is never touched.
  - A field that was quoted stays quoted (re-escaped with `""`); a changed value gains quotes only if it contains a comma, quote or tab or has edge whitespace.
  - `ACCNT` references on `TRNS`/`SPL`/`INVITEM` rows are not rewritten (the importer matches them in any case).
- **Encoding and line endings** — reads bytes, decodes UTF-8 else Windows-1252, and writes back in the same encoding with the file's own line ending (CRLF kept).

_Key files: `tools/clean_iif.py`, `app/services/name_case.py`_

### IIF export (QuickBooks 2003 Pro format)

- **Delivery** — every export is `text/plain; charset=windows-1252` as an attachment (`to_ansi`): characters Windows-1252 has are written as themselves; others are reduced to their plain letter (`ő` → `o`; Ł/ł, Đ/đ, ı, Ħ/ħ mapped explicitly) or `?`, never an error. File names: `slowbooks_export.iif`, `accounts.iif`, `classes.iif`, `customers.iif`, `vendors.iif`, `items.iif`, `estimates.iif`, `invoices.iif`, `payments.iif`, `sales_receipts.iif`, `bills.iif`, `deposits.iif`.
- **Format rules** — tab-delimited, CRLF line endings, `MM/DD/YYYY` dates, no CSV quoting; tabs, CR and LF inside any value are replaced by spaces; names and free text get the spreadsheet formula guard (leading apostrophe; amounts stay numbers); account names are written as full `Parent:Child` paths.
- **`!ACCNT`** — `NAME`, `ACCNTTYPE`, `DESC`, `ACCNUM`, `EXTRA` (blank); active accounts ordered by number. Type from the account type plus the leading digits of its number (non-numeric → 0):
  - Asset: 1000–1099 `BANK`, 1100 `AR`, other below 1500 `OCASSET`, 1500–1999 `FIXASSET`, 2000+ `OASSET`.
  - Liability: 2000 `AP`, below 2500 `OCLIAB`, otherwise `LTLIAB`.
  - Equity `EQUITY`, Income `INC`, Expense `EXP`, COGS `COGS`.
- **`!CLASS`** — `NAME` (verbatim, `Parent:Child` paths round-trip), `HIDDEN` (archived → `Y`); the system default class is left out.
- **`!CUST`** — `NAME`, `COMPANYNAME`, `FIRSTNAME`/`LASTNAME` (name split at the first space), `ADDR1` (company, else name), `ADDR2`/`ADDR3` (street lines), `ADDR4` ("City, ST ZIP" leaving out blank parts — a missing ZIP no longer prints "None", v2.18.0), `ADDR5` (blank), `PHONE1`, `PHONE2` (mobile), `EMAIL`, `TERMS`, `TAXID`, `LIMIT`; active customers only, each followed by one `CUST` row per job named `Customer:Job`.
- **`!VEND`** — `NAME`, `ADDR1` (company, else name), `ADDR2`–`ADDR4`, `ADDR5` (blank), `PHONE1`, `PHONE2` (fax), `EMAIL`, `TERMS`, `TAXID`; active vendors.
- **`!INVITEM`** — `NAME`, `INVITEMTYPE` (Service `SERV`, Product `PART`, Material `PART`, Labor `OTHC`), `DESC`, `ACCNT` (income account path), `PRICE`, `TAXABLE` `Y`/`N`; active items.
- **Transaction blocks** — each section writes its own `!TRNS`/`!SPL`/`!ENDTRNS` header. Long column set `TRNSTYPE DATE ACCNT NAME AMOUNT DOCNUM DUEDATE TERMS MEMO CLASS` (invoices, bills, deposits, cash sales); short set `TRNSTYPE DATE ACCNT NAME AMOUNT DOCNUM MEMO CLASS` (payments, estimates). `CLASS` carries the document's class (blank when untagged). Amounts are home currency, converted with the same rounding the posting code used, so the file carries what the ledger booked.
  - **INVOICE** — non-void invoices that are not sales receipts: TRNS `Accounts Receivable` +total with due date and terms; one SPL per non-zero line to the item's income account path (fallback `Service Income`), negative, `MEMO` = line description; a tax SPL to `Sales Tax Payable` (`MEMO` "Sales Tax").
  - **PAYMENT** — non-voided payments: TRNS = deposit account path (else `Undeposited Funds`), +cash, `DOCNUM` = reference or check number, `MEMO` = notes; one A/R SPL per allocation with `DOCNUM` = the invoice number (at the invoice's booked rate), an A/R SPL for any unapplied remainder, and any realized exchange difference to account 6999 / "Exchange Gain/Loss" (looked up, never created). The part of a payment that pays a sales receipt is left out and a payment wholly for receipts is omitted, because the `CASH SALE` block already carries that money.
  - **ESTIMATE** — every estimate (no status filter): TRNS `Accounts Receivable` +total, `DOCNUM` = estimate number, `MEMO` = notes; SPL per line plus tax; amounts not currency-converted.
  - **BILL** — non-void bills: TRNS = the name of account 2000 (else "Accounts Payable"), negative total, due date, terms, notes; one positive SPL per non-zero line to its account, else the item's expense account, else `Uncategorized Expenses`, carrying the line's proportional share of the bill's sales tax (tax is part of purchase cost, `purchase_posting.spread`). A bill booked before that change (its journal debited Sales Tax Payable) goes out as booked, with a separate "Sales tax" SPL to account 2200's name.
  - **DEPOSIT** — journal-only transactions with source `deposit`: TRNS = the first debit line's account, +amount, `DOCNUM` = reference, `MEMO` = description; one negative SPL per credit line with its description.
  - **CASH SALE** — non-void sales receipts: TRNS = the deposit-to account of the latest payment by that customer on that date (else account 1200's name, else `Undeposited Funds`), +total; SPL per line and tax as for invoices.
- **Export All** — one file in dependency order: accounts, classes, customers, vendors, items, estimates, invoices, sales receipts, payments, bills, deposits (empty sections dropped); no date range.
- **Date ranges** — `date_from`/`date_to` (YYYY-MM-DD) on invoices and payments (400 "Invalid date format" on a bad value) and on sales receipts, bills and deposits (422 on a bad value). Estimates, lists and Export All take none.
- **Round trip** — a full export re-imports into the same books with no errors and no duplicates (tests cover the chart, invoice line totals, and customer names containing tabs/newlines). Known lossy points: Material → `PART` → Product; a name containing a tab or newline goes out with spaces, so it re-imports as a new, cleaned record.
- **Page** — "Export All Data"; individual Accounts, Customers, Vendors, Items, Estimates, Classes; a From/To date pair that applies to Invoices, Payments, Sales Receipts, Bills and Deposits. The page fetches with `X-Slowbooks-Desktop: 1` and saves the file itself: in the desktop app to Documents/SlowBooks Pro/Reports via the bridge, in a browser as a download.

_Key files: `app/services/iif_export.py`, `app/services/iif_common.py`, `app/routes/iif.py`, `app/static/js/iif.js`, `app/static/js/desktop_shim.js`_

### QuickBooks Desktop report-CSV import (sales receipts, deposits, checks)

- **Purpose** — QuickBooks Desktop can't export transactions to IIF, so three detail reports saved as CSV import directly: `POST /api/csv/import/qb-report` (multipart `file`), UI section "Import from Report CSV" on `#/iif` (`.csv`, "Safe to re-upload — duplicates are skipped").
- **Detection by column signature** (not report title, which varies by version and locale), first match wins:
  - Transaction Detail filtered to Sales Receipt — header row containing `Date`, `Name`, `Account`, `Split`, `Debit`, `Credit` (`Num`, `Memo`, `Item`, `Item Description`, `Qty`, `Sales Price` used when present).
  - Check Detail — `Type`, `Date`, `Name`, `Account`, `Original Amount`, `Paid Amount`.
  - Deposit Detail — `Type`, `Date`, `Name`, `Account`, `Amount`.
  - The header row may sit below report preamble lines; unrecognised layout → error listing the three supported exports.
- **Decoding and cells** — UTF-8 (BOM tolerated) then Windows-1252 (QuickBooks' "Save as CSV" often writes ANSI); formula guards removed from every cell; amounts tolerate `$`, thousands separators and negatives; dates `MM/DD/YY`, `MM/DD/YYYY`, `YYYY-MM-DD`.
- **Sales receipts** — rows without a parseable date (group headers, totals) are ignored. A row whose `Split` is `-SPLIT-` starts a receipt (Num, Date, Name = customer, Account = deposit account, Debit = total). Following rows: a `Sales Price` ending in `%` is a tax row (signed amount added to tax; the first rate kept, rounded half-up to six places); any other row is a line whose signed amount is Credit − Debit, so applied-deposit and discount contra lines keep their sign; description = Memo, else Item Description, else Item; item matched by exact name; qty = |Qty| or 1. A detail row before any receipt header → error for that row.
  - A receipt whose lines + tax ≠ total is skipped with an error.
  - Customer by exact name, created if missing (blank → "Walk-In Customer"). Duplicate key: same customer + date + total among sales receipts.
  - Number: the report's Num when free, else `SR-<num>`, `SR-<num>-1`, …; blank Num → next invoice number.
  - Creates a Paid invoice flagged as a sales receipt (terms Due on Receipt, tax rate from the % row) and a payment for the total, deposited to the header's account (else Undeposited Funds). Journals: DR A/R / CR each line's account (a negative line debits it; unmatched accounts go to Service Income with a warning naming them) / CR Sales Tax Payable for tax — posted only when balanced, else a warning; then DR deposit / CR A/R. Inventory-tracked items move stock.
- **Deposit Detail** — a `Type` = `Deposit` row starts a block (bank account, positive total), the payment rows under it (usually negative, from Undeposited Funds) are its splits, a `TOTAL` row ends it. The date must parse, the bank and every split account must exist (error points at importing the chart first), the total must be positive and the block must net to within $0.01.
  - Posted as a journal-only transaction with source `deposit`: DR bank, each split signed (negative → credit), description = the split's Name. Duplicate key: date + description "Deposit to <bank> (<total>)".
- **Check Detail** — `Type` = `Check` blocks: payee = Name, bank = Account, total = |Original Amount| (must be non-zero). Splits are sign-aware (−Paid Amount, else Original Amount), so a payroll check's withholding rows credit their liability accounts and net gross wages down to the check; splits must equal the total within $0.01 and every account must exist.
  - Posted with source `check`: CR bank, DR/CR splits, description "Check <num> - <payee> (<memo>)", reference = Num. Duplicate key: date + that description.
- **Other block types** — dated, typed rows outside a handled block (e.g. `Bill Pmt -Check`, `Paycheck`, `Transfer` in a Check Detail export) are counted and warned ("N 'Bill Pmt -Check' block(s) skipped … on the roadmap") instead of being dropped silently.
- **Result** — `detected` (`sales_receipts`/`deposits`/`checks`), counts for each, `duplicates_skipped`, `errors[]` (strings), `warnings[]`; each receipt/block is its own savepoint; the page shows the detected report, counts, duplicates, warnings, errors and a toast.
- **Fixtures** — `tests/fixtures/qb_transaction_detail_sales_receipts.csv` (an RV dealer's receipts: less-deposit contra lines, 6.4% tax rows, `-SPLIT-` headers), `qb_deposit_detail.csv`, `qb_check_detail.csv` (includes a payroll check with three withholding lines).

_Key files: `app/services/qb_report_import.py`, `app/routes/csv.py`, `app/static/js/iif.js`, `tests/fixtures/qb_check_detail.csv`, `tests/fixtures/qb_deposit_detail.csv`, `tests/fixtures/qb_transaction_detail_sales_receipts.csv`_

### QuickBooks Online — connection (OAuth 2.0)

- **Settings** (Settings → QuickBooks Online): `qbo_enabled` (Disabled/Enabled), `qbo_environment` (sandbox default / production), `qbo_client_id`, `qbo_client_secret`, `qbo_redirect_uri` (default `http://localhost:3001/api/qbo/callback`). Stored tokens: `qbo_access_token`, `qbo_refresh_token`, `qbo_realm_id`, `qbo_token_expires_at`, `qbo_oauth_state`. Client secret and both tokens are encrypted at rest and redacted as `********` on the settings page.
- **Browser connection** — `GET /api/qbo/auth-url` (admin) returns Intuit's authorization URL for the Accounting scope with a random `state` saved in settings (any failure → 400 telling the administrator to check Client ID and Client Secret in Settings). The page opens a blank tab first (opener cleared) and sends it to Intuit, so the original tab stays open for pasting values if the redirect can't reach SlowBooks.
- **Desktop app** — "Start connection with Intuit" opens Intuit's sign-in in the system browser through the pywebview bridge (`open_external`), rather than navigating the app window (v2.18.0).
- **Callback** — `GET /api/qbo/callback?code&state&realmId` is exempt from the session check (Intuit's cross-site redirect never carries the SameSite=Strict cookie); `state` is compared in constant time with the stored value (mismatch → 400 "possible CSRF attack"), the code is exchanged, tokens, realm ID and expiry are stored, the state cleared, and the browser is redirected to `/#/qbo`. Other failures → 500 with the detail only in the server log.
- **Manual completion (v2.18.0)** — `POST /api/qbo/connect-manual` `{authorization_code, realm_id}` (admin; unknown fields rejected; code ≤ 4096 and realm ≤ 128 characters). The page's "Authorization Code" box (password field) accepts the full callback URL and extracts `code` and `realmId`, or the values from Intuit's OAuth Playground; "Finish QBO connection". Intuit 401 → "rejected the QBO Client ID or Secret"; 400 → "rejected the authorization code … Redirect URI"; unreachable → 502; anything else → 400.
- **Tokens** — access tokens are refreshed automatically before any API client is built when within 60 seconds of expiry (new refresh token stored when Intuit rotates it); the client uses the stored realm, environment and minor version 65.
- **Status** — `GET /api/qbo/status?include_company_name=` → `{connected, company_name, realm_id}`; never returns tokens; connected = access token and realm ID present. The page asks without the company name and shows "Connected to QuickBooks Online (Realm: …)".
- **Disconnect** — `POST /api/qbo/disconnect` (admin) blanks the access/refresh tokens, realm ID, expiry and state; client credentials stay.
- **Roles** — connecting, disconnecting and importing are administrator-only (`require_admin`; the page hides those controls for others with a note); the connection panel, status and import log are readable by any signed-in role.

_Key files: `app/services/qbo_service.py`, `app/routes/qbo.py`, `app/static/js/qbo.js`, `app/models/settings.py`, `app/main.py`, `docs/setup-qbo.md`_

### QuickBooks Online import — chart, customers, vendors, items

- **Entry points** — `POST /api/qbo/import-runs` (background, used by the page), `POST /api/qbo/import` (all types, synchronous) and `POST /api/qbo/import/{entity}` with `accounts`, `customers`, `vendors`, `items`, `invoices`, `payments`, `sales_receipts`, `journal_entries`, `ledger` (unknown → 400 listing them). All admin-only; 400 when not connected.
- **Order** — accounts → customers → vendors → items → invoices → payments → sales receipts → journal entries → Posted Ledger Activity.
- **Paging** — every entity reads all pages (the SDK's `.all()` returns 100 unless positioned), logging each page fetch.
- **Mapping and duplicates** — each QBO record is looked up in `qbo_mappings` first; an unmapped one is matched by exact name (accounts, customers, vendors, items) or document number (invoices, sales receipts) and mapped to the existing record instead of creating a second one.
- **Accounts** — active accounts plus a second query for inactive ones (historical postings can reference them), deduplicated by ID and created parents-first by `FullyQualifiedName` depth; `ParentRef` → parent via its mapping; `AcctNum` → account number; `Description`; balance seeded from `CurrentBalance` (rebased on real postings later).
  - Type map (`QBO_TO_ACCOUNT_TYPE`): Bank, Accounts Receivable, Other Current Asset, Fixed Asset, Other Asset → Asset; Accounts Payable, Credit Card, Other Current Liability, Long Term Liability → Liability; Equity; Income, Other Income → Income; Expense, Other Expense → Expense; Cost of Goods Sold → COGS; unknown → Expense.
  - **Active flag** — QBO's `Active` is applied to an account that carries only the import's own postings; an account with postings made here keeps its state (warning `IMPORT_ACCOUNT_ACTIVE_KEPT`).
  - **Banking identity** — QBO Bank and Credit Card accounts are flagged `bank`/`credit_card` and get a Banking account row, on first import and on re-import of accounts mapped by older versions; a match with an incompatible local type or banking kind is an error for that account.
- **Customers** — parents first; a QBO sub-customer (`Job` true, the Online "Projects" flavour) becomes a Job under its mapped parent (fallback: resolve its `FullyQualifiedName` as `Customer:Job`), mapped as entity `job`.
  - Fields: `DisplayName` → name, `CompanyName`, primary email, phone, mobile, fax, `WebAddr` URI, billing and shipping address (Line1, Line2, City, CountrySubDivisionCode, PostalCode), `SalesTermRef` name → terms (default Net 30), `PrimaryTaxIdentifier`, `Taxable`, `Active`, `Balance`, `Notes`.
- **Vendors** — `DisplayName`, `CompanyName`, email, phone, fax, billing address, `TermRef` name (default Net 30), `TaxIdentifier`, `AcctNum` → account number, `Active`, `Balance`, `Notes`.
- **Items** — `Name`, type map Service → Service, Inventory → Product, Group → Product, NonInventory → Material (other → Service), `Description`, `UnitPrice` → rate, `PurchaseCost` → cost, income and expense accounts through their mappings, `Taxable`, `Active`.
- **Per-record errors** — each failing record adds `{entity, qbo_id, message, code}` and the rest continue; a failed page query returns "Failed to query QBO: …" for that entity.

_Key files: `app/services/qbo_import.py`, `app/services/qbo_common.py`, `app/routes/qbo.py`, `app/schemas/qbo.py`, `app/models/qbo_mapping.py`_

### QuickBooks Online import — invoices, payments and sales receipts

- **Documents without their own posting** — invoices, payments and sales receipts come in as documents with no journal entry; their money is posted once, by Posted Ledger Activity, from QBO's own General Ledger lines.
- **Customer resolution** — `CustomerRef` → mapped customer, else a mapped project (sub-customer) resolving to its parent customer and keeping the job on invoices and receipts, else exact name; otherwise error `IMPORT_CUSTOMER_NOT_FOUND` naming the document, the CustomerRef ID/name, any broken mapping and linked transactions ("Import Customers before this document").
- **Invoices** — number from `DocNumber` (an existing local invoice with that number is mapped, not duplicated); status from `Balance` vs `TotalAmt` (equal → Sent; between → Partial; zero with a total → Paid); `TxnDate`, `DueDate`; tax = `TxnTaxDetail.TotalTax`, subtotal = total − tax; paid = total − balance; `CustomerMemo` → notes.
- **Sales receipts** — each becomes a Paid invoice flagged as a sales receipt (due = date, terms Due on Receipt; number from `DocNumber` or the next invoice number; existing number → mapped) plus a payment for the total with the method, `PaymentRefNum` and `DepositToAccountRef` (mapped) fully allocated to it.
- **Payments** — `TotalAmt`, `TxnDate`, `PaymentRefNum`, method, deposit account via mapping; each line's `LinkedTxn` of type Invoice becomes an allocation to the mapped invoice, updating its paid amount and status.
- **Lines** (`_document_lines`), in QBO's order:
  - Sales lines (`SalesItemLineDetail`): mapped item, description, `Qty` (default 1), `UnitPrice`, `Amount`, and taxable flag from `TaxCodeRef` (`TAX` taxable, `NON` not, none → taxable).
  - **Bundles** (`GroupLineDetail`): the lines of the bundle's items; when the bundle's own amount differs from its items' total, the difference is a line named for the bundle, taxable only if every item is.
  - **Discounts** (`DiscountLineDetail`): a negative line on a Discount item — one service item per QBO discount account ("Discount", "Discount (<account>)", numbered if taken), whose income account is QBO's discount account, remembered as mapping entity `discount_item`; "Discount 10%" when percentage-based. With `ApplyTaxAfterDiscount`, the part QBO took off the taxable amount is a taxable line and the rest a non-taxable one. A discount account not yet imported is an error ("import Accounts, then this again").
  - Subtotal lines are ignored; if the lines don't add up to QBO's pre-tax total the log notes `IMPORT_LINES_SHORT`.
- **Sales tax** — the document keeps QBO's tax amount; its rate is the sum of the percentage tax lines (state + county + city) when they share one taxable base and that rate reproduces QBO's tax to the cent on the taxable lines, stored to six places; otherwise 0, so an edit keeps QBO's amount.
- **Cost of goods** — tracked items move stock on import; the sale is costed at the local average cost only while the ledger import hasn't posted it; when Posted Ledger Activity later posts QBO's lines (which carry QBO's own cost of goods) the local cost entry is reversed (`qbo_cogs_void`, `IMPORT_COGS_REPLACED`) and the stock movement stays.
- **Changes made in QuickBooks Online** — on re-import a mapped document still owned by the import (not voided or edited here, no posting of its own) whose `SyncToken` changed is compared with QBO: identical → token refreshed ("Verified"); reads 0.00 (QBO's void) → left for the ledger import; otherwise header, lines, tax rate and (for receipts) the payment are rewritten, status recomputed, inventory adjusted by the difference (`IMPORT_QBO_CHANGE_APPLIED`).
  - Not applied, with a log line and the document kept as imported (`IMPORT_QBO_CHANGE_NOT_APPLIED`): the old or new date is in a closed period, its posting is on a reconciled statement or in a deposit made here, a payment would over-pay an invoice or hits a void one, or an invoice's new total is below what has been paid here.
  - Documents imported before discounts/bundles came across (pre-2.18) gain those lines once, totals unchanged (`IMPORT_QBO_LINES_ADDED`).
- **Payment refresh** — amount, date and invoice allocations are rewritten the same way (previous allocations taken off their invoices first).

_Key files: `app/services/qbo_import.py`, `app/services/qbo_documents.py`, `app/services/qbo_common.py`, `app/services/inventory_hooks.py`_

### QuickBooks Online import — journal entries and Posted Ledger Activity

- **Journal entries** (`journal_entries`) — `SELECT * FROM JournalEntry` through every page, independent of report availability.
  - Lines by `PostingType` Debit/Credit (never `TotalAmt`, which is 0 on journals); description-only lines skipped; zero-amount lines skipped; each line needs a mapped account; fewer than two posting lines, an unsupported line type, a negative/unreadable amount, or an unbalanced journal is a validation error naming the journal, line, position and account.
  - Foreign currency: balanced in its own currency, converted at `ExchangeRate` line by line with the rounding cent on the largest line (`convert_lines`).
  - Posted with source `qbo_journal`, description = `PrivateNote` or "QBO Journal Entry <id>", reference = `DocNumber` or ID; mapping entity `journal_entry` with QBO's SyncToken.
  - An old empty journal stub (one unsigned zero account line plus description lines) is skipped only after the General Ledger report confirms no posting that day (`IMPORT_NON_POSTING_JOURNAL`).
  - Changed in QBO (postings differ by date or per-account amounts — a new SyncToken alone is not a change): the old posting is reversed and the new one posted. Voided (every line 0.00) → reversed (`voided-in-qbo`). Deleted (absent from a complete, cleanly loaded list) → reversed (`deleted-in-qbo`), unless none of the previously imported journals is in the list ("is this the company they came from?" — nothing taken as deleted). A voided or deleted journal that reappears is posted again.
  - Journals first posted by an older ledger import are reused, and a legacy parent-account roll-up is repaired when every date and amount matches exactly (IDs and reconciliation links kept; refused for cleared, reconciled or deposited lines — `IMPORT_ACCOUNT_ROLLUP_REPAIRED` / `IMPORT_REPAIR_REFUSED`).
  - **Batch rule** — any validation error on a new journal blocks the whole batch (`IMPORT_BATCH_BLOCKED`); changes that can't be applied to already-imported journals are reported and never block. New postings dated on or before the closing date are errors.
- **Posted Ledger Activity** (`ledger`) — QBO's accrual General Ledger report posted as balanced journals, covering purchases, bills, deposits, transfers, checks, invoices, payments, sales receipts and journals.
  - Fetched from 1900-01-01 to today: everything before 2000 as one period, then one request per calendar year; a period returning 500+ rows is halved recursively (reports can't be paged) and a single day with 500+ rows is refused as possibly truncated.
  - Report checks: returned period must equal the request, columns must be exactly `Date, Transaction Type, Num, Name, Memo/Description, Split, Amount, Balance`, basis must be accrual, amounts must be whole cents (parenthesised negatives read); any failure imports nothing.
  - Rows grouped by `<Transaction Type>:<ID>`; each amount signed by account type (asset/expense/COGS debit-normal); every group must balance and be non-zero; accounts must be mapped (import Accounts first); a transaction ID on two dates is an error.
  - Skipped: a transaction whose mapped local document has its own posting (written here and exported, or matched by number — `IMPORT_ALREADY_POSTED`), journals already brought by the JournalEntry import, and anything changed here.
  - Posted with source `qbo_ledger` (`qbo_journal` for journal types), description "QBO <type> — <name> — <memo>", reference = Num or the key; mapping entity `ledger`, key `Type:ID`, SHA-256 fingerprint of date/type/number/lines in the sync-token column.
  - Before posting, account balances seeded from QBO's `CurrentBalance` are rebased on actual local postings so history isn't counted twice. No synthetic opening balance is added.
  - Changed in QBO → reversed and reposted; voided in QBO (every row 0.00) → reversed and the imported document voided too (a receipt's own payment with it; other payments stay unapplied; stock returned) (`IMPORT_QBO_VOID_APPLIED`). Closed period, reconciled line or money in a deposit here → `IMPORT_QBO_CHANGE_NOT_APPLIED`.
  - Atomic: any validation error posts no ledger activity (`IMPORT_BATCH_BLOCKED`); the batch runs in one savepoint. The service also supports a date range and dry run, but no API route exposes them.
- **Journal Entries page** — imported journals (and older report-imported journals keyed `Journal Entry:`, `General Journal:`, `JournalEntry:`, `Journal:`) are listed with manual journals.

_Key files: `app/services/qbo_ledger_import.py`, `app/services/qbo_import.py`, `app/services/qbo_common.py`, `app/services/qbo_documents.py`, `app/routes/journal.py`_

### QuickBooks Online import runs — live log, progress and workers

- **Background run** — `POST /api/qbo/import-runs` `{entities: [...]}` (subset in dependency order) or `{}`/`null` (all nine) → HTTP 202 `{run_id, status: "queued"}`; the body is strict (unknown fields 422; 1–9 known entity names). A worker thread commits after each entity, so the company stays writable (SQLite) between steps. A second start while one is queued or running → 409 `{message, run_id}` — including starts through the older synchronous endpoints, which record into the same log.
- **Latest run only** — `GET /api/qbo/import-runs/latest?after=<sequence>` → `{run, events (≤500 after the cursor), has_more, server_time}`; any signed-in role may read it. A new accepted run replaces the previous log.
  - `run`: `run_id`, `status` (queued, running, completed, completed_with_errors, failed, interrupted), `started_at`, `finished_at`, `started_by`, `entities`, current `entity`, `current_step`, `last_progress_at`, `last_sequence`, `counters` {fetched, processed, imported, skipped, errors, pending}, `result` (per-entity imported counts and errors).
  - Events: `sequence`, `timestamp`, `level` (info/warning/error), `code`, `entity`, `item_id`, `item_label` (document number or name), `action` (start, entity, query, fetch, validate, map, create, skip, error, verify, repair, update, resolve, note, post, block, rollback, commit, summary, interrupt, finish), `message`.
  - "Pending" counts records created in the open transaction; "Imported" rises only on commit; rollbacks are logged (`IMPORT_ROLLED_BACK`) and pending counts restored.
- **Storage** — a private SQLite sidecar (WAL, folder 0700, file 0600) at `<backups root>/.qbo-import/<sha256 of the company database URL>/latest.sqlite3`, separate from the books so progress stays readable during long SQLite writes.
- **Workers and restarts** — Server Edition runs several uvicorn workers; the owning process beats a heartbeat every 5 s and another process treats a run as interrupted only after 20 s without one (`IMPORT_INTERRUPTED`, "Server restarted; unfinished work was not resumed"); writes take the file's write lock first so two workers can't both start a run.
- **Backup restore** — refused with 409 `qbo_import_running` while a run is active.
- **Page log** — under the import controls: Import All Data and Import Selected (nine checkboxes, all ticked: Accounts, Customers, Vendors, Items, Invoices, Payments, Sales Receipts, Journal Entries, Posted Ledger Activity).
  - Polls every 2 s (immediately while `has_more`), 10 s per-poll timeout, 15 s start timeout; survives leaving and returning to the page.
  - Table columns Timestamp · CODE · ITEM · ACTION · MESSAGE (numeric provider codes shown as `QBO <code>`); **Errors** filter; counts Fetched/Processed/Imported/Pending/Skipped/Errors; status badge (Queued, Running, Completed, Completed with errors, Failed, Interrupted), elapsed time, "Waiting" after 30 s without progress, "Connection interrupted" after 15 s without server contact.
  - Import buttons stay disabled, with the reason written under them, until the monitor has answered (not connected; a run in progress; monitor unavailable). HTTP 404/405/501 → "Server update required" and **Retry monitor**; 401 prompts sign-in. Client-side diagnostics (`IMPORT_REQUEST`, `IMPORT_REQUEST_TIMEOUT`, `NETWORK_ERROR`, `MONITOR_TIMEOUT`, `MONITOR_RECONNECTED`, `HTTP_<status>`) appear in the table without advancing the saved cursor.
  - The finished run's result is summarised as for export (per-type counts, errors).

_Key files: `app/services/qbo_import_runs.py`, `app/services/qbo_progress.py`, `app/routes/qbo.py`, `app/static/js/qbo.js`, `app/routes/backups.py`_

### QuickBooks Online documents changed here — managed edits, voids and the kept log

- **Voiding an imported invoice or sales receipt** — reverses the Posted Ledger Activity posting for it (refused if that posting is on a reconciled statement), returns stock without a local cost entry when QBO's posting carried the cost, and marks its mappings "changed in SlowBooks".
- **Voiding an imported payment** — reverses its import posting (or, for a sales receipt's payment, the receipt's), refuses when the money is on a reconciled statement or already in a deposit, and voids the receipt with its payment.
- **Editing amounts or date** of an imported invoice or receipt makes it an ordinary SlowBooks document: the import posting is reversed first (so A/R is never counted twice), stock is costed locally again, a receipt's payment gets its own posting, and unposted imported payments on it — and the other imported invoices those payments pay — are adopted and posted too. Editing words only leaves it the import's.
- **Voiding the import's posting from Journal Entries** voids the document it belongs to (and a receipt's payments); any other QBO posting is reversed under `qbo_ledger_void`/`qbo_journal_void` and its mappings marked changed here.
- **Discount lines** — a line on a Discount item may carry a negative price on the invoice form (items are flagged `is_discount` in the item list); other negative lines are still refused ("use a credit memo").
- **Changes here win** — later imports leave such documents and journals as they are. The first run to keep one logs "Changed in SlowBooks; kept as it is here" and marks it `kept-in-slowbooks`; every run ends with one summary line "N transactions changed in SlowBooks were kept as they are here" instead of repeating a line per transaction.

_Key files: `app/services/qbo_documents.py`, `app/services/qbo_common.py`, `app/routes/invoices/crud.py`, `app/routes/invoices/lifecycle.py`, `app/routes/payments.py`, `app/routes/journal.py`, `app/routes/items.py`_

### QuickBooks Online export

- **Endpoints** — `POST /api/qbo/export` (all, in order accounts → customers → vendors → items → invoices incl. sales receipts → payments; one commit) and `POST /api/qbo/export/{entity}` for `accounts`, `customers`, `vendors`, `items`, `invoices`, `payments`. 400 when not connected. No `require_admin`: a bookkeeper may export (read-only roles can't POST).
- **Send once, then only changes** — a record's first export creates it in QBO and saves a mapping marked `sent:` + a 16-hex SHA-256 fingerprint of the fields sent. A later export compares fingerprints: unchanged → nothing sent; changed → QBO's current copy is read (for its SyncToken and the fields SlowBooks doesn't keep), SlowBooks' fields applied (a `None` clears a field) and saved (`updated`); voided here after it went → voided in QBO once (`sent:void`, `voided`).
  - Never touched: records the import brought in or matched (their mappings hold QBO's SyncToken), records an earlier release sent (indistinguishable from those), records voided before they went, inactive records never sent.
  - QBO's refusals become `notes` in QBO's own words with its error code, and the next export retries; other failures are `errors` per record.
- **Accounts** — `Name`, `AccountType`/`AccountSubType` (Asset → Other Current Asset; Liability → Other Current Liability; Equity → Equity/Opening Balance Equity; Income → Income/Sales of Product Income; Expense → Expense/Other Miscellaneous Service Cost; COGS → Cost of Goods Sold/Supplies and Materials - COGS), `AcctNum`, `Description`, `ParentRef` + `SubAccount`, `Active`.
- **Customers** — `DisplayName`, `CompanyName`, `BillAddr`, `ShipAddr`, email, phone, mobile, fax, `Notes`, `Active` (jobs are not exported).
- **Vendors** — `DisplayName`, `CompanyName`, `BillAddr`, email, phone, fax, `Notes`, `AcctNum`, `Active`.
- **Items** — `Name`, `Type` (Service → Service, Product → Inventory, Material → NonInventory, Labor → Service), `Description`, `UnitPrice`, `PurchaseCost`, `IncomeAccountRef` (its own, else the first active income account's mapping), `ExpenseAccountRef`, `Active`.
- **Invoices** — `CustomerRef` (a customer not yet in QBO → error "Customer N not mapped to QBO" for a never-sent document), `DocNumber`, `TxnDate`, `DueDate`, `CustomerMemo`, and lines:
  - Each sales line with `Qty`, `UnitPrice`, `ItemRef` (if mapped) and **tax code** `TAX`/`NON` — a document that charged no tax sends every line `NON`, so QBO adds no tax this document didn't charge; `TxnTaxDetail` is left empty so QBO works the tax out from the codes.
  - **Discounts** — lines on Discount items go as QBO's single `DiscountLineDetail` (not negative sales lines) for their total, on the discount account of the item with the most of it, placed where the first discount line was; `ApplyTaxAfterDiscount` set when a discounted line was taxable; a note names any other discount account folded in.
- **Sales receipts (v2.18.0)** — go as QBO `SalesReceipt` with the same lines plus `DepositToAccountRef` and `PaymentRefNum` from the receipt's payment; counted separately (`sales_receipts`); their payment halves are not exported as payments. A receipt an older release sent as invoice + payment stays that way.
- **Payments** — `CustomerRef`, `TotalAmt`, `TxnDate`, `PaymentRefNum`, `DepositToAccountRef`, one line per allocation to a mapped invoice (`LinkedTxn`).
- **Result** — `accounts`, `customers`, `vendors`, `items`, `invoices` (excluding receipts), `sales_receipts`, `payments`, `updated`, `voided`, `errors[]`, `notes[]`. The page's Export All Data / Export Selected (six checkboxes) shows per-type counts, "Updated in QuickBooks Online", "Voided in QuickBooks Online", errors and notes; toast "Exported N records to QBO; M brought up to date there".

_Key files: `app/services/qbo_export.py`, `app/services/qbo_common.py`, `app/routes/qbo.py`, `app/static/js/qbo.js`_

### QBO ID mapping table (`qbo_mappings`)

- **Columns** — `entity_type`, `slowbooks_id`, `qbo_id` (≤100 chars), `qbo_sync_token` (≤50), `last_synced_at`; non-unique composite indexes on (entity_type, qbo_id) and (entity_type, slowbooks_id).
- **Entity types in use** — `account`, `customer`, `job`, `vendor`, `item`, `invoice`, `payment`, `sales_receipt`, `journal_entry`, `ledger` (qbo_id `Type:ID`), `discount_item` (qbo_id = QBO discount account).
- **What the sync-token column holds** — QBO's SyncToken (imported records and journals), a ledger fingerprint, an export mark (`sent:<hash>`, `sent:void`), or an ownership state: `changed-in-slowbooks`, `kept-in-slowbooks`, `voided-in-qbo`, `deleted-in-qbo`.
- **Integrity guard** — the ledger and journal imports refuse to run when one QBO account maps to several local accounts ("Ambiguous QBO account mappings").

_Key files: `app/models/qbo_mapping.py`, `app/services/qbo_common.py`, `app/services/qbo_ledger_import.py`_

### Migrate Data wizard — shared engine

- **Routes** — `GET /api/migration/sources` → `[{key, label}]` for `xero` (Xero), `myob` (MYOB), `sage` (Sage 50), `wave` (Wave), `zoho` (Zoho Books), `gnucash` (GnuCash). `POST /api/migration/{source}/dry-run` and `/import` take multipart `files` (several); unknown source → 400. The two POSTs are administrator-only (RBAC route policy).
- **Bundle assembly** — each file is classified by its name (see dialects); an unrecognised name → 400 listing the files. Each file ≤ 20 MB, decoded as UTF-8 (BOM stripped) else Latin-1. Several files of one kind (MYOB's per-type journal exports) are concatenated, dropping repeated header rows; different headers → 400 "export them with the same settings".
- **Kinds** — `coa` (chart, required), `gl` (general ledger / journals / transactions, required), `tb` (trial balance, optional but recommended).
- **Cells** — headers matched case-insensitively through alias lists (BOM tolerated); delimiter sniffed from the first line (tab or comma); formula guards removed; amounts tolerate `$`, thousands separators and `(1,234.00)` negatives; dates tried against each dialect's formats. Unreadable dates/amounts become row errors.
- **Dry run (writes nothing)** — requires the chart and ledger files; every reconstructed journal must balance exactly to the cent (a one-cent drift is an error, as the journal engine would refuse it); every ledger account must exist in the chart file or the books (the `Name (Code)` form matches its bare name); a ledger whose every journal is 0.00 is refused with the file's own header row in the message (unrecognised amount columns — #169), and some empty journals are warned about and skipped.
  - Trial-balance check: the ledger's net per account vs the trial balance. Differences that net to zero are treated as opening balances (entered as account setup in the source, e.g. via MYOB's Historical Balancing account) with a warning; differences that don't net to zero are errors per account. No trial balance → warning "balance verification skipped".
  - Journals whose reference this source already imported are warned about and will be skipped (the #169 reporter clicked Import four times).
  - Returns `ok`, `errors`, `warnings`, `accounts`, `journals`, `duplicate_journals`, `opening_balances`.
- **Import** — re-runs the dry run and refuses when it fails (`imported_accounts` 0); creates chart accounts not already present by case-insensitive name (flat — no parent hierarchy; a source code colliding with an existing account number is dropped rather than failing); posts one balanced opening-balance journal dated the day before the earliest journal (source `opening_balance`, reference `OPENING`, "<Source> migration — opening balances", not repeated if already posted); posts every journal through the double-entry engine with source `<source>_import`, reference = the journal's number/ID (else its reference), description = the first line's description or "<Source> import <ref>"; negative amounts move to the other side; zero lines dropped. One commit.
  - Returns the dry-run fields plus `imported_accounts`, `imported_journals`, `skipped_journals` (all-zero), `duplicate_journals`.
  - On success the route records `chart_setup_source` (e.g. `xero_import`) and `chart_setup_ready_at`, which the Opening Balances wizard's status reports.
- **Page (`#/migrate`, sidebar → Banking → Migrate Data; `#/xero-import` and `#/myob-import` open it preselected)** — admin-only page; "Coming from" source picker; multi-file input (`.csv`, `.txt`); **Dry Run**, then **Import** (enabled only after a passing dry run, disabled again when the source or files change); errors in red, warnings listed; "Imported N accounts and M journals".

_Key files: `app/services/migration_common.py`, `app/routes/migration.py`, `app/static/js/migration.js`, `app/routes/opening_balances.py`, `app/main.py`_

### Migrate Data — sources (dialects)

- **Filename classification** — Sage 50, Wave, Zoho and GnuCash use the shared table, checked in order: `chart` → chart; `general`, `ledger`, `journal`, `transaction` → ledger; `account`, `acct` → chart; `trial` → trial balance (ledger words first, so Wave's "Account Transactions.csv" is a ledger). Xero and MYOB keep their own order: `chart`, `account` → chart; `general`, `ledger`, `journal` → ledger; `trial` → trial balance.
- **Xero** (CSV only; no XLSX, no live Xero API) — chart: name `Name`/`Account Name`/`Account`, type `Type`/`Account Type`/`Class`, code `Code`/`Account Code`/`*Code`, `Description`.
  - Types: bank, current asset(s), fixed asset(s), inventory, non-current asset, prepayment, asset → Asset; current liability/liabilities, liability, non-current liability → Liability; equity; revenue, sales, income, other income → Income; direct costs, cost of goods sold → COGS; expense(s), overheads, depreciation → Expense; others are row errors.
  - Ledger: `Account`/`Account Name`, `Date`/`Journal Date`, `Journal Number`/`Journal No`/`Journal #`/`JournalNumber` (grouping key, else date + reference), `Description`/`Details`/`Narration`, `Reference`/`Source`, `Debit`/`Debit (Source)`, `Credit`/`Credit (Source)`. Dates `d Mon YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY`, ISO, `d Month YYYY`.
  - Trial balance: `Account`/`Account Name`/`Name` with `Debit`/`Debit YTD`/`YTD Debit` and credit equivalents.
- **MYOB** (AccountRight classic tab-separated `.TXT`, cloud CSV; `.MYO` files not supported) — chart: `Account Name`/`Name`/`Account`, `Account Number`/`Account No.`/`Number`/`Code`, `Account Type`/`Type`; non-postable header accounts (`Header` flag h/header/y/yes/true/1) skipped; two accounts sharing a name import as `Name (code)`.
  - Types: bank, accounts receivable, other current asset, current asset, fixed asset, other asset, asset → Asset; credit card, accounts payable, other current / current / long term / other liability, liability → Liability; equity; income, other income; cost of sales → COGS; expense, other expense.
  - Ledger: account name, or account number only (`Account Number`/`Account No.`/`Acct No.`, dashed `1-1100` or flat) resolved through the uploaded chart; `ID No.` + date + memo as grouping key (MYOB reuses IDs such as `EP`); `Memo`/`Description`/`Narration`; `Debit Amount`/`Debit`/`Debit Amt` and credit equivalents; contra lines as negative amounts. Dates `DD/MM/YYYY`, `DD/MM/YY`, ISO, `d Mon YYYY`.
  - Trial balance: report preamble (company block, title, period) skipped; `Total`/`Grand Total` rows skipped; YTD Debit/Credit preferred over the month's movement.
  - Validated against MYOB's Clearwater sample (101 accounts, 328 journals) per `docs/migrate-from-myob.md`.
- **Sage 50 (US / Peachtree)** — chart: `Account ID`/`Account No.`/`Account Number` (code), `Account Description`/`Description`/`Account Name` (name), `Account Type`.
  - Types: cash, accounts receivable, inventory, other current asset(s), fixed asset(s), accumulated depreciation (stays asset), other asset(s) → Asset; accounts payable, other current / long term liabilities → Liability; equity-doesn't close, equity-gets closed, equity-retained earnings, equity → Equity; income, other income; cost of sales → COGS; expense(s), other expense.
  - Ledger: rows carry the Account ID, resolved through the chart; `Date`/`Trans Date`; grouping `Jrnl`-`Reference`-date; `Trans Description`/`Description`/`Memo`; `Debit Amt`/`Debit Amount`/`Debit` and credit equivalents. Dates `MM/DD/YYYY`, `MM/DD/YY`, ISO.
- **Wave** — chart: `Account Name`/`Name`/`Account`, `Account Type`/`Type`/`Account Group`, `Account ID`/`Account Code`; types mapped explicitly (Cash and Bank, Money in Transit, Expected Payments from Customers, Inventory, Property Plant Equipment, Depreciation and Amortization, Vendor Prepayments, other short/long-term asset → Asset; Credit Card, Loan and Line of Credit, Expected Payments to Vendors, Sales Taxes, Due for Payroll, Due to You and Other Business Owners, other short/long-term liability → Liability; Business Owner Contribution and Drawing, Retained Earnings: Profit → Equity; Income, Discount, Other Income, Uncategorized Income; Cost of Goods Sold; Operating Expense, Payment Processing Fee, Payroll Expense, Uncategorized Expense, Loss on Foreign Exchange → Expense), then by keyword.
  - Ledger: the "Account Transactions" report (account name under an `ACCOUNT NUMBER` header, money columns "(In Business Currency)") and the full `accounting.csv` export ("Debit/Credit Amount (Two Column Approach)"); the signed `Amount (One column)` is used only when no debit/credit pair exists (positive = debit); `Transaction ID` groups; `Transaction Date`/`Date`. Dates ISO, `MM/DD/YYYY`, `DD/MM/YYYY`.
  - Trial balance: report preamble skipped; `ACCOUNTS` header; section rows without amounts and `Total…` rows skipped.
- **Zoho Books** — chart: `Account Name`/`Name`/`Account`, `Account Type`/`Type`, `Account Code`/`Account Number`; types bank, cash, fixed asset, stock, inventory, other (current) asset, accounts receivable, payment clearing, input tax → Asset; other current / long term / other liability, accounts payable, credit card, output tax → Liability; equity; income, other income; expense, other expense; cost of goods sold.
  - Ledger: `Journal Number`/`Journal#`/`Journal No`/`Journal No.`, `Journal Date`/`Date`/`Transaction Date`, `Account`, `Debit`/`Credit` (or `… Amount`), `Reference Number`/`Reference#`/`Reference`, `Description`/`Notes`/`Transaction Details`. Dates ISO, `DD/MM/YYYY`, `MM/DD/YYYY`, `d Mon YYYY` (date order is configurable in Zoho; the trial-balance check catches a wrong order).
- **GnuCash** — chart from File → Export → Accounts to CSV: the full colon path (`Full Account Name`) becomes the account name; placeholder or hidden accounts and the ROOT row skipped; types BANK, CASH, ASSET, RECEIVABLE, STOCK, MUTUAL → Asset; CREDIT, LIABILITY, PAYABLE → Liability; EQUITY; INCOME; EXPENSE.
  - Ledger (transactions export): one row per split, grouped by `Transaction ID`, single signed `Amount Num.` (positive = debit); `Number`/`Num` as reference. Dates ISO, `MM/DD/YYYY`, `DD/MM/YYYY`, `DD.MM.YYYY`.
  - GnuCash has no trial-balance CSV; verification is skipped with the standard warning unless one is supplied by hand.

_Key files: `app/services/xero_import.py`, `app/services/myob_import.py`, `app/services/sage_import.py`, `app/services/wave_import.py`, `app/services/zoho_import.py`, `app/services/gnucash_import.py`, `app/services/migration_common.py`, `docs/migrate-from-myob.md`_

### Chart of accounts import (CSV, spreadsheets, hledger)

- **Endpoint** — `POST /api/csv/import/accounts?dry_run=true|false&replace=false|true` (multipart `file`; `dry_run` defaults to true; empty file → 400 "The file is empty."; UTF-8 then Windows-1252).
- **UI** — Chart of Accounts → **Import…**: file (`.csv`, `.txt`, `.journal`), "Replace the seeded chart" checkbox, **Preview** (dry run) showing "N to create, N to update, N already there[, N to deactivate, N kept]. Nothing has been written yet.", file errors, and a per-row table (Action · Number · Name · Type · Detail); **Import N changes** (hidden when nothing would change) posts the same file and options with `dry_run=0`, then reloads the chart. A **Download a template** link serves `/static/downloads/chart-of-accounts-template.csv`. The CSV page's "Chart of Accounts" entity applies immediately (`dry_run=0`, no replace).
- **Template** — columns `Number,Name,Type,Parent,Description,Active`; 19 example rows using types `bank`, `asset`, `liability`, `credit card`, `equity`, `income`, `cogs`, `expense`, parents by number (1310 Neon tubes under 1300; 6210/6220 under 6200 Utilities) and one inactive row (6900 Old Account, `false`).
- **Format detection** — a leading BOM is removed; the first non-comment line (`;`/`#` lines skipped) is a CSV header when it has at least two comma-separated cells and one is a known header word; otherwise the file is read as an hledger account list.
- **CSV headers** — number: `Number`, `Account Number`, `Acct Number`, `Acct #`, `No`, `No.`, `#`, `Code`; name: `Name`, `Account`, `Account Name` (required, else a file error); type: `Type`, `Account Type`; parent: `Parent`, `Parent Account`, `Sub-account of`; description: `Description`, `Memo`; `Active`; `Balance` (recognised, never imported). SlowBooks' own chart export re-imports as is.
  - Type words: asset(s), bank/cash (marked bank), current / other current / fixed / other asset, accounts receivable → Asset; liability/liabilities, credit card (marked card), current / other current / long term / long-term liability, accounts payable → Liability; equity; income, revenue(s), sales, other income → Income; cogs, cost of goods sold, cost of sales → COGS; expense(s), other expense → Expense. Underscores read as spaces.
  - Unknown type → row error; no type → inferred from the number's first digit (1 asset, 2 liability, 3 equity, 4 income, 5 COGS, any other digit expense); neither → row error. `Active` accepts false/no/0/inactive and true/yes/1/active. Names cut to 200, numbers to 20 characters. Parent may be a number or a name, in the file or already in the chart.
- **hledger** — `hledger accounts` (one colon path per line; an `account ` directive prefix is accepted), `hledger accounts --types` (the `; type: X` tag wins: A asset, L liability, E equity, R revenue → income, X expense, C cash → bank asset, V conversion → equity), and `hledger balance -O csv` (`"account","balance"`; the `total` row skipped; balances not imported).
  - The top segment (assets, liabilities, equity, revenue(s), income, expense(s), cogs, cost of goods sold) is the category, not an account; the leaf becomes the name with its first letter capitalised; the full path is kept as the description; a flat name with no category or tag is a row error.
  - Intermediate parents the file never lists are synthesised ("parent of a listed account"), so `assets:cash:petty cash` becomes *Petty cash* under *Cash*.
  - Bank/card marking from the path: bank, checking, savings, cash, petty cash under assets → bank; credit card, visa, mastercard, amex, discover under liabilities → card.
- **Plan (row fates)** — each row is `create`, `update`, `skip`, `deactivate`, `keep` or `error`, with changes and a note:
  - Matching, in order: the file's number already in the chart (the same number twice in the file → error); a **control-account alias** — a name of checking (1000), receivable/accounts receivable (1100), undeposited funds (1200), inventory (1300), payable/accounts payable (2000), credit card (2100), sales tax payable/sales tax (2200), retained earnings (3200), cost of goods sold/cogs (5000), or the first credit-card liability row (2100) — so the control account is **renamed to the file's name** instead of being duplicated (a parent segment counts: `assets:inventory` is 1300 and its children hang from it); then an exact name match in any case whose numbers don't conflict.
  - Updates: rename; type change (not for a control account — "the software posts to it by number" — nor for an account with postings); a number for an unnumbered account; description; bank/card marking; deactivate/reactivate from `Active`. Nothing to change → `skip` ("already in the chart").
  - New rows keep their number when free, else get the next free number in their type's range stepping by 10 then by 1 (1000–1999 asset, 2000–2999 liability, 3000–3999 equity, 4000–4999 income, 5000–5999 COGS, 6000–9999 expense; a full range continues above the highest number), noted "number N is taken; assigned M"; a same-named account matched by another row is disclosed. An unresolved parent is noted "left at top level".
  - **Replace the seeded chart** (`replace=true`) — every active account the file doesn't name: control account (the 15 numbers 1000, 1100, 1200, 1300, 2000, 2100, 2200, 3200, 4000, 4800, 5000, 5900, 6000, 6120, 6150) → `keep`; posted to → `keep` with the posted-line count; otherwise → `deactivate` (hidden from new entries, reactivatable).
- **Apply** — the second call re-plans and applies exactly that plan (creates, then updates, parent links and deactivations; error rows skipped) and commits; re-importing the same file changes nothing.
- **Response** — `format` (`csv`/`hledger`), `dry_run`, `replace`, `created`, `updated`, `skipped`, `deactivated`, `kept`, `row_errors`, `rows[{row, number, name, type, action, note, changes, existing_id}]`, `errors[]`.
- **Fixtures** — `tests/fixtures/hledger/` holds a sign shop's journal and the three outputs produced by hledger 1.30.1.

_Key files: `app/services/chart_import.py`, `app/services/control_accounts.py`, `app/routes/csv.py`, `app/static/js/app.js`, `app/static/downloads/chart-of-accounts-template.csv`, `tests/fixtures/hledger/`_

### CSV export

- **Endpoints and columns** (all `GET`, file names in brackets):
  - Customers [`customers.csv`] — active: ID, Name, Company, Email, Phone, Address (billing line 1), City, State, ZIP, Terms, Balance (summed from open documents).
  - Vendors [`vendors.csv`] — active: ID, Name, Company, Email, Phone, Address, City, State, ZIP, Terms, Balance.
  - Items [`items.csv`] — active: ID, Name, Type, Description, Rate, Cost, Taxable (rates written with 2–4 places: `12.50`, `0.045`).
  - Invoices [`invoices.csv`] — every invoice, void ones and sales receipts included (no column marks a receipt), optional `date_from`/`date_to`: Invoice #, Customer, Date, Due Date, Status, Subtotal, Tax, Total, Paid, Balance.
  - Bills [`bills.csv`] — non-void, one row per line: Bill #, Vendor, Date, Due, Terms, Status, Class, Job (line job, else bill job, as "Customer: Job"), Line, Account, Cost Code, Description, Qty, Rate, Amount, Subtotal, Tax, Total, Balance Due.
  - Deposits [`deposits.csv`] — journal-only deposits, one row per source (credit) line: Deposit ID, Date, Reference, Memo, Bank Account, Line, From Account, Description, Amount.
  - Sales receipts [`sales_receipts.csv`] — non-void, one row per line: Receipt #, Customer, Date, Class, Job, Line, Item, Description, Qty, Rate, Taxable, Amount, Subtotal, Tax, Total.
  - Classes [`classes.csv`] — non-system: ID, Name, Archived (Y/N).
  - Jobs [`jobs.csv`] — ID, Customer, Job, Customer:Job, Job #, Status, Type, Start, Projected End, Contract Amount, Active (Y/N).
  - Chart of accounts [`chart_of_accounts.csv`] — every account ordered by number: Number, Name, Type, Balance, Active, System.
- **Money cells** — written as numbers to the cent (`-20.00`, `1234.50`; v2.18.0), never formula-guarded.
- **Page (`#/csv`, sidebar → Interop → CSV Import/Export)** — one link per export (labels follow the company's terminology, e.g. nonprofit words); no date controls on the page.

_Key files: `app/services/csv_export.py`, `app/routes/csv.py`, `app/static/js/app.js`_

### CSV import — customers, vendors, items

- **Endpoints** — `POST /api/csv/import/customers`, `/vendors`, `/items` (multipart `file`, ≤ 20 MB; UTF-8 with or without BOM, else Windows-1252, else 400 "Re-export it as a UTF-8 / standard CSV"). Result `{created, skipped, errors[]}` with errors as `Row N: …` (header = row 1); one commit.
- **Columns read** — the export's own headers, so an exported file re-imports:
  - Customers: Name (required), Company, Email, Phone, Address → billing line 1, City, State, ZIP, Terms. Vendors: the same, into the vendor's address fields. ID and Balance are ignored.
  - Items: Name (required), Type (`product`, `service`, `material`, `labor`; anything else → service), Description, Rate, Cost (blank → 0; `$` and thousands separators allowed; non-numbers are row errors). ID and Taxable are ignored.
- **Validation like the forms** — each customer/vendor row passes the create schema: a malformed email ("… is not an email address"), a field over its column length, or Terms other than Net 15, Net 30, Net 45, Net 60, Due on Receipt (any case) fail that row only. Blank Terms → the company's default terms for customers (if one the form offers, else Net 30) and Net 30 for vendors.
- **Duplicates** — customers and vendors by exact name; items by exact name or by a trimmed, space-collapsed, case-folded key against active items and earlier rows of the same file.
- **Page** — entity picker (Customers, Vendors, Items, Chart of Accounts) and file input; shows "Imported N …, updated N, N already there" and row errors.

_Key files: `app/services/csv_import.py`, `app/routes/csv.py`, `app/schemas/contacts.py`, `app/routes/items.py`, `app/static/js/app.js`_

### Spreadsheet safety and encodings (cross-cutting)

- **Formula-injection guard** — `_csv_safe` prefixes an apostrophe to any text cell starting with `=`, `+`, `-`, `@`, TAB or CR; `_SafeWriter` applies it to every string cell (numbers, dates and Decimals pass untouched so negative amounts stay numbers). The IIF export applies the same guard to names and free text.
- **Guard removal on import** — `strip_formula_guard` takes off an apostrophe only when it precedes one of those characters, in the CSV, chart, report-CSV, migration and IIF importers (`UnguardedDictReader`), so re-importing an exported file never creates `'=HYPERLINK(...)` twins (v2.17.3 W-M15).
- **Excel-friendly CSV** — the CSV exports here, the ledger reports, Schedule C, analytics and nonprofit report CSVs pass through one helper that prepends a UTF-8 byte-order mark (so Excel on Windows doesn't show `BÃ¤ckerei`), and serves `Content-Disposition: inline` to the desktop shell (`X-Slowbooks-Desktop` header) and `attachment` to browsers; the desktop shim saves such files to Documents/SlowBooks Pro/Reports.
- **Upload cap** — IIF, CSV, chart, report-CSV and migration uploads are limited to 20 MB per file (413).

_Key files: `app/services/csv_export.py`, `app/services/csv_import.py`, `app/routes/csv.py`, `app/services/upload_limits.py`, `app/static/js/desktop_shim.js`, `app/main.py`_

### Ledger report CSV exports (#179)

- **Shape** — a four-line preamble (`Company`, `Report`, `Period`, blank) so a reader can skip it by count (`rows_of()` does, for future group reporting #180); amounts as plain two-decimal numbers without currency signs or thousands separators; same columns as the screen.
- **Trial balance** — Account number, Account name, Type, Debit, Credit, Net (debit − credit) per account with activity, then a Total row (debits equal credits).
- **General ledger** — Date, Reference, Description, Account number, Account name, Debit, Credit, Running balance, Source type; per account a "Balance brought forward" row (source `opening`), one row per posted line, and a "Period total" row (source `total`) whose net ties to the trial balance; optional `account_id` filter.
- **Profit & Loss** — Section, Account number, Account name, Amount for Income, Cost of Goods Sold and Expenses, a Total row per section, Gross Profit, Net Income (labels follow the company's terminology).
- **Balance sheet** — Section, Account number, Account name, Amount for Assets, Liabilities and Equity with totals and "Liabilities + Equity".
- **Where** — "Save CSV" beside "Save PDF" on each of the four reports; routes live in the reports router: `GET /api/reports/{trial-balance|general-ledger|profit-loss}/csv?start_date&end_date` and `/api/reports/balance-sheet/csv?as_of_date`; file names such as `trial-balance_<start>_<end>.csv`.

_Key files: `app/services/ledger_exports.py`, `app/routes/reports/financial.py`, `app/static/js/reports.js`_

### Legacy shared uploads folder (pre-2.18 files)

- **Background** — before 2.18.0 every company on an install wrote logos, attachments and employee documents into one shared folder; database revision `c5e1f7a9b3d2` copies each company's referenced files into its own database (`stored_files`) the first time that company is opened on 2.18 (read-only on the folder; missing files recorded as missing; copies flagged as coming from the shared folder).
- **Status** — `GET /api/uploads/legacy` (admin) → `{files, bytes, pending_companies, can_remove}`; nothing is pending when the folder is empty.
- **Which companies still need it** — desktop/SQLite: every company in the company picker's manifest, opened read-only (an idle WAL file read as immutable so no `-wal`/`-shm` sidecars appear), plus the open books; PostgreSQL: the connected database and every database the companies table lists on the same server (10 s connect timeout). A company needs the folder while its migration revision is before the copy step (unknown revision → decided by whether `stored_files` exists); an unreadable or busy (> 2 s) company file counts as still needing it; books with no attachments/settings tables have nothing to copy.
- **Remove** — `DELETE /api/uploads/legacy` (admin) deletes only regular files inside the folder and the sub-folders they leave empty, never the folder itself (it may be a Docker volume mount), never through a symlink or Windows junction, never on another device, at most 32 levels deep (descriptor-relative walk with `O_NOFOLLOW` on Linux/macOS); 409 with a sentence naming the companies that still have to be opened; an audit event (`shared_uploads`, DELETE, counts) is recorded.
- **UI** — Settings (admins only) shows "Files from earlier versions" only when the folder still holds files, with the count and size, the pending companies, and **Remove them** (disabled while any are pending) behind a confirmation warning that a pre-2.18 backup restored later would come back without its files.

_Key files: `app/services/legacy_uploads.py`, `app/routes/uploads.py`, `app/static/js/settings.js`, `migrations/versions/c5e1f7a9b3d2_company_files_in_the_company_database.py`_

### API endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/api/iif/export/all` | Whole company as one IIF file (lists, then estimates, invoices, sales receipts, payments, bills, deposits) |
| GET | `/api/iif/export/accounts` | `!ACCNT` list of active accounts |
| GET | `/api/iif/export/classes` | `!CLASS` list (archived → `HIDDEN=Y`) |
| GET | `/api/iif/export/customers` | `!CUST` list plus `Customer:Job` rows |
| GET | `/api/iif/export/vendors` | `!VEND` list |
| GET | `/api/iif/export/items` | `!INVITEM` list |
| GET | `/api/iif/export/estimates` | `ESTIMATE` blocks (no date range) |
| GET | `/api/iif/export/invoices` | `INVOICE` blocks; `date_from`, `date_to` (400 on bad date) |
| GET | `/api/iif/export/payments` | `PAYMENT` blocks; `date_from`, `date_to` (400 on bad date) |
| GET | `/api/iif/export/sales-receipts` | `CASH SALE` blocks; `date_from`, `date_to` |
| GET | `/api/iif/export/bills` | `BILL` blocks; `date_from`, `date_to` |
| GET | `/api/iif/export/deposits` | `DEPOSIT` blocks; `date_from`, `date_to` |
| POST | `/api/iif/validate` | Pre-flight check of an uploaded `.iif`; reports sections, counts, errors, warnings, ALL-CAPS names |
| POST | `/api/iif/import` | Import an uploaded `.iif`; form field `retitle_names` (default false) |
| GET | `/api/qbo/auth-url` | Intuit authorization URL with a stored CSRF state (admin) |
| POST | `/api/qbo/connect-manual` | Redeem a pasted authorization code + realm ID (admin) |
| GET | `/api/qbo/callback` | OAuth redirect target (session-exempt; state-checked); stores tokens, redirects to `/#/qbo` |
| POST | `/api/qbo/disconnect` | Clear stored tokens and realm (admin) |
| GET | `/api/qbo/status` | `{connected, company_name, realm_id}`; `include_company_name` (default true) |
| POST | `/api/qbo/import-runs` | Start a background import of all or selected entities (admin; 202; 409 if one is running) |
| GET | `/api/qbo/import-runs/latest` | Latest run, events after `after`, `has_more`, `server_time` |
| POST | `/api/qbo/import` | Synchronous import of all nine entity types (admin) |
| POST | `/api/qbo/import/{entity}` | Synchronous import of one type: accounts, customers, vendors, items, invoices, payments, sales_receipts, journal_entries, ledger (admin) |
| POST | `/api/qbo/export` | Export accounts, customers, vendors, items, invoices + sales receipts, payments (creates, updates, voids) |
| POST | `/api/qbo/export/{entity}` | Export one type: accounts, customers, vendors, items, invoices, payments |
| GET | `/api/migration/sources` | Migration sources `[{key, label}]` |
| POST | `/api/migration/{source}/dry-run` | Validate an uploaded bundle for xero/myob/sage/wave/zoho/gnucash; writes nothing (admin) |
| POST | `/api/migration/{source}/import` | Dry-run-gated import of accounts, opening balances and journals (admin) |
| GET | `/api/csv/export/customers` | Customers CSV |
| GET | `/api/csv/export/vendors` | Vendors CSV |
| GET | `/api/csv/export/items` | Items CSV |
| GET | `/api/csv/export/invoices` | Invoices CSV; `date_from`, `date_to` |
| GET | `/api/csv/export/bills` | Bills CSV, one row per line |
| GET | `/api/csv/export/deposits` | Deposits CSV, one row per source line |
| GET | `/api/csv/export/sales-receipts` | Sales receipts CSV, one row per line |
| GET | `/api/csv/export/classes` | Classes CSV |
| GET | `/api/csv/export/jobs` | Jobs CSV |
| GET | `/api/csv/export/accounts` | Chart of accounts CSV |
| POST | `/api/csv/import/customers` | Import customers CSV |
| POST | `/api/csv/import/vendors` | Import vendors CSV |
| POST | `/api/csv/import/items` | Import items CSV |
| POST | `/api/csv/import/accounts` | Chart import (CSV/spreadsheet/hledger); `dry_run` (default true), `replace` |
| POST | `/api/csv/import/qb-report` | QuickBooks Desktop report CSV (Transaction Detail sales receipts, Deposit Detail, Check Detail), auto-detected |
| GET | `/api/reports/trial-balance/csv` | Trial balance CSV (reports router; `start_date`, `end_date`) |
| GET | `/api/reports/general-ledger/csv` | General ledger CSV (reports router; `start_date`, `end_date`, `account_id`) |
| GET | `/api/reports/profit-loss/csv` | Profit & Loss CSV (reports router; `start_date`, `end_date`) |
| GET | `/api/reports/balance-sheet/csv` | Balance sheet CSV (reports router; `as_of_date`) |
| GET | `/api/uploads/legacy` | What the pre-2.18 shared uploads folder holds and who still needs it (admin; uploads router) |
| DELETE | `/api/uploads/legacy` | Remove the shared folder's files once no company needs them (admin; 409 otherwise) |

Role notes: read-only users can use the export, status and import-log GETs but no POST (`/api/qbo/auth-url` and `/api/uploads/legacy` are administrator-only even though they are GETs); bookkeepers can also import IIF/CSV/report files and export to QBO, but not connect, disconnect, import from QBO or run Migrate Data (administrator-only). Scoped API tokens (`Authorization: Bearer sbp_…`) carry the same roles.

### Notes, gaps & discrepancies

- **IIF `CLASS` round-trips only on bills and deposits** — the export writes `CLASS` on every block and the v2.8.0 changelog says "a tag never falls off", but the importer reads `CLASS` only for `BILL` and `DEPOSIT`; invoices, payments, estimates and cash sales re-import untagged.
- **QuickBooks-native customer addresses are not read** — real QuickBooks `!CUST` exports use `BADDR1–5`/`SADDR1–5` (as in the Mac fixture), while the importer reads `ADDR2`–`ADDR4` (the layout SlowBooks' own export writes); no code references `BADDR`/`SADDR`, so those addresses (and `FAXNUM`, vendor `COMPANYNAME`) don't come across.
- **`CCARD` accounts import as Expense** — QuickBooks' credit-card account type is missing from the IIF type map (Validate warns "will default to Expense"); the export never writes `CCARD` (a 21xx card account goes out as `OCLIAB`). `docs/features.md` speaks of "QB's 14 types"; the map has 15 keys and its export table omits `OASSET` and the below-1000 → `OCASSET` case.
- **Opening balances are not deduplicated** — every import of an `!ACCNT` list with non-zero `OBAMOUNT` posts another "Opening balances (IIF import)" entry (no check for an earlier `IIF-OPENING` entry), even though the accounts themselves are skipped as duplicates; the entry is dated the import day, not a file date.
- **Unnumbered IIF invoices/estimates** — only `CASH SALE` blocks get a generated number; an `INVOICE` or `ESTIMATE` without `DOCNUM` fails the non-null document-number column and is reported as a database-constraint error (the same applies to a QBO invoice without `DocNumber`).
- **Silent skips** — unsupported `TRNSTYPE`s (`GENERAL JOURNAL`, `CHECK`, `TRANSFER`, …) are neither counted nor warned, and Validate passes files made only of them; unrecognised list sections are skipped by design.
- **UTF-8 BOM in an IIF file** — the route decodes with `utf-8` (not `utf-8-sig`) and the parser doesn't strip U+FEFF, so a BOM-prefixed file's first header row would not be recognised (code reading; no test covers it).
- **`opening_balance_lines`** is computed by the IIF service but dropped by the `IIFImportResult` response model.
- **Voided deposits still export** — the IIF and CSV deposit exports select `source_type = 'deposit'` with no void check, so a voided deposit goes out without its `deposit_void` reversal; the IIF deposit block also writes only the first debit line as its `TRNS`.
- **IIF literal account names** — invoice, estimate and cash-sale blocks write the literal names `Accounts Receivable`, `Sales Tax Payable` and fallback `Service Income`, while bill blocks resolve accounts 2000/2200 from the chart; estimates are exported at document amounts (not home-currency converted) and regardless of status.
- **`tools/clean_iif.py` docstring vs code** — the docstring promises `"ACME, Inc."` → `ACME, Inc.`, but the code (and its test) keeps a quoted field quoted; only case changes. It also doesn't rewrite `ACCNT` references (harmless: import matching is case-insensitive).
- **Underscores dropped by `normalize_name`** — the word tokenizer has no alternative for `_`, so `JOHN_SMITH LLC` becomes `JohnSmith LLC` (verified by calling the function).
- **QBO boolean fields read through `_safe(obj, attr, default)`** (`value or default`): a customer's `Taxable=false` imports as taxable, and `Active=false` on customers, vendors and items imports as active (accounts use a correct check). Invoice terms, customer memo, payment method and customer web address are read only when the SDK returns them as plain dicts (else Net 30 / none).
- **Possible double count of QBO payments** — the invoice import sets paid = `TotalAmt − Balance` and the payment import then adds each linked payment to the same invoice again (code reading; test fixtures use `Balance = TotalAmt`).
- **`qbo_enabled` is never enforced** — the "Enable QBO Integration" setting (and `docs/setup-qbo.md` step 4) has no effect on any route or page. The settings form's fallback redirect-URI placeholder uses port 8000, while the stored default and the docs use 3001.
- **Disconnect doesn't revoke** — `POST /api/qbo/disconnect` only blanks local tokens; no revoke call is made to Intuit.
- **Export needs no admin** — QBO export endpoints have no `require_admin`, unlike import, connect and disconnect.
- **Unexposed options** — `import_ledger` supports `start`, `end` and `dry_run`, but the API always imports 1900-01-01 → today for real; `start_run(import_all=…)` is accepted and unused.
- **What QBO sync doesn't cover** — the import creates documents only for invoices, sales receipts and payments (bills, expenses, deposits, transfers, credit memos and estimates arrive only as Posted Ledger Activity journals); only accounts get the extra query for inactive records (the code notes QBO's default query omits them), so inactive customers, vendors and items are not requested; the export sends no jobs, bills, estimates, credit memos, journals or deposits, and items go without inventory quantities or asset accounts; a QBO `AcctNum` already used by a differently named local account fails that account's insert.
- **Stale comments and copy** — `app/routes/migration.py` says `/api/xero-import` and `/api/myob-import` "remain as compatibility aliases", but only the SPA routes `#/xero-import`/`#/myob-import` exist; `qbo.js` says sales receipts have "no matching export entity" (they export with invoices as QBO SalesReceipts), and the export panel still says "Already-exported records are skipped" although changed records are updated and voids sent; `app/models/qbo_mapping.py` lists 6 entity types (11 are used); `docs/development.md` calls `csv_export.py` "5 entity types" (10); `app/routes/csv.py` mentions a combined "Import/Export Center", but IIF and CSV are separate pages.
- **Docs lag the code** — `docs/features.md`'s IIF export table lists 7 sections (the code writes 11, including classes, sales receipts, bills, deposits and `Customer:Job` rows) and says date ranges cover invoices and payments (also sales receipts, bills, deposits); `docs/migrate-from-quickbooks.md` lists seven QBO steps (nine, with Journal Entries and Posted Ledger Activity) and names the page section "Sales Receipts from Report CSV" (it is "Import from Report CSV"); `docs/setup-qbo.md`'s endpoint table omits the two `import-runs` routes it describes in the text.
- **Migration filename classification differs by source** — Xero and MYOB keep their own table without `transaction`/`acct` and check `account` before the ledger words, so Xero's "Account Transactions" report is filed as a chart there (the "Account Transactions" fix applies to Sage/Wave/Zoho/GnuCash); the 400 message lists `transactions` as a ledger name for every source.
- **Migration limitations** — accounts are created flat (no parents; GnuCash keeps the full path as the name); only chart, journals and an opening-balance entry come in (no customers, vendors, items or documents); an account type missing from a dialect's map (e.g. GnuCash `TRADING`) is a dry-run error; the GnuCash chart skips hidden accounts, so a ledger line on one fails the dry run unless the account already exists.
- **CSV gaps** — the bills, deposits and sales-receipts CSV routes take no date range (the service functions accept one); `invoices.csv` mixes in sales receipts and void invoices; the items import ignores `Taxable`; customer/vendor duplicates are case-sensitive (unlike IIF); the CSV page's "Chart of Accounts" import applies without the preview the Chart of Accounts dialog shows; a chart file with some bad rows still applies its good rows.
- **Other CSV surfaces covered in other sections** — bank statement CSV/OFX/QFX import (`/api/bank-import/*`), fixed-asset CSV import (`/api/fixed-assets/import-csv`), and the Schedule C, analytics and nonprofit report CSVs; those report CSVs are served through the same BOM/disposition helper (`app/routes/csv.py::_csv_response`).

---

_[← 6. Nonprofit Mode, Jobs & Job Costing](06-nonprofit-jobs-job-costing.md) · [Index](README.md) · [8. Platform, Security & Administration →](08-platform-security-administration.md)_
