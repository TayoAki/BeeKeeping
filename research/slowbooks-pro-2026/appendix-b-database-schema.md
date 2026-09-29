_SlowBooks Pro 2026 feature inventory — [← Appendix A. Complete API endpoint catalog](appendix-a-api-endpoints.md) · [Index](README.md) · [Appendix C. Printable documents & schema history →](appendix-c-documents-and-schema-history.md)_

## Appendix B. Database schema

Generated from the SQLAlchemy models in `app/models/*.py` with Python's `ast` module: **85 tables** and **29 enums**. Columns are listed in declaration order; `(PK)` marks the primary key, `→ table` a foreign key, and `(EnumName)` an enum-typed column. Money columns are `Numeric(15, 2)`; unit prices and rates carry four or more decimal places (see the migrations list in Appendix C). Schema changes ship as Alembic migrations under `migrations/versions/`.

#### `app/models/accounts.py`

- Enum **`AccountType`**: `asset`, `liability`, `equity`, `income`, `expense`, `cogs`
- **`accounts`** (`Account`, 12 columns)  
  `id` (PK), `name`, `account_number`, `account_type` (AccountType), `parent_id` → accounts, `description`, `is_active`, `is_system`, `balance`, `bank_kind`, `created_at`, `updated_at`

#### `app/models/api_tokens.py`

- **`api_tokens`** (`ApiToken`, 9 columns)  
  `id` (PK), `label`, `token_hash`, `token_hint`, `role`, `is_active`, `created_by`, `created_at`, `last_used_at`

#### `app/models/attachments.py`

- **`attachments`** (`Attachment`, 11 columns)  
  `id` (PK), `entity_type`, `entity_id`, `filename`, `file_path`, `mime_type`, `file_size`, `stored_file_id` → stored_files, `employee_id` → employees, `doc_category`, `uploaded_at`

#### `app/models/audit.py`

- **`audit_log`** (`AuditLog`, 10 columns)  
  `id` (PK), `table_name`, `record_id`, `action`, `old_values`, `new_values`, `changed_fields`, `timestamp`, `source`, `username`

#### `app/models/auth.py`

- **`login_attempts`** (`LoginAttempt`, 5 columns)  
  `id` (PK), `created_at`, `ip`, `user_agent`, `success`

#### `app/models/backups.py`

- **`backups`** (`Backup`, 6 columns)  
  `id` (PK), `filename`, `file_size`, `backup_type`, `notes`, `created_at`

#### `app/models/bank_accounts.py`

- Enum **`BankAccountKind`**: `checking`, `savings`
- Enum **`DepositType`**: `full`, `percent`, `fixed`, `remainder`
- Enum **`PrenoteStatus`**: `not_sent`, `pending`, `confirmed`
- **`employee_bank_accounts`** (`EmployeeBankAccount`, 14 columns)  
  `id` (PK), `employee_id` → employees, `nickname`, `account_kind` (BankAccountKind), `routing_number_enc`, `account_number_enc`, `account_last_four`, `deposit_type` (DepositType), `deposit_value`, `priority`, `prenote_status` (PrenoteStatus), `prenote_sent_date`, `is_active`, `created_at`

#### `app/models/bank_rules.py`

- **`bank_rules`** (`BankRule`, 9 columns)  
  `id` (PK), `name`, `pattern`, `account_id` → accounts, `vendor_id` → vendors, `rule_type`, `priority`, `is_active`, `created_at`

#### `app/models/banking.py`

- Enum **`ReconciliationStatus`**: `in_progress`, `completed`
- **`bank_accounts`** (`BankAccount`, 9 columns)  
  `id` (PK), `name`, `account_id` → accounts, `bank_name`, `last_four`, `legacy_balance`, `is_active`, `created_at`, `updated_at`
- **`bank_transactions`** (`BankTransaction`, 15 columns)  
  `id` (PK), `bank_account_id` → bank_accounts, `date`, `amount`, `payee`, `description`, `check_number`, `category_account_id` → accounts, `reconciled`, `transaction_id` → transactions, `transaction_line_id` → transaction_lines, `import_id`, `import_source`, `match_status`, `created_at`
