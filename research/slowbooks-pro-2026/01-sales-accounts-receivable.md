_SlowBooks Pro 2026 feature inventory — [Index](README.md) · [2. Purchasing, Accounts Payable, Items & Inventory →](02-purchasing-payables-inventory.md)_

## 1. Sales & Accounts Receivable

The A/R side follows QuickBooks 2003 Pro's "Customers & Sales" workflow: a Customer Center, estimates that convert to invoices, invoices and one-step sales receipts, Receive Payments with multi-invoice allocation and held customer credits, credit memos and write-offs, batch payments, recurring schedules, statements and collection letters, and hosted online checkout through Stripe, PayPal or Square behind one provider abstraction. Every posting document writes a balanced journal entry against the control accounts 1100 Accounts Receivable, 2200 Sales Tax Payable and 1200 Undeposited Funds plus item income accounts (default 4000 Service Income), converted to the home currency at the document's booked rate. Customer balances are never stored — they are summed live from open invoices, unapplied credit memos and unapplied payments. Most guard rails (closing date, $0.00 confirmation, same-customer and same-currency rules, deposit/reconciliation locks) are enforced server-side; the credit-limit warning and oldest-first auto-apply are SPA conveniences only.

### Customers & the Customer Center

- **Customer record** — one `customers` row per customer (QuickBooks "name list" style; the Customer:Job colon hierarchy is not used — jobs are a separate table).
  - Fields: `name` (required, whitespace-stripped, 1–200 chars), `company`, `email`, `phone`, `mobile`, `fax`, `website`, `bill_address1/2`, `bill_city`, `bill_state`, `bill_zip`, `bill_country` (default `US`), the same six `ship_*` fields, `terms`, `credit_limit`, `tax_id`, `is_taxable` (default true), `notes`, `is_active` (default true), `created_at`/`updated_at`.
  - Nonprofit donor fields: `donor_type` (`individual` | `organization`), `salutation` (opens acknowledgment letters), `send_year_end_statement` (default true).
  - Email is a loose shape check (`x@y.z`, max 200); a blank string is stored as null instead of failing validation.
  - Max lengths mirror the VARCHAR widths (200 name/company/email/website/address lines, 100 city, 50 state/phone/mobile/fax/terms/tax_id, 20 zip, 100 country) and are validated at the edge so PostgreSQL and SQLite both answer 422 rather than a 500 or a silently oversized value.
  - Unknown JSON keys are refused with 422 (`StrictModel`, `extra="forbid"`) — true of every JSON request body in this domain (provider webhooks read the raw payload instead).
