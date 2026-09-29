_SlowBooks Pro 2026 feature inventory — [← 9. User Interface, Desktop Apps, Deployment & Engineering](09-ui-desktop-deployment-engineering.md) · [Index](README.md) · [Appendix B. Database schema →](appendix-b-database-schema.md)_

## Appendix A. Complete API endpoint catalog

Generated from the source with Python's `ast` module: every `@router.<method>(...)` decorator in `app/routes/**` plus the app-level routes in `app/main.py` — **546 operations** in total (a handler with two decorators is listed twice). Paths include each router's prefix. The Summary column is the first paragraph of the handler's docstring; where a handler has no docstring, its name is shown in _italics_ instead. Interactive OpenAPI docs are served at `/docs` on a running install.

#### `app/routes/accounts.py` — 5 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/accounts` | `list_accounts` | `?bank=1` lists the bank and credit-card accounts (bank_kind set) — what the register, the transfer form and every paid-from / deposit-to picker use. |
| GET | `/api/accounts/{account_id}` | `get_account` | _Get account_ |
| POST | `/api/accounts` | `create_account` | _Create account_ |
| PUT | `/api/accounts/{account_id}` | `update_account` | _Update account_ |
| DELETE | `/api/accounts/{account_id}` | `delete_account` | _Delete account_ |