- **`reconciliations`** (`Reconciliation`, 10 columns)  
  `id` (PK), `account_id` → accounts, `bank_account_id` → bank_accounts, `statement_date`, `statement_balance`, `beginning_balance`, `cleared_total`, `status` (ReconciliationStatus), `created_at`, `completed_at`

#### `app/models/benefits.py`

- **`benefit_codes`** (`BenefitCode`, 23 columns)  
  `id` (PK), `code`, `name`, `kind`, `category`, `calc_method`, `employer_calc_method`, `reduces_federal`, `reduces_state`, `reduces_fica`, `employer_taxable`, `sequence`, `expense_account_id` → accounts, `liability_account_id` → accounts, `remittance_vendor_id` → vendors, `burden_routing`, `tracks_balance`, `effective_from`, `effective_to`, `is_active`, `notes`, `created_at`, `updated_at`
- **`benefit_rates`** (`BenefitRate`, 13 columns) — One dated row of rates and limits. Limits are plural on purpose: a per-period cap, an annual cap and a wage-base ceiling are three different rules and a code commonly needs all three.  
  `id` (PK), `benefit_code_id` → benefit_codes, `effective_from`, `effective_to`, `employee_rate`, `employer_rate`, `per_period_cap`, `annual_cap`, `wage_base_ceiling`, `employer_annual_cap`, `employer_match_limit_pct`, `tiers_json`, `created_at`
- **`employee_groups`** (`EmployeeGroup`, 6 columns)  
  `id` (PK), `name`, `description`, `is_active`, `created_at`, `updated_at`
- **`employee_group_benefits`** (`EmployeeGroupBenefit`, 7 columns)  
  `id` (PK), `group_id` → employee_groups, `benefit_code_id` → benefit_codes, `employee_rate`, `employer_rate`, `per_period_cap`, `annual_cap`
- **`employee_benefits`** (`EmployeeBenefit`, 14 columns)  
  `id` (PK), `employee_id` → employees, `benefit_code_id` → benefit_codes, `employee_rate`, `employer_rate`, `per_period_cap`, `annual_cap`, `balance_remaining`, `start_date`, `end_date`, `is_active`, `notes`, `created_at`, `updated_at`
- **`benefit_ytd`** (`BenefitYTD`, 7 columns)  
  `id` (PK), `employee_id` → employees, `benefit_code_id` → benefit_codes, `year`, `employee_amount`, `employer_amount`, `updated_at`
- **`pay_stub_benefits`** (`PayStubBenefit`, 21 columns)  
  `id` (PK), `pay_stub_id` → pay_stubs, `benefit_code_id` → benefit_codes, `code`, `name`, `kind`, `category`, `sequence`, `calc_method`, `employee_rate`, `employer_rate`, `reduces_federal`, `reduces_state`, `reduces_fica`, `expense_account_id` → accounts, `liability_account_id` → accounts, `remittance_vendor_id` → vendors, `burden_routing`, `rule_json`, `employee_amount`, `employer_amount`

#### `app/models/bills.py`

- Enum **`BillStatus`**: `draft`, `unpaid`, `partial`, `paid`, `void`
- **`bills`** (`Bill`, 23 columns)  
  `id` (PK), `bill_number`, `vendor_id` → vendors, `status` (BillStatus), `po_id` → purchase_orders, `date`, `due_date`, `terms`, `ref_number`, `subtotal`, `tax_rate`, `tax_amount`, `total`, `amount_paid`, `balance_due`, `notes`, `transaction_id` → transactions, `class_id` → classes, `job_id` → jobs, `currency`, `exchange_rate`, `created_at`, `updated_at`
- **`bill_lines`** (`BillLine`, 15 columns)  
  `id` (PK), `bill_id` → bills, `item_id` → items, `account_id` → accounts, `description`, `quantity`, `rate`, `amount`, `job_id` → jobs, `class_id` → classes, `cost_code_id` → cost_codes, `function`, `is_billable`, `billed_invoice_line_id` → invoice_lines, `line_order`
