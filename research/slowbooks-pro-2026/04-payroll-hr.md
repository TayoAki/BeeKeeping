_SlowBooks Pro 2026 feature inventory — [← 3. General Ledger, Chart of Accounts & Banking](03-general-ledger-banking.md) · [Index](README.md) · [5. Reports, Dashboard, Analytics & AI →](05-reports-dashboard-analytics-ai.md)_

## 4. Payroll & HR

SlowBooks Pro ships a US payroll and HR module: employee records with 2020+ Form W-4 and state W-4 inputs, pay runs that compute federal (Pub 15-T percentage method), FICA, FUTA, SUTA and state withholding for every state plus DC, a rule-driven benefits/deductions engine, CCPA-limited garnishments, PTO banks with optional dollar liability, time tracking, onboarding checklists, a token-accessed employee self-service portal, NACHA direct-deposit files, and W-2/W-3/940/941 forms with SHA-256 audit footers. Pay runs are created as drafts with every figure calculated, then processed into a single balanced journal entry. All tax tables are hard-coded constants labelled "2026-approximate" (federal and the four dedicated state engines) or "2026 published values" (the 47 table-driven states), and every screen and form carries a verify-before-filing disclaimer. What follows is what the code at v2.18.1 actually does, including its gaps.

### Access control, navigation & disclaimers
- **HR/payroll is admin-only (Server Edition RBAC)**: enforced centrally in the `require_session` middleware.
  - Every method on `/api/payroll`, `/api/tax-forms`, `/api/benefits`, `/api/deductions` and `/api/onboarding` is refused to `bookkeeper` and `readonly` roles with 403 "Your role doesn't allow this action".
  - `/api/employees` is in the admin-write list: only admins create or edit staff records. Reads are open to every role, but non-admins get a redacted view.
  - Credential-bearing employee sub-resources are admin-only for reads too. A regex covers `portal-token`, `portal-access`, `everify`, `bank-accounts`, `documents` and `ytd` under `/api/employees/{id}/`.
  - Non-admin redaction blanks or zeroes: `ssn_last_four`, `pay_rate`, `cost_rate`, `burden_pct`, `filing_status`, all W-4 fields, the address, `residence_state`, `wc_class_code` and the four state W-4 fields. The name, `work_state`, pay type/frequency, hire date, email and active flag stay visible (time entries and job costing need them).
  - `/api/time-entries` and `/api/pto` are **not** HR-gated. Bookkeepers can log and approve time and approve PTO requests, and readonly users can read them.
  - API tokens (`Authorization: Bearer sbp_…`) carry a role and are gated the same way.
  - `/portal/` is exempt from session auth; it uses its own token and cookie scheme (see the portal section below).
- **SPA pages**: `#/employees`, `#/payroll`, `#/hr/onboarding`, `#/hr/time-entries`, `#/hr/pto` ("Time Off"), `#/hr/benefits`, `#/hr/deductions` ("Garnishments") and `#/hr/tax-forms`.
  - In multi-user mode the sidebar hides `employees`, `payroll`, `hr-onboarding`, `hr-benefits`, `hr-deductions` and `hr-tax-forms` from non-admins (`ADMIN_ONLY_PAGES`). Opening one by URL shows "… is for administrators".
  - For readonly sign-ins, write buttons are hidden, among them Process, Approve/Reject, Run Accrual, Revalue, End order, Retire and Rebuild YTD.
- **Disclaimers**:
  - The Payroll page has a yellow banner: "Tax calculations are approximate. Verify with a tax professional before filing."
  - The Tax Forms page has a caution card.
  - Every form PDF footer reads "This is not an official IRS form · Verify with a tax professional before filing."

_Key files: `app/main.py`, `app/routes/_roles.py`, `app/routes/employees.py`, `app/static/js/app.js`_

### Employee records
- **Identity & contact**:
  - `first_name`/`last_name` (required, 100 characters each).
  - `ssn_last_four`: only the last four digits are ever stored. The full SSN is never collected.
  - `email`: free text, not validated.
  - Mailing address: `address1`, `address2`, `city`, `state` (free text, 50 characters), `zip`.
  - `notes`.
- **Pay setup**:
  - `pay_type` enum: `hourly` (the default) or `salary`.
  - `pay_rate`, stored as `Numeric(15,2)`: dollars per hour for hourly employees, annual salary for salaried ones.
  - `pay_frequency` enum: `weekly` (52 periods), `biweekly` (26, the default), `semi_monthly` (24) or `monthly` (12). An unknown value resolves to 26.
  - `hire_date`.
  - `is_active`, default true.
- **Federal W-4 (2020+ redesign, no allowances)**:
  - `filing_status` enum: `single` (single or married filing separately, the default), `married` (married filing jointly) or `head_of_household`.
  - `multiple_jobs`: the Step 2(c) checkbox.
  - `dependents_amount`: the Step 3 credit in dollars.
  - `other_income_annual`: Step 4(a).
  - `deductions_annual`: Step 4(b).
  - `extra_withholding`: Step 4(c), per pay period.
  - There is no "exempt" election and no pre-2020 allowance mode.
- **State and tax situs fields**:
  - `work_state`: the 2-letter code that selects the withholding engine.
  - `residence_state`: drives reciprocity.
  - `wc_class_code`: the WA L&I risk class.
  - `state_allowances`: integer count of state W-4 exemptions (IL-W-4 line 1, MI-W4, VA-4 …).
  - `state_extra_withholding`: dollars per period.
  - `state_rate_override`: an elected percent for flat-rate states, meant for Arizona A-4.
  - `local_tax_rate`: a flat county/city/school percent.
- **HR & self-service fields**:
  - `role` enum: `admin`, `manager` or `employee` (the default).
  - `manager_id`: a self-referencing FK.
  - Portal token columns: `portal_token_hash`, `portal_token_enc`, `portal_token_last_used`, `portal_token_expires_at`.
  - E-Verify columns (see the E-Verify bullet below).
- **Job-costing & benefits links**:
  - `cost_rate`: the loaded hourly cost. When blank, job costing uses the pay rate, or salary ÷ 2080.
  - `burden_pct`: overrides the labor cost type's burden percentage.
  - `employee_group_id`: the benefits template group.
- **Validation on create/update** (`_clean_employee_fields`). Refusals are HTTP 400 with a plain-language sentence:
  - SSN last 4 must match `\d{4}`.
  - `pay_rate` can't be negative.
  - `work_state` and `residence_state` must be one of the 51 supported codes or a territory (`PR`, `GU`, `VI`, `AS`, `MP`). Codes are upper-cased and blanks become null.
  - An invalid `pay_type`, `pay_frequency`, `filing_status` or `role` is a 422, because the schema fields are typed enums.
- **Side effects of creating an employee**: a self-service portal token is minted and the default 8-task onboarding checklist is seeded. The response is 201.
- **Lifecycle limits**:
  - There is no DELETE endpoint for employees and no termination date or termination workflow.
  - Deactivation is `PUT … {"is_active": false}`, API only; the Add/Edit Employee form has no active toggle.
  - Inactive employees drop out of the pay-run roster (`active_only=true`), and their portal link returns 404.
  - `role` and `manager_id` are stored but no code reads them. They grant no approval rights.
- **E-Verify (record-keeping only)**: the case is submitted through the federal portal or a vendor; SlowBooks only stores the result.
  - Stored fields: `everify_case_number` (30 characters), `everify_status`, `everify_submitted_at`, `everify_closed_at` and `everify_notes`.
  - Statuses: `not_submitted`, `pending`, `photo_match_required`, `tnc`, `employment_authorized`, `final_non_confirmation`, `case_closed`. Anything else is a 400 listing the valid values.
  - `submitted_at` is stamped the first time the status is anything but `not_submitted`.
  - `closed_at` is stamped the first time the status becomes `employment_authorized`, `final_non_confirmation` or `case_closed`.
- **HR document vault** (`/api/employees/{id}/documents`):
  - Files are stored as attachment rows in the company's own database.
  - Allowed extensions: `.pdf .png .jpg .jpeg .gif .webp .txt .csv .doc .docx .xls .xlsx .zip`. The MIME type must also be on the allow-list.
  - `doc_category` is free text, trimmed to 50 characters, default `general`.
  - Every upload is a new row, so an updated W-4 keeps the earlier one. Deleting a document removes its bytes too.
  - Rows carry `from_shared_folder` and `missing` flags from the 2.18.0 migration off the shared uploads folder.
- **UI (`#/employees`)**:
  - List columns: name, pay type, rate (`/hr` or `/yr`), Active/Inactive, filing status, and Edit and Details buttons.
  - The Add/Edit modal has sections for the core fields, the "Form W-4 (2020+)" block and the address. It includes a benefit-group picker, a state-code datalist and a live hint for the selected state (e.g. "needs a local rate", "elected rate").
  - The Details modal has sections for Overview, Portal Access, E-Verify, YTD Totals, Bank Accounts and Documents. Documents support drag-and-drop, upload with a category, download and delete.

_Key files: `app/models/payroll.py`, `app/routes/employees.py`, `app/schemas/payroll.py`, `app/static/js/employees.js`_

### Direct-deposit bank accounts & payroll encryption
- **EmployeeBankAccount** fields:
  - `nickname` and `account_kind` (`checking` or `savings`).
  - `routing_number_enc` and `account_number_enc`: Fernet ciphertext, never returned by the API.
  - `account_last_four`: stored in the clear for display.
  - `deposit_type`: `full`, `percent`, `fixed` or `remainder`, used with `deposit_value` (a percent from 0–100, or dollars) and `priority`.
  - `prenote_status`: `not_sent`, `pending` or `confirmed`, plus `prenote_sent_date`.
  - `is_active`.
- **Entry validation** (admin API and portal alike):
  - The routing number must pass the full ABA checksum: 9 digits weighted 3-7-1 must sum to a multiple of 10. Otherwise 400 "Invalid routing number".
  - The account number must be all digits. Otherwise 400.
  - Bad enum values are a 400.
  - Account length, and the range of `deposit_value`/`priority`, are not validated.
- **Admin API**: list (ordered by priority), add and hard-delete. There is no edit endpoint and no deactivate endpoint.
- **Encryption scheme**:
  - Fernet (AES-128-CBC + HMAC-SHA256) with the key derived by PBKDF2-HMAC-SHA256 from `PAYROLL_ENCRYPTION_SECRET`: 480,000 iterations, static salt `slowbooks-payroll-v1`.
  - Ciphertext is prefixed `v1:`. Empty input encrypts to null.
  - An undecryptable value returns None and logs an error, rather than raising.
- **Key rotation**:
  - Put the old secret in `PAYROLL_ENCRYPTION_SECRET_PREV`. Decrypt tries the current key first, then the previous one.
  - `python -m app.services.encryption rewrap [--dry-run]` re-encrypts bank fields under the current key. It also re-encrypts `fernet:` settings rows when the settings key is derived from the payroll secret.
  - It prints checked, already-current, rewrapped and failed counts, and exits 1 if any value fails to decrypt.
  - Portal-token copies are not rewrapped. They re-encrypt themselves the next time the employee uses the link.
- **Startup guards**:
  - The app refuses to start when the secret is still the public dev default (`slowbooks-dev-payroll-key-change-me`) on a non-SQLite database. This holds even with `APP_DEBUG` on.
  - In production mode it also refuses to start with the dev secret on any database.

