# BeeKeeping build plan

BeeKeeping is a double-entry bookkeeping app for US small businesses and the bookkeepers who work for them. This plan turns the [SlowBooks Pro 2026 feature inventory](../research/slowbooks-pro-2026/README.md) into an architecture and a phase plan. The [execution plan](execution-plan.md) breaks the phases into tasks and says when and how each skill in `.claude/skills/` runs on them.

Written 2026-09-29. Nothing is built yet.

## Contents

1. [Assumptions to confirm](#assumptions-to-confirm)
2. [Stack](#stack)
3. [Ground rules](#ground-rules)
4. [What SlowBooks taught us](#what-slowbooks-taught-us)
5. [Architecture](#architecture)
6. [How we work](#how-we-work)
7. [Roadmap](#roadmap)
8. [Parity with SlowBooks](#parity-with-slowbooks)
9. [Testing](#testing)
10. [Risks](#risks)

## Assumptions to confirm

Nobody has decided these yet, so I picked the answer that fits best and built the plan on it. Each one names the part of the plan that changes if I got it wrong.

1. **BeeKeeping is a hosted product you sell.** Many companies with many users each, paying a subscription, running in the cloud. SlowBooks already fills the free desktop niche, and bank connections and accountant access both need a hosted app. If you want a free app that runs on the owner's computer instead, the architecture changes most: one database file per company, a desktop shell and no billing.
2. **US businesses come first.** The first release handles sales tax, 1099s and US banks. Every document still carries a currency, and tax lives in tax codes instead of one rate per document, so other countries don't need a rewrite later.
3. **The web app comes first.** A phone app for receipt photos and approvals comes after launch. Bookkeeping itself is keyboard work.
4. **Payroll comes from a partner.** SlowBooks wrote withholding for every state and still calls its numbers approximate. Payroll mistakes cost employers penalties, and a new product shouldn't carry that risk. An embedded payroll API such as Check or Gusto Embedded does the calculations and filings, and BeeKeeping records the results.
5. **The build is clean room.** See ground rule 1.

## Stack

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript in strict mode | One language for the web app, the worker and a later React Native app. The installed skills use TypeScript and Node in their examples and tools. |
| Web app | Next.js App Router, React, Tailwind, shadcn/ui | Server actions make thin adapters over the actions layer described under Architecture. |
| Database | Postgres 16 | Bookkeeping needs transactions, constraints and SQL for reports. The ledger rules live in the database, so no code path can skip them. |
| Database access | Drizzle ORM and drizzle-kit migrations | Queries read like the SQL they send, and the schema can declare row-level security policies. |
| Sign-in | Better Auth with its organization plugin | Sessions live in our Postgres, so removing a user ends their sessions at once. |
| Background jobs | pg-boss on the same Postgres | Recurring invoices, PDFs, email, imports and bank syncs run without a Redis server. |
| Files | Railway bucket through the S3 API | Attachments, receipt images and generated PDFs, stored under each organization's prefix. |
| PDFs | HTML templates printed by headless Chromium in the worker | One renderer for every document, with tagged PDFs for screen readers. |
| Email | Resend | Sending plus delivery events, which each document shows. |
| Card payments | Stripe Connect with Standard accounts | Customers pay invoices into the business's own Stripe account, in the invoice's currency. |
| Bank data | CSV and OFX import first, Plaid later | Imports work with every bank and cost nothing. Plaid charges per connected account, so it waits for paying users. |
| AI | Claude API | Reads receipts into structured fields and writes plain-language summaries of reports. |
| Hosting | Railway | Web service, worker service, Postgres and a bucket, with a staging environment and an environment per pull request. The PR environment gives `before-and-after` a real "after" URL. |
| Tests | Vitest, fast-check, Playwright, axe | Unit tests, property-based ledger tests, end-to-end flows and accessibility checks. |
| Errors | Sentry | Server and browser errors, tagged with the organization and never with personal data. |

## Ground rules

1. **Clean room.** SlowBooks Pro's license forbids using its code, templates or assets in anything sold or offered as a service. The inventory describes behavior, which the license doesn't cover. Build from the inventory, keep the SlowBooks source closed while building, and never add any of it to this repo.
2. **The ledger comes first.** Every posting goes through the shared `postEntry` action, and the database refuses an unbalanced entry or an edit to a posted one. A feature that can't post correctly isn't done.
3. **One organization at a time.** Every table has `org_id`. Actions check it, and Postgres row-level security stops anything an action misses.
4. **Evidence shows the demo company.** The upload hosts that `before-and-after` uses are public. No screenshot or video ever shows real books.
5. **Every task follows AGENTS.md.** Isolate, build, prove, ship.

## What SlowBooks taught us

The inventory's notes sections list what SlowBooks got wrong. Each problem below becomes a rule for BeeKeeping, and the last column links the details.

| SlowBooks problem | BeeKeeping rule | Details |
|---|---|---|
| Recurring invoices parsed payment terms with their own code and turned "Due on Receipt" into 30 days. Invoices parsed them correctly. | One `terms` service computes every due date for invoices, recurring runs, estimate conversions and imports. This is the duplication the `code-structure` skill exists to stop. | [§1](../research/slowbooks-pro-2026/01-sales-accounts-receivable.md) |
| One recurring template dated in a closed period stopped the whole run. | Scheduled jobs handle each item on its own and report failures per item. | [§1](../research/slowbooks-pro-2026/01-sales-accounts-receivable.md) |
| Online checkout charged every invoice in US dollars. | Checkout charges the invoice's currency, or refuses. | [§1](../research/slowbooks-pro-2026/01-sales-accounts-receivable.md) |
| The currency picker defaulted to US dollars and the rate field to 1.0, whatever the home currency. | The home currency is set when the organization is created. A foreign-currency document needs a real rate or it doesn't save. | [§3](../research/slowbooks-pro-2026/03-general-ledger-banking.md) |
| SlowBooks checked the credit limit only in the browser. | Business rules live in actions. The UI may warn early, and the server decides. | [§1](../research/slowbooks-pro-2026/01-sales-accounts-receivable.md) |
| Late fees raised an invoice's total without adding a line. An edit dropped the fee from the invoice but kept its journal entry, and a void left that entry in place. | A late fee is an invoice line with its own posting and its own void. | [§1](../research/slowbooks-pro-2026/01-sales-accounts-receivable.md) |
| Control accounts were found by account number, so their numbers were frozen and a missing one stopped every posting that needed it. | Accounts carry a system role such as receivables or sales tax payable. Renumbering is always safe. | [§3](../research/slowbooks-pro-2026/03-general-ledger-banking.md) |
| A code comment said the inventory adjustments account was created on demand. Nothing created it. | Creating an organization creates its required system accounts, and a startup check lists any that are missing. | [§2](../research/slowbooks-pro-2026/02-purchasing-payables-inventory.md) |
| Bills couldn't be edited, only voided and entered again. Pay runs couldn't be voided at all. | Every document type has written edit rules and a void. Drafts can be deleted. | [§2](../research/slowbooks-pro-2026/02-purchasing-payables-inventory.md), [§4](../research/slowbooks-pro-2026/04-payroll-hr.md) |
| The audit log removed secrets by column name, which missed secrets stored under other names. | The audit log records an allowlist of fields per table. Secret fields never enter it. | [§8](../research/slowbooks-pro-2026/08-platform-security-administration.md) |
| Sessions were signed cookies, so a role change waited for the user's next sign-in. | Sessions live in the database and end the moment a user is removed. | [§8](../research/slowbooks-pro-2026/08-platform-security-administration.md) |
| Rate limits keyed on the proxy's address instead of the visitor's. | One function reads the client address Railway forwards, and every rate limit uses it. | [§8](../research/slowbooks-pro-2026/08-platform-security-administration.md) |
| The container's startup self-check piped into `tail` and could never fail. | Scripts run with `set -euo pipefail`, and a test proves each check can fail. | [§9](../research/slowbooks-pro-2026/09-ui-desktop-deployment-engineering.md) |
| The QuickBooks Online importer read `false` as true for the taxable and active flags. | Importers parse with typed schemas, and each ships with fixture files that cover false, empty and missing values. | [§7](../research/slowbooks-pro-2026/07-import-export-migration.md) |
| IIF import skipped customer addresses and brought credit card accounts in as expenses. | Each importer's tests use a real export from the product it reads, and its dry run lists each row's fate. | [§7](../research/slowbooks-pro-2026/07-import-export-migration.md) |
| Reports were accrual basis only. | Every financial report takes accrual or cash basis from the start. | [§5](../research/slowbooks-pro-2026/05-reports-dashboard-analytics-ai.md) |
| The aging reports needed several fixes before they matched the balance sheet. | After every scenario in the test suite, A/R aging must equal the receivables account and A/P aging must equal payables. | [§5](../research/slowbooks-pro-2026/05-reports-dashboard-analytics-ai.md) |
| The app wrote an email log that no screen showed. | Each document lists the emails sent about it, with delivery status. | [§1](../research/slowbooks-pro-2026/01-sales-accounts-receivable.md) |
| The docs described features the code didn't have. | The build generates the API reference from the code, and each feature page names the test that proves it. | [Index](../research/slowbooks-pro-2026/README.md) |

SlowBooks also got a lot right. Keep these:

- Voids post reversing entries and never delete anything.
- Every import starts with a dry run that says what will happen to each row, and running it twice changes nothing.
- A document that adds up to $0.00 asks before saving.
- Customer and vendor balances come from open documents, never from a stored total.
- The closing date blocks changes to closed periods, and the audit log records every override.
- A deposit remembers which payments it took, and a payment can't be voided while its deposit stands.
- Nonprofit wording is a translation layer over the same screens, not a second set of screens.
- Tagged PDFs and WCAG 2.1 AA from the first screen.

## Architecture

### Layers

The `code-structure` skill splits code into actions and services. BeeKeeping uses its names for the folders.

```
apps/web            Next.js. Pages, server actions and API route handlers, all thin.
apps/worker         pg-boss jobs. Calls the same actions as the web app.
packages/actions    The why and when. One folder per area, one file per flow, and shared/
                    for postEntry and nextNumber.
packages/services   The how. Money, ledger checks, terms, numbering, tax, PDF, email, storage,
                    FX and import parsers.
packages/db         Drizzle schema, migrations, row-level security policies, seed data.
packages/ui         Shared components and design tokens.
packages/testing    Factories, the demo company and the ledger property suite.
```

An action owns authorization, the organization check, input validation, status changes, business policy and the message the user sees. It reads and writes our tables. A service owns one mechanic that two or more actions share. It takes everything as parameters, never reads the session, never touches our tables, and returns a structured result instead of throwing for failures it expects. Orchestration that many actions share and that writes tables, such as posting to the ledger, lives in shared actions under `packages/actions/shared`. The [execution plan](execution-plan.md#writing-code-with-code-structure) lists every service and its callers.

A server action or route handler does three things. It parses the input with zod, builds the action context from the session, and calls one action. Nothing else lives in `apps/web`.

Posting an invoice shows the split:

```ts
// packages/actions/sales/postInvoice.ts, the why and when
export async function postInvoice(ctx: ActionContext, input: PostInvoiceInput) {
  requireRole(ctx, "bookkeeper");
  const invoice = await invoices.loadDraft(ctx, input.invoiceId);
  if (invoice.totalMinor === 0n && !input.allowZeroTotal) {
    return { ok: false, reason: "zero_total" } as const;
  }
  const dueDate = terms.dueDate({ date: invoice.date, terms: invoice.terms }); // service
  const entry = salesPostings.invoiceEntry(invoice); // what an invoice means in the ledger
  const posted = await postEntry(ctx, { entry, lockOverride: input.lockOverride }); // shared action
  if (!posted.ok) return posted; // period_locked, unbalanced, missing_system_account
  await invoices.markPosted(ctx, invoice.id, { dueDate, entryId: posted.entryId });
  return { ok: true, invoiceId: invoice.id } as const;
}
```

The posting rules, meaning which accounts a document debits and credits, belong to actions because they say what a document means. The `ledger` service builds and checks entries without touching the database. `postEntry` is the shared action that writes them. It asks `ledger` to check the entry, checks the closing date and account ownership, inserts the lines in the caller's transaction and returns the entry id. Every document action posts through it, so no posting can skip the closing date. The document's action decides whether to ask for an override, and `postEntry` records who gave it.

### The ledger

- **Accounts.** Each has a type, an optional parent, a number, a name, an active flag and an optional system role. The six types are asset, liability, equity, income, cost of goods sold and expense. The default chart suits a US service business. An account with postings can be deactivated but not deleted.
- **Journal entries and lines.** An entry has a date, a source document, an optional link to the entry it reverses, a memo and the user who posted it. A line has an account, a debit or a credit, the amount in the document's currency, the exchange rate, the amount in home currency, and optional class, location, project and fund tags.
- **Money.** Amounts are integers in minor units, stored as `bigint`. Exchange rates are `numeric(18,8)`, and tax rates keep four decimal places of a percent. One money module does all rounding, half up, line by line.
- **Rules the database enforces.**
  - Each line is a debit or a credit, never both and never negative.
  - Each entry balances in home currency, checked by a deferred constraint trigger at commit.
  - Posted lines can't be updated or deleted.
  - Every account on a line belongs to the entry's organization, through composite foreign keys.
  - A posting dated on or before the closing date fails unless the transaction carries an override.
- **Voids.** A void posts a mirror entry dated the same day as the original and links the two. Nothing is deleted, and "voided" comes from that link.
- **Balances.** Reports sum lines. When that gets slow, a table of balances per account and month takes over. It is rebuilt from lines, and tests check the two agree.

### Documents

Every document type follows one pattern, so a new type is mostly posting rules and a form.

- A status machine written as a table in code, with a test for each allowed and refused transition.
- A number from the shared `nextNumber` action, which formats it with the `numbering` service and retries when two users save at the same moment.
- Edit rules that say what can change after posting. Changing an amount on a posted document reverses the old entry and posts a new one in the same transaction.
- A void, and the conditions that refuse it, such as applied payments, a reconciled bank line or a closed period.
- A PDF from the shared renderer, emails with delivery status, attachments and an audit trail.

Sales documents are invoices, sales receipts, estimates, credit memos, customer payments and deposits. Purchase documents are bills, bill payments, expenses, card charges, vendor credits and purchase orders.

### Organizations, users and security

- **Roles.** Owner, admin, bookkeeper and viewer. An outside accountant is a member with the bookkeeper role in each client organization. The accountant workspace in phase 9 lists those organizations together.
- **Row-level security.** Each request runs in a transaction that sets `app.org_id` and `app.user_id` with `set local`, and every table has a policy on `org_id`. A test suite calls every action with another organization's ids and expects "not found".
- **Audit log.** Postgres triggers record who changed what, using those two settings and an allowlist of fields per table. Actions add business events such as "invoice emailed". Admins can read the log, and nobody can edit it.
- **Secrets.** BeeKeeping encrypts each organization's Stripe, Plaid and email credentials with a key held in Railway variables. The rotation command ships with the first secret, not after.
- **API tokens.** Phase 9. Stored as hashes, limited to one organization and one role, and named in the audit log.

### Jobs

pg-boss queues handle recurring invoices, PDF rendering, email, imports, bank syncs and exchange rates. Every job carries an idempotency key, so a retry never posts twice. A job that touches many items reports success or failure for each one.

### Files and PDFs

Files live in the bucket under `org/<orgId>/`, served through short-lived signed URLs, with a size limit and a list of allowed types. The PDF service takes a template name and data and returns bytes, and Chromium renders the HTML as a tagged PDF. A document keeps its PDF until the document changes.

### Operations

Sentry catches errors. Logs are structured and carry organization and user ids but no personal data. Railway watches a health endpoint. The database gets daily backups with point-in-time recovery, staging gets a restore drill before launch, and every organization can export all of its data.

## How we work

[AGENTS.md](../AGENTS.md) holds the rules every session follows. The [execution plan](execution-plan.md#the-task-loop) walks through the task loop: which skill runs at each step, how it runs in this repo, the proof each type of task leaves, and when a session stops to ask.

## Roadmap

Phases 0 to 5 are the first release, which opens as a private beta at gate G2. Phases 6 to 8 get it ready for the public. Phase 9 builds the remaining modules in the order beta users ask for them. The [execution plan](execution-plan.md#every-task-phase-by-phase) lists every task with its type, proof and dependencies, and its [setup steps](execution-plan.md#before-the-first-task) come before the first task.

| Phase | What it delivers | Tasks | Gate |
|---|---|---|---|
| 0. Foundations | Sign-in, organizations, CI, staging and the evidence tools | 9 | G0 |
| 1. The ledger | Chart of accounts, posting, the closing date, opening balances and the first reports | 10 | G1 |
| 2. Sales and receivables | Customers through to cash, statements and online payments | 16 | |
| 3. Purchases and payables | Vendors through to payments, and 1099 totals | 7 | |
| 4. Banking | Statement imports, matching, rules and reconciliation | 7 | |
| 5. Reports, dashboard and tax | Report center, cash flow, sales tax, Schedule C, the dashboard and full export | 7 | G2, private beta |
| 6. Moving in | CSV, QuickBooks Online, Xero, Wave and IIF imports | 5 | |
| 7. Receipts and AI | The receipt inbox, receipt reading and the monthly summary | 4 | |
| 8. Launch | Billing, onboarding, the security review, backups, legal pages and performance | 7 | G3, public launch |
| 9. Modules | Classes, currencies, inventory, projects, fixed assets, budgets, nonprofit mode, payroll, the public API, the phone app and the accountant workspace | 41 | One per module |

## Parity with SlowBooks

| SlowBooks area | BeeKeeping | Phase |
|---|---|---|
| Invoices, estimates, sales receipts, credit memos, payments, deposits, statements | Keep, with the fixes above | 2 |
| Online payments through Stripe, PayPal and Square | Stripe Connect first, others on request | 2, 9 |
| Quick Entry for paper backlogs | Keep as a fast-entry grid | 2 |
| Reseller permits | Exemption certificates on customers | 9 |
| Bills, bill payments, vendor credits, purchase orders, expenses | Keep, and bills become editable | 3 |
| Check printing | Later | 9 |
| 1099-NEC and 1096 | Totals report first, forms and e-filing later | 3, 9 |
| Receipt scanning with the operating system's OCR | Claude reads receipts on the server | 7 |
| Perpetual inventory | Later | 9 |
| Ledger, chart of accounts, journal entries, closing date | Keep, with system roles instead of fixed numbers | 1 |
| Opening balances wizard | An opening balances screen, then CSV import | 1, 6 |
| Classes, multi-currency | In the data model now, screens later | 1, 9 |
| Budgets, fixed assets | Later | 9 |
| Register, review queue, bank rules, reconciliation | Keep | 4 |
| SimpleFIN bank feeds | Plaid, which suits a hosted app | 4 |
| Payroll and HR | Partner API | 9 |
| Reports and dashboard | Keep, and add cash basis | 1, 5 |
| AI with eight providers | Claude only, with our key on the server | 7 |
| Nonprofit mode, job costing | Later | 9 |
| IIF, QuickBooks Online, Xero, MYOB, Sage, Wave, Zoho and GnuCash imports | QuickBooks Online, CSV, Xero, Wave and IIF | 6 |
| Users, roles, multiple companies | Organizations and roles | 0 |
| API tokens | Later | 9 |
| Backups and restore | Hosted backups and a full export per organization | 5, 8 |
| Desktop apps, Server Edition, Docker install | Dropped, because BeeKeeping is hosted | none |
| Accessibility and tagged PDFs | Keep, from the first screen | 0 |

## Testing

- **Unit tests** cover every service.
- **The ledger property suite** uses fast-check to generate random sequences of documents, payments, edits and voids on the demo company. After each sequence the trial balance is zero, the balance sheet balances, each aging equals its control account, and every document's balance matches its ledger lines.
- **Integration tests** run actions against a real Postgres in CI, and call every action with another organization's ids.
- **End-to-end tests** in Playwright walk each phase's exit test on the demo company. The same scripts produce the evidence for PRs.
- **Accessibility checks** run axe on every page in CI.
- **Importer fixtures** are real exports, including awkward ones with false flags, empty fields, quoted commas and ALL-CAPS names.

## Risks

| Risk | What we do |
|---|---|
| Wrong numbers | Database rules, the property suite, reports that cross-check each other, and an accountant's review before the beta. |
| One organization sees another's data | Row-level security, organization checks in every action, a cross-organization test for every action, and the phase 8 security review. |
| Tax and payroll liability | Payroll through a partner. Users enter sales tax rates at first, and a rates provider supplies them later. Every tax figure says where it came from. |
| Bank data costs | CSV and OFX first. Plaid waits for paying users. |
| Scope creep | The phase 5 exit test decides the beta. Phase 9 follows what users ask for. |
| The SlowBooks license | The clean-room rule. |
| Parallel agents colliding | The `new-feature` scope check, one task per PR, and the Needs column. |
| AI misreading a receipt | A person reviews every reading before anything posts. |