- **`bill_payments`** (`BillPayment`, 13 columns)  
  `id` (PK), `vendor_id` → vendors, `date`, `amount`, `method`, `check_number`, `pay_from_account_id` → accounts, `notes`, `currency`, `exchange_rate`, `transaction_id` → transactions, `is_voided`, `created_at`
- **`bill_payment_allocations`** (`BillPaymentAllocation`, 4 columns)  
  `id` (PK), `bill_payment_id` → bill_payments, `bill_id` → bills, `amount`

#### `app/models/budgets.py`

- **`budgets`** (`Budget`, 7 columns)  
  `id` (PK), `account_id` → accounts, `year`, `month`, `amount`, `created_at`, `updated_at`

#### `app/models/classes.py`

- **`classes`** (`TxnClass`, 10 columns)  
  `id` (PK), `name`, `is_archived`, `is_system_default`, `restriction`, `default_function`, `donor_name`, `purpose`, `created_at`, `updated_at`

#### `app/models/companies.py`

- **`companies`** (`Company`, 7 columns)  
  `id` (PK), `name`, `database_name`, `description`, `last_accessed`, `is_active`, `created_at`

#### `app/models/contacts.py`

- **`customers`** (`Customer`, 32 columns)  
  `id` (PK), `name`, `company`, `email`, `phone`, `mobile`, `fax`, `website`, `bill_address1`, `bill_address2`, `bill_city`, `bill_state`, `bill_zip`, `bill_country`, `ship_address1`, `ship_address2`, `ship_city`, `ship_state`, `ship_zip`, `ship_country`, `terms`, `credit_limit`, `tax_id`, `is_taxable`, `notes`, `is_active`, `balance`, `donor_type`, `salutation`, `send_year_end_statement`, `created_at`, `updated_at`
- **`vendors`** (`Vendor`, 27 columns)  
  `id` (PK), `name`, `company`, `email`, `phone`, `fax`, `website`, `address1`, `address2`, `city`, `state`, `zip`, `country`, `terms`, `tax_id`, `account_number`, `default_expense_account_id` → accounts, `is_1099_vendor`, `vendor_1099_type`, `is_1099_eligible`, `w9_on_file`, `w9_document_id` → attachments, `notes`, `is_active`, `balance`, `created_at`, `updated_at`

#### `app/models/cost_codes.py`

- **`cost_codes`** (`CostCode`, 10 columns)  
  `id` (PK), `code`, `name`, `cost_type`, `account_id` → accounts, `parent_id` → cost_codes, `notes`, `is_active`, `created_at`, `updated_at`

#### `app/models/credit_memos.py`

- Enum **`CreditMemoStatus`**: `draft`, `issued`, `applied`, `void`
- **`credit_memos`** (`CreditMemo`, 19 columns)  
  `id` (PK), `memo_number`, `customer_id` → customers, `status` (CreditMemoStatus), `original_invoice_id` → invoices, `date`, `subtotal`, `tax_rate`, `tax_amount`, `total`, `amount_applied`, `balance_remaining`, `notes`, `transaction_id` → transactions, `class_id` → classes, `is_write_off`, `job_id` → jobs, `created_at`, `updated_at`
- **`credit_memo_lines`** (`CreditMemoLine`, 8 columns)  
  `id` (PK), `credit_memo_id` → credit_memos, `item_id` → items, `description`, `quantity`, `rate`, `amount`, `line_order`
- **`credit_applications`** (`CreditApplication`, 4 columns)  
  `id` (PK), `credit_memo_id` → credit_memos, `invoice_id` → invoices, `amount`

#### `app/models/deductions.py`

- Enum **`GarnishmentType`**: `child_support`, `federal_levy`, `state_tax_levy`, `student_loan`, `bankruptcy`, `creditor`
- Enum **`GarnishmentMethod`**: `fixed`, `percent_disposable`
- **`garnishment_orders`** (`GarnishmentOrder`, 11 columns)  
  `id` (PK), `employee_id` → employees, `garnishment_type` (GarnishmentType), `calc_method` (GarnishmentMethod), `amount`, `priority`, `case_number`, `supports_secondary_family`, `in_arrears_12_weeks`, `is_active`, `created_at`

