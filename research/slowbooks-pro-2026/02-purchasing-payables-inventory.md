_SlowBooks Pro 2026 feature inventory — [← 1. Sales & Accounts Receivable](01-sales-accounts-receivable.md) · [Index](README.md) · [3. General Ledger, Chart of Accounts & Banking →](03-general-ledger-banking.md)_

## 2. Purchasing, Accounts Payable, Items & Inventory

The purchasing side follows the QuickBooks 2003 "Vendors & Payables" Navigator. It has a Vendor Center; non-posting Purchase Orders that become Bills; Bills that credit Accounts Payable (2000); Pay Bills, which relieves A/P from a bank or card account and can print voucher checks; Vendor Credits; and a one-step Enter Expenses screen for receipts that are already paid. There are four item types: service, product, material and labor. They feed every purchase and sales form. Any item flagged `track_inventory` also runs through a perpetual inventory ledger with weighted-average cost, automatic COGS entries and manual adjustments to count. A local OCR "Scan Receipt" pipeline pre-fills the Bill and Expense forms and attaches the source file. It uses Apple Vision on macOS, Windows OCR on Windows and Tesseract elsewhere, and adds a box-to-fix canvas plus a per-merchant layout memory. Year-end 1099-NEC and 1096 PDFs are computed from bill payments.

### Vendors (Vendor Center)
- **Vendor list** — the Vendor Center, at `#/vendors` (sidebar "Vendors & Payables → Vendors").
  - Columns are Name (inactive rows are dimmed with an `inactive` badge), Company, Phone, Email, Balance, and Actions (**Edit**). Every vendor is listed, active and inactive, sorted by name (`GET /api/vendors` orders by `Vendor.name`).
  - "+ New Vendor" is in the header. With no vendors the page shows "+ Create your first vendor".
  - The UI has no per-vendor detail or transaction pane. The Customer Center has `showDetails` and the Vendor Center does not. There is also no Delete button.
  - API filters: `active_only` and `search`. `search` is a case-insensitive `ILIKE` on the name only.
- **Vendor fields**. `VendorCreate`/`VendorUpdate` are `StrictModel`s, so an unknown field returns 422. Field lengths mirror the VARCHAR widths, so an oversize value also returns 422 on both SQLite and PostgreSQL.
  - `name` is required. It is trimmed and must be 1–200 characters; a blank or whitespace-only name is refused.
  - `company` (200). `email`: blank becomes null; anything else must look like `x@y.z` (max 200). `phone` (50), `fax` (50), `website` (200).
  - Address: `address1`/`address2` (200), `city` (100), `state` (50), `zip` (20), `country` (100, default `US`; the form uses a country select).
  - `terms` (50, default `Net 30`), `tax_id` (50, stored and returned in plain text), `account_number` (50, "Account #", your account with the vendor), `default_expense_account_id`, `is_1099_vendor` (default false), `vendor_1099_type` (10), `notes`. `is_active` can be set on update only.
  - Model columns the API never sets: `is_1099_eligible` (legacy), `w9_on_file`, `w9_document_id` (FK to attachments), and `balance`. The stored `balance` is never written; responses compute it instead (below).
- **Vendor form** ("New Vendor"/"Edit Vendor" modal)
  - Name*, Company, Email, Phone, Fax, Website; Address block (Address 1, Address 2, City, State / County, ZIP / Postcode, Country).
  - Terms select: Net 15 / Net 30 / Net 45 / Net 60 / Due on Receipt. Tax ID, Account #.
  - Default Expense Account: expense and COGS accounts that are active, plus the account already chosen even if it is another type or inactive, so a flour mill can default to 5100 Materials Cost.
  - Status (edit only): Active / Inactive. Its tooltip reads "An inactive vendor keeps its history but leaves the pickers on bills, expenses and orders".
  - 1099 Vendor No/Yes. 1099 Type (-- None --, NEC (Non-Employee Comp), MISC, INT (Interest), DIV (Dividends)) is disabled and blank until 1099 Vendor is Yes. Notes.
- **Balance (what is owed to the vendor)**. `app/services/contact_balances.vendor_balances` sums this on every read, in home currency:
  - plus open bills' `balance_due` (not void, > 0), each times the bill's booked `exchange_rate`;
  - minus unapplied vendor credits (not void, `balance_remaining` > 0);
  - minus the unallocated part of each non-void bill payment, at the payment's rate.
  - It uses a constant number of grouped queries per list. Beyond 500 ids it reads every row instead of an IN list.
- **Active / inactive**
  - `DELETE /api/vendors/{id}` never deletes. It sets `is_active=false` and answers "Vendor deactivated", even when the vendor has open bills.
  - Inactive vendors stay listed and stay on their documents. They leave the pickers: Enter Bill, Enter Expense and New Vendor Credit load `?active_only=true`, and the PO form hides inactive vendors except the one the PO already names.
- **Fuzzy duplicate detection** (create only; `app/services/duplicate_detection.py`)
  - `POST /api/vendors` compares the new name against every *active* vendor.
  - Names are normalized: lower-cased, punctuation stripped, business suffixes dropped (inc, incorporated, corp, corporation, co, company, ltd, limited, llc, l.l.c, llp, lp, pllc, plc, gmbh, ag, sa, s.a, bv, pty, the), whitespace collapsed.
  - An exact normalized match scores 1.0. Otherwise the score is `difflib.SequenceMatcher.ratio()`, and a match is ≥ **0.85**.
  - A match returns 409 `{"error":"possible_duplicate","message":…,"duplicates":[{id,name,similarity}]}`, best match first. `?force=true` bypasses the check.
  - The UI shows a "Possible Duplicate Vendor" dialog with each match's "(NN% match)" and a **Create Anyway** button, which re-posts with `force=true`.
  - `GET /api/vendors/check-duplicate?name=` returns the same list for a pre-submit check. Nothing in the SPA calls it.
  - A rename through `PUT` is not duplicate-checked.
- **Vendor quick-add** (`VendorQuickAdd`, on the Enter Bill and Enter Expense forms)
  - The vendor picker has a "+ New Vendor" option that opens an inline "Quick Add Vendor" name box with Save and Cancel.
  - If "+ New Vendor" is still selected when the form is saved, `ensure()` creates the vendor from the name box.
  - A 409 near-duplicate reuses the top match instead of creating a twin, with the toast "Using existing vendor …".
  - A scanned merchant name selects an existing vendor on an exact, case-insensitive match. Otherwise it opens quick-add with the name pre-filled.
- **Terms**
  - Terms are a free string. The Enter Bill form copies the vendor's terms into its Terms select, adding a non-standard value as an option.
  - The server uses the vendor's terms whenever a bill is posted without terms or with blank terms. PO conversion always uses the vendor's terms, and the PO PDF prints them.
  - Due dates follow the terms, as described under Bills.
- **Default expense account** — the last fallback for any purchase line that names no account (see Purchase posting rules). In the UI:
  - Enter Bill fills every enabled, blank line account when a vendor is picked, and also when an item without its own expense account is picked.
  - Enter Expense fills a blank Expense Account.
  - The To Bill dialog pre-selects it.
  - The vendor-credit form treats a line as having an account when the vendor has a default.
- **Other touchpoints**
  - Global search (Ctrl+K or `/`) finds *active* vendors by name or company; a result navigates to `#/vendors`.
  - The CSV export `vendors` holds active vendors with the columns ID, Name, Company, Email, Phone, Address, City, State, ZIP, Terms, Balance. The CSV import fills Company, Email, Phone, Address, City, State and ZIP, with default terms Net 30.
  - The attachments API accepts `entity_type=vendor`, but the vendor form has no attachment UI.

_Key files: `app/routes/vendors.py`, `app/models/contacts.py`, `app/schemas/contacts.py`, `app/schemas/common.py`, `app/services/duplicate_detection.py`, `app/services/contact_balances.py`, `app/static/js/vendors.js`_

### Purchase Orders
- **PO list** (`#/purchase-orders`, sidebar "Purchase Orders")
  - Columns are #, Vendor, Date, Status, Total, and Actions: **View**, **Edit**, and **To Bill** unless the PO is closed.
  - Shows the newest 500 with a "Show all" note. The API defaults to 500 per page, maximum 1,000, newest first, filtered by `vendor_id` or `status`.
  - The page has no status filter. POs have no deep link.
- **Numbering** — `PO-0001`, `PO-0002` and so on (`next_document_number(prefix="PO-", first=1, pad=4)`).
  - The next number is MAX(`po_number`) + 1, checked for collisions. `po_number` is UNIQUE.
  - A create retries up to 10 times on an IntegrityError. If every retry fails it returns **503** "Could not assign a unique PO number; please retry."
- **Statuses** (`POStatus`): `draft` (default), `sent`, `partial`, `received`, `closed`.
  - The code itself only ever writes `draft` (on create) and `closed` (on conversion). `PUT /api/purchase-orders/{id}` with `status` can set any of the five.
  - The SPA has no Send, Receive or Close action and its save never sends a status, so from the UI a PO is `draft` until it becomes a bill.
  - `PurchaseOrderLine.received_qty` is returned by the API but nothing ever writes it. It is always 0.
- **Fields**
  - Header: `vendor_id` (404 if unknown on create), `date`, `expected_date`, `ship_to` (free text, API only), `tax_rate` (a fraction 0–1 to six places; above 1 → 422 with a percent-worded message), `notes`, `job_id`.
  - Lines: `item_id`, `description`, `quantity` (Numeric 10,2), `rate` (Numeric 17,4, so four-place unit prices), `job_id`, `cost_code_id`, `line_order`.
  - At least one line is required (422). A negative quantity or rate is refused (422 "…use a credit memo for refunds").
