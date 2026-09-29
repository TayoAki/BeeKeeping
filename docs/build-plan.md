# BeeKeeping build plan

BeeKeeping is a double-entry bookkeeping app for US small businesses and the bookkeepers who work for them. This plan turns the [SlowBooks Pro 2026 feature inventory](../research/slowbooks-pro-2026/README.md) into an architecture and a build order. The skills in `.claude/skills/` and the workflow in [AGENTS.md](../AGENTS.md) decide how each task gets built, proved and shipped.

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
11. [Setup list](#setup-list)
12. [First tasks](#first-tasks)

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
2. **The ledger comes first.** Every posting goes through one ledger service, and the database refuses an unbalanced entry or an edit to a posted one. A feature that can't post correctly isn't done.
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
packages/actions    The why and when. One folder per area, one file per flow.
packages/services   The how. Ledger, money, terms, numbering, tax, PDF, email, storage, FX, imports.
packages/db         Drizzle schema, migrations, row-level security policies, seed data.
packages/ui         Shared components and design tokens.
packages/testing    Factories, the demo company and the ledger property suite.
```

An action owns authorization, the organization check, input validation, status changes, business policy and the message the user sees. It reads and writes documents. A service owns one mechanic. It takes everything as parameters, never reads the session or the request, and returns a structured result instead of throwing for failures it expects.

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
  const dueDate = terms.dueDate({ date: invoice.date, terms: invoice.terms });
  const entry = salesPostings.invoiceEntry(invoice); // what an invoice means in the ledger
  const posted = await ledger.post(ctx.tx, {
    orgId: ctx.orgId,
    entry,
    lockOverride: input.lockOverride,
  });
  if (!posted.ok) return posted; // period_locked, unbalanced, missing_system_account
  await invoices.markPosted(ctx, invoice.id, { dueDate, entryId: posted.entryId });
  return { ok: true, invoiceId: invoice.id } as const;
}
```

The posting rules, meaning which accounts a document debits and credits, belong to actions because they say what a document means. `ledger.post` is a service. It checks the balance, the closing date and account ownership, writes the lines and returns the entry id. The ledger enforces the closing date because no posting may skip it. The action decides whether to ask for an override and records who gave it.

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
- A number from the `numbering` service, with prefix, padding and a retry when two users save at the same moment.
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

[AGENTS.md](../AGENTS.md) is the source of truth. In short:

1. **Isolate.** One task, one branch, one PR. The `new-feature` scope check looks at open PRs first and stops on overlap.
2. **Build.** Actions and services as described above. Write the tests for the rules in the task's spec first.
3. **Prove.** Run the checks, then capture evidence on the demo company. In cloud sessions that means Playwright screenshots and video. Work without a screen gets numbers or output pairs.
4. **Ship.** Open a PR with before-and-after proof and a body run through `unslop`, then run `/greploop` until Greptile gives 5/5 with no open comments.

A task is done when:

- [ ] It follows its spec, which is the plan entry, the linked inventory subsection and any lesson above that applies.
- [ ] Typecheck, lint, unit, integration and end-to-end tests pass, and axe finds nothing on the pages it changed.
- [ ] The ledger property suite passes, if the task posts anything.
- [ ] Every new action has a cross-organization test.
- [ ] The PR carries evidence from the demo company only.
- [ ] Greptile reports 5/5 with zero unresolved comments.

Keep each PR small enough to review in one sitting, about 800 changed lines at most, not counting generated files and fixtures. Tasks that don't share files can run in parallel sessions. The Needs column in the roadmap shows what waits for what.

## Roadmap

Phases 0 to 5 are the first release. It goes to a private beta when the exit test at the end of phase 5 passes. Phases 6 to 8 get it ready for the public. Phase 9 is a menu, ordered by what beta users ask for.

Each task is one PR.

### Phase 0. Foundations

An empty app you can sign in to, with organizations, CI and a staging deploy.

| Task | What | Needs |
|---|---|---|
| P0.1 | Monorepo with pnpm workspaces, TypeScript strict, ESLint and Prettier, Vitest, and a GitHub Actions workflow that runs typecheck, lint and tests on every PR. Fill in the commands in AGENTS.md. | |
| P0.2 | A SessionStart hook so Claude Code on the web installs dependencies and can run the checks. Use the `session-start-hook` skill. | P0.1 |
| P0.3 | Postgres with Drizzle and migrations, and a Postgres service in CI. A Railway project with staging and PR environments. | P0.1 |
| P0.4 | Sign-in with Better Auth: email and password, magic links, two-factor, organizations, invitations, roles and sign-out everywhere. | P0.3 |
| P0.5 | Tenancy: the action context type, the `set local` settings, row-level security on every table and the cross-organization test harness. | P0.4 |
| P0.6 | Audit log triggers with per-table allowlists, and an admin page to read the log. | P0.5 |
| P0.7 | App shell: navigation, organization switcher, a Ctrl+K command palette, light and dark themes, toasts in a live region, dialogs that manage focus, and axe in CI. | P0.4 |
| P0.8 | Demo company seed: a US service business that every later phase extends, used by all tests and evidence. | P0.5 |

Phase 0 is done when two users with different roles share one organization, a second organization can't see the first, CI is green and staging runs on Railway.

### Phase 1. The ledger

Read [§3 General ledger, chart of accounts and banking](../research/slowbooks-pro-2026/03-general-ledger-banking.md) first.

| Task | What | Needs |
|---|---|---|
| P1.1 | Money module: minor units, rounding, parsing, formatting and currency codes, with property tests. | P0.1 |
| P1.2 | Chart of accounts: types, parents, numbers, system roles, rules for deactivating and deleting, and the default US chart. | P0.5 |
| P1.3 | Ledger service and schema: entries, lines, the database rules above, reversals and structured results. | P1.1, P1.2 |
| P1.4 | Closing date with an admin override and a reason, both audited. Repeated wrong override attempts lock it for ten minutes. | P1.3 |
| P1.5 | Manual journal entries: a grid with running totals, attachments and void. | P1.3 |
| P1.6 | First reports: trial balance, general ledger with running balances, profit and loss, and balance sheet. Each takes accrual or cash basis, and each row opens its entries. | P1.3 |
| P1.7 | Ledger property suite: random sequences of postings and voids keep the trial balance at zero and the balance sheet balanced. It runs in CI. | P1.3 |
| P1.8 | Chart of accounts import from CSV, with a dry run that lists each row's fate. See the [chart import](../research/slowbooks-pro-2026/07-import-export-migration.md#chart-of-accounts-import-csv-spreadsheets-hledger) notes. | P1.2 |

Phase 1 is done when a company that only has journal entries can close a month, and the four reports agree with each other and with the property suite.

### Phase 2. Sales and receivables

Read [§1 Sales and accounts receivable](../research/slowbooks-pro-2026/01-sales-accounts-receivable.md) first.

| Task | What | Needs |
|---|---|---|
| P2.1 | Customers: contact and address fields, terms, tax exemption, credit limit, inactive status, a duplicate-name warning and a balance from open documents. | P1.3 |
| P2.2 | Products and services: income account, a price to four decimals and a taxable flag. | P1.2 |
| P2.3 | Sales tax: tax codes with combined rates to four decimal places of a percent, a taxable flag per line, exempt customers and sales tax payable per code. | P2.2 |
| P2.4 | The terms and numbering services, used by every document from here on. | P1.3 |
| P2.5 | Invoices: draft, send, edit and repost, void, duplicate, the $0.00 question, the server-side credit limit check, posting rules and attachments. | P2.1, P2.2, P2.3, P2.4 |
| P2.6 | Document PDFs and email: the shared renderer in the worker, the logo, email with the PDF attached and delivery status on the document. | P2.5 |
| P2.7 | Receive payments: allocation to the oldest invoice first, a leftover kept as a credit only when the user asks, credits applied later, undeposited funds and void rules. | P2.5 |
| P2.8 | Deposits that remember their payments. | P2.7 |
| P2.9 | Credit memos and bad-debt write-offs. | P2.5 |
| P2.10 | Estimates that convert to invoices, and sales receipts with a walk-in customer. | P2.5 |
| P2.11 | Recurring invoices on the scheduler, with a report per item. | P2.5 |
| P2.12 | Customer statements, and A/R aging tied to the receivables account. | P2.7 |
| P2.13 | Pay online: Stripe Connect onboarding, a payment link on each invoice, recording from the webhook and the return page, in the invoice's currency. | P2.7 |
| P2.14 | Late fees as invoice lines. | P2.5 |

Phase 2 is done when the demo company invoices, collects, deposits and emails statements for a month, and aging equals receivables.

### Phase 3. Purchases and payables

Read [§2 Purchasing, payables, items and inventory](../research/slowbooks-pro-2026/02-purchasing-payables-inventory.md) first.

| Task | What | Needs |
|---|---|---|
| P3.1 | Vendors: default expense account, terms, a 1099 flag and W-9 status, a duplicate warning and a balance from open documents. | P1.3 |
| P3.2 | Bills: lines by account or product, supplier sales tax folded into cost, due dates, edit and repost, void and attachments. | P3.1, P2.4 |
| P3.3 | Pay bills: one payment per vendor from a bank or card account, check numbers, an overdraw warning and void rules. | P3.2 |
| P3.4 | Expenses and card charges for spending without a bill. | P3.1 |
| P3.5 | Vendor credits, applied to bills. | P3.2 |
| P3.6 | Purchase orders that convert to bills. | P3.2 |
| P3.7 | A/P aging tied to payables, and a 1099-NEC totals report that leaves out voided payments. | P3.3 |

Phase 3 is done when the demo company enters, pays and ages its bills, and the 1099 totals match its payments.

### Phase 4. Banking

Read the banking subsections of [§3](../research/slowbooks-pro-2026/03-general-ledger-banking.md) first.

| Task | What | Needs |
|---|---|---|
| P4.1 | Bank and card accounts, and a register that shows ledger lines with a running balance. | P1.3 |
| P4.2 | Transfers, including paying a credit card. | P4.1 |
| P4.3 | Statement import: CSV with a column mapping saved per bank, OFX and QFX, and duplicate detection. | P4.1 |
| P4.4 | Review queue: match to existing postings by amount, side, a date window and check number; add with a category; exclude and restore. | P4.3, P2.7, P3.3 |
| P4.5 | Bank rules that suggest a category and never post by themselves. | P4.4 |
| P4.6 | Reconciliation: statement balance, tick cleared lines, a zero difference to finish, reconciled lines locked, a report and PDF, and an admin undo of the latest one. | P4.4 |
| P4.7 | A Plaid connection behind a feature flag. | P4.4 |

Phase 4 is done when the demo company imports, matches and reconciles a month of bank activity.

### Phase 5. Reports, dashboard and tax

Read [§5 Reports, dashboard, analytics and AI](../research/slowbooks-pro-2026/05-reports-dashboard-analytics-ai.md) first.

| Task | What | Needs |
|---|---|---|
| P5.1 | Report center: period presets, comparison columns, class and location filters, saved reports, and CSV and PDF for every report. | P1.6 |
| P5.2 | Cash flow statement, indirect method. | P1.6 |
| P5.3 | Sales tax liability by tax code, and a flow to pay it. | P2.3 |
| P5.4 | Schedule C mapping for sole proprietors, with CSV export. | P1.6 |
| P5.5 | Dashboard cards for bank balances, money in and out, receivables, payables, overdue invoices and profit this month, arranged per user. | P2.12, P3.7, P4.1 |
| P5.6 | Search across names, numbers and amounts. | P2.5, P3.2 |
| P5.7 | Full export of an organization as CSV files plus JSON in one zip. | P1.3 |

The private beta starts when all of this holds:

- The demo company runs a full month: invoices, payments, deposits, bills, bill payments, a bank import, a reconciliation and a month-end close.
- Trial balance, profit and loss, balance sheet, general ledger, both agings and cash flow agree with each other and with the property suite.
- Two users with different roles share one organization, and a second organization can't read anything of the first.
- A restore from backup works on staging.
- An outside accountant has reviewed the demo company's postings and reports.

### Phase 6. Moving in

Read [§7 Import, export, migration and interoperability](../research/slowbooks-pro-2026/07-import-export-migration.md) first.

| Task | What | Needs |
|---|---|---|
| P6.1 | Import framework: upload, a dry run with row fates, apply, safe reruns and an import log. | P1.8 |
| P6.2 | CSV imports for customers, vendors, products, opening balances, and open invoices and bills. | P6.1 |
| P6.3 | QuickBooks Online over OAuth: chart, customers, vendors, products and open documents, then history, with an ID map so reruns update instead of duplicating. | P6.1 |
| P6.4 | Xero and Wave exports. | P6.1 |
| P6.5 | QuickBooks Desktop IIF files. | P6.1 |

### Phase 7. Receipts and AI

Read the [receipt scanning](../research/slowbooks-pro-2026/02-purchasing-payables-inventory.md#receipt-scanning--engines-upload-and-intake-bucket) and [AI](../research/slowbooks-pro-2026/05-reports-dashboard-analytics-ai.md) parts of the inventory first.

| Task | What | Needs |
|---|---|---|
| P7.1 | Receipt inbox: upload photos and PDFs, keep them in the bucket and link them to documents. | P0.3 |
| P7.2 | Receipt reading with Claude: vendor, date, totals, tax and lines as structured output, reviewed by a person before it becomes a bill or expense. Load the `claude-api` skill before starting. | P7.1, P3.4 |
| P7.3 | Vendor memory: the account and category last used for each vendor. | P7.2 |
| P7.4 | Monthly summary: a plain-language read of profit and loss and cash, with the figures it used shown beside it. | P5.1 |

AI never posts on its own. Each organization turns it on, and usage has a monthly cap.

### Phase 8. Launch

| Task | What |
|---|---|
| P8.1 | Subscriptions with Stripe Billing: plans, trials, limits and the customer portal. |
| P8.2 | Onboarding: create a company, pick a chart, import or connect a bank, invite an accountant. |
| P8.3 | Security review: authorization tests for every action, a dependency audit, CodeQL, secret scanning and a penetration-test checklist. |
| P8.4 | Backups: point-in-time recovery, a restore drill and a status page. |
| P8.5 | Privacy policy, terms, data retention and account deletion. |
| P8.6 | Marketing site, help center and the generated API reference. |
| P8.7 | Performance: a demo company with 10,000 invoices, and a time budget for every report. |

### Phase 9. Modules by demand

Build these in the order beta users ask for them. Each gets its own short plan when it starts.

- Inventory with weighted average cost and automatic cost of goods sold. See [§2](../research/slowbooks-pro-2026/02-purchasing-payables-inventory.md).
- Projects and job costing, with cost codes and budget against actual. See [§6](../research/slowbooks-pro-2026/06-nonprofit-jobs-job-costing.md).
- Class and location screens. Journal lines carry both tags from phase 1.
- Multi-currency screens. The data model carries currencies from phase 1.
- Fixed assets and depreciation, and budgets. See [§3](../research/slowbooks-pro-2026/03-general-ledger-banking.md).
- Nonprofit mode: the wording layer, funds with restrictions and the nonprofit statements. See [§6](../research/slowbooks-pro-2026/06-nonprofit-jobs-job-costing.md).
- Payroll through a partner API. [§4](../research/slowbooks-pro-2026/04-payroll-hr.md) lists the behavior users will expect.
- A public API with tokens, and an MCP server so agents can keep books in BeeKeeping. See [§8](../research/slowbooks-pro-2026/08-platform-security-administration.md).
- A phone app for receipts, approvals and the dashboard. If it sells through the app stores, RevenueCat manages those subscriptions next to Stripe on the web.
- An accountant workspace that lists every client organization in one place.

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
| Opening balances wizard | CSV import of opening balances | 6 |
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

## Setup list

These need you before or during phase 0.

1. **Repo visibility.** The repo is public, so anyone can read this plan and the inventory. A paid product usually keeps its code private.
2. **A main branch.** The only branch is `claude/stoic-wright-ap21aq`, and GitHub made it the default. Create `main` from it and make `main` the default, or ask me to push `main`.
3. **Greptile.** Install the Greptile GitHub app on this repo so `/greploop` can review PRs.
4. **Railway.** A BeeKeeping project with staging and production environments, Postgres and a bucket. I can create it with the Railway tools when you say so.
5. **Accounts for phases 0 to 2.** Resend, Stripe with Connect, an Anthropic API key and Sentry. Keys go in Railway variables, never in the repo.
6. **The assumptions** at the top of this plan.

## First tasks

Once `main` exists and Railway is set up, I'd start with P0.1, then run P0.2 and P0.3 in parallel sessions. P0.4 to P0.8 follow in order, so phase 0 is eight PRs. After that I'd turn the rest of the roadmap into GitHub issues, one per task, with the Needs column as links, so parallel sessions can pick up work without overlapping.