#### `app/models/document_audit.py`

- **`document_audits`** (`DocumentAudit`, 5 columns)  
  `id` (PK), `doc_type`, `doc_key`, `content_hash`, `created_at`

#### `app/models/email_log.py`

- **`email_log`** (`EmailLog`, 8 columns)  
  `id` (PK), `entity_type`, `entity_id`, `recipient`, `subject`, `status`, `error_message`, `sent_at`

#### `app/models/email_templates.py`

- **`email_templates`** (`EmailTemplate`, 7 columns)  
  `id` (PK), `name`, `subject_template`, `body_template`, `template_type`, `created_at`, `updated_at`

#### `app/models/estimates.py`

- Enum **`EstimateStatus`**: `pending`, `accepted`, `rejected`, `converted`
- **`estimates`** (`Estimate`, 21 columns)  
  `id` (PK), `estimate_number`, `customer_id` → customers, `status` (EstimateStatus), `date`, `expiration_date`, `bill_address1`, `bill_address2`, `bill_city`, `bill_state`, `bill_zip`, `subtotal`, `tax_rate`, `tax_amount`, `total`, `notes`, `converted_invoice_id` → invoices, `class_id` → classes, `job_id` → jobs, `created_at`, `updated_at`
- **`estimate_lines`** (`EstimateLine`, 13 columns)  
  `id` (PK), `estimate_id` → estimates, `item_id` → items, `description`, `quantity`, `rate`, `amount`, `class_name`, `job_id` → jobs, `cost_code_id` → cost_codes, `unit_cost`, `is_taxable`, `line_order`

#### `app/models/fixed_assets.py`

- Enum **`FixedAssetStatus`**: `registered`, `disposed`
- Enum **`DepreciationMethod`**: `straight_line`, `declining_balance`
- **`fixed_asset_types`** (`FixedAssetType`, 12 columns)  
  `id` (PK), `name`, `description`, `asset_account_id` → accounts, `accumulated_depreciation_account_id` → accounts, `depreciation_expense_account_id` → accounts, `depreciation_method` (DepreciationMethod), `effective_life_years`, `annual_rate`, `is_active`, `created_at`, `updated_at`
- **`fixed_assets`** (`FixedAsset`, 15 columns)  
  `id` (PK), `asset_number`, `name`, `asset_type_id` → fixed_asset_types, `status` (FixedAssetStatus), `purchase_date`, `purchase_price`, `salvage_value`, `description`, `accumulated_depreciation`, `last_depreciation_date`, `disposal_date`, `disposal_proceeds`, `created_at`, `updated_at`

#### `app/models/hr.py`

- Enum **`OnboardingTaskType`**: `w4`, `i9_section1`, `i9_section2`, `everify`, `direct_deposit`, `state_new_hire_report`, `policy_acknowledgment`, `emergency_contact`
- Enum **`OnboardingTaskStatus`**: `pending`, `in_progress`, `complete`
- **`onboarding_tasks`** (`OnboardingTask`, 11 columns)  
  `id` (PK), `employee_id` → employees, `task_type` (OnboardingTaskType), `status` (OnboardingTaskStatus), `document_id` → attachments, `signed`, `signed_at`, `completed_at`, `completed_by`, `notes`, `created_at`

#### `app/models/in_kind.py`

- **`in_kind_gifts`** (`InKindGift`, 12 columns)  
  `id` (PK), `number`, `customer_id` → customers, `date`, `memo`, `status`, `transaction_id` → transactions, `total`, `class_id` → classes, `job_id` → jobs, `created_at`, `updated_at`
- **`in_kind_gift_lines`** (`InKindGiftLine`, 11 columns)  
  `id` (PK), `gift_id` → in_kind_gifts, `description`, `quantity`, `fair_value`, `amount`, `debit_account_id` → accounts, `credit_account_id` → accounts, `class_id` → classes, `job_id` → jobs, `line_order`

#### `app/models/invoices.py`

