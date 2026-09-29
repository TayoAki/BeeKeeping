_SlowBooks Pro 2026 feature inventory — [← Appendix B. Database schema](appendix-b-database-schema.md) · [Index](README.md)_

## Appendix C. Printable documents & schema history

### Printable documents (Jinja2 templates → WeasyPrint PDF / HTML)

Every PDF is rendered from a Jinja2 template in `app/templates/` by WeasyPrint. The company logo prints on invoices, estimates, statements, letters, donor documents and reports when one is set, and generated PDFs are tagged (PDF/UA-1) for screen readers.

| Template | Document | Rendered by |
|---|---|---|
| `invoice_pdf.html` | Invoice, **Sales Receipt**, **Donation Receipt** or **Pledge** (the title follows the document kind, not the company type) | `app/services/pdf_service.py`, `app/services/donor_documents.py` |
| `estimate_pdf.html` | Estimate | `app/services/pdf_service.py`, `app/routes/estimates.py` |
| `credit_memo_pdf.html` | Credit Memo | `app/services/pdf_service.py`, `app/routes/credit_memos.py` |
| `statement_pdf.html` | Customer statement | `app/services/pdf_service.py` |
| `collection_letter.html` | Collection letter | `app/services/pdf_service.py` |
| `invoice_email.html` | HTML body of emailed invoices and other documents (with a Pay Online button when a payment provider is on) | `app/services/email_service.py` |
| `public_pay.html` | Public "Pay Invoice #…" page served at `/pay/{token}` (no sign-in) | `app/routes/public.py` |
| `purchase_order_pdf.html` | Purchase Order | `app/routes/purchase_orders.py` |
| `bill_pdf.html` | Bill | `app/routes/bills.py` |
| `check_pdf.html` | Check — voucher layout, one check per US Letter page: two stubs, then the check in the bottom third (the docs' "3-per-page" means these three parts) | `app/services/pdf_service.py` |
| `report_pdf.html` + `_report_theme.html` | Every financial report's printable PDF (shared report theme and footer) | `app/services/pdf_service.py`, `app/routes/reports/financial.py` |
| `analytics_pdf.html` | Analytics snapshot ("Slowbooks Analytics — MONTH/QUARTER/YEAR") | `app/services/pdf_service.py` |
| `acknowledgment_letter.html` | Donor acknowledgment letter | `app/services/pdf_service.py` |
| `giving_statement_pdf.html` | Year-end donor giving statement | `app/services/pdf_service.py` |
| `paystub_pdf.html` | Employee pay stub | `app/services/paystub_pdf.py` |
| `w2.html` / `w3.html` | Form W-2 / Form W-3 (tamper-evident hash footer) | `app/services/tax_forms/w2_w3.py` |
| `form_940.html` | Form 940 (FUTA) (tamper-evident hash footer) | `app/services/tax_forms/form_940.py` |
| `form_941.html` | Form 941 (quarterly federal) (tamper-evident hash footer) | `app/services/tax_forms/form_941.py` |
| `form_1099nec.html` / `form_1096.html` | Form 1099-NEC / Form 1096 | `app/services/form_1099.py` |
| `new_hire_report.html` | State new-hire report | `app/services/new_hire_report.py` |
| `portal/base.html`, `dashboard.html`, `paystubs.html`, `profile.html`, `bank.html`, `pto.html` | Employee self-service portal pages (server-rendered, "Employee Portal — {company}") | `app/routes/portal.py` |

### Schema history (Alembic migrations, oldest first)

44 revisions in `migrations/versions/`, run automatically on start (Docker entrypoint and desktop launcher). The dates trace the project's growth from the first schema on 2026-04-11 to v2.18.1.

| # | Date | Revision | What it added or changed |
|---|---|---|---|
| 1 | 2026-04-11 | `915defbcc493` | Initial schema |
| 2 | 2026-04-11 | `74f6d270ca5e` | Settings table |
| 3 | 2026-04-12 | `27e17711c1a2` | 19 feature tables |
| 4 | 2026-04-13 | `ae790370792b` | Stripe payment fields |
| 5 | 2026-04-13 | `c3f8a1b2d4e6` | QuickBooks Online ID mappings |
| 6 | 2026-04-15 | `d4e5f6a7b8c9` | Payment void + vendor default expense account |
| 7 | 2026-04-15 | `e5f6a7b8c9d0` | Phase 10 — bank rules, budgets, attachments, email templates, vendor 1099 fields |
| 8 | 2026-04-24 | `f6a7b8c9d0e1` | Phase 11 — inventory tracking, saved reports, duplicate detection |
| 9 | 2026-05-17 | `f7a8b9c0d1e2` | Payroll tier 1 — modern W-4, pay frequency, time tracking, PTO, bank accounts |
| 10 | 2026-05-17 | `a7b8c9d0e1f2` | Payroll tier 2 — pre/post-tax deductions, garnishments, multi-state stubs |
| 11 | 2026-05-17 | `b8c9d0e1f2a3` | HR tier 3 — employee roles, self-service portal, onboarding, document vault |
| 12 | 2026-06-01 | `c9d0e1f2a3b4` | `is_voided` on bill payments |
| 13 | 2026-06-05 | `d0e1f2a3b4c5` | Employee portal-expiry and E-Verify lifecycle columns |
| 14 | 2026-06-05 | `bc3c3c5fd0a6` | Previously unmigrated HR/audit tables |
| 15 | 2026-08-01 | `c1d2e3f4a5b6` | Hosted-checkout fields for multiple payment providers |
| 16 | 2026-08-01 | `d2e3f4a5b6c7` | Class tracking |
| 17 | 2026-08-01 | `e3f4a5b6c7d8` | Multi-currency |
| 18 | 2026-08-01 | `f4a5b6c7d8e9` | Fixed assets |
| 19 | 2026-08-01 | `a5b6c7d8e9f0` | Bill-payment currency |
| 20 | 2026-08-12 | `b6c7d8e9f0a1` | Server Edition: per-user audit attribution (`username` on `audit_log`) |
| 21 | 2026-08-17 | `c7d8e9f0a1b2` | Sales receipts (`is_sales_receipt` flag on invoices) |
| 22 | 2026-09-02 | `d8e9f0a1b2c3` | Merchant OCR templates (learned field positions per merchant) |
| 23 | 2026-09-03 | `e9f0a1b2c3d4` | Jobs |
| 24 | 2026-09-03 | `f0a1b2c3d4e5` | Cost codes |
| 25 | 2026-09-03 | `a1b2c3d4e5f6` | Job cost model |
| 26 | 2026-09-06 | `a0b1c2d3e4f5` | Users table (previously `create_all`-only) |
| 27 | 2026-09-03 | `b2c3d4e5f6a7` | User preferences |
| 28 | 2026-09-03 | `c3d4e5f6a7b8` | Per-line taxable flag |
| 29 | 2026-09-03 | `d5e6f7a8b9c0` | Benefits engine |
| 30 | 2026-09-03 | `e6f7a8b9c0d1` | State W-4 fields |
| 31 | 2026-09-05 | `f1a2b3c4d5e6` | Nonprofit dimensions (funds, functions) |
| 32 | 2026-09-05 | `a2b3c4d5e6f7` | Nonprofit documents |
| 33 | 2026-09-06 | `b3c4d5e6f7a8` | Nonprofit donor documents |
| 34 | 2026-09-07 | `c4d5e6f7a8b9` | API tokens table (previously `create_all`-only) |
| 35 | 2026-09-07 | `d6e7f8a9b0c1` | Widen `settings.value` to Text |
| 36 | 2026-09-09 | `e7f8a9b0c1d2` | Banking on the ledger (issue #114) |
| 37 | 2026-09-10 | `f8a9b0c1d2e3` | Vendor credits (issue #129) |
| 38 | 2026-09-23 | `a9b0c1d2e3f4` | Widen money columns from `Numeric(12, 2)` to `Numeric(15, 2)` |
| 39 | 2026-09-26 | `6f57f762f464` | Sales-line unit prices to four decimal places |
| 40 | 2026-09-26 | `697f63b2975e` | Deposits remember the payments they took |
| 41 | 2026-09-26 | `4c7e2a9d1b05` | Purchase-line and item prices to four decimal places; bills get due dates |
| 42 | 2026-09-26 | `d3d40d716684` | Document tax rates to four decimal places of a percent (e.g. 8.875%) |
| 43 | 2026-09-27 | `c5e1f7a9b3d2` | Company files (logo, attachments, employee documents) stored in the company's own database |
| 44 | 2026-09-27 | `e2b7c4d9a1f3` | Employees' portal links kept as a digest plus an encrypted copy |

---

_[← Appendix B. Database schema](appendix-b-database-schema.md) · [Index](README.md)_
