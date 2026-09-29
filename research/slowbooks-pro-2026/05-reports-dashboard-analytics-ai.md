_SlowBooks Pro 2026 feature inventory — [← 4. Payroll & HR](04-payroll-hr.md) · [Index](README.md) · [6. Nonprofit Mode, Jobs & Job Costing →](06-nonprofit-jobs-job-costing.md)_

## 5. Reports, Dashboard, Analytics & AI

Reporting has four surfaces: the **Report Center** (`#/reports`), whose reports are built live from posted journal lines (accrual only, with no cash-basis option) or, for aging, sales tax and the 1099 Summary, from open documents, and open in modals with period presets, drill-down and, for the core statements, PDF/CSV export; the per-user, customizable **Company Snapshot** (`#/`, 16 cards); the paid-basis **Analytics & AI** page (`#/analytics`) with Chart.js charts and CSV/PDF export; and an optional bring-your-own-key **AI layer** (8 providers, including a self-hosted Cloudflare Worker gateway) that writes an executive brief, runs 11 curated analyses and keeps a legacy tool-calling Q&A endpoint. Global search (Ctrl+K), Schedule C (`#/tax`), saved report definitions and per-user dashboard layouts complete the domain. The server caches only AI insight results (10 minutes, in-process).

### Report Center (`#/reports`)
- **Entry points** — Reach the Report Center from the sidebar **Reports** link (route label "Report Center") or the toolbar **Reports** button. The page header reads "Reports", and a Saved Reports list sits above the card grid.
- **Business cards (17, in display order)** — Profit & Loss · P&L by Class · Job Budget vs Actual · Job Profitability · Financial Statements Pack (PDF) · Fixed Asset Reconciliation · Balance Sheet · A/R Aging · A/P Aging · Sales Tax · General Ledger · Income by Customer · Customer Statement · Trial Balance · Cash Flow · 1099 Summary · Budget vs Actual.
- **Nonprofit cards (21)** — When Settings → Company Type is nonprofit, six cards replace the Profit & Loss card:
  - Statement of Activities, Statement of Financial Position, Fund Balances, Statement of Functional Expenses, Pledge Report and Year-End Giving Statements. These are covered in the nonprofit section.
  - The Balance Sheet card is hidden.
  - The terminology layer renames the other cards, for example "Activities by Fund", "Grant Budget vs Actual", "Grant Income & Costs", "Pledge Aging", "Contributions by Donor" and "Donor Statement".
- **Modal viewer** — Every card opens a modal over the Report Center.
  - The hash stays `#/reports`, so no report has its own deep link.
  - The body re-renders whenever the period select or a custom date changes.
  - API errors appear inside the modal as an empty state.
- **Export buttons** — Only some reports get a **Save PDF** / **Save CSV** pair, which calls `window.open('/api/reports/{report}/pdf|csv?…')`.
  - With the pair: Profit & Loss, Balance Sheet, Trial Balance, General Ledger, and the five nonprofit statements and pledge report.
  - PDF only: the Financial Statements Pack and Customer Statement.
  - Screen only (no PDF, CSV or print button): A/R Aging, A/P Aging, Sales Tax, Income by Customer, Cash Flow, P&L by Class, Job Profitability, Job Budget vs Actual, 1099 Summary, Fixed Asset Reconciliation, Budget vs Actual.
- **Read-only sign-ins** — These controls are hidden through `App.WRITE_ACTIONS` / `data-write`, and the server refuses the POSTs:
  - "Add to Saved Reports…", saved-report Delete, Apply Late Fees, Email All Overdue and Send Collection Letters.
  - Every report and export is a GET, so it stays available to read-only users.
- **Desktop app** — The desktop shim handles Save PDF and Save CSV.
  - A report PDF is saved under Documents → SlowBooks Pro → Reports (a customer statement goes to Documents instead) and opens in a viewer window with **Open in** and **Show in folder**.
  - A CSV goes to Documents/SlowBooks Pro/Reports.
  - A global middleware rewrites `Content-Disposition: attachment` to `inline` for any request carrying `X-Slowbooks-Desktop`.

_Key files: `app/static/js/reports.js`, `app/static/js/app.js`, `index.html`, `app/routes/reports/__init__.py`, `app/routes/reports/_router.py`, `app/static/js/desktop_shim.js`, `app/main.py`_