- Enum **`InvoiceStatus`**: `draft`, `sent`, `partial`, `paid`, `void`
- **`invoices`** (`Invoice`, 41 columns)  
  `id` (PK), `invoice_number`, `customer_id` → customers, `status` (InvoiceStatus), `date`, `due_date`, `terms`, `po_number`, `bill_address1`, `bill_address2`, `bill_city`, `bill_state`, `bill_zip`, `ship_address1`, `ship_address2`, `ship_city`, `ship_state`, `ship_zip`, `subtotal`, `tax_rate`, `tax_amount`, `total`, `amount_paid`, `balance_due`, `notes`, `transaction_id` → transactions, `payment_token`, `stripe_checkout_session_id`, `checkout_provider`, `checkout_external_id`, `class_id` → classes, `job_id` → jobs, `is_sales_receipt`, `currency`, `exchange_rate`, `is_pledge`, `fair_value_amount`, `fair_value_description`, `recurring_invoice_id` → recurring_invoices, `created_at`, `updated_at`
- **`invoice_lines`** (`InvoiceLine`, 13 columns)  
  `id` (PK), `invoice_id` → invoices, `item_id` → items, `description`, `quantity`, `rate`, `amount`, `class_name`, `job_id` → jobs, `class_id` → classes, `cost_code_id` → cost_codes, `is_taxable`, `line_order`

#### `app/models/items.py`

- Enum **`ItemType`**: `product`, `service`, `material`, `labor`
- Enum **`MovementType`**: `purchase`, `sale`, `adjustment`, `return_in`, `return_out`, `void`
- **`items`** (`Item`, 17 columns)  
  `id` (PK), `name`, `item_type` (ItemType), `description`, `rate`, `cost`, `income_account_id` → accounts, `expense_account_id` → accounts, `is_taxable`, `is_active`, `track_inventory`, `quantity_on_hand`, `reorder_point`, `avg_cost`, `asset_account_id` → accounts, `created_at`, `updated_at`
- **`inventory_movements`** (`InventoryMovement`, 13 columns) — Per-item ledger row. Every change to quantity_on_hand writes one of these, giving a full audit trail plus the ability to rebuild qty/avg_cost deterministically from history.  
  `id` (PK), `item_id` → items, `date`, `movement_type` (MovementType), `quantity`, `unit_cost`, `balance_qty`, `balance_avg_cost`, `source_type`, `source_id`, `transaction_id` → transactions, `memo`, `created_at`

#### `app/models/job_costing.py`

- **`cost_types`** (`CostType`, 13 columns)  
  `id` (PK), `code`, `name`, `is_labor`, `burden_pct`, `burden_method`, `default_account_id` → accounts, `offset_account_id` → accounts, `burden_offset_account_id` → accounts, `sort_order`, `is_active`, `created_at`, `updated_at`
- **`equipment`** (`Equipment`, 10 columns)  
  `id` (PK), `code`, `name`, `hourly_rate`, `cost_code_id` → cost_codes, `recovery_account_id` → accounts, `notes`, `is_active`, `created_at`, `updated_at`
- **`job_costs`** (`JobCost`, 11 columns)  
  `id` (PK), `number`, `date`, `job_id` → jobs, `memo`, `source`, `status`, `transaction_id` → transactions, `total`, `created_at`, `updated_at`
- **`job_cost_lines`** (`JobCostLine`, 17 columns)  
  `id` (PK), `job_cost_id` → job_costs, `job_id` → jobs, `cost_code_id` → cost_codes, `cost_type`, `description`, `quantity`, `rate`, `amount`, `debit_account_id` → accounts, `credit_account_id` → accounts, `employee_id` → employees, `equipment_id` → equipment, `time_entry_id` → time_entries, `is_burden`, `is_billable`, `line_order`
- **`job_budgets`** (`JobBudget`, 11 columns)  
  `id` (PK), `job_id` → jobs, `cost_code_id` → cost_codes, `cost_type`, `amount`, `revenue_amount`, `source`, `estimate_id` → estimates, `notes`, `created_at`, `updated_at`

#### `app/models/jobs.py`