- **Totals** — each line amount is rounded half-up to the cent before summing. Tax is subtotal × `tax_rate` and applies to every line. Total is subtotal + tax.
- **New / Edit PO form**
  - Vendor* (inactive vendors hidden except the PO's own), Date*, Expected Date, Tax Rate (%), Job.
  - Tax Rate starts at **0**, in percent to four decimals. Its tooltip says "Sales tax the vendor charges, if any. It becomes part of what the goods cost". A new PO no longer inherits the selling rate.
  - Line Items: Item, Description, Cost Code (only when cost codes exist), Qty, Rate, Amount. Picking an item fills its description and its **cost**, or its price when cost is 0.
  - Live Subtotal/Tax/Total, "+ Add Line", Notes, and a Create PO / Update PO button.
- **Update**
  - `PUT` with `lines` deletes and rebuilds all lines and re-totals them, using the new tax rate if one was sent, otherwise the stored rate. A `tax_rate` alone re-totals the stored lines.
  - There is no guard against editing a closed PO. The list offers Edit on every PO.
  - There is no closing-date check, because a PO posts nothing.
  - An invalid `status` string raises an unhandled `ValueError`.
- **View / PDF / Print**
  - The View modal shows vendor, date, expected date, status, lines, Subtotal/Tax/Total and notes, with the buttons **Save PDF**, **Print**, **To Bill** and **Close**.
  - `GET /api/purchase-orders/{id}/pdf` is WeasyPrint output, served inline as `PurchaseOrder_PO-0001.pdf` (RFC 5987 filename). `/print-preview` returns the same HTML with `window.print()` on load.
  - The template has the company header and logo; "PURCHASE ORDER #…"; Date, Expected, and the vendor's Terms; the Vendor address; Ship To (the `ship_to` lines, else the company address); lines (description or item name, Qty, Rate, Amount); Subtotal, Tax (x%) and Total; Notes; and the footer "Generated by Slowbooks Pro 2026".
  - The PDF prints Rate with the 2-decimal, float-based `currency` filter, not the four-place `rate` filter the invoice PDF uses, so a $0.045 unit price prints as $0.04. There is no PDF email for POs.
- **Convert to bill** ("To Bill", `POST /api/purchase-orders/{id}/convert-to-bill`)
  - **Dialog** "Turn PO-0001 into a bill". It lists each line with its amount and an Account cell:
    - a stock item shows "Inventory (stock item)";
    - a $0 line shows "Nothing to record";
    - any other line gets an account select, pre-filled with the item's expense account or else the vendor's default.
  - The dialog explains that the bill is dated the **PO date** and takes the vendor's terms. When the PO has tax, it says the tax "is added to each line's account, not to Sales Tax Payable".
  - **Create Bill** refuses to proceed until every select has a value.
  - The optional body `lines: [{line_id, account_id}]` chooses accounts per line. A `line_id` that is not on the PO → 400 "Line id N is not a line of PO-…".
  - **Guards**: 404 when the PO is missing; closing date on the PO date (403); 400 "PO already closed"; 400 when the PO totals $0.00. Every line's account is resolved before anything is written, so a refused line leaves no bill behind. A missing 2000 A/P account → 409.
  - **The bill it creates**:
    - `bill_number = "BILL-" + po_number` (for example `BILL-PO-0007`), with no duplicate check. Status `unpaid`, `po_id` set.
    - Date is the PO date. Terms are the vendor's (else Net 30), and the due date comes from those terms.
    - Subtotal, tax rate, tax and total are copied from the PO. Notes read "From PO-0007". The job comes from the PO.
    - Lines copy item, description, qty, rate, amount, the line job (else the PO job) and the cost code. No class or function is carried.
  - **Journal**: posted as `source_type="bill"`. It uses the same posting rules and tax spread as Enter Bill, and credits A/P for `po.total`. Stock lines write PURCHASE movements at the tax-inclusive unit cost.
  - The PO is then set to `closed`. Conversion always bills the whole PO. There is no partial receipt, and there is no choice of bill date or number.
  - The response is `{"bill_id": N, "message": "Bill created from PO-…"}`, not a BillResponse. The SPA then navigates to `#/bills`.
- **Committed cost** (job costing)
  - `jobs_service.committed_cost` sums PO **line amounts** (pre-tax) for POs whose status is `sent`, `partial` or `received`, grouped by the line's job or else the PO header's job.
  - It feeds `committed_cost` on the Jobs list and job summary, the job budget-vs-actual drill-down (committed by cost code), and the "Jobs: Budget vs Actual" dashboard card.
  - Draft and closed POs never count. Conversion closes the PO, which moves the cost into the ledger.
- **Dashboard card "Open Purchase Orders"** ("Committed but not yet billed"; optional, not in the default layout)
  - It shows the count and the sum of PO **totals** (tax included) for sent, partial and received POs.
  - It lists the newest 5; clicking one opens `#/purchase-orders`.

_Key files: `app/routes/purchase_orders.py`, `app/models/purchase_orders.py`, `app/schemas/purchase_orders.py`, `app/services/numbering.py`, `app/services/jobs_service.py`, `app/services/dashboard_widgets.py`, `app/templates/purchase_order_pdf.html`, `app/static/js/purchase_orders.js`_

### Bills (Enter Bills)
- **Bills page** (`#/bills`, titled "Bills (Accounts Payable)")
  - Header buttons: **+ Enter Bill** and **Pay Bills**. A status filter (All Statuses / Unpaid / Partial / Paid / Void) works client-side.
  - Columns are sortable (default Date descending): Bill #, Vendor, Date, Due, Status, Total, Balance, Actions. Actions are **View**, plus **Void** unless the bill is void or paid.
  - Shows the newest 500 (fetches 501) with a "Show all" note, which reads every page. `#/bills/{id}` opens a bill over the list; the bank register and report drill-downs link there.
- **List API** — `GET /api/bills` filters on `vendor_id`, `status` and `open_only`.
  - `open_only` returns unpaid or partial bills with a balance above 0. Pay Bills and the vendor-credit Apply dialog use it so an old unpaid bill is never lost behind the newest page (issue #191).
  - Results are newest first, `skip`/`limit` default 500 and max 1,000, with lines included.
- **Enter Bill form** (modal "Enter Bill")
  - Scan Receipt row; Vendor* (quick-add); Bill Number (placeholder "from the receipt, or left blank"); Date* (today).
  - Terms (Net 15/30/45/60/Due on Receipt; filled from the vendor); Class; Job; Currency + Exchange Rate (USD, CAD, EUR, GBP, AUD, JPY, CHF, MXN, INR, CNY; the rate pre-fills from the FX feed).
  - Line Items columns:
    - Item.
    - Account: "Choose…", with active expense and COGS accounts. It is disabled for stock items, with the tooltip "Stock items are recorded in Inventory".
    - Description.
    - Cost Code, when cost codes exist.
    - In nonprofit mode: a fund (class) column, a Function column, and a **Split** button that expands the line by a saved allocation rule.
    - "Bill?" billable checkbox.
    - Qty (step 0.01), Rate (step 0.0001), Amount.
  - "+ Add Line", a running Total, Notes, **Save Bill**.
  - The UI has **no tax field, no due-date field and no Ref # field**. Those are API only (`tax_rate`, `due_date`, `ref_number`, `po_id`).
  - Picking an item fills its description and its cost (else its price), and fills its expense account (else the vendor default). A stock item disables the account.
  - Checks before sending: a total ≤ $0 → "Enter what the vendor charged: a quantity and rate on at least one line."; a non-stock line with an amount but no account → "Choose an account for line N: where should it be recorded?".
- **Bill number** — the *vendor's* invoice number.
  - When blank, one is generated: `YYYYMMDD-INITIALS`, where the initials are the first characters of up to 4 alphanumeric words of the vendor name (`BILL` if there are none). If that vendor already has the number, `-2`, `-3` and so on are appended. Example: `20260902-GK` for Gin Kee.
  - Duplicates are checked **per vendor**: the same vendor + number → **409** "Bill number 'X' already exists for this vendor (bill #N)". The check includes voided bills. It is enforced in the application only; the database has no unique constraint.
- **Terms and due date**
  - Terms come from the request. If terms are absent or blank, the vendor's terms are used, else Net 30.
  - `due_date` is the explicit value, else it is computed from the terms:
    - "Net N" → date + N days;
    - "Due on Receipt", "Due upon receipt", "COD" or "Net 0" → the bill date;
    - anything unparseable → +30 days.
  - Early-payment discount terms (for example 2%/10) are not modelled.
- **Validation and guards**
  - At least one line (422). Quantity and rate ≥ 0 (422).
  - `tax_rate` is a fraction 0–1 (422 names the percent). Unknown fields → 422.
  - The vendor must exist (404). Dates on or before the closing date → **403**, unless the closing-date override password is sent in `X-Closing-Date-Password`; the SPA prompts for it.
  - The total must be > 0: 400 "A bill must be for more than zero…".
  - Foreign currency needs a supplied rate or a rate from the Bank of Canada feed, else 400. A rate ≤ 0 → 400.
  - A missing 2000 A/P account → **409** naming the account. Account-resolution failures → 400 (see Purchase posting rules).
- **Statuses** (`BillStatus`): `unpaid` (every new bill), `partial`, `paid`, `void`. The enum's `draft` is never assigned by any path.
- **Accounting**
  - The journal entry is `source_type="bill"`, described "Bill {number} - {vendor}".
  - It debits each line's posting account for the line amount plus that line's share of tax. Line dimensions travel with it: job, class, cost code, billable, and the nonprofit function.
  - It credits **2000 Accounts Payable** for the total. Header class and job are defaults for lines without their own.
  - A foreign-currency bill converts every line to home currency at the booked rate. Any rounding drift is absorbed by the largest line.
  - Stock lines also write PURCHASE inventory movements at the tax-inclusive unit cost. This adds no second entry, because the bill's own entry already debits Inventory.
- **Bill view** (modal "Bill N")
  - Header: vendor, date, terms, due date, status.
  - Lines table: Description, Account (number and name), Qty, Rate, Amount.
  - Totals: Subtotal; Tax, only when nonzero, with the tooltip "Part of what the goods cost: it posts with the lines, not to Sales Tax Payable"; Total; Paid; Balance.
  - **Payments** table: Date; Paid by (method plus `#check`); Applied; **Print Check** and **Void** on each payment. Voided payments are dimmed.
  - **Attachments**: list and download, "X" delete, and upload with `entity_type=bill`. Stored in the company database, max 50 MB, PDF/image/text/CSV/Office/ZIP types.
  - Buttons: **Save PDF**, **Print**, **Close**.
- **No editing** — `BillUpdate` is defined in `app/schemas/bills.py`, but no route uses it. There is no `PUT /api/bills/{id}`. A mistake is corrected by voiding and re-entering the bill, and because the duplicate check covers void bills, the new entry needs a different bill number.
- **Void** (`POST /api/bills/{id}/void`)
  - Refusals: 400 "Bill already voided". 400 if `amount_paid > 0`: "Cannot void a bill with payments applied. Void the bill payment(s) first…". A vendor-credit application also counts as paid.
  - The closing date is checked against the **bill** date (403).
  - It posts a reversing entry (`bill_void`), dated the bill date, carrying every dimension.
  - Stock lines get VOID movements of −qty at the line's `rate`.
  - Status becomes `void` and `balance_due` becomes 0.
- **PDF / Print**
  - `GET /api/bills/{id}/pdf` is served inline as `Bill_{bill_number}.pdf`. The name is made safe because the vendor's number can contain anything. `/print-preview` opens the print dialog.
  - The template has the company header and logo; "BILL #…"; Date, Terms, Due, Status and Ref; the vendor address; lines (description or item name, Qty, Rate, Amount); Subtotal, Tax (x%) and Total, plus Paid and Balance Due once any amount is paid; Notes.
- **Search** — global search finds bills by number, vendor or amount. A hit opens the bill view.

_Key files: `app/routes/bills.py`, `app/models/bills.py`, `app/schemas/bills.py`, `app/routes/invoices/helpers.py`, `app/services/accounting.py`, `app/services/currency.py`, `app/services/closing_date.py`, `app/templates/bill_pdf.html`, `app/static/js/bills.js`_

### Purchase posting rules (bills, PO conversion, vendor credits)
- **Account resolution order** (`purchase_posting.expense_account_for` together with the inventory branch)
  1. **Stock item** (`track_inventory=true`): the item's `asset_account_id`, else the account numbered **1300**. If neither exists → 400 "Item 'X' is inventory-tracked but has no asset_account_id and no account #1300 (Inventory) is seeded…". Any account chosen on the line is ignored.
  2. **Non-stock line with an amount > 0, or with an account chosen**: the line's `account_id`, which must exist (400 "Line N (desc) names an account that isn't in the chart of accounts… Nothing was saved."); else the item's `expense_account_id`; else the vendor's `default_expense_account_id`; else **400** "Line N (desc) has no account to post to. Choose an account on the line, or give *Vendor* a default expense account in the Vendor Center. Nothing was saved." On PO conversion the hint reads "Choose an account for it when you turn the order into a bill".
  3. **Zero-amount, description-only line**: the item's or vendor's default account is stored on the line. It posts nothing and is never refused.
  - The label quotes the line description, truncated to 40 characters.
  - Before 2.18 the last resort was account 6000 (Advertising & Marketing). That fallback is removed.
- **Supplier sales tax is part of cost**
  - A document's tax (subtotal × `tax_rate`) is spread over the lines that have a positive amount, in proportion to those amounts.
  - `spread()` is exact to the cent. Every share is first cut down to whole cents; the cents left over go one each to the lines that lost the most in the cut (ties go to the larger amount, then the earlier line). The shares always add up to the tax and none is negative.
  - Each line's debit (or, on a vendor credit, its credit) is amount + share, so it lands in the expense, COGS or inventory account that line already uses.
  - Nothing ever touches **2200 Sales Tax Payable**. That account holds only tax collected on sales. Pre-2.18 bills debited it, which made Pay Sales Tax offer $0.33 where $59.57 was owed.
- **Stock unit cost includes its tax share** — `unit_cost_with_tax` = (amount + share) / qty, quantized to 4 places, falling back to `rate` when the share is 0. The inventory movement therefore carries the same value the ledger debited to Inventory.
- **Where purchase tax comes from**
  - `tax_rate` on `POST /api/bills` (API only).
  - The PO's "Tax Rate (%)", which a converted bill inherits.
  - The vendor credit's "Tax Rate (%)".
  - A scanned receipt's tax does not become a bill tax rate. The grand total becomes the line, and the tax is noted in Notes.
- **Legacy purchase tax** — the Sales Tax report finds tax that pre-2.18 bills posted to 2200 (`purchase_tax`, `purchase_tax_to_date`) and names the correcting entry. That report is in the reports router.

_Key files: `app/services/purchase_posting.py`, `app/services/accounting.py`, `app/services/inventory_service.py`, `app/routes/bills.py`, `app/routes/purchase_orders.py`, `app/routes/vendor_credits.py`_

### Bill Payments & Pay Bills
- **Pay Bills** — a modal opened from the Bills page.
  - **Pay From Account**: active bank and card accounts (`/accounts?bank=1&active_only=true`). Leaving it blank pays from **1000 Checking**, which is the server default.
  - Date*; Method (Check / ACH / Cash / Credit Card, stored as `check` / `ach` / `cash` / `credit_card`); Check #.
  - A table lists **every** open bill, all vendors and all pages (`open_only=true`), with the columns ☐, Bill #, Vendor, Due, Balance and Payment. Ticking a bill fills the Payment with its full balance. The amount can be edited for a partial payment.
  - Button: **Pay Selected Bills**.
  - There is no early-payment discount, no due-date or vendor filter, and no way to apply vendor credits here. Credits are applied from the Vendor Credits page.
- **One payment per vendor**
  - The page groups the entered amounts by vendor and posts one bill payment per vendor, in sequence. A payment to one vendor cannot pay another vendor's bill, and the server refuses it too.
  - A check number with more than one vendor selected is refused client-side: "One check number cannot pay several vendors…".
  - If one post fails after others succeeded, the toast names the vendors already paid, since each payment is its own record.
  - Success toast: "Bills paid: N payments, one per vendor".
- **Overdraw warning** (`Overdraft.confirm`)
  - Before posting, the page reads `/api/banking/overview`. If the pay-from account (or 1000 when blank) is a *bank* account whose ledger balance minus the total would go below zero, it asks "*Account* will be overdrawn by $X. Save anyway?".
  - Card accounts are never checked. A failed lookup never blocks the payment.
  - The Enter Expense form uses the same warning.
- **API create rules** (`POST /api/bill-payments`)
  - Closing date on the payment date (403). The vendor must exist (404).
  - The sum of allocations must not exceed the amount: 400 "Allocations exceed payment amount".
  - For each allocation, with the bill row locked (`SELECT … FOR UPDATE` on PostgreSQL):
    - the bill must exist (404);
    - it must be the same vendor's (400 "Bill X belongs to a different vendor.");
    - the amount must not exceed `balance_due` (400 "Allocation exceeds bill balance");
    - the currency must match (400 "…pay each currency with a separate payment");
    - an over-application guard returns 409.
  - Each bill's `amount_paid` and `balance_due` are updated. Status becomes `paid` at a zero balance, else `partial`.
- **Journal** (`source_type="bill_payment"`, described "Bill payment to *Vendor*")
  - DR 2000, relieving each allocated bill at that bill's **booked** rate plus any unallocated remainder at the payment rate.
  - CR the pay-from account for the cash, in home currency at the payment rate.
  - A residual is posted as realized FX to **6999 "Exchange Gain/Loss"**, an expense account created on demand. A credit is a gain and a debit is a loss.
  - If no pay-from account was given and no account 1000 exists, the payment is saved **without a journal entry**.
- **Prepayments** — any amount not allocated stays on the vendor as a credit.
  - It reduces the vendor balance and A/P Aging shows it as `unapplied_credits`.
  - The bill-payment view says "$X paid ahead, not applied to a bill." and the check stub lists it.
  - There is no endpoint to apply that remainder to a bill later. Customer payments have `/apply`; bill payments do not.
- **Stored fields**: vendor, date, amount, method, `check_number` (free text), `pay_from_account_id`, `notes` (API only), `currency`, `exchange_rate`, `is_voided`, `transaction_id`, and allocations `(bill_id, amount)`.
  - `BillPaymentCreate` also accepts `class_id` and `job_id`, but the model has no such columns. They are silently dropped, and responses always return null for them.
- **Listing**
  - `GET /api/bill-payments?vendor_id=&bill_id=` is newest first with no paging. `bill_id` lists the payments applied to one bill.
  - The bill view uses it to show each payment with **Print Check** and **Void**.
- **Bill-payment view** (`#/bill-payments/{id}`; the bank register links here)
  - Shows vendor, date, "Paid by", amount and status. A table lists the bills paid (Bill #, Date, Applied, **View Bill**), plus the paid-ahead note.
  - Buttons: **Print Check**, **Void**, **Close**.
- **Void** (`POST /api/bill-payments/{id}/void`)
  - The payment row is locked, so two concurrent voids cannot post duplicate reversals.
  - Refusals: 400 "Bill payment already voided"; closing date on the *payment* date (403); 400 when the payment's entry is in a completed bank reconciliation ("…cannot be voided").
  - It posts a reversing entry (`bill_payment_void`) dated the payment date.
  - It releases matched bank-statement lines back to the review queue and clears their `cleared` flags.
  - It restores each allocated bill: `unpaid` if the balance is back at the total, else `partial`. The allocation rows are kept. `is_voided=true`.
- **Check numbers** — free text only. There is no auto-numbering, no next-check tracking and no "to be printed" queue. The number appears in the bill view's "Paid by" column (for example `check #123`), in the bank register's reference column, and is used by bank-feed matching.

_Key files: `app/routes/bill_payments.py`, `app/models/bills.py`, `app/schemas/bills.py`, `app/services/currency.py`, `app/services/bank_posting.py`, `app/static/js/bills.js`, `app/static/js/expenses.js`_

### Check Printing
- **Entry points** — `GET /api/checks/print?bill_payment_id=N`.
  - The SPA offers **Print Check** on each payment row in a bill's view and on the bill-payment view. The button appears only when the payment method is `check`, is blank, or a check number is present, and never on a voided payment.
  - The API itself does not refuse a voided payment.
- **Refusals**
  - `payment_id` alone (a customer payment) → 400 "This is a payment you received, so there is no check to print. Checks print for bills you pay.", or 404 if the payment is unknown.
  - Neither parameter → 400 "Provide bill_payment_id". An unknown bill payment → 404.
- **Content**
  - Payee is the vendor name ("Unknown" if the vendor is missing). Date, amount and check number come from the payment.
  - The memo is always blank.
  - The stub lists "Bill #{number}" with the amount allocated to each bill, plus "Paid ahead (not applied to a bill)" for any unallocated remainder, so the stub adds up to the check. If there are no details it prints a single "Payment" line.
- **Layout** — a *voucher* format: one check per US Letter page.
  - Two identical stubs fill the top and middle thirds (3.33in each, dashed separators), with company name, "Check # • date", "Pay To" and "Amount", and the details table.
  - The **check itself is in the bottom third**. It carries:
    - the company name, and the address line / city, state, ZIP from Settings;
    - `#check` (top right) and DATE;
    - "PAY TO THE ORDER OF" with the payee line;
    - a boxed amount;
    - the amount in words followed by `******`;
    - a MEMO line and a signature line.
  - Courier New font, 0.25in/0.5in margins.
  - No logo, deliberately, because checks print on pre-printed stock. There is no MICR line and no bank details.
- **Amount in words** (`pdf_service._amount_to_words`)
  - Example: "One Thousand Two Hundred Thirty-Four and 56/100". Tens are hyphenated and zero reads "Zero and 00/100".
  - Units go up to "Million"; there is no "Billion". The conversion is float-based.
- **File** — served inline as `Check_{check_number}.pdf`, or `Check_.pdf` when there is no number. Each request prints one check; there is no batch printing.

_Key files: `app/routes/checks.py`, `app/services/pdf_service.py`, `app/templates/check_pdf.html`, `app/static/js/bills.js`_

### Vendor Credits
- **Page** (`#/vendor-credits`)
  - Columns are #, Vendor, Date, Ref, Status, Total, Remaining, and Actions: **Apply** (issued credits only) and **Void** (unless void).
  - Shows the newest 500 with "Show all". The API defaults to 100 per page, maximum 1,000, filtered by `vendor_id` or `status`.
  - `#/vendor-credits/{id}` opens a read-only view: lines, total, applied and remaining. Vendor credits have **no PDF**.
- **New Vendor Credit form**
  - Hint: "Enter the credit as a positive amount…".
  - Vendor* (active only), Date*, "Their credit note #" (`ref_number`), Tax Rate (%), Class.
  - Credit Lines: Item, Account (blank means "Item / vendor default"), Description, Qty, Rate (four places), Amount. Picking an item fills its cost, else its price.
  - Live Subtotal/Tax/Total and Notes.
  - Client checks: the total must be > 0, and every line with an amount needs an account, a stock item, an item with an expense account, or a vendor default.
  - The UI has no job field and no link to an original bill. The API accepts a header `job_id` and per-line `job_id`, `class_id` and `cost_code_id`.
- **Numbering** — `VC-0001`, its own series, separate from customer `CM-` memos. The number is unique. A create retries 10 times and then returns 503 "Could not assign a vendor credit number — please retry."
- **Create rules**
  - Closing date (403). The vendor must exist (404).
  - The optional `original_bill_id` must exist (404) and belong to the vendor (400). It is advisory only: the credit can still be applied to any of the vendor's bills.
  - At least one line; quantity and rate ≥ 0 (422).
  - The total must be > 0: 400 "…Enter the credit as a positive amount — the document is what makes it a credit."
  - Created with status **`issued`**. `draft` exists in the enum but is never used.
- **Accounting**
  - The journal entry is `vendor_credit`, with the vendor's credit-note number as its reference.
  - It debits **2000 A/P** for the total and credits each line's account for amount + tax share. That is the expense or COGS account from the purchase posting rules, or the inventory asset for a stock item.
  - The header class and job carry into the entry.
- **Inventory returns**
  - A stock-item line credits the inventory asset, not an expense, and writes a **RETURN_OUT** movement: −qty at the credit's own tax-inclusive unit cost, linked to the credit's entry.
  - A stock item with no asset account and no 1300 → 400.
- **Apply** (`POST /api/vendor-credits/{id}/apply {bill_id, amount}`) posts **nothing**, because A/P already moved when the credit was issued.
  - Guards: 404 credit; 400 "Vendor credit is voided"; 404 bill; 400 "That bill is voided"; 400 when the bill belongs to a different vendor; amount must be > 0, no more than the credit's remaining balance, and no more than the bill balance (400 each).
  - Both rows are locked. There is no closing-date check.
  - The credit's `amount_applied` and `balance_remaining` move, and the status becomes `applied` at 0. The bill's `amount_paid` and `balance_due` move, and its status becomes `paid` at 0, else `partial`.
  - Returns `{message, credit_balance_remaining, bill_balance_due}`.
  - The **Apply Credit** dialog lists the vendor's open bills with an Apply input each. It posts one application per bill in sequence and stops at the first error.
  - A bill's view shows credit applications only inside its Paid total. They are not listed in its Payments table.
- **Void** (`POST /api/vendor-credits/{id}/void`)
  - 400 if already void. The closing date is checked on the credit's date (403).
  - Every application is undone: bills return to `partial` or `unpaid` and the application rows are deleted.
  - It posts a reversing entry (`vendor_credit_void`) carrying every dimension.
  - Stock lines get a **VOID** movement of +qty at the line rate.
  - Applied and remaining go to 0, status `void`. An applied credit can be voided.
- **No editing and no currency fields.** Vendor credits are home currency only, and nothing prevents applying one to a foreign-currency bill.

_Key files: `app/routes/vendor_credits.py`, `app/models/vendor_credits.py`, `app/schemas/vendor_credits.py`, `app/services/numbering.py`, `app/services/purchase_posting.py`, `app/static/js/vendor_credits.js`_

### Enter Expenses
- **Purpose** — records a receipt that is already paid (by card, cash or check) in one step: debit an expense account, credit the bank or card account it was paid from. There is no bill to pay later. This is where most scanned receipts belong.
- **Page** (`#/expenses`, "Enter Expenses")
  - Columns are Date, Payee, Expense Account, Paid From, Reference, Status (`recorded` or `void`), Amount, and **View** / **Void**. Void rows are dimmed and struck through.
  - All expenses are listed, newest first, with no paging or filter. `#/expenses/{id}` opens the detail view.
  - The "Receipts to Review" dashboard card links here.
- **Enter Expense form**
  - Scan Receipt row; Vendor* (quick-add; required in the UI, optional in the API); Date*.
  - Expense Account*: active expense and COGS accounts.
  - Paid From*: accounts with a `bank_kind`, that is bank and credit-card accounts. The default is the first account whose name contains "checking".
  - Amount* (min 0.01); Reference (placeholder "Receipt / check #"); Class; Function (nonprofit); Job.
  - Cost Code, when cost codes exist. "Billable — Bill this cost to the job's customer". Memo.
  - Picking a vendor fills a blank Expense Account with the vendor's default.
- **Server rules** (`POST /api/expenses`)
  - Closing date (403). Amount must be > 0 (400 "Amount must be positive").
  - Expense account must exist (404). Paid-from account must exist (404).
  - Paid-from must be of type **asset** or **liability** (400 "Paid-from must be a bank, cash, or credit card account"). The server does not require a bank kind, so any asset or liability account passes; only the UI narrows the list.
  - The two accounts must differ (400). The vendor, if given, must exist (404).
  - The server does not restrict the expense account's type.
  - `payee` (≤200) falls back to the vendor name. `reference` ≤100.
- **Accounting**
  - One transaction, `source_type="expense"`, described "Expense: *payee*", with a reference.
  - DR the expense account (line description is the memo, else the payee; carries cost code, billable and function). CR the paid-from account.
  - Header class and job.
  - The expense **is** the Transaction row, so its id is the transaction id. The vendor id is stored in `source_id`.
- **Void** (`POST /api/expenses/{id}/void`)
  - 400 if already void. 400 if the entry is in a completed reconciliation. Closing date (403).
  - It posts a mirror entry (`expense_void`) dated the original date and releases matched bank-statement lines.
  - Status is derived from whether a void entry exists. The UI says to void and enter it again to correct it.
- **Detail modal** — date, payee, expense account, paid from, amount, reference and memo; attachments (`entity_type=expense`) with list, download, attach and delete; **Void**.
- **Limits**
  - One expense account per expense; there are no split lines.
  - No editing. No currency fields.
  - Expenses are **not** counted toward 1099 totals.
  - Card charges are a separate screen (`#/cc-charges`, "CC Charges", posting to 2100).

_Key files: `app/routes/expenses.py`, `app/schemas/expenses.py`, `app/services/bank_posting.py`, `app/static/js/expenses.js`, `app/static/js/vendors.js`_

### Items (Item List)
- **Item types** (`ItemType`; the comments map each to qbXML)
  - `service` (itService), `product` (itInventory), `material` (itNonInventory, "renamed for clarity"), `labor` (itOtherCharge, labor or hourly billing).
  - The UI offers Service, Product, Material and Labor, defaulting to Service.
  - There are no Group, Assembly, Subtotal, Payment or Sales-Tax item types. A **Discount** item exists only when a QuickBooks Online discount is imported: it is a `service` item mapped as a QBO discount and flagged `is_discount: true` in responses. Its *invoice* lines may take a negative price; bill lines may not.
  - QuickBooks 2003's parent/sub-item tree is not supported ("We skipped the hierarchy").
- **Fields**
  - `name`: trimmed, 1–200 characters.
  - `item_type`, `description`.
  - `rate`: the sell price, Numeric(17,4).
  - `cost`: a standard or last cost, Numeric(17,4). Purchases never update it; the weighted average is kept in `avg_cost`.
  - `income_account_id`, `expense_account_id`, `is_taxable` (default true), `is_active`.
  - Inventory: `track_inventory`, `quantity_on_hand`, `reorder_point` and `avg_cost` (all Numeric 14,4), and `asset_account_id`. When blank, 1300 is used at posting time.
- **Accounts**
  - The income account is used on sales lines.
  - The expense account is the item's fallback on purchase lines.
  - The asset account holds the inventory value.
  - There is **no per-item COGS account**. Every sale's COGS posts to the first COGS-type account (see Perpetual inventory).
- **Four-place prices**
  - `rate` and `cost` keep four decimals. The API writes them as "12.50" or "0.045", and the forms use step 0.0001.
  - Picking an item on Enter Bill, a PO or a vendor credit fills Rate with the item's `cost` if it is non-zero, else its `rate`.
  - The Item list, the bill and PO views, and the bill and PO PDFs display prices at 2 decimals.
- **List hygiene**
  - **Duplicate names**: two *active* items may not share a name. Names are compared trimmed, with runs of spaces collapsed and case folded in Python (Unicode-aware). A clash → **409** "There is already an item named 'X'. Use that item, give this one a different name, or make the other one inactive first."
  - A rename, or a reactivation, that would clash is refused. An edit that keeps the name is allowed, so duplicates made before this rule existed can still be edited and deactivated.
  - `DELETE` only deactivates ("Item deactivated").
  - Inactive items stay in the list, dimmed with an `inactive` badge, and stay on existing documents. They are excluded from every picker (`?active_only=true`).
  - The edit form has an **Active** checkbox, with the note "An inactive item stays on the documents that use it but is left out of every item picker."
- **Items page** (`#/items`, "Items & Services"; sidebar "Manage")
  - Columns: Name, Type (badge), Description, Rate, Cost, Qty on Hand (tracked items only), Actions. Actions are **Edit**, plus **Adjust** and **History** for tracked items.
  - Item form: Name*, Type*, Description, Rate (sell price), Cost.
    - Income Account: income accounts only; nonprofit-only accounts such as 4400 are hidden for a business; the current account is always kept.
    - Expense Account: expense and COGS accounts. Taxable. Active (edit only).
    - An **Inventory Tracking** fieldset appears only for Product and Material. It holds "Track inventory for this item", Quantity on Hand, Reorder Point, Asset Account ("Default (Inventory 1300)") and a read-only Avg Cost on edit.
- **API**
  - `GET /api/items` takes `active_only`, `item_type` and `search` (name `ILIKE`), sorted by name.
  - `POST` returns 201. `PUT` never writes `quantity_on_hand` or `avg_cost`. `ItemUpdate` has no such fields, and sending one → 422.
  - Global search finds active items by name or description; a result navigates to `#/items`.

_Key files: `app/routes/items.py`, `app/models/items.py`, `app/schemas/items.py`, `app/services/qbo_common.py`, `app/static/js/items.js`, `app/static/js/utils.js`_

### Perpetual Inventory
- **Opt-in per item** — only items with `track_inventory=true` touch the ledger. Services, labor and non-inventory items bypass it.
  - The UI offers tracking only for product and material items.
  - The API accepts `track_inventory` on any type, and it can be toggled at any time without a guard.
- **Movement ledger** (`inventory_movements`)
  - Every change to on-hand quantity appends a row: `movement_type` (`purchase`, `sale`, `adjustment`, `return_in`, `return_out`, `void`), signed `quantity` (4 decimal places), `unit_cost`, the post-movement `balance_qty` and `balance_avg_cost`, `source_type`/`source_id`, `transaction_id` and `memo`.
  - The row's `date` is the time it was **entered**, not the document date, so a backdated bill's movement shows today.
- **Weighted-average cost**
  - Only receipts re-average: when qty > 0 and the new on-hand is > 0, `new_avg = (old_qty × old_avg + qty × unit_cost) / new_qty`, rounded half-up to 4 places.
  - Sales, returns out, negative adjustments and voids leave the average alone.
  - The average resets to 0 when on-hand reaches exactly 0.
  - **Negative on-hand is allowed**, for a sale invoiced before its bill.
- **What moves stock**
  - **Bill / PO conversion**: PURCHASE, +qty at the tax-inclusive unit cost. The inventory debit is part of the bill's own entry (`record_purchase(post_journal=False)`).
  - **Bill void**: VOID, −qty at the line rate. The bill's reversing entry takes care of the ledger.
  - **Invoice**, including sales receipts, estimate conversion, duplicates, recurring invoices and the imports: SALE, −qty at the current average cost. A separate entry **DR COGS / CR the inventory asset** is dated the invoice date with `source_type="invoice"`, and is skipped when the cost is $0.
  - **Invoice edit**: a delta per item. An added quantity is recorded as a sale; a reduced quantity is reversed at the original sale's unit cost.
  - **Invoice void**: VOID, +qty at the **original** sale's unit cost, looked up by source. The entry is DR inventory / CR COGS.
  - **Customer credit memo**: RETURN_IN, +qty at the *current* average. Quantity only: no entry restores Inventory or COGS ("reserved: future COGS-reversal JE"). Voiding the credit memo writes VOID, −qty at the average, also with no entry.
  - **Vendor credit**: RETURN_OUT, −qty at the credit's tax-inclusive unit cost; the credit's own entry credits Inventory. Voiding it writes VOID, +qty at the line rate.
  - **Manual adjustment**: ADJUSTMENT, ± qty (below).
- **COGS account** — `get_cogs_account_id` picks the first account of type COGS by account number, which is 5000 in the seeded chart, falling back to #5000. The item's own expense account is not used for COGS.
- **Adjustments** (`POST /api/items/{id}/adjust {quantity_delta, unit_cost?, memo?}`)
  - Refusals: 400 "Item is not inventory-tracked"; 400 "No adjustment recorded (zero delta?)".
  - The unit cost defaults to the current average. A positive adjustment with a given unit cost re-averages.
  - Stock up: DR inventory asset / CR offset ("Inventory adjustment gain"). Stock down: DR offset ("Inventory adjustment loss") / CR inventory asset.
  - The offset is an account numbered **5900**, if one exists, otherwise the first COGS account. 5900 is not seeded, so a standard chart books adjustments to 5000.
  - The entry (`source_type="adjustment"`) is always dated **today**; the API takes no date. A zero-value adjustment moves quantity without an entry.
  - Negative results are allowed.
- **Adjust UI** ("Adjust Inventory — *item*")
  - Modes: "Add stock (receipt / found)", "Remove stock (shrinkage / spoilage)", and "Set to count (physical-count correction)".
  - A quantity field. A unit cost field, shown for Add only ("affects avg cost"). A memo.
  - A live preview of the delta and the new on-hand, and a **Post Adjustment** button.
  - Editing Quantity on Hand on an existing item's form posts an adjustment of the difference at the average cost, with the memo "Direct edit via item form".
- **Opening quantity** — Quantity on Hand typed while *creating* an item is written straight to the item. No movement row is written, no journal entry is posted, and the average cost stays 0. Later receipts average against those zero-cost units.
- **History UI** ("Inventory History — *item*")
  - It shows on-hand and the weighted average above a table with Date, Type (badge), Qty (±), Unit Cost, Bal Qty, Bal Avg and Source (`source_type #id` plus memo).
  - `GET /api/items/{id}/movements` returns the newest first; `limit` defaults to 200, from 1 to 1,000.
- **Reorder points and low stock** (`GET /api/items/low-stock`)
  - It returns tracked, active items where (`reorder_point > 0` and on-hand ≤ reorder point) **or** on-hand < 0.
  - Fields: `{id, name, quantity_on_hand, reorder_point, avg_cost, shortage}`, where `shortage` = max(0, reorder point − on-hand), sorted worst first.
- **Valuation** (`GET /api/items/valuation`) — `{total_value, item_count, low_stock_count}`, where the value is the sum of qty × average cost over tracked, active items, rounded to cents.
- **UI coverage** — nothing in the SPA calls the low-stock or valuation endpoints. The Report Center has no inventory valuation, stock-status or reorder report.
- **Not supported** — FIFO, LIFO or specific-identification costing; lots or serial numbers; locations or warehouses; units of measure; assemblies or builds; receiving items without a bill (PO partial/received is not implemented); landed-cost allocation.

_Key files: `app/services/inventory_service.py`, `app/services/inventory_hooks.py`, `app/models/items.py`, `app/routes/items.py`, `app/routes/bills.py`, `app/routes/vendor_credits.py`, `app/routes/invoices/crud.py`, `app/routes/credit_memos.py`, `app/static/js/items.js`_

### Receipt Scanning — engines, upload and intake bucket
- **Where**
  - A **📄 Scan Receipt** row sits at the top of Enter Bill and Enter Expense (and of Enter Sales Receipt, on the receivables side).
  - The file picker accepts PNG, JPEG, WebP and PDF.
  - A **🔍 Review boxes** button appears after a scan and reopens the canvas.
- **Engines** (`ocr_engines.get_engine`; everything runs locally, nothing goes to a cloud service)
  - **macOS**: Apple Vision (`VNRecognizeTextRequest`, accurate level, language correction off). It returns *line*-level boxes, with confidence × 100 and line slope taken from the corner points. It needs pyobjc Vision and Quartz, which only the frozen Mac build bundles.
  - **Windows 10/11**: `Windows.Media.Ocr` through the `winrt-*` projection (falling back to `winsdk`), using the user-profile language and word-level boxes.
    - Every WinRT call runs on **one persistent multithreaded-apartment worker thread**. This fixes a crash on the second scan in a session.
    - Async operations run on that thread's own event loop.
  - **Linux, Docker, or fallback**: the system `tesseract` binary, called by `subprocess`. It is looked up on PATH, then in the standard install locations: Program Files, Program Files (x86), LocalAppData on Windows; `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin` elsewhere.
    - It runs `tesseract stdin stdout --psm 3 -l <lang> tsv` with a 20 s timeout.
    - It is never bundled into the installers. The Docker image installs `tesseract-ocr` and `poppler-utils`.
  - **Selection**:
    - "auto" uses the platform-native engine when it is available, then Tesseract.
    - The Settings → **Receipt Scanning** → "OCR engine" select offers "Automatic (recommended) — built-in engine first" and "Prefer Tesseract (if installed)". The setting `ocr_engine` accepts only `auto` or `tesseract`, and writing it is admin-only in Server Edition.
    - The environment variable `SLOWBOOKS_OCR_ENGINE=tesseract|vision|winrt|auto`, a support tool, overrides both.
  - **Tesseract language**: an allowlist of `eng spa fra deu por ita nld`. It uses `eng` when installed, otherwise all installed allowlisted languages joined with "+". With none installed the engine reports itself unavailable.
  - **Tesseract preprocessing** (Tesseract path only):
    - Apply the EXIF rotation and convert to grayscale.
    - Upscale by a whole factor toward 1,800 px tall.
    - Autocontrast (1% cutoff), then a hard threshold at 140.
    - Word boxes are scaled back to the original image. The code comment reports this raised total-field hits from 10% to 33% on 39 SROIE receipts.
  - **Reading order for native engines**:
    - The page skew is taken as the width-weighted median of the engine's line slopes; slopes beyond 0.27 (about 15°) are ignored.
    - Word centres are sheared back to square.
    - A word joins the current row when its centre is within 60% of a line height.
    - "49 . 13" is joined to "49.13".
- **Status** (`GET /api/ocr/status`)
  - Returns `{available, version, languages, engine: tesseract|vision|winrt, pdf: windows|macos|poppler|null}`.
  - The server caches the Tesseract probe for 60 s; the page caches the status for 2 minutes.
  - When no engine is available, the Scan button is disabled with the tooltip "Tesseract OCR isn't installed — see Settings…".
  - Settings shows "*Engine* is ready (version) · languages · PDFs: built into Windows / built into macOS / via poppler-utils", or per-platform install hints.
- **PDFs** — only page 1 is scanned, at **300 DPI**.
  - Renderers are tried in the order `Windows.Data.Pdf` (WinRT), macOS Quartz (`CGPDFDocument`), then poppler (`pdftoppm`/`pdfinfo`). A renderer that fails on a file hands over to the next.
  - With no renderer the response is 400 with a per-platform fix (for example `winget install oschwartz10612.Poppler`, `brew install poppler`, `apt install poppler-utils`).
  - A multi-page PDF sets `multi_page`, and the summary adds "First page scanned."
- **Upload rules** (`POST /api/ocr/receipt`, multipart field `file`)
  - Size ≤ **20 MB** (413).
  - MIME type `image/png|jpeg|webp` or `application/pdf`, and extension `.png/.jpg/.jpeg/.webp/.pdf` (400 otherwise).
  - Rate limit **30/minute** per IP.
  - Engine unavailable → **200** `{ocr_available:false, message}`, which the page shows.
  - Engine failure → 400 "Could not read the image — is it a valid receipt scan? (…)".
  - The scan runs synchronously within the request.
  - The response echoes `raw_text`, truncated to 4,000 characters, along with the word boxes, language and engine.
- **Intake bucket** — a scan waits here until the document is saved.
  - It is stored in the **company's own database** (`stored_files`, kind `receipt_scan`) under a random 32-hex id. This replaced an older intake folder that every company shared.
  - TTL is **24 h**. Caps are **500 scans / 1 GB**, evicting the oldest first. The sweep runs on each new scan, and an expired scan is deleted when it is read.
  - `GET /api/ocr/intake/{id}/image` serves the stored image; a PDF is served as a PNG of page 1.
  - `DELETE` discards a scan. It is idempotent and the form's Cancel button calls it.
- **Attach on save**
  - After the Bill or Expense saves, `POST /api/ocr/intake/{id}/attach {entity_type, entity_id}` turns the stored scan into an **Attachment** in place, without copying the bytes.
  - `entity_type` must be `invoice`, `bill` or `expense` (400 otherwise); a sales receipt attaches as `invoice`. The entity must exist (404). The filename is sanitized.
  - If attaching fails, the toast reads "Saved, but the scan image couldn't be attached — add it manually."
- **Dashboard card "Receipts to Review"** ("Scanned receipts waiting to be turned into a bill or expense"; optional)
  - Shows the count and up to 8 pending scans with the hours left, and links to "Enter Expenses →".
  - A pending scan cannot be reopened from the card.

_Key files: `app/routes/ocr.py`, `app/services/ocr_engines.py`, `app/services/ocr_service.py`, `app/services/pdf_raster.py`, `app/services/file_store.py`, `app/models/stored_files.py`, `app/schemas/ocr.py`, `app/static/js/ocr.js`, `app/static/js/settings.js`, `packaging/windows/requirements-ocr.txt`, `packaging/macos/requirements-build.txt`_

### Receipt Scanning — deterministic parsing
- **No AI**
  - Extraction is regex and anchor rules over the text (`ocr_service.extract_receipt`).
  - The response carries `merchant{value,confidence}`, `date`, `date_is_default`, `total`, `total_confidence` (high/low/missing), `subtotal`, `tax`, `tax_detected`, `reference`, `partial` and `partial_reasons`.
- **Amounts**
  - An amount is an optional `$`, thousands separators, and **exactly two decimals**.
  - It must not be followed by another digit or by `%`. That keeps "7.000 %" and "(7.25%)" tax-rate lines from reading as money.
- **Total** (`parse_total`)
  - **Anchors**: "total" as OCR actually renders it (tatal, totel, tota!, t0tal), "grand total", "amount due", "balance due".
  - **Strong anchors** win outright, taking the *last* one: grand total, incl./inclusive/including, amount due, balance due, total due, total payable, amount payable, net total.
  - **Excluded lines** (unless they also carry a strong anchor): excl…, before tax, pre-tax, sub-total, total GST/VAT/HST/PST/tax/sales tax, total qty or items/units/pcs/pieces/savings/discount, tax code, "tax (".
  - Otherwise the result is the last plain TOTAL line, preferring a line with a single amount.
  - Zero amounts are skipped, so "Balance Due 0.00" after payment is ignored.
  - The amount may sit on the next amount-only line, up to 2 lines ahead.
  - On anchor lines, a lenient pattern accepts a broken decimal ("7 00", "140. 00").
  - With no anchor, the largest amount on the receipt is used at `low` confidence.
- **Tax and subtotal** (`parse_tax`)
  - **Tax anchors**: tax, GST, VAT, HST, PST, QST, optionally preceded by "total".
  - **Skipped**: tax included/free/exempt, no tax, tax invoice/receipt/code/summary/id/reg/no, GST id/reg/no/summary/TIN, VAT reg/no/number/id, column headers (qty, price, description, "amount ("), and inclusive or exclusive total lines.
  - The **smallest** amount on a tax line is the tax, since tax is always smaller than its base.
  - **Subtotal**: "subtotal" / "sub total" / "sub-total", or "Total … (excl / before tax / pre-tax)".
  - When the total equals the subtotal and a tax was found, the total becomes subtotal + tax at `low` confidence.
- **Date** (`parse_date`)
  - Takes the first date on a line that is not about returns, refunds or exchanges, "on or after/before", valid thru/until, expiry, offer, coupon, survey, sweepstakes or promotion.
  - **Numeric triplets** with one consistent separator (`-`, `/` or `.`): `YYYY-MM-DD`; otherwise **US MM/DD first**, falling back to day-first when the US reading is impossible. Two-digit years add 2000.
  - **Month names**: "Aug 14, 2026", "14 Aug 2026", "28 Mar 18", "05-JAN-2017".
  - Years must fall between 1900 and 2100.
  - With no date found the route uses today, sets `date_is_default`, and adds the reason "date not found — today's date used".
- **Merchant** (`parse_merchant`)
  - The first line with at least two words, no amount, no d/m/y date and no phone number, that is not purely numeric, and that "looks like words": at least 5 letters, at least 70% letters, at least 2 tokens with 2 or more letters. This rejects logo noise.
  - Truncated to 60 characters. Confidence is `high` when it is the first line, else `low`.
- **Reference / invoice number** (`parse_reference`), filled into Bill Number or the expense Reference
  - Walmart's `TC#` (spaced digit groups) wins first.
  - Otherwise a labelled number: invoice, inv, receipt, rcpt, reference, ref, bill, order, ticket, transaction, trans, txn, doc, document, check, chk or slip, optionally followed by no/num/number/id/#.
  - A label is skipped when it follows reg, GST, VAT, TIN, SSM, tax id, tel, phone, fax, table, pax, terminal, cashier, company, co no, ROC, POS id, card, acct or account.
  - "REF" is ignored when it sits within 2 lines of a card-terminal block (APPR CODE, AUTH…, NETWORK ID, TERMINAL #, AID:, MID:, TID:, ENTRY METHOD, CHIP READ).
  - The token must contain a digit, be at least 2 characters, and not be a date. It is truncated to 40 characters.
- **Partial flags**
  - The reasons are "total not detected", "total is low-confidence — verify the amount", "merchant not detected", and "date not found — today's date used".
  - A partial scan opens the canvas automatically.
  - The summary line reads "Scan complete — review before saving.", "Saved layout for this merchant filled the fields — review before saving.", or "Partial: …".
- **Not extracted** — itemized line items, payment method, currency (parsing is `$`-anchored), and sale-versus-expense direction. The scan fills whichever form is open.

_Key files: `app/services/ocr_service.py`, `app/services/ocr_regions.py`, `app/routes/ocr.py`_

### Receipt Scanning — form pre-fill, box-to-fix canvas and merchant layout memory
- **Enter Bill pre-fill** (`BillsPage._applyScan`)
  - Date. Reference → Bill Number, only if that field is empty.
  - Merchant → an exact, case-insensitive vendor match, which also applies the vendor's terms and default account. Otherwise quick-add opens with the name, and the status line reads "Detected: X — new vendor; it's added when you save (or pick one from the list)."
  - Total → the **first line's Rate** as the grand total, with the line description set to the merchant.
  - Tax → a "Tax detected: $X" line in Notes. The bill tax rate is never set.
  - On the canvas, a box re-read as **Subtotal** also writes into the first line's Rate, the same input as Total.
- **Enter Expense pre-fill** — Date; Reference (if empty); merchant → vendor match or quick-add; total → Amount (tax included); tax → a "Tax: $X" line in the Memo. A canvas re-read of Subtotal or Tax replaces its own "Subtotal: $X" or "Tax: $X" memo line.
- **Enter Sales Receipt** (receivables side) — when both subtotal and tax were found, it sets line = subtotal and fills the tax-rate field.
- **Canvas** (the "Review scan" panel inside the form; vanilla JavaScript, 2D canvas)
  - It shows the scanned image with faint word boxes.
  - Coloured boxes mark what the parse found, one colour per field:
    - Total: green
    - Tax: orange
    - Subtotal: blue
    - Date: violet
    - Merchant / Name: pink
    - Invoice / Ref #: teal
  - Boxes are placed by matching the parsed values back to words. An amount goes to the lowest match on a line with a relevant label; a date goes to the word whose three numbers are the parsed y/m/d; a merchant gets the shortest same-line run of words that spells the name; a reference must match exactly or as a suffix.
  - While the canvas is open, each form input the fields feed wears that field's colour as an outline, so the form doubles as the legend. When two fields feed one input, it gets a double ring.
- **Correcting a box**
  - Two orders work: *box-first* (drag an amber box, then tap a field button below the canvas) or *arm-first* (tap a field, then drag).
  - Clicking an existing box re-reads it or reassigns it ("Was X — check that field.").
  - Also: "✕ Clear box" and Close. Mouse events only; there is no touch or pointer support.
  - A box is sent in the image's natural pixel coordinates. The canvas fits the width (minimum 320 px) and scrolls within `min(420px, 55vh)`.
- **Region read** (`POST /api/ocr/intake/{id}/region {left, top, width, height, field_type, merchant?, field_key?, save_template?}`)
  - Rate limit 60/minute.
  - Field types: amount, date, merchant, reference, text. Anything else → 400.
  - The crop is clamped to the image and must be at least 4 px. It is upscaled 3× (LANCZOS) and autocontrasted.
  - For Tesseract the crop is also binarized at 140 and read with a per-field page mode and character whitelist:

    | Field | Page mode | Whitelist |
    |---|---|---|
    | amount | PSM 7 | `0123456789.,$` |
    | date | PSM 7 | digits, `/-.,:`, AM/PM and the letters of the month names |
    | reference | PSM 7 | none |
    | merchant, text | PSM 6 | none |

  - Native engines read the grayscale crop with no whitelist.
- **Normalization and refusals**
  - Amount: a single amount is `high`; more than one is refused with the confidence `multiple` ("That box covers more than one number…"); a bare digit run is `low`.
  - Date: an ISO date or nothing, never the raw text.
  - Reference: the labelled parse, else the first token containing a digit.
  - Merchant and text: the first 80 characters.
  - A refused read leaves no box behind. Low confidence adds "(low confidence — double-check)".
- **Merchant layout memory** ("remembers your receipt layouts"; anchor matching, not machine learning)
  - **When a layout is learned**: a successful region read with `save_template` set. The SPA sets it whenever the merchant is known or the field is the merchant.
    - The server re-OCRs the full page to get word boxes, then stores the box *relative to an anchor word*.
    - The anchor is a same-line alphabetic label (at least 3 letters) to the box's left, preferring words that appear only once on the page. Otherwise it is the topmost alphabetic word.
    - The offsets are `dx`, `dy`, `w` and `h`, in units of the anchor's height. A repeated anchor also stores its ordinal and the count.
  - **Storage**: one `ocr_templates` row per normalized merchant key. The key is upper-cased, punctuation stripped, store numbers such as `#4521` removed, and capped at 200 input characters.
    - Merchants match exactly, or when one key is a word-prefix (at least 2 words) of the other.
  - **When a layout is applied** (on each scan): the template is found by the extracted merchant, else by the first 4 lines of the text.
    - Each remembered box is resolved against the new words. A repeated anchor is trusted only when it repeats the same number of times; otherwise the field fails closed.
    - Each resolved box is region-read. Amount, date and reference reads must be `high` confidence or they are dropped.
    - The reads override total, subtotal, tax, date, reference and merchant, and `use_count` increases.
    - When total, tax and subtotal are all read cleanly and subtotal + tax equals the total within $0.02, `template_applied` is true, the partial reasons are cleared, and the canvas does not open.
  - There is no UI or API to list, edit or delete saved layouts. Any miss falls back to the ordinary parse plus the canvas.

_Key files: `app/static/js/ocr_canvas.js`, `app/static/js/ocr.js`, `app/static/js/bills.js`, `app/static/js/expenses.js`, `app/services/ocr_regions.py`, `app/services/ocr_templates.py`, `app/services/ocr_template_store.py`, `app/models/ocr_templates.py`_

### 1099-NEC / 1096 Vendor Forms
- **Who is a 1099 vendor**
  - `is_1099_vendor=true` (the vendor form's "1099 Vendor: Yes") or the legacy `is_1099_eligible=true`.
  - The 1099 type is NEC, MISC, INT or DIV in the UI. The API accepts any string of up to 10 characters.
  - The type is cleared on create and update whenever the vendor is not a 1099 vendor.
  - The 1099-NEC takes vendors whose type is `NEC` (compared upper-case) **or blank**. MISC, INT and DIV vendors are excluded.
  - Inactive vendors are still included.
- **Amount**
  - The sum of `BillPayment.amount` for payments dated in the calendar year, per vendor. This includes any unapplied prepayment.
  - Payments are **not filtered on `is_voided`**.
  - Enter Expenses, card charges and journal entries are not counted. Payment method is not considered.
- **Threshold** — `NEC_THRESHOLD = $600.00`, fixed in the code with no dependence on the tax year. A vendor with `total_paid ≥ 600` is `reportable`.
- **Data** (`GET /api/tax-forms/1099?year=YYYY`; `year` is required, 422 without it)
  - Returns `{year, transmittal: {year, form_count, total_amount}, vendors: [...]}`.
  - Each vendor is `{vendor_id, name, company, address, tax_id, total_paid, reportable, w9_on_file, year}`. Every NEC vendor appears, including those paid $0.
  - `address` joins address1, address2, and "City, ST ZIP".
- **1099-NEC PDF** (`GET /api/tax-forms/1099/{vendor_id}/pdf?year=`)
  - A simplified facsimile in Courier, not the IRS scannable red-ink Copy A.
  - Payer: name, first address line and TIN/EIN, from Settings (`company_name`, `company_address1`, `company_tax_id`, falling back to config). City, state and ZIP do not print.
  - Recipient: name, company, address, and TIN, printed as `MISSING` when blank.
  - Only **Box 1 — Nonemployee Compensation** is filled. Boxes 4–7 (withholding, state) are absent.
  - The footer reads "REPORTABLE (meets $600 threshold)" or "below $600 threshold — informational only", and "W-9 on file: Yes/No".
  - A non-NEC or missing vendor → 404 "Vendor N is not 1099-eligible or does not exist".
  - Served inline as `1099-NEC_{year}_{Vendor-Name}.pdf`.
- **1096 PDF** (`GET /api/tax-forms/1096/pdf?year=`)
  - Filer name, address and TIN. **Box 3** is the number of reportable 1099-NEC forms and **Box 5** is their total.
  - A recipient table (name, TIN or MISSING, Box 1 amount), or "No reportable 1099-NEC forms for YYYY."
  - Footer: "Transmittal covers 1099-NEC forms only…". Served as `1096_{year}.pdf`.
- **UI** — Payroll & HR → **Tax Forms** (`#/hr/tax-forms`), card "1099-NEC / 1096 (Contractors)"
  - Year input; changing it reloads the vendor list.
  - Vendor dropdown: "*Name* — $total", marked "(under $600)" when below the threshold, or "No 1099-NEC vendors: mark vendors '1099 Vendor: Yes' on the Vendors page" when there are none.
  - **Generate 1099-NEC** and **Generate 1096 (Transmittal)** open the PDF in a new tab, or in the native viewer in the desktop app.
  - A caution note: "Tax forms are for reference. Verify calculations with a licensed tax professional before filing."
- **Access** — everything under `/api/tax-forms` is **admin-only** in Server Edition RBAC, for every method, so bookkeepers and read-only users cannot open 1099s.
- **1099 Summary report** (Report Center card "1099 Summary"; `GET /api/reports/1099-summary?year=`, in the reports router; `year` defaults to the current year)
  - Lists every 1099 vendor *of any type*, with tax ID, type, total paid and a REPORT flag at ≥ $600.
  - Its totals come from **bill-payment allocations**, which excludes unapplied prepayments but, like the forms, does not exclude voided payments.
  - It shows the grand total and the number of vendors above the threshold.
- **W-9 tracking** — `w9_on_file` and `w9_document_id` exist on the model, but no API or UI can set them, so the forms always print "W-9 on file: No".

_Key files: `app/services/form_1099.py`, `app/routes/tax_forms.py`, `app/templates/form_1099nec.html`, `app/templates/form_1096.html`, `app/services/payroll_documents.py`, `app/static/js/tax_forms.js`, `app/routes/reports/payables_tax.py`, `app/static/js/reports.js`_

### Related reports, dashboard cards and cross-cutting rules
- **A/P Aging** (Report Center; `GET /api/reports/ap-aging`, in the reports router)
  - Covers open unpaid and partial bills in home currency.
  - Each bill is aged from its due date, or from its date plus terms when there is no due date, into Current / 1–30 / 31–60 / 61–90+.
  - Unapplied vendor credits and unapplied bill-payment money are netted out of Current and shown as `unapplied_credits`, so the total equals account 2000.
- **Dashboard cards**
  - "Total Payables" (in the default layout): open bill balances and the overdue count.
  - "Cash Position": payables due within 30 days are subtracted in the forecast.
  - Optional: "Open Purchase Orders", "Receipts to Review", and "Jobs: Budget vs Actual" (with a Committed column).
- **Nav and shortcuts**
  - The sidebar section "Vendors & Payables" holds Vendors, Purchase Orders, Bills, Vendor Credits, Job Costs and Expenses. Items & Services is under "Manage"; Tax Forms is under "Payroll & HR".
  - Ctrl+S submits whichever form is open in a modal (Enter Bill, Pay Bills, PO, Vendor, Item, Expense, Vendor Credit, Adjust). Esc closes the modal. Ctrl+K or `/` focuses global search.
  - The top toolbar has no purchasing buttons.
- **Job costing and nonprofit dimensions**
  - Bills carry a header class and job, plus per-line job, class, cost code, billable flag and nonprofit function (program, management, fundraising, or "Unassigned").
  - POs carry a header job, plus a per-line job and cost code.
  - Expenses carry class, job, cost code, billable flag and function.
  - The billable flag is recorded on the journal lines and shown as a "billable" badge in job drill-downs. `BillLine.billed_invoice_line_id` exists, but nothing writes it: billable costs are not pulled onto invoices.
- **Multi-currency**
  - Bills and bill payments carry `currency` and `exchange_rate`. A home-currency document gets rate 1; a foreign one uses the rate given, else the Bank of Canada feed, else 400.
  - Pay Bills sends no currency, so a foreign-currency bill can only be paid through the API, by a payment in its own currency.
  - POs, vendor credits and expenses are home currency only.
- **Closing date** — creating a bill, payment, vendor credit or expense checks the document date. A void checks the original document's date, and PO conversion checks the PO date. A refusal is **403**, with an override password sent in the `X-Closing-Date-Password` header. Five wrong passwords lock the override for 10 minutes. The SPA prompts for the password and retries.
- **Control accounts** — account 2000 is resolved by number. If it is missing, the posting is refused with **409** naming it, and nothing is saved. Accounts 1300, 1000 and 5900 are looked up by number more tolerantly, as described above.
- **Roles (Server Edition)** — bookkeepers can perform every purchasing write. Read-only users are limited to GET. `/api/tax-forms` is admin-only, and `/api/settings` writes (including the OCR engine) are admin-only.
- **Audit** — every create, update and delete on these tables is captured by the SQLAlchemy audit hooks.
- **Assistant (AI) read tools** — `search_bills`, `search_bill_payments`, `list_vendors`, `get_expenses_by_category`.

_Key files: `app/routes/reports/payables_tax.py`, `app/services/dashboard_widgets.py`, `app/static/js/dashboard.js`, `app/main.py`, `app/services/control_accounts.py`, `app/services/closing_date.py`, `index.html`, `app/static/js/app.js`_

### API endpoints
| Method | Path | What it does |
|---|---|---|
| GET | /api/vendors | List vendors with computed balances; `active_only`, `search` (name ILIKE); sorted by name |
| GET | /api/vendors/check-duplicate | Fuzzy duplicate check (`name`, ≥0.85 similarity) against active vendors |
| GET | /api/vendors/{vendor_id} | One vendor with its balance |
| POST | /api/vendors | Create a vendor; 409 `possible_duplicate` unless `?force=true`; clears a 1099 type on a non-1099 vendor |
| PUT | /api/vendors/{vendor_id} | Update any field incl. `is_active`; clears a 1099 type on a non-1099 vendor |
| DELETE | /api/vendors/{vendor_id} | Deactivate (soft delete) |
| GET | /api/purchase-orders | List POs; `vendor_id`, `status`, `skip`, `limit` (500/1000) |
| GET | /api/purchase-orders/{po_id} | One PO with lines |
| POST | /api/purchase-orders | Create a PO (numbered PO-0001…, status draft) |
| PUT | /api/purchase-orders/{po_id} | Update header, status and/or replace lines (re-totals) |
| GET | /api/purchase-orders/{po_id}/pdf | PO PDF (inline) |
| GET | /api/purchase-orders/{po_id}/print-preview | PO HTML that opens the print dialog |
| POST | /api/purchase-orders/{po_id}/convert-to-bill | Turn the PO into a posted bill (optional `lines:[{line_id,account_id}]`); closes the PO |
| GET | /api/bills | List bills; `vendor_id`, `status`, `open_only`, `skip`, `limit` (500/1000) |
| GET | /api/bills/{bill_id} | One bill with lines |
| GET | /api/bills/{bill_id}/pdf | Bill PDF (inline) |
| GET | /api/bills/{bill_id}/print-preview | Bill HTML that opens the print dialog |
| POST | /api/bills | Enter a bill: numbering fallback, per-vendor duplicate check, terms/due date, JE DR lines (+tax share) / CR 2000, inventory receipts |
| POST | /api/bills/{bill_id}/void | Void an unpaid bill: reversing JE and inventory VOID movements |
| GET | /api/bill-payments | List bill payments; `vendor_id`, `bill_id` |
| GET | /api/bill-payments/{bill_payment_id} | One bill payment with allocations |
| POST | /api/bill-payments | Pay one vendor's bills: allocations, JE DR 2000 / CR bank, realized FX to 6999 |
| POST | /api/bill-payments/{bill_payment_id}/void | Void a payment: reversing JE, bills reopened, statement links released |
| GET | /api/checks/print | Voucher check PDF for `bill_payment_id` (a customer `payment_id` → 400) |
| GET | /api/vendor-credits | List vendor credits; `vendor_id`, `status`, `skip`, `limit` (100/1000) |
| GET | /api/vendor-credits/{vc_id} | One vendor credit with lines |
| POST | /api/vendor-credits | Issue a credit (VC-0001…): JE DR 2000 / CR lines; RETURN_OUT for stock |
| POST | /api/vendor-credits/{vc_id}/apply | Apply part of a credit to a bill (posts nothing) |
| POST | /api/vendor-credits/{vc_id}/void | Void: unwind applications, reversing JE, restock |
| GET | /api/expenses | List expenses (transactions with source_type `expense`), with void status |
| GET | /api/expenses/{expense_id} | One expense (id = transaction id) |
| POST | /api/expenses | Record a paid expense: DR expense, CR bank/card |
| POST | /api/expenses/{expense_id}/void | Post the mirror entry; release statement links |
| GET | /api/items | List items; `active_only`, `item_type`, `search`; `is_discount` flag |
| GET | /api/items/low-stock | Tracked active items at/below reorder point or below zero, worst shortage first |
| GET | /api/items/valuation | `{total_value, item_count, low_stock_count}` over tracked active items |
| GET | /api/items/{item_id} | One item |
| GET | /api/items/{item_id}/movements | Inventory ledger for an item, newest first (`limit` 1–1000, default 200) |
| POST | /api/items/{item_id}/adjust | Manual quantity adjustment with JE to 5900-or-COGS |
| POST | /api/items | Create an item (409 on a duplicate active name) |
| PUT | /api/items/{item_id} | Update an item (rename/reactivate duplicate check; never edits qty or avg cost) |
| DELETE | /api/items/{item_id} | Deactivate an item |
| GET | /api/ocr/status | Active OCR engine, version, languages, PDF renderer |
| POST | /api/ocr/receipt | Scan an image/PDF (≤20 MB, 30/min): parsed fields, word boxes, intake id, template reads |
| POST | /api/ocr/intake/{intake_id}/attach | Turn a pending scan into an attachment on an invoice, bill or expense |
| GET | /api/ocr/intake/{intake_id}/image | The pending scan as an image (PDF page 1 → PNG) |
| POST | /api/ocr/intake/{intake_id}/region | OCR one typed box (60/min); optionally teach the merchant template |
| DELETE | /api/ocr/intake/{intake_id} | Discard a pending scan (idempotent) |
| GET | /api/tax-forms/1099 | 1099-NEC data for all NEC vendors plus the 1096 transmittal summary (`year`) |
| GET | /api/tax-forms/1099/{vendor_id}/pdf | 1099-NEC PDF for one vendor (`year`) |
| GET | /api/tax-forms/1096/pdf | 1096 transmittal PDF (`year`) |
| GET | /api/reports/1099-summary | (reports router) 1099 vendors of every type with totals from allocations |

### Notes, gaps & discrepancies
- **Docs vs code: bills**
  - `docs/features.md` lists `/api/bills` as "GET, POST, PUT" and describes a "status progression (draft/unpaid/partial/paid/void)". No PUT route exists (`BillUpdate` is dead code), and nothing ever creates a `draft` bill.
  - The per-vendor duplicate-number check also matches **voided** bills. The docs' void-and-re-enter correction path therefore needs a different bill number.
- **Docs vs code: checks** — `docs/features.md` and the `checks.py` docstring say "standard 3-per-page format". The template is a one-check-per-page voucher: two stubs, with the check in the bottom third. There is no MICR line.
- **Docs vs code: tax-form audit hashes** — `docs/features.md` says the tax-form PDFs, 1099-NEC and 1096 included, carry "tamper-evident audit hashes". Only the payroll routes (`/api/payroll/forms/…`) write `document_audits` rows. `form_1099nec.html` and `form_1096.html` have no audit footer.
- **Docs vs code: account 5900** — `control_accounts.py` says 5900 Inventory Adjustments is "created on demand". Nothing creates it. Without it, adjustments post to the first COGS account (5000).
- **Stale docstrings**
  - The `inventory_service.py` header describes a separate inventory JE on purchases. Bills actually include the inventory debit in their own JE.
  - The `/adjust` docstring calls its entry "one-sided". It is a balanced two-line entry.
- **1099 totals**
  - The 1099-NEC and 1096 sum raw `BillPayment.amount` with no `is_voided` filter, so voided payments still count. Unapplied prepayments count too.
  - The 1099 Summary report sums allocations instead, also without a void filter, and it lists every 1099 type. Its comment claims "the same rule as the 1099-NEC", yet the two can disagree.
  - Payments made through Enter Expenses or card charges never reach any 1099.
  - The $600 threshold is fixed in code. Payer city, state and ZIP are not printed. W-9 status can never be set.
- **Purchase orders**
  - The PO statuses `sent`, `partial` and `received`, and `received_qty`, are never set by the SPA. Committed cost and the "Open Purchase Orders" card only count POs whose status was changed through `PUT`, so from the UI both show $0 and 0.
  - PO conversion is all-or-nothing, dated the **PO date** (so a PO in a closed period cannot be converted), with a `BILL-PO-…` number and no duplicate check.
- **Multi-currency and inventory** — on a foreign-currency bill with stock lines, the inventory movement's unit cost is in the bill's currency. It is never converted to home currency, although the GL debit is, so the average cost and COGS mix currencies. Vendor credits have no currency and can be applied to foreign bills.
- **Silent or approximate paths**
  - A bill payment with no Pay From account in a chart without an account numbered 1000 is saved **without a journal entry**.
  - `BillPaymentCreate.class_id` and `job_id` are accepted but discarded.
  - An unapplied bill-payment remainder can never be applied to a later bill.
  - Customer credit-memo returns restock at the average cost with no Inventory/COGS entry, so account 1300 falls behind the stock valuation.
  - An item's opening quantity, entered on creation, posts no movement, no entry and no cost, which drags later weighted averages down.
  - Adjustments are always dated today.
  - Movement rows are stamped with the entry time, not the document date.
  - Void movements are costed at the line rate, which excludes the tax share.
- **Inconsistent low-stock counts** — `/low-stock` includes items with negative on-hand even when they have no reorder point. The `low_stock_count` in `/valuation` does not. Neither endpoint has a caller in the SPA.
- **Display rounding** — the bill and PO PDFs and the bill, PO and item views all show unit prices through a 2-decimal currency formatter, so four-place prices are stored but display rounded. The PDFs use a float-based formatter, so $0.045 prints as $0.04. Bill and PO PDFs never print a foreign-currency code.
- **Receipt-intake docs are stale**
  - `receipt-intake.md` still says "Status: DESIGN… Nothing here is committed product behavior yet".
  - `receipt-intake-spec.md` describes things the code does differently:

    | Spec says | Code does |
    |---|---|
    | Intake files live on the filesystem (`uploads/intake`) | Stored in the company database (`stored_files`) |
    | PDFs rasterize at 200 DPI | 300 DPI |
    | Dates parse with python-dateutil | Custom regex parsing |
    | Status languages are intersected with the allowlist | All installed languages are returned |
    | Bill # is "never inferable" | It is read from the receipt, and generated when blank |
    | The scan should "never auto-create" a vendor | Quick-add creates the vendor on save |
    | Attach accepts invoice or bill | Attach also accepts `expense` |
    | No Pillow | Pillow is used for preprocessing and crops |

  - The design doc's Tier 1 vendor order-history importers, "fuzzy-match; confirm 'same as Home Depot?' once", Otsu/adaptive thresholding and the BYOK AI enhancement are not implemented. The code uses a fixed threshold of 140 after autocontrast.
- **Stale UI copy** — Settings says the Scan Receipt button is on "Enter Sales Receipt and Enter Bill" only; it is also on Enter Expense. The disabled Scan button always says "Tesseract OCR isn't installed", even on Windows and macOS where the native engine is the expected one.
- **Pending-scan lifecycle (from reading the code)**
  - Only the Cancel button discards a pending scan. Closing the modal with Esc or the overlay leaves it in the intake until the 24 h TTL, visible under "Receipts to Review".
  - `ScanHelper._intakeId` is module state that `wire()` does not reset, so a later save of any scan-enabled form could attach the stale scan.
  - Pending scans cannot be resumed.
  - Templates cannot be managed.
  - The canvas has no touch support.
- **Hardware testing** — the `ocr_engines.py` comment calls the Vision and WinRT adapters "hardware-verify-pending" (Linux CI cannot run them). WinRT is noted as hardware-validated on Windows 11 on 2026-09-02, and the CHANGELOG records macOS hardware passes.
- **Missing QuickBooks-style AP features**
  - No bill editing; no memorized or recurring bills; no early-payment discounts; no batch check printing or to-be-printed queue.
  - No "Receive Items" and no partial PO receiving.
  - No purchases-by-vendor/item, unpaid-bills-detail, open-PO or inventory valuation/stock-status reports.
  - No vendor detail or transactions view.
  - No vendor credit PDF.
  - No per-item COGS account.

---

_[← 1. Sales & Accounts Receivable](01-sales-accounts-receivable.md) · [Index](README.md) · [3. General Ledger, Chart of Accounts & Banking →](03-general-ledger-banking.md)_