### Period presets, parameters and basis
- **Presets** (`ReportsPage.periodOptions`) — Nine presets are offered:
  - This Month (1st → last day of the month)
  - This Quarter (quarter start → quarter end)
  - This Year (Jan 1 → Dec 31)
  - **This Year to Date** (Jan 1 → today). This is the initial choice in every report modal.
  - Last Month and Last Quarter
  - Last Year (Jan 1 → Dec 31 of last year)
  - Last Year to Date (Jan 1 last year → the same month/day last year, clamped to the month's length)
  - Custom Date (a From/To row appears)
  - The browser computes the ranges in local time. "This Month/Quarter/Year" run to the period's end, so they include post-dated entries.
- **As-of reports** — Balance Sheet, A/R Aging, A/P Aging and Statement of Financial Position label the select "As Of".
  - The as-of date is the end of the chosen range, for example Last Month → that month's last day.
  - Custom Date uses only the To field.
- **Server defaults** — An omitted `start_date` becomes Jan 1 of the current year, and an omitted `end_date` or `as_of_date` becomes today. Exceptions:
  - Schedule C defaults to Jan 1–Dec 31.
  - 1099 Summary defaults to the current year.
- **Basis** — All ledger reports are accrual. They sum posted `TransactionLine` debits and credits, grouped by `Transaction.date`. This covers P&L, Balance Sheet, Trial Balance, General Ledger, Cash Flow, P&L by Class, Job Profitability and Schedule C.
  - The document-driven reports are A/R and A/P Aging, Income by Customer, Sales Tax and the 1099 Summary.
  - No report offers a cash-basis toggle.
- **Filters and comparisons** — The P&L and Balance Sheet have no class, job, customer or location filter. Class and job splits are separate reports.
  - `account_id` exists only on the General Ledger API (and its PDF/CSV). `customer_id` exists only on the Job Profitability and Job Budget vs Actual APIs. The UI exposes neither.
  - The only prior-period columns are the nonprofit **Compare to prior year** checkbox (`compare=prior_year`) on Statement of Activities and Statement of Functional Expenses.
  - The business P&L and Balance Sheet have no comparison or budget columns. Side-by-side months appear only on the dashboard's "P&L: This Month vs Last" card.

_Key files: `app/static/js/reports.js`, `app/routes/reports/financial.py`, `app/routes/reports/receivables.py`, `app/routes/reports/payables_tax.py`, `app/routes/reports/nonprofit.py`_

### Profit & Loss
- **Profit & Loss** — `GET /api/reports/profit-loss?start_date&end_date` returns:
  - Arrays `income`, `cogs` and `expenses` of `{account_id, account_name, account_number, amount}`.
  - `total_income`, `total_cogs`, `gross_profit` (income − COGS), `total_expenses` and `net_income` (income − COGS − expenses).
  - Amounts are in each type's natural sign: income is credit − debit, COGS and expense are debit − credit. A contra balance therefore reads negative.
  - The list includes only accounts with at least one posted line in the period. An account whose lines net to zero still appears.
- **Screen** — Sections are Income, Cost of Goods Sold and Expenses (each shows "None" when empty), followed by Total Income, Gross Profit, Total Expenses and a highlighted Net Income. Every account name links to the account drill-down for the same dates.
  - The screen has no "Total COGS" row; the PDF does.
- **PDF** — The document has one section with columns "" and Amount:
  - Income header, accounts, then Total Income.
  - Cost of Goods Sold header, accounts, then Total Cost of Goods Sold.
  - Gross Profit.
  - Expenses header, accounts, then Total Expenses.
  - Net Income as the grand total with a double rule.
  - The file is `profit-loss_{start}_{end}.pdf`.
- **CSV** — After the preamble, columns are `Section | Account number | Account name | Amount`. Each section ends with a "Total {section}" row, followed by Gross Profit and Net Income rows. The file is `profit-loss_{start}_{end}.csv`.
- **Nonprofit wording** — The title becomes "Statement of Activities", Income becomes "Revenue & Support" and Net Income becomes "Change in Net Assets". Files are named `statement-of-activities_…`.
- **Saveable** — Report type `profit_loss`.

_Key files: `app/routes/reports/financial.py`, `app/services/ledger_exports.py`, `app/services/terminology.py`, `app/static/js/reports.js`_

### Balance Sheet
- **Balance Sheet** — `GET /api/reports/balance-sheet?as_of_date` returns `assets`, `liabilities` and `equity` rows plus `total_assets`, `total_liabilities` and `total_equity`. Each row is the natural-sign sum of every line dated on or before the as-of date.
  - **Net income folded into equity** — Income, expense and COGS accounts are never closed. So the report adds income − COGS − expenses, from inception through the as-of date, as an equity row labelled "Net Income (current period)" (account_id null) whenever it is non-zero. This row is what makes Assets = Liabilities + Equity.
  - There is no year-end closing entry and no retained-earnings roll-forward. A posted Retained Earnings account appears as an ordinary equity row.
  - The response has no balanced/out-of-balance flag.
- **Screen** — Assets, Liabilities and Equity, each with a total. Account rows link to the drill-down; see that section for a date caveat. The screen has no "Liabilities + Equity" row.
- **PDF and CSV** — The same sections and totals, plus a "Liabilities + Equity" grand total and a period line "As of {date}".
  - Files are `balance-sheet_{as_of}.pdf|csv`.
  - A nonprofit gets `statement-of-financial-position_…` and "Net Assets" wording.
- **Saveable** — Report type `balance_sheet`.

_Key files: `app/routes/reports/financial.py`, `app/services/ledger_exports.py`, `app/static/js/reports.js`_

### Trial Balance
- **Trial Balance** — `GET /api/reports/trial-balance?start_date&end_date` covers each account with posted lines dated inside the range, ordered by account number.
  - Each account carries `total_debit`, `total_credit` and `net_balance`. The net is debit − credit, not the natural sign.
  - The response adds `total_debit`, `total_credit` and `difference`.
  - It is a **period-activity** trial balance: gross debits and gross credits for the range, not inception-to-date balances.
- **Screen** — Columns are Number, Account, Type, Debit, Credit (a zero shows blank) and Net. The TOTALS row shows the difference in green when it is under $0.01 and red otherwise. The modal has no save button.
- **PDF** — Columns are Account ("number name"), Debit and Credit, with a Total grand-total row. The file is `trial-balance_{start}_{end}.pdf`.
- **CSV** — Columns are `Account number | Account name | Type | Debit | Credit | Net`, then a totals row whose Net is the difference.
  - The layout is meant to be read once per company by later group reporting (#180). `rows_of()` skips the 4-line preamble.

_Key files: `app/routes/reports/financial.py`, `app/services/ledger_exports.py`, `app/static/js/reports.js`_

### General Ledger
- **General Ledger** — `GET /api/reports/general-ledger?start_date&end_date&account_id` returns every posted line in the range, grouped by account.
  - Lines are ordered by account number, date, transaction id, then line id. The stable order means running balances match between the screen and the exports (#179).
  - Each account carries `account_type`, `normal_balance` (debit or credit) and `opening_balance`, the balance brought forward from all earlier lines.
  - Each entry has date, description (the transaction's, else the line's), reference, debit, credit, `running_balance` and `source_type` ("journal" when blank).
  - Each account also carries `total_debit`, `total_credit` and `closing_balance`.
  - Balances read in natural sign, so a payable or income reads positive. The period's Dr − Cr equals that account's Net on the Trial Balance for the same dates.
  - Accounts with no lines in the period are left out, even when they carry a brought-forward balance.
- **Screen** — One table per account, headed "number — name". It shows the balance brought forward, then each entry with its source type as text, then a Period total row with debits, credits and the closing balance.
  - The UI has no account picker; `account_id` is API-only.
- **PDF** — Columns are Date, Reference, Description, Debit, Credit and Balance. Each account has a header row, a "Balance brought forward" row and a "Period total" row.
- **CSV** — Columns are `Date | Reference | Description | Account number | Account name | Debit | Credit | Running balance | Source type`.
  - Each account opens with a "Balance brought forward" row (source "opening") and closes with a "Period total" row (source "total").
- **Saveable** — Report type `general_ledger`.

_Key files: `app/routes/reports/financial.py`, `app/services/ledger_exports.py`, `app/static/js/reports.js`_

### Account drill-down & source-document links
- **Drill-down API** — `GET /api/reports/account-transactions?account_id&start_date&end_date` requires `account_id` and returns 404 for an unknown account. Dates default to year to date. It reuses the bank register service and returns:
  - `account` with id, number, name, type, bank_kind and natural_balance.
  - `opening_balance`, `period_debit`, `period_credit` and `period_net`.
  - `entries`, each with line and transaction ids, date, description, payee, reference, debit, credit and a signed `amount`.
  - Each entry also has `running_balance` (starting from the brought-forward balance), `source_type`, `source_id`, `source_link`, `cleared`, `reconciliation_id` and `voided`.
- **Source links** — Each posting links to the document behind it:
  - By document id: invoice → `/#/invoices/{id}`, bill → `/#/bills/{id}`, payment → `/#/payments/{id}`, bill_payment → `/#/bill-payments/{id}`, vendor_credit → `/#/vendor-credits/{id}`, journal / manual_journal → `/#/journal/{id}`.
  - By transaction id: expense → `/#/expenses/{txn}`, deposit → `/#/deposits/{txn}`, cc_charge → `/#/cc-charges/{txn}`, transfer → `/#/banking/transfers/{txn}`.
  - manual, bank_entry, opening_balance, qbo_ledger and qbo_journal → `/#/journal/{txn}`.
  - Any other source type gets no link. Each of these hash routes opens the document over its list page.
- **UI** — A "Drill-down — {account}" modal opens from P&L, Balance Sheet and Statement of Financial Position rows.
  - The header reads "number · name · start → end · Net".
  - The table columns are Date, Ref, Description, Source (link text "{source_type} #{source_id}"), Debit, Credit and Running.
  - The Balance Sheet passes only an end date, so the server's default start (Jan 1 of the current year) applies. The list shows current-year lines only and is empty for a prior-year as-of date.
  - Clicking the synthesized Net Income row shows the toast "No account_id on this row".
- **Saving drill-downs** — The API accepts saved-report type `account_transactions`, but the SPA has neither an opener nor a save button for it.

_Key files: `app/routes/reports/financial.py`, `app/services/bank_register.py`, `app/static/js/reports.js`, `app/static/js/app.js`_

### Cash Flow Statement (indirect method)
- **Cash Flow** — `GET /api/reports/cash-flow?start_date&end_date` builds the statement by the indirect method from each non-cash account's credit − debit for the period.
  - **Cash** — Accounts with `bank_kind == "bank"`. A credit card is a current liability.
  - **Profit & loss accounts** — Income, COGS and expense accounts roll into net income.
  - **Asset accounts** — Placed by the first rule that matches:
    - Accumulated depreciation or amortization goes to Adjustments, labelled "Depreciation ({account})". This covers a fixed-asset type's accumulated account or a name matching "accum(ulated|.) depr/amort".
    - A fixed-asset type's asset account goes to Investing.
    - Four-digit numbers starting with 1: below 1500 go to working capital, 1500–1999 go to Investing.
    - Names like equipment, vehicles, furniture, fixtures, buildings, land, machinery, leasehold, property, computers, fixed assets, intangible or goodwill go to Investing.
    - Any other asset goes to working capital.
  - **Liabilities and equity** — A non-card liability named like loans, notes payable, mortgages, long-term, line of credit, lease liabilities or bonds payable goes to Financing. The rest (A/P, cards, sales tax, payroll liabilities) go to working capital. Equity goes to Financing.
  - **Fixed-asset disposals** (`source_type asset_disposal`):
    - Operating backs the gain or loss out as "Gain on disposal of fixed assets" (negative) or "Loss on disposal…".
    - The cost and accumulated depreciation removed, plus the gain, become "Proceeds from disposal of fixed assets" in Investing.
  - **Opening balances** (`source_type opening_balance`) are not flows. They are excluded from the sections and counted in beginning cash, even when dated inside the period.
  - **Totals** — `total_operating` (net income + adjustments + working capital), `total_investing`, `total_financing`, `net_change`, `beginning_cash` and `ending_cash`.
  - Every entry balances, so the net change equals ending minus beginning cash by construction, with no plug.
- **Screen** — Operating Activities shows Net Income, "Adjustments for non-cash items" and "Changes in working capital". Investing and Financing follow, each with a total.
  - The statement ends with Net Change in Cash, Cash at beginning of period and Cash at end of period.
  - Rows are sorted by account number, then name.
  - Saveable as `cash_flow`. There is no PDF or CSV.

_Key files: `app/services/cash_flow.py`, `app/routes/reports/financial.py`, `app/static/js/reports.js`_

### P&L by Class and job reports
- **P&L by Class** — `GET /api/reports/profit-loss-by-class` returns one column per class with income, COGS, gross profit, expenses and net income.
  - A line's own class wins, then the transaction header's class, then the system "Uncategorized" class. This GET creates and commits that class on first use.
  - Because every line lands in a class, the column totals reconcile to the plain P&L.
  - Uncategorized sorts first, then the other classes by name.
  - Totals are `total_income`, `total_expenses` and `total_net_income`.
  - Screen only. The nonprofit title is "Activities by Fund".
- **Job Profitability** — `GET /api/reports/job-profitability?start_date&end_date&customer_id` returns one row per job. A line's job is its own, else its transaction's.
  - Each row has income, COGS, expenses, total costs, gross profit, net income, contract amount and `margin_pct` (net ÷ income × 100; null without income).
  - Untagged activity forms the "No job" row ("No grant" for a nonprofit), so the totals equal the P&L.
  - A screen note says the No job row also holds the applied-cost credits from Job Cost Entries, so its costs can be negative.
  - Clicking a job opens it on `#/jobs`.
- **Job Budget vs Actual** — This card calls `GET /api/jobs/budget-vs-actual` in the jobs router. Each active job shows:
  - Budget: original + change orders = revised.
  - Committed: open PO lines (sent, partial or received), job-to-date.
  - Actual: costs for the period.
  - Projected: actual + committed.
  - Variance: revised − projected, shown red when negative.
  - % used: projected ÷ revised.
  - Revenue.
  - A footer carries totals, and clicking a row opens `#/jobs/{id}`.

_Key files: `app/routes/reports/financial.py`, `app/services/classes_service.py`, `app/services/jobs_service.py`, `app/services/job_costing.py`, `app/routes/jobs.py`, `app/static/js/reports.js`_

### A/R Aging, statements and collections
- **A/R Aging** — `GET /api/reports/ar-aging?as_of_date` returns, per customer, `current`, `over_30`, `over_60`, `over_90`, `total` and `unapplied_credits`, plus a TOTAL row. Customers are sorted by name.
  - **Invoices counted** — Draft, sent and partial invoices dated on or before the as-of date with `balance_due > 0`. Invoices post to the ledger when created, drafts included.
  - **Buckets** — Days past due at the as-of date: 0 or fewer is current, then 1–30, 31–60 and 61+. An invoice with no due date counts as current.
  - **Home currency** — Each balance is multiplied by the invoice's booked exchange rate.
  - **Credits netted** — Unapplied, non-void credit memos and the unapplied part of non-void payments, each dated on or before the as-of date, go to `unapplied_credits`.
    - They are subtracted from Current and Total, because a credit has no due date.
    - This makes the total equal account 1100 and each row equal that customer's balance.
  - **Past as-of dates** — The report re-ages today's open balances. A document paid since the as-of date drops out; balances are not reconstructed historically.
- **Screen** — Columns are Customer, Current (shown gross, before credits), 1-30, 31-60, 61-90+, Credits (negative) and Total, plus a TOTAL row. Saveable as `ar_aging`. The toolbar has:
  - **Apply Late Fees** — asks for confirmation, calls `POST /api/invoices/apply-late-fees`, and toasts "Late fees applied to X of Y overdue invoices".
  - **Email All Overdue**.
  - A letter select (30-Day, 60-Day or 90-Day Letter) with **Send Collection Letters**.
- **Email All Overdue** — `POST /api/reports/batch-email-statements` emails one statement PDF to each customer with a sent or partial invoice past due. Drafts never trigger a statement.
  - It returns 400 "Email isn't set up yet…" when there are candidates but no SMTP host.
  - A customer without an email address is listed as a failure.
  - Only messages that `send_email()` confirms count as sent.
  - The subject is "Account Statement — {company or 'Our Company'}", the attachment is `Statement_{name}.pdf`, and the email log records entity `statement`.
  - The response is `{sent, failed, errors}`, and the UI lists who didn't get one.
- **Collection letters** — `POST /api/reports/collection-letters` takes `{letter_type: "30"|"60"|"90", customer_ids?, send_email}`.
  - It selects customers with sent or partial invoices due at least 30, 60 or 90 days ago. An unknown type means 30.
  - It builds one PDF per customer, headed "Friendly Reminder", "Second Notice — Account Past Due" or "Final Notice — Immediate Action Required", with an invoice table showing days overdue and the total due.
  - Email subjects are "Payment Reminder", "Second Notice" or "Final Notice" — {company}. The attachment is `Collection_{N}day_{name}.pdf`, and the log entity is `collection`.
  - The response is `{generated, emailed, errors}`.
  - The UI always sends `send_email: true`. Without it, the PDFs are generated and thrown away; only counts come back.
- **Customer Statement** — The card opens a picker of active customers with an As of Date (default today). It then opens `GET /api/reports/customer-statement/{id}/pdf?as_of_date` in a new tab.
  - The statement lists invoices, payments and credit memos dated on or before the as-of date, voids excluded. On the same day, invoices come first, then payments, then memos.
  - A running balance is kept in home currency.
  - Each line describes its document:
    - Invoice: the foreign amount when not in home currency, "PO …" and "Due {date}".
    - Payment: foreign amount, method, "applied to #…" and "not applied to an invoice yet".
    - Credit memo: "applied to #…" or "credit".
  - Totals are Total Invoiced, Total Payments, Total Credits and Balance Due. Total Payments is what each payment took off A/R, at the applied invoices' rates.
  - The filename uses RFC 5987 `filename*`, so accented customer names survive.

_Key files: `app/routes/reports/receivables.py`, `app/services/contact_balances.py`, `app/services/pdf_service.py`, `app/templates/statement_pdf.html`, `app/templates/collection_letter.html`, `app/static/js/reports.js`_

### A/P Aging
- **A/P Aging** — `GET /api/reports/ap-aging?as_of_date` mirrors A/R for vendors, using unpaid and partial bills with `balance_due > 0` and bucketing by days past due.
  - **Due date fallback** — A bill without a due date ages from its date and terms:
    - Net N → N days after the bill date.
    - "Due on Receipt", "Due upon receipt", COD or Net 0 → the bill date.
    - Blank or unrecognized terms → Net 30.
  - **Home currency** — Each balance uses the bill's booked rate.
  - **Credits netted** — Non-void vendor credits with a remaining balance and the unapplied part of non-void bill payments, each dated on or before the as-of date, are netted into Current and reported in `unapplied_credits`. This makes the total equal account 2000 and each row equal the vendor balance.
  - **As-of filter** — Unlike A/R, bills are not limited to those dated on or before the as-of date.
- **Screen** — Columns are Vendor, Current (net of credits), 1-30, 31-60, 61-90+ and Total, plus a TOTAL row.
  - The screen has no Credits column; the API's `unapplied_credits` field is not shown.
  - Saveable as `ap_aging`.

_Key files: `app/routes/reports/payables_tax.py`, `app/routes/invoices/helpers.py`, `app/static/js/reports.js`_

### Income by Customer
- **Income by Customer** — `GET /api/reports/income-by-customer?start_date&end_date` covers non-void invoices dated in the period, including drafts and sales receipts. Everything is in home currency.
  - Per customer: `invoice_count`, `total_sales` (the pre-tax subtotal), `total_tax`, `total_paid` and `total_balance`.
  - Grand totals are included, and rows are sorted by sales, highest first.
  - Payments dated in the period and not applied to any invoice are added to Paid and subtracted from Balance. A customer can therefore appear with 0 invoices. The identity Sales + Tax − Paid = Balance holds.
- **Screen** — Columns are Customer, Invoices, Sales, Sales Tax, Paid and Balance, with a TOTAL row. The nonprofit title is "Contributions by Donor". Saveable as `income_by_customer`.

_Key files: `app/routes/reports/receivables.py`, `app/services/contact_balances.py`, `app/static/js/reports.js`_

### Sales Tax report & Pay Sales Tax
- **Sales Tax report** — `GET /api/reports/sales-tax?start_date&end_date` lists documents dated in the period:
  - Non-void invoices and sales receipts, converted to home currency at their booked rate.
  - Non-void credit memos as negative rows. Write-off credit memos are excluded, because a write-off returns no goods.
  - Rows are sorted by date, invoices before memos, then by number.
  - Each row has `type` (invoice or credit_memo), date, number, customer, `subtotal`, `taxable`, `tax_rate` and `tax_amount`.
  - `taxable` includes only lines flagged taxable, and is 0 when a document carries no tax.
  - `tax_rate` is null when nothing is taxable, so an all-labour invoice never reads "8.25%, $0.00".
  - Totals are `total_sales`, `total_taxable`, `total_non_taxable`, `tax_on_sales`, `tax_credited` and `total_tax` (tax on sales − tax credited).
- **Tie to Sales Tax Payable (2200)** — The `ledger` block is null when no 2200 account exists. Otherwise it contains:
  - `tax_posted`: credit − debit to 2200 in the period, excluding `sales_tax_payment` entries.
  - `payments` for the period.
  - `balance`: the amount owed at the end date.
  - `difference`: the report's total minus the tax posted.
  - `purchase_tax` and `purchase_tax_to_date`: postings from bill, bill_void, vendor_credit and vendor_credit_void entries. These represent supplier tax that releases before 2.18 wrongly posted to 2200.
- **Screen** — Columns are Date, Invoice / Credit Memo (with a badge), Customer, Sales, Taxable, Rate (up to 4 decimals, "—" when none) and Tax.
  - A summary shows Total Sales, Taxable and Non-Taxable; "Tax on sales … less tax on credit memos …"; and **Tax Collected**.
  - A reconciliation line then reads "2200 Sales Tax Payable: tax posted this period $X — agrees with this report." when the difference is under $0.005.
  - Otherwise it shows a red "differs from this report by $X" and names the likely causes: tax on a bill, a journal entry, or a void of an earlier sale.
  - A final line shows "Paid this period · Owed at {end}".
  - **Purchase-tax correcting-entry notice** — When `purchase_tax_to_date` is $0.005 or more, the screen explains that supplier tax on bills entered before 2.18 lowered 2200 by the period amount. It tells the user to post one journal entry: debit the expense or COGS account those purchases used, and credit 2200 for the to-date total.
  - Saveable as `sales_tax`. Screen only, with no PDF or CSV.
- **Pay Sales Tax** — The button is on the Tax Reports page (`#/tax`), not in the report modal. The modal shows the Sales Tax Payable balance, taken from the Balance Sheet row numbered 2200 as an absolute value.
  - The form fields are Amount (prefilled with that balance), Date (today), Pay From Account (active bank and credit-card accounts with their balances) and Check #.
  - Submitting calls `POST /api/reports/sales-tax/pay` with `{date?, amount, pay_from_account_id, check_number?, reference?}`.
  - That posts the journal entry "Sales Tax Payment" (`source_type sales_tax_payment`): **DR 2200 Sales Tax Payable / CR the bank or card account**.
  - The line memo is "Sales tax payment", and the reference is `reference`, or else the check number.
  - Guards:
    - The closing-date lock refuses a date on or before the closing date unless the closing password is supplied.
    - The amount must be greater than 0 and is rounded to cents.
    - The account must exist (404) and must be a bank or card account (`bank_kind`). A/R, Inventory and Undeposited Funds are refused with a sentence explaining why.
    - Account 2200 must exist.
  - The response is `{status, transaction_id, amount}`.
  - Before 2.18, the `date` field shadowed its own type and every payment was refused.

_Key files: `app/routes/reports/payables_tax.py`, `app/services/accounting.py`, `app/services/control_accounts.py`, `app/services/closing_date.py`, `app/static/js/reports.js`, `app/static/js/tax.js`_

### 1099 Summary
- **1099 Summary** — `GET /api/reports/1099-summary?year` defaults to the current year and lists vendors flagged "1099 Vendor: Yes" or with the legacy `is_1099_eligible` flag.
  - Each vendor shows tax ID, 1099 type (NEC by default) and `total_paid`. The total is bill-payment amounts applied to bills, for payments dated in the year, computed in one grouped query.
  - `above_threshold` is set at $600 or more.
  - Rows are sorted by total, and the response includes `total`, `vendors_above_threshold` and `threshold: 600.0`.
- **Screen** — A Year input with **Generate** above columns Vendor, Tax ID, Type, Total Paid and Status. A row over the threshold is highlighted and marked "REPORT".
  - The TOTAL row reads "N vendor(s) above $600".
  - When no vendor is flagged, the screen says to flag vendors as 1099 on the Vendors page.

_Key files: `app/routes/reports/payables_tax.py`, `app/services/form_1099.py`, `app/static/js/reports.js`_

### Other Report Center entries
- **Financial Statements Pack** — `GET /api/reports/financial-statements/pdf?start_date&end_date` produces one audit-ready PDF, with each statement on its own page:
  - P&L for the range, Balance Sheet as of the end date, and Trial Balance for the range.
  - A nonprofit gets Statement of Activities, Statement of Financial Position and Trial Balance instead.
  - The modal opens the PDF and explains which dates each statement uses, and that paper size follows Settings → Report PDF Paper Size.
  - The file is `financial-statements_{start}_{end}.pdf`.
- **Fixed Asset Reconciliation** — `GET /api/fixed-assets/reports/reconciliation` (fixed-assets router) returns, per asset type, the count of registered assets, cost, accumulated depreciation and book value, with totals. A note says to compare these against the mapped GL accounts. There is no period.
- **Budget vs Actual** — The card opens `BudgetsPage.showVariance()`, which calls `GET /api/budgets/variance?year=` (budgets router). Each budgeted account gets a table of Budget, Actual and Variance rows across 12 months plus a Total, with variances coloured green or red.
  - It uses the year chosen on the Budgets page and ignores the modal's period select.
- **Nonprofit statements** — Statement of Activities, Statement of Financial Position, Fund Balances, Statement of Functional Expenses and the Pledge Report each come as JSON, PDF and CSV.
  - Prior-year comparison is available on Statement of Activities and Statement of Functional Expenses.
  - Year-End Giving Statements can be downloaded as one PDF or emailed to everyone.
  - These live in the reports router and the Report Center but are documented in the nonprofit section.

_Key files: `app/routes/reports/financial.py`, `app/routes/reports/nonprofit.py`, `app/routes/reports/donors.py`, `app/routes/fixed_assets.py`, `app/routes/budgets.py`, `app/static/js/budgets.js`, `app/static/js/reports.js`_

### Schedule C & tax-line mappings (`#/tax`)
- **Tax Reports page** — Open it from the sidebar **Tax Reports** link (`#/tax`). The header reads "Tax Reports — Schedule C" with the subtitle "Profit or Loss from Business (Sole Proprietorship)".
  - The toolbar has From and To dates (default Jan 1–Dec 31 of the current year), **Generate**, **Export CSV** and **Pay Sales Tax**.
  - A yellow banner reads "This report is for reference only…".
- **Schedule C data** — `GET /api/tax/schedule-c?start_date&end_date` puts each income, COGS and expense account's period activity on one Schedule C line.
  - **Lines (28, in form order)** —
    - Part I: 1 Gross receipts or sales; 2 Returns and allowances; 4 Cost of goods sold; 6 Other income.
    - 8 Advertising; 9 Car and truck; 10 Commissions and fees; 11 Contract labor; 12 Depletion; 13 Depreciation and section 179; 14 Employee benefit programs; 15 Insurance (other than health).
    - 16a Interest – mortgage; 16b Interest – other; 17 Legal and professional; 18 Office expense; 19 Pension and profit-sharing.
    - 20a Rent or lease – vehicles, machinery, equipment; 20b Rent or lease – other business property; 21 Repairs and maintenance; 22 Supplies; 23 Taxes and licenses.
    - 24a Travel; 24b Deductible meals; 25 Utilities; 26 Wages; 27a Other expenses; 27b Energy efficient commercial buildings deduction.
  - **Line choice per account** — The first rule that applies wins:
    - A user mapping whose text names a known line, such as "Line 18", "Schedule C, Line 20b" or "Line 27 - Other". The pattern is `line\s*(\d{1,2}[ab]?)`, and a bare 27 means 27a.
    - A user mapping that names no known line. It becomes its own labelled line, counted in the part that matches the account's type.
    - The seeded chart's default for the exact account number. This applies only when the account's type matches that line's part, because an imported chart's 5000 may not be COGS.
    - Otherwise, by type: income → 1, COGS → 4, expense → 27a.
  - **Seeded defaults** —
    - Income: 4000, 4100, 4200 and 4300 → 1; 4400 In-Kind and 4900 Other Income → 6.
    - COGS: 5000–5300 → 4.
    - Expenses: 6000 → 8; 6100 → 9; 6110 Wages and 6160 PTO → 26; 6120 Payroll tax → 23; 6130 Workers comp and 6300 Insurance → 15; 6150 → 14.
    - 6400 → 18; 6500 Rent → 20b; 6600 → 21; 6700 Telephone and 6900 Utilities → 25; 6800 Tools → 22; 6810 Depreciation → 13.
    - 6140, 6200, 6950 and 6960 → 27a.
  - **Signs** — Income lines use credit − debit. Returns, COGS and expenses use debit − credit. So net profit always equals P&L net income, whatever the mapping.
  - **Totals** — `gross_receipts` (line 1), `returns_and_allowances` (2), `cost_of_goods_sold` (4), `gross_profit` (5), `other_income` (6), `gross_income` (7), `total_expenses` (28) and `net_profit` (31).
- **Screen** — Each Tax Line appears as a header row with its total, followed by account rows (number, name, amount).
  - The summary shows Gross receipts; Returns (only if any, shown negative); Cost of goods sold (if any, negative); Other income (if any); Gross Income; Total Expenses; and Net Profit (Loss).
- **CSV** — `GET /api/tax/schedule-c/csv` produces `schedule_c_{start}_{end}.csv` through the formula-injection-safe writer:
  - A title, the period, and the header `Tax Line | Account # | Account Name | Amount`.
  - Account rows and "Total: …" rows.
  - Summary rows for lines 1, 2, 4, 6, 7, 28 and 31, then a disclaimer.
  - There is no Schedule C PDF.
- **Mappings API** — `GET /api/tax/mappings` lists mappings with account name and number. `POST /api/tax/mappings {account_id, tax_line}` upserts, with one mapping per account (unique).
  - There is no UI and no delete endpoint.

_Key files: `app/routes/tax.py`, `app/services/tax_export.py`, `app/models/tax.py`, `app/schemas/tax.py`, `app/static/js/tax.js`_

### Report PDFs & CSV output
- **Shared renderer** — `generate_report_pdf(sections, settings)` renders `report_pdf.html` with the `_report_theme.html` partial.
  - A section is `{title, period, columns, rows[{cells, style}]}`.
  - Style `subtotal` is bold with a top rule. Style `grand-total` is bold with a 2 pt top rule and a double bottom rule.
  - The first column is left-aligned; the others are right-aligned amount cells.
  - The renderer serves the P&L, Balance Sheet, Trial Balance, General Ledger, the statements pack, the nonprofit statements and pledge report, and the bank reconciliation report PDF.
- **Page theme** — Paper size comes from the `pdf_paper_size` setting (Settings → "Report PDF Paper Size": US Letter by default, or A4).
  - Margins are 18/16/20/16 mm, with a Helvetica-family 10.5 px body.
  - The header shows the company logo (up to 44 px high and 160 px wide), the report title and the company name. At the right are the period and "Generated {date}".
  - The logo is the company's own stored logo, embedded as a data URI.
  - Each additional section starts on a new page.
- **Footer** — Every page carries "{company name} — page N of M" in 8 px grey.
  - The name comes from the page itself through CSS `string-set`, not text written into the style block. So names containing "&" or quotes print exactly as written.
- **PDF safety and accessibility** — Templates use Jinja autoescape. The WeasyPrint URL fetcher accepts only `data:` URIs, so it never fetches `file://` or http resources.
  - Output is tagged PDF/UA-1, falling back to a plain PDF if that fails.
  - Files are served `inline` with names like `general-ledger_{start}_{end}.pdf`.
- **Money format** — PDFs print "$1,234.50" and "-$10.00". CSV amounts are Decimals to 2 places with no currency sign or thousands separator, so spreadsheets read them as numbers.
- **CSV conventions** — Ledger exports start with a 4-line preamble: Company, Report, Period, then a blank line.
  - A text cell starting with =, +, −, @, TAB or CR gets an apostrophe prefix, which guards against formula injection.
  - A UTF-8 byte-order mark is added so Excel opens the file correctly.
  - `Content-Disposition` is `attachment` in a browser and `inline` in the desktop shell.

_Key files: `app/services/pdf_service.py`, `app/templates/report_pdf.html`, `app/templates/_report_theme.html`, `app/services/ledger_exports.py`, `app/services/csv_export.py`, `app/routes/csv.py`, `app/main.py`_

### Saved reports
- **Model** — Each `saved_reports` row stores id, name (up to 200 characters), report_type (indexed), parameters (JSON), created_at and updated_at.
  - Only parameters are stored; results are never cached, so reopening re-runs the live report.
  - Saved reports are company-wide, with no per-user owner.
- **API** — `GET /api/saved-reports?report_type=` lists them, ordered by name.
  - `POST /api/saved-reports` requires a non-blank name and one of 15 allowed types. Parameters must be JSON-serializable and at most 64 KB.
  - `GET`, `PUT` and `DELETE /api/saved-reports/{id}` are also available. PUT changes only the name or parameters.
  - Allowed types: profit_loss, balance_sheet, ar_aging, ap_aging, sales_tax, general_ledger, income_by_customer, account_transactions, cash_flow, analytics_dashboard, statement_of_financial_position, statement_of_activities, fund_balances, functional_expenses, pledges.
- **Saving** — **Add to Saved Reports…** appears in the period modal of the P&L, Balance Sheet, Sales Tax, General Ledger, Income by Customer, A/R Aging, A/P Aging, Cash Flow and the five nonprofit statements.
  - It prompts for a name and stores `{period, start_date, end_date}`, or `{period, as_of_date}` for as-of reports.
  - A toast says the report is listed at the top of the Report Center.
  - A saved preset such as This Month reopens relative to today. A saved Custom Date range reopens with its stored dates.
  - Trial Balance, P&L by Class, the job reports, 1099 Summary, the statements pack and drill-downs have no save button.
- **List UI** — A "Saved Reports (N)" table shows Name, Report, Period and Open/Delete buttons, sorted by name.
  - The list collapses and expands (▸/▾). It starts collapsed when there are more than 6 entries and no stored choice; the choice is remembered in `localStorage` `sb_saved_reports_collapsed`.
  - A Filter box appears above 8 entries.
  - Types without an opener (`account_transactions`, `analytics_dashboard`) show the toast "No opener registered".
  - There is no rename in the UI.

_Key files: `app/routes/saved_reports.py`, `app/models/saved_reports.py`, `app/static/js/reports.js`_

### Global search (Ctrl+K)
- **Where** — The toolbar box has the placeholder "Search customers, invoices...", reworded for nonprofits.
  - **Ctrl+K** focuses it. So does **/** when focus is not in a field.
  - Typing searches after a 300 ms pause once there are at least 2 characters.
  - Escape clears the box, and clicking elsewhere closes the dropdown.
- **API** — `GET /api/search?q=` requires `q` of at least 2 characters (422 otherwise). Matching is case-insensitive `ILIKE %q%`, with at most 5 results per category. Searched fields:
  - Customers (active only): name, company, email.
  - Vendors (active only): name, company.
  - Items (active only): name, description.
  - Invoices (not sales receipts), sales receipts, bills, credit memos and estimates: document number.
  - Payments: reference or check number.
  - Documents come back newest first.
- **Amount search** — A query that fully matches an amount (`612`, `612.30`, `$1,234.50`; up to 2 decimals) also finds documents to the cent.
  - The match uses a ±½-cent window, so values SQLite stores as floats still match exactly.
  - Invoices and bills match by total, or by balance due (voids are skipped for the balance match).
  - Sales receipts, credit memos and estimates match by total; payments by amount.
- **Results** — Grouped under category headings. Documents read "number · who · amount"; payments read "date · customer · amount".
  - Invoices, sales receipts, bills and payments open the document.
  - Customers, vendors, items, estimates and credit memos go to their list page.
- **Not searched** — Journal entries, checks and expenses, deposits, purchase orders, vendor credits, bill payments, jobs, accounts and employees. `%` and `_` in the query act as SQL wildcards.

_Key files: `app/routes/search.py`, `app/static/js/app.js`, `app/static/js/bootstrap.js`, `app/static/js/utils.js`, `index.html`_

### Company Snapshot dashboard (`#/`)
- **Page** — The home route `#/` opens from Alt+H or the toolbar Home button.
  - The title is "{Company} Snapshot", or "Company Snapshot" when the name is unset or "My Company".
  - The card list comes from `GET /api/dashboard/widgets`, and all card data from one `GET /api/dashboard/data?ids=…` request.
  - A card whose builder fails shows its own error in place, without breaking the page.
- **Grid** — Four columns: `stat` tiles span 1, `half` panels 2, and `full` panels 4. Under 900 px the grid drops to 2 columns, and under 560 px to 1.
- **Card catalog (16)**
  - **Total Receivables** (stat) — The A/R Aging report's TOTAL as of today: home currency, net of credits, equal to account 1100. It adds "N overdue", counting open invoices with a balance due before today's local date.
  - **Overdue Invoices** (half) — The 5 oldest overdue invoices (number, customer, balance, days overdue). Each row opens the invoice, and an "N overdue in all →" link appears when there are more.
  - **Active Customers** (stat) — The count of active customers.
  - **Total Payables** (stat) — The sum of `balance_due` on unpaid and partial bills, plus an overdue count.
  - **Bank Balances** (full) — One tile per active bank and credit-card account with its ledger balance. Cards are tagged "owed", and a tile opens that register (`#/banking/{id}`).
  - **A/R Aging** (half) — The report's own figures as a stacked bar: Current (before credits), 1-30, 31-60 and 61+. A legend, a "Credits not yet applied" line and the Total (equal to Total Receivables) follow.
  - **Monthly Revenue** (half) — Ledger income (income accounts' credit − debit) for each of the last 12 months, one bar per month with a tooltip.
  - **Recent Invoices** / **Recent Payments** (half each) — The last 5 records created. Invoices show number, customer, date, status and total; sales receipts and voids are included. Payments show date, customer, method and amount.
  - **P&L: This Month vs Last** (half) — Income, expenses (COGS + expense) and net from posted lines for the whole current calendar month and the previous month. It shows the net change with ▲/▼ and a "Full P&L" link to the Report Center.
  - **P&L: Year to Date** (half) — Income, expenses and net from Jan 1 to today, with one bar per month showing cumulative net. The current month runs to date, and a bar turns red when cumulative net is negative.
  - **Balance Sheet Trend** (full) — Assets, liabilities and equity at each of the last 12 month-ends, with the current month capped at today. Un-closed net income is folded into equity, as in the Balance Sheet report, so the series balances at every point. It is drawn as a Chart.js line chart with the latest values in the legend.
  - **Cash Position** (half) — Cash in active bank accounts (ledger), plus open receivables due within 30 days, minus open payables due within 30 days, gives the 30-day forecast. Overdue items are included, and the card notes "Assumes customers pay on the due date."
  - **Open Purchase Orders** (half) — Sent, partial and received POs: count, total, and the 5 newest (PO #, vendor, job, status, total).
  - **Receipts to Review** (half) — This company's scanned receipts not yet attached to a document, up to 8, each with the hours left before the 24-hour intake expiry. It links to Enter Expenses.
  - **Jobs: Budget vs Actual** (full) — Active jobs with a budget, committed cost or actual cost, ranked by projected variance with the most over budget first. It shows the top 6, totals for all such jobs, and each row opens its job.
- **Default layouts** — Business companies get Total Receivables, Overdue Invoices, Active Customers, Total Payables, Bank Balances, A/R Aging, Monthly Revenue, Recent Invoices and Recent Payments, which is exactly the pre-2.8 overview.
  - Nonprofits get Total Receivables (shown as "Pledges Receivable"), Overdue Invoices, Active Customers, Bank Balances, Monthly Revenue, Recent Payments, P&L This Month vs Last, Cash Position and Jobs Budget vs Actual (shown as grants).
- **Customize** — The Customize button, hidden for read-only sign-ins, enters edit mode:
  - ▲/▼ reorder a card and × hides it.
  - **+ Add a card** opens a modal listing the cards not on the page, with their descriptions.
  - **Reset** asks for confirmation and returns to the default layout.
  - **Cancel** and **Save layout** end edit mode.
  - The layout is stored per login as the preference key `dashboard` = `{"order": [...]}` (`PUT` / `DELETE /api/preferences/dashboard`).
  - A single-password operator session shares one row (user_id NULL).
  - Unknown card ids are dropped, and an empty saved order falls back to the default layout.
  - The preferences API requires a key matching `^[a-z][a-z0-9_]{0,49}$` and a JSON-object value of at most 16,000 bytes.
- **Wording and theme** — Card titles and descriptions go through the terminology layer, for example "Pledges Receivable", "Overdue Pledges", "Active Donors", "Activities: Year to Date", "Statement of Financial Position Trend" and "Grants: Budget vs Actual". The trend chart redraws when the theme changes.

_Key files: `app/routes/dashboard.py`, `app/services/dashboard_widgets.py`, `app/static/js/dashboard.js`, `app/routes/preferences.py`, `app/models/preferences.py`, `app/static/css/style.css`_

### Analytics page (`#/analytics`)
- **Entry points** — The sidebar **Analytics & AI** link opens `#/analytics`, whose page header reads "Analytics". `GET /analytics` 307-redirects old bookmarks to `/#/analytics`.
- **Controls** — The toolbar has:
  - A Period select: Month to Date, Quarter to Date or Year to Date. The choice is remembered while navigating.
  - ↻ Refresh, Export CSV, Export PDF and ✨ AI Insights.
  - The status bar shows progress messages while data loads.
- **Basis** — Figures are on a **paid basis**:
  - Revenue counts invoices and sales receipts dated in the period **and paid in full** (status PAID).
  - Expenses count bills dated in the period and paid in full.
  - A note on screen and in the PDF explains that the P&L is accrual, so the two can differ.
- **KPI cards (4)** — Revenue (paid invoices), Expenses (paid bills), DSO (Days), and Margin % = (revenue − expenses) ÷ revenue × 100 (0 without revenue). Hover titles explain the basis and the DSO formula.
- **Charts** — Charts use Chart.js 4.4.6, self-hosted as `chart.umd.js` (about 206 KB, no CDN):
  - Revenue Trend: a filled line, "Monthly Paid Revenue", over the last 12 calendar months.
  - Expenses by Category: a doughnut with an 8-colour palette and the legend at the right.
  - A/R Aging and A/P Aging: horizontal stacked bars per customer or vendor, stacked Current, 30+, 60+ and 90+ days.
  - 90-Day Cash Forecast: lines for cumulative collections and payments, with green or red Net bars.
  - Axes and tooltips are currency-formatted, and the charts rebuild when the theme is toggled.
- **Tables** — The page also shows:
  - Revenue by Customer and Expenses by Category, sorted high to low.
  - Aging tables with Current, 30+, 60+, 90+ and Total columns, worst first, plus a TOTAL row.
  - A cash forecast table with Due by, Expected Collections, Expected Payments and Net columns.
- **Exports** — Export CSV and Export PDF download `/api/analytics/export.csv|pdf?period=` for the selected period, with a toast such as "CSV download started".

_Key files: `app/static/js/analytics.js`, `app/routes/analytics.py`, `app/static/js/chart.umd.js`, `app/main.py`_

### Analytics engine, API & exports
- **Period resolution** — Every data endpoint takes either `period` or explicit dates:
  - `period=month|quarter|year`, also `mtd|qtd|ytd`, case-insensitive. An unknown name falls back to month.
  - Explicit `start_date` and `end_date` win over `period`. A missing side defaults to Jan 1 or today, and the label becomes "custom".
  - The default is month to date, and each response echoes `period {name, start, end}`.
- **Metrics (`AnalyticsEngine`)**
  - `revenue_by_customer` — The sum of `Invoice.total` for PAID invoices dated in the window, by customer name.
  - `revenue_trend` — PAID invoice totals per calendar month for the last 12 months, in one query. Months with no revenue appear as 0.
  - `expenses_by_category` — `BillLine.amount` on PAID bills dated in the window, keyed by account number, else account name, else "Uncategorized".
  - `ar_aging` / `ap_aging` — Taken from the A/R and A/P Aging reports as of today, shaped `{current, 30, 60, 90}` → name → amount.
    - Buckets are by days past due, in home currency, with credits netted into Current, so Current can be negative.
  - `dso` — The A/R Aging total divided by PAID invoices dated in the last 30 days (home currency), times 30. It is 0 when there is no recent paid revenue.
  - `cash_forecast(days)` — Cumulative open receivables (draft, sent or partial invoices with a due date) and open payables (unpaid or partial bills with a due date) due on or before each weekly cutoff from today, plus the final day.
    - A 90-day forecast has 14 points, each `{date, collections, payments, net}`, in home currency, from two queries.
  - `customer_profit` — Lifetime PAID revenue per customer, revenue only, with every customer listed. It appears in the CSV but not on the page or in the PDF.
- **Windowing** — Only revenue by customer and expenses by category follow the period. The trend always covers the last 12 months, the agings are as of today, and the forecast covers the next 90 days.
- **CSV export** (`/api/analytics/export.csv`) — The file `slowbooks-analytics-{date}.csv` starts with a byte-order mark and comment rows:
  - "# Slowbooks Pro 2026 — Analytics Snapshot", "# Company: …", "# Period: …" and "# Generated: {UTC ISO}", then a blank row.
  - Data rows follow as `section,key,subkey,value`: period, revenue_by_customer, revenue_trend, expenses_by_category, ar_aging (bucket and name), ap_aging, dso, cash_forecast (collections, payments and net per date) and customer_profit.
  - Names are apostrophe-guarded against formula injection.
- **PDF export** (`/api/analytics/export.pdf`) — Rendered from `analytics_pdf.html` and sent as an `attachment` named `slowbooks-analytics-{date}.pdf`.
  - Always US Letter with 0.75 in × 0.6 in margins, and the footer "Slowbooks Pro 2026 · Page N of M".
  - The header shows the company logo and name, "Analytics Snapshot", a text "SlowBooks Pro 2026" wordmark and the period.
  - The body has a Key Metrics strip with the same 4 KPIs and the basis note, then tables for revenue trend, revenue by customer, expenses by category, A/R aging, A/P aging and the 90-day forecast. There are no charts.
- **Performance notes** — The revenue trend and cash forecast are one- and two-query designs; the forecast code comment says it "was 28 queries".
  - Responses over 1 KB are gzip-compressed (level 5).
  - By code reading, the full snapshot now takes about 20 queries, not the 10 the docs claim.
  - The difference comes from the A/R Aging report running twice (for the aging chart and inside DSO) and A/P Aging taking 5 queries.
- **Per-metric endpoints** — `/api/analytics/revenue`, `/api/analytics/expenses`, `/api/analytics/cash-flow?days=7..365` (default 90; forecast, DSO and both agings) and `/api/analytics/profitability`. They are kept for API consumers; the SPA does not call them.

_Key files: `app/services/analytics.py`, `app/routes/analytics.py`, `app/services/pdf_service.py`, `app/templates/analytics_pdf.html`, `app/routes/csv.py`, `app/main.py`_

### AI Insights — providers & configuration
- **Where** — Configure AI under Settings → **AI Insights** (`#settings-ai`).
  - When a run fails with "not configured", the Analytics page sends the user there through a sessionStorage focus hint.
  - Only an administrator can change the settings. Other roles see the fields locked with "AI settings are changed by an administrator."
- **Providers (8)** — Every request uses `max_tokens` 1,024, temperature 0.3 and a 60-second timeout unless noted.
  - **xAI Grok** (`grok`) — Default `grok-4-fast`, also grok-3. Calls `https://api.x.ai/v1/chat/completions`.
  - **Groq (LPU Cloud)** (`groq`) — Default `llama-3.3-70b-versatile`, also llama-3.1-8b-instant and mixtral-8x7b-32768. Calls `https://api.groq.com/openai/v1/chat/completions`.
  - **Cloudflare Workers AI (direct)** (`cloudflare`) — Default `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, also `@cf/meta/llama-3.1-8b-instruct` and `@cf/mistral/mistral-7b-instruct-v0.1`.
    - Needs the 32-hex account ID and a Cloudflare API token as the key.
    - Calls `https://api.cloudflare.com/client/v4/accounts/{id}/ai/v1/chat/completions`.
  - **Cloudflare Worker Gateway (self-hosted)** (`cloudflare_worker`) — The same models. Needs `worker_url`, and the "key" is the Worker's shared secret.
  - **Anthropic Claude** (`anthropic`) — Default `claude-sonnet-4-6`, also claude-opus-4-7 and claude-haiku-4-5-20251001.
    - Calls `POST https://api.anthropic.com/v1/messages` with headers `x-api-key` and `anthropic-version: 2023-06-01`.
  - **OpenAI** (`openai`) — Default and only listed model `gpt-5.4-mini`. Sends `max_completion_tokens`.
    - Reasoning models (ids starting gpt-5, gpt-6, o1, o3 or o4) get an 8,192-token ceiling and no temperature.
  - **Google Gemini** (`gemini`) — Default `gemini-2.5-flash`, also gemini-2.5-pro, gemini-2.0-flash and gemini-2.0-flash-lite.
    - Calls `v1beta/models/{model}:generateContent?key=…`, with the key in the query string, plus `systemInstruction` and `generationConfig`.
  - **Custom (OpenAI-compatible)** (`custom`) — No default model, so the user types one. Requires `endpoint_url`.
- **Form fields** — The Settings form has:
  - Provider, with a free-tier hint and a "Get a key" link.
  - Model: a curated dropdown plus a "Custom…" free-text option.
  - Cloudflare Account ID, shown only for the direct Cloudflare provider.
  - A Worker URL fieldset, shown only for the gateway, with placeholder `https://slowbooks-ai.yourname.workers.dev/v1/chat/completions`.
  - A Custom Base URL fieldset, with placeholder `https://api.example.com/v1`.
  - API Key / Shared Secret: a password field showing "(saved ✓)" and a **Remove** button once a key is stored.
  - **Test** and **Save AI settings** buttons.
  - The values are stored in settings keys `ai_provider`, `ai_model`, `ai_api_key` (encrypted), `ai_cloudflare_account_id`, `ai_worker_url` and `ai_endpoint_url`.
- **`GET /api/analytics/ai-config`** — Returns provider, model, account ID, worker and endpoint URLs, `has_api_key` and `api_key_encrypted`. It also returns the provider catalog: label, default model, model choices, docs URL, hint and the needs_* flags. It never returns the key.
- **`PUT /api/analytics/ai-config`** (admin) — Validates the provider id and the account ID (`^[a-f0-9]{32}$`), and validates and stores normalized worker and endpoint URLs.
  - Every save overwrites the provider, model, account ID and both URLs.
  - For `api_key`: omitted means keep; a non-empty value is Fernet-encrypted and replaces the stored key; `""` removes it. The Settings page sends a key only when one is typed, and sends `""` only from Remove.
  - A save clears the insights cache and returns the same shape as GET.
- **`POST /api/analytics/ai-config/test`** (admin, 20/min) — Requires a provider, a key and any provider-specific extras. It sends "Reply with the word "ok" and nothing else." under a one-word system prompt.
  - The response has provider, label, model, reply (up to 200 characters) and `tested_at`.
  - The Test button saves the form first.

_Key files: `app/services/ai_service.py`, `app/routes/analytics.py`, `app/static/js/settings.js`, `app/static/js/analytics.js`_

### AI security & guard rails
- **Key encryption** — The key is encrypted with Fernet (AES-128-CBC + HMAC-SHA256) and stored as `fernet:v1:…`. The master key is the first of:
  - The `SETTINGS_ENCRYPTION_KEY` environment variable.
  - The `.slowbooks-master.key` file (mode 0600).
  - A key derived (HKDF-SHA256) from a real `PAYROLL_ENCRYPTION_SECRET`. During rotation, the previous secret still decrypts.
  - A newly generated key, written to the file with a logged warning.
  - A stored key that no master key decrypts reads as "not configured", and Settings lists it to be entered again.
  - A legacy plaintext key is used as-is and reported as `api_key_encrypted: false`.
- **SSRF / MITM guard for user URLs** — `validate_worker_url` checks the worker and custom endpoint URLs at save time and again at call time:
  - https only, at most 2,048 characters, no whitespace or control characters, and no embedded user:password.
  - A host is required. `localhost`, `*.localhost`, `ip6-localhost`, `ip6-loopback`, `broadcasthost` and `0.0.0.0` are refused.
  - IP literals and every DNS answer are refused if private, loopback, link-local (such as 169.254.169.254), multicast, unspecified or reserved. A DNS lookup failure is not fatal.
  - Host characters must be `[a-z0-9._-]` with no `..`, and the port must be 1–65535.
  - Query and fragment are stripped. An empty path becomes `/v1/chat/completions`, and the custom provider appends `/chat/completions` unless it is already there.
  - As a result, a model on localhost or the LAN is deliberately unreachable.
- **Outbound allowlist** — Fixed providers must call their hard-coded origins: `api.x.ai`, `api.groq.com`, `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com` and `api.cloudflare.com`. The check runs at the network call itself.
- **Hardened HTTP client** — `verify=True`, `follow_redirects=False`, User-Agent `slowbooks-pro-ai/1.0` and a 60 s timeout.
- **Error handling** — A provider error returns 502, with the key replaced by `***REDACTED***` and the body cut to 500 characters.
  - A network error reports only "network error".
  - An empty or unparseable reply raises an error.
  - A reply cut off at the token limit tells the user to retry or pick a smaller or non-reasoning model.
- **Rate limits** — slowapi limits per client IP, and `RATE_LIMIT_ENABLED=0` turns them off:
  - Test: 20 per minute.
  - Insights: 10 per minute.
  - Analyses: 20 per minute.
  - ai-query: 10 per minute.
- **Roles** — Changing the configuration and running Test are admin-only.
  - Admins and bookkeepers can run insights, analyses and queries (POST).
  - Read-only sign-ins are blocked, and the AI cards are hidden for them.
- **What leaves the machine** — Nothing is sent until a button is clicked. Then:
  - Insights send the company name, aggregated figures, and customer and vendor names with amounts.
  - Analyses send up to 8,000 characters of JSON rows.
  - ai-query sends tool results, which include customer and vendor emails and phone numbers.

_Key files: `app/services/ai_service.py`, `app/services/crypto.py`, `app/routes/analytics.py`, `app/services/rate_limit.py`, `app/main.py`_

### AI Insights brief
- **Run** — The ✨ AI Insights button calls `POST /api/analytics/ai-insights?period=…[&force=true]`.
  - It returns 400 when there is no provider or key, or when the account ID, worker URL or endpoint URL a provider needs is missing.
  - A provider error returns 502.
- **Prompt** — The **system prompt** asks for a senior financial analyst who uses only the numbers given and cites names, codes and amounts.
  - It asks for under 400 words, in sections Observations, Risks and Recommendations with 3 bullets each.
- **User prompt** — Starts with "Financial snapshot for {company} — {PERIOD} (start → end)" and includes:
  - Key metrics: revenue, expenses, net income, margin and DSO.
  - The top 5 revenue customers and top 5 expense categories.
  - The last 6 months of the revenue trend.
  - The 3 worst A/R and A/P balances.
  - A 90-day forecast summary built from the first and last buckets.
- **Cache** — Results are kept in an in-process dict for 10 minutes (600 s).
  - The key is provider, model, period label, start and end.
  - `force=true` bypasses the cache, and every configuration save clears it.
  - The cache is per process and is lost on restart.
- **Response** — `{insights, provider, provider_label, model, generated_at (date), period, cached}`.
- **UI** — The ✨ AI Insights card sits above the KPIs.
  - Its empty state says "Nothing is sent until you click". A spinner shows while it runs.
  - A meta line shows provider · model · date, with a "cached" badge when the result came from the cache.
  - A small markdown-ish renderer escapes the reply and formats ### and ## headings, - and * bullets, and paragraphs.
  - The last result survives navigation. The UI has no force-refresh control.

_Key files: `app/services/ai_service.py`, `app/routes/analytics.py`, `app/static/js/analytics.js`_

### AI Predefined Analyses
- **Catalog** — `GET /api/analytics/ai-actions` returns groups of `{category, actions[{key, label, uses_period}]}`. For nonprofits, labels and categories are reworded, for example "Donors & Contributions".
- **Actions (11)** — Each entry below is category · key · label · data tool · period use. "As of today" actions ignore the period.
  - Customers & Sales · `top_customers` · Top customers by revenue · `get_sales_by_customer` · uses the period.
  - Customers & Sales · `unpaid_invoices` · Unpaid invoices summary · as of today.
    - It calls `search_invoices` for sent, partial and draft (200 each) and keeps balances above 0.
    - It returns the top 50 by balance, the count and the total outstanding.
  - Customers & Sales · `ar_aging` · A/R aging · `get_aging_report` (A/R buckets and total) · as of today.
  - Vendors & Bills · `expenses_by_category` · Expenses by category · `get_expenses_by_category` · uses the period.
  - Vendors & Bills · `unpaid_bills` · Unpaid bills summary · `search_bills` for unpaid, partial and draft (200 each), top 50 · as of today.
  - Vendors & Bills · `ap_aging` · A/P aging · `get_aging_report` (A/P) · as of today.
  - Banking & Cash · `cash_position` · Cash position by account · as of today.
    - It calls `list_accounts(asset, 100)`, keeps names containing cash, bank, checking, savings or undeposited, sorts them and adds a total.
  - Banking & Cash · `recent_payments` · Recent payment activity · `search_payments` (limit 100) · uses the period.
  - Financial Reports · `pl_analysis` · P&L analysis · `get_pl_summary` (lifetime; the period is ignored) · as of today.
  - Financial Reports · `balance_sheet` · Balance sheet analysis · `get_balance_sheet` · as of today.
  - Tax · `sales_tax` · Sales tax position · `get_tax_summary` · uses the period.
- **Run** — `POST /api/analytics/ai-actions/{key}?period=…` (20/min) makes one one-shot call with no tool calling.
  - Errors: 404 for an unknown key, 400 when AI is not configured or the config is invalid, and 502 for a provider error.
  - Avoiding tool calling lets it work with every provider, including Groq/Llama models that emit the legacy `<function=…>` syntax.
  - **System prompt** — Asks for a senior bookkeeping analyst, `### Observations / ### Risks / ### Recommendations` headings, and 2–3 action items. It asks for concise answers that quote numbers and don't speculate.
  - **User prompt** — Contains the action's framing line, "Period: start to end" or "As of: today", then "Data:" followed by indented JSON cut at 8,000 characters with "…(truncated)", then "Write the analysis."
- **Response** — `{action_key, label, category, framing, analysis, data, provider, model, uses_period, period}`.
- **UI** — The "🧠 AI Analysis" card has a grouped dropdown ("Choose an analysis…") and **Run Analysis**.
  - The result shows a meta line (label · provider · model · period), the rendered analysis and a **Clear** button.
  - Period-aware actions use the page's period select.

_Key files: `app/services/ai_actions.py`, `app/services/ai_tools.py`, `app/routes/analytics.py`, `app/static/js/analytics.js`_

### AI Q&A tool calling (`ai-query`) & read-only tools
- **Endpoint** — `POST /api/analytics/ai-query?question=…` (10/min) runs a tool-calling loop of at most 8 model calls over the 16 tools.
  - It returns `{provider, model, final_response, tool_calls[{tool_name, params, result}], call_count, success}`.
  - When the call budget runs out, it returns "Max tool calls reached without final response" with `success: false`.
  - It is a legacy endpoint: the chat panel was removed, and no UI calls it.
- **Wire formats** — The tools are sent in each provider's format:
  - OpenAI-style `tools` (function schemas) for grok, groq, openai, cloudflare, the Worker gateway and custom.
  - Anthropic `tools` with `input_schema`.
  - Gemini `functionDeclarations`, without a `required` list.
  - Tool results go back as `tool`, `tool_result` or `functionResponse` messages.
  - The loop sends no system instructions.
- **Tool safety** — Every tool only reads.
  - An unknown tool returns `{"error": "Unknown tool: {name}"}`.
  - An exception returns only its class name, such as "search_bills failed: TypeError", so no SQL or stack text reaches the model.
  - No tool reads settings.
- **The 16 tools** —
  - `search_bills(vendor_name, start_date, end_date, status draft|unpaid|partial|paid|void, limit=50)` — Returns number, vendor, date, total, balance and status, newest first.
  - `search_invoices(customer_name, start_date, end_date, status draft|sent|partial|paid|void, limit=50)` — The same fields for invoices.
  - `search_transactions(description, start_date, end_date, limit=100)` — Journal entries whose description or reference matches. Returns id, date, reference, description and source type.
  - `list_vendors(name_filter, limit=100)` and `list_customers(name_filter, limit=100)` — Return id, name, company, email, phone and the home-currency balance, net of credits.
  - `list_accounts(account_type asset|liability|equity|income|expense|cogs, limit=100)` — Returns number, name, type and the stored running balance.
  - `get_account_balance(account_id)` — The stored balance of one account.
  - `get_pl_summary()` — Lifetime totals of income, expense, COGS and net, from stored balances.
  - `get_balance_sheet()` — Total assets, liabilities and equity from stored balances, plus `accounting_equation_balanced` (true within $0.01).
  - `get_tax_summary(start_date, end_date)` — Tax on invoices dated in the range, plus bill-line totals by account.
  - `get_sales_by_customer(start_date, end_date)` — Invoice totals per customer, tax included, sorted highest first.
  - `get_expenses_by_category(start_date, end_date)` — Bill-line totals by account for bills dated in the range.
  - `get_aging_report()` — A/R and A/P bucket totals from the aging reports (home currency, credits netted), plus unapplied credits and outstanding totals.
  - `get_current_date()` — The server date and a UTC timestamp.
  - `search_payments(customer_name, start_date, end_date, limit=50)` — Customer payments with amount, method and reference.
  - `search_bill_payments(vendor_name, start_date, end_date, limit=50)` — Vendor payments with amount, method and check number.

_Key files: `app/services/ai_tools.py`, `app/services/ai_service.py`, `app/routes/analytics.py`_

### Self-hosted Cloudflare Worker gateway (`cloudflare/`)
- **Purpose** — `cloudflare/worker.js` runs in the user's own Cloudflare account.
  - It calls Workers AI through the `AI` binding (`env.AI.run`), so no Cloudflare API token is stored anywhere.
  - SlowBooks stores only the Worker URL and the Bearer shared secret, which it encrypts as the "API key".
  - Each install has its own Worker, secret and quota.
- **Deploy** — `wrangler.toml` sets name `slowbooks-ai`, main `worker.js`, compatibility_date 2026-04-01 and `[ai] binding = "AI"`, with observability enabled at head_sampling_rate 1.0. The steps are:
  - Run `wrangler login`, generate a secret with `openssl rand -hex 32`, store it with `wrangler secret put AUTH_TOKEN`, then run `wrangler deploy`.
  - In SlowBooks, choose the provider "Cloudflare Worker Gateway (self-hosted)", paste the Worker URL and the secret, then Save and Test.
  - Rotate the secret with another `wrangler secret put`. Use `wrangler tail` for logs and `wrangler delete` to uninstall.
- **Request handling** — The Worker checks each request in order:
  - An OPTIONS preflight returns 204. CORS headers are added only for an allow-listed origin.
  - Only POST is accepted (405 otherwise), to a path ending `/chat/completions` (404 otherwise).
  - The `content-length` and body must be at most 512 KB (413 otherwise).
  - It returns 500 if `AUTH_TOKEN` is not set.
  - `Authorization: Bearer <AUTH_TOKEN>` is checked with a padded constant-time comparison (401 on mismatch).
  - Invalid JSON returns 400.
- **Validation and clamps** —
  - The model must be in `ALLOWED_MODELS`, else 400. The default list is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/meta/llama-3.1-8b-instruct` and `@cf/mistral/mistral-7b-instruct-v0.2-lora`.
  - A request with no model uses the built-in default constant.
  - 1–64 messages are allowed, each up to 100,000 characters and 200,000 in total.
  - `max_tokens` is clamped to 1–4,096 (default 1,024), temperature to 0–2 (default 0.3) and top_p to 0–1 (default 1).
  - Up to 32 tools are allowed. Each must be `type: "function"` with a name of at most 256 characters and a string description of at most 1,024 characters.
- **Response** — The Worker translates Workers AI output into an OpenAI `chat.completion`:
  - An `id` of `chatcmpl-…`.
  - `choices[0].message` with the content and any `tool_calls`, whose arguments are JSON strings.
  - `finish_reason` of `tool_calls` or `stop`.
  - `usage` passed through, or zeros.
  - Headers are `x-request-id`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer` and `cache-control: no-store`.
  - Errors are `{error: {message (at most 500 characters), type: "slowbooks_gateway_error"}}`. A Workers AI failure returns 502.
- **Environment variables** —
  - `AUTH_TOKEN` is the required secret.
  - `ALLOWED_MODELS` sets the model allowlist.
  - `ALLOWED_ORIGINS` sets the CORS allowlist; when unset, no CORS headers are sent.
  - `LOG_VERBOSE="1"` turns on JSON logs of request metadata (model, counts, finish reason, token usage), never bodies or the token.
  - A `DEFAULT_MODEL` variable is documented but never read by the code.

_Key files: `cloudflare/worker.js`, `cloudflare/wrangler.toml`, `cloudflare/README.md`, `app/services/ai_service.py`_

### API endpoints
| Method | Path | What it does |
|---|---|---|
| GET | `/api/reports/profit-loss` | P&L JSON (`start_date`, `end_date`; default Jan 1 → today) |
| GET | `/api/reports/profit-loss/pdf` | P&L PDF via the shared report renderer (inline) |
| GET | `/api/reports/profit-loss/csv` | P&L CSV (preamble, Section/Account number/Account name/Amount) |
| GET | `/api/reports/balance-sheet` | Balance Sheet JSON as of `as_of_date` (default today), with un-closed net income folded into equity |
| GET | `/api/reports/balance-sheet/pdf` | Balance Sheet PDF |
| GET | `/api/reports/balance-sheet/csv` | Balance Sheet CSV |
| GET | `/api/reports/trial-balance` | Period-activity trial balance (debits, credits, net per account; totals and difference) |
| GET | `/api/reports/trial-balance/pdf` | Trial Balance PDF (Debit/Credit columns) |
| GET | `/api/reports/trial-balance/csv` | Trial Balance CSV (number, name, type, debit, credit, net) |
| GET | `/api/reports/general-ledger` | GL by account with balance brought forward, running balance and period totals (`account_id` optional) |
| GET | `/api/reports/general-ledger/pdf` | GL PDF |
| GET | `/api/reports/general-ledger/csv` | GL CSV (opening and total rows per account) |
| GET | `/api/reports/account-transactions` | Drill-down: every line on one account in a range, with source links (`account_id` required) |
| GET | `/api/reports/cash-flow` | Statement of cash flows, indirect method |
| GET | `/api/reports/profit-loss-by-class` | P&L split into class columns (line class → header class → Uncategorized) |
| GET | `/api/reports/job-profitability` | Income, costs, net and margin per job, plus a "No job" row (`customer_id` optional) |
| GET | `/api/reports/financial-statements/pdf` | Statements pack PDF: P&L + Balance Sheet + Trial Balance (nonprofit: SoA + SoFP + TB) |
| GET | `/api/reports/ar-aging` | A/R Aging by customer (home currency, credits netted, ties to 1100) |
| GET | `/api/reports/income-by-customer` | Sales, tax, paid and balance per customer for invoices dated in the period |
| GET | `/api/reports/customer-statement/{customer_id}/pdf` | Customer statement PDF as of a date, with a running balance |
| POST | `/api/reports/batch-email-statements` | Email a statement to every customer with an overdue sent or partial invoice |
| POST | `/api/reports/collection-letters` | Generate (and optionally email) 30/60/90-day collection letters |
| GET | `/api/reports/sales-tax` | Sales Tax report (invoices minus credit memos) with a 2200 ledger check and a purchase-tax figure |
| POST | `/api/reports/sales-tax/pay` | Record a sales tax payment: DR 2200 / CR a bank or card account |
| GET | `/api/reports/ap-aging` | A/P Aging by vendor (home currency, vendor credits and unapplied payments netted, ties to 2000) |
| GET | `/api/reports/1099-summary` | Payments applied to bills per 1099 vendor for a year, flagged at $600 |
| GET | `/api/reports/statement-of-financial-position` | Nonprofit Statement of Financial Position (see the nonprofit section) |
| GET | `/api/reports/statement-of-financial-position/pdf` | Nonprofit SoFP PDF |
| GET | `/api/reports/statement-of-financial-position/csv` | Nonprofit SoFP CSV |
| GET | `/api/reports/statement-of-activities` | Nonprofit Statement of Activities (`compare=prior_year` optional) |
| GET | `/api/reports/statement-of-activities/pdf` | Nonprofit SoA PDF |
| GET | `/api/reports/statement-of-activities/csv` | Nonprofit SoA CSV |
| GET | `/api/reports/fund-balances` | Nonprofit fund balances per restricted fund |
| GET | `/api/reports/fund-balances/pdf` | Fund Balances PDF |
| GET | `/api/reports/fund-balances/csv` | Fund Balances CSV |
| GET | `/api/reports/functional-expenses` | Nonprofit Statement of Functional Expenses (`compare=prior_year` optional) |
| GET | `/api/reports/functional-expenses/pdf` | Functional Expenses PDF |
| GET | `/api/reports/functional-expenses/csv` | Functional Expenses CSV (Form 990 Part IX column order) |
| GET | `/api/reports/pledges` | Pledge Report by donor and campaign |
| GET | `/api/reports/pledges/pdf` | Pledge Report PDF |
| GET | `/api/reports/pledges/csv` | Pledge Report CSV |
| GET | `/api/tax/schedule-c` | Schedule C lines, account breakdown and Part I/II totals (default Jan 1–Dec 31) |
| GET | `/api/tax/schedule-c/csv` | Schedule C CSV with summary lines and disclaimer |
| GET | `/api/tax/mappings` | List account → Schedule C line mappings |
| POST | `/api/tax/mappings` | Create or update one account's mapping (`account_id`, `tax_line`) |
| GET | `/api/saved-reports` | List saved report definitions (`report_type` filter), ordered by name |
| POST | `/api/saved-reports` | Save a named `(report_type, parameters)` set (15 allowed types, 64 KB cap) |
| GET | `/api/saved-reports/{report_id}` | Get one saved report |
| PUT | `/api/saved-reports/{report_id}` | Rename or change parameters |
| DELETE | `/api/saved-reports/{report_id}` | Delete a saved report |
| GET | `/api/search` | Global search across 9 entity types, 5 per type, including amount-to-the-cent matching (`q` at least 2 characters) |
| GET | `/api/dashboard/widgets` | Card catalog (id, title, size, description) and the default order, in company vocabulary |
| GET | `/api/dashboard/data` | Data for the comma-separated card `ids` (default layout when empty; a failing card returns `{error}`) |
| GET | `/api/preferences/{key}` | Read a per-user preference (e.g. `dashboard`); `{key, value}` |
| PUT | `/api/preferences/{key}` | Save a preference `{"value": {...}}` (JSON object, at most 16,000 bytes) |
| DELETE | `/api/preferences/{key}` | Reset a preference to the default |
| GET | `/api/analytics/dashboard` | Full analytics snapshot (8 metrics and a period echo) |
| GET | `/api/analytics/revenue` | Revenue by customer (windowed) and the 12-month trend |
| GET | `/api/analytics/expenses` | Paid-bill expenses by account (windowed) |
| GET | `/api/analytics/cash-flow` | Cash forecast (`days` 7–365, default 90), DSO, A/R and A/P aging |
| GET | `/api/analytics/profitability` | Lifetime paid revenue per customer |
| GET | `/api/analytics/export.csv` | Flat `section,key,subkey,value` CSV of the snapshot |
| GET | `/api/analytics/export.pdf` | Analytics Snapshot PDF (Letter, attachment) |
| GET | `/api/analytics/ai-config` | AI configuration for display plus the provider catalog (never the key) |
| PUT | `/api/analytics/ai-config` | Admin: set provider, model, key (encrypted), account ID, worker or endpoint URL |
| POST | `/api/analytics/ai-config/test` | Admin: one-word connectivity test against the configured provider (20/min) |
| POST | `/api/analytics/ai-insights` | Run the Observations / Risks / Recommendations brief (10/min, 10-minute cache, `force`) |
| GET | `/api/analytics/ai-actions` | Catalog of the 11 predefined analyses, grouped by category |
| POST | `/api/analytics/ai-actions/{action_key}` | Run one predefined analysis (20/min) |
| POST | `/api/analytics/ai-query` | Legacy tool-calling Q&A over 16 read-only tools, at most 8 calls (10/min) |
| GET | `/analytics` | App-level, auth-exempt 307 redirect to `/#/analytics` (`app/main.py`) |
| GET | `/api/jobs/budget-vs-actual` | Other router, used by the Report Center card: budget, committed, actual and variance per job |
| GET | `/api/fixed-assets/reports/reconciliation` | Other router, used by the Report Center card: register totals per asset type |
| GET | `/api/budgets/variance` | Other router, used by the Budget vs Actual card: monthly budget vs actual per account |
| POST | `/api/invoices/apply-late-fees` | Other router, used by the A/R Aging "Apply Late Fees" button |
| GET | `/api/banking/reconciliations/{recon_id}/pdf` | Other router: bank reconciliation report rendered with the shared report PDF theme |

### Notes, gaps & discrepancies
- **Docs claim about analytics query count** — `docs/features.md` says the analytics snapshot "issues exactly 10 SQL queries". Its ~26 ms / ~50 ms timings are docs only, not verifiable in code.
  - By code reading, the snapshot now takes about 20 queries. The A/R Aging report runs twice (for the aging chart and inside DSO), and the A/P Aging report takes 5.
  - The `export.csv` comment "Single DB round-trip" refers to one engine call, not one query.
- **Stale Dashboard docs** — `docs/features.md` says "Monthly Revenue Trend — … invoiced revenue", but the card sums income-account ledger activity.
  - The docs' "AR Aging Bar Chart (Current/30/60/90+)" is actually labelled Current/1-30/31-60/61+ and has a credits line.
  - The docs never mention the 16-card customizable catalog.
- **Stale analytics aging docs** — The docs say the charts age open invoice balances by age "using `invoices.balance_due`". The code reads the A/R and A/P Aging reports instead: days past due, home currency, credits netted, so Current can be negative.
- **Empty `api_key`** — `docs/features.md` and the header comment in `app/routes/analytics.py` say an empty `api_key` keeps the stored key. The code and its test treat `""` as "remove"; only an omitted key keeps it.
  - The docs also leave `endpoint_url` out of the GET shape.
  - The docs describe the insights cache key as (provider, model, period); the code also includes the start and end dates.
- **AI actions table in the docs** — It lists "Cash position by account — `list_accounts` + `get_account_balance`". Only `list_accounts` is used. It picks asset accounts by name keywords rather than `bank_kind`, and it includes inactive accounts.
- **AI data quality**
  - The `top_customers` framing says "paid invoices", but `get_sales_by_customer` sums every invoice in the range: drafts and voids included, tax included, at document currency.
  - `get_tax_summary` counts tax on void invoices and doesn't net credit memos. Its `expenses_by_account` ignores the date range.
  - `get_pl_summary`, `get_balance_sheet` and `list_accounts` use the stored lifetime `Account.balance`. The P&L analysis ignores the period, which a code comment acknowledges.
  - `get_balance_sheet.accounting_equation_balanced` compares assets with liabilities + equity without the un-closed net income. It therefore reads false for any company with a lifetime profit or loss, and the Balance sheet analysis passes that flag to the model.
- **Currency in analytics** — Revenue by customer, revenue trend, expenses by category and customer profit sum document amounts with no exchange-rate conversion. Aging, DSO and the forecast use home currency.
  - CHANGELOG 2.18.0 says "the analytics charts … count a EUR invoice at its booked dollars"; that holds only for the aging charts.
- **Dashboard payables vs receivables** — Total Receivables uses the A/R Aging total and so ties to 1100. Total Payables sums raw unpaid and partial `balance_due`, in document currency and not netted of vendor credits or unapplied bill payments, so it can differ from A/P Aging and account 2000.
  - Cash Position's receivables and payables due within 30 days also use raw open balances.
- **A/P Aging credits and as-of dates** — The what's-new text says A/P and A/R aging "show credits you are holding", but the A/P screen has no Credits column. It only nets credits into Current, even though the API returns `unapplied_credits`.
  - A/P Aging doesn't limit bills to those dated on or before the as-of date; A/R does.
  - Both re-age today's open balances instead of reconstructing balances at a past date.
- **Trial Balance meaning** — The Trial Balance shows period activity (gross debits and credits dated in the range), not inception-to-date balances. The docs call it "every account's debit or credit balance for the period". With the default year-to-date range, balance-sheet accounts show only their year-to-date movement.
- **Drill-down gaps** — The Balance Sheet drill-down sends no start date, so the server defaults to Jan 1 of the current year and a prior-year as-of date shows no lines.
  - The synthesized Net Income row is clickable but has no account.
  - The General Ledger leaves out accounts that carry a balance but had no activity in the period.
- **Saved reports** — The API accepts `account_transactions` and `analytics_dashboard`, but the SPA can neither open ("No opener registered") nor save them. The docs say saved reports rerun account drill-downs.
  - The UI has no rename, PUT accepts a blank name, and saved reports are shared company-wide.
- **Schedule C**
  - The module headers in `app/routes/tax.py` and `app/services/tax_export.py` say "output PDF and CSV"; there is no Schedule C PDF.
  - Mappings are API-only, with no screen and no delete endpoint.
  - Negative amounts in the Schedule C CSV are written as text, so the formula guard prefixes them with an apostrophe (`'-120.00`). The ledger CSVs write amounts as numbers instead.
- **1099 Summary vs 1099-NEC** — The Summary sums bill-payment amounts applied to bills, for every 1099 type. The 1099-NEC and 1096 sum the whole `BillPayment.amount`, for NEC vendors only. Neither excludes voided bill payments, because voiding keeps the allocation rows.
- **Cloudflare README is stale** — Step 6 says "Slowbooks → Analytics → ⚙ AI", provider "Cloudflare Workers AI", and to enter the account ID.
  - The gear is gone; configuration lives in Settings → AI Insights.
  - The gateway is the separate `cloudflare_worker` provider, which uses the Worker URL and secret and no account ID.
- **Worker config mismatches** — The Worker's default allowlist includes `@cf/mistral/mistral-7b-instruct-v0.2-lora`, but SlowBooks offers `…-v0.1` for the gateway. That model is rejected with 400 "Model not allowed" unless `ALLOWED_MODELS` is set.
  - The documented `DEFAULT_MODEL` environment variable is never read; the code uses a constant.
- **UI copy mismatches**
  - The Settings AI blurb lists six providers and omits the Worker gateway and Custom.
  - The Analytics Refresh button's title says "Refresh (R)", but no R shortcut exists.
  - The docs' period-selector list omits Last Month, Last Quarter and Last Year to Date; the code has 9 presets.
  - "Only Groq validated end-to-end against a live key" appears in the docs only.
- **AI miscellany**
  - Every AI run requires a non-empty key, even for a custom endpoint that needs none.
  - The insights cache is per process, and `generated_at` is a date, not a timestamp.
  - `ai-query` echoes tool arguments and results back to the model as Python `str()` reprs, not JSON.
  - `ai-query` tools have no cap on `limit`, and the question travels in the URL query string.
- **Settings exposure** — `ai_api_key` is not in the settings redaction and encryption list, because `app/routes/analytics.py` manages it. So, by code reading, `GET /api/settings` returns its stored value; that is the Fernet ciphertext, never plaintext.
  - `upgrade_plaintext_secrets` doesn't upgrade a legacy plaintext AI key.
- **Collections** — Called without `send_email`, `collection-letters` generates the PDFs and discards them, returning counts only. The UI always emails.
- **Dead or odd code**
  - The schemas in `app/schemas/reports.py` are unused.
  - `GET /api/reports/profit-loss-by-class` commits the "Uncategorized" class on first use, a write inside a read.
  - The `UserPreference` model comment says API tokens never write preferences, but nothing stops a token's `PUT /api/preferences/dashboard`. That write lands on the shared user_id-NULL row.
  - An empty saved dashboard layout reverts to the default.

---

_[← 4. Payroll & HR](04-payroll-hr.md) · [Index](README.md) · [6. Nonprofit Mode, Jobs & Job Costing →](06-nonprofit-jobs-job-costing.md)_