- **`jobs`** (`Job`, 16 columns)  
  `id` (PK), `customer_id` → customers, `name`, `job_number`, `status`, `job_type`, `description`, `site_address`, `start_date`, `projected_end_date`, `end_date`, `contract_amount`, `notes`, `is_active`, `created_at`, `updated_at`

#### `app/models/nonprofit.py`

- **`restriction_releases`** (`RestrictionRelease`, 12 columns)  
  `id` (PK), `number`, `date`, `class_id` → classes, `amount`, `period_start`, `period_end`, `memo`, `status`, `transaction_id` → transactions, `created_at`, `updated_at`
- **`allocation_rules`** (`AllocationRule`, 9 columns)  
  `id` (PK), `name`, `basis`, `source_account_id` → accounts, `source_class_id` → classes, `notes`, `is_active`, `created_at`, `updated_at`
- **`allocation_rule_targets`** (`AllocationRuleTarget`, 7 columns)  
  `id` (PK), `rule_id` → allocation_rules, `class_id` → classes, `function`, `job_id` → jobs, `weight`, `line_order`
- **`functional_allocations`** (`FunctionalAllocation`, 12 columns)  
  `id` (PK), `number`, `date`, `rule_id` → allocation_rules, `period_start`, `period_end`, `memo`, `status`, `transaction_id` → transactions, `total`, `created_at`, `updated_at`
- **`functional_allocation_lines`** (`FunctionalAllocationLine`, 9 columns)  
  `id` (PK), `allocation_id` → functional_allocations, `account_id` → accounts, `class_id` → classes, `function`, `weight`, `amount`, `description`, `line_order`

#### `app/models/ocr_templates.py`

- **`ocr_templates`** (`OcrTemplate`, 7 columns)  
  `id` (PK), `merchant_key`, `merchant_name`, `fields_json`, `use_count`, `created_at`, `updated_at`

#### `app/models/payments.py`

- **`payments`** (`Payment`, 14 columns)  
  `id` (PK), `customer_id` → customers, `date`, `amount`, `method`, `check_number`, `reference`, `deposit_to_account_id` → accounts, `notes`, `transaction_id` → transactions, `is_voided`, `currency`, `exchange_rate`, `created_at`
- **`payment_allocations`** (`PaymentAllocation`, 4 columns)  
  `id` (PK), `payment_id` → payments, `invoice_id` → invoices, `amount`

#### `app/models/payroll.py`

- Enum **`PayType`**: `salary`, `hourly`
- Enum **`FilingStatus`**: `single`, `married`, `head_of_household`
- Enum **`PayFrequency`**: `weekly`, `biweekly`, `semi_monthly`, `monthly`
- Enum **`PayRunStatus`**: `draft`, `processed`, `void`
- Enum **`PayRunType`**: `regular`, `off_cycle`, `bonus`
- Enum **`EmployeeRole`**: `admin`, `manager`, `employee`
- **`employees`** (`Employee`, 46 columns)  
  `id` (PK), `first_name`, `last_name`, `ssn_last_four`, `pay_type` (PayType), `pay_rate`, `pay_frequency` (PayFrequency), `filing_status` (FilingStatus), `multiple_jobs`, `dependents_amount`, `other_income_annual`, `deductions_annual`, `extra_withholding`, `address1`, `address2`, `city`, `state`, `zip`, `work_state`, `residence_state`, `wc_class_code`, `state_allowances`, `state_extra_withholding`, `state_rate_override`, `local_tax_rate`, `cost_rate`, `burden_pct`, `employee_group_id` → employee_groups, `hire_date`, `is_active`, `notes`, `email`, `role` (EmployeeRole), `manager_id` → employees, `portal_token_retired`, `portal_token_hash`, `portal_token_enc`, `portal_token_last_used`, `portal_token_expires_at`, `everify_case_number`, `everify_status`, `everify_submitted_at`, `everify_closed_at`, `everify_notes`, `created_at`, `updated_at`
- **`pay_runs`** (`PayRun`, 14 columns)  
  `id` (PK), `period_start`, `period_end`, `pay_date`, `status` (PayRunStatus), `run_type` (PayRunType), `total_gross`, `total_net`, `total_taxes`, `total_employer_taxes`, `total_employer_benefits`, `transaction_id` → transactions, `burden_job_cost_id` → job_costs, `created_at`