_Key files: `app/models/bank_accounts.py`, `app/services/encryption.py`, `app/services/nacha_export.py`, `app/main.py`_

### Pay runs: creation, gross pay & stub math
- **Lifecycle**:
  - `POST /api/payroll` creates a pay run with status `draft`. Every stub is fully calculated at this point and time entries are consumed.
  - `POST /api/payroll/{id}/process` moves it to `processed`.
  - A `void` status exists in the enum, but no endpoint sets it. There is no void, delete, edit or recalculate endpoint for a pay run, draft or processed.
- **Run types**: `run_type` is `regular` (the default), `off_cycle` or `bonus`. Anything else is 400 "Invalid run_type". The SPA always creates `regular` runs.
- **Header fields**: `period_start`, `period_end` and `pay_date`. None of them are cross-validated: an end date before the start is accepted. The tax year is the calendar year of `pay_date`.
- **Empty-run refusal**: `stubs: []` returns 422 "stubs is empty: a pay run needs one stub per employee to pay. Active employees: Name (id N), …".
- **Per-stub inputs** (`PayStubInput`, strict: unknown keys are a 422):
  - `employee_id`, `hours`, `regular_hours`, `overtime_hours`, `doubletime_hours`.
  - `gross_override`.
  - `pretax_deductions` and `posttax_deductions`: ad-hoc amounts added on top of the employee's benefit codes.
  - `reimbursements`: a non-taxable accountable plan.
  - `supplemental` and `supplemental_method` (`flat` or `aggregate`).
  - `work_state`: a per-stub override for multi-state work.
  - `use_time_entries`.
  - Negative hours, deductions, reimbursements or gross override are rejected with 422.
- **How gross is computed** (first rule that applies):
  - If `gross_override` is set, that amount is used and the stub records zero hours.
  - Salary: annual rate ÷ periods per year for the employee's frequency. There is no proration for partial periods, and hours stay 0.
  - Hourly with `use_time_entries`: sums `hours_regular`/`hours_overtime`/`hours_doubletime` from **approved**, unpaid entries dated within the period.
  - Hourly otherwise: overtime and double time come from the stub. Regular hours are `regular_hours` if given, else `hours − OT − DT`, floored at 0.
  - Hourly pay is `reg×rate + OT×rate×1.5 + DT×rate×2`, rounded half-up to cents. The 1.5× and 2× multipliers are fixed, and there is no regular-rate blending.
- **$0 refusal**: if any stub's gross and reimbursements are both $0.00, the whole run is refused with 422 and nothing is written. The message names every such employee:
  - With time entries and some time pending: "… has no approved time from {period}: N time entries (H hours) waiting for approval under Time Entries…".
  - With time entries and none pending: "… has no approved time … Log and approve it…".
  - Otherwise: "{Name} would be paid $0.00. Enter hours or an amount, or leave {Name} out of this run."
- **Unapproved-time warnings**: draft or submitted entries in the period are not paid. The create response carries `warnings[]` naming them, and the SPA shows them in a modal that waits to be closed.
- **Time-entry sweep**: consumed entries get `pay_run_id` set when the **draft** is created, so they can never be paid twice and are locked against edit or delete.
- **Per-stub order of calculation**:
  1. The stub's work state is `stub.work_state`, then `employee.work_state`, then **`WA`**. The withholding state then follows the reciprocity rules.
  2. YTD figures are recomputed from existing stubs in the pay-date year with pay dates before this one. **Draft runs count** because only `void` runs are excluded.
  3. The benefits engine resolves and evaluates the employee's codes.
  4. `calculate_withholdings` computes the taxes. Federal wages drop the engine's federal-reducing amount plus ad-hoc pre-tax; state wages drop the state-reducing amount plus ad-hoc pre-tax; FICA wages drop only the engine's FICA-reducing amount.
  5. Garnishments are applied to disposable earnings (gross − all employee taxes).
  6. Post-tax deductions are capped at what remains of the check. When the post-tax total would overdraw it, the engine re-runs with `posttax_available` and trims codes in sequence, noting the shortfall on the stub; the ad-hoc post-tax amount is trimmed last.
- **Net pay**: gross − employee taxes − pre-tax − post-tax − garnishments + reimbursements. If the result is negative the run is refused with 422 "{Name}: deductions and garnishments exceed pay (net would be X)…".
- **Stub columns**:
  - Hours: total, regular, overtime and double time, plus `gross_pay`.
  - Employee side: `federal_tax`, `state_tax`, `state_other_employee` (PFML/SDI/local…), `ss_tax`, `medicare_tax`, `pretax_deductions`, `posttax_deductions`, `garnishments`, `reimbursements`, `net_pay` and `work_state`.
  - Employer side: `employer_ss_tax`, `employer_medicare_tax`, `futa_tax`, `suta_tax`, `state_other_employer` and `employer_benefits`.
  - `detail_json` itemizes every tax line with keys such as `garnishment:{type}:{order_id}`, `benefit:{CODE}`, `employer_benefit:{CODE}`, `benefit:{CODE}:note`, `other_pretax_deductions`, `other_posttax_deductions` and `reimbursements`.
- **Run totals**: `total_gross`, `total_taxes` (employee side), `total_employer_taxes`, `total_employer_benefits` and `total_net`.
- **Not checked at create**: whether the employee is active, duplicate employees in one run, or overlapping periods.
- **Supplemental wages**:
  - The flag is per stub; `run_type=bonus` does not switch withholding on by itself.
  - `aggregate` method: the base is the gross of the most recent non-void `regular` run before this pay date.
  - YTD supplemental wages (for the $1M/37% tier) are the gross of `bonus`-type runs only.
- **UI (`#/payroll`)**:
  - The list shows period, pay date, status, gross, taxes and net, with View and, for drafts, Process. It is capped at 200 rows with "Show all".
  - New Pay Run modal:
    - Dates: period start (defaults to today), period end and pay date.
    - "Use approved time entries…" checkbox. It disables the hours inputs and shows a per-employee preview from `/api/time-entries/summary`, in red when entries await approval.
    - Employee rows are all ticked, with default hours of 80 for hourly and 0 for salary.
    - "Calculate Payroll" submits. Refusals appear inline.
  - The View modal has columns for Employee, Hours, Gross, Fed, State, SS, Med, Other (state other + garnishments), Benefits (EE, +ER), Deductions, + Reimb. and Net. Each row has a "Stub PDF — {name}" button, and the totals include a labor-burden link.
  - The SPA has no controls for gross override, reimbursements, per-stub work state, supplemental or run type; those are API only.

_Key files: `app/routes/payroll/runs.py`, `app/routes/payroll/ytd.py`, `app/schemas/payroll.py`, `app/models/payroll.py`, `app/static/js/payroll.js`_

### Pay run processing: journal entry & job-cost burden
- **Guards**:
  - 404 for an unknown run.
  - 400 "Pay run already processed" or "Pay run is void".
  - The closing-date check runs on `pay_date`: 403 when the period is closed, with a closing-date password override.
  - 400 when neither 6110/6000 nor 1000 exists.
- **Accounts** are looked up by number, each with a fallback:
  - Wages: 6110 Wages & Salaries, else 6000 (the seeded 6000 is "Advertising & Marketing").
  - Employer taxes: 6120 Payroll Tax Expense, else 6000.
  - Reimbursements: 6140 Employee Expense Reimbursements, else 6950 Misc.
  - Bank: 1000 Checking.
  - Payables: 2310 federal withholding, 2320 state withholding, 2330 Social Security, 2340 Medicare, 2350 FUTA, 2360 SUTA and 2370 Other Payroll Deductions, each falling back to 2300 Payroll Liabilities.
  - Unmapped employer benefit cost: 6150, else 6120.
- **Journal entry lines**. One entry dated `pay_date`, described "Payroll {start} - {end}", `source_type="payroll"`:
  - DR wages expense: total gross.
  - DR payroll tax expense: employer SS + Medicare + FUTA + SUTA + state employer items.
  - DR reimbursement expense.
  - DR each benefit code's expense account for its employer share (unmapped shares go to 6150).
  - CR each benefit code's liability account: employee withholding plus employer share.
  - CR 2310 federal withholding and CR 2320 state income tax.
  - CR 2330 SS (employee + employer) and CR 2340 Medicare (employee + employer).
  - CR 2350 FUTA and CR 2360 SUTA.
  - CR 2370 "Other payroll deductions payable": state employee and employer items (including local tax), ad-hoc pre/post-tax amounts, garnishments and unmapped benefit liabilities.
  - CR 1000 net pay.
  - Zero-amount lines are omitted. `create_journal_entry` refuses an unbalanced entry.
- **Job-costing seam**: when the labor cost type's `burden_method` is `payroll`, processing posts one Job Cost Entry (source `payroll`). It spreads each employee's employer taxes and `job_burden`-routed benefit costs over the jobs their swept time entries hit, weighted by cost hours (OT 1.5×, DT 2×). Its id is stored as `burden_job_cost_id`. This needs stubs built from time entries.
- **Overdraft warning (client side)**: before processing, the SPA fetches `/banking/overview`. If account 1000's balance minus total net would go negative, it asks "{account} will be overdrawn by $X. Process anyway?". A failed lookup never blocks processing.
- **Snapshot**: processing does not recalculate. The stubs keep the figures computed when the draft was created.

_Key files: `app/routes/payroll/runs.py`, `app/services/accounting.py`, `app/services/job_costing.py`, `app/seed/chart_of_accounts.py`, `app/static/js/expenses.js`_

### Federal withholding, FICA, FUTA & SUTA
- **Federal income tax** follows Pub 15-T Worksheet 1A (percentage method for automated systems). The code labels its brackets "2026-approximate".
  - Annual wage = period taxable wages × periods, plus Step 4(a) other income.
  - Subtract Step 4(b) deductions plus the standard-deduction add-back: $12,900 married, $8,600 single or head of household. The add-back is skipped when the Step 2 box is checked. Floor the result at 0.
  - Apply the annual schedule, divide by periods, subtract Step 3 dependents ÷ periods (floored at 0), add the Step 4(c) extra, and round half-up to cents.
  - Standard schedules, lower bounds of the 0/10/12/22/24/32/35/37% bands:
    - Single: 0 / 6,000 / 17,600 / 53,150 / 106,525 / 197,950 / 249,725 / 615,350.
    - Married: 0 / 17,100 / 40,300 / 111,400 / 218,150 / 400,000 / 503,550 / 747,200.
    - Head of household: 0 / 13,300 / 29,850 / 76,400 / 113,800 / 205,250 / 257,000 / 622,650.
  - Separate "Step 2 checkbox" schedules are used when `multiple_jobs` is set (single starts 7,300 / 13,100 / 30,875 …).
  - An unknown filing status falls back to single.
- **Supplemental federal withholding**:
  - Flat method: 22%. The part of cumulative supplemental wages above $1,000,000 is taxed at 37%.
  - Aggregate method: tax(regular + supplemental) − tax(regular), with Step 4(c) extra withholding excluded.
