_SlowBooks Pro 2026 feature inventory — [← 5. Reports, Dashboard, Analytics & AI](05-reports-dashboard-analytics-ai.md) · [Index](README.md) · [7. Import, Export, Migration & Interoperability →](07-import-export-migration.md)_

## 6. Nonprofit Mode, Jobs & Job Costing

One setting, **Company Type** (`business` | `nonprofit`), turns a company file into a fund-accounting nonprofit. It swaps the words on screen through one 48-entry dictionary, reveals the nonprofit pages, and adds the net-asset, in-kind and bad-debt accounts. It also enables the fund, restriction and function dimensions, releases from restriction, functional allocations, five nonprofit statements, IRS Pub. 1771 donation receipts, acknowledgment letters, year-end giving statements, in-kind gifts and pledge write-offs. None of this renames anything in the database or the API. The second half of the domain is QuickBooks-style **Customer:Job** job costing: jobs on every posted line, nested cost codes, editable cost types with burden and applied-cost offsets, equipment, Job Cost Entries, cost allocations, time posted to jobs at a loaded rate, budgets per code seeded from estimates, committed cost from open POs, and a budget/committed/actual/projected/variance drill-down. In nonprofit mode a job is presented as a **Grant**. All figures are computed from posted ledger lines, so the job and nonprofit reports reconcile to the P&L and balance sheet.

### Company Type switch & nonprofit account setup
- **Company Type setting** — `company_type` in Settings (default `business`); only `business` and `nonprofit` are accepted (other values → 422 "company_type must be one of: business, nonprofit").
  - UI: Settings → Company Information → **Company Type** select (Business / Nonprofit). The change saves by itself, after a confirm dialog ("Screens will say donor, pledge, donation and fund; the net-asset accounts are added. Nothing in your data changes."). Any other unsaved Settings changes are saved with it, then the page reloads so the shell re-renders in the new words.
  - Switching to nonprofit also calls `POST /api/nonprofit/setup-accounts`; a failure there is swallowed, because the accounts are created on demand later anyway.
  - `PUT /api/settings` is an admin-only write (bookkeeper → 403). All nonprofit/job routes are bookkeeper-writable; readonly gets GET only.
  - The API is not gated by company type: every nonprofit endpoint answers for any company. Only the SPA hides the pages.
- **Nonprofit system accounts** (`ensure_nonprofit_accounts`, idempotent) — 3300 *Net Assets Without Donor Restrictions* (equity), 3400 *Net Assets With Donor Restrictions* (equity), 4400 *In-Kind Contributions* (income), 6960 *Bad Debt Expense* (expense). All four are flagged `is_system`.
  - Accounts are found **by name**. A new account keeps its suggested number only if the chart has not already used it, otherwise it is created unnumbered ("numbers yield to an existing chart").
  - In-kind income is 4400, not 4300, because the seed chart already has 4300 Labor Income.
  - They are created and committed on demand by the first document that needs them: a release, an in-kind gift or a write-off. The GET statements also resolve them, but only inside the request; the session is never committed, so nothing is saved. A business chart no longer ships with 4400.
- **Switching back** — Business mode restores customer/invoice/class words. The data is untouched either way, and the nonprofit accounts remain.
- **No year-end closing entry** — The ledger never closes income or expense to equity. The Statement of Financial Position splits the change in net assets by restriction at report time instead (see below).

_Key files: `app/routes/settings.py`, `app/services/accounting.py`, `app/routes/nonprofit.py`, `app/static/js/settings.js`, `app/models/settings.py`_

### Terminology swap (vocabulary dictionary)
- **One dictionary, two twins** — `app/services/terminology.py` (`NONPROFIT` dict, `Terms` class) and `app/static/js/terms.js` (`TERMS_NONPROFIT`, `T()`, `Terms.text()`). `tests/test_terminology.py` parses the JS literal as JSON and asserts the two are identical. Keys are always the business words. There are 48 pairs:
  - People: Customer → Donor; Customers → Donors; Customer Center → Donor Center; New Customer → New Donor; Active Customers → Active Donors; Customer Statement → Donor Statement; Customers & Sales → Donors & Contributions; Income by Customer → Contributions by Donor.
  - Documents: Invoice → Pledge; Invoices → Pledges; Create Invoice(s) → Create Pledge(s); New Invoice → New Pledge; Recurring Invoices → Recurring Pledges; Overdue Invoices → Overdue Pledges; Recent Invoices → Recent Pledges; Total Invoiced → Total Pledged; Sales Receipt(s) → Donation(s); Enter Sales Receipts → Enter Donations.
  - Ledger: Income → Revenue & Support; Total Income → Total Revenue & Support; Net Income → Change in Net Assets; Equity → Net Assets; Total Equity → Total Net Assets; Liabilities + Equity → Liabilities + Net Assets; Profit & Loss → Statement of Activities; P&L → Activities; P&L by Class → Activities by Fund; P&L: This Month vs Last → Activities: This Month vs Last; P&L: Year to Date → Activities: Year to Date; Balance Sheet → Statement of Financial Position; Balance Sheet Trend → Statement of Financial Position Trend; Class → Fund; Classes → Funds.
  - Grants: Job → Grant; Jobs → Grants; Job Costs → Grant Costs; Job Cost Entries → Grant Cost Entries; Job Budget vs Actual → Grant Budget vs Actual; Jobs: Budget vs Actual → Grants: Budget vs Actual; Job Profitability → Grant Income & Costs.
  - Receivables: Total Receivables → Pledges Receivable; Receivables → Pledges Receivable; A/R Aging → Pledge Aging; Accounts Receivable Aging → Pledges Receivable Aging; Monthly Revenue → Monthly Revenue & Support; Revenue by Customer → Revenue & Support by Donor.
- **Lookup rules** — `T(key)` returns the key itself in business mode. It resolves plurals (`key[:-1]` + "s") and lower-case forms ("invoices" → "pledges").
  - `Terms.text()` swaps whole words in prose, longest key first, case-insensitively, keeping the matched case. A lower-case word takes a fully lower-case phrase ("equity" → "net assets"; acronyms keep their capitals). An all-caps key such as "P&L" is not treated as a shouted word, so "P&L analysis" becomes "Activities analysis".
  - `slug()` gives filename forms (`profit-loss` → `statement-of-activities`). `compact()` gives CamelCase forms.
- **Protected words** — "Sales", "Sales Tax", "Vendor", "Bill", "Estimate" and "Payment" are never keys. Phrases carry the swap, so "Sales Tax" can never become "Contributions Tax", and Estimates stay Estimates (a nonprofit still quotes hall rentals).
- **Where the swap applies (SPA)** — at render time, on the client:
  - `App.applyTerminology()` runs once at boot, after `/api/settings` loads and before the first page paints. It rewrites every route label, sidebar section and link, toolbar button ("New Customer" → "New Donor", "Create Invoice" → "Create Pledge") and the search placeholder.
  - Page modules call `T()` / `Terms.text()` for headings, columns, toasts and empty states. A static sweep in `tests/test_terminology.py` flags capitalized business words left unwrapped, and every `T()` argument must be a dictionary key.
- **Where the swap applies (server)** — in responses, PDFs and emails:
  - Every `HTTPException` detail string and every 422 validation message is re-worded at the global exception handlers when the company is a nonprofit ("Invoice not found" → "Pledge not found"). A 405 is not re-worded.
  - The P&L and Balance Sheet PDFs use swapped titles and row labels (Revenue & Support, Change in Net Assets, Net Assets, Liabilities + Net Assets), and their PDF/CSV filenames use slugs (`statement-of-activities_<start>_<end>.pdf`, `statement-of-financial-position_<date>.csv`). The balance sheet's synthetic row reads "Change in Net Assets (current period)".
  - Other swapped server output:
    - Dashboard card titles and descriptions.
    - Chart-of-accounts control-account purposes.
    - AI analysis action labels.
    - The "No job" bucket ("No grant").
    - The recurring schedule noun ("recurring pledge").
    - Donor statement "Total Pledged".
    - Credit memo PDF "For Pledge #" / "Donor".
    - Collection letters.
    - The invoice email fallback ("Thank you for your support.").
    - Default email templates, which are seeded in the company's words with Jinja tags left untouched.
- **What never changes** — the swap covers display only:
  - API paths and JSON field names (`/api/customers`, `invoice_number`), DB tables and columns, and CSV export headers.
  - QuickBooks interop, tax, HR/payroll (employees, payroll, benefits, PTO, onboarding, time entries, tax forms), OCR, migration, companies, reseller permits and portal pages. These are exempt from the sweep by design.
  - **Printed document faces are literal, not vocabulary**. `invoice_doc_kind()` picks **DonationReceipt** (a sales receipt in a nonprofit), **Pledge** (invoice flagged `is_pledge`) or **Invoice** (anything else, e.g. a program fee or hall rental). A business gets SalesReceipt / Invoice.
  - **Ledger descriptions** are written once at posting time from the document's own face ("Pledge #1081 - Name" vs "Invoice #1081 - Name") and are never rewritten when the company type changes.

_Key files: `app/services/terminology.py`, `app/static/js/terms.js`, `app/static/js/app.js`, `app/main.py`, `app/services/donor_documents.py`, `app/services/dashboard_widgets.py`, `app/routes/reports/financial.py`, `app/routes/email_templates.py`_

### Nonprofit screens, navigation & gating
- **Nonprofit-only sidebar items** — marked `data-nonprofit` and hidden in business mode:
  - **In-Kind Gifts** (`#/in-kind-gifts`, under Donors & Contributions).
  - **Releases from Restriction** (`#/releases`) and **Functional Allocations** (`#/functional-allocations`), both under Accounting.
- **Route gating** — These three routes carry `nonprofit: true`. A bookmark or typed URL in a business company shows "*<page>* is for nonprofit companies" with Return to Dashboard / Open Settings buttons, instead of a page that would post to net-asset accounts.
- **Nonprofit-only controls on shared pages** — rendered only when `Terms.isNonprofit()`:
  - Invoice form: "This is a pledge (prints as PLEDGE)" checkbox, checked by default on a new invoice.
  - Invoice list: **Write Off** button on non-void rows with a balance.
  - Donation form: fair-value fields.
  - Receipt, payment and in-kind views: **Acknowledgment (PDF)** / **Email Acknowledgment** buttons.
  - Customer form: donor fields. Customer Center: **Giving Statement (last year)** button.
  - Bill and journal lines: Fund + Function columns and a **Split** button. Expense and CC charge forms: a header **Function** picker.
  - Settings → Funds: Restriction / Function / Donor-purpose columns and a fund editor.