- **`pay_stubs`** (`PayStub`, 26 columns)  
  `id` (PK), `pay_run_id` → pay_runs, `employee_id` → employees, `hours`, `regular_hours`, `overtime_hours`, `doubletime_hours`, `gross_pay`, `federal_tax`, `state_tax`, `state_other_employee`, `ss_tax`, `medicare_tax`, `pretax_deductions`, `posttax_deductions`, `garnishments`, `reimbursements`, `net_pay`, `work_state`, `employer_ss_tax`, `employer_medicare_tax`, `futa_tax`, `suta_tax`, `state_other_employer`, `employer_benefits`, `detail_json`

#### `app/models/portal_access.py`

- **`portal_accesses`** (`PortalAccess`, 7 columns)  
  `id` (PK), `employee_id` → employees, `created_at`, `ip`, `user_agent`, `path`, `success`

#### `app/models/preferences.py`

- **`user_preferences`** (`UserPreference`, 6 columns)  
  `id` (PK), `user_id` → users, `key`, `value`, `created_at`, `updated_at`

#### `app/models/pto.py`

- Enum **`PTOType`**: `vacation`, `sick`, `personal`
- Enum **`AccrualMethod`**: `per_hour_worked`, `per_pay_period`, `annual_grant`
- Enum **`PTORequestStatus`**: `pending`, `approved`, `denied`
- **`pto_policies`** (`PTOPolicy`, 14 columns)  
  `id` (PK), `name`, `pto_type` (PTOType), `accrual_method` (AccrualMethod), `accrual_rate`, `max_carryover`, `max_balance`, `is_active`, `accrue_liability`, `valuation`, `expense_account_id` → accounts, `liability_account_id` → accounts, `pays_out_on_termination`, `created_at`
- **`pto_accruals`** (`PTOAccrual`, 8 columns)  
  `id` (PK), `employee_id` → employees, `policy_id` → pto_policies, `balance`, `accrued_ytd`, `used_ytd`, `dollar_balance`, `updated_at`
- **`pto_requests`** (`PTORequest`, 10 columns)  
  `id` (PK), `employee_id` → employees, `start_date`, `end_date`, `hours`, `pto_type` (PTOType), `status` (PTORequestStatus), `approver_id` → employees, `notes`, `created_at`

#### `app/models/purchase_orders.py`

- Enum **`POStatus`**: `draft`, `sent`, `partial`, `received`, `closed`
- **`purchase_orders`** (`PurchaseOrder`, 15 columns)  
  `id` (PK), `po_number`, `vendor_id` → vendors, `status` (POStatus), `date`, `expected_date`, `ship_to`, `subtotal`, `tax_rate`, `tax_amount`, `total`, `notes`, `job_id` → jobs, `created_at`, `updated_at`
- **`purchase_order_lines`** (`PurchaseOrderLine`, 11 columns)  
  `id` (PK), `purchase_order_id` → purchase_orders, `item_id` → items, `description`, `quantity`, `rate`, `amount`, `received_qty`, `job_id` → jobs, `cost_code_id` → cost_codes, `line_order`

#### `app/models/qbo_mapping.py`

- **`qbo_mappings`** (`QBOMapping`, 6 columns)  
  `id` (PK), `entity_type`, `slowbooks_id`, `qbo_id`, `qbo_sync_token`, `last_synced_at`

#### `app/models/recurring.py`

- **`recurring_invoices`** (`RecurringInvoice`, 15 columns)  
  `id` (PK), `customer_id` → customers, `frequency`, `start_date`, `end_date`, `next_due`, `is_active`, `terms`, `tax_rate`, `notes`, `invoices_created`, `class_id` → classes, `job_id` → jobs, `created_at`, `updated_at`
- **`recurring_invoice_lines`** (`RecurringInvoiceLine`, 8 columns)  
  `id` (PK), `recurring_invoice_id` → recurring_invoices, `item_id` → items, `description`, `quantity`, `rate`, `is_taxable`, `line_order`