- **Social Security**: 6.2% employee and 6.2% employer on FICA wages, up to a $184,500 wage base. The base is measured against YTD **gross**.
- **Medicare**: 1.45% employee and 1.45% employer. The employee also pays 0.9% Additional Medicare on wages above $200,000 YTD, whatever the filing status. The employer never pays the additional 0.9%.
- **FICA wages**: gross minus the pre-tax codes flagged `reduces_fica` (Section 125, HSA). A traditional 401(k) reduces income-tax wages but not FICA wages.
- **FUTA**: an effective 0.6% (6.0% less the full 5.4% state credit) on the first $7,000 of FICA wages per employee per year. Credit-reduction states are not modelled.
- **SUTA**:
  - One company-wide rate from the `SUTA_RATE` env var (default `0.012` = 1.2%) applies to every state.
  - The wage base is the **work-state engine's** SUTA base, measured against YTD gross across all states.
  - The calculator accepts a per-call `suta_rate`, but the pay run never passes one. There are no per-state experience rates.
- **Rounding**: every amount is quantized half-up to cents (`_q`).

_Key files: `app/services/payroll_service.py`, `app/config.py`_

### State withholding engines
- **Engine registry**:
  - `get_engine(code)` resolves a case-insensitive 2-letter code: dedicated engines for **WA, CA, NY, OR**, and a table-driven `TableEngine` for the other **47 jurisdictions (46 states + DC)**.
  - Unknown codes and territories fall back to `GenericStateEngine`: zero income tax, SUTA base $9,000, detail line "State income tax (generic)".
  - A dedicated engine returns nothing when gross ≤ 0 **or** state-taxable wages ≤ 0. The table engine returns nothing only when gross ≤ 0.
- **Washington** (dedicated; no income tax):
  - PFML: 0.74% of gross, split 71.43% employee / 28.57% employer, with no wage cap.
  - WA Cares: 0.58% of gross, employee only.
  - L&I workers' comp: hours × class rate, split into employee and employer shares.
  - SUTA base $78,200.
- **California** (dedicated):
  - 9-band progressive schedule from 1.1% to 13.53%. Single brackets 0 / 10,800 / 25,600 / 40,400 / 56,100 / 70,900 / 362,000 / 434,000 / 724,000; the married schedule is roughly doubled.
  - Standard deduction $5,500 single / $11,000 married.
  - SDI: 1.1% of gross, employee only, no cap.
  - SUTA base $7,000.
- **New York** (dedicated):
  - 9-band progressive schedule from 4% to 10.9%, with separate single and married schedules.
  - Standard deduction $8,000 single / $16,050 married.
  - SDI: 0.5% of gross, capped at $0.60 per week, converted to a per-period cap of 0.60 × 52 ÷ periods.
  - PFL: 0.388% of gross, capped at $354 per year. Prior PFL is approximated as YTD gross × rate.
  - SUTA base $13,000.
- **Oregon** (dedicated; the module is `oregon.py` because `or` is a Python keyword):
  - 4-band progressive schedule from 4.75% to 9.9%, single and married.
  - Standard deduction $2,745 single / $5,495 married.
  - Statewide transit tax: 0.1% of gross, employee.
  - SUTA base $56,700.
- **Table-driven algorithm** (`TableEngine`, annualized percentage method):
  - Annual taxable = period taxable × periods − standard deduction(status) − base exemption(status) − `state_allowances` × per-allowance exemption, floored at 0. Head of household and unknown statuses fall back to the single values.
  - Flat-method rate: `state_rate_override` ÷ 100 when > 0, else the state's flat rate, else its `default_rate`. The override works for **any** flat-rate state.
  - Otherwise the status's bracket schedule applies. When a state supplies no married schedule, married thresholds are the single thresholds doubled; a missing head-of-household schedule copies single.
  - Period tax = annual ÷ periods, floored at 0, plus `state_extra_withholding`. In a no-income-tax state, extra withholding alone is still withheld as income tax.
  - Local tax: taxable wages × `local_tax_rate` %. It appears as its own "{ST} local income tax" line, goes into employee "other" and posts to 2370.
  - Other items (SDI/TDI/PFML/UI): a flat rate on gross up to an annual wage base, measured against YTD gross.
- **No wage income tax** (8): AK, FL, NV, NH, SD, TN, TX, WY.
  - AK still withholds employee UI at 0.5% up to $54,200.
- **Flat-rate states** (14): AZ (employee-elected rate, default 2.0%), CO 4.40%, GA 4.99%, ID 5.30%, IL 4.95%, IN 2.95%, IA 3.80%, KY 3.50%, LA 3.00%, MA 5.00%, MI 4.25%, NC 3.99%, PA 3.07%, UT 4.45%.
- **Progressive (bracket) states** (25): AL, AR, CT, DE, DC, HI, KS, ME, MD, MN, MS, MO, MT, NE, NJ, NM, ND, OH, OK, RI, SC, VT, VA, WV, WI.
  - Examples of single ranges: CT 2.00–6.99% (7 bands), HI 1.40–11.00% (12), MD 2.00–6.50% (10), NJ 1.40–10.75% (7).
- **Per-allowance exemptions**:
  - GA $5,000 (G-4 dependents), IL $2,925, IN $1,000, MI $5,900, AL $1,000, HI $1,144, KS $2,320, ME $5,300, MD $3,200, MN $5,300, MS $1,500, NJ $1,000, OH $2,400, OK $1,000, RI $5,250, SC $4,930, VT $5,300, VA $930, WV $2,000, WI $700.
  - Base exemptions (by status, applied regardless of allowances): MA, CT, AL, KS and MS.
- **Other employee/employer items** (wage bases in dollars):
  - CO FAMLI 0.44% employee and 0.44% employer, to $176,100.
  - MA PFML 0.46% employee and 0.42% employer, to $176,100.
  - CT Paid Leave 0.5% employee, to $176,100.
  - DE Paid Leave 0.4% employee and 0.4% employer, to $176,100.
  - DC Paid Family Leave 0.75% employer, no cap.
  - HI TDI 0.5% employee, to $78,000.
  - MN Paid Leave 0.44% employee and 0.44% employer, to $176,100.
  - NJ: UI+WF 0.425% to $44,800, TDI 0.19% to $171,100, FLI 0.23% to $171,100 (all employee).
  - PA UI 0.07% employee, no cap.
  - RI TDI 1.1% employee, to $100,000.
- **Local taxes**: individual localities are not modelled; `local_tax_rate` is the only mechanism.
  - The catalog flags `uses_local_rate` for IN, MD, MI, OH and PA; the state notes also mention the KY/AL occupational taxes.
  - The four dedicated engines ignore `local_tax_rate`, `state_allowances`, `state_extra_withholding` and `state_rate_override`, so NYC or Yonkers tax cannot be withheld.
- **Reciprocity**: when the work state lists the residence state in its agreement map, income tax is withheld for the **residence** state. SUTA and disability/leave items still follow the work state, and the stub's income-tax line is swapped. The map is keyed by work state and described as "representative, not exhaustive":
  - IN → {KY, MI, OH, PA, WI}; KY → {IL, IN, MI, OH, VA, WV, WI}; MI → {IL, IN, KY, MN, OH, WI}; OH → {IN, KY, MI, PA, WV}.
  - PA → {IN, MD, NJ, OH, VA, WV}; NJ → {PA}; IL → {IA, KY, MI, WI}; IA → {IL}; WI → {IL, IN, KY, MI}.
  - MN → {MI, ND}; ND → {MN, MT}; MT → {ND}.
  - MD → {DC, PA, VA, WV}; VA → {DC, KY, MD, PA, WV}; WV → {KY, MD, OH, PA, VA}; DC → {MD, VA}.
  - Without an agreement only the work state's tax is withheld. There is no resident-state withholding or credit.