- **Report Center** — In nonprofit mode the P&L card is replaced by six nonprofit cards: Statement of Activities, Statement of Financial Position, Fund Balances, Statement of Functional Expenses, Pledge Report and Year-End Giving Statements. The Balance Sheet card is hidden.
  - The remaining cards show nonprofit words: Activities by Fund, Grant Budget vs Actual, Grant Income & Costs, Pledge Aging, Contributions by Donor, Donor Statement.
  - The Financial Statements Pack PDF becomes Statement of Activities + Statement of Financial Position + Trial Balance.
- **Dashboard** — Nonprofit default layout: receivables, overdue pledges, active donors, bank balances, monthly revenue, recent payments, P&L this month (Activities), cash position, Grants: Budget vs Actual.
  - Payables, A/R aging, recent invoices and open POs are not in the default layout. A business default does not include the job card.

_Key files: `index.html`, `app/static/js/app.js`, `app/static/js/reports.js`, `app/services/dashboard_widgets.py`, `app/routes/dashboard.py`_

### Funds (classes as funds)
- **A class is a fund** — `classes` gains four fields:
  - `restriction`: `unrestricted` | `temporarily_restricted` | `permanently_restricted` (default `unrestricted`).
  - `default_function`: `program` | `management` | `fundraising` | null.
  - `donor_name` (≤200 chars) and `purpose`.
  - Both restricted values count as "with donor restrictions" (ASU 2016-14). The three-way label exists for treasurers. Permanently restricted is only a label: there is no endowment spending-policy engine.
- **Fund editor** — Settings → Funds (the Classes section re-worded) → **Edit**, shown in nonprofit mode only. It sets Restriction ("Without donor restrictions", "With donor restrictions (purpose / time)", "With donor restrictions (permanent)"), Default function ("Program services", "Management & general", "Fundraising", or none), Donor / grantor, and Purpose.
  - **Add Fund** creates a name only; the restriction defaults to unrestricted.
- **System default fund** — "Uncategorized" (`is_system_default`) is the bucket for untagged activity.
  - It cannot be renamed, archived, deleted or restricted (400 "The system default class is unrestricted"). It may carry a default function.
- **Validation and guards** — enforced by the classes router:
  - Name is required and unique case-insensitively (409 "Class '…' already exists").
  - An invalid restriction or function → 422.
  - Delete is refused (400 "archive it instead") when a transaction header uses the fund. Archived funds leave the pickers but stay on history.
- **Attribution rule** — Every by-fund report uses `coalesce(line.class_id, transaction.class_id, Uncategorized)`, so one bill with three line funds and a blank header lands in three funds. **P&L by Class ("Activities by Fund")** groups on the line class first (fixed in v2.9.0).
- **Restriction is read at report time** — Changing a fund's restriction re-states every period's split, because net assets are composed at report time rather than posted by a closing entry.

_Key files: `app/models/classes.py`, `app/schemas/classes.py`, `app/routes/classes.py`, `app/services/classes_service.py`, `app/static/js/settings.js`_

### Function dimension on posted lines
- **`transaction_lines.function`** — `program` | `management` | `fundraising` | NULL (unassigned), stored next to `class_id`, `job_id` and `cost_code_id` on every ledger line.
- **Defaulting rule** — applied by `create_journal_entry` on every posting:
  - If the line's payload omits the `function` key, the line takes its fund's `default_function` (line class, else header class).
  - If the payload sends an explicit `"function": null`, the line stays **unassigned**, waiting for a period-end allocation rule.
  - A line with no class and no header class gets NULL.
- **Documents that carry it** — entry forms that send a function:
  - Bill lines and journal lines have per-line Fund + Function selects. Function options: "—" = from fund, Program services, Management & general, Fundraising, and "Unassigned (allocate later)", which sends an explicit null.
  - Expenses and credit-card charges have a header Function picker (blank = "From fund").
  - Payroll posts unassigned; a rule on the wages account allocates it.
- **Voids carry it** — `reversing_lines()` copies job, class, cost code, cost type and function onto the reversal, so functional, by-fund and by-job reports net to zero for a voided document.
- **Report-time fallback** — The Statement of Functional Expenses reads `coalesce(line.function, fund.default_function)`. A line stored unassigned in a fund that has a default therefore reports in that default column. The Unassigned column holds only lines in funds with no default, or lines carrying an unrecognized value.

_Key files: `app/services/accounting.py`, `app/services/classes_service.py`, `app/models/transactions.py`, `app/static/js/utils.js`, `app/static/js/bills.js`, `app/static/js/journal.js`, `app/static/js/expenses.js`, `app/static/js/cc_charges.js`_

### Releases from restriction
- **Document** — `restriction_releases`: number `RL-000001`, date, fund (`class_id`), amount, informational `period_start`/`period_end`, memo, status `posted` | `void`, `transaction_id`.
- **Posting** — DR 3400 Net Assets With Donor Restrictions / CR 3300 Net Assets Without. Both lines are tagged to the fund, and function is forced to null.
  - JE description "Release from restriction RL-… - <fund>", `source_type=restriction_release`.