#### `app/routes/analytics.py` — 14 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/analytics/dashboard` | `get_dashboard` | Complete analytics snapshot — the page-load payload. |
| GET | `/api/analytics/revenue` | `get_revenue` | Revenue by customer (windowed) + 12-month trend. |
| GET | `/api/analytics/expenses` | `get_expenses` | Expense breakdown by account number (windowed). |
| GET | `/api/analytics/cash-flow` | `get_cash_flow` | Cash forecast + DSO + A/R and A/P aging. |
| GET | `/api/analytics/profitability` | `get_profitability` | Customer profitability (lifetime paid revenue for now). |
| GET | `/api/analytics/export.csv` | `export_csv` | Dump the full analytics snapshot as a flat CSV. |
| GET | `/api/analytics/export.pdf` | `export_pdf` | Render the full analytics snapshot as a print-ready PDF. |
| GET | `/api/analytics/ai-config` | `get_ai_config` | Return AI config suitable for display — NEVER the raw API key. |
| PUT | `/api/analytics/ai-config` | `put_ai_config` | Update AI provider / model / key / account_id. |
| POST | `/api/analytics/ai-config/test` | `test_ai_config` | Smoke-test the configured AI provider with a trivial prompt. |
| POST | `/api/analytics/ai-insights` | `ai_insights` | Run the configured AI provider over the current dashboard snapshot. |
| GET | `/api/analytics/ai-actions` | `list_ai_actions` | List the curated AI analysis actions, grouped by category for the UI dropdown. No secrets, no per-row LLM calls — purely catalogue. The labels are written in the business words ("Unpaid invoices summary", "Customers &… |
| POST | `/api/analytics/ai-actions/{action_key}` | `run_ai_action` | Run one curated analysis: fetch data + LLM narrative. |
| POST | `/api/analytics/ai-query` | `ai_query` | Answer arbitrary business questions using tool-calling LLM. |

#### `app/routes/api_tokens.py` — 3 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/tokens` | `list_tokens` | _List tokens_ |
| POST | `/api/tokens` | `create_token` | _Create token_ |
| PUT | `/api/tokens/{token_id}` | `update_token` | _Update token_ |

#### `app/routes/attachments.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| POST | `/api/attachments/{entity_type}/{entity_id}` | `upload_attachment` | _Upload attachment_ |
| GET | `/api/attachments/download/{attachment_id}` | `download_attachment` | _Download attachment_ |
| GET | `/api/attachments/{entity_type}/{entity_id}` | `list_attachments` | _List attachments_ |
| DELETE | `/api/attachments/{attachment_id}` | `delete_attachment` | _Delete attachment_ |

#### `app/routes/audit.py` — 2 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/audit` | `list_audit_logs` | _List audit logs_ |
| GET | `/api/audit/tables` | `list_audited_tables` | Get list of tables that have audit entries. |

#### `app/routes/auth.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/auth/status` | `auth_status` | Tell the SPA whether first-run setup is needed and whether the current session is authenticated. |
| POST | `/api/auth/setup` | `setup` | First-run setup: store company/operator info and the operator password in one transaction, then issue a session. Returns 409 if a password is already set. |
| POST | `/api/auth/login` | `login` | Verify the operator password and issue a session. |
| POST | `/api/auth/logout` | `logout` | Clear the session cookie. |

#### `app/routes/backups.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/backups` | `list_backups` | This company's backups whose files still exist on disk. The folder is shared by every company on the machine; another company's backups are not listed (explore 2.17.3, macbase1 F25). |
| POST | `/api/backups` | `make_backup` | _Make backup_ |
| GET | `/api/backups/download/{filename}` | `download_backup` | _Download backup_ |
| POST | `/api/backups/restore` | `restore` | Replace this company's books with a backup. |

#### `app/routes/bank_import.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| POST | `/api/bank-import/preview` | `preview_ofx` | Parse OFX/QFX file and return preview of transactions. |
| POST | `/api/bank-import/import/{bank_account_id}` | `import_ofx` | Import OFX/QFX transactions into a bank account. |
| POST | `/api/bank-import/preview-csv` | `preview_csv` | Parse CSV bank statement and return preview of transactions. An unrecognised layout answers with its columns and a few rows, for the dialog's mapping step; `mapping` (JSON) is that step's answer. |
| POST | `/api/bank-import/import-csv/{bank_account_id}` | `import_csv` | Import CSV bank transactions into a bank account. |

#### `app/routes/bank_rules.py` — 6 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/bank-rules` | `list_rules` | _List rules_ |
| GET | `/api/bank-rules/{rule_id}` | `get_rule` | _Get rule_ |
| POST | `/api/bank-rules` | `create_rule` | _Create rule_ |
| PUT | `/api/bank-rules/{rule_id}` | `update_rule` | _Update rule_ |
| DELETE | `/api/bank-rules/{rule_id}` | `delete_rule` | _Delete rule_ |
| POST | `/api/bank-rules/apply` | `apply_rules` | Apply all active rules to every unmatched statement line (category only — adding to the books stays a click). |

#### `app/routes/banking.py` — 28 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/banking/overview` | `banking_overview` | Every bank and card account with its ledger balance, its feed (if any), how many statement lines wait for review, and the last completed reconciliation. |
| GET | `/api/banking/accounts` | `list_bank_accounts` | _List bank accounts_ |
| GET | `/api/banking/accounts/{account_id}` | `get_bank_account` | _Get bank account_ |
| GET | `/api/banking/ledger-balance` | `ledger_balance` | What the books already say about a bank or card account on a date — the New Bank Account form shows it beside the statement balance. |
| POST | `/api/banking/accounts` | `create_bank_account` | _Create bank account_ |
| PUT | `/api/banking/accounts/{account_id}` | `update_bank_account` | _Update bank account_ |
| POST | `/api/banking/accounts/{account_id}/post-legacy-balance` | `post_legacy_balance` | The pre-2.10 register balance, posted once as the account's opening balance (against 3900), then cleared from the feed. |
| GET | `/api/banking/transactions` | `list_bank_transactions` | Statement lines (feeds and imports) — the review queue. `status` filters on match_status: unmatched \| auto \| manual \| added \| excluded. |
| GET | `/api/banking/transactions/{txn_id}/candidates` | `statement_candidates` | Ledger lines this statement line could be matched to. |
| POST | `/api/banking/transactions/{txn_id}/match` | `statement_match` | _Statement match_ |
| POST | `/api/banking/transactions/{txn_id}/unmatch` | `statement_unmatch` | _Statement unmatch_ |
| POST | `/api/banking/transactions/{txn_id}/add` | `statement_add` | Post this statement line as a register entry and link it. |
| PATCH | `/api/banking/transactions/{txn_id}` | `statement_set_category` | Save the category picked for a statement line in the review list. |
| POST | `/api/banking/transactions/{txn_id}/exclude` | `statement_exclude` | _Statement exclude_ |
| POST | `/api/banking/transactions/{txn_id}/restore` | `statement_restore` | _Statement restore_ |
| POST | `/api/banking/accounts/{account_id}/feed/add-all` | `feed_add_all` | Add every unmatched line that already carries a category. |
| POST | `/api/banking/accounts/{account_id}/feed/auto-match` | `feed_auto_match` | Find matches for this feed's unmatched lines (what an import does on arrival, on demand). |
| POST | `/api/banking/transactions` | `create_bank_transaction` | A register entry posts to the ledger (issue #114): DR category / CR account for money out, the reverse for money in; a bank or card category makes it a transfer. |
| POST | `/api/banking/entries/{txn_id}/void` | `void_bank_entry` | _Void bank entry_ |
| GET | `/api/banking/reconciliations` | `list_reconciliations` | _List reconciliations_ |
| POST | `/api/banking/reconciliations` | `create_reconciliation` | Start a reconciliation (409 with existing_id when one is open). |
| GET | `/api/banking/reconciliations/{recon_id}/transactions` | `get_reconciliation_transactions` | The ledger lines on the account up to the statement date, cleared or not, with the statement / beginning / cleared / difference math. |
| POST | `/api/banking/reconciliations/{recon_id}/toggle/{line_id}` | `toggle_cleared` | _Toggle cleared_ |
| POST | `/api/banking/reconciliations/{recon_id}/complete` | `complete_reconciliation` | Finish: the difference must be zero; the cleared lines are stamped. |
| GET | `/api/banking/reconciliations/{recon_id}/report` | `reconciliation_report` | A completed reconciliation's report: beginning and ending balances, the items it cleared, what was outstanding on the statement date. |
| GET | `/api/banking/reconciliations/{recon_id}/pdf` | `reconciliation_report_pdf` | _Reconciliation report pdf_ |
| DELETE | `/api/banking/reconciliations/{recon_id}` | `abandon_reconciliation` | _Abandon reconciliation_ |
| GET | `/api/banking/check-register` | `check_register` | The register: every ledger line on a bank or card account, natural- balance running balance (a card shows the amount owed positive), with the posting each row came from and whether it has cleared. |

#### `app/routes/batch_payments.py` — 1 operation

| Method | Path | Handler | Summary |
|---|---|---|---|
| POST | `/api/batch-payments` | `create_batch_payment` | One payment per customer, applied to the invoices chosen, in one commit: a refused line writes nothing for any customer. |

#### `app/routes/benefits.py` — 25 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/benefits/codes` | `list_codes` | _List codes_ |
| POST | `/api/benefits/codes` | `create_code` | _Create code_ |
| POST | `/api/benefits/codes/seed-standard` | `seed_standard` | Create the common codes (Section 125, HSA, 401(k) with a tiered match, Roth, union dues, loan, employer health, GTL) if missing. |
| POST | `/api/benefits/setup-accounts` | `setup_accounts` | Create the benefit / PTO accounts (2380, 2390, 6150, 6160) a company file from before the engine doesn't have. |
| GET | `/api/benefits/codes/{code_id}` | `get_code` | _Get code_ |
| PUT | `/api/benefits/codes/{code_id}` | `update_code` | _Update code_ |
| DELETE | `/api/benefits/codes/{code_id}` | `deactivate_code` | Codes are never deleted — posted stubs snapshot them — only retired. |
| GET | `/api/benefits/codes/{code_id}/rates` | `list_rates` | _List rates_ |
| POST | `/api/benefits/codes/{code_id}/rates` | `add_rate` | A new dated rate. The previous open row closes the day before, so runs already posted keep resolving to the rate they used. |
| DELETE | `/api/benefits/codes/{code_id}/rates/{rate_id}` | `delete_rate` | _Delete rate_ |
| GET | `/api/benefits/groups` | `list_groups` | _List groups_ |
| POST | `/api/benefits/groups` | `create_group` | _Create group_ |
| PUT | `/api/benefits/groups/{group_id}` | `update_group` | _Update group_ |
| PUT | `/api/benefits/groups/{group_id}/codes` | `set_group_codes` | _Set group codes_ |
| PUT | `/api/benefits/groups/{group_id}/members` | `set_group_members` | Replace the group's membership: listed employees join, everyone else currently in the group leaves. |
| DELETE | `/api/benefits/groups/{group_id}` | `delete_group` | _Delete group_ |
| GET | `/api/benefits/enrollments` | `list_enrollments` | _List enrollments_ |
| POST | `/api/benefits/enrollments` | `create_enrollment` | _Create enrollment_ |
| PUT | `/api/benefits/enrollments/{enrollment_id}` | `update_enrollment` | _Update enrollment_ |
| DELETE | `/api/benefits/enrollments/{enrollment_id}` | `end_enrollment` | End an assignment. With an end_date it stays on file (history); without one it's removed outright. |
| GET | `/api/benefits/employee/{emp_id}/resolved` | `resolved_for_employee` | What the next pay run would apply: assignments, then the group's codes, each at the rate in force on `as_of` (default today). |
| GET | `/api/benefits/ytd` | `list_ytd` | _List ytd_ |
| POST | `/api/benefits/ytd/rebuild` | `rebuild_ytd` | Repair: recompute the year's accumulators from the stub snapshots. |
| GET | `/api/benefits/remittance` | `remittance` | _Remittance_ |
| POST | `/api/benefits/remittance/bill` | `remittance_bill` | _Remittance bill_ |

#### `app/routes/bill_payments.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/bill-payments` | `list_bill_payments` | `?bill_id=` lists the payments applied to one bill (its view offers Void on each — a paid bill's payment could not be voided on screen). |
| GET | `/api/bill-payments/{bill_payment_id}` | `get_bill_payment` | One bill payment and the bills it paid. The bank register links a bill payment here (#/bill-payments/{id}); the link said "Page not found". |
| POST | `/api/bill-payments` | `create_bill_payment` | _Create bill payment_ |
| POST | `/api/bill-payments/{bill_payment_id}/void` | `void_bill_payment` | Void a bill payment — reverses JE and restores bill balances. |

#### `app/routes/bills.py` — 6 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/bills` | `list_bills` | Newest first, a page at a time (500 by default, at most 1,000). open_only: the bills that can still be paid or credited (unpaid or partial, with a balance due), filtered here so an old unpaid bill is never lost behind… |
| GET | `/api/bills/{bill_id}` | `get_bill` | _Get bill_ |
| GET | `/api/bills/{bill_id}/pdf` | `bill_pdf` | The bill as a PDF. Save PDF on the bill's view opened this URL long before it existed, and got a JSON "Not Found" (skytech W-M8). |
| GET | `/api/bills/{bill_id}/print-preview` | `bill_print_preview` | The bill as a page that opens the print dialog. |
| POST | `/api/bills` | `create_bill` | _Create bill_ |
| POST | `/api/bills/{bill_id}/void` | `void_bill` | _Void bill_ |

#### `app/routes/budgets.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/budgets` | `list_budgets` | _List budgets_ |
| POST | `/api/budgets` | `create_budget` | _Create budget_ |
| POST | `/api/budgets/bulk` | `bulk_upsert` | Batch upsert budget entries. |
| GET | `/api/budgets/variance` | `budget_variance` | Compare budget vs actual TransactionLine sums per account per month. |

#### `app/routes/cc_charges.py` — 3 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/cc-charges` | `list_cc_charges` | List credit card charge transactions. |
| POST | `/api/cc-charges` | `create_cc_charge` | _Create cc charge_ |
| POST | `/api/cc-charges/{charge_id}/void` | `void_cc_charge` | Reverse a charge: the original stays, a mirror image cancels it. |

#### `app/routes/checks.py` — 1 operation

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/checks/print` | `print_check` | Generate a check PDF for a bill payment — money going out. |

#### `app/routes/classes.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/classes` | `list_classes` | _List classes_ |
| POST | `/api/classes` | `create_class` | _Create class_ |
| PUT | `/api/classes/{class_id}` | `update_class` | _Update class_ |
| DELETE | `/api/classes/{class_id}` | `delete_class` | _Delete class_ |

#### `app/routes/companies.py` — 2 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/companies` | `get_companies` | _Get companies_ |
| POST | `/api/companies` | `new_company` | _New company_ |

#### `app/routes/cost_codes.py` — 7 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/cost-codes` | `list_cost_codes` | _List cost codes_ |
| GET | `/api/cost-codes/tree` | `cost_code_tree` | Nested codes (division > code > sub-code) for pickers and Settings. |
| POST | `/api/cost-codes/import` | `import_codes` | Bulk load: JSON rows or CSV text of code,name,cost_type,parent_code. Existing codes are updated, parents linked in a second pass. |
| POST | `/api/cost-codes` | `create_cost_code` | _Create cost code_ |
| POST | `/api/cost-codes/standard` | `load_standard_cost_codes` | Load the CSI MasterFormat divisions (plus Labor and Equipment Rental). Existing codes are left alone, so this is safe to repeat. |
| PUT | `/api/cost-codes/{code_id}` | `update_cost_code` | _Update cost code_ |
| DELETE | `/api/cost-codes/{code_id}` | `delete_cost_code` | _Delete cost code_ |

#### `app/routes/credit_memos.py` — 7 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/credit-memos` | `list_credit_memos` | _List credit memos_ |
| GET | `/api/credit-memos/{cm_id}` | `get_credit_memo` | _Get credit memo_ |
| GET | `/api/credit-memos/{cm_id}/pdf` | `credit_memo_pdf` | The credit memo as a PDF, to send to the customer. |
| GET | `/api/credit-memos/{cm_id}/print-preview` | `credit_memo_print_preview` | The same page as the PDF, opened with the browser's print dialog. |
| POST | `/api/credit-memos` | `create_credit_memo` | _Create credit memo_ |
| POST | `/api/credit-memos/{cm_id}/apply` | `apply_credit` | Apply credit memo to an invoice. |
| POST | `/api/credit-memos/{cm_id}/void` | `void_credit_memo` | Reverse a credit memo: put every application back on its invoice, post the mirror-image entry, return any inventory the memo took back, and mark it void. This is also how a mistaken write-off is undone. |

#### `app/routes/csv.py` — 15 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/csv/export/customers` | `csv_export_customers` | _Csv export customers_ |
| GET | `/api/csv/export/classes` | `csv_export_classes` | _Csv export classes_ |
| GET | `/api/csv/export/jobs` | `csv_export_jobs` | _Csv export jobs_ |
| GET | `/api/csv/export/bills` | `csv_export_bills` | _Csv export bills_ |
| GET | `/api/csv/export/deposits` | `csv_export_deposits` | _Csv export deposits_ |
| GET | `/api/csv/export/sales-receipts` | `csv_export_sales_receipts` | _Csv export sales receipts_ |
| GET | `/api/csv/export/vendors` | `csv_export_vendors` | _Csv export vendors_ |
| GET | `/api/csv/export/items` | `csv_export_items` | _Csv export items_ |
| GET | `/api/csv/export/invoices` | `csv_export_invoices` | _Csv export invoices_ |
| GET | `/api/csv/export/accounts` | `csv_export_accounts` | _Csv export accounts_ |
| POST | `/api/csv/import/customers` | `csv_import_customers` | _Csv import customers_ |
| POST | `/api/csv/import/vendors` | `csv_import_vendors` | _Csv import vendors_ |
| POST | `/api/csv/import/items` | `csv_import_items` | _Csv import items_ |
| POST | `/api/csv/import/accounts` | `csv_import_accounts` | Import a chart of accounts (#139 / #161): SlowBooks' own export columns, any CSV with Number/Name/Type headers, or hledger's account list (`hledger accounts`, `accounts --types`, `balance -O csv`). |
| POST | `/api/csv/import/qb-report` | `csv_import_qb_report` | Import a QuickBooks Desktop report CSV — the documented fallback for Desktop, which can't export transactions to IIF. Auto-detects the report by its columns: Transaction Detail filtered to Sales Receipt, Deposit Detai… |

#### `app/routes/customers.py` — 7 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/customers` | `list_customers` | _List customers_ |
| GET | `/api/customers/check-duplicate` | `check_duplicate` | Phase 11: standalone duplicate-check endpoint the UI can call BEFORE submitting a create form to warn the user proactively. |
| GET | `/api/customers/{customer_id}` | `get_customer` | _Get customer_ |
| GET | `/api/customers/{customer_id}/credits` | `customer_credits` | Money the customer has with us that is not on an invoice yet — the unapplied part of their payments and credit memos not yet applied — each with what can still be applied, so Receive Payment and the customer page can… |
| POST | `/api/customers` | `create_customer` | _Create customer_ |
| PUT | `/api/customers/{customer_id}` | `update_customer` | _Update customer_ |
| DELETE | `/api/customers/{customer_id}` | `delete_customer` | _Delete customer_ |

#### `app/routes/dashboard.py` — 2 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/dashboard/widgets` | `list_widgets` | _List widgets_ |
| GET | `/api/dashboard/data` | `widget_data` | Data for the requested widget ids (comma-separated). Unknown ids are ignored; no ids means the default layout. |

#### `app/routes/deductions.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/deductions/garnishments` | `list_garnishments` | _List garnishments_ |
| POST | `/api/deductions/garnishments` | `create_garnishment` | _Create garnishment_ |
| POST | `/api/deductions/garnishments/{order_id}/end` | `end_garnishment` | End a garnishment order: it is no longer withheld from future pay runs (runs read active orders only), and its record — case number, type, amount, priority — stays, as a court-ordered withholding's should. It used to… |
| DELETE | `/api/deductions/garnishments/{order_id}` | `remove_garnishment` | A garnishment order is ended, not deleted, so its record stays. |

#### `app/routes/deposits.py` — 5 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/deposits/pending` | `list_pending_deposits` | Payments sitting in Undeposited Funds (1200), newest first. |
| GET | `/api/deposits` | `list_deposits` | Deposits made, newest first — with the payments each took, and whether it can still be voided (not void already, not reconciled). |
| GET | `/api/deposits/{deposit_id}` | `get_deposit` | One deposit and the payments it took. The bank register links a deposit here (#/deposits/{id}); the link said "Page not found". |
| POST | `/api/deposits` | `create_deposit` | _Create deposit_ |
| POST | `/api/deposits/{deposit_id}/void` | `void_deposit` | Take a deposit back: post its mirror image and put every payment it took back on the Make Deposits list. This is how one payment comes out of a deposit — void it, then deposit the others again. |

#### `app/routes/document_audit.py` — 3 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/document-audits` | `list_audits` | List recent document audit rows, newest first. Optional filters narrow by doc family (`w2`, `941`, ...) or by the type-specific key. |
| GET | `/api/document-audits/{audit_id}` | `get_audit` | Look up one audit row by its ID — the ID printed in the PDF footer. |
| GET | `/api/document-audits/verify/{content_hash}` | `verify_hash` | Find every audit row matching this full SHA-256 hash. Used when an auditor has the PDF's hash but not the ID — e.g. they recomputed it independently and want to confirm it's known to the system. |

#### `app/routes/donors.py` — 6 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/donors/gifts/{kind}/{gift_id}/acknowledgment/preview` | `acknowledgment_preview` | Is this a gift that gets a letter, and for how much? (A receipt's own payment is not — the receipt is acknowledged instead.) |
| GET | `/api/donors/gifts/{kind}/{gift_id}/acknowledgment/pdf` | `acknowledgment_pdf` | _Acknowledgment pdf_ |
| POST | `/api/donors/gifts/{kind}/{gift_id}/acknowledgment/email` | `acknowledgment_email` | _Acknowledgment email_ |
| GET | `/api/donors/giving-statements/pdf` | `giving_statements_pdf` | Every donor with a gift that year, one PDF, a page break per donor. |
| GET | `/api/donors/{customer_id}/giving-statement/pdf` | `giving_statement_pdf` | _Giving statement pdf_ |
| POST | `/api/donors/giving-statements/batch-email` | `giving_statements_batch_email` | Email each donor their statement (skipping those who opted out). |

#### `app/routes/email_templates.py` — 7 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/email-templates` | `list_templates` | _List templates_ |
| GET | `/api/email-templates/{template_id}` | `get_template` | _Get template_ |
| POST | `/api/email-templates/preview` | `preview_template` | Render candidate template text against a real invoice, without saving. |
| POST | `/api/email-templates` | `create_template` | _Create template_ |
| PUT | `/api/email-templates/{template_id}` | `update_template` | _Update template_ |
| DELETE | `/api/email-templates/{template_id}` | `delete_template` | _Delete template_ |
| POST | `/api/email-templates/seed-defaults` | `seed_defaults` | Create default email templates if they don't exist. |

#### `app/routes/employees.py` — 17 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/employees` | `list_employees` | _List employees_ |
| GET | `/api/employees/{emp_id}` | `get_employee` | _Get employee_ |
| POST | `/api/employees` | `create_employee` | _Create employee_ |
| PUT | `/api/employees/{emp_id}` | `update_employee` | _Update employee_ |
| GET | `/api/employees/{emp_id}/portal-token` | `get_portal_token` | Return the employee's self-service portal token, minting one if absent. |
| GET | `/api/employees/{emp_id}/everify` | `get_everify` | Return the employee's E-Verify case record. |
| PUT | `/api/employees/{emp_id}/everify` | `update_everify` | Record / update an E-Verify case for the employee. |
| GET | `/api/employees/{emp_id}/portal-access` | `list_portal_access` | Recent portal_accesses rows for one employee. Powers the admin "who hit my portal page when?" view in the Employee Details modal. |
| POST | `/api/employees/{emp_id}/portal-token` | `regenerate_portal_token` | Rotate the portal token (invalidates the previous self-service link). |
| GET | `/api/employees/{emp_id}/ytd` | `get_employee_ytd` | Year-to-date payroll totals for an employee (exposes the Bug 1 fix). |
| GET | `/api/employees/{emp_id}/bank-accounts` | `list_bank_accounts` | _List bank accounts_ |
| POST | `/api/employees/{emp_id}/bank-accounts` | `add_bank_account` | _Add bank account_ |
| DELETE | `/api/employees/{emp_id}/bank-accounts/{ba_id}` | `remove_bank_account` | _Remove bank account_ |
| GET | `/api/employees/{emp_id}/documents` | `list_employee_documents` | _List employee documents_ |
| POST | `/api/employees/{emp_id}/documents` | `upload_employee_document` | _Upload employee document_ |
| GET | `/api/employees/{emp_id}/documents/{doc_id}` | `download_employee_document` | _Download employee document_ |
| DELETE | `/api/employees/{emp_id}/documents/{doc_id}` | `delete_employee_document` | _Delete employee document_ |

#### `app/routes/estimates.py` — 7 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/estimates` | `list_estimates` | _List estimates_ |
| GET | `/api/estimates/{estimate_id}` | `get_estimate` | _Get estimate_ |
| POST | `/api/estimates` | `create_estimate` | _Create estimate_ |
| PUT | `/api/estimates/{estimate_id}` | `update_estimate` | _Update estimate_ |
| GET | `/api/estimates/{estimate_id}/pdf` | `estimate_pdf` | Generate the estimate PDF. |
| GET | `/api/estimates/{estimate_id}/print-preview` | `estimate_print_preview` | Render estimate as HTML page for browser print dialog (window.print()) |
| POST | `/api/estimates/{estimate_id}/convert` | `convert_to_invoice` | Convert to invoice — deep-copies all fields and lines. |

#### `app/routes/expenses.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/expenses` | `list_expenses` | _List expenses_ |
| GET | `/api/expenses/{expense_id}` | `get_expense` | _Get expense_ |
| POST | `/api/expenses/{expense_id}/void` | `void_expense` | Reverse a recorded expense — same convention as bills and manual entries: the original stays in the ledger, a mirror-image entry cancels it, and the expense shows as void. Booked it to the wrong account? Void it and e… |
| POST | `/api/expenses` | `create_expense` | _Create expense_ |

#### `app/routes/fixed_assets.py` — 12 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/fixed-assets/types` | `list_types` | _List types_ |
| POST | `/api/fixed-assets/types` | `create_type` | _Create type_ |
| PUT | `/api/fixed-assets/types/{type_id}` | `update_type` | _Update type_ |
| GET | `/api/fixed-assets` | `list_assets` | _List assets_ |
| GET | `/api/fixed-assets/{asset_id}` | `get_asset` | _Get asset_ |
| POST | `/api/fixed-assets` | `create_asset` | _Create asset_ |
| POST | `/api/fixed-assets/{asset_id}/post-purchase` | `post_purchase` | Put the purchase of an asset registered before it was asked for — or registered as already in the books when it wasn't — in the books. |
| PUT | `/api/fixed-assets/{asset_id}` | `update_asset` | _Update asset_ |
| POST | `/api/fixed-assets/run-depreciation` | `depreciation_run` | _Depreciation run_ |
| POST | `/api/fixed-assets/{asset_id}/dispose` | `dispose` | _Dispose_ |
| POST | `/api/fixed-assets/import-csv` | `import_csv` | _Import csv_ |
| GET | `/api/fixed-assets/reports/reconciliation` | `reconciliation` | Fixed Asset Reconciliation: register totals per type (cost, accumulated, book value) — compare against the mapped GL accounts. |

#### `app/routes/fx.py` — 1 operation

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/fx/rate` | `fx_rate` | Latest available rate from one currency to another (default: home). |

#### `app/routes/iif.py` — 14 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/iif/export/all` | `export_all_iif` | _Export all iif_ |
| GET | `/api/iif/export/accounts` | `export_accounts_iif` | _Export accounts iif_ |
| GET | `/api/iif/export/classes` | `export_classes_iif` | _Export classes iif_ |
| GET | `/api/iif/export/bills` | `export_bills_iif` | _Export bills iif_ |
| GET | `/api/iif/export/deposits` | `export_deposits_iif` | _Export deposits iif_ |
| GET | `/api/iif/export/sales-receipts` | `export_sales_receipts_iif` | _Export sales receipts iif_ |
| GET | `/api/iif/export/customers` | `export_customers_iif` | _Export customers iif_ |
| GET | `/api/iif/export/vendors` | `export_vendors_iif` | _Export vendors iif_ |
| GET | `/api/iif/export/items` | `export_items_iif` | _Export items iif_ |
| GET | `/api/iif/export/invoices` | `export_invoices_iif` | _Export invoices iif_ |
| GET | `/api/iif/export/payments` | `export_payments_iif` | _Export payments iif_ |
| GET | `/api/iif/export/estimates` | `export_estimates_iif` | _Export estimates iif_ |
| POST | `/api/iif/import` | `import_iif` | Upload and import an IIF file into Slowbooks. |
| POST | `/api/iif/validate` | `validate_iif_file` | Validate an IIF file without importing — pre-flight check. |

#### `app/routes/in_kind.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/in-kind-gifts` | `list_in_kind_gifts` | _List in kind gifts_ |
| GET | `/api/in-kind-gifts/{gift_id}` | `get_in_kind_gift` | _Get in kind gift_ |
| POST | `/api/in-kind-gifts` | `create_in_kind_gift` | _Create in kind gift_ |
| POST | `/api/in-kind-gifts/{gift_id}/void` | `void_in_kind_gift_route` | _Void in kind gift route_ |

#### `app/routes/invoices/crud.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/invoices` | `list_invoices` | Newest first, a page at a time (500 by default, at most 1,000). open_only: the invoices money can still be applied to (draft, sent or partial, with a balance due) — what Receive Payment, Batch Payments and the credit… |
| GET | `/api/invoices/{invoice_id}` | `get_invoice` | _Get invoice_ |
| POST | `/api/invoices` | `create_invoice` | _Create invoice_ |
| PUT | `/api/invoices/{invoice_id}` | `update_invoice` | _Update invoice_ |

#### `app/routes/invoices/documents.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/invoices/{invoice_id}/pdf` | `invoice_pdf` | Generate the invoice PDF. |
| GET | `/api/invoices/{invoice_id}/print-preview` | `invoice_print_preview` | Render invoice as HTML page for browser print dialog (window.print()) |
| POST | `/api/invoices/{invoice_id}/email-preview` | `email_invoice_preview` | Exactly what the send would produce, without sending it. |
| POST | `/api/invoices/{invoice_id}/email` | `email_invoice` | Email invoice as PDF attachment — Feature 8 |

#### `app/routes/invoices/lifecycle.py` — 5 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| POST | `/api/invoices/{invoice_id}/void` | `void_invoice` | Void — creates a reversing journal entry. |
| POST | `/api/invoices/{invoice_id}/send` | `mark_invoice_sent` | Mark the invoice as sent. |
| POST | `/api/invoices/apply-late-fees` | `apply_late_fees` | Apply late fees to overdue invoices past the grace period. |
| POST | `/api/invoices/{invoice_id}/write-off` | `write_off_invoice` | Forgive an open balance (a pledge that will never be paid): a credit memo flagged as a write-off, posting DR Bad Debt Expense / CR A/R and applied to the invoice at once, so the A/R subledger, the donor statement and… |
| POST | `/api/invoices/{invoice_id}/duplicate` | `duplicate_invoice` | Duplicate — the same sale under a new number, dated today and not sent yet. The copy carries what the original says about the sale: its currency and the rate it was booked at, the job, class and PO number, and each li… |

#### `app/routes/items.py` — 9 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/items` | `list_items` | _List items_ |
| GET | `/api/items/low-stock` | `low_stock_items` | Items where quantity_on_hand <= reorder_point (and reorder_point > 0), plus any item whose on-hand has gone negative. |
| GET | `/api/items/valuation` | `inventory_valuation` | Total inventory value (sum of qty * avg_cost across tracked items). |
| GET | `/api/items/{item_id}` | `get_item` | _Get item_ |
| GET | `/api/items/{item_id}/movements` | `list_item_movements` | Inventory ledger for one item, newest first. |
| POST | `/api/items/{item_id}/adjust` | `adjust_inventory` | Manual inventory adjustment (count correction, shrinkage, spoilage). |
| POST | `/api/items` | `create_item` | _Create item_ |
| PUT | `/api/items/{item_id}` | `update_item` | _Update item_ |
| DELETE | `/api/items/{item_id}` | `delete_item` | _Delete item_ |

#### `app/routes/job_costing.py` — 14 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/cost-types` | `list_cost_types` | _List cost types_ |
| POST | `/api/cost-types` | `create_cost_type` | _Create cost type_ |
| PUT | `/api/cost-types/{type_id}` | `update_cost_type` | _Update cost type_ |
| DELETE | `/api/cost-types/{type_id}` | `delete_cost_type` | _Delete cost type_ |
| POST | `/api/cost-types/setup-offsets` | `setup_offset_accounts` | Create the applied-cost accounts (if missing) and point every cost type at them, so Job Cost Entries and time postings work out of the box. Existing choices on a cost type are left alone. |
| GET | `/api/equipment` | `list_equipment` | _List equipment_ |
| POST | `/api/equipment` | `create_equipment` | _Create equipment_ |
| PUT | `/api/equipment/{eq_id}` | `update_equipment` | _Update equipment_ |
| DELETE | `/api/equipment/{eq_id}` | `delete_equipment` | _Delete equipment_ |
| GET | `/api/job-costs` | `list_job_costs` | _List job costs_ |
| GET | `/api/job-costs/{jc_id}` | `get_job_cost` | _Get job cost_ |
| POST | `/api/job-costs` | `create_job_cost` | _Create job cost_ |
| POST | `/api/job-costs/allocate` | `allocate` | _Allocate_ |
| POST | `/api/job-costs/{jc_id}/void` | `void` | _Void_ |

#### `app/routes/jobs.py` — 12 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/jobs` | `list_jobs` | _List jobs_ |
| GET | `/api/jobs/profitability` | `jobs_profitability` | One row per job with activity in the period (plus the "No job" bucket) — the Jobs page's figures. The report route under /reports wraps the same data with totals. |
| GET | `/api/jobs/budget-vs-actual` | `jobs_budget_vs_actual` | Headline budget / committed / actual / projected / variance per job. |
| GET | `/api/jobs/{job_id}` | `get_job` | _Get job_ |
| GET | `/api/jobs/{job_id}/transactions` | `get_job_transactions` | _Get job transactions_ |
| GET | `/api/jobs/{job_id}/cost-tree` | `get_job_cost_tree` | The drill-down: cost types → cost-code tree → posted lines, every level with budget / committed / actual / projected / variance. |
| GET | `/api/jobs/{job_id}/budgets` | `get_job_budgets` | _Get job budgets_ |
| PUT | `/api/jobs/{job_id}/budgets` | `save_job_budgets` | Replace the job's MANUAL budget rows with the given set (estimate- seeded rows are kept unless the same key is supplied, which then takes over as manual). Zero-amount rows are dropped. |
| POST | `/api/jobs/{job_id}/budgets/from-estimate/{estimate_id}` | `seed_budget_from_estimate` | _Seed budget from estimate_ |
| POST | `/api/jobs` | `create_job` | _Create job_ |
| PUT | `/api/jobs/{job_id}` | `update_job` | _Update job_ |
| DELETE | `/api/jobs/{job_id}` | `delete_job` | _Delete job_ |

#### `app/routes/journal.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/journal` | `list_journal_entries` | _List journal entries_ |
| GET | `/api/journal/{entry_id}` | `get_journal_entry` | _Get journal entry_ |
| POST | `/api/journal` | `create_manual_journal_entry` | _Create manual journal entry_ |
| POST | `/api/journal/{entry_id}/void` | `void_journal_entry` | _Void journal entry_ |

#### `app/routes/migration.py` — 3 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/migration/sources` | `list_sources` | _List sources_ |
| POST | `/api/migration/{source}/dry-run` | `migration_dry_run` | _Migration dry run_ |
| POST | `/api/migration/{source}/import` | `migration_import` | _Migration import_ |

#### `app/routes/nonprofit.py` — 17 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| POST | `/api/nonprofit/setup-accounts` | `setup_accounts` | Create the net-asset, in-kind and bad-debt accounts if missing (3300, 3400, 4400, 6960; numbers yield to an existing chart). Safe to call any number of times — the Settings page calls it when a company switches to non… |
| GET | `/api/nonprofit/releases/suggest` | `suggest_release` | What the fund spent in the period less what was already released for it — the amount the release form fills in. |
| GET | `/api/nonprofit/releases` | `list_releases` | _List releases_ |
| GET | `/api/nonprofit/releases/{rel_id}` | `get_release` | _Get release_ |
| POST | `/api/nonprofit/releases` | `create_release` | _Create release_ |
| POST | `/api/nonprofit/releases/{rel_id}/void` | `void_release_route` | _Void release route_ |
| GET | `/api/nonprofit/allocation-rules` | `list_allocation_rules` | _List allocation rules_ |
| POST | `/api/nonprofit/allocation-rules` | `create_allocation_rule` | _Create allocation rule_ |
| GET | `/api/nonprofit/allocation-rules/{rule_id}` | `get_allocation_rule` | _Get allocation rule_ |
| PUT | `/api/nonprofit/allocation-rules/{rule_id}` | `update_allocation_rule` | _Update allocation rule_ |
| DELETE | `/api/nonprofit/allocation-rules/{rule_id}` | `delete_allocation_rule` | _Delete allocation rule_ |
| GET | `/api/nonprofit/allocation-rules/{rule_id}/split` | `split_by_rule` | One amount through the rule — what the Split button on an entry line expands into. `class_id` is the line's own fund, used for targets that name only a function. |
| GET | `/api/nonprofit/allocation-rules/{rule_id}/preview` | `preview_allocation` | What a period-end run would move: the unassigned pool on the rule's source and how it would split. |
| GET | `/api/nonprofit/allocations` | `list_allocations` | _List allocations_ |
| GET | `/api/nonprofit/allocations/{fa_id}` | `get_allocation` | _Get allocation_ |
| POST | `/api/nonprofit/allocations` | `create_allocation` | _Create allocation_ |
| POST | `/api/nonprofit/allocations/{fa_id}/void` | `void_allocation` | _Void allocation_ |

#### `app/routes/ocr.py` — 6 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/ocr/status` | `ocr_status` | Frontend gating + Settings-page status row (spec §6.6). Reports the active engine for this platform (engine seam, design doc §engines). |
| POST | `/api/ocr/receipt` | `scan_receipt` | Scan a receipt image/PDF, extract fields, store the scan for later attachment. Synchronous with a bounded Tesseract call (spec §5.2). |
| POST | `/api/ocr/intake/{intake_id}/attach` | `attach_intake` | Attach a stored scan to a saved document: the scan's stored file becomes the attachment's. The frontend calls this after the bill/receipt is created (spec §6.5); sales receipts attach as entity_type='invoice'. |
| GET | `/api/ocr/intake/{intake_id}/image` | `intake_image` | Serve the stored scan as a PNG/image for the box-to-fix canvas. Auth'd like everything else; the intake id is unguessable and expiring, but this endpoint still sits behind the session like the rest. |
| POST | `/api/ocr/intake/{intake_id}/region` | `ocr_intake_region` | OCR one user-drawn rectangle of a stored scan with field-aware settings (crop + upscale + contrast + single-line PSM + charset). The canvas calls this when the operator adjusts or draws a box. |
| DELETE | `/api/ocr/intake/{intake_id}` | `discard_intake` | Discard a pending scan (modal cancel / unsaved form), bytes and all. Idempotent. |

#### `app/routes/onboarding.py` — 7 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/onboarding/{emp_id}` | `get_checklist` | Return an employee's onboarding checklist, seeding it on first access. |
| POST | `/api/onboarding/{emp_id}/seed` | `seed_checklist` | _Seed checklist_ |
| POST | `/api/onboarding/tasks` | `create_task` | _Create task_ |
| PUT | `/api/onboarding/tasks/{task_id}` | `update_task` | _Update task_ |
| POST | `/api/onboarding/tasks/{task_id}/complete` | `complete_task` | _Complete task_ |
| GET | `/api/onboarding/{emp_id}/new-hire-report` | `new_hire_report` | State new-hire report data — must be filed within 20 days of hire. |
| GET | `/api/onboarding/{emp_id}/new-hire-report/pdf` | `new_hire_report_pdf` | _New hire report pdf_ |

#### `app/routes/opening_balances.py` — 2 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/opening-balances/status` | `status` | _Status_ |
| POST | `/api/opening-balances` | `create_opening_balances` | _Create opening balances_ |

#### `app/routes/payments.py` — 5 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/payments` | `list_payments` | _List payments_ |
| GET | `/api/payments/{payment_id}` | `get_payment` | _Get payment_ |
| POST | `/api/payments` | `create_payment` | _Create payment_ |
| POST | `/api/payments/{payment_id}/apply` | `apply_payment` | Apply the unapplied part of an earlier payment — an overpayment, a prepayment, or a payment recorded without choosing invoices — to the same customer's open invoices. |
| POST | `/api/payments/{payment_id}/void` | `void_payment` | Void a payment — reverses journal entry and restores invoice balances |

#### `app/routes/payroll/exports.py` — 2 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/payroll/{run_id}/paystub/{stub_id}` | `download_paystub` | Generate the PDF pay stub for one employee on a pay run. |
| POST | `/api/payroll/{run_id}/nacha` | `export_nacha` | Generate a NACHA ACH file for direct deposit of a processed pay run. |

#### `app/routes/payroll/runs.py` — 5 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/payroll` | `list_pay_runs` | _List pay runs_ |
| GET | `/api/payroll/{run_id}` | `get_pay_run` | _Get pay run_ |
| POST | `/api/payroll` | `create_pay_run` | _Create pay run_ |
| POST | `/api/payroll/{run_id}/process` | `process_pay_run` | Process a pay run — posts the payroll journal entry. |
| POST | `/api/payroll/gross-up` | `gross_up_paycheck` | Net-to-gross: reverse-solve the gross pay that yields a target take-home. |

#### `app/routes/payroll/states.py` — 1 operation

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/payroll/states` | `payroll_states` | Every supported state + DC: method, summary, deductions, other items, SUTA base, the publication the figures came from. |

#### `app/routes/payroll/tax_forms.py` — 12 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| POST | `/api/payroll/forms/w2/{emp_id}` | `generate_w2_form` | Generate W-2 form PDF for an employee for the given year. |
| POST | `/api/payroll/forms/w3/{year}` | `generate_w3_form` | Generate W-3 form (summary of all W-2s) for the given year. |
| POST | `/api/payroll/forms/940/{year}` | `generate_form_940` | Generate Form 940 (FUTA) for the given year. |
| POST | `/api/payroll/forms/941/{year}/{quarter}` | `generate_form_941` | Generate Form 941 (quarterly FICA) for the given year and quarter. |
| GET | `/api/payroll/forms/w2/{emp_id}/pdf` | `generate_w2_form_pdf` | W-2 PDF for one employee for the given calendar year. |
| POST | `/api/payroll/forms/w2/{emp_id}/pdf` | `generate_w2_form_pdf` | W-2 PDF for one employee for the given calendar year. |
| GET | `/api/payroll/forms/w3/{year}/pdf` | `generate_w3_form_pdf` | W-3 transmittal PDF — aggregate across every W-2 for the year. |
| POST | `/api/payroll/forms/w3/{year}/pdf` | `generate_w3_form_pdf` | W-3 transmittal PDF — aggregate across every W-2 for the year. |
| GET | `/api/payroll/forms/940/{year}/pdf` | `generate_form_940_pdf` | Form 940 (FUTA) PDF for the given calendar year. |
| POST | `/api/payroll/forms/940/{year}/pdf` | `generate_form_940_pdf` | Form 940 (FUTA) PDF for the given calendar year. |
| GET | `/api/payroll/forms/941/{year}/{quarter}/pdf` | `generate_form_941_pdf` | Form 941 (quarterly FICA) PDF for year + quarter. |
| POST | `/api/payroll/forms/941/{year}/{quarter}/pdf` | `generate_form_941_pdf` | Form 941 (quarterly FICA) PDF for year + quarter. |

#### `app/routes/portal.py` — 19 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/portal/` | `portal_dashboard` | _Portal dashboard_ |
| GET | `/portal/paystubs` | `portal_paystubs` | _Portal paystubs_ |
| GET | `/portal/profile` | `portal_profile` | _Portal profile_ |
| POST | `/portal/profile` | `portal_profile_save` | _Portal profile save_ |
| GET | `/portal/bank` | `portal_bank` | _Portal bank_ |
| POST | `/portal/bank` | `portal_bank_add` | _Portal bank add_ |
| GET | `/portal/pto` | `portal_pto` | _Portal pto_ |
| POST | `/portal/pto` | `portal_pto_request` | _Portal pto request_ |
| POST | `/portal/logout` | `portal_logout` | Clear the portal cookie and send the employee somewhere neutral. |
| GET | `/portal/favicon.ico` | `portal_favicon` | Serve the employer's company logo as the portal favicon. |
| GET | `/portal/logo` | `portal_logo` | The logo in the portal's header (the employee has no app session to fetch /api/uploads/logo/<id> with). |
| GET | `/portal/{token}` | `portal_claim_dashboard` | _Portal claim dashboard_ |
| GET | `/portal/{token}/paystubs` | `portal_claim_paystubs` | _Portal claim paystubs_ |
| GET | `/portal/{token}/profile` | `portal_claim_profile` | _Portal claim profile_ |
| GET | `/portal/{token}/bank` | `portal_claim_bank` | _Portal claim bank_ |
| GET | `/portal/{token}/pto` | `portal_claim_pto` | _Portal claim pto_ |
| POST | `/portal/{token}/profile` | `portal_claim_profile_save` | _Portal claim profile save_ |
| POST | `/portal/{token}/bank` | `portal_claim_bank_add` | _Portal claim bank add_ |
| POST | `/portal/{token}/pto` | `portal_claim_pto_request` | _Portal claim pto request_ |

#### `app/routes/preferences.py` — 3 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/preferences/{key}` | `get_preference` | _Get preference_ |
| PUT | `/api/preferences/{key}` | `put_preference` | _Put preference_ |
| DELETE | `/api/preferences/{key}` | `delete_preference` | Back to the default for this user. |

#### `app/routes/provider_payments.py` — 5 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| POST | `/api/payments/{provider_name}/create-checkout-session` | `create_checkout` | Create a hosted checkout for an invoice (public; token = capability). |
| POST | `/api/payments/{provider_name}/webhook` | `provider_webhook` | Handle a provider webhook. Signature verification IS the auth. |
| POST | `/api/payments/{provider_name}/check-status/{invoice_id}` | `check_status` | Poll the provider for a checkout's state and record it if paid. |
| GET | `/api/payments/payment-link/{invoice_id}` | `get_payment_link` | Get the public payment URL for an invoice (provider-agnostic). |
| POST | `/api/stripe/webhook` | `legacy_stripe_webhook` | _Legacy stripe webhook_ |

#### `app/routes/pto.py` — 14 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/pto/policies` | `list_policies` | _List policies_ |
| GET | `/api/pto/policies/{policy_id}` | `get_policy` | _Get policy_ |
| PUT | `/api/pto/policies/{policy_id}` | `update_policy` | _Update policy_ |
| POST | `/api/pto/policies` | `create_policy` | _Create policy_ |
| GET | `/api/pto/accruals` | `list_accruals` | _List accruals_ |
| POST | `/api/pto/accruals` | `create_accrual` | _Create accrual_ |
| POST | `/api/pto/accruals/{accrual_id}/accrue` | `run_accrual` | Apply one accrual cycle (a pay period, or an annual grant) to a balance. Hours actually added (after the max-balance cap) are valued at the employee's current rate and, when the policy books a liability, posted DR PTO… |
| POST | `/api/pto/accruals/{accrual_id}/revalue` | `revalue_accrual` | Restate the bank's dollars at hours × the employee's current rate (after a raise). Posts the difference to the PTO liability. |
| GET | `/api/pto/requests` | `list_requests` | _List requests_ |
| POST | `/api/pto/requests` | `create_request` | _Create request_ |
| POST | `/api/pto/requests/{request_id}/decision` | `decide_request` | _Decide request_ |
| POST | `/api/pto/requests/{request_id}/approve` | `approve_request` | _Approve request_ |
| POST | `/api/pto/requests/{request_id}/reject` | `reject_request` | _Reject request_ |
| POST | `/api/pto/accruals/year-end-carryover` | `year_end_carryover` | Apply each policy's max_carryover cap to every accrual balance and reset accrued_ytd / used_ytd to zero. Returns a per-row summary so the operator can see what changed and which balances were capped. |

#### `app/routes/public.py` — 1 operation

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/pay/{token}` | `public_payment_page` | Public invoice payment page — no auth required. |

#### `app/routes/purchase_orders.py` — 7 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/purchase-orders` | `list_pos` | _List pos_ |
| GET | `/api/purchase-orders/{po_id}` | `get_po` | _Get po_ |
| POST | `/api/purchase-orders` | `create_po` | _Create po_ |
| PUT | `/api/purchase-orders/{po_id}` | `update_po` | _Update po_ |
| GET | `/api/purchase-orders/{po_id}/pdf` | `po_pdf` | The purchase order as a PDF, to send to the vendor. A PO could be created and turned into a bill, but never seen or sent (skytech W-L19). |
| GET | `/api/purchase-orders/{po_id}/print-preview` | `po_print_preview` | The purchase order as a page that opens the print dialog. |
| POST | `/api/purchase-orders/{po_id}/convert-to-bill` | `convert_to_bill` | Convert a PO to a bill — creates bill with PO's line items AND the corresponding double-entry journal + inventory movements. |

#### `app/routes/qbo.py` — 11 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/qbo/auth-url` | `get_auth_url` | Generate the Intuit OAuth authorization URL. |
| POST | `/api/qbo/connect-manual` | `connect_manual` | Redeem an authorization code supplied by an authenticated admin. |
| GET | `/api/qbo/callback` | `oauth_callback` | Handle OAuth redirect from Intuit. Exchanges code for tokens. |
| POST | `/api/qbo/disconnect` | `disconnect` | Clear stored QBO tokens and disconnect. The administrator's, as connecting is: a bookkeeper could disconnect the company and not connect it again. |
| GET | `/api/qbo/status` | `get_status` | Get QBO connection status. Never returns raw tokens. |
| POST | `/api/qbo/import-runs` | `start_import_run` | _Start import run_ |
| GET | `/api/qbo/import-runs/latest` | `latest_import_run` | _Latest import run_ |
| POST | `/api/qbo/import` | `import_all` | Import all entity types from QBO in dependency order. |
| POST | `/api/qbo/import/{entity}` | `import_entity` | Import a single entity type from QBO. |
| POST | `/api/qbo/export` | `export_all` | Export all entity types to QBO in dependency order. |
| POST | `/api/qbo/export/{entity}` | `export_entity` | Export a single entity type to QBO. |

#### `app/routes/recurring.py` — 6 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/recurring` | `list_recurring` | _List recurring_ |
| GET | `/api/recurring/{rec_id}` | `get_recurring` | _Get recurring_ |
| POST | `/api/recurring` | `create_recurring` | _Create recurring_ |
| PUT | `/api/recurring/{rec_id}` | `update_recurring` | _Update recurring_ |
| DELETE | `/api/recurring/{rec_id}` | `delete_recurring` | _Delete recurring_ |
| POST | `/api/recurring/generate` | `generate_now` | Manually trigger generation of all due recurring invoices — one installment per template per call. `as_of` (default today) lets a catch-up or a test run generate a past installment deterministically. |

#### `app/routes/reports/donors.py` — 3 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/reports/pledges` | `pledges` | _Pledges_ |
| GET | `/api/reports/pledges/pdf` | `pledges_pdf` | _Pledges pdf_ |
| GET | `/api/reports/pledges/csv` | `pledges_csv` | _Pledges csv_ |

#### `app/routes/reports/financial.py` — 17 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/reports/profit-loss` | `profit_loss` | _Profit loss_ |
| GET | `/api/reports/balance-sheet` | `balance_sheet` | _Balance sheet_ |
| GET | `/api/reports/general-ledger` | `general_ledger` | General Ledger detail report. |
| GET | `/api/reports/account-transactions` | `account_transactions` | Phase 11: drill-down support. Every journal entry line hitting a given account in the date range, with source document linkage so the UI can jump from a P&L row straight to the underlying invoice/bill/JE. The register… |
| GET | `/api/reports/trial-balance` | `trial_balance` | Trial Balance: sum all debits/credits per account for a date range. |
| GET | `/api/reports/cash-flow` | `cash_flow` | Statement of cash flows, indirect method: net income, non-cash adjustments (depreciation), changes in working capital, then investing and financing; the net change is the change in the bank accounts (app/services/cash… |
| GET | `/api/reports/profit-loss-by-class` | `profit_loss_by_class` | P&L split by the class dimension on each posted line. |
| GET | `/api/reports/job-profitability` | `job_profitability_report` | Income, costs and margin per job from posted lines. |
| GET | `/api/reports/profit-loss/pdf` | `profit_loss_pdf` | _Profit loss pdf_ |
| GET | `/api/reports/trial-balance/pdf` | `trial_balance_pdf` | _Trial balance pdf_ |
| GET | `/api/reports/trial-balance/csv` | `trial_balance_csv_route` | _Trial balance csv route_ |
| GET | `/api/reports/general-ledger/pdf` | `general_ledger_pdf` | _General ledger pdf_ |
| GET | `/api/reports/general-ledger/csv` | `general_ledger_csv_route` | _General ledger csv route_ |
| GET | `/api/reports/profit-loss/csv` | `profit_loss_csv_route` | _Profit loss csv route_ |
| GET | `/api/reports/balance-sheet/csv` | `balance_sheet_csv_route` | _Balance sheet csv route_ |
| GET | `/api/reports/balance-sheet/pdf` | `balance_sheet_pdf` | _Balance sheet pdf_ |
| GET | `/api/reports/financial-statements/pdf` | `financial_statements_pdf` | The statements pack: P&L, Balance Sheet, and Trial Balance in one audit-ready document (each statement on its own page). |

#### `app/routes/reports/nonprofit.py` — 12 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/reports/statement-of-financial-position` | `statement_of_financial_position` | _Statement of financial position_ |
| GET | `/api/reports/statement-of-financial-position/pdf` | `statement_of_financial_position_pdf` | _Statement of financial position pdf_ |
| GET | `/api/reports/statement-of-financial-position/csv` | `statement_of_financial_position_csv` | _Statement of financial position csv_ |
| GET | `/api/reports/statement-of-activities` | `statement_of_activities` | _Statement of activities_ |
| GET | `/api/reports/statement-of-activities/pdf` | `statement_of_activities_pdf` | _Statement of activities pdf_ |
| GET | `/api/reports/statement-of-activities/csv` | `statement_of_activities_csv` | _Statement of activities csv_ |
| GET | `/api/reports/fund-balances` | `fund_balances` | _Fund balances_ |
| GET | `/api/reports/fund-balances/pdf` | `fund_balances_pdf` | _Fund balances pdf_ |
| GET | `/api/reports/fund-balances/csv` | `fund_balances_csv` | _Fund balances csv_ |
| GET | `/api/reports/functional-expenses` | `functional_expenses` | _Functional expenses_ |
| GET | `/api/reports/functional-expenses/pdf` | `functional_expenses_pdf` | _Functional expenses pdf_ |
| GET | `/api/reports/functional-expenses/csv` | `functional_expenses_csv` | _Functional expenses csv_ |

#### `app/routes/reports/payables_tax.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/reports/sales-tax` | `sales_tax_report` | Sales Tax report: the tax charged on sales less the tax given back on credit memos, in the company's currency, checked against Sales Tax Payable (2200). |
| POST | `/api/reports/sales-tax/pay` | `pay_sales_tax` | Record a sales tax payment — DR Sales Tax Payable, CR Bank Account |
| GET | `/api/reports/ap-aging` | `ap_aging` | AP Aging report — mirrors AR aging but for bills. |
| GET | `/api/reports/1099-summary` | `report_1099_summary` | 1099 Summary: total payments to 1099 vendors for a year. |

#### `app/routes/reports/receivables.py` — 5 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/reports/ar-aging` | `ar_aging` | What each customer owes, by age, in home currency — and net of the credits they hold, so the total is what account 1100 says. |
| GET | `/api/reports/income-by-customer` | `income_by_customer` | Income by Customer: invoices dated in the period, in home currency. |
| GET | `/api/reports/customer-statement/{customer_id}/pdf` | `customer_statement_pdf` | Customer statement PDF. |
| POST | `/api/reports/batch-email-statements` | `batch_email_statements` | Email a statement to every customer with an overdue invoice. |
| POST | `/api/reports/collection-letters` | `collection_letters` | Generate and optionally email collection letters. |

#### `app/routes/reseller_permits.py` — 8 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/reseller-permits/validate-format` | `validate_format` | Lightweight format check. Same rules as the SPA's inline hint, but callable from scripts or third-party tooling that wants the canonical answer. |
| GET | `/api/reseller-permits` | `list_permits` | List permits with optional filters. Most common SPA call is `?entity_type=customer&entity_id=X` to show the customer's permits. |
| GET | `/api/reseller-permits/expiring` | `expiring_permits` | Permits expiring within N days — powers the dashboard reminder. |
| GET | `/api/reseller-permits/{permit_id}` | `get_permit` | _Get permit_ |
| POST | `/api/reseller-permits` | `create_permit` | _Create permit_ |
| PUT | `/api/reseller-permits/{permit_id}` | `update_permit` | _Update permit_ |
| DELETE | `/api/reseller-permits/{permit_id}` | `delete_permit` | _Delete permit_ |
| POST | `/api/reseller-permits/{permit_id}/mark-verified` | `mark_verified` | Record that the operator just verified this permit against the official state lookup. Stamps `last_verified_at = now` and saves the free-form `verified_by` note (operator name, ticket number, etc.). |

#### `app/routes/sales_receipts.py` — 2 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/sales-receipts` | `list_sales_receipts` | Sales receipts are invoices paid on the spot; this is the invoice list filtered to them, so an API client (or agent) can enumerate receipts without knowing the flag. Found missing by the BYO-AI seed. |
| POST | `/api/sales-receipts` | `create_sales_receipt` | _Create sales receipt_ |

#### `app/routes/saved_reports.py` — 5 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/saved-reports` | `list_saved_reports` | _List saved reports_ |
| POST | `/api/saved-reports` | `create_saved_report` | _Create saved report_ |
| GET | `/api/saved-reports/{report_id}` | `get_saved_report` | _Get saved report_ |
| PUT | `/api/saved-reports/{report_id}` | `update_saved_report` | _Update saved report_ |
| DELETE | `/api/saved-reports/{report_id}` | `delete_saved_report` | _Delete saved report_ |

#### `app/routes/search.py` — 1 operation

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/search` | `unified_search` | _Unified search_ |

#### `app/routes/settings.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/settings` | `get_settings` | Every company setting, secrets redacted. |
| GET | `/api/settings/unreadable-secrets` | `get_unreadable_secrets` | Settings saved encrypted under a key this install no longer has. |
| PUT | `/api/settings` | `update_settings` | _Update settings_ |
| POST | `/api/settings/test-email` | `test_email` | Feature 8: Send a test email to verify SMTP settings. |

#### `app/routes/simplefin.py` — 5 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/simplefin/status` | `status` | _Status_ |
| POST | `/api/simplefin/claim` | `claim` | Exchange a one-time setup token for the permanent access URL. |
| POST | `/api/simplefin/map` | `save_mapping` | Store which bridge account feeds which SlowBooks bank account. |
| POST | `/api/simplefin/sync` | `sync` | Pull transactions for every mapped account through dedup + rules. With history_months, from that many months back to today, fetched in slices the SimpleFIN Bridge accepts. |
| POST | `/api/simplefin/disconnect` | `disconnect` | Forget the access URL, mapping, and cache. Imported rows stay. |

#### `app/routes/system.py` — 2 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/system` | `system_info` | _System info_ |
| GET | `/api/system/update-check` | `update_check` | _Update check_ |

#### `app/routes/tax.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/tax/schedule-c` | `schedule_c_report` | _Schedule c report_ |
| GET | `/api/tax/schedule-c/csv` | `schedule_c_csv` | _Schedule c csv_ |
| GET | `/api/tax/mappings` | `list_mappings` | _List mappings_ |
| POST | `/api/tax/mappings` | `create_mapping` | _Create mapping_ |

#### `app/routes/tax_forms.py` — 12 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/tax-forms/941` | `get_941` | _Get 941_ |
| GET | `/api/tax-forms/941/pdf` | `get_941_pdf` | _Get 941 pdf_ |
| GET | `/api/tax-forms/940` | `get_940` | _Get 940_ |
| GET | `/api/tax-forms/940/pdf` | `get_940_pdf` | _Get 940 pdf_ |
| GET | `/api/tax-forms/w2` | `get_all_w2` | _Get all w2_ |
| GET | `/api/tax-forms/w2/{employee_id}` | `get_w2` | _Get w2_ |
| GET | `/api/tax-forms/w2/{employee_id}/pdf` | `get_w2_pdf` | _Get w2 pdf_ |
| GET | `/api/tax-forms/sui` | `get_sui` | _Get sui_ |
| GET | `/api/tax-forms/liability` | `get_tax_liability` | What payroll tax is owed for the quarter, and when it is due. |
| GET | `/api/tax-forms/1099` | `get_1099` | _Get 1099_ |
| GET | `/api/tax-forms/1099/{vendor_id}/pdf` | `get_1099_pdf` | _Get 1099 pdf_ |
| GET | `/api/tax-forms/1096/pdf` | `get_1096_pdf` | _Get 1096 pdf_ |

#### `app/routes/time_entries.py` — 11 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| POST | `/api/time-entries/post-to-job` | `post_entries_to_job` | Post several approved time entries to their jobs as labor cost (one Job Cost Entry each). Returns per-entry results; nothing is rolled back for a single failure, so the caller sees exactly what posted. |
| GET | `/api/time-entries` | `list_time_entries` | _List time entries_ |
| POST | `/api/time-entries` | `create_time_entry` | _Create time entry_ |
| PUT | `/api/time-entries/{entry_id}` | `update_time_entry` | _Update time entry_ |
| DELETE | `/api/time-entries/{entry_id}` | `delete_time_entry` | _Delete time entry_ |
| POST | `/api/time-entries/{entry_id}/submit` | `submit_time_entry` | _Submit time entry_ |
| POST | `/api/time-entries/{entry_id}/approve` | `approve_time_entry` | _Approve time entry_ |
| POST | `/api/time-entries/{entry_id}/post-to-job` | `post_entry_to_job` | Post one approved time entry to its job as labor cost at the employee's loaded rate, with burden as its own line. |
| POST | `/api/time-entries/{entry_id}/reject` | `reject_time_entry` | _Reject time entry_ |
| POST | `/api/time-entries/classify` | `classify_hours` | Run the overtime engine over raw daily hours (FLSA + state overrides). |
| GET | `/api/time-entries/summary` | `pay_period_summary` | Hours-by-employee summary for an upcoming pay period. |

#### `app/routes/transfers.py` — 3 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/transfers` | `list_transfers` | _List transfers_ |
| POST | `/api/transfers` | `create_transfer` | _Create transfer_ |
| POST | `/api/transfers/{transfer_id}/void` | `void_transfer` | _Void transfer_ |

#### `app/routes/uploads.py` — 6 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| POST | `/api/uploads/logo` | `upload_logo` | _Upload logo_ |
| GET | `/api/uploads/logo` | `logo_info` | The current logo's address and where it came from: Settings says so when the upgrade copied it in from the folder every company shared. |
| DELETE | `/api/uploads/logo` | `remove_logo` | _Remove logo_ |
| GET | `/api/uploads/logo/{file_id}` | `logo_image` | The logo image, from this company's own database. |
| GET | `/api/uploads/legacy` | `legacy_folder` | What the folder releases before 2.18.0 kept every company's uploads in still holds, and which companies still have to copy their files from it: {"files", "bytes", "pending_companies", "can_remove"}. |
| DELETE | `/api/uploads/legacy` | `remove_legacy_folder` | Delete the files in that folder, once no company still needs them. Each company keeps its own copies in its own database. |

#### `app/routes/users.py` — 3 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/users` | `list_users` | _List users_ |
| POST | `/api/users` | `create_user` | _Create user_ |
| PUT | `/api/users/{user_id}` | `update_user` | _Update user_ |

#### `app/routes/vendor_credits.py` — 5 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/vendor-credits` | `list_vendor_credits` | _List vendor credits_ |
| GET | `/api/vendor-credits/{vc_id}` | `get_vendor_credit` | _Get vendor credit_ |
| POST | `/api/vendor-credits` | `create_vendor_credit` | _Create vendor credit_ |
| POST | `/api/vendor-credits/{vc_id}/apply` | `apply_vendor_credit` | Settle part of a bill with a credit the vendor already gave you. |
| POST | `/api/vendor-credits/{vc_id}/void` | `void_vendor_credit` | Reverse a vendor credit: put every application back on its bill, post the mirror-image entry, put returned stock back on the shelf, and mark it void. |

#### `app/routes/vendors.py` — 6 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/api/vendors` | `list_vendors` | _List vendors_ |
| GET | `/api/vendors/check-duplicate` | `check_duplicate` | Phase 11: standalone duplicate-check endpoint for pre-submit UI warnings. |
| GET | `/api/vendors/{vendor_id}` | `get_vendor` | _Get vendor_ |
| POST | `/api/vendors` | `create_vendor` | _Create vendor_ |
| PUT | `/api/vendors/{vendor_id}` | `update_vendor` | _Update vendor_ |
| DELETE | `/api/vendors/{vendor_id}` | `delete_vendor` | _Delete vendor_ |

#### `app/main.py` — 4 operations

| Method | Path | Handler | Summary |
|---|---|---|---|
| GET | `/favicon.ico` | `favicon` | _Favicon_ |
| GET | `/health` | `health_check` | Liveness probe. Always on, no auth. Used by load balancers, k8s probes, and uptime monitors. |
| GET | `/` | `serve_index` | _Serve index_ |
| GET | `/analytics` | `serve_analytics_redirect` | Backwards-compat: old /analytics bookmarks land on the SPA hash route. |

---

_[← 9. User Interface, Desktop Apps, Deployment & Engineering](09-ui-desktop-deployment-engineering.md) · [Index](README.md) · [Appendix B. Database schema →](appendix-b-database-schema.md)_