- **Tax year & sources**:
  - Table states are labelled year "2026", each with its own publication/source string. The module header says the figures were verified on 2026-09-03.
  - The dedicated engines are labelled "2026-approximate".
  - There is no effective dating: one year of figures (Utah's 4.45% mid-2026 rate is applied flat).
- **Catalog**: `GET /api/payroll/states` returns, for every jurisdiction:
  - code, name, method, and a summary such as "Flat 4.95%" or "Progressive 2.00%–6.99% (7 brackets)";
  - brackets, standard deductions, exemptions, and employee/employer items;
  - SUTA base, the `uses_local_rate` and `uses_rate_election` flags, year, source and notes.
  - The Employees form uses it for a datalist and per-state hints.

_Key files: `app/services/state_tax/__init__.py`, `app/services/state_tax/table_engine.py`, `app/services/state_tax/tables.py`, `app/services/state_tax/wa.py`, `app/services/state_tax/ca.py`, `app/services/state_tax/ny.py`, `app/services/state_tax/oregon.py`, `app/services/state_tax/generic.py`, `app/services/state_tax/reciprocity.py`, `app/routes/payroll/states.py`_

### WA L&I workers' compensation rates
- **Assessed per hour worked**: employee deduction = hours × employee rate; employer cost = hours × (total − employee). The hours are the stub's total hours (regular + OT + DT).
- **Seed class codes** (representative 2026 composite rates, dollars per hour):

  | Class | Description | Total | Employee |
  |---|---|---|---|
  | 5206 | Clerical/office | 0.0600 | 0.0250 |
  | 6303 | Outside sales/messengers | 0.1400 | 0.0600 |
  | 0101 | Excavation/earthwork | 0.9800 | 0.3600 |
  | 0510 | Wood-frame construction | 1.1200 | 0.4000 |
  | 0540 | Roof work | 1.4500 | 0.5200 |
  | 3909 | Warehouse/stores | 0.2600 | 0.1000 |
  | 7100 | Restaurant/food service | 0.1100 | 0.0450 |

  - Any other or missing class uses the default: total 0.2000, employee 0.0800.
  - The rates are code constants, meant to be replaced with the employer's own rate notice. There is no UI to edit them.
- **Salaried and gross-override stubs record 0 hours**, so they carry no L&I.

_Key files: `app/seed/wa_lni_rates.py`, `app/services/state_tax/wa.py`_

### Overtime classifier
- **`POST /api/time-entries/classify`**: an advisory calculator. The body is `{"weeks": [[daily hours…], …], "state": "WA"}` and the response is `{regular, overtime, doubletime}`.
  - It is not applied automatically to time entries or pay runs; the OT/DT buckets are whatever the entries or stubs say.
- **FLSA default** (every state not listed below): hours over 40 in the week are overtime. There is no double time.
- **Daily-rule states: CA, AK, NV, CO**:
  - Per day: hours over 8 are overtime and hours over 12 are double time.
  - The straight-time hours remaining are then reconciled weekly: any excess over 40 converts to overtime.
- **California seventh-day rule**: the 7th entry of a 7-day week pays its first 8 hours as overtime and the rest as double time.
- **Code disclaimer**: "simplified rules" (no exempt status, alternative workweeks or regular-rate blending).

_Key files: `app/services/overtime.py`, `app/routes/time_entries.py`_

### Gross-up (net-to-gross) calculator
- **`POST /api/payroll/gross-up`**: body `{employee_id, target_net, supplemental=true}`. It returns `{employee_id, target_net, gross, net, withholding}`, where withholding = gross − net.
  - 404 for an unknown employee; 400 "target_net must be positive".
- **Solver**:
  - Bisection starting from a lower bound equal to the target.
  - The upper bound doubles until its net reaches the target.
  - Tolerance is $0.01, with at most 80 iterations each for the doubling and the bisection.
- **Inputs used**: the employee's W-4 and state setup, the current calendar year's YTD, their work state (else WA) with reciprocity, and flat supplemental withholding when `supplemental` is true.
- **Not included**: benefit codes, garnishments, reimbursements and hours (so no WA L&I). The aggregate supplemental method is not offered. There is no UI.

_Key files: `app/services/gross_up.py`, `app/routes/payroll/runs.py`, `app/schemas/deductions.py`_

### Garnishments (CCPA)
- **Order fields**:
  - `garnishment_type`: `child_support`, `federal_levy`, `state_tax_levy`, `student_loan`, `bankruptcy` or `creditor` (the default).
  - `calc_method`: `fixed` (dollars per period) or `percent_disposable` (0–100 of disposable earnings).
  - `amount`, `priority` (integer, default 0; the UI defaults to 1) and `case_number` (80 characters).
  - Child-support modifiers: `supports_secondary_family` and `in_arrears_12_weeks`.
  - `is_active`.
- **Disposable earnings** = gross − all employee taxes: federal, state, the state "other" items including local tax, SS and Medicare. Voluntary pre-tax deductions are not subtracted.
- **Processing order**:
  - By type rank: child support (0), then federal levy and bankruptcy (1), state tax levy (2), student loan (3), creditor (4), and unknown types (99).
  - Within a rank, by the order's `priority` (lower first), then by order id.
- **CCPA caps** (with weeks per period = max(1, round(52 ÷ periods)): weekly 1, biweekly 2, semi-monthly 2, monthly 4):
  - **Child support**: one shared cap of 60% of disposable, 50% if the employee supports a second family, plus 5% when 12+ weeks in arrears. The cap is the largest across the orders. Orders are pro-rated when their total request exceeds it.
  - **Federal and state tax levies, bankruptcy**: capped only by the disposable earnings still left. There are no Pub 1494 exempt-amount tables.
  - **Student loan (AWG)**: 15% of disposable per order, and within the 25% aggregate non-support cap.
  - **Ordinary creditor**: the lesser of 25% of disposable or disposable − 30 × $7.25 × weeks in period, and within the 25% aggregate non-support cap.
  - Backstop: no order ever takes more than the disposable earnings remaining.
- **Accounting**: garnishment amounts reduce net pay and are credited to 2370 Other Payroll Deductions Payable. They appear on the stub as "Garnishment {Type}".
  - There is no payee or remittance vendor for garnishments.
  - The cap notes ("CCPA 25% creditor cap reached"…) are not persisted.
- **End conditions**: manual only. `POST …/garnishments/{id}/end` sets `is_active=false` (400 if already ended) and keeps the record.
  - `DELETE` always returns 405 pointing at `/end`.
  - There is no total-owed balance, end date or automatic stop.
- **UI (`#/hr/deductions`, "Garnishments")**:
  - Pick an employee to see a table of priority, case #, type, method, amount (dollars or %), CCPA modifiers and status, with an "End order" button.
  - The "Add Garnishment" modal lists the six types, the two methods, amount, priority and the two child-support checkboxes.

_Key files: `app/services/garnishment.py`, `app/models/deductions.py`, `app/routes/deductions.py`, `app/schemas/deductions.py`, `app/static/js/deductions.js`_

### Benefits & deductions engine
- **Benefit codes** (`BenefitCode`): a benefit is a code with a rule. Payroll evaluates whatever codes are attached to the employee.
  - `code`: unique, upper-cased; a duplicate is 409.
  - `name`.
  - `kind`: `deduction` (employee pays), `benefit` (employer pays) or `both`.
  - `category`: `pretax` or `posttax`.
  - `calc_method` for the employee side: `fixed_amount`, `percent_of_gross`, `percent_of_taxable`, `amount_per_hour` or `tiered`.
  - `employer_calc_method`: any of those, or `match_percent`; null means the same as the employee side.
  - Tax flags `reduces_federal`, `reduces_state` and `reduces_fica`: three independent wage bases.
  - `employer_taxable`: recorded in the stub snapshot only. Imputed income such as GTL is not added to wages or the W-2.
  - `sequence` (default 100): the explicit pre-tax order.
  - `expense_account_id`, `liability_account_id` and `remittance_vendor_id`.
  - `burden_routing`: `fringe_pool` or `job_burden`.
  - `tracks_balance`: for loans.
  - Code-level `effective_from`/`effective_to` and `is_active`.
  - Codes are never deleted: `DELETE` retires them (`is_active=false`).
- **Dated rates** (`BenefitRate`): `employee_rate` and `employer_rate` (dollars or percent depending on method), `per_period_cap`, `annual_cap`, `wage_base_ceiling` (YTD gross), `employer_annual_cap`, `employer_match_limit_pct` and `tiers_json`.
  - A rate resolves against the **pay-period end date**: the latest `effective_from` on or before it whose `effective_to` hasn't passed.
  - Adding a rate closes the previous open-ended row on the day before the new one starts.
  - 409 when a rate already starts on that date; 400 when `effective_from` is missing.
  - The last remaining rate can't be deleted (400). Deleting a row reopens the latest remaining one.
- **Employee groups** (templates): a group is a set of codes with optional employee/employer rate and cap overrides. Group names are unique (409).
  - Setting a group's codes or members replaces the existing set.
  - Deleting a group unassigns its members.
- **Enrollments** (`EmployeeBenefit`): per-employee overrides of rates and caps, `balance_remaining`, `start_date`/`end_date`, `is_active` and notes.
  - A second active enrollment of the same code is 409.
  - A `tracks_balance` code requires a starting balance (400).
  - `DELETE` with `end_date` ends the enrollment and keeps it on file; without one it hard-deletes.
- **Resolution**: an active enrollment covering the period wins for its code. The employee's group fills in every other code.
  - A blank field on an enrollment falls back to the group's override, then to the dated rate.
  - Codes that are not in force, or have no rate on the period end date, are skipped.
  - Resolved codes are ordered by (sequence, code).
- **Calculation** (in sequence):
  - `percent_of_taxable` uses the running federal base after the earlier pre-tax codes.
  - `amount_per_hour` multiplies the stub's total hours.
  - `tiered` applies marginal bands `{up_to, rate%}` over eligible wages.
  - `wage_base_ceiling` limits eligible wages to ceiling − YTD gross.
  - Employee-side cap order: per-period cap → annual cap (vs YTD) → loan balance → the pay still remaining → room left after taxes and garnishments (post-tax, second pass).
  - Employer side:
    - `match_percent` flat form: employer_rate % of the employee's contribution, on at most `employer_match_limit_pct` % of gross.
    - `match_percent` tiered form: `[{"up_to_pct":3,"match_pct":100},{"up_to_pct":5,"match_pct":50}]` (the tiers win when present).
    - Otherwise the employer rate uses the same method, capped by `employer_annual_cap`.
  - Pre-tax codes can consume the entire gross; there are no IRS contribution limits built in (402(g), HSA, etc.). Limits come only from the caps entered.
- **Snapshots & YTD**: each stub stores a `PayStubBenefit` row per code with the resolved rule (rates, flags, accounts, vendor, routing, caps, tiers, rate effective date, taxable base before) and the amounts.
  - `BenefitYTD` accumulators and loan balances are updated when the **draft** is created.
  - `POST /api/benefits/ytd/rebuild?year=` recomputes a year from the snapshots of non-void runs.
- **GL**: on processing, each code's liability account is credited with the employee withholding plus the employer share. Each code's expense account is debited with the employer share. Unmapped amounts go to 2370 and 6150.
- **Remittance**: `GET /api/benefits/remittance?start_date&end_date` totals processed runs by vendor and code (withheld, employer, stub count). A snapshot with no vendor falls back to the code's current vendor.
  - `POST /api/benefits/remittance/bill` creates a vendor bill.
  - The bill has one line per code, debiting the code's liability account (fallback 2380, then 2370).
  - Bill number `REMIT-YYYYMMDD-YYYYMMDD`, terms Net 15, dated the bill date or else the period end.
  - 400 when there is nothing to bill.
- **Standard codes seed** (`POST /api/benefits/codes/seed-standard`, idempotent):

  | Code | Name | Kind / category | Reduces | Seq | Notes |
  |---|---|---|---|---|---|
  | SEC125 | Section 125 Health Premium | both / pretax, fixed | fed, state, FICA | 10 | |
  | SEC125DV | Dental / Vision Premium | both / pretax, fixed | fed, state, FICA | 20 | |
  | HSA | HSA Contribution | both / pretax, fixed | fed, state, FICA | 30 | |
  | 401K | 401(k) Traditional | both / pretax, % of gross | fed, state | 40 | Employer `match_percent`, 100%, limit 3%, tiers 100% of first 3% + 50% of next 2% |
  | ROTH401K | Roth 401(k) | deduction / posttax, % of gross | none | 50 | |
  | UNION | Union Dues | deduction / posttax, fixed | none | 60 | |
  | LOAN | Employee Loan Repayment | deduction / posttax, fixed | none | 70 | Tracks balance |
  | HEALTH_ER | Employer Health Contribution | benefit / pretax, fixed | none | 80 | |
  | GTL | Group Term Life (employer) | benefit / pretax, fixed | none | 90 | `employer_taxable` |

  - Each seeded code gets a rate dated 2000-01-01 with an employee rate of 0, so nothing is deducted until rates or overrides are set.
  - `POST /api/benefits/setup-accounts` creates any missing 2380 Employee Benefits Payable, 2390 Accrued PTO Liability, 6150 Employee Benefits Expense and 6160 Paid Time Off Expense.
- **UI (`#/hr/benefits`)**, four tabs:
  - **Benefit Codes**: add or edit (the first rate is effective today), dated Rates, Retire, "Seed standard codes", "Create default accounts".
  - **Employee Groups**: codes with EE/ER overrides, and members.
  - **Enrollments**: per employee, plus "What the next pay run applies (in sequence)".
  - **Remittance & YTD**: vendor sections with "Create bill", YTD accumulators, "Rebuild from stubs".

_Key files: `app/models/benefits.py`, `app/services/benefits_engine.py`, `app/routes/benefits.py`, `app/schemas/benefits.py`, `app/static/js/benefits.js`_

### Paid time off
- **Policies**:
  - `name` and `pto_type`: `vacation`, `sick` or `personal`.
  - `accrual_method` and `accrual_rate`:
    - `per_hour_worked`: rate per hour worked. WA sick leave is 1/40 = 0.025.
    - `per_pay_period`: fixed hours per run.
    - `annual_grant`: a lump grant.
  - `max_carryover`, `max_balance`.
  - Dollar-liability settings: `accrue_liability`, `valuation` (`current_rate` or `average_rate`; anything else is 400) and optional expense/liability accounts.
  - `pays_out_on_termination`: stored only.
  - `is_active`: exists on the model but can't be set through the API.
  - There is no delete for policies or banks.
- **Banks** (`PTOAccrual`): one per employee per policy; a second is 400 "Employee already enrolled in this policy".
  - Fields: `balance` (hours), `accrued_ytd`, `used_ytd` and `dollar_balance`.
  - The starting balance is entered in hours and valued at $0 until the bank is revalued.
- **Running an accrual** (`POST …/accruals/{id}/accrue`, body `{hours_worked, as_of}`):
  - Earned hours: `per_hour_worked` = hours worked × rate; the other two methods add the rate.
  - The new balance is capped at `max_balance` when one is set; `accrued_ytd` grows by the full amount earned.
  - The added hours are valued at the employee's hourly rate (salary ÷ 2080), which updates `dollar_balance`.
  - When the policy books a liability: DR PTO expense (policy account, else 6160, else 6110) / CR accrued PTO (policy account, else 2390, else 2300), dated `as_of` or today, `source_type="pto"`.
  - 400 when no accounts resolve.
  - Accruals are **manual**: nothing runs them from pay runs or time entries.
- **Revalue** (`POST …/revalue`): restates `dollar_balance` at hours × the current rate and posts the difference. An increase is DR expense / CR liability; a decrease is the reverse.
- **Requests**: fields `employee_id`, start/end dates (end before start is 400), `hours`, `pto_type` and notes. Status is `pending`, `approved` or `denied`.
  - Deciding a request that is already decided is 400.
  - Approval draws down the **first** bank whose policy matches the request's PTO type:
    - `used_ytd` grows by the full hours requested, and the balance floors at 0 (there is no sufficiency check).
    - Dollars are relieved for min(hours, balance) at the unit value: the current rate, or the bank's dollars ÷ hours under `average_rate`. Relief is capped at the dollars in the bank.
    - The relief entry is DR liability / CR PTO expense, dated the request's start date.
  - Denial changes nothing.
  - An approved request can't be cancelled.
  - PTO hours are not paid automatically; the operator enters them as pay-run hours.
  - `approver_id` is optional and unchecked.
- **Year-end carryover** (`POST /api/pto/accruals/year-end-carryover?target_year=YYYY`): applied to **every** bank.
  - Caps the balance at `max_carryover` (null = unlimited).
  - Forfeited hours have their dollars relieved on Dec 31 of the target year.
  - Resets `accrued_ytd` and `used_ytd`.
  - Returns a before/after summary per bank. `target_year` does not filter anything, and running it twice is not guarded.
- **PTO liability reporting**: there is no standalone report. The dollar liability shows in the SPA's "Liability ($)" column per bank and in GL account 2390.
- **UI (`#/hr/pto`)**, three sections:
  - Policies: add or edit, with a Dollar liability block.
  - Employee Accruals: Enroll; Run Accrual (prompts for hours worked); Revalue.
  - Requests: New request; Approve and Reject on pending requests.
  - There is no carryover button; it is API only.

_Key files: `app/models/pto.py`, `app/routes/pto.py`, `app/services/pto_accrual.py`, `app/services/pto_liability.py`, `app/schemas/pto.py`, `app/static/js/pto.js`_

### Time entries
- **Entry fields**:
  - `employee_id` and `date`.
  - `hours_regular`, `hours_overtime` and `hours_doubletime`: hours only, with no clock times stored.
  - `job_id` and `cost_code_id`: the live job-costing links. `project_id` (an item FK) is a dead legacy column.
  - `notes`.
  - `status`, `approved_by` and `approved_at`.
  - `pay_run_id`: set when a pay run consumes the entry.
  - `job_cost_id`: set when the entry is posted to its job.
  - There is no billable flag and no billing of time to invoices.
- **Clock-in/out math** (client side only):
  - The Log Time form takes optional Clock In, Clock Out and Break (minutes).
  - Worked time = out − in, plus 24 hours when out ≤ in (an overnight shift), minus the break, floored at 0.
  - The result fills Regular Hours to two decimals. The times themselves are not sent, and OT/DT are not derived.
- **Workflow**: statuses are `draft` (on creation), `submitted`, `approved` and `rejected`.
  - `/submit`, `/approve` (body `{approved_by}`, default "manager"; stamps `approved_at`) and `/reject` do not check the current status.
  - `PUT` can set any status directly.
  - Edit and delete return 400 once `pay_run_id` is set ("locked to a pay run").
  - Rejecting an entry already posted to a job voids that Job Cost Entry first; the closing-date check applies to the reversal's date.
  - The API doesn't validate that hours are non-negative. The form uses `min=0`.
- **Pay-run feed**: only **approved** entries with no `pay_run_id`, dated inside the period, are paid.
  - `GET /api/time-entries/summary?period_start&period_end` previews approved regular/OT/DT per employee (with `entry_count`), plus `pending_count`/`pending_hours` for draft and submitted entries.
  - 400 when the end date is before the start.
- **Job costing**: `POST /api/time-entries/{id}/post-to-job` and bulk `POST /api/time-entries/post-to-job {ids}` post labor cost at the employee's cost rate, plus a burden line.
  - Only submitted or approved entries that have a job and are not yet posted can be posted.
  - The bulk call returns a result per entry and never rolls back the others.
- **UI (`#/hr/time-entries`)**:
  - List with an employee filter: date, employee, job with cost-code label and a "posted" badge, hours, description, status with a "paid" badge.
  - Approve/Reject buttons on draft or submitted entries that are unpaid.
  - The "Log Time" modal has job and cost-code pickers.
  - There are no Submit or Post-to-job buttons.
  - UI approval records `approved_by` as "manager".

_Key files: `app/models/time_entries.py`, `app/routes/time_entries.py`, `app/schemas/time_entries.py`, `app/static/js/time_entries.js`, `app/services/job_costing.py`_

### Onboarding, e-signature & new-hire report
- **Default checklist**: 8 tasks seeded for every new hire.
  1. `w4`: Form W-4.
  2. `i9_section1`: I-9 Section 1 (Employee).
  3. `i9_section2`: I-9 Section 2 (Employer).
  4. `everify`: E-Verify.
  5. `direct_deposit`: Direct Deposit Auth.
  6. `state_new_hire_report`: State New-Hire Report, due within 20 days.
  7. `policy_acknowledgment`: Policy Acknowledgment.
  8. `emergency_contact`: Emergency Contact.
- **Seeding**:
  - Automatic on `POST /api/employees`, and on the first `GET /api/onboarding/{emp_id}`.
  - `POST …/seed` is idempotent: it adds only missing task types and does not reset anything.
  - `POST /api/onboarding/tasks` adds another task of one of the 8 types (400 for anything else). Duplicates are allowed.
- **Task fields**:
  - `status`: `pending`, `in_progress` or `complete`. Setting `complete` stamps `completed_at`; any other status clears it.
  - `completed_by`, `notes` and `document_id` (FK to an attachment; not validated against the employee).
  - `POST /tasks/{id}/complete?completed_by=admin` marks the task done.
- **E-signature**: a lightweight acknowledgment, not a cryptographic signature. `signed` is a boolean and `signed_at` a timestamp; there is no signer identity, IP or document hash.
  - The UI offers a "Signed" checkbox only for `w4`, `i9_section1`, `direct_deposit` and `policy_acknowledgment`. The API allows it on any task.
- **No automation**: completing a task does not check the underlying data (bank account, E-Verify status, etc.).
- **Progress**: complete ÷ total × 100, rounded to one decimal.
- **State new-hire report**:
  - `GET /api/onboarding/{id}/new-hire-report` returns JSON:
    - employee name, SSN last 4, address, and work state (else mailing state);
    - hire date, with a deadline of hire date + 20 days and an `overdue` flag when today is past the deadline;
    - employer name, EIN, address and state from Settings.
  - `/pdf` renders a branded "NEW HIRE REPORT" PDF with the company logo, the employee table and an OVERDUE banner or "within the reporting window" note. It is named `New-Hire-Report_{Name}.pdf`.
  - 404 for an unknown employee.
  - There is no filing with the state. It shows only the last 4 of the SSN, no date of birth, and has no audit hash.
- **UI (`#/hr/onboarding`)**: a table of every employee with complete/total/%. "View Checklist" opens a modal with a status badge, Signed checkbox and Complete button per task, plus a "New-Hire Report PDF" button.

_Key files: `app/models/hr.py`, `app/services/onboarding.py`, `app/routes/onboarding.py`, `app/services/new_hire_report.py`, `app/templates/new_hire_report.html`, `app/static/js/onboarding.js`_

### Employee self-service portal
- **Token**: `secrets.token_urlsafe(24)`, which is 32 URL-safe characters (192 bits), minted at hire. It is **never stored as issued**:
  - `portal_token_hash` holds the SHA-256 hex digest (unique, indexed), which is how links are looked up.
  - `portal_token_enc` holds a Fernet copy under the payroll key, so an administrator can re-display it.
  - The legacy `portal_token` column was emptied by migration `e2b7c4d9a1f3` (2.18.0).
  - If the encrypted copy can't be decrypted (the key changed), the admin endpoint returns `portal_token: null` with a note. The link still works, and the copy is re-saved the next time the employee uses it.
- **Lifetime**:
  - Hard expiry: 1 year from mint or rotation.
  - Idle expiry: 90 days since last use, a sliding window. Every authenticated request rolls `last_used` forward.
  - Expired tokens return 410 "Portal token has expired".
  - An unknown token, a token over 128 characters, or an inactive employee returns 404 "Portal not found".
  - Rotation (`POST /api/employees/{id}/portal-token`) replaces the digest and kills the old link.
- **Admin side** (Employee Details → Portal Access):
  - Absolute URL `{base_url}/portal/{token}`; X-Forwarded-* headers are honoured behind a trusted proxy.
  - Expiry date, shown in red when fewer than 30 days remain, and last-used date.
  - Copy Link, Rotate Token, and "Email to Employee…", which opens a `mailto:` with no recipient filled in.
  - A "Recent access" table of the last 10 hits.
  - `GET …/portal-token` mints a token if none exists.
- **Session**:
  - `GET /portal/{token}[/paystubs|/profile|/bank|/pto]` validates the token, sets the `slowbooks_portal` cookie and 303-redirects to the cookieless URL, so the token leaves the address bar.
  - Cookie: HttpOnly, SameSite=Strict, Secure when FORCE_HTTPS is on, path `/portal`, max-age 30 days.
  - The real pages read the cookie. With no cookie they return 401 "Portal session required — open the link from your email again".
  - "Log out" deletes the cookie only; the link stays valid.
  - There are no CSRF tokens; the SameSite=Strict cookie is the protection.
- **Hardening**:
  - Every response carries `Referrer-Policy: no-referrer` and `Cache-Control: no-store, max-age=0`.
  - Rate limits (slowapi, per client IP): 30/minute for GET pages, 10/minute for POSTs. Controlled by `RATE_LIMIT_ENABLED`.
  - Branding: the company name and logo come from Settings. `/portal/logo` and `/portal/favicon.ico` serve the company logo, or a 204 when there is none.
- **Audit log**: every portal hit, success or failure, writes a `portal_accesses` row with employee id (null on failure), IP (X-Forwarded-For only when `TRUST_PROXY_HEADERS` is set; 45 characters), user agent (255), path (200) and success flag.
  - A long third path segment is redacted to `REDACTED`, so tokens never land in the log.
  - `GET /api/employees/{id}/portal-access?limit=1–200` lists the rows.
- **Pages**:
  - **Dashboard** (`/portal/`): welcome, name, email, pay type, pay frequency, hire date, "Pay Stubs Available" count, and quick links.
  - **Pay Stubs** (`/portal/paystubs`): processed stubs only, newest first, showing pay date, period, gross, net and a "Download PDF" link. The link points at the admin API (see Notes).
  - **Profile** (`/portal/profile`): edit the federal W-4 (filing status, Step 2c checkbox, Step 3 dependents, Step 4a/4b/4c) and the mailing address.
    - Only an invalid filing status is refused (400). Numbers and the state are not validated.
    - State W-4 fields and work/residence state are not editable here.
  - **Bank** (`/portal/bank`): lists every account with nickname, type, ••••last-4, deposit type and Active/Inactive.
    - The add form takes nickname, checking/savings, deposit type (full/percent/fixed/remainder), routing (ABA-checked) and account number (digits).
    - Validation errors redirect to `?error=`.
    - There is no amount, percent or priority input, and no way to remove or deactivate an account.
  - **Time Off** (`/portal/pto`): balances per policy (hours balance, accrued YTD, used YTD; no dollars), the employee's requests with status pills, and a request form with start, end, hours (step 0.25) and type.
    - The portal does not check that the end date is on or after the start.
- **Legacy token-in-URL POSTs** (`/portal/{token}/profile|bank|pto`): process inline, audit, set the cookie and 303 to the GET page.
- **Not in the portal**: time-entry submission, W-2 download, pay stub PDFs that open for the employee, or editing state W-4 fields.

_Key files: `app/routes/portal.py`, `app/models/payroll.py`, `app/models/portal_access.py`, `app/templates/portal/base.html`, `app/templates/portal/dashboard.html`, `app/templates/portal/paystubs.html`, `app/templates/portal/profile.html`, `app/templates/portal/bank.html`, `app/templates/portal/pto.html`, `app/routes/employees.py`, `migrations/versions/e2b7c4d9a1f3_portal_links_kept_as_digests.py`_

### NACHA ACH direct-deposit export
- **Endpoint**: `POST /api/payroll/{run_id}/nacha`.
  - Body `NachaOriginating` (strict):
    - Required: `immediate_destination` (the receiving bank's routing number), `immediate_origin` and `originating_dfi_id` (8-digit ODFI).
    - Optional: `destination_name` ("BANK"), `origin_name`, `company_name`, `company_id` and `company_account`.
    - `effective_date`: defaults to the pay date.
  - Blank `company_name` and `company_id` default to the **env** config `COMPANY_NAME` ("My Company") and `EMPLOYER_EIN`, not to Settings.
  - Returns `text/plain` as `payroll_{run_id}.ach`.
  - Errors: 404 unknown run; 400 "Pay run must be processed before ACH export"; 400 on allocation errors.
  - There is no UI.
- **Format**: 94-character fixed-width records, blocking factor 10, padded with all-9 records to a multiple of 10, newline-separated.
  - **1 File Header**: priority 01, a space plus the 9-digit destination, a space plus the 9-digit origin (non-digits stripped), today's date YYMMDD, time "0000", file ID modifier "A", record size 094, blocking factor 10, format code 1, and the destination and origin names (23 characters each).
  - **5 Batch Header**: service class **200 (mixed)**, company name (16), company ID (10), SEC code **PPD**, entry description "PAYROLL", effective date YYMMDD, originator status 1, ODFI, batch 0000001.
  - **6 Entry Detail**: transaction code **22** (checking credit) or **32** (savings credit); RDFI (8 digits plus check digit); account number left-justified in 17 characters (longer numbers are truncated); amount in cents (10); individual ID = employee id; name (22 characters); addenda 0; trace = ODFI + a 7-digit sequence.
  - **Offset**: one code **27** checking debit for the total of all credits, to `company_account` at the `immediate_destination` routing number. The file is **always balanced**; there is no unbalanced option.
  - **8 Batch Control and 9 File Control**: entry count, entry hash (sum of the 8-digit RDFI prefixes, including the offset, mod 10¹⁰), total debits = total credits, block count.
- **Split deposits**:
  - Active accounts are ordered by priority, with `remainder` accounts last.
  - `full` takes whatever remains; `fixed` takes its dollar amount; `percent` takes that percent of net. Each is capped at what remains.
  - The `remainder` account takes the rest.
  - If money is left with no remainder or full account, the export fails loudly: "Direct-deposit allocations leave $X of net pay unallocated…".
- **Skipped**: employees with no active account (paid by other means) and accounts whose prenote status is `pending`.
  - `generate_prenote_file()` builds $0 prenote files (codes 23/33, batch "PRENOTE"), but no endpoint exposes it and no endpoint changes `prenote_status`.

_Key files: `app/services/nacha_export.py`, `app/routes/payroll/exports.py`, `app/models/bank_accounts.py`_

### Pay stub PDF & year-to-date totals
- **Pay stub PDF** (`GET /api/payroll/{run_id}/paystub/{stub_id}`): a "PAY STATEMENT" rendered by WeasyPrint as tagged PDF/UA-1 (falling back to a plain PDF). Opened inline and named `Pay-Stub_{pay date}_{Employee-Name}.pdf`.
  - Header: employer from Settings (name, address, phone, EIN), pay period and pay date.
  - Employee block: name, SSN XXX-XX-last4 and address.
  - Hours table: Regular, Overtime, Double Time and total.
  - Earnings: Gross Wages, current and YTD.
  - Deductions table: current and YTD for each line.
  - "Additions to Net (non-taxable)" for reimbursements, the Net Wages box, and Net YTD.
  - It prints for draft runs too; there is no status check.
- **Deduction lines**, read from `detail_json`:
  - Federal, SS, Medicare, the state engine's own labelled lines ("OR Income Tax", "WA PFML (employee)", "{ST} local income tax"…), each benefit code, "Other Pretax/Posttax Deductions" and "Garnishment {Type}".
  - Employer-side lines are excluded: any key containing "employer", plus `futa`, `suta` and similar.
  - Duplicates of the generic state total, and pre/post-tax totals when codes are itemized, are suppressed.
  - When the JSON is missing, the stub columns are used instead.
- **YTD on the stub**: processed stubs this year dated on or before this pay date, plus this stub. Each line's YTD is that line summed across those stubs.
- **What the stub omits**: pay rates, the regular/OT/DT split in dollars, PTO balances and employer contributions. The code header claims California Labor Code 226 coverage, but rates are not printed.
- **Employee YTD endpoint** (`GET /api/employees/{id}/ytd?year=`): gross, federal, state, state_other, ss, medicare, pretax_deductions and net.
  - It sums every non-void stub, so **drafts count**. The tax engine's YTD uses the same helper.
  - The Details modal shows gross, federal, state, SS, Medicare and net.

_Key files: `app/services/paystub_pdf.py`, `app/templates/paystub_pdf.html`, `app/routes/payroll/exports.py`, `app/routes/payroll/ytd.py`, `app/services/payroll_documents.py`, `app/services/pdf_service.py`_

### Payroll tax forms & liability reports
- **Data source**: all forms aggregate **processed** stubs by `PayRun.pay_date` within the calendar year or quarter. Employer identity comes from `employer_block`: Settings `company_name`, address, `company_tax_id`, with env fallbacks.
- **Form 941 line logic** (quarterly):
  - Stubs from Jan 1 to the quarter end are walked in pay order, so the wage base and the $200k threshold use earlier quarters.
  - Line 1: distinct employees with gross > 0 in the quarter.
  - Line 2: gross wages.
  - Line 3: federal income tax withheld.
  - 5a: taxable SS wages = FICA wages (gross − `reduces_fica` pre-tax snapshots), capped by the $184,500 base against YTD gross; column 2 = × 12.4%.
  - 5c: Medicare wages = FICA wages; column 2 = × 2.9%.
  - 5d: Additional Medicare wages above $200,000 YTD; column 2 = × 0.9%. Printed only when non-zero.
  - 5e = 5a + 5c + 5d. Line 6 = line 3 + 5e.
  - Line 7: fractions of cents = the per-paycheck SS and Medicare withheld and matched − 5e.
  - Lines 10 and 12 = line 6 + line 7.
  - The JSON also returns `num_stubs` and the employee/employer splits.
  - Not produced: 5b tips, lines 8, 9 and 11 (credits), deposits and balance due (13–15), the line 16 liability schedule and Schedule B.
- **Form 940** (annual):
  - "Line 3": total payments.
  - Exempt payments above the $7,000 per-employee FUTA base, printed as "line 4".
  - Line 7: FUTA taxable wages, capped per employee in pay order.
  - Line 8: the sum of the FUTA tax actually computed on the stubs.
  - Number of employees paid.
  - Not produced: line 1a state, credit-reduction and adjustment lines 9–11, deposits and balance (13–15), the Part 5 quarterly liability.
- **W-2** (per employee, annual; only employees with a non-zero amount appear in lists):
  - Box 1 = gross − all pre-tax deductions on the stubs.
  - Box 2 = federal withheld.
  - Box 3 = min(YTD gross, $184,500).
  - Box 4 = SS withheld.
  - Box 5 = gross.
  - Box 6 = Medicare withheld.
  - Box 15 = the employee's current work state.
  - Box 16 = Box 1.
  - Box 17 = state income tax.
  - SSN masked to the last 4.
  - Not produced: boxes 7–14 (no box 12 codes such as D, W, DD or C; no box 14) and 18–20 (local).
- **W-3**: the number of W-2s transmitted, and totals of boxes 1–6, 16 and 17 ("aggregate"), with a note to file with the SSA.
- **Two API families for the same data**:
  - `/api/payroll/forms/...`: JSON wrappers by POST with legacy `box_N` keys (plus `payment_status: "Not yet filed"`), and PDFs by GET or POST. The PDFs **write a document-audit row and print its footer**. These are what the Tax Forms page uses.
  - `/api/tax-forms/...`: raw JSON by GET (`/w2` returns the W-3 and every W-2) and PDFs **without** audit footers.
  - Quarters outside 1–4 are 400. The payroll W-2 routes return 404 for an unknown employee.
- **State SUI report** (JSON only, `GET /api/tax-forms/sui?year&quarter&state`):
  - Per employee: name, SSN last 4, work state, total wages, SUTA-taxable wages and SUTA tax, plus totals and counts.
  - SUTA-taxable wages = the gross of stubs that produced SUTA tax, a heuristic.
  - The `state` filter matches the employee's **current** `work_state` exactly, not the per-stub state.
  - There is no PDF, per-state form or UI.
- **Quarterly liability schedule** (JSON only, `GET /api/tax-forms/liability?year&quarter`), five lines:
  - 941 (IRS): federal withholding + SS employee and employer + Medicare employee and employer.
  - 940 FUTA (IRS).
  - State SUI (SUTA).
  - State WH (state income tax).
  - State Other (state employee and employer items: PFML, SDI, L&I, local).
  - Every line is due the last day of the month after the quarter end, plus `total_due`. Depositor schedules (monthly or semiweekly) are not modelled, and there is no UI.
- **UI (`#/hr/tax-forms`)**:
  - W-2 (year and employee), W-3, 940 (year) and 941 (year and quarter), each opened with `window.open` on the GET PDF URL.
  - Year inputs range 2000–2099.
  - A 1099-NEC/1096 card is also on this page.
- **PDF file names**: `W-2_{year}_{Name}.pdf`, `W-3_{year}.pdf`, `940_{year}.pdf` and `941_{year}_Q{n}.pdf`, served inline with UTF-8 file names.

_Key files: `app/services/tax_forms/form_941.py`, `app/services/tax_forms/form_940.py`, `app/services/tax_forms/w2_w3.py`, `app/services/tax_forms/state_sui.py`, `app/services/tax_forms/tax_liability.py`, `app/routes/payroll/tax_forms.py`, `app/routes/tax_forms.py`, `app/templates/w2.html`, `app/templates/w3.html`, `app/templates/form_940.html`, `app/templates/form_941.html`, `app/static/js/tax_forms.js`_

### Tamper-evident document-audit hashes
- **Hash**: SHA-256 over a canonical JSON serialization of `{"company": employer_block, "data": compute_*()}`.
  - Keys are sorted, separators compact, Decimals serialized as strings and dates as ISO strings.
  - The hash covers content only, so re-rendering identical data gives the same hash.
- **Audit rows**: each render inserts a new `document_audits` row. Fields: `doc_type` (`w2`, `w3`, `940`, `941`), `doc_key` (`emp{id}-yr{year}`, `yr{year}` or `yr{year}-q{n}`), `content_hash` (64 hex characters) and `created_at` (UTC).
- **PDF footer**: "Generated {YYYY-MM-DD HH:MM:SS UTC} · Audit ID #{id} · Hash {first 16 hex}".
- **Verification**: done through the document-audit router, which has no UI.
  - List rows filtered by `doc_type` or `doc_key`.
  - Look up one row by id.
  - Find rows by a full 64-character hash.
  - No endpoint recomputes a hash.
  - Rows are independent: there is no chaining to a previous hash.
- **Coverage**: only the four `/api/payroll/forms/*/pdf` renderers use it. The `/api/tax-forms/*/pdf` routes, pay stubs and the New-Hire Report carry no audit footer.

_Key files: `app/services/document_audit.py`, `app/models/document_audit.py`, `app/routes/payroll/tax_forms.py`, `app/routes/document_audit.py`_

### API endpoints
| Method | Path | What it does |
|---|---|---|
| GET | `/api/employees` | List employees (`active_only`), last/first name order; redacted for non-admins |
| GET | `/api/employees/{emp_id}` | One employee (redacted for non-admins); 404 if missing |
| POST | `/api/employees` | Create employee (validates SSN-4, rate, state codes); mints portal token, seeds 8 onboarding tasks; 201 |
| PUT | `/api/employees/{emp_id}` | Partial update (same validation; `is_active` settable) |
| GET | `/api/employees/{emp_id}/portal-token` | Show the portal token, URL, expiry and last use; mints one if absent; `note` if the copy is unreadable |
| POST | `/api/employees/{emp_id}/portal-token` | Rotate the portal token (old link dies; new 1-year expiry) |
| GET | `/api/employees/{emp_id}/portal-access` | Recent portal access audit rows (`limit` 1–200, default 20) |
| GET | `/api/employees/{emp_id}/everify` | E-Verify case record (status defaults to `not_submitted`) |
| PUT | `/api/employees/{emp_id}/everify` | Record or update the E-Verify case number, status and notes; auto-stamps submitted/closed dates |
| GET | `/api/employees/{emp_id}/ytd` | YTD payroll totals (`year`, default current; includes draft runs) |
| GET | `/api/employees/{emp_id}/bank-accounts` | List direct-deposit accounts (masked, by priority) |
| POST | `/api/employees/{emp_id}/bank-accounts` | Add account (ABA checksum, numeric account, Fernet-encrypted); 201 |
| DELETE | `/api/employees/{emp_id}/bank-accounts/{ba_id}` | Hard-delete a bank account |
| GET | `/api/employees/{emp_id}/documents` | List HR vault documents, newest first |
| POST | `/api/employees/{emp_id}/documents` | Upload a document (multipart `file`, `doc_category`); 201 |
| GET | `/api/employees/{emp_id}/documents/{doc_id}` | Download a document |
| DELETE | `/api/employees/{emp_id}/documents/{doc_id}` | Delete a document and its bytes |
| GET | `/api/payroll` | List pay runs with stubs and benefit snapshots (`skip`, `limit` default 200, max 500) |
| GET | `/api/payroll/states` | State withholding catalog for all 51 jurisdictions |
| GET | `/api/payroll/{run_id}` | One pay run with stubs and employee names |
| POST | `/api/payroll` | Calculate and create a draft pay run; 201 with `warnings`; 422 for empty or $0 stubs or negative net |
| POST | `/api/payroll/{run_id}/process` | Post the payroll JE, distribute burden, mark processed (400 if processed or void; 403 if closed period) |
| POST | `/api/payroll/gross-up` | Net-to-gross solver for one employee |
| GET | `/api/payroll/{run_id}/paystub/{stub_id}` | Pay stub PDF |
| POST | `/api/payroll/{run_id}/nacha` | NACHA PPD ACH file for a processed run (`payroll_{id}.ach`) |
| POST | `/api/payroll/forms/w2/{emp_id}?year=` | W-2 JSON (`box_1`…`box_17`, masked SSN) |
| POST | `/api/payroll/forms/w3/{year}` | W-3 JSON |
| POST | `/api/payroll/forms/940/{year}` | 940 JSON |
| POST | `/api/payroll/forms/941/{year}/{quarter}` | 941 JSON |
| GET, POST | `/api/payroll/forms/w2/{emp_id}/pdf?year=` | W-2 PDF with document-audit row and footer |
| GET, POST | `/api/payroll/forms/w3/{year}/pdf` | W-3 PDF with audit footer |
| GET, POST | `/api/payroll/forms/940/{year}/pdf` | Form 940 PDF with audit footer |
| GET, POST | `/api/payroll/forms/941/{year}/{quarter}/pdf` | Form 941 PDF with audit footer |
| GET | `/api/tax-forms/941?year&quarter` | 941 data (JSON) |
| GET | `/api/tax-forms/941/pdf?year&quarter` | 941 PDF (no audit footer) |
| GET | `/api/tax-forms/940?year` | 940 data (JSON) |
| GET | `/api/tax-forms/940/pdf?year` | 940 PDF (no audit footer) |
| GET | `/api/tax-forms/w2?year` | W-3 totals plus every W-2 for the year (JSON) |
| GET | `/api/tax-forms/w2/{employee_id}?year` | One W-2 (JSON) |
| GET | `/api/tax-forms/w2/{employee_id}/pdf?year` | W-2 PDF (no audit footer) |
| GET | `/api/tax-forms/sui?year&quarter&state` | Quarterly state unemployment report (JSON) |
| GET | `/api/tax-forms/liability?year&quarter` | Quarterly payroll tax liability schedule with due dates (JSON) |
| GET | `/api/deductions/garnishments` | List garnishment orders (`employee_id`), by priority |
| POST | `/api/deductions/garnishments` | Create a garnishment order; 201 |
| POST | `/api/deductions/garnishments/{order_id}/end` | End an order (inactive, record kept); 400 if already ended |
| DELETE | `/api/deductions/garnishments/{order_id}` | Always 405: use `/end` |
| GET | `/api/benefits/codes` | List benefit codes (`include_inactive`) with the rate in force today |
| POST | `/api/benefits/codes` | Create a code plus its first dated rate; 409 duplicate; 201 |
| POST | `/api/benefits/codes/seed-standard` | Seed the 9 standard codes (and accounts) if missing |
| POST | `/api/benefits/setup-accounts` | Create any missing 2380/2390/6150/6160 accounts |
| GET | `/api/benefits/codes/{code_id}` | One code with rates |
| PUT | `/api/benefits/codes/{code_id}` | Update a code (409 on duplicate code) |
| DELETE | `/api/benefits/codes/{code_id}` | Retire a code (`is_active=false`) |
| GET | `/api/benefits/codes/{code_id}/rates` | List dated rates |
| POST | `/api/benefits/codes/{code_id}/rates` | Add a dated rate (closes the prior open row; 409 same start; 400 no start); 201 |
| DELETE | `/api/benefits/codes/{code_id}/rates/{rate_id}` | Delete a rate (400 if last; reopens the prior) |
| GET | `/api/benefits/groups` | List employee groups with codes and member count |
| POST | `/api/benefits/groups` | Create a group with codes (409 duplicate name); 201 |
| PUT | `/api/benefits/groups/{group_id}` | Update a group's name, description or active flag |
| PUT | `/api/benefits/groups/{group_id}/codes` | Replace the group's codes and overrides |
| PUT | `/api/benefits/groups/{group_id}/members` | Replace the group's membership |
| DELETE | `/api/benefits/groups/{group_id}` | Delete a group (members unassigned) |
| GET | `/api/benefits/enrollments` | List enrollments (`employee_id`, `include_inactive`) |
| POST | `/api/benefits/enrollments` | Enroll an employee in a code (409 active duplicate; 400 missing loan balance); 201 |
| PUT | `/api/benefits/enrollments/{enrollment_id}` | Update enrollment overrides, dates, balance or active flag |
| DELETE | `/api/benefits/enrollments/{enrollment_id}` | End with `end_date` (kept) or hard-delete |
| GET | `/api/benefits/employee/{emp_id}/resolved` | What the next run applies, in sequence (`as_of`) with YTD |
| GET | `/api/benefits/ytd` | YTD accumulators (`employee_id`, `year`) |
| POST | `/api/benefits/ytd/rebuild?year=` | Rebuild a year's accumulators from stub snapshots |
| GET | `/api/benefits/remittance?start_date&end_date` | Withheld and employer totals by vendor and code (processed runs) |
| POST | `/api/benefits/remittance/bill` | Create a vendor bill relieving code liabilities; 201 |
| GET | `/api/pto/policies` | List PTO policies |
| GET | `/api/pto/policies/{policy_id}` | One policy |
| PUT | `/api/pto/policies/{policy_id}` | Replace a policy's settings |
| POST | `/api/pto/policies` | Create a policy; 201 |
| GET | `/api/pto/accruals` | List PTO banks (`employee_id`) |
| POST | `/api/pto/accruals` | Enroll an employee in a policy with a starting hours balance; 201 |
| POST | `/api/pto/accruals/{accrual_id}/accrue` | Run one accrual cycle (`hours_worked`, `as_of`); posts the liability JE if enabled |
| POST | `/api/pto/accruals/{accrual_id}/revalue` | Restate the bank's dollars at the current rate |
| POST | `/api/pto/accruals/year-end-carryover?target_year=` | Cap balances at carryover, forfeit dollars, reset YTD |
| GET | `/api/pto/requests` | List requests (`employee_id`, `status`) |
| POST | `/api/pto/requests` | Create a time-off request; 201 |
| POST | `/api/pto/requests/{request_id}/decision` | Approve or deny (`status`, `approver_id`); draws down the bank |
| POST | `/api/pto/requests/{request_id}/approve` | Alias for decision = approved |
| POST | `/api/pto/requests/{request_id}/reject` | Alias for decision = denied |
| POST | `/api/time-entries/post-to-job` | Bulk-post entries to their jobs as labor cost (`ids`) |
| GET | `/api/time-entries` | List entries (`employee_id`, `start`, `end`, `status`) |
| POST | `/api/time-entries` | Create an entry (draft); 201 |
| PUT | `/api/time-entries/{entry_id}` | Edit an entry (400 when locked to a pay run) |
| DELETE | `/api/time-entries/{entry_id}` | Delete an entry (400 when locked to a pay run) |
| POST | `/api/time-entries/{entry_id}/submit` | Mark an entry submitted |
| POST | `/api/time-entries/{entry_id}/approve` | Approve (`approved_by`, stamps `approved_at`) |
| POST | `/api/time-entries/{entry_id}/post-to-job` | Post one entry to its job |
| POST | `/api/time-entries/{entry_id}/reject` | Reject (voids any posted Job Cost Entry) |
| POST | `/api/time-entries/classify` | Overtime classifier over daily hours per week (FLSA or state daily rules) |
| GET | `/api/time-entries/summary?period_start&period_end` | Approved hours per employee plus pending counts for a period |
| GET | `/api/onboarding/{emp_id}` | Onboarding checklist with progress (seeds on first access) |
| POST | `/api/onboarding/{emp_id}/seed` | Add any missing default tasks |
| POST | `/api/onboarding/tasks` | Add a task of one of the 8 types; 201 |
| PUT | `/api/onboarding/tasks/{task_id}` | Update status, signed, notes, `completed_by` or `document_id` |
| POST | `/api/onboarding/tasks/{task_id}/complete` | Mark a task complete (`completed_by`, default "admin") |
| GET | `/api/onboarding/{emp_id}/new-hire-report` | State new-hire report data with the 20-day deadline and overdue flag |
| GET | `/api/onboarding/{emp_id}/new-hire-report/pdf` | New-hire report PDF |
| GET | `/portal/` | Portal dashboard (cookie) |
| GET | `/portal/paystubs` | Processed pay stubs list (cookie) |
| GET | `/portal/profile` | W-4 and address form (cookie) |
| POST | `/portal/profile` | Save W-4 and address (form post; 10/min) |
| GET | `/portal/bank` | Direct-deposit accounts and add form (cookie) |
| POST | `/portal/bank` | Add a direct-deposit account (10/min) |
| GET | `/portal/pto` | PTO balances, requests and request form (cookie) |
| POST | `/portal/pto` | Submit a PTO request (10/min) |
| POST | `/portal/logout` | Clear the portal cookie |
| GET | `/portal/favicon.ico` | Company logo as favicon (204 if none) |
| GET | `/portal/logo` | Company logo for the portal header (204 if none) |
| GET | `/portal/{token}` | Claim token → set cookie → 303 to `/portal/` |
| GET | `/portal/{token}/paystubs` | Claim → 303 to `/portal/paystubs` |
| GET | `/portal/{token}/profile` | Claim → 303 to `/portal/profile` |
| GET | `/portal/{token}/bank` | Claim → 303 to `/portal/bank` |
| GET | `/portal/{token}/pto` | Claim → 303 to `/portal/pto` |
| POST | `/portal/{token}/profile` | Legacy token-URL W-4 and address save, then cookie + 303 |
| POST | `/portal/{token}/bank` | Legacy token-URL bank add, then cookie + 303 |
| POST | `/portal/{token}/pto` | Legacy token-URL PTO request, then cookie + 303 |

### Notes, gaps & discrepancies
- **Portal pay-stub download doesn't work for employees**:
  - `portal/paystubs.html` links "Download PDF" to `/api/payroll/{run}/paystub/{stub}`.
  - That route is session-gated and admin-only, and the portal cookie is scoped to `/portal`.
  - An employee using only the portal therefore gets 401, or 403 in a non-admin session. The PDF opens only in a browser that already holds an administrator session.
  - The dashboard still promises "Download your processed pay stub PDFs".
- **No pay-run void or delete**:
  - `PayRunStatus.VOID` is never set. This is acknowledged in `docs/todo.md` and `docs/design/benefits-engine.md`.
  - Drafts are counted in the tax YTD (SS base, Medicare threshold, FUTA/SUTA bases), bump `BenefitYTD` and loan balances, and lock the time entries they swept. A mistaken draft can't be undone through the API.
  - The model comment says entries are locked "once … rolled into a processed pay run", but the lock is set when the draft is created.
- **Work-state default**: the model comment says `work_state` defaults to the mailing-address state. Pay runs and the gross-up actually default to **WA**. Only the new-hire report falls back to the mailing state.
- **PTO `max_balance = 0` is a hard cap of zero hours**:
  - The model comment says "0 / NULL = no cap", but `apply_accrual` caps whenever the value isn't null.
  - The SPA policy form sends `max_balance: 0` when left at its default, so such a policy's Run Accrual adds nothing.
  - `max_carryover = 0` likewise forfeits everything; the SPA sends null when that field is blank.
- **Admin bank-account form is broken for splits**:
  - `employees.js` offers deposit types `fixed_amount` and `percentage`. The API accepts only `fixed` and `percent`, so the add fails with 400.
  - The form has no amount or priority fields.
  - The account list reads `acct.last_four` (the API field is `account_last_four`), so every row shows "••••" with no digits.
- **Portal split deposits don't work, and adding an account doesn't replace the old one**:
  - Accounts added in the portal have a `deposit_value` and priority of 0, so "percent" and "fixed" allocate $0. With no full or remainder account, the NACHA export then fails.
  - A newly added `full` account doesn't retire the old one. With two full accounts of equal priority, one takes all the net pay.
- **SUTA wage bases disagree**: the dedicated engines use NY $13,000, OR $56,700 and WA $78,200, while the `/api/payroll/states` catalog and `docs/state-withholding.md` show $12,800, $54,300 and $72,800 (from `tables.DEDICATED`).
- **Two Social Security wage bases**: federal SS uses $184,500, but the state PFML caps in `tables.py` use `SS_BASE = $176,100`.
- **Rhode Island married brackets**: the RI note says "Brackets are the same for every filing status", but only single thresholds are given, so `_br()` doubles them for married (164,100 / 372,900).
- **Head-of-household deductions unreachable**: the CA, NY and OR engines define HOH standard deductions ($11,000, $11,200, $4,420) that are never used, because HOH falls back to the single schedule and single deduction.
- **Dedicated engines ignore state inputs**: the CA, NY, OR and WA engines ignore state allowances, extra withholding, rate override and local rate. The UI hint text suggests these inputs apply broadly.
- **SUTA and FUTA simplifications**: one env-wide `SUTA_RATE` (1.2%) applies in every state, with no per-state experience rate and no multi-state wage-base transfer. FUTA credit reduction is not modelled. Tax tables aren't effective-dated (`docs/todo.md`).
- **Audit-hash coverage is narrower than documented**:
  - README and `docs/features.md` say every W-2/W-3/940/941 PDF carries the SHA-256 audit footer. The `/api/tax-forms/{w2,940,941}/pdf` routes render without one.
  - Docs call it a "hash chain", but `document_audits` rows are not chained.
  - There is no audit-row viewer UI (`docs/todo.md`).
- **JSON form naming**:
  - The `/api/payroll/forms/*` JSON docstrings say "Returns a PDF file"; they return JSON.
  - The 941 JSON `box_1…box_6` don't follow form lines: `box_1` is wages (line 2), `box_2` is FIT (line 3), `box_3`/`box_4` are 5a and `box_5`/`box_6` are 5c.
  - The 940 JSON `box_1`/`box_2` are lines 7 and 8.
  - The 940 PDF prints the over-$7,000 excess as "line 4"; on the IRS form that amount is line 5.
- **W-2 vs 941 wage bases don't reconcile for Section 125 or HSA**:
  - W-2 boxes 3 and 5 use gross, while paychecks and the 941 use FICA wages net of Section 125/HSA.
  - Box 1 subtracts every pre-tax amount, whatever its `reduces_federal` flag. Box 16 simply equals box 1.
  - Box 15 is the current work state, not the per-stub states.
  - No box 12, 14 or 18–20, so withheld local tax is not reported. GTL imputed income isn't computed.
- **SUI is JSON-only**: `docs/payroll-hr-module.md` and `docs/todo.md` still call it scaffolding needing forms and an endpoint. A JSON endpoint exists, with no PDF, no per-state format and no UI. The tax liability report is also JSON-only with no UI.
- **NACHA limitations**:
  - The file is always balanced (service class 200 plus a code 27 offset); there is no credits-only (220) or unbalanced option.
  - The prenote generator exists but has no endpoint, and `prenote_status` can't be changed.
  - `immediate_origin` is reduced to 9 digits, and account numbers longer than 17 characters are truncated.
  - Default company name and ID come from env config, not Settings.
  - There is no UI.
- **Portal gaps**:
  - No time-entry submission page. The Time Entries page comment says "the employee portal submits one", and `docs/todo.md` lists this as open.
  - No state W-4 editing and no way to remove a bank account.
  - The portal PTO form doesn't check end ≥ start.
  - The admin "Email to Employee" mailto body claims the link "can't be reused from another device"; the link stays valid until rotated or expired.
- **Time entries**:
  - UI approval sends `?approved_by=admin` as a query parameter, which the endpoint ignores (it reads the body), so entries record "manager".
  - The API doesn't enforce status transitions or non-negative hours.
- **Onboarding docs**: `docs/payroll-hr-module.md` calls `POST …/seed` "Reset / re-seed"; it only adds missing task types. The same doc lists an `OnboardingChecklist` model that doesn't exist.
- **Stale documentation**:
  - `docs/payroll-hr-module.md`:
    - lists a `Garnishment` class (the code has `GarnishmentOrder`);
    - says `DELETE /api/deductions/garnishments/{id}` cancels an order (it returns 405);
    - says the W-3 covers "all active employees" (it covers everyone paid);
    - lists pending items that are done (portal-token expiry/last-used UI, the encryption rewrap CLI);
    - says `tax_forms.js` "blob-opens" responses (it uses `window.open`);
    - names a `#/employees/{id}` route (it's a modal);
    - names `routes/payroll.py` (now a package);
    - shows the pre-2.18 plaintext `portal_token` column.
  - `docs/hipaa-compliance.md` still says the app is single-operator with no RBAC.
- **HR vault size limit**: uploads are read through `read_limited` with a 20 MB default (413). The route's "max 50MB" check can never trigger.
- **Stored but unused**: E-Verify is record-keeping only. Employee `role` and `manager_id` do nothing. `pays_out_on_termination` does nothing, and there is no termination date or final-pay flow. `employer_taxable` is stored in the snapshot only.
- **Accruals and gross-up simplifications**:
  - PTO accrual is manual and not tied to pay runs or hours, and PTO taken isn't paid as a stub earning.
  - Salaried and gross-override stubs carry 0 hours, which zeroes WA L&I, per-hour benefits and per-hour accrual input.
  - The gross-up ignores benefits, garnishments and hours.
- **No liability payment workflow**: there is no "Pay Payroll Liabilities" screen for 2310–2370. Only benefit codes have remittance bills.
- **Pay stub claims vs output**: the `paystub_pdf.py` header claims California Labor Code 226 compliance, but the stub doesn't print pay rates. It also prints for draft runs.
- **Chart fallback**: if 6110 or 6120 is missing, payroll posts wages or employer taxes to 6000, which the seeded chart names "Advertising & Marketing". It is registered as a control account for this purpose.
- **Figures are approximations**: federal brackets and the four dedicated state engines are labelled "2026-approximate". WA L&I rates are "representative". Garnishment and overtime rules are labelled simplified in the code.

---

_[← 3. General Ledger, Chart of Accounts & Banking](03-general-ledger-banking.md) · [Index](README.md) · [5. Reports, Dashboard, Analytics & AI →](05-reports-dashboard-analytics-ai.md)_
