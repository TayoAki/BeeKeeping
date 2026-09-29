_SlowBooks Pro 2026 feature inventory — [← 2. Purchasing, Accounts Payable, Items & Inventory](02-purchasing-payables-inventory.md) · [Index](README.md) · [4. Payroll & HR →](04-payroll-hr.md)_

## 3. General Ledger, Chart of Accounts & Banking

SlowBooks keeps exactly one general ledger: every financial event becomes a balanced `Transaction` header with debit-only or credit-only `TransactionLine`s, written through a single posting service (`create_journal_entry`) that enforces balance, the closing date and the reporting dimensions (class, job, cost code, nonprofit function). Nothing posted is ever edited or deleted: voids post mirror-image reversing entries dated the original day, and "voided" is derived from the ledger. Since v2.10 (issue #114) banking is not a side ledger either: a bank or credit-card account is a chart account flagged with `bank_kind`, its register is the ledger's lines on that account, statement lines from SimpleFIN, OFX/QFX or CSV wait in a review queue until they are matched, added or excluded, and reconciliation ticks ledger lines. Around that core the domain provides a 56-account seeded Contractor chart with 15 number-resolved control accounts, manual journal entries, a password-overridable closing date, an opening-balance wizard, class tracking, monthly budgets, document-level multi-currency with realized FX, and a fixed-asset register with depreciation and disposal.

### Double-entry engine (journal entries and lines)

- **Journal header (`transactions`)** — `date` (indexed), `reference` (100 chars), `description` (memo text), `source_type` (50) plus `source_id` (the originating record), header `class_id` and `job_id`, `created_at`.
  - No status, void flag or `updated_at` column: a posting is immutable once written.
- **Journal lines (`transaction_lines`)** — `account_id` (FK, `ON DELETE RESTRICT`), `debit` and `credit` Numeric(15,2), `description` (300, the split memo), per-line `job_id`, `class_id`, `cost_code_id`, `cost_type`, nonprofit `function`, `is_billable` + `billed_invoice_line_id`.
  - Banking fields: `cleared` (matched to a statement line or ticked in a reconciliation) and `reconciliation_id` (the completed reconciliation that closed it).
  - `deposit_transaction_id` (indexed): on a payment's Undeposited Funds line, the deposit that took it to the bank.
  - Lines cascade-delete with their header.
- **Database guard** — CHECK constraint `ck_debit_or_credit`: a line is debit-only (> 0) or credit-only (> 0); never both, never zero. The model comment calls it a guard against "a real class of corruption bugs. Do not remove."
- **`create_journal_entry()` — the single posting path** — every route, importer, recurring job, inventory hook and void goes through it.
  - Closing-date enforcement runs first, so every path inherits it; a `bypass_closing_date` escape hatch exists but has no caller in the app.
  - Per-line validation: a negative amount raises "Line N: debit and credit must be non-negative"; both sides raises "Line N: a line cannot have both debit and credit".
  - Balance check is exact Decimal equality of total debits and total credits (no tolerance); failure raises "Debits and credits must be equal: this entry is out of balance by $X.XX" (a `DataProblem`, i.e. a ValueError with user-safe text).
  - Lines with zero on both sides are silently skipped (not inserted).
  - Dimension inheritance: a line without `job_id` / `class_id` takes the header's; `function` is taken as sent when the key is present (even `null`), otherwise defaulted from the line's class `default_function`; `cost_type` is derived from the cost code when not sent.
  - `existing_transaction=` lets an invoice edit keep its header id; refused ("Replacement journal must have its old splits removed") while old lines remain.
  - Updates the stored `accounts.balance` of each account: asset / expense / COGS `+= debit − credit`; liability / equity / income `+= credit − debit`.
- **Money rounding helpers** — `_q` / `quantize_cents` round half-up to cents ("matches PostgreSQL default"); `quantize_to` for other precisions (4-decimal unit costs); `compute_line_totals` rounds each line before summing subtotal, tax and total so stored totals equal the journal; `taxable_subtotal` honours per-line `is_taxable`.
  - `create_journal_entry` itself does not quantize; callers round before posting.
- **Source-document links** — the register and report drill-downs turn `source_type`/`source_id` into SPA links: `invoice` → `#/invoices/{id}`, `bill` → `#/bills/{id}`, `payment` → `#/payments/{id}`, `bill_payment` → `#/bill-payments/{id}`, `vendor_credit` → `#/vendor-credits/{id}`, `expense` → `#/expenses/{txn}`, `deposit` → `#/deposits/{txn}`, `cc_charge` → `#/cc-charges/{txn}`, `transfer` → `#/banking/transfers/{txn}`, and `manual` / `bank_entry` / `opening_balance` / `qbo_ledger` / `qbo_journal` → `#/journal/{txn}`.
  - Any other source type (depreciation, disposals, voids, payroll, sales-tax payments…) falls back to `#/journal/{transaction id}` in the UI, so every register line opens something.
  - Source types posted in this domain: `manual`, `bank_entry`, `transfer`, `deposit`, `cc_charge`, `opening_balance`, `depreciation`, `asset_acquisition`, `asset_disposal`, and the `<type>_void` reversals; QuickBooks Online imports add `qbo_journal` and `qbo_ledger`.
- **A missing control account is a refusal, never a silent skip** — the resolvers raise `MissingControlAccount`, rendered globally as HTTP 409: "The account this posting needs is missing from the chart of accounts: NNNN Name. It is used for … Restore it with that exact number (Chart of Accounts → New Account), then try again. Nothing was posted."
- **Two kinds of balance** — the stored running `accounts.balance` (shown on the Chart of Accounts page and in some pickers) and ledger-derived natural-signed balances (`gl_balances`, `balance_as_of`) used by the Banking overview, registers, reconciliation, the dashboard bank widget and reports.
  - The QuickBooks Online import rebases stored balances from the posted lines.

_Key files: `app/services/accounting.py`, `app/models/transactions.py`, `app/services/bank_register.py`, `app/services/control_accounts.py`, `app/main.py`_

### Voids and reversing entries

- **House void convention** — the original posting stays; `reversing_lines()` builds its mirror image: debit and credit swapped, every line description prefixed `VOID: `, and every dimension (job, class, cost code, cost type, function) carried over so by-class, by-job and functional-expense reports net to zero for the voided document.
  - The reversal is dated the ORIGINAL posting's date, so it lands in the same period and is subject to that period's closing date.
  - It carries `source_type = <original type>_void` and `source_id` = the original transaction id; header text "VOID …".
- **`void_document()`** (register entries, transfers, deposits, card charges) — refuses when any line carries a `reconciliation_id` (400 "This entry is in a completed reconciliation and cannot be voided"), checks the closing date on the original date, posts the reversal, then releases statement links.
- **Statement links released on void** — every bank statement line linked to one of the voided posting's lines goes back to `unmatched` (link cleared) and the original lines are un-cleared. Payment, bill-payment, expense, journal and QuickBooks-import voids do the same.
- **Voided-ness is derived** — `voided_transaction_ids()` treats a transaction as void when any `%_void` posting points at it; reversal postings themselves show as void (struck through) in the register.
- **Double-void guards** — each void endpoint refuses a second void ("… is already void"); the journal void also refuses voiding a reversal ("Cannot void a reversal entry").

_Key files: `app/services/accounting.py`, `app/services/bank_posting.py`, `app/services/bank_register.py`, `app/services/qbo_documents.py`_

### Chart of Accounts — model, types and numbering

- **Account fields** — `name` (200, not unique), `account_number` (20, UNIQUE, nullable), `account_type`, `parent_id` (self-referencing sub-account), `description` (500), `is_active` (default true), `is_system` (set on every seeded or code-created account), stored `balance` Numeric(15,2), `bank_kind`, timestamps.
- **Six account types** (`AccountType`) — `asset`, `liability`, `equity`, `income`, `expense`, `cogs`. Debit-normal: asset, expense, COGS; credit-normal: liability, equity, income.
- **`bank_kind`** — `"bank"`, `"credit_card"` or NULL. A bank must be an `asset` and a card a `liability` (400 "bank_kind 'bank' needs account_type 'asset', not …").
  - It drives the register, the review queue, reconciliation, transfers and every "paid from" / "deposit to" / "pay from" picker (`GET /api/accounts?bank=1`), and the cash-flow statement treats `bank` accounts as cash.
- **Number format** (for numbers typed on the form or sent to the API) — digits, optionally in dotted or dashed groups for a sub-account (`6150`, `6150.1`, `6150-01`), regex `^\d+(?:[.-]\d+)*$`, at most 20 characters.
  - A number is required on create (400 "Give the account a number, like 6150. A sub-account can use 6150.1 or 6150-01."); letters are refused (400 "… is not an account number").
  - Importers keep whatever numbers they carry; on update the number is re-validated only when it changes, so an imported account with an odd or missing number can still be renamed.
- **Uniqueness** — a duplicate number is 409 "Account number N is already used by '<name>'. Account numbers must be unique."; any other integrity error is a 409, never a 500.
- **Numbering ranges (convention, not enforced by the API)** — seeded blocks: 1000s assets, 2000s liabilities (2300–2390 payroll), 3000s equity, 4000s income, 5000s COGS, 6000s expenses; code-created accounts sit at 3300, 3400, 3900, 4400, 4800, 6999 and 7999 (5900 is used only if the operator adds it).
  - The chart-file importer infers a type from the first digit when a row has no type: 1 asset, 2 liability, 3 equity, 4 income, 5 COGS, anything else expense.
  - IIF export maps number ranges to QuickBooks types: asset 1000–1099 → BANK, 1100 → AR, below 1500 → OCASSET, below 2000 → FIXASSET, else OASSET; liability 2000 → AP, below 2500 → OCLIAB, else LTLIAB.
- **Sub-accounts** — `parent_id` is stored and used by IIF export (`Parent:Child` colon paths), QuickBooks Online export (ParentRef) and the chart importer (hledger paths).
  - The API refuses only an account made its own parent (400 "An account cannot be its own parent."); there is no deeper cycle check, no roll-up of sub-account balances, and no parent selector on the Chart of Accounts form.
- **Derived response flags** — `is_control` and `control_purpose` (from the control registry, never stored; purpose text re-worded for nonprofit companies) and `nonprofit_only` (true for 3300 / 3400 / 4400 when matched by the seeded name, so business pickers can leave them out).

_Key files: `app/models/accounts.py`, `app/routes/accounts.py`, `app/schemas/accounts.py`, `app/services/chart_import.py`, `app/services/iif_common.py`_

### Seeded chart of accounts (Contractor template)

- **How a company gets it** — a new desktop company file (`manifest_create_company` → `alembic upgrade head` → seed, company name written in) or a Docker first run (`scripts/seed_database.py`, skipped when any account already exists) inserts the 56 accounts below with `is_system=True`, then creates the default fixed-asset type. The seed comment describes it as QuickBooks 2003 Pro's EasyStep "Contractor" industry template.
- **Assets (10)** — 1000 Checking [bank], 1010 Savings [bank], 1100 Accounts Receivable, 1200 Undeposited Funds, 1300 Inventory, 1400 Prepaid Expenses, 1500 Equipment, 1510 Accumulated Depreciation (an asset-type contra account), 1600 Vehicles, 1700 Other Assets.
- **Liabilities (15)** — 2000 Accounts Payable, 2100 Credit Card [credit_card], 2200 Sales Tax Payable, 2300 Payroll Liabilities, 2310 Federal Income Tax Payable, 2320 State Income Tax Payable, 2330 Social Security Payable, 2340 Medicare Payable, 2350 FUTA Payable, 2360 State Unemployment (SUTA) Payable, 2370 Other Payroll Deductions Payable, 2380 Employee Benefits Payable, 2390 Accrued PTO Liability, 2400 Loan Payable, 2500 Other Current Liabilities.
- **Equity (3)** — 3000 Owner's Equity, 3100 Owner's Draw, 3200 Retained Earnings.
- **Income (5)** — 4000 Service Income, 4100 Product Sales, 4200 Material Income, 4300 Labor Income, 4900 Other Income.
- **Cost of Goods Sold (4)** — 5000 Cost of Goods Sold, 5100 Materials Cost, 5200 Labor Cost, 5300 Subcontractor Costs.
- **Expenses (19)** — 6000 Advertising & Marketing, 6100 Auto & Truck Expense, 6110 Wages & Salaries, 6120 Payroll Tax Expense, 6130 Workers Compensation Insurance, 6140 Employee Expense Reimbursements, 6150 Employee Benefits Expense, 6160 Paid Time Off Expense, 6200 Bank Charges & Fees, 6300 Insurance, 6400 Office Supplies, 6500 Rent or Lease, 6600 Repairs & Maintenance, 6700 Telephone & Internet, 6800 Tools & Equipment, 6810 Depreciation Expense, 6900 Utilities, 6950 Miscellaneous Expense, 6960 Bad Debt Expense.
- **Bank flags** — only 1000 and 1010 (bank) and 2100 (credit card) come flagged.
- **Deliberately not seeded** — 3900 Opening Balance Equity, the nonprofit net-asset accounts and 4400 In-Kind Contributions, 4800 Late Fee Income, 6999 Exchange Gain/Loss and 7999 Gain/Loss on Asset Disposal are all created on demand (next sections). 5900 Inventory Adjustments is not seeded either, and nothing creates it — see the note on 5900 below.

_Key files: `app/seed/chart_of_accounts.py`, `scripts/seed_database.py`, `app/services/company_service.py`, `app/seed/fixed_assets.py`_

### Control accounts (15) and the rename-only rule

- **Registry** — `CONTROL_ACCOUNTS` is the single authority for the numbers the posting code resolves literally (issue #119); the route guard, the resolvers' error text and the boot check all read it. Number, seeded name and purpose:
  - 1000 Checking — the default bank account for deposits and payments.
  - 1100 Accounts Receivable — every invoice and payment.
  - 1200 Undeposited Funds — payments received but not yet deposited.
  - 1300 Inventory — the inventory asset behind item purchases and sales.
  - 2000 Accounts Payable — every bill and bill payment.
  - 2100 Credit Card — card charges and the card's balance.
  - 2200 Sales Tax Payable — sales tax collected on invoices and receipts.
  - 3200 Retained Earnings — the balancing account for imported opening balances.
  - 4000 Service Income — the default income account for invoice lines.
  - 4800 Late Fee Income — finance charges on overdue invoices (created on demand).
  - 5000 Cost of Goods Sold — the cost side of an inventory item's sale.
  - 5900 Inventory Adjustments — write-offs and quantity corrections. Used when the operator has added it; nothing creates it, so a standard chart posts inventory adjustments to the first COGS account (5000). The comment in `control_accounts.py` calling it "created on demand" is wrong.
  - 6000 Advertising & Marketing — payroll expense fallback when 6110 or 6120 is missing from an older chart.
  - 6120 Payroll Tax Expense — employer taxes posted by job costing.
  - 6150 Employee Benefits Expense — benefit costs posted by job costing.
  - 13 of the 15 are seeded; 4800 is created by the late-fee code the first time it is needed, and 5900 exists only if added by hand. Both are protected once they exist.
- **Rename-only** — `PUT /api/accounts/{id}` on a control account refuses a changed `account_number` or `account_type` (400 "NNNN Name is a control account — the software finds it by its number to post … Changing its number would stop new documents reaching the ledger. You can rename it.").
  - Name, description, `is_active` and `bank_kind` may still change; ordinary seeded accounts can be renumbered freely (the guard reads the registry, not `is_system`).
- **Never deletable** — `DELETE` on a control account is a 400 "… cannot be deleted. You can rename it, or deactivate it to hide it from new entries."
- **Boot check** — at startup the seeded control accounts missing from the chart are logged once as a warning ("… documents that need them will be refused (409) until they are restored with these exact numbers"); it never blocks startup.
- **`resolve()` vs `find()`** — posting paths call `resolve` (raises on a miss); reports and exports that only need a display name call `find` (returns None).
- **UI** — the Chart of Accounts shows a `control` badge whose tooltip is the purpose; the edit form disables number and type with a note ("You can rename it."); control rows have no Delete button.

_Key files: `app/services/control_accounts.py`, `app/routes/accounts.py`, `app/schemas/accounts.py`, `app/static/js/app.js`, `app/main.py`_

### System accounts created on demand

- **`ensure_account(number, name, type)`** — finds the account by NAME; if missing, creates it with `is_system=True`, keeping the suggested number only when no other account already uses it (otherwise it gets no number).
  - 3900 Opening Balance Equity (equity) — offset for bank/card opening balances and fixed-asset opening balances.
  - Nonprofit set (Settings → Company Type, or the first document that needs one): 3300 Net Assets Without Donor Restrictions, 3400 Net Assets With Donor Restrictions (equity), 4400 In-Kind Contributions (income), 6960 Bad Debt Expense.
  - 6810 Depreciation Expense — ensured by the default fixed-asset-type seeder.
- **Number-first lookups** — 6999 Exchange Gain/Loss and 7999 Gain/Loss on Asset Disposal are found by NUMBER first (whatever that account is called), then by name, else created — both as EXPENSE-type accounts.
- **Migration-created bank accounts** — the v2.10 migration created a bank-kind asset account for each pre-2.10 feed that had no linked ledger account (named after the feed, next free 10x0 number in 1000–1090, not marked system).

_Key files: `app/services/accounting.py`, `app/services/currency.py`, `app/services/fixed_assets.py`, `migrations/versions/e7f8a9b0c1d2_banking_on_the_ledger.py`_

### Chart of Accounts page and account lifecycle

- **Page `#/accounts`** (sidebar Accounting → Chart of Accounts) — grouped Assets, Liabilities, Equity (Net Assets for a nonprofit), Income, Cost of Goods Sold, Expenses; columns Number, Name (with `control` and `inactive` badges), Type, Balance (the stored balance), Actions.
  - Row actions: Edit, Deactivate / Reactivate, Delete (hidden for control accounts). Header: "Show/Hide N inactive", "Import…", "New Account".
- **New / Edit Account form** — Account Number (required, pattern-checked in the browser, max 20), Name, Type, Description. There is no `bank_kind` field and no parent selector.
- **Create** (`POST /api/accounts`) — `name`, `account_number`, `account_type`, optional `parent_id`, `description`, `bank_kind`; bank-kind/type check, number rules, duplicate 409. New accounts are active.
- **Deactivate** — `PUT {is_active:false}` hides an account from new entries (pickers that request `active_only`) while keeping its history; allowed on control accounts; Reactivate reverses it.
- **Delete rules** (in order) — control account: 400; any posted journal line: 409 "'X' has N posted transaction line(s) and cannot be deleted. Deactivate it instead…"; any other row still pointing at it: 409 naming each table and count ("'X' is still in use: 2 in items, 1 in budgets…").
  - The reference scan walks every foreign key to `accounts.id` in the schema metadata, so it cannot fall behind the model; a remaining integrity error is still a 409.
  - Seeded, non-control accounts with no history can be deleted (issue #139).
- **Chart import** ("Import…", served by `POST /api/csv/import/accounts?dry_run=&replace=` in the CSV router) — a CSV with Number, Name, Type (optional Parent, Description, Active) or hledger account lists; dry-run plan (create / update / skip / deactivate / keep / error) then apply.
  - Control accounts the file names are renamed to the file's names, never duplicated or renumbered; the optional "Replace the seeded chart" deactivates unused, unnamed, non-control accounts.
  - Sets `bank_kind` from type words (Bank / Cash → bank, Credit Card → credit_card) or hledger path segments (checking, savings, petty cash, visa, mastercard, amex, discover…).

_Key files: `app/static/js/app.js`, `app/routes/accounts.py`, `app/services/chart_import.py`, `app/routes/csv.py`_

### Manual journal entries

- **Page `#/journal`** (sidebar Accounting → Journal Entries) — columns ID, Date, Description, Reference, Debit, Credit, Actions: View, a red "Voided" badge, and Void (only on `manual`, `qbo_journal` and `qbo_ledger` entries not yet voided).
  - `#/journal/{id}` opens any posting's view (date, description, reference, type, lines, totals); register links, transfers (`#/banking/transfers/{id}`) and card charges (`#/cc-charges/{id}`) open through it.
- **New Journal Entry modal** — Date*, Reference, Class, Job, Description*; lines with Account, Description, a Cost Code column (only when the company has cost codes), nonprofit Fund + Function + Split (nonprofit mode), Debit, Credit and a remove button; "+ Add Line"; live "Debits: $X | Credits: $Y" and "BALANCED" or "Out of balance by $X"; "Create Entry".
  - The page requires at least two lines with an account and a non-zero amount; it does not block an out-of-balance or two-sided line (the server refuses those).
  - The account picker lists every account, inactive ones included.
  - Nonprofit Split expands one line into an allocation rule's shares (same account and side, fund and function per share) via `/api/nonprofit/allocation-rules/{id}/split`.
  - Ctrl+S submits the open modal form (global shortcut).
- **Create** (`POST /api/journal`) — body `{date, description, reference, class_id, job_id, lines[{account_id, debit, credit, description, job_id, class_id, cost_code_id, function, is_billable}]}`.
  - Closing-date check first; zero/zero lines dropped; unknown account 404; nothing left 400 "No valid lines"; engine refusals (imbalance, two-sided or negative lines) are 400 with the engine's sentence.
  - Posts `source_type="manual"` and returns the entry with its lines, totals and `voided=false`.
- **List** (`GET /api/journal`) — by default `manual` and `qbo_journal` entries plus older `qbo_ledger` postings that the QuickBooks report import mapped to a QBO journal; `?source_type=` lists any other type; newest first; no pagination or date filter; reversal entries are not listed (their originals carry `voided: true`).
- **Void** (`POST /api/journal/{id}/void`) — 404 when missing; a reversal cannot be voided; a second void is 400 "This journal entry has already been voided."
  - A QuickBooks Online import posting of an invoice, sales receipt or payment voids the underlying document instead (a sales receipt's payments first), so document and posting stay together.
  - Otherwise: reconciled lines 400; closing date on the original date; reversal `manual_void` (`qbo_ledger_void` / `qbo_journal_void` for imported postings, whose import mappings are marked "changed here" so a later import leaves them alone); statement links released; returns the reversal.
- **Not supported** — editing a posted entry (no PUT; void and re-enter), memorized/recurring or auto-reversing journal entries (recurring templates are invoice-only).

_Key files: `app/routes/journal.py`, `app/schemas/journal.py`, `app/static/js/journal.js`, `app/services/qbo_documents.py`_

### Closing date and override password

- **Settings** — `closing_date` (ISO date or empty; anything else is 422 "Closing date must be a date (YYYY-MM-DD), or empty for no closing date. Nothing was saved.") and `closing_date_password` (Fernet-encrypted at rest, shown as `********`).
  - UI: Settings → Closing Date — date input with a one-click Clear, a live line saying what is saved versus typed, and "Password (optional)". `PUT /api/settings` is an admin-only write.
- **Rule** — any posting dated ON or BEFORE the closing date is refused with HTTP 403 "Transaction date … is on or before the closing date (…). Modifications to closed periods are not allowed."
  - Enforced inside `create_journal_entry` for every path, and early in route handlers for a better message (journal create/void, register entries, transfers, deposits, card charges, feed Add, a new feed's opening balance, the legacy-balance post, and every void on the original date).
- **Override flow** — with a password set, the 403 carries `X-Closing-Date-Override: password` (none sent) or `wrong-password`; the SPA's API layer then shows a "This date is in a closed period" dialog and resends the same request with `X-Closing-Date-Password` (percent-encoded UTF-8, at most 1024 characters). Cancel keeps the refusal; with no password set nothing is asked.
  - Only a signed-in person's request carries the override; API-token requests never do.
  - Constant-time comparison of UTF-8 bytes; the value is never logged or echoed.
  - Rate limit: 5 wrong passwords within 10 minutes lock the override for 10 minutes per company file (header `locked`, "try again in N minutes"); a right password clears the count. While locked, even a request with no password gets the lock message at once.
  - A stored password that no longer decrypts reads as "no password", so changes are refused (fails closed).
  - Each request that used the override writes one audit row (`closing_date`, action `OVERRIDE`, with the closing and transaction dates, source `closing_date_override`) inside the request's own transaction.
- **API-token guard** — a token cannot set the override password (403) and cannot clear the closing date or move it backward (403); moving it forward is allowed.
- **Scope** — a lock only: it posts no closing entries (there is no year-end close routine). Not affected: reconciliation ticking, imports into the review queue, bank rules, category picks and excludes.

_Key files: `app/services/closing_date.py`, `app/routes/settings.py`, `app/services/settings_service.py`, `app/static/js/api.js`, `app/static/js/settings.js`, `app/database.py`, `app/main.py`_

### Opening balances wizard

- **Page `#/opening-balances`** (sidebar Banking → Opening Balances; hidden for read-only users) — with no active balance-sheet account it says the chart isn't set up and links to Settings and Migrate Data.
  - Otherwise: As of Date*, Reference, every active Asset / Liability / Equity account with an amount box, a live "Difference", an "Auto-balance to" checkbox with an equity-account picker, and "Post Opening Balances" (then back to `#/accounts`).
- **Status** (`GET /api/opening-balances/status`) — `ready`, `chart_setup_source` and `chart_setup_ready_at` (written by the migration importers) and the active balance-sheet accounts.
- **Post** (`POST /api/opening-balances`) — `{date, description="Opening balances", reference, lines[{account_id, amount}], auto_balance_account_id}`.
  - A positive asset amount DEBITS the account; a positive liability or equity amount CREDITS it; a negative amount inverts the side; zero lines are ignored; amounts are rounded to cents.
  - Refusals (400): chart not ready; a line on an income/expense/COGS account; no non-zero lines; unbalanced without an auto-balance account ("Opening balances are unbalanced by X — correct the amounts or choose an equity account to auto-balance against"); an auto-balance account that is not equity.
  - Auto-balance posts the difference to the chosen equity account ("Opening balance equity adjustment — …").
  - One journal entry, `source_type="opening_balance"`, closing date enforced by the engine; returns `{transaction_id, lines, auto_balanced}`.
- **Limitations** — nothing stops posting the wizard twice; A/R or A/P amounts create no open invoices or bills behind them; the per-line error says "not an active balance-sheet account" but only the type is checked; 3900 Opening Balance Equity is not in the seed, so the equity picker offers 3000/3100/3200 unless 3900 already exists.

_Key files: `app/routes/opening_balances.py`, `app/static/js/opening_balances.js`_

### Class tracking

- **Model `classes`** — unique `name` (100), `is_archived`, `is_system_default`, plus fund fields used in nonprofit mode: `restriction` (`unrestricted`, `temporarily_restricted`, `permanently_restricted`), `default_function` (`program`, `management`, `fundraising`), `donor_name` (max 200), `purpose`.
- **System default "Uncategorized"** — get-or-created on the first listing (an existing user class of that name is promoted); it cannot be renamed, archived, deleted or given a restriction (400s), but may carry a default function.
- **Lifecycle rules** — create or rename with a case-insensitive duplicate: 409 "Class 'X' already exists"; blank name: 422; archive hides the class from entry-form dropdowns while history keeps it; delete is refused when any journal header uses it (400 "Class is used by posted transactions — archive it instead").
- **Where a class lives** — `class_id` on journal headers and lines and on documents (invoices and lines, bills and lines, estimates, credit memos, vendor credits, recurring invoices, in-kind gifts, nonprofit records).
  - In this domain: the journal header (and a per-line Fund in nonprofit mode), register entries, feed Add (API field), deposits and card charges.
- **Attribution** — `coalesce(line.class_id, transaction.class_id, Uncategorized)`; reversals carry the class so voids net to zero per class; a class's `default_function` fills each line's `function` at posting unless sent.
- **Reporting** — Profit & Loss by Class (`GET /api/reports/profit-loss-by-class`, reports domain): income, COGS, gross profit, expenses and net income per class, Uncategorized first; nonprofit wording "Activities by Fund".
- **UI** — Settings → Classes: add, Rename, Archive/Unarchive (no Delete button); nonprofit mode relabels Class → Fund and adds Edit (restriction, default function, donor/grantor, purpose). Entry forms preselect Uncategorized.

_Key files: `app/models/classes.py`, `app/routes/classes.py`, `app/services/classes_service.py`, `app/schemas/classes.py`, `app/static/js/settings.js`, `app/static/js/utils.js`_

### Budgets and Budget vs Actual

- **Model `budgets`** — one amount per `(account_id, year, month)` (unique constraint `uq_budget_account_year_month`), Numeric(15,2); no class, job or department dimension.
- **Entry page `#/budgets`** (sidebar Accounting → Budgets) — year navigation (« previous · year · next »), a 12-month spreadsheet grid for every income, expense and COGS account, "Save All" (bulk upsert of every non-zero cell), "View Variance".
- **API** — `GET /api/budgets?year=&account_id=`; `POST /api/budgets` upserts one cell; `POST /api/budgets/bulk` upserts a list and returns `{saved}`; `GET /api/budgets/variance?year=` (year required).
- **Variance math** — actual = Σ(debit − credit) per account per calendar month of the year, sign flipped for income, liability and equity accounts; variance = budget − actual; per-account totals.
- **Report** — Report Center card "Budget vs Actual" (and "View Variance"): one table per budgeted account with Budget, Actual and Variance rows for Jan–Dec plus Total; variance green when ≥ 0, red when negative.
- **Limitations** — Save All never sends blank or zero cells, so a saved budget cannot be cleared from the page; there is no delete endpoint; month and year are not range-checked; the colour rule is the same for income (income above budget shows red); the variance dialog shows a period selector that is ignored (it always uses the page's year).

_Key files: `app/models/budgets.py`, `app/routes/budgets.py`, `app/schemas/budgets.py`, `app/static/js/budgets.js`, `app/static/js/reports.js`_

### Multi-currency and FX

- **Design** — the general ledger is single-currency (setting `home_currency`, default `USD`); foreign-currency DOCUMENTS carry `currency` (String(3)) and `exchange_rate` (Numeric(18,8)), and every journal line they post is converted to home currency at that rate.
  - Documents with a currency: invoices and sales receipts, bills, customer payments, bill payments. Home currency only: journal entries, deposits, transfers, register entries, card charges, batch payments.
- **Rate resolution** (`resolve_rate`) — home currency: rate 1 (any sent rate ignored); foreign with a rate: must be > 0 (400); foreign without a rate: Bank of Canada lookup, else 400 "No exchange rate available for X->HOME; supply exchange_rate explicitly".
- **Conversion** (`convert_lines`) — each line is converted and rounded; any cent of debit/credit drift is put on the largest line so the entry still balances.
- **Realized FX gain/loss** — a customer payment books cash at the payment-date rate and relieves A/R at each invoice's booked rate (an unallocated remainder at the payment rate); the difference posts to 6999 Exchange Gain/Loss (credit = gain, debit = loss).
  - Mirror logic on bill payments (A/P relieved at each bill's booked rate); applying a payment's unapplied foreign remainder later posts its difference too.
  - A payment must be in the currency of every invoice or bill it pays (400 "… pay each currency with a separate payment").
- **Rate feed** (`GET /api/fx/rate?from_currency=&to_currency=`, target defaults to home) — Bank of Canada Valet API (`https://www.bankofcanada.ca/valet/observations/FX{FROM}{TO}/json?recent=1`), 5-second timeout, latest observation.
  - Tries the direct series, then a cross-rate through CAD (quantized to 8 places); `source` is `bankofcanada-direct`, `bankofcanada-cross` or `identity`; on failure `rate` is null with an `error` (never raises); no caching.
- **UI** — invoice, sales-receipt and bill forms have Currency (USD, CAD, EUR, GBP, AUD, JPY, CHF, MXN, INR, CNY) and Exchange Rate; picking a currency prefills the rate from the feed unless the operator has typed one.
  - Receive Payment offers only the currencies of the customer's open invoices and asks for "Exchange rate on the payment date", prefilled from the feed or else the latest invoice's booked rate.
- **Not supported** — unrealized FX revaluation, foreign-currency bank accounts or per-account currencies (a SimpleFIN account's currency is only displayed), and a Settings screen control for `home_currency` (API only, no ISO validation).

_Key files: `app/services/currency.py`, `app/services/fx_service.py`, `app/routes/fx.py`, `app/routes/payments.py`, `app/routes/bill_payments.py`, `app/static/js/utils.js`, `app/static/js/payments.js`_

### Fixed assets

- **Asset types** (`fixed_asset_types`) — unique name, description, three account mappings (fixed-asset account, accumulated-depreciation account, depreciation-expense account), method `straight_line` (uses `effective_life_years`) or `declining_balance` (uses `annual_rate`, e.g. 0.20 = 20% a year), `is_active`.
  - Seeded default "Equipment": 1500 Equipment / 1510 Accumulated Depreciation / 6810 Depreciation Expense, straight-line over 5 years ("General equipment, straight-line over five years"); created with a new company and lazily on the first `GET /types` for companies from before 2.9.0; skipped when the chart has no accounts named exactly "Equipment" and "Accumulated Depreciation".
  - A duplicate type name is 409; `PUT /types/{id}` edits a type (the page only creates types); types cannot be deleted.
- **Register** (`fixed_assets`) — automatic number `FA-0001`, `FA-0002`…; name, type, status `registered` or `disposed`, purchase date, purchase price, salvage value, description; `accumulated_depreciation` and `last_depreciation_date` are maintained by runs only; book value is always derived (cost − accumulated).
  - Validation: purchase price > $0.00; salvage between $0.00 and the purchase price (400).
  - Edit (`PUT`, no page control): disposed assets are read-only; once the purchase is posted, price, purchase date and type are locked (400 "… Post a correcting journal entry, or dispose of it and register it again").
- **Acquisition — "How was it paid for?"** (`acquisition` on register, or "Post purchase…" later):
  - `paid_from` — a bank or card account (400 otherwise): DR fixed-asset account / CR that account, dated the purchase date, `source_type="asset_acquisition"`, with the check/ref number.
  - `bill` / `expense` — capitalize from a bill (not void, already posted) or an expense (not void): the cost moves out of the expense/COGS accounts the document debited (largest first, net of what other assets already capitalized from it) into the asset account, dated the document's date; nothing posts when the document already debited the asset account with at least the cost; not enough uncapitalized cost is 400.
  - `opening_balance` — owned before these books began: `as_of` must be on or after the purchase date; DR asset (cost) / CR accumulated depreciation (depreciation already taken, $0 up to cost − salvage) / CR 3900 Opening Balance Equity (the rest); sets the asset's accumulated depreciation to the amount taken and, when `as_of` is after the purchase date, starts later depreciation from `as_of`.
  - `in_books` — nothing posts; allowed only when the asset account's ledger balance covers the cost of every registered asset mapped to it, this one included (400 otherwise).
  - "Post purchase…" (`POST /{id}/post-purchase`) is refused for disposed assets, assets already posted, `in_books`, and when the account already holds enough for every registered asset ("Posting this purchase would count it twice").
- **Depreciation run** (`POST /run-depreciation {run_date}`) — every registered asset; whole calendar months from the purchase date (or the last run) to the run date.
  - Straight-line monthly amount = (cost − salvage) ÷ (life × 12); declining-balance monthly amount = current book value × annual rate ÷ 12; capped so book value never drops below salvage.
  - One journal entry per asset: DR depreciation expense / CR accumulated depreciation ("Depreciation — FA-0001 Name", `source_type="depreciation"`); updates accumulated depreciation and the last-run date; returns `{posted, skipped, total}`.
  - A type missing its life, rate or account mappings is 400 and the whole run is abandoned; the closing date applies to the run date.
- **Disposal** (`POST /{id}/dispose {disposal_date, proceeds, deposit_account_id}`) — DR the proceeds account (when proceeds > 0), DR accumulated depreciation, CR the asset account at cost, and the residual to 7999 Gain/Loss on Asset Disposal (credit = gain, debit = loss); `source_type="asset_disposal"`; the asset becomes disposed with date and proceeds; returns `{transaction_id, gain_loss}`.
- **CSV import** (`POST /import-csv`) — columns `name, asset_type, purchase_date, purchase_price` (+ optional `salvage_value, description`); the type must exist by exact name; dates `YYYY-MM-DD`; per-row errors returned; posts nothing (rows then offer "Post purchase…").
- **Fixed Asset Reconciliation report** (`GET /reports/reconciliation`; Report Center card) — per asset type: count, cost, accumulated depreciation and book value of registered assets, plus totals; it shows no general-ledger figures, and its note asks the reader to compare them with the mapped accounts.
- **Page `#/fixed-assets`** (sidebar Banking → Fixed Assets) — sortable list (Asset #, Name, Type, Purchased, Status, Cost, Accum. Depr., Book Value); buttons "+ Register Asset", "+ Asset Type", "Run Depreciation", "Import CSV"; row actions "Post purchase…" (registered, not posted) and "Dispose".

_Key files: `app/models/fixed_assets.py`, `app/routes/fixed_assets.py`, `app/services/fixed_assets.py`, `app/seed/fixed_assets.py`, `app/static/js/fixed_assets.js`, `app/static/js/reports.js`_

### Bank and card accounts, feeds and the Banking page

- **Two layers** — the ledger account (`accounts.bank_kind`) IS the bank or card account; a `bank_accounts` row (a "bank feed") is only its statement identity: `name`, linked `account_id`, `bank_name`, `last_four`, `legacy_balance`, `is_active`.
  - One active feed per ledger account (409 "'X' is already the feed for this ledger account"); feeds cannot be deleted, only deactivated.
- **Sign contract** — an amount > 0 DEBITS the bank/card account (money in, or a payment to the card); < 0 CREDITS it (money out, or a card charge) — the same rule for both kinds. Statement files already carry amounts this way, so nothing is flipped on import.
- **Overview `#/banking`** (sidebar Banking → Bank Accounts; `GET /api/banking/overview`) — one card per active bank or card account: name, number and kind, ledger balance ("owed" on a card), feed identity (bank name and ****last four, or "No bank feed"), "N to review", "reconciled {date}".
  - Header buttons "Transfers…", "Transfer", "+ New Bank Account"; pre-2.10 balance banners; the Bank Feeds (SimpleFIN) card.
- **New Bank Account** — choose a bank/card ledger account that has no feed yet, or "+ Create a new chart account…" (name, number, Kind: Bank (asset) or Credit card (liability)); then feed/statement name*, bank name, last 4 digits, statement balance and As-of date.
  - The form shows what the books already hold on that date (`GET /api/banking/ledger-balance`) and prefills it.
- **Create feed** (`POST /api/banking/accounts`) — the ledger account must exist (404) and carry `bank_kind` (400 "… is not a bank or credit-card account…"); a non-zero `opening_balance` checks the closing date and calls `post_statement_balance`:
  - Nothing in the ledger on or before the date: the whole figure posts against 3900 Opening Balance Equity ("Opening balance: …"; a bank is debited, a card is credited with the amount owed), `source_type="opening_balance"`.
  - The ledger already carries the account: an equal figure posts nothing; a different one is 409 `{code: "ledger_has_balance", message, ledger_balance, difference}` until the request repeats with `post_difference: true`, and then only the difference posts ("Opening balance adjustment: …"). The page asks with a confirm dialog.
- **Edit feed** (`PUT /api/banking/accounts/{id}`) — name, bank, last four, active; relinking to another ledger account is refused once the feed has matched statement lines (400) or when it would make a second active feed (409); `legacy_balance` may only be set to null (dismiss).

_Key files: `app/routes/banking.py`, `app/models/banking.py`, `app/schemas/banking.py`, `app/services/bank_posting.py`, `app/static/js/banking.js`_

### The register (the register is the ledger)

- **Route `#/banking/{account id}`** — a register has its own address, so a refresh stays on it; old `#/check-register` bookmarks redirect to `#/banking`.
- **Data** (`GET /api/banking/check-register?account_id=&start_date=&end_date=`) — every ledger line on the account in date/id order with a natural-balance running balance (a card shows the amount owed as positive); with a start date the prior balance is carried in; without `account_id` the first active `bank` account is used.
  - Each row: date, payee, description, reference, debit, credit, signed amount, running balance, source type/id/link, `cleared`, `reconciliation_id`, `voided`, plus `payment` (credit), `deposit` (debit) and `voidable`.
  - Payee: the vendor behind an expense or bill payment, the customer behind a payment, else the posting's description (without "CC Charge:" / "Expense:" prefixes). Reference: the posting's own, else a bill payment's check number (also shown on its void).
  - `voidable` = a register entry, transfer or card charge that is not void and not reconciled.
- **Register page** — header with name, number and kind; buttons Back, "+ Entry", Transfer, "Import file", "Find matches" (feed only), Reconcile, "Reconciliations…"; cards Balance (or "Amount owed"), To review, Last reconciled; the To review panel.
  - Table (newest first): Date, Payee, Description (link to the document or journal entry), Ref #, Type, Payment / Deposit (Charge / Payment on a card), Balance, ✓ (cleared) or R (reconciled), Void. Voided postings and reversals are struck through. No date-range filter on the page.
- **Shared service** — the same register query powers the account drill-down report (`GET /api/reports/account-transactions`) and the reconciliation candidates; the dashboard's bank widget reads ledger balances (its total counts bank accounts only, not cards).

_Key files: `app/services/bank_register.py`, `app/routes/banking.py`, `app/static/js/banking.js`, `app/static/js/app.js`_

### Register entries

- **"+ Entry" form** — Date*, Amount* (hint: negative = money out / a charge, positive = money in / a payment to the card), Payee, Check / ref #, Category* (every active account of any type except the register's own; bank and card accounts labelled), Memo, Class; "Post Entry".
- **Post** (`POST /api/banking/transactions`) — `{account_id (or the older bank_account_id feed id), date, amount, category_account_id, payee, description, check_number, class_id, job_id}`.
  - Closing-date check; the account must carry `bank_kind`; unknown category 404; zero amount 400; category equal to the account 400.
  - amount < 0: DR category / CR account; amount > 0: DR account / CR category; a category that is itself a bank or card account makes it a transfer instead.
  - Header description = payee, else memo, else "Bank entry"; line memo = memo or payee; reference = the check number; `source_type="bank_entry"`.
  - Returns the journal entry id, signed amount, category and status `recorded`.
- **Void** (`POST /api/banking/entries/{id}/void`) — only `bank_entry` postings (404 otherwise); already void 400; reconciled 400; closing date on the original date; reversal `bank_entry_void`; a statement line it was added from goes back to the review queue.

_Key files: `app/routes/banking.py`, `app/services/bank_posting.py`, `app/static/js/banking.js`_

### Transfers

- **Rule** — money between two bank/card accounts: DR to / CR from. Paying a card is a transfer from the bank to the card.
- **Post** (`POST /api/transfers`) — `{date, from_account_id, to_account_id, amount, memo, reference}`; closing date; both accounts must exist (404) and carry `bank_kind` (400); amount > 0 (400); two different accounts (400).
  - Description "Transfer: From → To — memo"; `source_type="transfer"`; the response recovers the memo from the description.
- **List / void** — `GET /api/transfers` (newest first, status `recorded` or `void`); `POST /api/transfers/{id}/void` (404 if not a transfer; already void 400; reconciled 400; closing date) posts `transfer_void`.
- **UI** — Transfer form (Date*, Amount* ≥ 0.01, From*, To* — To defaults to the first card that is not the From account — Reference, Memo; "Post Transfer" opens the From register); "Transfers…" modal lists transfers with Void; `#/banking/transfers/{id}` opens the journal view.

_Key files: `app/routes/transfers.py`, `app/schemas/transfers.py`, `app/services/bank_posting.py`, `app/static/js/banking.js`_

### Make Deposits (Undeposited Funds)

- **What waits to be deposited** — an ITEM is any debit on 1200 Undeposited Funds from a posting that is not void and not a reversal: customer payments received into Undeposited Funds, sales-receipt payments, imported postings, or a journal entry debiting 1200.
  - Items already named by a live deposit are excluded; deposits that named no items (made before deposits kept their list, imported, or posted by hand) are netted against the OLDEST waiting items first.
  - Customer payments are described with who paid, check number, the payment's reference, method and the invoice(s) or sales receipt they paid.
- **Page `#/deposits`** (sidebar Banking → Make Deposits) — toolbar Deposit To (bank-kind accounts only, with stored balance), Date, Reference ("Deposit slip #"), Class (Uncategorized preselected); a table with select-all (Date, Received From, Description with "for Invoice #…", Check # / Ref, Method, Amount); "Selected: $X (N items)"; "Make Deposit".
  - "Recent deposits" (last 20): Date, Deposited To, Slip #, Payments (blank for a deposit with no list), Amount, Status (Void / Reconciled), View and Void. `#/deposits/{id}` opens one deposit with the payments it took.
- **Create** (`POST /api/deposits`) — `{deposit_to_account_id, date, total, reference, class_id, job_id, line_ids}`; closing date; the deposit-to account must exist (404); a missing 1200 is the control-account 409.
  - With `line_ids` the deposit is exactly the ticked items: each must still be waiting (400 "One of the payments you ticked has already been deposited or voided. Reload…"), rows are locked (`SELECT … FOR UPDATE`, a no-op on SQLite), an item stamped a moment ago is 409, and `total` is only a cross-check (400 on mismatch).
  - Without `line_ids` (older API form) `total` is the amount; total ≤ 0 is 400.
  - Journal: DR bank / CR 1200 ("Deposit to <bank>"), `source_type="deposit"`, reference = slip number; each item line is stamped with the deposit; response `{status, transaction_id, amount, items}`.
- **Void a deposit** (`POST /api/deposits/{id}/void`) — refused when already void or when on a reconciled statement (400); posts `deposit_void` (closing date on the deposit's date) and clears the stamps, so its payments are waiting again. This is how one payment comes out of a deposit.
- **Payment void rules** — a payment whose money is in a live deposit cannot be voided until that deposit is (400 naming "the deposit of <date> to <bank> (slip …, $…)"); never once the deposit is reconciled, or when the payment went straight into a bank account on a reconciled statement ("If the check bounced, charge the customer again with a new invoice"); a payment used up by an unlisted older deposit is also refused.
- **Limits** — a deposit is exactly two lines (no cash-back or extra "from account" lines); the page offers bank accounts only.

_Key files: `app/routes/deposits.py`, `app/services/undeposited_funds.py`, `app/schemas/deposits.py`, `app/static/js/deposits.js`, `app/routes/payments.py`_

### Credit card charges

- **Page `#/cc-charges`** (sidebar Banking → CC Charges) — list: Date, Payee, Account, Card, Reference, Amount, Void (voided rows struck through); "+ Enter Charge" form: Date*, Payee, Expense Account* (active expense and COGS accounts), Card* (credit-card accounts, 2100 preselected), Amount*, Reference, Class, Function (nonprofit), Job, Memo.
- **Post** (`POST /api/cc-charges`) — closing date; card = `card_account_id`, else 2100 (control-account 409 if missing); the card must exist (404) and be a liability (400); the expense account must exist (404); amount > 0 (400).
  - Journal: DR expense (with the optional nonprofit function) / CR card; line memo = memo or payee; header "CC Charge: <payee>" or "Credit Card Charge"; `source_type="cc_charge"`; class and job; response `{status, transaction_id, amount}`.
- **List / void** — `GET /api/cc-charges` (newest first, card name and status); `POST /api/cc-charges/{id}/void` → `cc_charge_void` (already void 400, reconciled 400, closing date), response includes `void_transaction_id`.
- **Limits** — one expense line per charge (no splits), no edit; a card refund or credit is entered as a positive register entry or a transfer.

_Key files: `app/routes/cc_charges.py`, `app/schemas/cc_charges.py`, `app/static/js/cc_charges.js`_

### Bank feeds — SimpleFIN

- **Model** — the user signs up with any SimpleFIN provider (the reference bridge.simplefin.org or another that issues setup tokens) and pastes a one-time setup token; SlowBooks holds no developer credential and runs no middleman server.
- **Connect** (`POST /api/simplefin/claim {setup_token}`) — the token is base64 of an https claim URL (400 "That doesn't look like a SimpleFIN setup token" / "Setup token must contain an https claim URL"); one POST exchanges it for a permanent access URL with embedded basic-auth credentials (non-200: "The SimpleFIN bridge rejected the token (setup tokens are single-use — generate a fresh one and try again)").
  - The access URL is stored Fernet-encrypted (`simplefin_access_url`, redacted in Settings); accounts are fetched and cached; the mapping and last-sync time are reset.
- **Map** (`POST /api/simplefin/map {mapping: {simplefin_account_id: bank_account_id}}`) — targets are FEEDS (bank_accounts rows), so a feed must exist first; 0/empty entries are omitted; an unknown feed is 404. The page saves the mapping automatically before each sync.
- **Sync** (`POST /api/simplefin/sync`) — `GET {access_url}/accounts?start-date=` for every mapped account: first sync reaches back 85 days, later syncs re-request from 7 days before the last sync; not connected 400; nothing mapped 400; bridge failures 502 with fixed text (403 → "refused the stored credentials — disconnect and connect again with a fresh token").
  - Pending transactions are skipped; the posted (or transacted) epoch becomes a UTC date; payee = payee or description, memo = memo or description; malformed rows or rows without a stable id become warnings.
  - Rows go through the OFX import path with `import_source="simplefin"`: dedup on the SimpleFIN transaction id per feed, bank rules, auto-match.
  - Returns `{imported, skipped, warnings, since}` (a mapped account missing from the answer and the bridge's own `errors` are warnings); updates the account cache and last-sync time (UTC, seconds).
- **"Fetch older history…"** — reach back 3, 6 or 12 months (default 12; the API takes `history_months` 1–24, 422 outside): from the same day N months back (month-end clamped) through today (exclusive end-date of tomorrow), fetched in 85-day slices oldest first (the reference bridge refuses spans over 90 days), merged with each transaction counted once; already-imported rows are skipped.
- **Disconnect** (`POST /api/simplefin/disconnect`) — forgets access URL, mapping, cache and last-sync time; imported statement lines stay.
- **Status** (`GET /api/simplefin/status`) — `connected`, `last_sync`, `account_map`, cached accounts (id, name, org, currency, balance).
- **Network hardening** — https only; hosts that resolve to non-public addresses (loopback, RFC 1918, link-local/metadata…) are refused; the connection is pinned to the vetted IP with Host header and SNI kept on the hostname (certificate verified); redirects off; proxy environment ignored; the peer address re-checked after connect; 30-second timeout; `User-Agent: slowbooks-bankfeed`; errors never echo raw exception text.
- **UI** — Banking page "Bank Feeds (SimpleFIN)" card: not connected — explanation and a password-type setup-token field with Connect; connected — a table of bridge accounts (name, institution, balance and currency, "Imports into" feed picker), last sync, "Sync Now", "Fetch older history…", "Disconnect". The toast reports new and duplicate counts and the first warning.

_Key files: `app/routes/simplefin.py`, `app/services/simplefin_service.py`, `app/services/ofx_import.py`, `app/services/settings_service.py`, `app/static/js/banking.js`_

### File imports — OFX/QFX and bank CSV

- **Entry point** — register → "Import file" (needs a feed on the account; the page offers to create one); accepts `.ofx`, `.qfx`, `.csv` (CSV chosen by extension); "Preview Import" then "Import N Transactions"; toast "Imported X (Y duplicates skipped, Z matched to the books)". Uploads are capped at 20 MB (413).
- **OFX/QFX** (`POST /api/bank-import/preview`, `POST /api/bank-import/import/{feed id}`) — UTF-8 with a Latin-1 fallback; parsed with `ofxparse` (every account and statement transaction in the file), with a regex fallback over `<STMTTRN>` blocks (FITID, DTPOSTED, TRNAMT, NAME, MEMO) only if the library is missing.
  - Payee = OFX payee, else memo; dedup by FITID per feed (a transaction with no FITID is always imported); `import_source="ofx"`; preview shows Date, Payee, Amount, FITID.
- **CSV named layouts** (detected by header signature within the first 25 lines, in this order):
  - Chase checking (`Details, Posting Date, Description, Amount, Type`) — signed Amount; `Check or Slip #` kept as the check number.
  - Chase credit card (`Transaction Date, Post Date, Description, Category, Type, Amount`) — signed Amount; description "Category - Description".
  - PayPal classic (`Date, Time, Name, Type, Status`) and PayPal 2026 (`Date, Time, Description, Gross, Fee, Net, Transaction ID, From Email Address, Name`) — Gross (not Net) is the amount; "Bank Deposit to PP Account" mirror rows skipped; the fee is appended to the description as "(fee X)".
  - Bank of America detail (`Date, Description, Amount, Running Bal.`) — statement-summary preamble skipped; "Beginning balance" / "Ending balance" rows dropped; `1,234.56` and `($25.00)` amounts.
  - Named-layout dates: `MM/DD/YYYY`, `YYYY-MM-DD`, `MM-DD-YYYY`, `DD/MM/YYYY`, then dateutil.
- **CSV generic layout** — any header naming a date (date, transaction/posted/posting/value/booking/effective date…), a description (description, details, narrative, memo, notes; else payee/name/merchant/vendor) and either one amount column or money-out + money-in columns (debit/withdrawal/paid out, credit/deposit/paid in); optional payee and check-number columns.
  - Amounts accept `1,234.56`, `$1,234.56`, `-25.00`, `(25.00)` and `25.00-`; money in − money out; zero-amount and dateless (totals/note) rows skipped; unreadable rows counted as `unread`.
  - Date order "auto": a four-digit first part is year-first, a first part over 12 is day-first, otherwise US month-first; two-digit years read like strptime's `%y`.
- **Column-mapping step** — when no layout is recognized the preview answers with the file's first row, five sample rows, whether row 1 looks like a header, and a first guess; the dialog asks for Date*, Date format (Work it out / MM/DD/YYYY / DD/MM/YYYY / YYYY-MM-DD), Description*, Payee, Amount, Check #, or money-out/money-in, plus "The first row holds column names".
  - The answer travels with preview and import as a `mapping` form field (JSON column indexes); a mapping with both an amount and debit/credit, or neither, is refused with a sentence.
- **CSV dedup** — a content-derived `import_id` = `{prefix}_{date}_{amount}_{sha256(payee|description)[:12]}_{occurrence}` (prefixes `chk`, `cc`, `pp`, `bofa`, `csv`), so re-importing a file or an overlapping export skips rows already in, while two identical same-day charges still import as occurrences 0 and 1. `import_source` = `csv_<format>` (e.g. `csv_generic`).
- **After any import** — when at least one new line arrived, bank rules run over the feed's whole unmatched queue, then auto-match; results `{imported, skipped, matched, total}` (+ `errors`, `format` for CSV).

_Key files: `app/routes/bank_import.py`, `app/services/ofx_import.py`, `app/services/bank_csv_import.py`, `app/services/upload_limits.py`, `app/static/js/banking.js`_

### Review queue and auto-match

- **Statement lines (`bank_transactions`)** — feed, date, signed amount, payee (200), description (500), check number, suggested `category_account_id`, `import_id` / `import_source`, links `transaction_id` + `transaction_line_id` (the exact bank line; a transfer has two), and `match_status`:
  - `unmatched` (waiting), `auto` (matched on arrival), `manual` (matched by hand), `added` (posted from the feed), `excluded` (dropped). The old `reconciled` tick is kept for pre-2.10 rows.
- **Auto-match** (on every import and "Find matches" → `POST /api/banking/accounts/{feed}/feed/auto-match`) — for each unmatched line (oldest first), candidates are ledger lines on the feed's account with exactly the same amount on the same side (> 0 = debit), within ±5 days, not reconciled, not already linked, and not a void or reversal.
  - A statement check number narrows the candidates to postings whose reference equals it (when any do).
  - Linked only when exactly ONE candidate is nearest in date; ties stay unmatched ("no guessing"); a ledger line is never used twice in a run. A match clears the ledger line.
- **Manual match** — "Match" lists candidates within ±30 days (date with "Nd off" / "same day", payee, ref #, type) — `GET …/transactions/{id}/candidates`, `POST …/match {line_id}`; refused if already matched, the line is on another account, amounts or sides differ, the line is reconciled, or another statement line holds it.
- **Add** (`POST …/transactions/{id}/add`) — posts the line as a register entry with the saved or given category (a bank/card category makes a transfer; a positive card line categorised to the paying bank is a card payment), payee and memo from the statement unless given, reference = check number, optional class/job; closing date on the statement date; links it as `added`. Refused when already in the books or without a category.
- **Category pick** (`PATCH …/transactions/{id} {category_account_id|null}`) — saved as it is picked so "Add all" and a reload keep it; refused once the line is in the books or when the category is the feed's own account.
- **Add all categorised** (`POST …/feed/add-all`) — posts every unmatched line that has a category, each in its own savepoint; lines that cannot post (a closed period, for instance) are reported `{added, skipped[{id, reason}]}`.
- **Exclude / Restore / Unmatch** — exclude refused while linked ("Unmatch it first"); restore only from `excluded`; unmatch refused for `added` lines ("void the entry instead") and for reconciled ledger lines, and un-clears the ledger line.
- **To review panel** (register) — every unmatched line (all pages fetched): Date, "Bank says" (payee + description), Amount (green in / red out), Category dropdown, Add / Match / Exclude, and "Add all categorised". The page never lists excluded or matched lines.
- **Listing** (`GET /api/banking/transactions?bank_account_id=&status=&skip=&limit=`) — newest first, default 500, max 1000 per page.

_Key files: `app/services/bank_matching.py`, `app/routes/banking.py`, `app/models/banking.py`, `app/static/js/banking.js`_

### Bank rules

- **Model** — name, `pattern`, category `account_id`, `vendor_id`, `rule_type` (`contains` default, `starts_with`, `exact`), `priority` (higher first), `is_active`.
- **Behaviour** — a rule only SUGGESTS a category on unmatched statement lines; it never posts and never changes a line's status (adding stays one explicit click).
  - Matching is case-insensitive against the PAYEE only; active rules by priority descending; the first rule that matches wins (even one with no category, which then stops the search).
  - A rule sets its category when it differs from the line's current one, including a category the user picked earlier.
  - Runs after every OFX, CSV and SimpleFIN import (for that feed) and on "Apply Rules Now" (`POST /api/bank-rules/apply`, all feeds) → `{matched, total_unmatched}`.
- **Page `#/bank-rules`** (sidebar Banking → Bank Rules) — list (Name, Pattern, Match Type, Category Account shown as its id, Priority, Active, Edit/Delete), "+ New Rule", "Apply Rules Now"; form: Rule Name*, Payee Pattern*, Match Type (Contains / Starts With / Exact Match), Category Account (expense, income, asset, liability and COGS accounts), Priority, Active.
- **API** — full CRUD at `/api/bank-rules`; no server-side validation of `rule_type` (an unknown type never matches) or of empty patterns (never match).

_Key files: `app/models/bank_rules.py`, `app/routes/bank_rules.py`, `app/services/bank_rules_engine.py`, `app/schemas/bank_rules.py`, `app/static/js/bank_rules.js`_

### Bank reconciliation

- **Model `reconciliations`** — `account_id` (the ledger account; `bank_account_id` kept for pre-2.10 rows), statement date and ending balance, `beginning_balance`, `cleared_total` (stamped on completion), status `in_progress` or `completed`, `completed_at`.
- **Start** (register → Reconcile; `POST /api/banking/reconciliations {account_id, statement_date, statement_balance}`) — the account must be bank/card kind; one open reconciliation per account (409 `{message, existing_id}`, which the page opens instead); a statement date on or before the last completed one is refused (400 "X is reconciled through <date>. Start the next reconciliation with a later statement date."; the form also sets a minimum date).
  - Beginning balance = the previous completed statement's ending balance ($0 for the first, so an opening-balance line must be ticked like any other). For a card, balances are the amount owed.
- **Session** (`GET …/{id}/transactions`) — every ledger line on the account dated on or before the statement date that no other completed reconciliation holds, cleared or not (voided postings and their reversals both appear), with payee, reference, signed natural amount, `reconciled` (cleared) and `matched` (linked to a statement line; shown as ●).
  - Math: difference = statement − (beginning + cleared); also cleared and uncleared totals. Matched statement lines arrive already ticked.
- **Tick / untick** (`POST …/{id}/toggle/{line_id}`) — only while in progress; refused for a line on another account, one in another completed reconciliation, or one dated after the statement date.
- **Finish** (`POST …/{id}/complete`) — refused unless |difference| ≤ $0.005 (400 "Not finished: the difference is $X, and it must be $0.00. Tick the lines that are on your statement, or check the statement's ending balance."); stamps every cleared candidate line with the reconciliation (locking it against voids and unmatching), stores `cleared_total`, marks completed; returns `cleared_count`.
- **Abandon** (`DELETE …/{id}`) — only in progress; deletes the session and keeps the ticks.
- **Report** (`GET …/{id}/report`, completed only) — beginning and ending balances, cleared balance, difference, register balance as of the statement date, and cleared vs uncleared items split into increases/decreases (bank: "Deposits and other credits" / "Checks and payments"; card: "Charges and fees" / "Payments and credits"); lines closed by earlier statements are left out.
  - PDF (`GET …/{id}/pdf`): "Reconciliation Summary" and "Reconciliation Detail" sections through the shared report template, paper size from `pdf_paper_size` (letter or a4), served inline as `reconciliation_<number>_<date>.pdf`.
- **Page** — "Reconcile — statement of <date>": Later, Abandon, Finish Reconciliation; cards Beginning Balance, Cleared, Statement Balance, Difference ("✓ Balanced — ready to finish" / "⚠ Out of balance — finish when this is $0.00"); a tick-box table. Finishing asks "Cleared lines are locked", returns to the register and opens the report; "Reconciliations…" lists history with Report / Save PDF or Continue.
- **Not supported** — reopening or undoing a completed reconciliation.

_Key files: `app/services/reconciliation.py`, `app/routes/banking.py`, `app/models/banking.py`, `app/templates/report_pdf.html`, `app/static/js/banking.js`_

### Pre-2.10 upgrade: legacy balances and migrated data

- **Migration `e7f8a9b0c1d2` (banking on the ledger)** — adds `accounts.bank_kind`, `transaction_lines.cleared` / `reconciliation_id`, `bank_transactions.transaction_line_id`, reconciliation `account_id` / `beginning_balance` / `cleared_total`, and renames `bank_accounts.balance` to `legacy_balance`. It writes no journal lines.
  - `bank_kind` backfill: assets numbered 1000/1010 or named like check/saving/cash/bank/petty → bank; liabilities numbered 2100 or named like credit card/visa/mastercard/amex/card → credit card; every account a feed already linked to.
  - Unlinked feeds get a new bank-kind asset account; reconciliations are re-keyed to the ledger account; old side-ledger ticked rows become `excluded`, everything else `unmatched`.
- **Legacy balance banner** — the Banking page shows each feed's pre-2.10 register balance once: "Post as opening balance" (asks for a date; `POST /api/banking/accounts/{feed}/post-legacy-balance {date}` — requires a linked bank/card account, checks the closing date, posts a non-zero amount against 3900, then clears it) or "Dismiss" (`PUT {legacy_balance: null}`).

_Key files: `migrations/versions/e7f8a9b0c1d2_banking_on_the_ledger.py`, `app/routes/banking.py`, `app/static/js/banking.js`_

### API endpoints

| Method | Path | What it does |
|---|---|---|
| GET | /api/accounts | List the chart (`active_only`, `account_type`, `bank=1`), by number, with control and nonprofit-only flags |
| GET | /api/accounts/{account_id} | One account |
| POST | /api/accounts | Create an account (number rules, bank_kind/type check, 409 on a duplicate number) |
| PUT | /api/accounts/{account_id} | Update; control accounts rename-only; `is_active` deactivates |
| DELETE | /api/accounts/{account_id} | Delete an unused, non-control account (400 control, 409 with history or references) |
| GET | /api/journal | Manual and QBO journal entries (or any `source_type`) with lines, totals, voided flag |
| GET | /api/journal/{entry_id} | Any posting with its lines and voided flag |
| POST | /api/journal | Create a balanced manual journal entry |
| POST | /api/journal/{entry_id}/void | Post a reversing entry (a QBO document posting voids its document) |
| GET | /api/banking/overview | Bank and card accounts with ledger balance, feed, to-review count, last reconciliation |
| GET | /api/banking/accounts | Active bank feeds with their ledger balances |
| GET | /api/banking/accounts/{account_id} | One bank feed (by feed id) |
| GET | /api/banking/ledger-balance | Books balance of a bank/card account as of a date (`account_id`, `as_of`) |
| POST | /api/banking/accounts | Create a feed for a bank/card account; optional statement balance (409 `ledger_has_balance`) |
| PUT | /api/banking/accounts/{account_id} | Edit a feed; relink guards; dismiss the legacy balance |
| POST | /api/banking/accounts/{account_id}/post-legacy-balance | Post the pre-2.10 register balance as an opening balance against 3900 |
| GET | /api/banking/transactions | Statement lines (review queue) by feed and `status`, paged |
| GET | /api/banking/transactions/{txn_id}/candidates | Ledger lines a statement line could match (same amount and side, ±30 days) |
| POST | /api/banking/transactions/{txn_id}/match | Link a statement line to a ledger line (`line_id`) |
| POST | /api/banking/transactions/{txn_id}/unmatch | Remove a match and un-clear the ledger line |
| POST | /api/banking/transactions/{txn_id}/add | Post a statement line as a register entry and link it |
| PATCH | /api/banking/transactions/{txn_id} | Save or clear the category picked for a statement line |
| POST | /api/banking/transactions/{txn_id}/exclude | Exclude a statement line |
| POST | /api/banking/transactions/{txn_id}/restore | Return an excluded line to the queue |
| POST | /api/banking/accounts/{account_id}/feed/add-all | Add every unmatched line that has a category; report skips |
| POST | /api/banking/accounts/{account_id}/feed/auto-match | Re-run auto-match over a feed's unmatched lines |
| POST | /api/banking/transactions | Post a register entry (journal entry; a bank/card category makes a transfer) |
| POST | /api/banking/entries/{txn_id}/void | Void a register entry |
| GET | /api/banking/reconciliations | Reconciliations for an account (`account_id` or legacy `bank_account_id`) |
| POST | /api/banking/reconciliations | Start a reconciliation (409 with `existing_id` when one is open) |
| GET | /api/banking/reconciliations/{recon_id}/transactions | Session lines with beginning, cleared, uncleared and difference |
| POST | /api/banking/reconciliations/{recon_id}/toggle/{line_id} | Tick or untick a ledger line |
| POST | /api/banking/reconciliations/{recon_id}/complete | Finish (difference must be $0.00); lock cleared lines |
| GET | /api/banking/reconciliations/{recon_id}/report | Completed reconciliation report (cleared and outstanding items) |
| GET | /api/banking/reconciliations/{recon_id}/pdf | Reconciliation report PDF (inline) |
| DELETE | /api/banking/reconciliations/{recon_id} | Abandon an in-progress reconciliation (ticks kept) |
| GET | /api/banking/check-register | The register: ledger lines with running balance, links, cleared state, voidable |
| POST | /api/bank-import/preview | Parse an OFX/QFX upload and return its transactions (writes nothing) |
| POST | /api/bank-import/import/{bank_account_id} | Import OFX/QFX into a feed (FITID dedup, rules, auto-match) |
| POST | /api/bank-import/preview-csv | Parse a bank CSV (optional `mapping`); an unknown layout returns columns and samples |
| POST | /api/bank-import/import-csv/{bank_account_id} | Import a bank CSV into a feed (content-id dedup, rules, auto-match) |
| GET | /api/bank-rules | List rules by priority |
| GET | /api/bank-rules/{rule_id} | One rule |
| POST | /api/bank-rules | Create a rule |
| PUT | /api/bank-rules/{rule_id} | Update a rule |
| DELETE | /api/bank-rules/{rule_id} | Delete a rule |
| POST | /api/bank-rules/apply | Apply active rules to every unmatched statement line (category only) |
| GET | /api/simplefin/status | Connection state, last sync, account map, cached bridge accounts |
| POST | /api/simplefin/claim | Exchange a setup token for the stored access URL; fetch accounts |
| POST | /api/simplefin/map | Save which bridge account feeds which bank feed |
| POST | /api/simplefin/sync | Pull transactions (optional `history_months` 1–24) through dedup, rules, auto-match |
| POST | /api/simplefin/disconnect | Forget the credential, mapping, cache and last sync |
| GET | /api/transfers | List transfers with status |
| POST | /api/transfers | Post a transfer between bank/card accounts |
| POST | /api/transfers/{transfer_id}/void | Void a transfer |
| GET | /api/deposits/pending | Items waiting in Undeposited Funds, newest first |
| GET | /api/deposits | Deposits made (paged, max 200) with item count, void and reconciled flags |
| GET | /api/deposits/{deposit_id} | One deposit with the payments it took |
| POST | /api/deposits | Make a deposit from ticked items (`line_ids`) or an amount |
| POST | /api/deposits/{deposit_id}/void | Void a deposit; its payments wait again |
| GET | /api/cc-charges | List card charges with card and status |
| POST | /api/cc-charges | Post a card charge (DR expense / CR card) |
| POST | /api/cc-charges/{charge_id}/void | Void a card charge |
| GET | /api/opening-balances/status | Wizard readiness and active balance-sheet accounts |
| POST | /api/opening-balances | Post opening balances (optional auto-balance to equity) |
| GET | /api/fixed-assets/types | Asset types (`include_inactive`); seeds the default type if none |
| POST | /api/fixed-assets/types | Create an asset type |
| PUT | /api/fixed-assets/types/{type_id} | Update an asset type |
| GET | /api/fixed-assets | Asset register (`include_disposed`, default true) with book value and posted flag |
| GET | /api/fixed-assets/{asset_id} | One asset |
| POST | /api/fixed-assets | Register an asset; optional `acquisition` posts the purchase |
| POST | /api/fixed-assets/{asset_id}/post-purchase | Post the purchase of an asset registered without one |
| PUT | /api/fixed-assets/{asset_id} | Edit an asset (locked fields once posted; disposed read-only) |
| POST | /api/fixed-assets/run-depreciation | Post depreciation through a run date for all registered assets |
| POST | /api/fixed-assets/{asset_id}/dispose | Dispose of an asset with proceeds; post gain or loss |
| POST | /api/fixed-assets/import-csv | Import assets from CSV (posts nothing) |
| GET | /api/fixed-assets/reports/reconciliation | Register totals per asset type (cost, accumulated, book value) |
| GET | /api/classes | Classes (`include_archived`), system default first |
| POST | /api/classes | Create a class / fund |
| PUT | /api/classes/{class_id} | Rename, archive, or edit fund fields |
| DELETE | /api/classes/{class_id} | Delete an unused class (not the default) |
| GET | /api/budgets | Budget cells (`year`, `account_id`) |
| POST | /api/budgets | Upsert one budget cell |
| POST | /api/budgets/bulk | Upsert many budget cells |
| GET | /api/budgets/variance | Budget vs actual per account per month for a year |
| GET | /api/fx/rate | Latest Bank of Canada rate between two currencies (default to home) |

### Notes, gaps & discrepancies

- **Flagging an existing account as bank/card has no UI.** `docs/banking.md` ("Chart of Accounts → an asset account → kind: Bank") and the v2.10.0 CHANGELOG ("Chart of Accounts can flag others") describe a control the Chart of Accounts form does not have, and the API error "Set its kind under Chart of Accounts first" points at it. In code, `bank_kind` is set only by the seed, the v2.10 migration backfill, Banking → New Bank Account → "+ Create a new chart account…" (new accounts only), the chart-file import, the QuickBooks Online import, or a direct `PUT /api/accounts/{id}`.
- **Restore and Unmatch are API-only.** `docs/banking.md` says "Exclude — drop it (Restore brings it back)" and that migrated ticked rows can be restored, but the SPA lists only `unmatched` lines; `BankingPage.restoreLine` and `unmatchLine` exist in `banking.js` but nothing calls them.
- **Seeded-chart counts are stale in docs and comments.** `docs/features.md` says "39+ seeded accounts"; a comment in `routes/accounts.py` says 57 seeded, "fifteen" control and "forty-two" ordinary. The seed has 56 accounts: 13 of the 15 control accounts plus 43 ordinary ones (4800 is created on demand; 5900 only if added by hand).
- **`docs/features.md` API table vs code:** "DELETE refuses a system account" — deletion is gated on the control-account registry, and ordinary seeded accounts can be deleted. `/api/budgets` is listed as GET, POST, PUT, DELETE — the code has GET, POST, POST `/bulk` and GET `/variance`, with no PUT or DELETE (`BudgetUpdate` schema unused).
- **"Straight-line depreciation posts monthly"** (`docs/features.md`) — depreciation runs only when someone runs it; declining balance is also implemented.
- **PayPal fee handling.** The CSV module comments say the fee "goes to Merchant Fee expense (6120)" in a separate split; the code only appends "(fee X)" to the statement line's description, and 6120 is Payroll Tax Expense in the seeded chart.
- **Reversal recognition is incomplete.** `REVERSALS` in `qbo_documents.py` (used by the journal list/view `voided` flag and by the journal void's "already voided" guard) lists only `manual_void`, `bank_entry_void`, `deposit_void`, `qbo_ledger_void`, `qbo_journal_void`, though its comment claims to cover the `void_document()` convention. By code reading: a voided transfer or card charge opened in the journal view is not marked "Voided", and `POST /api/journal/{id}/void` would reverse such a posting a second time. That endpoint also accepts any posting that is not itself a reversal (for example an invoice's posting); the SPA only offers Void on manual and QBO-imported entries.
- **FX default of 1.0.** `fx_service` says "the frontend falls back to 1.0 with a notice" and `resolve_rate` says booking at 1.0 "would corrupt the ledger". The server's "no rate" 400 fires only when no rate is sent, but the document form's rate field starts at 1 and is always sent, so if the feed cannot answer and the operator changes nothing the document books at 1.0. The invoice, sales-receipt and bill pickers also start on USD whatever `home_currency` is, so for a company kept in another home currency a new document starts as a USD document at rate 1 unless changed (code reading).
- **Loose API guards the SPA hides:** a deposit's `deposit_to_account_id` is not required to be a bank account; a card charge's card only has to be a liability and its expense account can be any type; a disposal's `deposit_account_id` is not validated (the page lists every asset account); postings do not check `is_active` (the journal form even lists inactive accounts); `require_bank_account` ignores `is_active`.
- **Bank rules:** `vendor_id` is stored but never used and has no form field; `rule_type` is unvalidated; only the payee is matched (not the description); a rule replaces a category the user picked on an unmatched line; the rules list shows the category as a raw account id; the page says rules "auto-match" but they only suggest a category.
- **Import details:** OFX lines always get `import_source="ofx"` (QFX included) and no check number (CHECKNUM is not parsed, so check-number narrowing never helps OFX lines); a multi-account OFX file imports every account into the chosen feed; only a missing `ofxparse` is handled, not a malformed file. SimpleFIN's sync result drops the `matched` count that the shared import computes, and the page shows only the first warning. Each import re-runs rules and auto-match over the feed's whole unmatched queue, not just the new lines.
- **Other importers do not flag bank accounts:** the IIF importer creates BANK accounts without `bank_kind` and has no CCARD mapping (a CCARD account falls back to Expense with a validation warning); IIF export has no CCARD type either (2100 exports as OCLIAB). Such accounts stay out of Banking until flagged through the API.
- **Budgets:** blank or zero cells are never saved, so a budget cannot be cleared from the page; no delete endpoint; month/year unvalidated; income variances use the expense colour rule; the variance dialog's period selector is ignored.
- **Fixed assets:** whole months count only once the day of month is reached, so a run on Feb 28 after a Jan 31 run posts nothing (the next run catches up) — by code reading; declining balance multiplies the current book value by the number of months in one step (no compounding within a run); there is no depreciation history table ("deferred per the spec") and no way to undo a run (reversing its journal entry would not roll back the register fields); disposal does not post depreciation up to the disposal date; 7999 and 6999 are created as expense accounts; there is no page control to edit or deactivate an asset type or edit an asset, and no delete for either.
- **Opening balances wizard:** repeatable with no guard; the per-line "active" wording is not enforced; A/R and A/P amounts have no sub-ledger documents behind them.
- **Classes:** the router comment says a class used by "any document or transaction" cannot be deleted, but only journal headers are checked (a class used only on lines or documents is left to the database's foreign keys).
- **Reconciliation:** no reopen or undo of a completed reconciliation; the first one starts from a $0.00 beginning balance.
- **Closing-date lockout counters are per process;** the code comment assumes one process, while the Docker entrypoint starts two uvicorn workers by default.
- **Stored vs ledger balances:** the Chart of Accounts page and the Make Deposits picker show the stored `accounts.balance`; Banking, reconciliation and reports use ledger-derived balances.
- **Stale references:** `AccountResponse` says every new chart carries 4400 In-Kind Contributions (the seed says it never does for a business); model and route comments cite `docs/spec-fixed-assets-management.md` and a `spec-opening-balance-wizard` that are not in the repository.

---

_[← 2. Purchasing, Accounts Payable, Items & Inventory](02-purchasing-payables-inventory.md) · [Index](README.md) · [4. Payroll & HR →](04-payroll-hr.md)_