#### `app/models/reseller_permit.py`

- **`reseller_permits`** (`ResellerPermit`, 13 columns)  
  `id` (PK), `entity_type`, `entity_id`, `jurisdiction`, `permit_number`, `issued_at`, `expires_at`, `last_verified_at`, `verified_by`, `notes`, `is_active`, `created_at`, `updated_at`

#### `app/models/saved_reports.py`

- **`saved_reports`** (`SavedReport`, 6 columns)  
  `id` (PK), `name`, `report_type`, `parameters`, `created_at`, `updated_at`

#### `app/models/settings.py`

- **`settings`** (`Settings`, 4 columns)  
  `id` (PK), `key`, `value`, `updated_at`

#### `app/models/stored_files.py`

- **`stored_files`** (`StoredFile`, 11 columns)  
  `id` (PK), `kind`, `original_name`, `content_type`, `size`, `sha256`, `token`, `legacy_path`, `from_shared_folder`, `missing`, `created_at`

#### `app/models/tax.py`

- **`tax_category_mappings`** (`TaxCategoryMapping`, 3 columns)  
  `id` (PK), `account_id` → accounts, `tax_line`

#### `app/models/time_entries.py`

- Enum **`TimeEntryStatus`**: `draft`, `submitted`, `approved`, `rejected`
- **`time_entries`** (`TimeEntry`, 16 columns)  
  `id` (PK), `employee_id` → employees, `date`, `hours_regular`, `hours_overtime`, `hours_doubletime`, `project_id` → items, `job_id` → jobs, `cost_code_id` → cost_codes, `job_cost_id` → job_costs, `notes`, `status` (TimeEntryStatus), `approved_by`, `approved_at`, `pay_run_id` → pay_runs, `created_at`

#### `app/models/transactions.py`

- **`transactions`** (`Transaction`, 9 columns)  
  `id` (PK), `date`, `reference`, `description`, `source_type`, `source_id`, `class_id` → classes, `job_id` → jobs, `created_at`
- **`transaction_lines`** (`TransactionLine`, 16 columns)  
  `id` (PK), `transaction_id` → transactions, `account_id` → accounts, `debit`, `credit`, `description`, `job_id` → jobs, `class_id` → classes, `cost_code_id` → cost_codes, `cost_type`, `function`, `is_billable`, `billed_invoice_line_id` → invoice_lines, `cleared`, `reconciliation_id` → reconciliations, `deposit_transaction_id` → transactions

#### `app/models/users.py`

- **`users`** (`User`, 8 columns)  
  `id` (PK), `username`, `display_name`, `password_hash`, `role`, `is_active`, `created_at`, `last_login_at`

#### `app/models/vendor_credits.py`

- Enum **`VendorCreditStatus`**: `draft`, `issued`, `applied`, `void`
- **`vendor_credits`** (`VendorCredit`, 19 columns)  
  `id` (PK), `credit_number`, `vendor_id` → vendors, `status` (VendorCreditStatus), `original_bill_id` → bills, `ref_number`, `date`, `subtotal`, `tax_rate`, `tax_amount`, `total`, `amount_applied`, `balance_remaining`, `notes`, `transaction_id` → transactions, `class_id` → classes, `job_id` → jobs, `created_at`, `updated_at`
- **`vendor_credit_lines`** (`VendorCreditLine`, 12 columns)  
  `id` (PK), `vendor_credit_id` → vendor_credits, `item_id` → items, `account_id` → accounts, `description`, `quantity`, `rate`, `amount`, `job_id` → jobs, `class_id` → classes, `cost_code_id` → cost_codes, `line_order`
- **`vendor_credit_applications`** (`VendorCreditApplication`, 4 columns)  
  `id` (PK), `vendor_credit_id` → vendor_credits, `bill_id` → bills, `amount`

---

_[← Appendix A. Complete API endpoint catalog](appendix-a-api-endpoints.md) · [Index](README.md) · [Appendix C. Printable documents & schema history →](appendix-c-documents-and-schema-history.md)_