- **Default terms** — a new customer with blank `terms` gets Settings → `default_terms` (default `Net 30`); the New Customer form preselects the same value.
  - UI terms choices: Net 15, Net 30, Net 45, Net 60, Due on Receipt (a non-standard stored value is added to the list so it isn't lost).
- **Credit limit** — optional; a negative value is refused (422 "A credit limit can't be negative. Leave it blank for no limit."); blank = no limit; clearing it on edit sends `null`. Only a client-side warning uses it (see Invoices).
- **Tax exempt** — the form's "Tax exempt: no sales tax on anything sold to them (a reseller, a church, a school)" box is the inverse of `is_taxable`; an exempt customer pays no tax on any line of any document (enforced server-side).
- **Active / inactive** — `DELETE /api/customers/{id}` never deletes; it sets `is_active=false` and returns "Customer deactivated". The edit form has an Active checkbox. Inactive customers are left out of every picker (`?active_only=true`) but still listed, greyed and marked "(inactive)", in the Customer Center.
- **Not supported on customers** — no customer currency, price levels, customer types, sales reps or per-customer tax codes/rates; currency is chosen per document.
- **Customer Center list (`#/customers`)** — all customers (Name, Company, Phone, Email, computed Balance, Edit), a client-side name filter box, "+ New Customer". The API list supports `active_only` and `search` (case-insensitive substring on name only), ordered by name.
- **Customer detail modal** (row click) — one screen, no tabs:
  - Header: name, company, Active/Inactive, terms, "Tax exempt", credit limit, tax ID; Balance (label switches to "Credit" and green when negative).
  - Quick actions: New Invoice (customer prefilled), Receive Payment (customer prefilled, open invoices loaded), New Job, Edit, and — nonprofit only — "Giving Statement (last year)" PDF.
  - Contact / Billing / Shipping columns ("(same as billing)" when there is no ship address).
  - Notes textarea that autosaves on blur (`PUT` with just `notes`; shows "saving…", "✓ saved" or "⚠ save failed").
  - "Credits not applied yet" with an Apply button per credit; reseller permits with status badge, expiry and state-lookup link; jobs table; the 10 most recent invoices and 10 most recent payments (with full counts).
- **Entry points** — sidebar Customers & Sales → Customers; toolbar "New Customer"; "+ New Customer" quick-add (name/email/phone) inside the invoice, estimate and sales-receipt customer pickers.

_Key files: `app/models/contacts.py`, `app/schemas/contacts.py`, `app/schemas/common.py`, `app/routes/customers.py`, `app/static/js/customers.js`_

### Fuzzy duplicate-customer detection

- **Normalization** — lowercase, punctuation replaced by spaces, business suffixes removed (`inc`, `incorporated`, `corp`, `corporation`, `co`, `company`, `ltd`, `limited`, `llc`, `l.l.c`, `llp`, `lp`, `pllc`, `plc`, `gmbh`, `ag`, `sa`, `s.a`, `bv`, `pty`, `the`), whitespace collapsed — "Acme, Inc." and "ACME LLC" both become `acme`.
- **Scoring** — identical normalized names score 1.0; otherwise `difflib.SequenceMatcher.ratio()` (stdlib only). Threshold 0.85; matches returned highest-first as `{id, name, similarity}` (3 decimals). Compared against **active** customers only.
- **On create** — `POST /api/customers` with a likely duplicate returns 409 `{"error": "possible_duplicate", "message": …, "duplicates": [...]}` and writes nothing; `?force=true` bypasses the check.
- **UI** — the Customer form catches the 409 and shows "Possible Duplicate Customer" with each match and its % similarity; "Create Anyway" resubmits with `force=true`.
- **Pre-check API** — `GET /api/customers/check-duplicate?name=` returns `{"duplicates": [...]}` without creating (not called by the SPA).
- **Limits** — renames (PUT) are not checked; the invoice/estimate/sales-receipt quick-add boxes don't offer "Create Anyway" (the 409 surfaces as an error toast).

_Key files: `app/services/duplicate_detection.py`, `app/routes/customers.py`, `app/static/js/customers.js`_

### Customer balances & held credits

- **Computed balance** — every customer response replaces the never-written `Customer.balance` column with: open invoices' `balance_due` (non-void, > 0, each at its booked `exchange_rate`) − credit memos' unapplied `balance_remaining` − unapplied parts of non-void payments (at the payment's own rate). Calculated with a fixed number of grouped queries per page (IN lists capped at 500 ids), so lists never run one query per row.
- **Held-credits endpoint** — `GET /api/customers/{id}/credits` returns `customer_id`, `customer_name`, `home_currency`, `total` (home currency) and `credits[]` of `{kind: "payment" | "credit_memo", id, date, number, method, currency, amount, available}`.
  - Payments: non-void, amount greater than what is allocated (a prepayment, an overpayment or a payment recorded without choosing invoices); `number` is the check # or reference; currency is the payment's.
  - Credit memos: non-void with `balance_remaining > 0`; always home currency.
  - Sorted by date, then kind, then id; 404 for an unknown customer.
- **Where credits appear** — Receive Payment (list with Apply), the customer detail modal, the payment view ("…not applied to any invoice yet; it is a credit…" + "Apply to Invoices") and the invoice view (banner "This customer has $X in credit not applied to an invoice yet." + Apply Credit, offering only credits in the invoice's currency).
- **Apply modals** — prefill amounts oldest invoice first (or, from an invoice, oldest credit first) up to what is available; a live line warns when an amount exceeds an invoice balance or the credit, else "Applying $X; $Y stays as a credit". Payments apply in one call (`POST /api/payments/{id}/apply`); credit memos one invoice at a time (`POST /api/credit-memos/{id}/apply`).

_Key files: `app/services/contact_balances.py`, `app/routes/customers.py`, `app/static/js/payments.js`, `app/static/js/invoices.js`, `app/static/js/customers.js`_

### Sales lines, items, pricing & tax (rules shared by every sales form)

- **Line fields** — `item_id`, `description`, `quantity` (Numeric 10,2; default 1), `rate` (unit price, Numeric 17,4), `amount` (always recomputed; a sent value is ignored), `is_taxable`, `class_name`, `job_id`, `class_id`, `cost_code_id`, `line_order` (0 → position). Estimate lines add `unit_cost` (Numeric 12,4, the budget/cost side) and `cost_code_id`; credit-memo and recurring lines carry only item/description/qty/rate/tax flag/order.
- **Four-decimal unit prices** — rates keep 4 places ($0.045 a box) on invoices, sales receipts, estimates, credit memos, recurring templates and items; API responses print 2 places, or up to 4 when present ("12.50", "0.045"); PDFs likewise ("$0.045").
- **Rounding** — each line amount = qty × rate rounded half-up to the cent before summing; subtotal = sum of rounded lines; tax = rounded (sum of rounded taxable lines × rate); total = subtotal + tax. The SPA's `SalesLines` helper reproduces the same math (half-up via exponent shifting, tax computed in whole cents × ten-thousandths of a percent) so the total on screen is the total that posts.
- **Tax rate** — one rate per document, stored as a fraction with 6 decimals (8.875% = 0.08875). API values > 1 or < 0 are refused (422, worded in percent: "Tax rate 890% is more than 100%… divide by 100"); a finer value is rounded half-up to 6 places. Forms show "Tax Rate (%)" (4 decimals) prefilled from Settings `default_tax_rate` (a percent, validated 0–100). There are no tax codes, multiple rates or per-line rates; all tax posts to 2200.
- **Per-line taxable flag** — `is_taxable` true/false/null; null takes the item's `is_taxable` (else taxable). A customer with `is_taxable=false` forces every line to non-taxable server-side (`resolve_line_taxable`); the SPA's `TaxExempt.enforce` unticks and disables the Tax boxes with a tooltip and restores them if a taxable customer is picked.
- **Copies re-tax** — estimate conversion, invoice duplication and recurring runs re-derive every line's flag from the customer's *current* exemption (`taxed_copy_lines`), not the flags stored on the source.
- **Item defaults** — picking an item fills description (item description, else name), rate (`item.rate`) and the Tax box (`item.is_taxable`); estimates also fill Cost from the item's standard `cost`. Item types: product, service, material, labor. Income credits the item's `income_account_id`, else 4000.
- **Negative lines & discounts** — a negative quantity is always refused (422 "…use a credit memo for refunds"). A negative rate on an invoice/sales-receipt line is refused (422) unless the item is a QuickBooks Online–imported discount item (`is_discount`) or the invoice being edited already had a negative line on that item; such a line posts as a debit to its item's income account. Estimates, credit memos and recurring lines refuse negative rates outright. There is no native discount item, percent/amount discount field or early-payment discount terms.
- **At least one line** — every create requires ≥ 1 line (422 "invoice must have at least one line", "estimate must…", "sales receipt must…", "credit memo must…", "recurring invoice must…").
- **Inventory side effects** — a line on a `track_inventory` item records a SALE movement and a separate DR COGS (first COGS-type account, else 5000) / CR Inventory (item asset account, else 1300) entry at weighted-average cost on invoice create, duplicate, estimate conversion and recurring runs (negative stock allowed); edits post compensating movements for the quantity delta; voids reverse at the original sale's unit cost.

_Key files: `app/services/accounting.py`, `app/routes/invoices/helpers.py`, `app/schemas/common.py`, `app/schemas/invoices.py`, `app/models/items.py`, `app/static/js/invoices.js` (`SalesLines`), `app/static/js/utils.js` (`TaxExempt`), `app/services/inventory_hooks.py`_

### Invoices — create & edit

- **Create (`POST /api/invoices`)** — body: `customer_id`, `date`, optional `due_date`, `terms` (default `"Net 30"` — the API does *not* fall back to the customer's terms), `po_number`, `bill_*`/`ship_*` address lines (blank → copied from the customer), `tax_rate` (default 0), `notes`, `class_id`, `job_id`, `currency`, `exchange_rate`, `lines`, `is_pledge`, `fair_value_amount`, `fair_value_description` (≤ 200), `allow_zero_total`.
  - Order of checks: closing date (403) → customer exists (404) → due date not before invoice date (400) → negative lines (422) → line taxability → $0.00 confirmation (409) → fair value between 0 and total (400) → currency/rate resolution (400).
  - Starting status is `draft` ("Pending" in QB2003), or `paid` when the total is exactly $0.00 (so a no-charge invoice never shows as overdue).
  - Number assignment retries up to 10 times on a UNIQUE collision (concurrent creates), then 503 "Could not assign a unique invoice number…".
  - The invoice stores its own copy of the addresses but no country; the PDF prints the customer's current country.
- **Accounting on save** — DR 1100 A/R for the total; CR each line's income account (item's, else 4000) carrying the line's job/class/cost code; CR 2200 Sales Tax Payable for the tax; zero-amount lines skipped; converted to home currency at the invoice rate. Entry text "Invoice #1001 - Customer" (or Pledge / Sales Receipt / Donation Receipt), `source_type="invoice"`.
- **$0.00 "save anyway" flow** — a total ≤ $0.00 without `allow_zero_total: true` is refused 409 `{"code": "zero_total", "message": "This invoice adds up to $0.00. Enter a rate on at least one line before saving it.", "question": "This invoice adds up to $0.00. Save it anyway?"}`; nothing is written. The SPA (`SalesLines.sendAllowingZero`) shows the question in a confirm and resends with the flag. Same flow on edit, Duplicate ("Duplicate it anyway?"), estimate Convert ("Convert it to an invoice anyway?") and credit memos.
- **Edit (`PUT /api/invoices/{id}`)** — only fields sent are changed.
  - Refused: a void invoice (400 "Cannot edit voided invoice"); any edit of an invoice dated on/before the closing date, even notes-only (403); moving the date into a closed period (403); a posting on a completed bank reconciliation when amounts or date change (400); a new total below `amount_paid` (400 "Invoice total cannot be less than the amount already paid"); `status: "void"` (400 "…use POST /api/invoices/{id}/void"); `status: null` (400).
  - Status on edit: only draft ↔ sent can be chosen, and only while nothing is paid; `partial`/`paid` are always derived from `amount_paid`/`balance_due`.
  - Changing lines, `tax_rate`, `currency`, `exchange_rate`, `class_id`, `job_id` or `customer_id` recomputes totals, rebuilds the lines and rewrites the journal entry in place (same transaction id: old lines reversed and deleted, new lines posted) and posts inventory deltas. A date-only change moves the existing postings' dates.
  - A new customer without resending lines re-applies that customer's exemption to the stored lines. A new currency never inherits the old rate (home currency forces rate 1).
  - A cleared `due_date` is re-derived from terms + date.
  - QuickBooks Online–imported invoices: a tax amount that came in without a rate is kept until a rate is entered ("Tax stays at $X…" hint in the form); an amount/date edit "adopts" the invoice (reverses the import's posting and posts its own).
- **Invoice form (`InvoicesPage.showForm`)** — Customer (+ New Customer quick add), Date, Terms (Net 15/30/45/60/Due on Receipt; switches to the customer's terms on customer pick), Due Date (auto from date + terms, editable override), PO #, Class, Job, "This is a pledge (prints as PLEDGE)" (nonprofit; default ticked on new), Currency (USD, CAD, EUR, GBP, AUD, JPY, CHF, MXN, INR, CNY) + Exchange Rate (prefilled from the Bank of Canada feed via `/api/fx/rate`, overridable), Tax Rate (%), line grid (Item, Description, Qty, Rate, Tax, Amount, remove), "+ Add Line", running Subtotal/Tax/Total in the document's currency, Notes (prefilled from Settings `invoice_notes`, default "Thank you for your business."), and the logo option. Lines keep hidden job/class/cost-code values so an edit doesn't strip them.
- **Credit-limit warning (client-side only)** — on save (new invoice, or an edit that raises the total) and on estimate conversion, the SPA sums the customer's open invoices' balances in home currency (excluding the one being edited) plus the new amount; above `credit_limit` it asks "{Customer}'s credit limit is $X. With this invoice they would owe $Y. Save it anyway?". The API never enforces it; held credits are not netted; sales receipts, recurring runs, Duplicate and Quick Entry skip it; a failed lookup lets the save proceed.
- **Invoice list (`#/invoices`, "Create Invoices")** — excludes sales receipts; newest 500 with a "Show all" link; status filter (Draft, Sent, Partial, Paid, Void); columns #, Customer, Date, Due Date, Status, Total, Balance (foreign amounts shown as "EUR 850.00"); actions View, Edit, Mark Sent (drafts), Write Off (nonprofit, open balance). `#/invoices/{id}` deep-links open the invoice over the list.
- **List API** — `GET /api/invoices?status=&customer_id=&is_sales_receipt=&open_only=&skip=&limit=`: newest first (date, then id), default 500, max 1,000; `open_only=true` = draft/sent/partial with `balance_due > 0`, filtered server-side so old open invoices are never hidden behind a page of paid ones.
- **Attachments** — the invoice view lists, uploads (single file) and deletes attachments through the shared attachments API (`/api/attachments/invoice/{id}`).
- **Keyboard** — Alt+N opens a new invoice anywhere; Ctrl+S submits the open modal form; toolbar "Create Invoice".

_Key files: `app/routes/invoices/crud.py`, `app/routes/invoices/helpers.py`, `app/schemas/invoices.py`, `app/models/invoices.py`, `app/static/js/invoices.js`, `app/static/js/app.js`_

### Invoice numbering, terms & due dates

- **Invoice numbers** — Settings "Invoice Prefix" (`invoice_prefix`, default empty) + "Next Invoice #" (`invoice_next_number`, default 1001, whole number ≥ 1). Column is 50 chars, UNIQUE.
  - The number is the prefix + the larger of the setting and one past the highest number already used with that prefix; raising the setting jumps ahead, lowering it never reuses a number, existing numbers never change.
  - While the setting still holds its untouched default (1001), a file continues its own series (e.g. imported invoices), and turning a prefix on continues the plain series (1005 → `HLB-1006`). A typed counter lets a new prefix start over.
  - Leading zeros typed in the counter are kept as padding ("0001" → `2026-0001`); a zero-padded series stays padded ("0099" → "0100").
  - Candidates are collision-checked and bumped; the setting is advanced to n+1 in the same transaction (rolled back with a failed insert).
  - Sales receipts, recurring runs, duplicates and estimate conversions all draw from the same invoice series.
- **Estimate numbers** — Settings `estimate_prefix` (default `E-`) + `estimate_next_number` (default 1001); starts at the counter and skips numbers already used; after each create the counter becomes the numeric part + 1.
- **Credit memo numbers** — fixed series `CM-0001`, `CM-0002` … (prefix `CM-`, 4-digit padding, MAX+1); not configurable. Vendor credits use their own `VC-` series.
- **Due date from terms (server)** — "Net N" → date + N days; "Due on Receipt", "Due upon receipt", "COD", "Net 0" → same day; blank or unrecognized → +30 days. An explicit `due_date` wins but may not precede the invoice date (400 "The due date (Sep 1, 2026) is before the invoice date (…). Pick a due date on or after the invoice date.").
- **Due date in the form** — recomputed live from Date + Terms for the five standard terms (Net 15/30/45/60 = 15/30/45/60 days, Due on Receipt = 0), and when a customer's terms are applied.

_Key files: `app/services/numbering.py`, `app/routes/invoices/helpers.py`, `app/models/settings.py`, `app/services/settings_service.py`, `app/static/js/invoices.js`_

### Invoice lifecycle — send, void, duplicate, write-off

- **Statuses** — `draft`, `sent`, `partial`, `paid`, `void`.
  - draft → sent via Mark Sent; any → partial/paid via payments, credit-memo applications and write-offs; payment or credit-memo voids return the invoice to `partial` or `sent` (never back to `draft`); void is terminal.
- **Mark Sent (`POST /api/invoices/{id}/send`)** — status only; drafts only (400 "Only draft invoices can be marked as sent"). Emailing does not change status. Buttons on the list row and the invoice view.
- **Void (`POST /api/invoices/{id}/void`)** — "Void Invoice" button (confirm "This cannot be undone").
  - Refused: already void (400); any money applied — payments, credit memos or write-offs (400 "Cannot void an invoice with payments applied. Void the payment(s) first, then void the invoice."); invoice date on/before the closing date (403).
  - Posts a reversing entry dated on the invoice date (every original line with debit/credit swapped, descriptions prefixed "VOID:", `source_type="invoice_void"`); reverses inventory SALE movements at the original unit cost; sets `status=void`, `balance_due=0`. A QuickBooks Online–imported invoice (no posting of its own) has the ledger import's posting reversed.
- **Duplicate (`POST /api/invoices/{id}/duplicate`)** — new number, dated today, due date from the original terms, status draft (or paid at $0.00). Copies customer, terms, PO, both addresses, tax rate, currency and booked exchange rate, pledge/fair-value fields, notes, class, job and every line's item/description/qty/rate/job/class/cost code; line tax re-derived from the customer's current exemption. Posts like a new invoice (A/R, income per line, tax, home-currency conversion) and posts inventory sales. Optional body `{"allow_zero_total": true}`.
- **Write-off (`POST /api/invoices/{id}/write-off`)** — body `{date, amount?, memo?}`; default amount = whole open balance.
  - Refused: closing date (403); void invoice (400 "Invoice is void"); no open balance (400); amount ≤ 0 or > balance (400).
  - Creates a credit memo flagged `is_write_off=true`, status `applied`, tax 0, one line (the memo text, default "Write-off: Invoice #N"), class/job from the invoice, and applies it immediately; posts DR Bad Debt Expense (6960, auto-created if missing) / CR 1100 A/R; invoice → partial or paid. Undo by voiding that credit memo.
  - UI: "Write Off" button appears only for nonprofit companies ("Write Off Balance" modal: Date, Amount ≤ balance, Memo); the API works for any company.
- **Delete** — there is no invoice delete endpoint; void is the only way to cancel.

_Key files: `app/routes/invoices/lifecycle.py`, `app/services/accounting.py`, `app/services/inventory_service.py`, `app/static/js/invoices.js`_

### Invoice PDF, print & logo

- **PDF (`GET /api/invoices/{id}/pdf`)** — WeasyPrint render of `invoice_pdf.html`, served inline as `Invoice_{n}.pdf` / `SalesReceipt_{n}.pdf` / `Pledge_{n}.pdf` / `DonationReceipt_{n}.pdf` (UTF-8 `filename*` for accented names). Output is tagged PDF/UA-1 (falls back to plain PDF). Only `data:` URIs may be fetched while rendering, so user text can't embed local files.
- **Printed face** — title INVOICE / SALES RECEIPT / PLEDGE / DONATION RECEIPT decided by the document flags, never the screen vocabulary.
  - Header: logo, company name, address (city line without dangling commas), phone, email; document number.
  - Meta row: Date, Due Date, Terms (Terms omitted on pledges; due/terms omitted on sales receipts), PO # when present.
  - Address blocks: "Bill To" ("Sold To" on a sales receipt, "Donor" on nonprofit documents) with the customer's country name when not the US (63 ISO codes mapped, e.g. DE → Germany); "Ship To" when a ship address exists (not on nonprofit documents).
  - Lines: Description, Qty, Rate (2–4 decimals), Amount; "(non-taxable)" beside non-taxed lines when the invoice has tax.
  - Totals: Subtotal, "Tax (8.875%)" when non-zero, Total (Contribution / Pledge Amount), then Paid/Received + Balance Due when something is paid (a sales receipt shows Paid only). Foreign-currency invoices print the ISO code on every amount ("EUR 850.00"); discounts print "-$10.00".
  - Donation receipts add the IRS Pub. 1771 acknowledgment block (contribution, fair value of goods/services, deductible portion); pledges add a deductibility note.
  - Notes, and a fixed footer with Settings `invoice_footer` above "Generated by Slowbooks Pro 2026". Page size is always US Letter.
- **Print (`GET /api/invoices/{id}/print-preview`)** — the same HTML from the same renderer with an auto `window.print()`.
- **Logo toggle** — Settings `invoice_show_logo` ("Show company logo on invoices", default on, shown only when a logo is uploaded) controls invoice PDFs, Print and emailed attachments; also offered in the invoice form and view with a preview, saving immediately via `PUT /api/settings` (admin only; locked with an explanation for other roles; document buttons disabled while it saves). Estimates, credit memos, statements and letters always carry the logo when one is set.

_Key files: `app/routes/invoices/documents.py`, `app/services/pdf_service.py`, `app/services/donor_documents.py`, `app/services/addresses.py`, `app/templates/invoice_pdf.html`, `app/static/js/invoices.js`_

### Invoice email, SMTP & email templates

- **Email Invoice dialog** — Recipient (required; prefilled with the customer's email), Subject (prefilled from the rendered template), Message ("Appears at the top of the email"), and a "Preview — this is what will be sent" pane rendered on open and refreshed 350 ms after the Message is edited.
- **Preview (`POST /api/invoices/{id}/email-preview`)** — body `{recipient?, subject?, message?}`; returns `{recipient, subject, html_body}` from the same renderer as the send; sends nothing, writes no log row, renders no PDF.
- **Send (`POST /api/invoices/{id}/email`)** — attaches the invoice PDF (`{DocKind}_{n}.pdf`), returns `{"status": "sent"}`; 502 "Email could not be sent. Check the SMTP settings under Settings -> Email…" when SMTP is unconfigured or the server refuses; 500 "Email failed: …" (sanitized) for other failures. Does not mark the invoice sent.
- **Body/subject resolution** — subject = the one typed, else the saved template's subject, else "Invoice #N". Body = the saved `invoice_email` template (looked up by that fixed name for every document kind, including sales receipts), else the file template `invoice_email.html`, else a hand-escaped fallback. The operator's message is HTML-escaped and prepended as a paragraph (never a template variable, so a template can't drop it).
  - Template context: `invoice`/`inv`, `company` (settings with every secret redacted), `customer_name`, `doc_label` (Invoice / Pledge / Sales Receipt / Donation Receipt), `terms`, and `pay_url` only when the invoice has a payment token and at least one provider is enabled.
  - Rendered in a Jinja `SandboxedEnvironment` with autoescape and the `currency` and `fdate` filters; a saved template that fails to render falls back to the file template instead of blocking the mail.
  - File template: company banner, "Dear {customer}", table (number, date, due date, terms), "Amount Due" (balance due, with ISO code for foreign invoices), a "Pay Online" button when `pay_url` exists, notes, and "Thank you for your business." (or "…support." for nonprofits) unless the notes already say it.
- **SMTP delivery** — settings `smtp_host`, `smtp_port` (default 587, 1–65535), `smtp_user`, `smtp_password` (encrypted, masked), `smtp_from_email` (falls back to the user), `smtp_from_name` (default "Slowbooks Pro"), `smtp_use_tls` (default true = STARTTLS). HTML-only single-recipient message, optional PDF attachment (RFC 2231 filename), 30-second timeout, login only when user and password are set, CR/LF stripped from recipient and subject. No implicit-TLS (port 465), CC/BCC or plain-text alternative. Settings also offers a test email (`POST /api/settings/test-email`, Settings section).
- **Email log** — every send attempt writes an `email_log` row (`entity_type` invoice/statement/collection/…, `entity_id`, `recipient`, `subject`, `status` sent/failed, `error_message` e.g. "SMTP not configured", `sent_at`). There is no API or screen that reads it back.
- **Email templates (Settings → Email Templates)** — table `email_templates` (`name` unique, `subject_template`, `body_template`, `template_type`).
  - "Seed Default Templates" (`POST /api/email-templates/seed-defaults`) creates any missing defaults, with the prose (not the Jinja expressions) translated into nonprofit vocabulary when applicable: `invoice_email` (invoice), `payment_receipt` (payment_receipt), `past_due_reminder` (past_due), `collection_letter_30` (collection), `donation_acknowledgment` (acknowledgment). Returns `{created, total_defaults}`.
  - The editor keeps name/type read-only and edits subject and body (HTML + Jinja), listing available variables; invoice-type templates can be previewed against one of the 50 newest invoices without saving (`POST /api/email-templates/preview`), rendered in a sandboxed iframe with warnings for variables that came out blank — "Not available to an email template" vs conditional ones like `pay_url` ("only set when a payment provider is enabled — guard it with {% if pay_url %}"). A render error returns 400 "Template could not be rendered…".
  - API also supports create (400 on a duplicate name), update and delete; the SPA only lists, seeds and edits.
  - Only `invoice_email` (and `donation_acknowledgment`, in the donor module) is used by any sending code; the payment-receipt, past-due and collection templates are seeded but unused.

_Key files: `app/routes/invoices/documents.py`, `app/services/email_service.py`, `app/routes/email_templates.py`, `app/schemas/email_templates.py`, `app/models/email_templates.py`, `app/models/email_log.py`, `app/templates/invoice_email.html`, `app/static/js/invoices.js`, `app/static/js/settings.js`_

### Late fees

- **Settings** — "Late Fees": Enable (`late_fee_enabled`, default false), Late Fee Rate % (`late_fee_rate`, default 1.5, 0–100), Grace Days (`late_fee_grace_days`, default 15, ≥ 0).
- **Apply (`POST /api/invoices/apply-late-fees`)** — manual only, from the A/R Aging report's "Apply Late Fees" button (confirm); no scheduler runs it. 400 when late fees are disabled.
  - Targets sent/partial invoices (drafts are never charged) with `balance_due > 0` and `due_date ≤ today − grace days`; each invoice gets at most one late fee ever (skipped when a `late_fee` entry already exists for it).
  - Fee = balance due × rate, rounded; creates account 4800 "Late Fee Income" if missing; posts DR A/R / CR 4800 dated today ("Late fee - Invoice #N") with the invoice's class; adds the fee to the invoice's subtotal, total and balance due (no invoice line is added).
  - Returns `{"applied": n, "total_overdue": m}` ("Late fees applied to n of m overdue invoices").

_Key files: `app/routes/invoices/lifecycle.py`, `app/models/settings.py`, `app/static/js/reports.js`, `app/static/js/settings.js`_

### Foreign-currency invoices & payments

- **Design** — the general ledger stays in one home currency (Settings `home_currency`, default USD). Invoices, sales receipts and payments store `currency` (ISO, 3 chars) and `exchange_rate` (Numeric 18,8, home units per document unit); estimates, credit memos, recurring templates and batch payments have no currency (home only).
- **Rate resolution** — home currency always books at rate 1; a foreign document uses the supplied rate (≤ 0 → 400 "Exchange rate must be > 0"), else the Bank of Canada Valet feed (cross-rated through CAD, 5-second timeout), else 400 "No exchange rate available for EUR->USD; supply exchange_rate explicitly" — it never silently books at 1.0.
- **Posting** — every journal line is converted at the document rate; any rounding drift is absorbed by the largest line so the entry balances.
- **Display** — lists, forms, PDFs and emails show foreign amounts with the ISO code ("EUR 850.00"), never as dollars; balances, A/R figures and statements count the booked home amount.
- **Payments** — a payment pays invoices in its own currency only (400 "Payment currency X does not match invoice N currency Y; pay each currency with a separate payment"). Cash is booked at the payment-date rate, A/R relieved at each invoice's booked rate, and an unallocated remainder at the payment rate; the difference posts to 6999 "Exchange Gain/Loss" (expense account auto-created; credit = gain, debit = loss).
- **Apply later** — applying a foreign remainder to an invoice booked at another rate posts the realized difference (`source_type="payment_apply"`), dated the later of the payment and invoice dates.
- **Receive Payment form** — offers the customer's open-invoice currencies one at a time (currency picker shown when there is more than one or a foreign one) and requires "Exchange rate on the payment date (USD per EUR)", prefilled from the FX feed or the latest invoice's booked rate.
- **Home currency only** — batch payments, credit-memo applications and online checkout refuse foreign-currency invoices (400); estimates, credit memos and recurring templates have no currency field at all.

_Key files: `app/services/currency.py`, `app/services/fx_service.py`, `app/routes/payments.py`, `app/routes/invoices/helpers.py`, `app/static/js/utils.js`, `app/static/js/payments.js`_

### Estimates

- **Statuses** — `pending` (default), `accepted`, `rejected`, `converted`. Only conversion sets `converted`; accepted/rejected are settable only through the API (`PUT … {"status": …}`) — the SPA has no accept/reject buttons.
- **Fields** — `customer_id`, `date`, `expiration_date`, `tax_rate`, `notes`, `class_id`, `job_id`, lines (item, description, cost code, unit cost, qty, rate ≥ 0, Tax flag, class name, job). The bill-to address is copied from the customer on create and when the customer changes.
- **Create/edit** — no journal entry, no closing-date check, no $0.00 confirmation. Edits re-total when lines, the tax rate or the customer change (the new customer's exemption applies to stored lines). A converted estimate can still be edited; there is no delete.
- **Numbering** — see Invoice numbering (`E-1001` style; 503 after 10 collisions).
- **Form (`#/estimates`, "Create Estimates")** — Customer (+ New Customer quick add), Date, Expiration Date, Tax Rate (%), Class, Job; wide line grid with Item, Description, Cost Code (when the company has cost codes), Cost (unit cost, filled from the item's standard cost), Qty, Rate, Tax, Amount; running totals; Notes.
- **List** — #, Customer, Date, Expires, Status, Total; View, Edit, Convert (for anything not converted); newest 500 with "Show all". API filters `status`, `customer_id`, `skip`, `limit` (max 1,000).
- **PDF / Print** — `GET /api/estimates/{id}/pdf` (`Estimate_{n}.pdf`) and `/print-preview`: ESTIMATE title, Date, "Valid Until" (expiration), Status, "Prepared For" block, lines with "(non-taxable)" markers, Subtotal/Tax/Total, notes. No invoice footer; no email endpoint.
- **Convert to Invoice (`POST /api/estimates/{id}/convert`)** — "Convert" / "Convert to Invoice" buttons (confirm, then the credit-limit warning, then the $0.00 question).
  - Refused: already converted (400); today inside the closed period (403); $0.00 without `allow_zero_total` (409).
  - Pending, accepted, rejected and expired estimates are all convertible.
  - The invoice is dated today; terms = the customer's terms, else Settings `default_terms`, else Net 30; due date from those terms; bill-to = the estimate's, else the customer's; ship-to = the customer's; notes = the estimate's, else Settings `invoice_notes`; class and job copied; lines copied with the customer's current tax exemption; status draft (paid at $0.00).
  - Posts DR A/R / CR income per line / CR sales tax, posts inventory sales, marks the estimate `converted` with `converted_invoice_id`; the SPA then opens the invoice list.
- **Job budgets** — estimate lines' unit cost and cost code can seed a job's budget (cost = qty × unit cost, revenue = line amount) — see Jobs & Job Costing.

_Key files: `app/routes/estimates.py`, `app/schemas/estimates.py`, `app/models/estimates.py`, `app/templates/estimate_pdf.html`, `app/static/js/estimates.js`, `app/services/numbering.py`_

### Sales receipts & the walk-in customer

- **What it is** — QuickBooks "Enter Sales Receipts": an invoice plus its full payment in one step, stored as an ordinary invoice with `is_sales_receipt=true` so reports, PDFs and exports need no special casing; numbered in the invoice series.
- **Create (`POST /api/sales-receipts`)** — body: optional `customer_id`, `date`, `tax_rate`, `method`, `check_number`, `reference`, `deposit_to_account_id`, `notes`, `class_id`, `job_id`, `currency`, `exchange_rate`, `fair_value_amount`, `fair_value_description`, `lines`.
  - Pre-checks before anything is written: total must be positive (400 "Sales receipt total must be positive; add at least one line with an amount" — no $0.00 override) and the deposit account must exist (404).
  - Creates the invoice through the normal invoice path (due date = date, terms "Due on Receipt", same closing-date, tax, FX and inventory rules), flags it, then records a payment for the full total allocated to it. Returns `{invoice, payment}`.
  - If the payment step fails, the invoice (already committed) is voided and the original error is re-raised.
- **Accounting** — two entries: the invoice's (DR A/R / CR income / CR tax) and the payment's (DR deposit account — the chosen bank account or 1200 Undeposited Funds — / CR A/R).
- **Walk-in customer** — leaving the customer blank records the sale against a built-in ordinary customer, "Walk-in Customer" ("Anonymous Donor" for nonprofits), terms Due on Receipt, created on first use and remembered by id in the `walk_in_customer_id` setting (so renaming it keeps working); it never carries a balance.
- **Form (`#/sales-receipts`, "Enter Sales Receipts")** — Scan-receipt row (OCR prefill of date, merchant, total/subtotal and tax — see Receipt Scanning), Customer (first option = walk-in; + New Customer), Date, Payment Method (Cash, Check, Credit Card, ACH/EFT, Other), Check #, Reference, Deposit To ("Undeposited Funds (default)" or a bank account), Class, Job, Currency + Exchange Rate, Tax Rate (%), nonprofit "Goods or services provided in exchange?" fair value + description, lines with Tax boxes, "Total Received", Notes; "Record Sales Receipt". A scanned file is attached to the saved receipt.
- **List** — Sale #, Customer, Date, Status (filter Paid / Void), Total; newest 500 + "Show all"; `GET /api/sales-receipts?customer_id=&skip=&limit=`.
- **View** — payment method/check #/reference (found through the payment's allocation), lines, totals, fair value and deductible portion (nonprofit), Save PDF, Print, nonprofit Acknowledgment PDF/Email, Void Receipt.
- **Void** — "Void Receipt" voids the payment first (restoring the balance), then the invoice; the payment void's deposit/reconciliation refusals apply. There is no edit screen (the invoice API can edit one, but its total can't drop below the amount paid).

_Key files: `app/routes/sales_receipts.py`, `app/schemas/sales_receipts.py`, `app/models/invoices.py`, `app/static/js/sales_receipts.js`_

### Credit memos

- **Statuses** — `issued` on creation, `applied` once fully used, `void`. (`draft` exists in the enum but is never set.)
- **Create (`POST /api/credit-memos`)** — body: `customer_id`, `date`, optional `original_invoice_id`, `tax_rate`, `notes`, `class_id`, `job_id`, `lines` (qty and rate ≥ 0, per-line `is_taxable` used for the tax and not stored), `allow_zero_total`.
  - Refused: closing date (403); unknown customer (404); unknown original invoice (404); original invoice belonging to another customer (400); $0.00 without the flag (409 `zero_total`); number collisions after 10 retries (503).
  - Tax rate: the one sent; else the credited invoice's rate; else 0. The form starts at Settings `default_tax_rate` and switches to the invoice's rate when "For Invoice" is picked. Tax follows the line flags and the customer's exemption.
  - Accounting: DR each line's income account (item's, else 4000), DR 2200 Sales Tax Payable for the tax ("Sales tax credit"), CR 1100 A/R for the total ("Credit Memo CM-0001 - Customer"), with the memo's class. A $0.00 memo posts nothing.
  - Inventory: tracked items go back on hand (RETURN_IN at current average cost; no COGS-reversal entry).
- **Apply (`POST /api/credit-memos/{id}/apply`)** — body `{invoice_id, amount}`; returns `{"message": "Applied X to invoice N"}`.
  - Refused: void memo (400); unknown invoice (404); invoice of another customer (400); foreign-currency invoice (400 "A credit pays an invoice in its own currency only"); amount ≤ 0 (400); more than the memo's remaining credit or the invoice's balance (400). Memo and invoice rows are locked against double-spending.
  - Moves no ledger money (A/R was credited at issue): records an application, lowers the memo balance (→ `applied` at zero), raises the invoice's `amount_paid` and sets it partial/paid.
- **Void (`POST /api/credit-memos/{id}/void`)** — refused when already void (400) or dated in the closed period (403). Returns every application to its invoice (partial if still partly paid, else sent), posts the mirror-image entry with all dimensions (`credit_memo_void`), reverses returned stock (VOID movement), zeroes the balances and marks it void. Also the undo for a write-off.
- **Documents** — `GET /api/credit-memos/{id}/pdf` (`CreditMemo_{n}.pdf`) and `/print-preview`: CREDIT MEMO title with a VOID marker, Date, "For Invoice #", Type "Write-off", "Credit To"/"Donor" block from the customer's billing address, lines, Subtotal, Tax, Total Credit, Applied, Remaining Credit (omitted when void), notes.
- **UI (`#/credit-memos`)** — list (#, Customer, Date, Status, Total, Remaining; View, Apply when issued, Void); New Credit Memo form (Customer, Date, "For Invoice" = that customer's open invoices, Tax Rate (%), Class, priced lines with Tax boxes, running totals, Notes); Apply modal (per open invoice amount); view with Save PDF, Print, Apply, Void.
- **Not supported** — editing or deleting a memo, currency, cash refunds/refund checks from a memo, or emailing it.

_Key files: `app/routes/credit_memos.py`, `app/schemas/credit_memos.py`, `app/models/credit_memos.py`, `app/templates/credit_memo_pdf.html`, `app/services/inventory_hooks.py`, `app/static/js/credit_memos.js`_

### Receive Payments

- **Record (`POST /api/payments`)** — body: `customer_id`, `date`, `amount`, `method`, `check_number`, `reference`, `deposit_to_account_id`, `notes`, `currency`, `exchange_rate`, `allocations[{invoice_id, amount}]` (may be empty).
  - Refused: closing date (403); unknown customer (404); amount ≤ 0 (400 "Payment amount must be positive; use a credit memo for refunds"); any allocation ≤ 0 (400); allocations totalling more than the payment (400); unknown invoice (404); another customer's invoice (400 "…does not belong to payment customer"); an allocation above the invoice's balance (400); currency mismatch (400).
  - Each invoice row is locked (`SELECT … FOR UPDATE` on PostgreSQL) so concurrent payments can't over-apply; draft, sent and partial invoices can all be paid; each becomes `paid` at exactly zero, else `partial`.
  - Any unallocated remainder stays on the payment as a customer credit (it has already credited A/R).
- **Accounting** — DR the deposit account (the chosen account, else 1200 Undeposited Funds) / CR 1100 A/R, "Payment from {customer}", reference = reference or check #; plus a realized FX line for foreign payments. Payments into Undeposited Funds then wait on Make Deposits.
- **Form ("Record Payment")** — Customer, Date, Amount (≥ 0.01), Method (Check, Cash, Credit Card, ACH/EFT, Other), Check #, Reference, Deposit To (bank accounts only; blank = Undeposited Funds), Notes; then the customer's open invoices (drafts included and labelled, oldest first) with Balance and Apply columns.
  - Typing the amount fills Apply oldest-first (QuickBooks behaviour); "Apply oldest first" re-fills; each Apply is capped at its balance.
  - A live status line shows "Enter a payment amount…", "$X not applied of $Y", "Over-allocated by…", "Fully allocated", or an over-balance error.
  - Leftover money is kept as a credit only when "Keep the $X not applied as a credit on this customer's account…" is ticked (the save is blocked otherwise); with no open invoices the whole payment can be kept as credit.
  - Existing credits are listed with Apply buttons; the currency picker and rate field appear for foreign invoices.
- **List (`#/payments`)** — Date, Customer, Method ("[VOID]" marker), Reference, Amount, Not Applied, View; newest 500 + "Show all". API `GET /api/payments?customer_id=&skip=&limit=` returns allocations with invoice numbers and the `unapplied` amount (0 once voided).
- **View** — customer, date, amount, method, check #, reference, notes, "Deposited: in the deposit of 2026-09-26 to Checking (slip 1234, $812.20)" (or "an earlier deposit") on the single-payment read, applied invoices, the unapplied-credit banner, nonprofit Acknowledgment PDF/Email, Void Payment. `#/payments/{id}` deep links.
- **Apply later (`POST /api/payments/{id}/apply`)** — body `allocations` (≥ 1). Refused: voided payment (400 "This payment is void, so it has nothing to apply."); amounts ≤ 0 (400); more than the unapplied remainder (400 "Only $X of this payment is not applied yet…"); unknown invoice (404); another customer's (400); void invoice (400); above balance (400); currency mismatch (400). No journal entry except realized FX.
- **Void (`POST /api/payments/{id}/void`)** — "Void Payment" (confirm "Invoice balances will be restored").
  - Refused: already void (400); payment date in the closed period (403); received straight into a bank account whose line is on a reconciled statement (400 "…If the check bounced, charge the customer again with a new invoice."); inside a deposit that has been reconciled (400); inside a live deposit (400 "…Void that deposit on the Make Deposits page first…"); already consumed by a deposit that didn't record its payments (400).
  - Posts the reversing entry (`payment_void`) dated on the payment date, also reverses any realized-FX entries from later applies, returns matched bank-feed lines to the review queue, restores each invoice's balance (status → sent if fully unpaid, else partial), and flags the payment void (allocation rows are kept for history). A QuickBooks Online sales receipt whose payment this is gets voided with it.
- **Keyboard / entry points** — Alt+P, toolbar "Receive Payment", the customer page's "Receive Payment".

_Key files: `app/routes/payments.py`, `app/schemas/payments.py`, `app/models/payments.py`, `app/services/undeposited_funds.py`, `app/services/currency.py`, `app/static/js/payments.js`_

### Batch payments

- **Screen (`#/batch-payments`, "Batch Payment Application")** — Payment Date, Deposit To (Undeposited Funds or any asset account), Method (check, cash, ach, credit_card), Reference; every open home-currency invoice grouped by customer with a checkbox (fills the full balance) and an editable Payment amount; "Select All"; running Total; "Apply Batch Payment". Foreign-currency invoices are left out with a note. Hidden from read-only sign-ins.
- **API (`POST /api/batch-payments`)** — body `{date (ISO string), deposit_to_account_id?, method?, reference?, allocations[{customer_id, invoice_id, amount}]}`.
  - Creates one payment per customer (home currency, rate 1) for the sum of that customer's lines, each with DR deposit account/Undeposited Funds / CR A/R "Batch payment from {customer}".
  - Refused: closing date (403); no allocations (400); amounts ≤ 0 (400); unknown customer or invoice (404); an invoice not belonging to that line's customer (400); a foreign-currency invoice (400 "…record its payment on its own"); above the invoice balance (400); over-application (409).
  - One commit: any refused line writes nothing for any customer. Returns `{payments_created, payments[{payment_id, customer, amount}]}`.

_Key files: `app/routes/batch_payments.py`, `app/static/js/batch_payments.js`_

### Recurring invoices

- **Template** — `recurring_invoices`: `customer_id`, `frequency` (`weekly`, `monthly`, `quarterly`, `yearly`), `start_date`, optional `end_date`, `next_due` (starts at the start date), `is_active`, `terms` (default Net 30), `tax_rate`, `notes`, `class_id`, `job_id`, `invoices_created` counter; lines (item, description, qty, rate ≥ 0, Tax flag, order).
- **Create (`POST /api/recurring`)** — refused: unknown customer (404); end date before start (400 "The end date (…) is before the start date…"); a template adding up to $0.00 (400 "This recurring invoice adds up to $0.00…" — no override, since it would bill nothing every period).
- **Edit (`PUT /api/recurring/{id}`)** — frequency, end date, active flag, terms, tax rate, notes, class, job and lines (zero-total and end-date rules re-checked). Customer, start date and next due date can't be changed (the form locks them).
- **Delete (`DELETE /api/recurring/{id}`)** — a hard delete of the template.
- **Generate** — "Generate Due Now" (`POST /api/recurring/generate?as_of=`; default today) creates at most one installment per active template whose `next_due ≤ as_of`; run it again to catch up further periods. `scripts/run_recurring.py` does the same from cron (suggested `0 6 * * *`) against the `DATABASE_URL` database and prints the ids.
  - A template past its end date is deactivated; a $0.00 template creates nothing, keeps its date and is reported in `skipped[{recurring_id, customer_name, message}]` (shown as error toasts).
  - Each invoice: dated `next_due`, due date = next due + N days for "Net N" (otherwise +30), status draft, linked by `recurring_invoice_id`, flagged as a pledge in nonprofit companies, lines copied with the customer's current tax exemption, class/job from the template, no currency. Posts DR A/R / CR income per line / CR tax ("Recurring Invoice #N"), plus inventory sales.
  - Then `next_due` advances (+1 week, +1 month, +3 months or +1 year; an unrecognized frequency advances monthly), the counter increments, and the template deactivates once past its end date. Number collisions retry inside a savepoint (10 tries) and a template that still can't get a number waits for the next run.
  - Returns `{invoices_created, invoice_ids, skipped}`.
- **UI (`#/recurring`)** — list (Customer, Frequency, Next Due, Active, Created count; Edit, Delete); form with Customer (terms follow the customer), Frequency, Start/End Date, Terms, Tax Rate (%), Class, priced lines with Tax boxes and an "Each Invoice" total, Notes.

_Key files: `app/routes/recurring.py`, `app/schemas/recurring.py`, `app/models/recurring.py`, `app/services/recurring_service.py`, `scripts/run_recurring.py`, `app/static/js/recurring.js`_

### Customer statements, collection letters & "Email All Overdue"

- **Customer statement PDF** — Report Center → "Customer Statement" (customer + "As of" date → "Generate PDF" in a new tab) calls `GET /api/reports/customer-statement/{customer_id}/pdf?as_of_date=` (default today; 404 for an unknown customer), served as `Statement_{customer}.pdf`.
  - Content: logo and company block, "STATEMENT — As of {date}", customer name, billing address and country, then one chronological activity list (Date, Type, Number, Description, Amount, running Balance) of every non-void invoice, payment and credit memo dated up to the as-of date.
  - Line descriptions: invoices show "EUR 850.00" for a foreign amount, PO number and due date; payments show method, "applied to #1001, #1002" and any unapplied part; credit memos show what they were applied to, else "credit".
  - Amounts are in home currency (foreign invoices at the booked rate; payments at what they relieved), and the column headers say "(USD)" when any line is foreign. Summary: Total Invoiced, Total Payments, Total Credits (if any), Balance Due.
  - It is a full-history statement: there is no start date or brought-forward balance.
- **Email All Overdue (`POST /api/reports/batch-email-statements`)** — the A/R Aging report's "Email All Overdue" button (confirm).
  - Finds customers with a sent or partial invoice that has a balance and a due date before today (drafts never count). None → `{"sent": 0, "failed": 0, "errors": []}` ("No customer has an overdue invoice…").
  - No SMTP host → 400 "Email isn't set up yet, so no statements were sent…".
  - Each customer with an email gets a statement as of today attached ("Account Statement — {company}", fixed body "Please find your account statement attached."); customers without an email count as failed.
  - Only mail actually accepted counts as sent. Returns `{sent, failed, errors[]}`; the UI shows a toast, or a modal naming each customer that failed and why.
- **Collection letters (`POST /api/reports/collection-letters`)** — body `{letter_type: "30" | "60" | "90", customer_ids?, send_email: false}`.
  - Selects sent/partial invoices with a balance and `due_date ≤ today − 30/60/90 days` (optionally only listed customers), grouped per customer, and renders one PDF letter each: company header, date, customer address, a heading with a colored urgency bar — "Friendly Reminder" (30), "Second Notice — Account Past Due" (60), "Final Notice — Immediate Action Required" (90, mentions escalation after 10 business days) — a table of Invoice #, Date, Due Date, Days Past Due and Balance Due, "Total Amount Due", a remit-to block and a signature line.
  - With `send_email: true` each letter is emailed ("Payment Reminder" / "Second Notice" / "Final Notice" — {company}) as `Collection_{type}day_{customer}.pdf`; customers without an email are listed in `errors`.
  - Returns `{generated, emailed, errors}`; the PDFs themselves are not returned.
  - UI: the A/R Aging report's letter select (30-Day, 60-Day, 90-Day Letter) + "Send Collection Letters" always sends to every qualifying customer.
- **Where** — the A/R Aging report toolbar holds Apply Late Fees, Email All Overdue and the collection-letter controls (hidden from read-only sign-ins). The aging report itself and Income by Customer belong to the Reports section.

_Key files: `app/routes/reports/receivables.py`, `app/services/pdf_service.py`, `app/templates/statement_pdf.html`, `app/templates/collection_letter.html`, `app/static/js/reports.js`_

### Online payments — Stripe, PayPal, Square

- **Provider abstraction** — a registry of stateless singletons (`stripe`, `paypal`, `square`), each implementing `is_configured`, `create_checkout` (hosted page URL + external id), `verify_webhook` (the only authentication a webhook gets; failure → 400, nothing recorded) and `poll_status`; `refund` raises "refunds are not supported yet; refund from the provider dashboard and record a credit memo".
  - A provider is offered only when enabled (`{name}_enabled = "true"`) and configured.
  - Secrets are stored encrypted and masked on read (Stripe secret key and webhook secret, PayPal client secret, Square access token and signature key).
  - Any combination can be on at once.
- **Payment link** — every invoice gets a random UUID `payment_token` at creation. "Copy Payment Link" calls `GET /api/payments/payment-link/{invoice_id}`, which returns `{"url": "{server base URL}/pay/{token}"}`, minting a token if missing (a read-only sign-in gets 403 when one would have to be made).
- **Public pay page (`GET /pay/{token}`)** — no login; unknown token → 404.
  - Shows company name, invoice number, invoice date, due date, terms, total, amount paid and balance due, company phone/email, and light/dark styling.
  - One button per enabled provider: "Pay $X" (or "Pay $X with PayPal" when more than one is enabled), hidden once paid, void or at a zero balance.
  - Banners: "Payment received — thank you!" only after the provider confirms the capture on return; "Your payment is being confirmed…" when the return can't be verified yet; "Payment was cancelled…"; "This invoice has been paid in full."
- **Checkout (`POST /api/payments/{provider}/create-checkout-session`)** — public, rate-limited to 10/minute; body `{payment_token}` (the token is the capability).
  - Refused: provider disabled (400 "Online payments are not enabled") or unconfigured (400); unknown token (404); paid or void invoice (400); no balance (400); non-home-currency invoice (400 "…record this payment manually").
  - Charges the current balance due (drafts can be paid), stores `checkout_provider` and `checkout_external_id` (latest attempt only; Stripe's id is also mirrored to `stripe_checkout_session_id`), returns `{checkout_url}`, and the page redirects to it.
- **Recording (shared recorder)** — webhook, status poll and verified return all land in one function:
  - Row-locks the invoice; idempotent on the provider id stored as `Payment.reference` (≤ 100 chars) → "already_processed"; a paid/void invoice → "invoice_already_settled"; a missing invoice → "invoice_not_found".
  - The captured amount is capped at the balance due; creates a payment dated today (method = provider name, notes "Online payment via Stripe"), allocates it, sets partial/paid, and posts DR 1200 Undeposited Funds / CR 1100 A/R ("Stripe payment — Invoice #N"). Processing fees are not recorded (the gross amount goes to Undeposited Funds).
- **Webhooks (`POST /api/payments/{provider}/webhook`; legacy `POST /api/stripe/webhook`)** — session-exempt. Returns `{"status": "ignored"}` for other or unpaid events, `invoice_not_found` when a Square order id matches nothing, else the recorder's status.
- **Desktop mode** — webhooks can't reach 127.0.0.1, so the return redirect (`?status=success&provider=…`) polls the provider and records a verified capture, and the invoice view's "Check Payment Status" button (`POST /api/payments/{provider}/check-status/{invoice_id}`, signed-in) does the same → `payment_recorded`, `already_processed`, `no_checkout` or `not_paid` + the provider's status.
- **Stripe** — official SDK with telemetry off; Checkout Session in payment mode, card only, one line "Invoice #N" ("Payment for invoice #N"), metadata `invoice_id` + `payment_token`, customer email prefilled, success/cancel URLs back to `/pay/{token}`. Webhook: `stripe-signature` verified against `stripe_webhook_secret` (missing secret → 400), handles `checkout.session.completed` (`amount_total`/100). Poll: `payment_status == "paid"` → paid, session `expired` → cancelled. Configured = secret key present; the publishable key is stored but unused.
- **PayPal** — REST Checkout Orders v2 over hardened httpx (TLS verify, no redirects, 20 s timeout, no SDK). Environments sandbox (`api-m.sandbox.paypal.com`) / live (`api-m.paypal.com`); OAuth client-credentials token cached in-process per client id.
  - Order: intent CAPTURE, `custom_id` = invoice id, `invoice_id` = invoice number, `NO_SHIPPING`, `PAY_NOW`, return/cancel URLs; the approve (or payer-action) link is the checkout URL.
  - Poll: an APPROVED order is captured (idempotency header `PayPal-Request-Id: capture-{order}`) and then COMPLETED → paid with the sum of completed captures; VOIDED → cancelled.
  - Webhook: verified by PayPal's `verify-webhook-signature` API using `paypal_webhook_id` (required); handles `PAYMENT.CAPTURE.COMPLETED`.
  - Configured = client id + secret.
- **Square** — Payment Links (quick pay) via httpx with `Square-Version: 2026-06-18`. Environments sandbox (`connect.squareupsandbox.com`) / production (`connect.squareup.com`).
  - Link: name "Invoice #N", amount in cents, `location_id`, redirect back to `/pay/{token}?status=success&provider=square`, payment note, idempotency key; the order id is the stored external id because quick-pay links carry no metadata.
  - Webhook: `x-square-hmacsha256-signature` = base64 HMAC-SHA256 over (`square_notification_url` + raw body) with the signature key; both settings are required. Handles `payment.updated` with status COMPLETED, matching the invoice by stored order id.
  - Poll: an order counts as paid when COMPLETED, or OPEN with tenders and zero net amount due; CANCELED → cancelled.
  - Configured = access token + location id.
- **Currency** — all three charge in USD (hard-coded) and only home-currency invoices can be checked out.
- **Settings** — Online Payments: Stripe (enabled, publishable key, secret key, webhook secret); PayPal (enabled, environment sandbox/live, client id, client secret, webhook id); Square (enabled, environment sandbox/production, access token, location id, webhook signature key, webhook notification URL).

_Key files: `app/services/payments/__init__.py`, `app/services/payments/base.py`, `app/services/payments/recorder.py`, `app/services/payments/stripe.py`, `app/services/payments/paypal.py`, `app/services/payments/square.py`, `app/services/payments/_http.py`, `app/routes/provider_payments.py`, `app/routes/public.py`, `app/templates/public_pay.html`, `app/static/js/invoices.js`, `docs/setup-stripe.md`, `docs/setup-paypal.md`, `docs/setup-square.md`_

### Reseller permits (resale certificates)

- **Record** — `reseller_permits`: `entity_type` (`customer` — a customer's permit presented to you; `vendor`; `company` — your own permit, `entity_id` null), `entity_id`, `jurisdiction` (stored upper-case, up to 20 chars, not validated against a state list), `permit_number` (≤ 50), `issued_at`, `expires_at` (whole days), `last_verified_at`, `verified_by`, `notes`, `is_active`.
- **Per-state format rules** — WA 9 digits, CA 9–12 digits, TX 11 digits; any other state has "No format rule on file". The check is soft: it warns but never blocks a save (`GET /api/reseller-permits/validate-format` returns `{jurisdiction, permit_number, normalized, ok, message}`; the form shows the same hint live).
- **Normalization on save** — a WA number with 9 digits, a CA number of 9–12 digits made only of digits/dashes/spaces, or a TX number with 11 digits is stored as bare digits; anything else is stored as typed.
- **Expiry tracking** — each response adds `days_to_expire`, `is_expired` (expiry before today) and `verification_url`.
  - `GET /api/reseller-permits/expiring?within_days=` (1–365, default 30) lists active permits expiring within the window plus already-expired ones, soonest first.
  - The page opens with an alert strip ("N permits need attention", "EXPIRED n days ago" / "expires in n days") or "All clear".
- **State lookup links** — official pages for WA (DOR), CA (CDTFA), NY (Tax & Finance STLR), TX (Comptroller) and FL (DOR Annual Resale Certificate); other states have none. No state has an API; verification is manual.
- **Verification trail** — "Verify…" opens a modal with copy buttons for permit #, business name and the customer's/vendor's tax ID ("Tax ID / UBI" for WA) and the expiry status.
  - Step 1 opens the state lookup in a new window after a confirm (no iframe, since state sites refuse framing).
  - Step 2 records the outcome with the verifier's name/initials: "✓ Permit is valid — Mark Verified" (`POST /{id}/mark-verified` stamps `last_verified_at = now (UTC)` and `verified_by`) or "✗ Permit is expired / invalid — Mark Inactive" (PUT `is_active=false`, then stamps the verification).
- **UI (`#/reseller-permits`, sidebar under Payroll & HR)** — table (Held by, State, Permit #, Expires, Status Expired/Expires soon/Active/Inactive, Last verified or "Never" with the verifier as a tooltip; Verify…, Edit, Delete — "The audit trail goes away too"); Add/Edit form (Held by, entity picker of active customers/vendors plus the permit's own if it has gone inactive, State default WA, Permit number, Issued, Expires, Notes, Active). Customer detail modals list the customer's permits.
- **API** — list filters `entity_type`, `entity_id`, `jurisdiction`, `active_only` (ordered by expiry); create validates `entity_type` (400); update is a full replacement; delete is a hard delete.
- **Not connected to tax** — a permit never changes a customer's "Tax exempt" flag, and an expired permit doesn't block exempt sales; no scanned copy of the certificate can be attached; there is no dashboard reminder.

_Key files: `app/models/reseller_permit.py`, `app/routes/reseller_permits.py`, `app/static/js/reseller_permits.js`, `app/static/js/customers.js`_

### Quick Entry mode (paper backlog)

- **Purpose & entry** — "Quick Entry Mode — Batch invoice entry for entering paper invoices quickly" at `#/quick-entry`; toolbar "Quick Entry", Alt+Q.
- **Form** — Customer (active only), Date (today), Terms (Net 15/30/45/60/Due on Receipt; always defaults to Net 30), PO #; a line grid of Item, Description, Qty, Rate (2-decimal step) and Amount (picking an item fills description and rate); "+ Add Line"; a running total.
- **Save & Next (button or Ctrl+Enter)** — posts `POST /api/invoices` with tax rate 0 and no notes; lines with a rate > 0 or a description are sent (qty defaults to 1); no lines → "Add at least one line item". The due date comes from terms server-side and the invoice is an ordinary draft with the normal posting.
- **After each save** — a running log gets "#1005 created — Customer — $total" at the top, the lines and PO # reset, customer/date/terms stay, and focus returns to Customer.
- **Limits** — no tax, class, job, currency or notes fields; no quick-add customer; a $0.00 invoice is refused with the 409 message (no "save anyway" prompt here); no credit-limit check; the log is not persisted.

_Key files: `app/static/js/app.js` (`App.renderQuickEntry`, `App.saveQuickEntry`), `app/routes/invoices/crud.py`_

### Nonprofit behaviour on the A/R side

- **Vocabulary** — in a nonprofit company, screens read Donor/Donors, Pledge/Pledges, Donation(s) for sales receipts, "Recurring Pledges", "Donor Statement"; printed faces and ledger text use the document's literal kind.
- **Pledges** — `is_pledge` on invoices (form checkbox, ticked by default for new ones; recurring runs set it automatically) prints PLEDGE ("Pledge date", "Due", "Pledge Amount", "Balance") with a deductibility note.
- **Donation receipts** — nonprofit sales receipts print DONATION RECEIPT with the IRS Pub. 1771 acknowledgment block; `fair_value_amount`/`fair_value_description` record goods or services received and must lie between 0 and the total (400).
- **Write-offs** — "Write Off" on open pledges posts to Bad Debt Expense via a write-off credit memo.
- **Walk-in donor** — counter donations default to "Anonymous Donor".
- **Acknowledgments & giving statements** — buttons on the payment and sales-receipt views and the customer page link into the donor module (see Nonprofit section).

_Key files: `app/services/donor_documents.py`, `app/services/terminology.py`, `app/routes/invoices/crud.py`, `app/routes/invoices/lifecycle.py`, `app/templates/invoice_pdf.html`_

### Accounting postings (summary)

- **Invoice / duplicate / converted estimate / recurring run** — DR 1100 A/R (total); CR line income accounts (item income account, else 4000; negative discount lines DR); CR 2200 Sales Tax Payable (tax); foreign documents converted at the invoice rate.
- **Invoice void** — the exact mirror of the invoice's lines, dated the invoice date.
- **Late fee** — DR 1100 / CR 4800 Late Fee Income, dated today.
- **Payment / sales-receipt payment / batch payment** — DR chosen bank account or 1200 Undeposited Funds / CR 1100 (cash at the payment rate, A/R at each invoice's booked rate), difference to 6999 Exchange Gain/Loss.
- **Online payment** — DR 1200 / CR 1100 at the captured (capped) amount, dated today.
- **Payment apply (foreign)** — DR 6999 / CR 1100 (loss) or DR 1100 / CR 6999 (gain); home-currency applies post nothing.
- **Payment void** — mirror of the payment entry plus mirrors of its apply-time FX entries.
- **Credit memo** — DR line income accounts + DR 2200 / CR 1100; application posts nothing; void mirrors it.
- **Write-off** — DR 6960 Bad Debt Expense / CR 1100 via a write-off credit memo.
- **Inventory** — DR COGS / CR Inventory per tracked sale line (separate entry); credit memos return stock without a COGS reversal.
- **Control accounts** — a missing 1100, 1200, 2200 or 4000 refuses the posting with 409 naming the account (nothing is written); 4800, 6960 and 6999 are created on demand.

_Key files: `app/services/accounting.py`, `app/services/control_accounts.py`, `app/routes/invoices/helpers.py`, `app/routes/payments.py`, `app/routes/credit_memos.py`, `app/services/currency.py`_

### Guard rails, permissions & error conventions

- **HTTP codes** — 400 business-rule refusals (wording written for the user); 403 closing-date lock (header `X-Closing-Date-Override` asks for the override password; 5 wrong passwords in 10 minutes lock the override for 10 minutes) and role refusals; 404 missing records; 409 `zero_total`, `possible_duplicate`, missing control account and batch over-application; 422 validation (unknown fields, negative quantities, bad tax rates, blank names); 502 email not sent; 503 number assignment exhausted.
- **Closing date** — checked explicitly by invoice create/edit/void, write-off, estimate conversion, credit memo create/void, payment create/void and batch payments, and again inside every journal posting (so recurring runs, late fees, duplicates and online payments inherit it).
- **Concurrency** — invoice, payment and credit-memo rows are locked (`FOR UPDATE`, a no-op on SQLite) for balance-changing writes; UNIQUE document numbers with retry loops cover numbering races.
- **Roles** — admin and bookkeeper can do every A/R write; read-only is GET-only (so no previews, emails or payment-link creation). The invoice logo toggle writes Settings and is admin-only. Batch Payments and the aging-report action buttons are hidden from read-only sign-ins. `/pay/*`, provider webhooks, checkout creation and `/api/stripe/webhook` are public by design.
- **Session-exempt public routes** — `/pay/{token}` and `/api/payments/{provider}/(webhook|create-checkout-session)` bypass sign-in; `check-status` and `payment-link` require it.

_Key files: `app/main.py`, `app/services/closing_date.py`, `app/routes/_helpers.py`, `app/routes/_roles.py`, `app/schemas/common.py`_

### API endpoints

| Method | Path | What it does |
|---|---|---|
| GET | /api/customers | List customers (`active_only`, `search` on name) with computed balances |
| GET | /api/customers/check-duplicate | Fuzzy duplicate check for `name` (≥ 0.85 similarity, active customers) |
| GET | /api/customers/{customer_id} | One customer with computed balance |
| GET | /api/customers/{customer_id}/credits | Unapplied payments and open credit memos the customer holds |
| POST | /api/customers | Create customer; 409 `possible_duplicate` unless `?force=true`; blank terms → default terms |
| PUT | /api/customers/{customer_id} | Update any customer fields (incl. `is_active`) |
| DELETE | /api/customers/{customer_id} | Deactivate (soft delete) |
| GET | /api/estimates | List estimates (`status`, `customer_id`, `skip`, `limit`) |
| GET | /api/estimates/{estimate_id} | One estimate |
| POST | /api/estimates | Create estimate (numbered from Settings counter; bill-to from customer) |
| PUT | /api/estimates/{estimate_id} | Edit estimate incl. status, lines, customer, tax rate |
| GET | /api/estimates/{estimate_id}/pdf | Estimate PDF |
| GET | /api/estimates/{estimate_id}/print-preview | Estimate HTML with auto print dialog |
| POST | /api/estimates/{estimate_id}/convert | Convert to invoice dated today (`allow_zero_total` optional) |
| GET | /api/invoices | List invoices (`status`, `customer_id`, `is_sales_receipt`, `open_only`, `skip`, `limit`) |
| GET | /api/invoices/{invoice_id} | One invoice with lines |
| POST | /api/invoices | Create invoice, post A/R entry and inventory; 409 `zero_total` unless allowed |
| PUT | /api/invoices/{invoice_id} | Edit invoice; re-posts the journal in place when amounts change |
| GET | /api/invoices/{invoice_id}/pdf | Invoice / sales receipt / pledge / donation receipt PDF |
| GET | /api/invoices/{invoice_id}/print-preview | Same page as HTML with auto `window.print()` |
| POST | /api/invoices/{invoice_id}/email-preview | Render the email exactly as it would be sent, without sending |
| POST | /api/invoices/{invoice_id}/email | Email invoice with PDF attached via SMTP (502 on failure) |
| POST | /api/invoices/{invoice_id}/void | Void with reversing entry (refused if money is applied) |
| POST | /api/invoices/{invoice_id}/send | Mark a draft as sent |
| POST | /api/invoices/apply-late-fees | Apply one-time late fees to overdue sent/partial invoices |
| POST | /api/invoices/{invoice_id}/write-off | Write off open balance to Bad Debt Expense via credit memo |
| POST | /api/invoices/{invoice_id}/duplicate | Copy as a new invoice dated today (`allow_zero_total` optional) |
| GET | /api/sales-receipts | List invoices flagged as sales receipts |
| POST | /api/sales-receipts | Create invoice + full payment in one step (walk-in customer if none) |
| GET | /api/credit-memos | List credit memos (`customer_id`, `status`, `skip`, `limit`) |
| GET | /api/credit-memos/{cm_id} | One credit memo |
| GET | /api/credit-memos/{cm_id}/pdf | Credit memo PDF |
| GET | /api/credit-memos/{cm_id}/print-preview | Credit memo HTML with auto print dialog |
| POST | /api/credit-memos | Issue credit memo (DR income/tax, CR A/R) |
| POST | /api/credit-memos/{cm_id}/apply | Apply credit to one of the customer's home-currency invoices |
| POST | /api/credit-memos/{cm_id}/void | Void: unwind applications, reversing entry, stock reversal |
| GET | /api/payments | List payments with allocations and unapplied amount |
| GET | /api/payments/{payment_id} | One payment incl. "deposited in" sentence |
| POST | /api/payments | Receive payment with allocations; remainder kept as customer credit |
| POST | /api/payments/{payment_id}/apply | Apply a payment's unapplied remainder to invoices (realized FX if needed) |
| POST | /api/payments/{payment_id}/void | Void payment (refused if deposited/reconciled) and restore invoice balances |
| POST | /api/batch-payments | One payment per customer across many invoices, single commit |
| GET | /api/recurring | List recurring templates (`active_only`) ordered by next due |
| GET | /api/recurring/{rec_id} | One recurring template |
| POST | /api/recurring | Create template (refuses $0.00 and end-before-start) |
| PUT | /api/recurring/{rec_id} | Edit template (not customer/start date/next due) |
| DELETE | /api/recurring/{rec_id} | Delete template |
| POST | /api/recurring/generate | Generate one due installment per template (`as_of`, default today) |
| POST | /api/payments/{provider_name}/create-checkout-session | Public: hosted checkout for an invoice by `payment_token` (10/min) |
| POST | /api/payments/{provider_name}/webhook | Public: provider-signed webhook → record payment |
| POST | /api/payments/{provider_name}/check-status/{invoice_id} | Poll provider for the invoice's last checkout and record if paid |
| GET | /api/payments/payment-link/{invoice_id} | Public pay URL for an invoice (mints token if missing) |
| POST | /api/stripe/webhook | Legacy alias of the Stripe webhook |
| GET | /pay/{token} | Public invoice payment page (verifies `?status=success` returns) |
| GET | /api/email-templates | List email templates |
| GET | /api/email-templates/{template_id} | One email template |
| POST | /api/email-templates/preview | Render candidate subject/body against an invoice, no save |
| POST | /api/email-templates | Create template (unique name) |
| PUT | /api/email-templates/{template_id} | Update template |
| DELETE | /api/email-templates/{template_id} | Delete template |
| POST | /api/email-templates/seed-defaults | Create missing default templates in the company's vocabulary |
| GET | /api/reseller-permits/validate-format | Soft per-state format check + normalized number |
| GET | /api/reseller-permits | List permits (`entity_type`, `entity_id`, `jurisdiction`, `active_only`) |
| GET | /api/reseller-permits/expiring | Active permits expiring within N days (1–365) or already expired |
| GET | /api/reseller-permits/{permit_id} | One permit with expiry and lookup-URL fields |
| POST | /api/reseller-permits | Create permit (entity_type customer/vendor/company) |
| PUT | /api/reseller-permits/{permit_id} | Replace permit fields |
| DELETE | /api/reseller-permits/{permit_id} | Delete permit and its trail |
| POST | /api/reseller-permits/{permit_id}/mark-verified | Stamp `last_verified_at` now and `verified_by` |
| GET | /api/reports/customer-statement/{customer_id}/pdf | Customer statement PDF as of a date |
| POST | /api/reports/batch-email-statements | Email statements to every customer with an overdue sent/partial invoice |
| POST | /api/reports/collection-letters | Generate 30/60/90-day letters, optionally emailing them |
| GET | /api/reports/ar-aging | A/R Aging report (in this router; covered in the Reports section) |
| GET | /api/reports/income-by-customer | Income by Customer report (in this router; covered in the Reports section) |

### Notes, gaps & discrepancies

- **Recurring due dates ignore "Due on Receipt"** — `recurring_service` parses terms inline (`int(terms.replace("net ", ""))`), so "Due on Receipt"/"COD" fall back to +30 days, while the invoice paths use `_due_date_from_terms` (same day). This is the exact bug `_due_date_from_terms`'s docstring says was fixed elsewhere.
- **Recurring generation isn't isolated per template** — a template whose next date falls in the closed period raises the 403 from the journal posting inside the loop, so that run generates nothing for any template.
- **Late fees are loosely tied to the invoice** — the fee is added to subtotal/total with no invoice line (printed lines no longer sum to the subtotal); an edit that re-totals from lines drops it from the invoice while its DR A/R / CR 4800 entry stays; voiding the invoice doesn't reverse the late-fee entry; foreign-currency invoices post the fee without converting to home currency; each invoice can only ever get one fee.
- **Dimensions on some postings** — the invoice void builds its own reversal without per-line class/job/cost code (header dimensions only), unlike the credit-memo void, which uses `reversing_lines()` precisely so class/job reports net to zero. Estimate conversion and recurring entries likewise post income lines without per-line job/cost code, and the credit-memo create entry passes class but not job.
- **Online checkout is always USD** — Stripe (`"usd"`), PayPal and Square (`"USD"`) are hard-coded; checkout is only offered for home-currency invoices, so a company whose home currency isn't USD would be charged in USD. The PayPal/Square setup docs do say "charged in USD".
- **Currency picker defaults to USD** — `currencyFormGroupsHtml` preselects `USD` (and rate 1) rather than the home currency, so in a non-USD company a new invoice or sales receipt saved without touching the picker appears to be booked as a USD document at rate 1.0 (inferred from the code).
- **Online overpayments are dropped** — the recorder caps the captured amount at the balance due; any excess captured by the provider isn't recorded as customer credit. Processing fees aren't recorded either.
- **Email log is write-only** — send failures tell the user "the failure is recorded in the email log", but no endpoint or screen reads `email_log`.
- **Seeded templates unused** — `payment_receipt`, `past_due_reminder` and `collection_letter_30` are seeded and editable, but statements and collection letters use hard-coded bodies and no payment-receipt email exists. `email_log`'s comment lists "estimate", but estimates can't be emailed.
- **Invoice email edge cases** — `recipient` is optional in the schema and there is no server-side fallback to the customer's email (the SPA requires it). If PDF rendering fails before the subject is computed, the error handler references `subject` before assignment (UnboundLocalError → plain 500 without the intended log row).
- **Collection letters** — the endpoint returns counts only (no downloadable PDFs); `total_due` sums document-currency balances without conversion and the email body prints "$"; an unknown `letter_type` falls back to 30 days and renders no letter body.
- **Statements** — full history only (no statement period or balance forward); the only statement email is the batch "Email All Overdue" (no per-customer send).
- **Sales receipts aren't atomic** — docs/features.md says the receipt "posts both documents and their journal entries atomically"; the code commits the invoice first and, if the payment fails, voids it (the number and a pair of offsetting entries remain).
- **Credit limit** — warning only, client-side, invoice form and estimate conversion only, held credits not netted; nothing in the API enforces it.
- **Reseller permits** — the model comment promises to "refuse to apply a permit-based exemption if it's expired" and power a dashboard reminder; neither exists (permits don't touch `Customer.is_taxable`; only the permits page calls `/expiring`). None of the lookup URLs contains a `{permit}` placeholder, so despite the "pre-filled" comments no link is ever pre-filled. There's no way to attach the certificate copy, `PUT` doesn't re-validate `entity_type`, and the page sits in the sidebar's Payroll & HR section. The README says the verification trail "lands on the customer record"; it is stored on the permit and the customer modal shows only status/expiry.
- **Estimate numbering drops typed zeros** — `settings_service` says both counters keep leading zeros ("0001"), but `next_estimate_number` converts the counter to an int, so "0001" yields `E-1`. Estimates start at the counter and fill unused lower numbers instead of continuing past the highest, unlike invoices.
- **Estimates** — no delete, email, accept/reject UI or expiration enforcement; a converted estimate remains editable and `status` can be set to `converted` by PUT without creating an invoice.
- **Credit memos** — no edit, delete, email or refund-check path (`PaymentProvider.refund` also says to refund in the provider dashboard and record a credit memo); applying one has no closing-date check; the `draft` status is never used.
- **Payment void resets drafts to Sent** — a paid-then-unvoided draft invoice comes back as `sent`, not `draft`.
- **Duplicate detection** — only on create (not rename); the quick-add customer boxes can't "Create Anyway"; the `l.l.c`/`s.a` suffix patterns never match because punctuation is stripped first.
- **Customer currency** — not a customer attribute; everything is per document.
- **Quick Entry** — always tax 0, Net 30 default, 2-decimal rate step, no $0.00 override prompt.
- **Pay page** — prints "Invoice #" and "$" for every document kind and currency and shows raw ISO dates. `main.py` says the public pay page opts into `Referrer-Policy: no-referrer`, but only the employee portal does. Payment links use the request's base URL, so on a desktop install they point at 127.0.0.1.
- **Batch payments** — amounts are floats in the schema; `date` is a free string parsed server-side (a malformed date is not a clean 422).
- **Recurring templates** — the hard delete doesn't clear `invoices.recurring_invoice_id` (the FK has no ON DELETE rule), so deleting a template that already generated invoices should hit an FK error on PostgreSQL and leave a dangling reference on SQLite (inferred from the code); `frequency` isn't validated (unknown values advance monthly); the cron script only targets the `DATABASE_URL` database.
- **Docs drift** — docs/features.md's "Online Payments" section and "Invoice Email" bullet mention only Stripe ("Pay with Stripe" button, "when Stripe is enabled"), but the code supports PayPal and Square and shows "Pay $X" when a single provider is enabled (the provider name is added only when several are); "Print Preview" lists invoices and estimates but credit memos have one too; `/api/credit-memos` is described as "CRUD" but has no update or delete.

---

_[Index](README.md) · [2. Purchasing, Accounts Payable, Items & Inventory →](02-purchasing-payables-inventory.md)_