- **Suggested amount** (`GET /api/nonprofit/releases/suggest?class_id=&start_date=&end_date=`) — expenses = net debits on Expense + COGS lines attributed to the fund in the period. released = net debits on 3400 attributed to the fund in the period (voids net out). suggested = max(expenses − released, 0).
  - The default period is fiscal-year-to-date (Jan 1 of the end date's year → end, or today).
  - Response: class_name, period, expenses, released, suggested. An unknown fund → 404.
- **Rules** — enforced by `post_release`:
  - Omit `amount` to post the suggestion.
  - An unrestricted fund → 422 "'X' carries no donor restriction — nothing to release".
  - An amount ≤ 0 → 422 "Nothing to release: the fund has no unreleased spending".
  - An explicit amount is not capped by the suggestion or by the fund's restricted balance.
  - The closing date is checked on create and void (403 when inside a closed period).
- **Void** — `POST …/releases/{id}/void` posts a mirror entry on the release date (`restriction_release_void`) and marks it void. Voiding an already-void release → 400.
- **UI** (`#/releases`) — A list shows #, date, fund, period, memo, amount and status; voided rows are dimmed.
  - The **+ Release** modal offers restricted funds only, with a toast when there are none. It has Date, Period start (Jan 1), Period end (today), Amount and a **Suggest** button that auto-runs on change. A hint reads "X: spent $A in the period, $B already released, $C to release.". Memo is optional.
  - The view modal has **Void**.

_Key files: `app/models/nonprofit.py`, `app/services/nonprofit.py`, `app/routes/nonprofit.py`, `app/schemas/nonprofit.py`, `app/static/js/nonprofit.js`_

### Allocation rules & Split at entry
- **Allocation rule** (`allocation_rules` + `allocation_rule_targets`) — a saved way to split a shared cost (rent, utilities, the office manager's wages).
  - Rule fields: `name` (unique, case-insensitive, ≤100), `basis`, optional `source_account_id` and/or `source_class_id` (both empty = every unassigned expense line), `notes`, `is_active`.
  - Target fields: `class_id` (fund) and/or `function`, `job_id`, `weight` (≥0), `line_order`.
- **Bases** — `percent`, `square_feet`, `hours`:
  - `percent` and `square_feet` both use the stored relative weights; they need not sum to 100.
  - `hours` uses the time entries on each target's job in the period. Hours are regular + OT + DT, unweighted, and entries are counted whatever their status. Every target must name a job (422 otherwise), because time entries carry jobs, not classes.
- **Validation** — enforced by the rule schema and router:
  - At least one target is required.
  - Each target needs a fund, a function, or both (422).
  - The function must be one of the three, and the basis one of the three.
  - A duplicate name → 409. Unknown source account, source fund, target fund or target job → 404.
- **Split math** — `_spread()` is cents-exact: the largest weight absorbs the rounding remainder. A target with no fund lands in the rule's source fund, else in the fund the money came from.
  - A period with no weight → 422 "Nothing to split on: the rule's targets carry no weight for that period".
- **Split at entry** — Bill and journal lines in nonprofit mode show a **Split** button when at least one active rule exists.
  - The inline chooser calls `GET /api/nonprofit/allocation-rules/{id}/split?amount=&class_id=`, passing the row's fund or the header fund. The row is cloned into one line per share, with the description suffixed "(<rule>: <function|fund>)" and the fund/function selects pre-set.
  - The UI passes no dates, so an hours-basis rule uses all-time hours. An amount ≤ 0 → 422 ("Enter an amount first" in the UI).
- **Rule management** (`#/functional-allocations`) — The Rules table shows name, basis ("Percent", "Square feet", "Hours on grants"), source ("any expense" by default), targets·weights, **Edit** and **Run**.
  - The editor's basis options are "Percent / weights", "Square feet" and "Hours on grants in the period"; the job column is shown only for the hours basis. A new rule is pre-filled with Program 70 / Management 20 / Fundraising 10.
  - PUT replaces the targets wholesale. Inactive rules are dimmed and leave the Run and Split pickers.
  - **Delete** is refused while any run references the rule, even a voided run (409 "Rule has posted allocations — deactivate it instead").

_Key files: `app/models/nonprofit.py`, `app/services/nonprofit.py`, `app/routes/nonprofit.py`, `app/schemas/nonprofit.py`, `app/static/js/nonprofit.js`, `app/static/js/utils.js`_

### Period-end functional allocation runs
- **Pool** (`allocation_pool`) — net (debit − credit) on Expense/COGS lines with `function IS NULL`, dated in the period, filtered to the rule's source account and/or source fund. It is grouped by account × attributed fund, and zero rows are dropped.
- **Run** (`POST /api/nonprofit/allocations` {date, rule_id, period_start, period_end, memo}) — creates `functional_allocations` (number `FA-000001`, rule, period, memo default "<rule> — <start> to <end>", status, total) with `functional_allocation_lines` (account, fund, function, weight, amount, description).
  - Journal: for each pool row, one debit per target share **on the same natural account** (fund = target fund / rule source fund / the row's fund; the function is pinned when the target names one, otherwise the fund default applies), plus one credit of the pooled amount on that account in the original fund with an explicit null function.
  - JE description "Functional allocation FA-… - <rule>", `source_type=functional_allocation`.
- **Accounting effect** — This is a same-account reclass, so the P&L and Statement of Activities do not change by a cent while the Statement of Functional Expenses gains its columns. This differs from job allocations, which use an applied-cost offset.
- **Idempotent per period** — After a run, the unassigned lines and the explicit-null credit net to zero, so running the same period again finds an empty pool (422 "Nothing to allocate: no unassigned expense on the rule's source for that period").
- **Preview** — `GET …/allocation-rules/{id}/preview?start_date=&end_date=` (both required) returns the pool collapsed by account, the total, and how the total would split.
- **Void** — `POST …/allocations/{id}/void` posts a reversing entry on the run date (`functional_allocation_void`), status → void, and the cost returns to unassigned. Voiding twice → 400.
- **Guards** — The closing date is checked on post and void, and period_end must not precede period_start (422). The API does not refuse running an inactive rule; the UI lists active rules only.
- **UI** — **Run a Rule** / **Run** opens a modal with Rule, Period start (first of this month), Period end (today), Posting date and Memo.
  - A live preview shows an "Unassigned on" table with totals and "Would move to: …", or "Nothing unassigned on the source for that period".
  - The Runs table shows #, date, rule, period, "Moved" and status. Clicking a run shows its lines (account, fund, function, weight, amount) and a **Void** button.

_Key files: `app/services/nonprofit.py`, `app/routes/nonprofit.py`, `app/models/nonprofit.py`, `app/static/js/nonprofit.js`_

### Statement of Activities
- **What it shows** — Revenue & Support by income account in three columns: *Without Donor Restrictions*, *With Donor Restrictions*, *Total*.
  - Income attributed to a restricted fund counts as "with". All other income counts as "without".
  - Then a row "Net assets released from restrictions" (+ releases in without, − in with, 0 total).
  - Then Expenses: COGS and expense accounts, **always "without"** (ASU 2016-14), with the with-column fixed at 0.
  - Then **Change in Net Assets** per column.
- **Math** — change_without = revenue_without + releases − expenses. change_with = revenue_with − releases. The total equals P&L net income for the same dates. Releases are net debits on 3400 in the period, so voids net out.
- **Compare to prior year** — `?compare=prior_year` (a "Compare to prior year" checkbox on screen) adds *Prior year (YYYY)* and *Change* columns, using the same dates one year earlier (Feb 29 → Feb 28). Accounts present in only one period are merged in. The choice is remembered for the session and rides on the PDF/CSV links.
- **Outputs** — `GET /api/reports/statement-of-activities` (+`/pdf`, `/csv`). The default period is Jan 1 of this year → today.
  - PDF title "Statement of Activities"; filename `statement-of-activities_<start>_<end>.pdf/.csv`.
  - Saveable as a saved report (`statement_of_activities`).

_Key files: `app/services/nonprofit_reports.py`, `app/routes/reports/nonprofit.py`, `app/static/js/reports.js`_

### Statement of Financial Position
- **What it shows** — Assets, Liabilities, and **Net Assets** as of a date. Net Assets lists any other equity accounts (Opening Balance Equity, Retained Earnings…) followed by two composed rows.
  - *Net Assets Without Donor Restrictions* = 3300 balance + cumulative "without" income − cumulative expenses and COGS.
  - *Net Assets With Donor Restrictions* = 3400 balance + cumulative restricted-fund income.
  - Each composed row carries `detail.opening` (the real account balance) and `detail.current_activity`.
- **Totals** — `net_assets_without` includes the other equity accounts. `total_net_assets` equals the balance sheet's total equity, including its synthetic Net Income row. Liabilities + Net Assets balances to Total Assets.
- **Outputs** — `GET /api/reports/statement-of-financial-position?as_of_date=` (default today), +`/pdf`, `/csv` (`statement-of-financial-position_<date>`).
  - The on-screen view has account drill-down links and shows the without/with/total subtotals.
  - Saveable (`statement_of_financial_position`).

_Key files: `app/services/nonprofit_reports.py`, `app/routes/reports/nonprofit.py`, `app/static/js/reports.js`_

### Fund Balances
- **What it shows** — One row per **restricted** fund, including funds with no activity (all zeros), sorted by name. Donor name and purpose are carried, and the donor shows under the name on screen.
  - Columns: *Beginning*, *Contributions*, *Spent*, *Released*, *Ending*, *Unreleased*.
  - beginning = restricted income − releases before the start. ending = beginning + contributions − releases in the period.
  - Spent is informational (spending does not reduce restricted net assets until released). Unreleased = cumulative spent − cumulative released.
- **Unassigned row** — 3400 activity tagged to a non-restricted fund (a manual entry, or a fund whose restriction was later removed) shows as an italic "Unassigned" row, so the totals still reconcile.
- **Reconciliation** — The sum of Ending equals the Statement of Financial Position's net assets with donor restrictions.
- **Outputs** — `GET /api/reports/fund-balances` (+`/pdf`, `/csv`). PDF title "Fund Balances (With Donor Restrictions)". Saveable (`fund_balances`).

_Key files: `app/services/nonprofit_reports.py`, `app/routes/reports/nonprofit.py`_

### Statement of Functional Expenses
- **What it shows** — One row per Expense/COGS account (number + name) with *Total*, *Program*, *Management*, *Fundraising* and *Unassigned* columns. The function comes from `coalesce(line.function, fund default)`. A line with no function, or with a value outside the three, lands in Unassigned.
- **Program-by-program breakout** — The program-column amounts are also totalled per fund ("Program services by program"), shown as its own table on screen and appended to the PDF.
- **Unassigned warning** — The screen flags "$X still unassigned — run an allocation rule".
- **Form 990 Part IX** — The CSV is in Part IX **column** order: *Expense, Total (A), Program services (B), Management and general (C), Fundraising (D), Unassigned*. The row mapping to Part IX line numbers is not done.
- **Compare to prior year** — The same `?compare=prior_year` mechanism as the Statement of Activities (prior total + change per row).
- **Reconciliation** — Total equals P&L COGS + expenses for the period.
- **Outputs** — `GET /api/reports/functional-expenses` (+`/pdf`, `/csv`). Filename `functional-expenses_<start>_<end>`. Saveable (`functional_expenses`).

_Key files: `app/services/nonprofit_reports.py`, `app/routes/reports/nonprofit.py`, `app/static/js/reports.js`_

### Pledges: recurring, one-off, write-off
- **Recurring pledge** — A recurring invoice template (frequency weekly / monthly / quarterly / yearly, start and end date) is the promise.
  - Each generated installment invoice gets `is_pledge = true` when the company is a nonprofit at generation time. It is linked to its template by `recurring_invoice_id` and carries the template's fund (class) and grant (job).
  - `POST /api/recurring/generate?as_of=` generates one installment per due template per call.
  - UI: Recurring Pledges page (fund picker only; the job/grant is API-only).
- **One-off pledge** — Any invoice with `is_pledge` true (the Create Pledges form checkbox). It prints as **PLEDGE**:
  - "Pledge date:" and "Due:", with no Terms column.
  - "Donor" address label, "Received" instead of "Paid", "Balance" instead of "Balance Due".
  - The note "Contributions are deductible when paid; an acknowledgment is issued for each payment received."
  - Filename `Pledge_<n>.pdf`.
  - An unflagged invoice in a nonprofit still prints as INVOICE (program fees, rentals).
- **Payments** — Payments applied to pledges are the gifts. A payment recorded with nothing to apply is a **donor credit** on A/R (shown as "not applied … it is a credit for this donor", with **Apply to Pledges** via `POST /api/payments/{id}/apply`), not revenue.
- **Write-off** — `POST /api/invoices/{id}/write-off` {date, amount?, memo?} → 201 credit memo. In the UI, the **Write Off** button on the Pledges list opens a Date / Amount (default = balance, max = balance) / Memo dialog.
  - Creates a credit memo flagged `is_write_off`, status APPLIED, applied to the invoice at once. The memo defaults to "Write-off: Pledge #N" (or "Invoice #N" for an unflagged invoice).
  - Posts DR 6960 Bad Debt Expense / CR 1100 A/R, tagged with the invoice's fund and grant.
  - The invoice becomes PAID (zero balance) or PARTIAL.
  - Refusals: void invoice (400), no open balance (400), amount not in (0, balance] (400), closing date (403), no free credit-memo number after 10 tries (503).
  - Write-off memos are excluded from the sales-tax report, since forgiveness is not a reversed sale.
  - The endpoint is not gated to nonprofits.
- **Undo** — `POST /api/credit-memos/{id}/void` restores each application to its invoice (status PARTIAL or SENT), posts a mirror entry carrying the dimensions, and marks the memo void.
- **Revenue timing** — Each installment is revenue when its invoice is generated or entered. The not-yet-invoiced balance of a recurring promise appears only in the Pledge Report, not in the ledger.

_Key files: `app/services/recurring_service.py`, `app/routes/invoices/lifecycle.py`, `app/routes/credit_memos.py`, `app/static/js/invoices.js`, `app/templates/invoice_pdf.html`_

### Pledge Report
- **Rows** — one per pledge:
  - Every recurring template with installments scheduled or invoiced in the period. pledged = installment total (template lines + tax) × installments scheduled in [start, end]. The label is "<frequency> pledge from <start_date>".
  - Every one-off `is_pledge` invoice dated in the period that has no template. pledged = its total. The label is "Pledge <number>".
- **Columns** — *Pledged*, *Invoiced* (non-void installment invoices dated in the period), *Not yet invoiced* (max(pledged − invoiced, 0)), *Received* (allocations of non-voided payments to those invoices), *Written off* (applications of non-void write-off memos), *Outstanding* (current balance due), plus an `installments` count.
- **Grouping** — `by_donor` (subtotals + pledges), `by_class` (campaign = fund), and totals. Reconciles: pledged = invoiced + not yet invoiced; invoiced = received + written off + outstanding.
- **Filters** — JSON accepts `start_date`, `end_date` (default YTD), `class_id` and `customer_id`. The PDF and CSV accept dates only.
- **Outputs** — `GET /api/reports/pledges` (+`/pdf`, `/csv`).
  - The PDF has donor subtotal rows and pledge rows labelled "label (campaign)".
  - The CSV has one row per pledge (Donor, Pledge, Campaign, six amounts) and a total.
  - The screen shows "By donor" and "By campaign (fund)" tables. Saveable (`pledges`).

_Key files: `app/services/pledge_report.py`, `app/routes/reports/donors.py`, `app/static/js/reports.js`_

### Donations & IRS Pub. 1771 donation receipts
- **Donation = sales receipt** — Enter Donations (`#/sales-receipts`, `POST /api/sales-receipts`) records the invoice and its full payment in one step. It is revenue the day it arrives and carries a fund (class) and grant (job).
- **Quid-pro-quo fields** — `fair_value_amount` and `fair_value_description` (≤200), shown in nonprofit mode as "Goods or services provided in exchange?" with Fair value ($) and a description ("e.g. gala dinner"). Leave them blank for a pure gift.
  - The fair value must be between 0 and the total (400 "Fair value of goods or services must be between 0 and the total"), checked on create and edit.
- **Donation receipt PDF** — A sales receipt in a nonprofit prints **DONATION RECEIPT** with "Date of contribution:", no due date or terms, and a "Donor" label.
  - An "Acknowledgment of contribution" box shows date, amount, fair value + description and deductible portion (when a fair value exists), followed by the IRS sentence.
  - Filename `DonationReceipt_<n>.pdf`. The email subject/attachment say "Donation Receipt".
- **IRS sentence variants** — from `irs_statement()`. The organization name comes from `company_name` (fallback "the organization"); the EIN from `company_tax_id`. Each variant ends "…<Org> (EIN x). Please retain this acknowledgment for your tax records."
  - Pure gift: "No goods or services were provided in exchange for this contribution. Contribution of $A received by <Org> …". The deductible amount = the amount.
  - Quid pro quo: "In exchange for this contribution of $A, <Org> provided goods or services with an estimated fair market value of $F (desc). The portion … deductible for federal income tax purposes is limited to $D." Here D = max(A − F, 0).
  - Property: "Thank you for your gift of <descriptions>. No goods or services were provided … <Org> has not assigned a value to this gift; the donor is responsible for determining its fair market value." No deductible amount is stated.

_Key files: `app/services/donor_documents.py`, `app/routes/sales_receipts.py`, `app/routes/invoices/crud.py`, `app/templates/invoice_pdf.html`, `app/static/js/sales_receipts.js`_

### Acknowledgment letters
- **Gift kinds** — `invoice` (a donation receipt), `payment` (a pledge payment or unapplied gift), `in-kind`.
  - Refusals (`NotAGift`): a non-receipt invoice ("Acknowledge the payment, not the pledge"), a void payment, a payment wholly applied to donation receipts ("This payment belongs to a donation receipt — acknowledge the receipt"), a void in-kind gift.
  - The payment gift amount = payment amount − the part applied to sales receipts.
- **Preview** — `GET /api/donors/gifts/{kind}/{id}/acknowledgment/preview` → `{eligible, amount, reason}`. The payment view calls it to decide whether to show the buttons. An unknown kind or missing document → 404.
- **PDF** — `GET …/acknowledgment/pdf` (`Acknowledgment_<number>.pdf`; ineligible → 400). The PDF contains:
  - A letterhead (logo, name, address, phone, email, EIN) and today's date.
  - The donor address block.
  - The rendered template body.
  - A gift box: date; either "Property received" descriptions (no value) or amount + fair value + deductible portion; and reference.
  - A signature line with the company name, and the footer "Generated by Slowbooks Pro 2026".
- **Email** — `POST …/acknowledgment/email` {recipient?, subject?} sends to the recipient, else the donor's email (none → 400 "The donor has no email address"), with the PDF attached.
  - It writes an EmailLog row (`entity_type=acknowledgment_<kind>`). A send failure → 502 "Email could not be sent (check SMTP settings)".
  - The UI prompt: "leave as-is to use the donor's email".
- **Template** — The editable `donation_acknowledgment` email template (type `acknowledgment`), created by Settings → Email Templates → **Seed Default Templates**. Without it, the built-in text is used.
  - Default subject: "Thank you for your gift to {{ company.company_name }}".
  - Default body: salutation (or "Dear <name>"), "Thank you for your contribution of $X on <date> (<number>)", or "generous gift" for in-kind, then `{{ irs.text }}`, "With gratitude,", and the company name.
  - Variables: `donor`, `donor_name`, `customer_name`, `company` (secrets redacted), `gift` (kind, id, number, date, amount, description, fair_value_amount, fair_value_description, in_kind_lines, customer_id), `irs` (deductible_amount, text).
  - The template is rendered in a sandboxed, autoescaping Jinja environment.
- **Entry points** — **Acknowledgment (PDF)** and **Email Acknowledgment** buttons on the donation (receipt) view, the payment view (when eligible) and the in-kind view, all hidden when void.

_Key files: `app/routes/donors.py`, `app/services/donor_documents.py`, `app/templates/acknowledgment_letter.html`, `app/services/pdf_service.py`, `app/routes/email_templates.py`, `app/static/js/nonprofit.js`_

### Year-end giving statements
- **Content per donor** — gathered by `collect_gifts` for the calendar year:
  - **Cash gifts**: non-void donation receipts, plus payments whose gift amount is > 0 (a receipt's own payment is never counted twice), sorted by date.
  - Each cash gift shows Date, Reference, Description, Amount, Goods / services (fair value), Deductible and a **Running total**. With no cash gifts, the table reads "No cash contributions recorded for YYYY.".
  - **Non-cash gifts**: posted in-kind gifts, listed by Date, Reference and Property with **no values**, and the note "Values of non-cash gifts are not stated; the donor determines fair market value."
  - Summary: Total contributions, Less goods and services received, Deductible contributions.
  - Footer IRS text: "This statement summarizes contributions received by <Org> (EIN) during the year." Then either the "no goods or services…" sentence, or (when any fair value exists) "Except where a value of goods or services is shown above…" plus the retain sentence.
- **One donor** — `GET /api/donors/{customer_id}/giving-statement/pdf?year=` → `GivingStatement_<year>_<name>.pdf`. Customer Center → **Giving Statement (last year)**.
- **All donors, one PDF** — `GET /api/donors/giving-statements/pdf?year=&customer_ids=1,2` covers every **active** donor with a gift that year, with a page break per donor. It is served inline as `GivingStatements_<year>.pdf` (print the stack; not a zip).
- **Batch email** — `POST /api/donors/giving-statements/batch-email` {year, customer_ids?} → `{sent, failed, skipped, errors[]}`.
  - Donors with `send_year_end_statement = false` are skipped. A donor with no email counts as failed ("<name>: no email address"). Per-donor exceptions are logged and counted as failed.
  - Subject: "Your <year> giving statement from <Company>". The body is a fixed HTML greeting (salutation or "Dear <name>") and thank-you. Attachment `GivingStatement_<year>.pdf`, EmailLog `giving_statement`.
- **UI** — Report Center → **Year-End Giving Statements** modal: Tax year (this year, last year [default], two years ago), **Download all (PDF)**, **Email all** (confirm), result "Sent X, failed Y, skipped Z." with an error list.

_Key files: `app/routes/donors.py`, `app/services/donor_documents.py`, `app/templates/giving_statement_pdf.html`, `app/static/js/reports.js`, `app/static/js/customers.js`_

### In-kind gifts
- **Document** — `in_kind_gifts`: number `IK-0001`, donor (`customer_id`), date, memo, header fund and grant, status posted/void, total, transaction. Lines hold description (required), quantity (>0), `fair_value` per unit (≥0, the donor's estimate), amount = qty × fair value, debit account, credit account, and a per-line fund and grant.
- **Posting** — Per line: DR the account the property **is** (asset, expense or COGS — "the piano goes on the books, the paint is program supplies") / CR In-Kind Contributions (4400 by default; any income account via the API). Both sides are tagged to the line's fund/grant, falling back to the header's. JE "In-kind gift IK-… - <donor>", `source_type=in_kind_gift`.
  - A gift whose lines total $0 (e.g. volunteer legal review) exists as a document with **no posting** (`transaction_id` null), so it can still be acknowledged.
- **Validation** — Unknown donor → 404. A debit that is not asset/expense/COGS → 422 "The gift must land in an asset or expense account (what the property is)". A credit that is not income → 422. No lines → 422. The closing date is checked (403).
- **Void** — Reversing entry carrying the dimensions (`in_kind_gift_void`), status → void. Voiding twice → 400. There is no edit endpoint: void and re-enter.
- **Acknowledgment** — Describes the property (each line's description, prefixed "<qty> × " when the quantity is not 1, joined by "; ") and never states a value (IRS Pub. 1771: the donor values the gift).
- **UI** (`#/in-kind-gifts`) — The list shows #, date, donor, property, fund, "Book value" and status.
  - The **+ In-Kind Gift** modal has Donor, Date, Fund, Grant (narrowed to the donor's grants), Memo, and lines (Description, Qty, Fair value (each), Amount, "What it is (account)" limited to asset/expense/COGS accounts) with a running total.
  - Per-line fund/grant and the credit account are API-only.
  - The view shows the debit / credit accounts, the acknowledgment buttons and **Void**.

_Key files: `app/models/in_kind.py`, `app/services/in_kind.py`, `app/routes/in_kind.py`, `app/schemas/in_kind.py`, `app/static/js/in_kind.js`_

### Donor records & Anonymous Donor walk-in
- **Donor fields on customers** — `donor_type` (≤20; UI: — / Individual / Organization / foundation), `salutation` (≤100; opens letters and the batch email, e.g. "Dear Maria"), and `send_year_end_statement` (default true; the batch email skips an opted-out donor).
  - The fields appear on the customer form in nonprofit mode only.
  - They are not in the customer CSV import/export.
- **Donor Center** — The Customer Center in donor words. It lists each donor's grants (jobs) with a **New Grant** button and has the Giving Statement button.
- **Anonymous Donor** — A donation entered with no donor posts to the built-in walk-in customer.
  - The customer is found via the `walk_in_customer_id` setting, else by name ("Anonymous Donor" in a nonprofit, "Walk-in Customer" in a business). If absent, it is created with terms "Due on Receipt" and notes "Counter sales entered without a customer.".
  - The donation form's blank option reads "Anonymous Donor", and the walk-in record is not listed again.

_Key files: `app/models/contacts.py`, `app/schemas/contacts.py`, `app/routes/sales_receipts.py`, `app/static/js/customers.js`, `app/static/js/sales_receipts.js`_

### Jobs (Customer:Job) — the entity
- **Job** (`jobs`) — belongs to one customer. Fields:
  - `name` (required, ≤200, **no ':'** — 422 "pick the customer instead"), `job_number` (≤50) and `status`.
  - `job_type` (free text ≤100, e.g. "Remodel, New build, Service…"), `description` and `site_address` (multi-line).
  - `start_date`, `projected_end_date`, `end_date`, `contract_amount` (the grant award in nonprofit mode), `notes` and `is_active`.
- **Statuses** — `pending`, `awarded`, `in_progress` (default), `closed`, `not_awarded`. Input is normalized (lower-cased, spaces → underscores). Status is informational: no posting rule depends on it.
- **Naming** — `full_name` = "Customer: Job". Names are unique **per customer**, case-insensitively (409 "This customer already has a job named '…'"), so two customers may each have "Kitchen".
  - A job can be moved to another customer via PUT, with the clash re-checked.
- **Archive, never delete used jobs** — DELETE is refused (400 "Job has posted activity — mark it inactive instead") when any ledger line or transaction header references the job. `is_active=false` hides it from pickers while history keeps it.
- **Grants** — In nonprofit mode a job is a **Grant** belonging to the funder (a donor), with a budget by cost code, a period (dates) and an award (contract amount).
- **API** — `GET /api/jobs?customer_id=&include_inactive=&status=` (sorted by customer, job). `GET /api/jobs/{id}` returns the job + `summary`: all-time profitability plus committed cost.

_Key files: `app/models/jobs.py`, `app/schemas/jobs.py`, `app/routes/jobs.py`, `app/services/jobs_service.py`_

### Job dimension on documents and lines
- **Where a job can be set** — per the request schemas:
  - Header job: invoices, sales receipts, estimates, credit memos, recurring templates, bills, vendor credits, purchase orders, expenses, credit-card charges, journal entries, deposits, in-kind gifts, time entries.
  - Per-line job: invoice, estimate, bill, vendor-credit, PO, journal and in-kind lines.
- **Inheritance** — At posting, a ledger line without its own job takes the header's (`create_journal_entry`). Reports then attribute with `coalesce(line.job_id, transaction.job_id)`, so header-tagged and line-tagged documents reconcile identically.
- **Cost code and billable** — `cost_code_id` goes on bill, PO, journal, estimate, invoice, vendor-credit and time-entry lines and on expenses. `is_billable` goes on bill lines, expenses, journal lines and job cost lines.
  - Credit-card charges carry job, class and function but no cost code or billable flag.
  - The `billed_invoice_line_id` column exists on bill and ledger lines but is never written (reserved for unbilled-costs billing).
- **PO → Bill** — Converting a PO carries each line's job (line, else header) and cost code onto the bill lines and ledger lines.
- **Estimate → Invoice** — Carries the job to the invoice and its lines. Invoice edits keep per-line job, class and cost code (fixed in v2.17.2).
- **UI pickers** — A shared "— No job —" picker lists active jobs and narrows to the selected customer's jobs on focus (`JobPicker.sync`). It is not rendered when the company has no jobs.
  - The picker appears on invoices and estimates (narrowed to the customer), sales receipts, bills, expenses, CC charges, journal entries, POs, time entries and in-kind gifts (narrowed to the donor).
  - Credit memos, vendor credits, deposits and recurring templates take a job through the API only; their forms show a class picker at most.
  - Cost-code columns appear only when codes exist.
  - Per-line job pickers are not rendered; invoice lines keep their stored line job/class/code through edits.
  - The server does not check that a document's job belongs to the document's customer.

_Key files: `app/services/accounting.py`, `app/services/jobs_service.py`, `app/static/js/utils.js`, `app/routes/purchase_orders.py`, `app/models/transactions.py`_

### Jobs page & job detail page
- **Jobs list** (`#/jobs`, "Grants" in nonprofit mode) — Columns: Customer, Job (+ #number), Status badge (+ inactive), **Budget**, **Committed**, **Actual**, **Projected**, **Variance** (green under / red over when budgeted), **% Used**, **Revenue**, and **Edit**. A totals row closes the table.
  - Filters: search (customer / name / number), customer (only customers that have jobs) and status (Active jobs default, each status, Inactive).
  - Buttons: **Job Cost Entries** and **+ New Job**. Figures are job-to-date from `/api/jobs/budget-vs-actual`.
- **Job form** — Customer (active customers, plus the job's own if inactive), Job name, Job #, Status, Job type, Contract amount, Start / Projected end / Actual end dates, Active (edit only), Site address, Description, Notes, and **Delete**. Reachable from the Jobs page, the job page and the Customer Center (**New Job**).
- **Job page** (`#/jobs/<id>`, bookmarkable) — Breadcrumb, status badge, and **New Invoice** (pre-fills the customer), **Job Cost Entry** (pre-selects the job) and **Edit** buttons.
  - A period filter (start/end) with a **JTD** reset.
  - Tabs: Overview, Cost Detail, Budget, Transactions and Time.
- **Overview tab** — headline figures from the cost tree:
  - Stat tiles: Contract, Budget, Committed, Actual cost, Projected, Variance, Revenue, Margin ((revenue − cost)/revenue) and Billed vs contract (revenue ÷ contract).
  - A "By cost type" table; clicking a row drills into it.
  - Job facts: number, type, dates, site address, description, notes.
- **Cost Detail tab** — An expandable tree: cost type → code → sub-code (any depth) → posted lines.
  - Columns: Original, Changes, Budget, Committed, Actual, Projected, Variance, % Used, Est. Rev and Act. Rev.
  - Each type has a "No cost code" row, and a "Whole-job budget (not by code)" row appears when one exists. **Expand all / Collapse all** are available.
  - Clicking a line opens its source document: invoice, bill, expense, job cost entry, else the journal entry. Billable lines are badged.
- **Budget tab** — Editor with rows per cost code (indented by depth), per cost type ("whole type, not by code") and whole job. Each row has Budget cost, Est. revenue and Source.
  - "Seed from an estimate" offers this customer's estimates for this job or with no job. **Save Budget**.
- **Transactions tab** — A flat list of P&L lines attributed to the job (date, source, account, memo, income, cost), each opening its document.
- **Time tab** — The job's time entries (date, employee, cost code, Reg / OT / DT, status, posted link).
  - A **Post to job** button per submitted/approved unposted entry, and a bulk "Post N approved entries to this job" button.

_Key files: `app/static/js/jobs.js`, `app/static/js/customers.js`, `app/routes/jobs.py`_

### Job Profitability & per-job detail
- **Aggregation** — `job_profitability` computes income, COGS and expense per attributed job from posted lines in the period.
  - Row fields: job_id, job_name, customer_id, customer_name, status, contract_amount, income, cogs, expenses, total_costs, gross_profit (income − COGS), net_income, and margin_pct (null with no income).
- **"No job" bucket** — Untagged activity lands in a `job_id = null` row labelled "No job" ("No grant" in nonprofit mode), sorted first. The report's totals therefore equal the P&L for the same dates.
  - This bucket also holds the untagged **applied-cost credits** of Job Cost Entries, so its costs can be negative.
  - Passing `customer_id` drops the bucket.
- **Endpoints** — report, per-job list and line detail:
  - `GET /api/reports/job-profitability?start_date=&end_date=&customer_id=` (default YTD) → `{jobs, total_income, total_costs, total_net_income}`.
  - `GET /api/jobs/profitability` adds `committed_cost` per row (API only).
  - `GET /api/jobs/{id}/transactions` gives the per-job line detail.
- **Report Center card** — "Job Profitability" ("Grant Income & Costs") shows Customer, Job, Contract, Income, Costs, Net and Margin with totals. A row click opens the job page. It is screen-only: no PDF/CSV, and not saveable.

_Key files: `app/services/jobs_service.py`, `app/routes/reports/financial.py`, `app/routes/jobs.py`, `app/static/js/reports.js`_

### Cost codes
- **Cost code** (`cost_codes`) — `code` (unique, ≤20, case-insensitive clash → 409), `name`, `cost_type` (a key of the cost-types table), optional default posting `account_id`, `parent_id` (nesting to any depth: division › code › sub-code), `notes` and `is_active`. `label` = "code name".
  - A code says **which part of the job**; the account says **what kind of expense**.
- **Rules** — enforced by the cost-codes router:
  - An unknown cost type → 422 ("add it under Settings → Cost Types").
  - An unknown parent or account → 404. A parent that would create a cycle → 422.
  - Delete is refused (400 "mark it inactive instead") when a ledger line or bill line uses the code.
  - Line-level only: there is no header default, so untouched lines are never silently mis-coded.
- **Tree** — `GET /api/cost-codes/tree` returns nested nodes. List responses carry `depth`, `parent_code` and `children_count`. Orphans (a missing or inactive parent) surface at the top.
- **CSV import** — `POST /api/cost-codes/import` {rows: [...], csv: "code,name,cost_type,parent_code"} (header optional) → `{created, updated, errors}`.
  - Existing codes (case-insensitive) are updated (name, type, parent). Parents are linked in a second pass, so order does not matter.
  - Per-row errors: missing code/name, unknown type, parent not found, cycle. An empty import → 422 "Nothing to import".
  - UI: Settings → Cost Codes → **Import CSV** (paste box).
- **CSI MasterFormat loader** — `POST /api/cost-codes/standard` loads 26 codes and skips existing ones, so it is safe to repeat:
  - 01 General Requirements (other).
  - 02, 03, 04, 07, 09, 13, 14, 21, 22, 23, 25, 26, 27, 28, 31, 32, 33 (subcontract).
  - 05, 06, 08, 10, 12 (material).
  - 11 Equipment and EQ Equipment Rental (equipment).
  - L Labor (labor).
- **Settings UI** — Settings → Cost Codes: add (code, name, type limited to the 5 built-in types, parent), **Load standard list**, **Import CSV**, and per-row **Rename** / **Deactivate**.

_Key files: `app/models/cost_codes.py`, `app/schemas/cost_codes.py`, `app/routes/cost_codes.py`, `app/services/job_costing.py`, `app/static/js/settings.js`_

### Cost types, burden & offset accounts
- **Cost type** — a row in `cost_types`:
  - Identity: `code` (the stable key; lower-cased, spaces → underscores, ≤20), `name`, `sort_order`, `is_active`.
  - Burden: `is_labor` (burden applies), `burden_pct`, `burden_method` (`flat` | `payroll`).
  - Accounts: `default_account_id` (the cost/debit account when the code has none), `offset_account_id` (the credit side), `burden_offset_account_id`.
- **Defaults** — labor (is_labor), material, subcontract, equipment and other, seeded on first use. The standard five cannot be deleted. Any type in use by a code or job cost line cannot be deleted (400 "mark it inactive instead"). A duplicate code → 409. Unknown accounts → 404. A blank name → 422.
- **Applied-cost pattern** — A Job Cost Entry debits job cost (tagged to the job) and credits an untagged offset. Every offset is a **P&L contra-expense**, never a balance-sheet clearing account, so labor is not counted twice when the pay run also debits wages.
- **Create default offset accounts** — `POST /api/cost-types/setup-offsets`:
  - Creates, if missing (by name; number kept only if free): 6900 Applied Labor Cost, 6910 Applied Labor Burden, 6920 Applied Equipment Cost, 6930 Applied Overhead (all expense type).
  - Fills only blank choices:
    - Cost account: material → 5100 Materials Cost, labor → 5200 Labor Cost, subcontract → 5300 Subcontractor Costs (when those are COGS accounts), else the 5000 COGS umbrella, else a created "Job Costs" COGS account.
    - Offset: labor types → Applied Labor Cost, equipment → Applied Equipment Cost, others → Applied Overhead.
    - Burden offset (labor types): Applied Labor Burden.
- **Settings UI** — Settings → Cost Types: an editable table (name, Labor?, Burden %, Burden method "Flat %" / "Actual payroll", Cost account, Offset account, Burden offset) with Save / Deactivate per row, an add form (code, name, labor-type), and **Create default offset accounts**.

_Key files: `app/models/job_costing.py`, `app/routes/job_costing.py`, `app/schemas/job_costing.py`, `app/services/job_costing.py`, `app/static/js/settings.js`_

### Equipment
- **Equipment list** (`equipment`) — code, name (required), `hourly_rate`, optional default cost code, `recovery_account_id` (the credit side when charged to a job; defaults to the equipment cost type's offset), notes, is_active.
- **Rules** — An unknown recovery account → 404. Delete is refused when job cost lines reference the item (400 "mark it inactive instead").
- **Use** — Picking equipment on a Job Cost Entry line fills rate = hourly rate (when the rate is 0), cost type = equipment, and code = the equipment's code. The credit goes to the recovery account.
- **Settings UI** — Settings → Equipment: add (code, name, $/hr), **Set rate**, Activate / Deactivate.

_Key files: `app/models/job_costing.py`, `app/routes/job_costing.py`, `app/static/js/settings.js`, `app/static/js/job_costs.js`_

### Job Cost Entries
- **Document** (`job_costs` + `job_cost_lines`) — number `JC-000001`, date, header job (null for allocations and payroll burden), memo, `source` (`manual` | `time_entry` | `allocation` | `payroll`), status posted/void, transaction, total.
  - Line fields: job, cost code, cost type, description, quantity (hours / miles / units), rate, amount, debit and credit accounts, employee, equipment, time entry, `is_burden`, `is_billable`.
- **Uses** — Any job cost that is not a vendor bill: internal labor at a loaded rate, owned-equipment hours, mileage, small tools, burden, overhead allocations and corrections.
- **Account resolution** — `resolve_line_accounts`:
  - Debit = the given account → the code's account → the cost type's default account.
  - Credit = the given account → the equipment's recovery account → the type's offset (burden lines: burden offset, else offset).
  - Missing accounts → 422 naming the Settings fix ("…set the offset account on the 'X' cost type in Settings (Settings → Cost Types → Create default offset accounts)").
- **Posting** — Per line: DR the cost account, tagged to job, code, type and billable / CR the offset, **untagged** (it lands in "No job", so Job Profitability still totals to the P&L). JE "Job cost JC-… - <Customer: Job>", `source_type=job_cost`.
- **Validation** — enforced by the job-costs router:
  - Every line needs a job (line or header; 422 "Line N: pick a job").
  - An unknown job, code or type → 404 / 422.
  - Negative amounts or quantities → 422 ("void and re-enter instead").
  - The amount defaults to qty × rate. Zero lines are skipped; all-zero → 422. The closing date is checked.
- **Void** — Reversal with job, code and type (`job_cost_void`). Linked time entries are released so they can be re-posted. There is no edit: void and re-enter.
- **UI** (`#/job-costs`, "Job Costs" in the sidebar) — The list shows #, date, job (or "N jobs (allocation)"), source (Entry / Time / Allocation), memo, total and status.
  - The **+ Job Cost Entry** modal has a Job (required), Date, Memo and cost lines: code, type ("auto"), description, employee or equipment, qty, rate, amount, cost account, offset account ("default"), Bill?.
  - Choosing an employee pre-sets type = labor, but the rate is typed by hand.
  - The view has **Void**. `is_burden` is API-only.
- **List API** — `GET /api/job-costs?job_id=&status=&start_date=&end_date=`. The `job_id` filter matches the header or any line.

_Key files: `app/models/job_costing.py`, `app/services/job_costing.py`, `app/routes/job_costing.py`, `app/schemas/job_costing.py`, `app/static/js/job_costs.js`_

### Allocating a cost across jobs
- **Allocate a Cost** — `POST /api/job-costs/allocate` takes date, amount (>0), method, optional cost code / cost type / accounts, period for weights, memo, and `targets` [{job_id, weight}]. An empty target list means every active job.
- **Methods** — `percent` (explicit weights > 0), `equal`, `hours` (time-entry hours on each job in the period; raw hours, any status), `revenue` (job income in the period) and `costs` (job total costs in the period).
- **Posting** — One Job Cost Entry, `source=allocation`, with no header job and one line per job (DR cost account tagged to that job / CR offset). Shares are rounded, with the remainder going to the **last** job in weight order. Memo default "Allocation by <method>".
- **Refusals** — "Allocation amount must be positive", "Nothing to allocate on: no jobs carry weight for that method", "No jobs to allocate to" (all 422). The closing date is checked.
- **UI** — **Allocate a Cost** on the Job Costs page. Its "Spread by" options are labor hours / revenue / costs / equally / weights below. The job checklist (all checked, each with a weight box) is followed by period, code, type, accounts and memo fields.

_Key files: `app/services/job_costing.py`, `app/routes/job_costing.py`, `app/static/js/job_costs.js`_

### Time posted to jobs & payroll burden
- **Employee costing fields** — `cost_rate` (the loaded hourly cost; blank = pay rate, or salary ÷ 2080) and `burden_pct` (overrides the labor type's %). These fields are redacted for non-admin roles.
- **Post time to a job** — `POST /api/time-entries/{id}/post-to-job`, or bulk `POST /api/time-entries/post-to-job` {ids} (committed per entry, returning per-entry `ok` / `error`):
  - Requirements: the entry has a job, status is submitted or approved, and it is not already posted (`time_entries.job_cost_id`).
  - Cost hours = regular + OT × 1.5 + DT × 2. Base = cost hours × cost rate.
  - The result is one Job Cost Entry (`source=time_entry`, memo "Labor — <employee> — <date>") with a labor line at the code's account or the labor type's default, credited to the labor offset.
  - A separate **burden line** (`is_burden`) = base × burden % (employee's, else the labor type's), credited to the burden offset.
  - The burden % applies to the premium-inclusive base (a documented simplification).
  - Errors (400 single / per-entry bulk): already posted, no job, wrong status, "no hours, or the employee has no cost rate".
- **Reject un-posts** — Rejecting a time entry that was posted to a job voids that job cost (closing date checked).
- **Actual payroll burden** — When the labor cost type's `burden_method = payroll`, posting time skips the flat %.
  - Processing a pay run posts one Job Cost Entry (`source=payroll`, no header job, memo "Payroll burden — pay run N (…)") that spreads each employee's actual employer taxes (SS, Medicare, FUTA, SUTA, state employer) and employer-paid benefit codes routed `job_burden` across the (job, cost code) pairs of that run's time entries, weighted by cost hours.
  - Each line is DR the job labor burden (tagged) / CR the expense account the payroll entry used (6120 Payroll Tax Expense or the benefit's expense account, falling back to 6150). The P&L is unchanged.
  - Hours with no job keep their share in the pool.
  - With no 6120/6000 account → 400. The pay run records `burden_job_cost_id`.
  - Only stubs built from time entries distribute burden.
- **UI** — The job page's Time tab posts entries. The Time Entries list shows the job, cost code and a "posted" badge. The employee form has "Job cost rate" and "Burden %" fields.

_Key files: `app/services/job_costing.py`, `app/routes/time_entries.py`, `app/routes/payroll/runs.py`, `app/models/payroll.py`, `app/routes/employees.py`, `app/static/js/jobs.js`, `app/static/js/employees.js`_

### Job budgets
- **Budget rows** (`job_budgets`) — Each row is per job × (cost code **or** cost type **or** neither = whole job). A row with both → 422.
  - Fields: `amount` (cost), `revenue_amount` (estimated revenue), `source` (`manual` | `estimate` | `change`), `estimate_id`, notes.
  - Budgets have **no period**: they are job-to-date figures.
- **Save** (`PUT /api/jobs/{id}/budgets` {rows}) — replaces the job's manual rows.
  - A supplied key updates its row and turns it `manual`. Zero rows are dropped.
  - Manual rows not supplied are deleted. Estimate-seeded rows not supplied are kept.
  - An unknown type → 422. An unknown code → 404.
- **Seed from estimate** (`POST /api/jobs/{id}/budgets/from-estimate/{estimate_id}`) — The estimate must belong to the job's customer (422 otherwise; 404 if missing).
  - One row per cost code on the estimate: cost = Σ qty × **unit cost** (0 when no unit cost is entered, so the sale price never masquerades as cost); revenue = Σ line amount. Uncoded lines roll into a whole-job row.
  - Re-seeding deletes all of the job's estimate-sourced rows first. Hand-edited per-code (manual) rows win and are skipped.
  - Estimate lines carry `cost_code_id` and `unit_cost` for this (the estimate form's Cost column).
- **Change orders slot** — Rows with `source = "change"` would fill the "Changes" column, but nothing in the code writes them yet.

_Key files: `app/models/job_costing.py`, `app/routes/jobs.py`, `app/services/job_costing.py`, `app/schemas/job_costing.py`, `app/static/js/jobs.js`, `app/static/js/estimates.js`_

### Committed cost
- **Definition** — The sum of purchase-order line amounts for lines whose job is theirs (line, else header), on POs with status `sent`, `partial` or `received`.
  - Draft POs are only intent. Closed POs are excluded: converting a PO to a bill closes it, and the cost moves into the ledger.
  - Committed cost is not period-filtered.
- **Where it shows** — The job summary, `/api/jobs/profitability`, each job and cost code in the cost tree (grouped by PO line cost code), the Jobs list, the Budget vs Actual report and the dashboard card.

_Key files: `app/services/jobs_service.py`, `app/services/job_costing.py`, `app/models/purchase_orders.py`_

### Budget vs actual: drill-down tree, report & dashboard card
- **Column vocabulary** — from Procore and QuickBooks Estimates vs Actuals:
  - *original* — the budget as entered or seeded.
  - *changes* — change-order budget rows.
  - *revised* — original + changes.
  - *committed* — open POs.
  - *actual* — posted job-to-date cost (period-filtered).
  - *projected* — actual + committed.
  - *variance* — revised − projected; positive means under budget.
  - *pct_used* — projected / revised × 100 (null without a budget).
  - *est_revenue* / *act_revenue* — budgeted vs posted revenue. The API also returns `revenue_diff`.
- **Cost tree** — `GET /api/jobs/{id}/cost-tree?start_date=&end_date=` returns `types[]` (cost_type, name, is_labor, figures, `codes` tree nodes with `own` and rolled-up `figures` plus `lines`, and `uncoded` {figures, lines}), `job_level_budget` and `totals`.
  - Types appear only when they have something. Type-level budgets add to their type. The whole-job budget adds to the totals only.
  - Income lines without a code show as revenue under Other › No cost code.
- **Job Budget vs Actual report** (`GET /api/jobs/budget-vs-actual?start_date=&end_date=&customer_id=&include_inactive=`) — one row per job with the headline figures plus job, customer, status and contract amount. Actuals and revenue honour the period; budgets and committed are job-to-date.
  - Report Center card "Job Budget vs Actual" shows Customer, Job, Budget, Committed, Actual, Projected, Variance (red when over), % Used and Revenue, with totals. A row click opens the job page. Screen only.
- **Dashboard card "Jobs: Budget vs Actual"** — a full-width card listing active jobs with any budget, actual or committed, ranked by projected variance (most over budget first). Shows the top 6 plus totals. It is in the nonprofit default layout and opt-in for businesses.

_Key files: `app/services/job_costing.py`, `app/routes/jobs.py`, `app/static/js/jobs.js`, `app/static/js/reports.js`, `app/services/dashboard_widgets.py`_

### Jobs import & export
- **IIF import** — `Customer:Job` names split at the **first** colon: "A:B:C" becomes job "B:C" under customer "A". A flat customer literally named "A:B" that already exists keeps matching, so re-imports stay stable. Customers and jobs are found case-insensitively or created. This covers customer list rows, invoices, sales receipts and estimates.
- **QBO import** — QuickBooks Online sub-customers ("Projects") become jobs under their parent customer.
- **IIF export** — Every job is written as a `CUST` row named "Customer:Job".
- **CSV export** — `GET /api/csv/export/jobs` (ID, Customer, Job, Customer:Job, Job #, Status, Type, Start, Projected End, Contract Amount, Active); button "Export Jobs". There is no jobs CSV import.

_Key files: `app/services/jobs_service.py`, `app/services/iif_import.py`, `app/services/qbo_import.py`, `app/services/iif_export.py`, `app/services/csv_export.py`, `app/routes/csv.py`_

### Change orders, progress billing, WIP & other planned items
- **Change orders** — numbered documents revising the estimate and contract amount with an audit trail (planned — design doc only). Only the budget "Changes" column and `source="change"` are ready.
- **Progress invoicing** — billing by % or amount per estimate line, tracking what has been billed (planned — design doc only).
- **Unbilled time & costs → invoice** — "Add unbilled time and costs" pulling billable lines into an invoice with markup (planned — design doc only). The billable flags and `billed_invoice_line_id` exist, but nothing marks costs as billed.
- **Retainage** — held and released on A/R and A/P (planned — design doc only).
- **WIP schedule and over/under billing** — based on percent complete (planned — design doc only).
- **Further job reports** — job cost by vendor, unbilled costs by job, time by job and P&L by job (planned — design doc only). Estimates vs actuals exists only as the Est. Rev / Act. Rev and budget columns of the cost tree.
- **Interop extras** — reading Desktop's Job Profitability / Estimates vs Actuals exports, and MYOB / Xero / Wave job and tracking-category mapping (planned — design doc only).
- **Inventory issued to a job / wage distribution** — inventory posting to job WIP or COGS by policy, and payroll distributing gross wages to jobs by hours (planned — design doc only). Only burden is distributed today; wages reach jobs through time posting at cost rate.
- **Nonprofit exclusions** — deliberately out per the docs: Form 990 filing, donor CRM (campaigns, appeals, events — a donation's fund is its campaign), endowment spending policy, grant compliance rules (allowable costs, indirect cost rates) and a year-end closing entry. The Form 990 Part IX row mapping is a stated follow-up, not built.

_Key files: `docs/design/projects.md`, `docs/design/nonprofit.md`, `docs/nonprofit-module.md`, `app/services/job_costing.py`_

### API endpoints
| Method | Path | What it does |
|---|---|---|
| POST | /api/nonprofit/setup-accounts | Create 3300/3400/4400/6960 if missing (idempotent); returns the four accounts |
| GET | /api/nonprofit/releases/suggest | Fund's spending in period − already released → suggested release (`class_id`, `start_date`, `end_date`) |
| GET | /api/nonprofit/releases | List releases (filters `class_id`, `status`), newest first |
| GET | /api/nonprofit/releases/{rel_id} | One release |
| POST | /api/nonprofit/releases | Post a release (DR 3400 / CR 3300 tagged to the fund); omit `amount` for the suggestion |
| POST | /api/nonprofit/releases/{rel_id}/void | Reverse a release |
| GET | /api/nonprofit/allocation-rules | List rules (`include_inactive`) |
| POST | /api/nonprofit/allocation-rules | Create rule with targets (409 on duplicate name) |
| GET | /api/nonprofit/allocation-rules/{rule_id} | One rule |
| PUT | /api/nonprofit/allocation-rules/{rule_id} | Replace rule and its targets |
| DELETE | /api/nonprofit/allocation-rules/{rule_id} | Delete rule (409 if any run references it) |
| GET | /api/nonprofit/allocation-rules/{rule_id}/split | Split one amount by the rule (`amount`, `start_date`, `end_date`, `class_id`) — the Split button |
| GET | /api/nonprofit/allocation-rules/{rule_id}/preview | Unassigned pool for a period and how it would split |
| GET | /api/nonprofit/allocations | List functional allocation runs (`rule_id`, `status`) |
| GET | /api/nonprofit/allocations/{fa_id} | One run with lines |
| POST | /api/nonprofit/allocations | Run a rule for a period (same-account reclass) |
| POST | /api/nonprofit/allocations/{fa_id}/void | Reverse a run (cost returns to unassigned) |
| GET | /api/donors/gifts/{kind}/{gift_id}/acknowledgment/preview | Eligibility + amount for invoice / payment / in-kind gift |
| GET | /api/donors/gifts/{kind}/{gift_id}/acknowledgment/pdf | Acknowledgment letter PDF |
| POST | /api/donors/gifts/{kind}/{gift_id}/acknowledgment/email | Email the letter (recipient/subject overrides) |
| GET | /api/donors/giving-statements/pdf | All active donors with gifts in `year` (optional `customer_ids`) in one PDF |
| GET | /api/donors/{customer_id}/giving-statement/pdf | One donor's giving statement for `year` |
| POST | /api/donors/giving-statements/batch-email | Email statements to donors, skipping opt-outs → sent/failed/skipped/errors |
| GET | /api/in-kind-gifts | List in-kind gifts (`customer_id`, `status`, `start_date`, `end_date`) |
| GET | /api/in-kind-gifts/{gift_id} | One in-kind gift |
| POST | /api/in-kind-gifts | Record and post an in-kind gift (DR asset/expense / CR In-Kind Contributions) |
| POST | /api/in-kind-gifts/{gift_id}/void | Reverse an in-kind gift |
| GET | /api/reports/statement-of-financial-position | Net assets with / without restrictions as of `as_of_date` |
| GET | /api/reports/statement-of-financial-position/pdf | Same as PDF |
| GET | /api/reports/statement-of-financial-position/csv | Same as CSV |
| GET | /api/reports/statement-of-activities | Revenue / releases / expenses by restriction (`compare=prior_year`) |
| GET | /api/reports/statement-of-activities/pdf | Same as PDF |
| GET | /api/reports/statement-of-activities/csv | Same as CSV |
| GET | /api/reports/fund-balances | Per restricted fund: beginning, contributions, spent, released, ending, unreleased |
| GET | /api/reports/fund-balances/pdf | Same as PDF |
| GET | /api/reports/fund-balances/csv | Same as CSV |
| GET | /api/reports/functional-expenses | Expense accounts × program / management / fundraising / unassigned (`compare=prior_year`) |
| GET | /api/reports/functional-expenses/pdf | Same as PDF |
| GET | /api/reports/functional-expenses/csv | Same as CSV, Form 990 Part IX column order |
| GET | /api/reports/pledges | Pledge report by donor and campaign (`class_id`, `customer_id`) |
| GET | /api/reports/pledges/pdf | Pledge report PDF (dates only) |
| GET | /api/reports/pledges/csv | Pledge report CSV, one row per pledge (dates only) |
| GET | /api/classes | List classes/funds with fund fields (`include_archived`) |
| POST | /api/classes | Create class/fund (restriction, default_function, donor_name, purpose) |
| PUT | /api/classes/{class_id} | Update name / archive / fund fields |
| DELETE | /api/classes/{class_id} | Delete an unused class |
| GET | /api/jobs | List jobs (`customer_id`, `include_inactive`, `status`) |
| GET | /api/jobs/profitability | Per-job profitability incl. "No job" + committed cost |
| GET | /api/jobs/budget-vs-actual | Headline budget / committed / actual / projected / variance per job |
| GET | /api/jobs/{job_id} | Job + profitability summary + committed cost |
| GET | /api/jobs/{job_id}/transactions | P&L lines attributed to the job |
| GET | /api/jobs/{job_id}/cost-tree | Drill-down tree types → codes → lines with budget columns |
| GET | /api/jobs/{job_id}/budgets | Budget rows |
| PUT | /api/jobs/{job_id}/budgets | Replace manual budget rows |
| POST | /api/jobs/{job_id}/budgets/from-estimate/{estimate_id} | Seed budget from an estimate (cost = qty × unit cost) |
| POST | /api/jobs | Create job |
| PUT | /api/jobs/{job_id} | Update job (incl. `is_active`, customer move) |
| DELETE | /api/jobs/{job_id} | Delete a job with no posted activity |
| GET | /api/cost-types | List cost types (seeds defaults; `include_inactive`) |
| POST | /api/cost-types | Create cost type |
| PUT | /api/cost-types/{type_id} | Update cost type (burden, method, accounts, active) |
| DELETE | /api/cost-types/{type_id} | Delete an unused, non-standard cost type |
| POST | /api/cost-types/setup-offsets | Create applied-cost accounts and fill blank type accounts |
| GET | /api/equipment | List equipment (`include_inactive`) |
| POST | /api/equipment | Create equipment |
| PUT | /api/equipment/{eq_id} | Update equipment |
| DELETE | /api/equipment/{eq_id} | Delete unused equipment |
| GET | /api/job-costs | List Job Cost Entries (`job_id`, `status`, `start_date`, `end_date`) |
| GET | /api/job-costs/{jc_id} | One Job Cost Entry |
| POST | /api/job-costs | Post a Job Cost Entry |
| POST | /api/job-costs/allocate | Spread one amount across jobs (percent / hours / revenue / costs / equal) |
| POST | /api/job-costs/{jc_id}/void | Reverse a Job Cost Entry (releases linked time entries) |
| GET | /api/cost-codes | List cost codes with depth/parent (`include_inactive`) |
| GET | /api/cost-codes/tree | Nested cost-code tree |
| POST | /api/cost-codes/import | Bulk import JSON rows or CSV text |
| POST | /api/cost-codes | Create cost code |
| POST | /api/cost-codes/standard | Load CSI MasterFormat divisions + Labor + Equipment Rental |
| PUT | /api/cost-codes/{code_id} | Update cost code (cycle-checked parent) |
| DELETE | /api/cost-codes/{code_id} | Delete an unused cost code |
| POST | /api/invoices/{invoice_id}/write-off | (related) Write off a pledge/invoice balance to Bad Debt via credit memo |
| POST | /api/credit-memos/{cm_id}/void | (related) Void a credit memo — the write-off undo |
| POST | /api/time-entries/{entry_id}/post-to-job | (related) Post one time entry to its job at loaded cost |
| POST | /api/time-entries/post-to-job | (related) Bulk post time entries to jobs |
| GET | /api/reports/job-profitability | (related) Job Profitability report with totals |
| GET | /api/csv/export/jobs | (related) Jobs CSV export |

### Notes, gaps & discrepancies
- **Budget seeding hint vs code** — The job page Budget tab says "Cost = qty × unit cost (or the line amount when no cost is entered)". The service (and CHANGELOG v2.7.0) budgets **0** cost when no unit cost is entered.
- **"One click from the time list"** (CHANGELOG v2.7.0) — The Time Entries list has no post-to-job button: `TimeEntriesPage.postToJob` exists but nothing calls it. Posting happens on the job page's Time tab. That tab's bulk button says "approved" but also includes submitted entries.
- **docs/design/projects.md milestone table is stale** — M4 (time → jobs, employee cost rates, payroll burden distribution) has no status there, but the code ships it. The design's "payroll distributes gross wages … by hours" is only partly true: only employer taxes and job-routed benefits are distributed.
- **docs/data-model.md** — Lists `job_costs.source` as manual/time_entry/allocation. The code also writes `payroll` (and `JOB_COST_SOURCES` omits it). `cost_types.burden_method` is undocumented there.
- **Stale "payroll clearing" wording** — The user-visible Settings → Cost Types hint (and the code comments in `app/static/js/job_costs.js` and `app/models/job_costing.py`) still describe offsets as "payroll clearing". The code deliberately uses P&L contra accounts (Applied Labor Cost etc.) after the v2.7.0 finding that a balance-sheet clearing offset double-counted labor.
- **`burden_method` is not validated** — Any string is accepted; only `payroll` changes behaviour.
- **Unvalidated `function` values** — `function` on bill, journal, expense and CC charge lines is not validated (only class defaults and allocation targets are validated). A typo is stored, reports as Unassigned, and is never picked up by an allocation run because it is not NULL. (inferred from code)
- **Allocation-run caveats** — inferred from code:
  - A fund-only target whose fund has no default function posts its share unassigned, so a re-run for the same period can move it again.
  - A net-negative pool row fails the run on the non-negative line check.
  - The API runs inactive rules.
  - Voided runs still block rule deletion.
- **Release matching by posting date** — The suggestion subtracts releases dated inside the period, not by their stored period. A release dated after its period is therefore not netted when that period is re-suggested. Explicit amounts are uncapped. (inferred from code)
- **Hours bases ignore status** — Nonprofit hours-basis rules and job `hours` allocations count every time entry on the job (draft and rejected included), unweighted. Split at entry passes no dates, so it uses all-time hours.
- **Gift detection** — inferred from code:
  - Any payment not applied to a sales receipt is treated as a gift for acknowledgments and giving statements, including payments on non-pledge program-fee or rental invoices.
  - The acknowledgment endpoints do not refuse a voided donation receipt (the UI hides the buttons; giving statements exclude void receipts).
- **Pledge Report caveats** — column and filter edge cases:
  - A regular (non-write-off) credit memo applied to a pledge appears in none of the three columns, so invoiced = received + written off + outstanding can break (inferred from code).
  - "Outstanding" is the current balance, not the balance as of the period end.
  - PDF and CSV ignore the `class_id` / `customer_id` filters.
- **Giving statements** — batch and selection gaps:
  - The batch email body is a fixed inline HTML string, not an editable template, and the donor name and salutation are interpolated without HTML escaping.
  - The all-donor PDF and the batch skip inactive donors; the per-donor endpoint does not.
  - The Anonymous Donor walk-in record defaults to `send_year_end_statement = true` and has no email, so it would be reported as a batch failure if it has gifts. (inferred from code)
- **Walk-in naming** — A company that created "Walk-in Customer" before switching to nonprofit keeps using that record via the `walk_in_customer_id` setting, while the form labels it "Anonymous Donor". (inferred from code)
- **Class delete guard** — `DELETE /api/classes/{id}` checks only transaction headers, although its comment says any referencing document blocks deletion. A fund used only on lines passes the check.
- **Exports** — The Classes CSV export carries no fund fields (restriction, function, donor, purpose). Donor fields are not in the customer CSV. Jobs and classes have no CSV import.
- **UI-only gaps** — These are accepted by the API but have no UI:
  - The Settings cost-code form offers only the five built-in cost types.
  - Recurring pledge templates have no grant (job) picker.
  - In-kind lines have no per-line fund/grant or credit-account override.
  - Job Cost Entry lines have no `is_burden` control.
  - Journal forms have no billable control.
- **Vocabulary leak** — The Recurring page empty state "No recurring invoices set up" is not wrapped in `Terms.text()`. The sweep test's word regex is case-sensitive, so the lower-case "invoices" slips past it.
- **No server check that a document's job belongs to its customer** — Only the SPA picker narrows jobs to the customer.
- **Committed cost** — Counts full PO line amounts (pre-tax) while a PO is sent, partial or received. Partial receipt or billing does not reduce it until the PO is closed by conversion.
- **Editing budget rows** — Zeroing an estimate-seeded budget row in the editor has no effect: zero rows are skipped and only manual rows are deleted. (inferred from code)
- **Cost tree comment** — A comment in `job_cost_tree` says codes of an unknown cost type "still show up". The code only adds whole-job budgets there, so such codes would be omitted. It is unreachable in practice because cost types are validated.
- **No edit endpoints** — Releases, allocation runs, in-kind gifts and Job Cost Entries can only be voided and re-entered. `DELETE` on them returns 405 naming `POST …/void`.
- **No pay-run void** — So a payroll-burden Job Cost Entry can only be reversed by voiding it directly.
- **Design-doc divergences (nonprofit)** — shipped differently from the design:
  - Releases post to plain 3300/3400, not the "– releases" sub-accounts the design describes.
  - The functional-expense CSV ships in Part IX column order only; the row mapping is an acknowledged follow-up.
  - The design's year-end close was not built, by design.
- **Riverbend demo** — The seed script cited in docs/nonprofit-module.md (`~/Development/slowbooks-demo-data/seed_nonprofit_demo.py`) is outside this repository. The in-repo equivalent is `tests/test_nonprofit_byoai_e2e.py`.
- **No reporting outputs for job reports** — Job Profitability and Job Budget vs Actual have no PDF/CSV and cannot be saved as saved reports. The nonprofit statements can.

---

_[← 5. Reports, Dashboard, Analytics & AI](05-reports-dashboard-analytics-ai.md) · [Index](README.md) · [7. Import, Export, Migration & Interoperability →](07-import-export-migration.md)_
