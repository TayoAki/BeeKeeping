# BeeKeeping execution plan

This is the playbook for building all of BeeKeeping with the skills in `.claude/skills/`. The [build plan](build-plan.md) says what to build and why. This file says which task comes next, which skill runs at each step of that task, how each skill runs in this repo, and what proof each task leaves behind. Work through it from the first task to the last module and the whole app gets built, about 120 pull requests in all.

Written 2026-09-29.

## Contents

1. [How the documents fit together](#how-the-documents-fit-together)
2. [Before the first task](#before-the-first-task)
3. [The task loop](#the-task-loop)
4. [Skills at a glance](#skills-at-a-glance)
5. [Task types](#task-types)
6. [Writing code with code-structure](#writing-code-with-code-structure)
7. [Running tasks in parallel](#running-tasks-in-parallel)
8. [Every task, phase by phase](#every-task-phase-by-phase)
9. [Gates](#gates)
10. [When to stop and ask](#when-to-stop-and-ask)
11. [Keeping this plan current](#keeping-this-plan-current)

## How the documents fit together

| File | Answers | Changes when |
|---|---|---|
| `research/slowbooks-pro-2026/` | How should a feature behave? | Never. It is a snapshot of SlowBooks Pro 2.18.1. |
| `docs/build-plan.md` | What are we building, on what stack, and why? | A product or architecture decision changes. |
| `docs/execution-plan.md` | Which task is next, and how does each skill run on it? | Scope changes, through a docs PR. |
| `AGENTS.md` | Which rules does every session follow? | A rule changes, or P0.1 writes in the commands. |
| `.claude/skills/` | How does each step work in detail? | You update the skills. |

## Before the first task

Tasks marked "Setup" in the Needs column wait for these.

| Step | Who | Why the skills need it |
|---|---|---|
| Create `main` from `claude/stoic-wright-ap21aq` and make it the default branch | You, or me once you say go | `new-feature` branches every task from `origin/main`. |
| Install the Greptile GitHub app on the repo | You | `greploop` has no reviewer without it. |
| Create the Railway project with staging, PR environments, Postgres and a bucket | Me, with the Railway tools, once you say go | `before-and-after` needs staging for the "before" and a PR environment for the "after". |
| Open accounts with Resend, Stripe with Connect, Anthropic and Sentry, and later Plaid | You | Integration tasks prove themselves in each provider's test mode. Keys go in Railway variables, never in the repo. |
| Decide who merges | You | See [Merging](#merging). |
| Decide whether the repo stays public | You | A paid product usually keeps its code private. |

## The task loop

Every task runs the same loop. AGENTS.md names the skills, and this section says how each one runs in BeeKeeping.

```
pick a task
  -> /new-feature                branch, scope check, fresh install
  -> read the spec               task row, inventory section, lessons
  -> /code-structure             tests first, then actions and services
  -> /evidence-driven-testing    checks, then proof in .artifacts/<task>/
  -> review your own work        /code-review, and /security-review for +sec
  -> open the PR                 /unslop on the text, /before-and-after for UI
  -> /greploop                   until 5/5 with zero unresolved comments
  -> merge                       the tasks that needed it unlock
```

### 1. Pick a task

Take the first task in [the task list](#every-task-phase-by-phase) whose Needs have all merged and that no open PR or other session has claimed. When tasks live in GitHub issues, assign the issue before starting.

### 2. Isolate with /new-feature

Run steps 1, 2 and 5 of the skill. Claude Code creates and names the branch, so skip steps 3 and 4.

- Step 1 is `git fetch origin`.
- Step 2 is the scope check. List open PRs with the GitHub tool `list_pull_requests`, then read each one's changed files with `pull_request_read` and `get_files`. If the task needs a file another PR is changing, stop and ask. Run `git status` to catch uncommitted work.
- Step 5 confirms the branch with `git branch --show-current`, installs dependencies fresh with `pnpm install`, and checks the Node version the repo pins.

### 3. Read the spec

Read the task's row, the inventory section its phase links, and every row of the build plan's lessons table that touches the task. Turn them into a short list of acceptance rules. The list opens the PR body, and each rule gets a test.

### 4. Build with /code-structure

Write the tests for the acceptance rules first. Then write the flow as an action and pull out only what [Writing code with code-structure](#writing-code-with-code-structure) says to pull out. `apps/web` stays thin. A server action or route handler parses the input with zod, builds the action context and calls one action.

### 5. Prove with /evidence-driven-testing

Run the checks first. Evidence adds to them and never replaces them. Then capture the proof the task's row asks for, in `.artifacts/<task>/`.

- Cloud sessions have no display, so use the skill's headless path. The P0.8 helper signs in as the demo user, walks the flow in Playwright, and saves numbered screenshots, a video and `assertions.md`. That file has one line per `test_start` and `assertion`, each marked passed, failed or untested with a reason.
- A task with no screen writes numbers or output pairs to `probe-output.txt`.
- A bug fix captures the failure before the fix and the pass after it. The failing capture is the "before".
- Every capture shows the demo company. No real name, key or bank number goes in one.
- The report starts with the commit hash and branch it tested.

On a machine with a display, the skill's recorder at `scripts/evidence.py` can replace the headless path. It needs ffmpeg.

### 6. Review your own work

- Run `/code-review` on the branch, at high effort for any task that posts to the ledger or changes the schema.
- Run `/security-review` for tasks tagged +sec, and fix what it finds before opening the PR.
- Run `/simplify` if the diff passes 800 lines or reads badly.

### 7. Open the PR

- Commit messages, the PR title and the PR body go through `/unslop` first.
- The PR body has five parts: the acceptance rules, what changed, how it was tested with the evidence, the before and after, and risks or follow-up work. The P0.9 template lays them out.
- For UI tasks, run `/before-and-after`. Capture the same page on staging and on the PR's Railway environment with the P0.8 helper, run `before-and-after before.png after.png --markdown`, and paste the table into the PR body. The upload hosts are public, which is acceptable only because the images show the demo company. A new page has no real "before", so the before is whatever staging shows at that route. In cloud sessions, set `AGENT_BROWSER_ARGS="--no-sandbox"` first.
- Open the PR with `create_pull_request` and subscribe to its activity, so CI failures and review comments come back to the session.

### 8. Loop with /greploop

- Start a round by posting `@greptile review` as a PR comment with `add_issue_comment`.
- Read the review with `pull_request_read`. Fix what it asks, push, answer each thread with `add_reply_to_pull_request_comment`, resolve it with `resolve_review_thread`, and start the next round.
- Stop at 5/5 with zero unresolved comments. The skill allows ten rounds.
- If Greptile answers that too many files changed, switch to `/greploop-apps`, which tags `@greptile-apps` instead.
- If a comment asks for something that breaks a hard invariant in AGENTS.md or contradicts this plan, reply with the reason and leave the code alone.
- Fix red CI before starting the next round.

### 9. Hand off

End with the PR link. Merge only with a go-ahead under [Merging](#merging). The tasks that needed this one unlock when it merges.

## Skills at a glance

| Skill | Use it | Skip it |
|---|---|---|
| `new-feature` | First, on every task, fixes and docs included | Never |
| `code-structure` | While writing code that adds behavior, and when a second caller needs code that already exists | Docs, CI files, styling-only changes |
| `evidence-driven-testing` | Before every PR, and before writing the fix for a bug | Docs-only PRs, which say so in the body |
| `before-and-after` | At PR time, for tasks with a visible change | No visible change |
| `greploop` | On every PR, once it is open | Never |
| `greploop-apps` | When Greptile says too many files changed | Any other time |
| `unslop` | Commit messages, PR text, docs, code comments, review replies and the closing message | Text you didn't write or change |
| `session-start-hook` | P0.2, and again when setup commands change | Otherwise |
| `code-review` | Before every PR, at high effort for ledger and schema work | Docs-only PRs |
| `security-review` | Tasks tagged +sec, and at every gate | Otherwise |
| `claude-api` | Before writing code that calls Claude, in tasks tagged +ai | Otherwise |
| `dataviz` | Before writing chart code, in tasks tagged +viz | Otherwise |
| `simplify` | When a diff passes 800 lines or reads badly | Otherwise |
| `run` | When you need the app running to look at a change. It finds `pnpm dev:demo` from P0.8 | Otherwise |

The first seven live in `.claude/skills/`. The rest come with Claude Code in this environment.

## Task types

Each task has a type. The type decides what proof the task leaves and whether its PR gets screenshots.

| Type | Covers | Proof | Before-and-after |
|---|---|---|---|
| UI | A screen or flow a person uses | Video of the flow, numbered screenshots and `assertions.md` | Yes |
| CORE | Logic with no screen | Output pairs or numbers in `probe-output.txt` | No. The PR shows the output table. |
| DATA | Schema, migrations and row-level security | The migration applied to a fresh database, and cross-organization test output | No |
| IMPORT | Reading another product's files | Dry-run output on fixture files, then a rerun that changes nothing | No |
| INTEG | Stripe, Plaid, Resend, Claude, QuickBooks Online, RevenueCat or a payroll partner | A test-mode transcript with request ids, webhook events and the postings they made, with no keys in it | Only when a screen changed |
| INFRA | Tooling, CI, deploys and hooks | Command transcripts and the CI run | No |
| DOCS | Documentation only | None | No |
| FIX | A bug found after a task merged | The failure captured before the fix, the pass after | When the bug shows on screen |

A task with two types, such as DATA and UI, leaves both kinds of proof. Tags add steps:

- **+sec** runs `/security-review` before the PR opens.
- **+ai** loads `claude-api` before any code that calls Claude.
- **+viz** loads `dataviz` before any chart code.
- **+big** expects Greptile's file limit, so plan on `/greploop-apps`.

## Writing code with code-structure

The skill's one rule is that actions decide the why and when, and services do the reusable how. In BeeKeeping that splits code three ways.

**Actions** in `packages/actions` decide things.

- Who may do it, and whether it's allowed now, meaning the role, the document's status, the closing date and the credit limit.
- What a document means in the ledger, which is its posting rules.
- What the user sees when it fails.
- Actions read and write our tables with Drizzle, inside the request's transaction.

**Services** in `packages/services` do mechanics that two or more actions share.

- They take everything as parameters and return `{ ok: true, ... }` or `{ ok: false, reason }`.
- They never read the session and never touch our tables. The skill calls a service that writes tables a leaky service.
- They don't throw for failures they expect.

**Shared actions** in `packages/actions/shared` hold orchestration that many actions need and that writes our tables. `postEntry` is the only way into the ledger. It asks the `ledger` service to check the entry, checks the closing date and the accounts, inserts the lines in the caller's transaction, and returns the entry id. `nextNumber` hands out document numbers and retries when two users save at the same moment.

A mechanic with one caller stays in its action. When a second caller needs it, follow the skill's migration checklist: extract it, move one caller, run the checks, then move the rest.

These services have at least two callers in this plan, so they start life as services:

| Service | What it does | Callers |
|---|---|---|
| `money` | Minor units, rounding, parsing and formatting | Every amount |
| `ledger` | Builds entries, checks that they balance, builds reversals | `postEntry`, every void, opening balances and imports |
| `terms` | Works out due dates from payment terms | Invoices, bills, recurring runs, conversions and imports |
| `numbering` | Formats and parses document numbers | `nextNumber` and imports |
| `tax` | Tax per line and per code | Invoices, sales receipts, estimates, credit memos and bills |
| `pdf` | Template and data in, PDF bytes out | Every document, statements and reports |
| `email` | Sends through Resend and reports delivery | Documents, statements and invitations |
| `storage` | Stores, fetches and signs files in the bucket | Attachments, receipts, PDFs and exports |
| `fx` | Fetches and looks up exchange rates | Every foreign-currency document |
| `import/*` | Parses one file format into typed rows | Each importer |

Code review checks for the skill's four anti-patterns: a god service that hides the whole flow, a service that writes tables, services whose arguments or errors take different shapes, and a service pulled out for a single caller.

## Running tasks in parallel

### Waves

Tasks whose Needs have merged and whose files don't overlap can run at the same time in separate sessions. Each phase below lists its waves. A wave is what can start together, not what must. Three sessions at once is a sensible ceiling while you review every PR, because review becomes the bottleneck after that.

Two things collide even when files don't.

- Migrations. When two branches each add one, the branch that merges second deletes its migration, rebases and generates it again.
- The lockfile. Regenerate it after rebasing. Never merge it by hand.

### Three ways to run a wave

1. **You start the sessions.** Open a Claude Code session per task and paste the kickoff prompt below.
2. **Issues.** I turn this plan into GitHub issues, one per task, each with the kickoff prompt, its Needs as links and labels for phase and type. Sessions start from the issues, and a project board shows status.
3. **A coordinator session.** One session starts a child session per task with the Claude Code tools, watches their PRs and starts the next wave as merges land. It needs your go-ahead, because it runs several sessions at once.

### Kickoff prompt

```
Build task P2.7 from docs/execution-plan.md.
Follow AGENTS.md and the task loop in the plan. Run /new-feature first,
read the spec, build with /code-structure, prove it with
/evidence-driven-testing, open the PR with /unslop and /before-and-after,
and run /greploop until Greptile gives 5/5 with no unresolved comments.
Stop and ask if the scope check finds overlap or the spec leaves a money
rule undecided. End with the PR link.
```

### Merging

AGENTS.md says nothing merges without your instruction, so by default you merge each PR. If you'd rather not, add a line to AGENTS.md that allows merging once CI is green, Greptile gives 5/5 and the evidence is attached. I'd still keep DATA tasks, anything that posts to the ledger and anything tagged +sec for you to merge yourself.

## Every task, phase by phase

Each task is one PR of about 800 changed lines or fewer. [Task types](#task-types) explains the types and tags.

### Phase 0. Foundations

Phase 0 ends with an app you can sign in to, with organizations, CI, staging, and the evidence tools every later task uses. For behavior, read [§8 Platform](../research/slowbooks-pro-2026/08-platform-security-administration.md) and [§9 UI](../research/slowbooks-pro-2026/09-ui-desktop-deployment-engineering.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P0.1 | A pnpm workspace with `apps/web`, `apps/worker` and the packages from the build plan. TypeScript strict, ESLint, Prettier, Vitest, and a GitHub Actions workflow that runs typecheck, lint and tests on every PR. Write the exact commands into AGENTS.md. | INFRA +big | Each check passing in the session, and the green CI run | Setup |
| P0.2 | A SessionStart hook that installs dependencies, so every cloud session can run the checks. Load `session-start-hook` first. | INFRA | A new session's log showing the hook ran and `pnpm test` passed | P0.1 |
| P0.3 | Postgres with Drizzle and migrations. A throwaway Postgres that starts inside a cloud session without Docker, a Postgres service in CI, and the Railway project with staging and PR environments. | DATA, INFRA | Migrations applied to a fresh database in the session and in CI, and the staging health check answering | P0.1 |
| P0.4 | Sign-in with Better Auth: email and password, magic links, two-factor, organizations, invitations, the four roles and sign-out everywhere. | UI +sec | Video of signing up, creating an organization, inviting a bookkeeper, signing in as them and being refused an admin page | P0.3 |
| P0.5 | Tenancy: the action context, the `set local` settings, row-level security on every table, and a test that calls every action with another organization's ids. | DATA +sec | The test output, with one "not found" per action | P0.4 |
| P0.6 | Audit log triggers with a field allowlist per table, and an admin page to read the log. | DATA, UI +sec | Output showing a change to a secret field leaves nothing in the log, and a screenshot of the page | P0.5 |
| P0.7 | The app shell: navigation, organization switcher, a Ctrl+K palette, light and dark themes, toasts in a live region, dialogs that manage focus, and axe in CI. | UI | Screenshots in both themes and an axe report with no violations | P0.4 |
| P0.8 | The demo company and evidence tools: a seed for a US service business that PR environments also load, `pnpm dev:demo` to run the app on it, and a Playwright helper that signs in as the demo user and writes screenshots, video and `assertions.md` to `.artifacts/<task>/`. | INFRA | The helper's own output for the sign-in flow | P0.5, P0.7 |
| P0.9 | A PR template with the five parts of the PR body, and a demo login on staging kept in Railway variables. | DOCS | None | P0.3 |

Run P0.1 first. Then P0.2, P0.3 and P1.1 together. Then P0.4 and P0.9. Then P0.5 and P0.7. Then P0.6 and P0.8. Gate G0 closes the phase.

### Phase 1. The ledger

Phase 1 ends with a ledger that refuses bad entries and four reports that agree. For behavior, read [§3 General ledger](../research/slowbooks-pro-2026/03-general-ledger-banking.md) and the build plan's ledger section.

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P1.1 | The `money` service: minor units, half-up rounding, parsing, formatting and currency codes. | CORE | A property-test run with its seed, and a table of rounding cases in and out | P0.1 |
| P1.2 | Chart of accounts: types, parents, numbers, system roles, the default US chart created with each organization, and the rules for deactivating and deleting. | DATA, UI | Screenshot of the chart, and output showing a used account refuses deletion but can be deactivated | P0.5 |
| P1.3 | The ledger: entry and line tables with the database rules from the build plan, the `ledger` service, and the `postEntry` shared action. | DATA, CORE +sec | Output pairs showing an unbalanced entry refused by the database, an update to a posted line refused, and a reversal that returns the accounts to zero | P1.1, P1.2 |
| P1.4 | Closing date with an admin override and a reason, both audited, and a ten-minute lock after five wrong override attempts. | CORE, UI +sec | Video of posting into a closed period, the override prompt and the audit entry | P1.3 |
| P1.5 | Manual journal entries: a grid with running totals, attachments and void. | UI | Video of a balanced entry saved, an unbalanced one refused, and a void | P1.3, P1.10 |
| P1.6 | First reports: trial balance, general ledger, profit and loss and balance sheet, each drilling into its entries, with a basis switch. Cash basis gets its document rules in P2.12 and P3.7. | UI | Screenshots of each report on demo data, and a tie-out table showing equal trial balance totals and net income equal to the change in equity | P1.3 |
| P1.7 | The ledger property suite, run in CI. | CORE | The fast-check run with its iterations, seed and each invariant checked | P1.3 |
| P1.8 | Chart of accounts import from CSV with a dry run. | IMPORT | Dry-run output on a fixture file, then a rerun that changes nothing | P1.2 |
| P1.9 | Opening balances: account balances as of a start date, posted against opening balance equity. | UI | Video of entering balances and the balance sheet showing them | P1.6 |
| P1.10 | The `storage` service and attachments on any record, with signed URLs, allowed types and a size limit. | DATA, INTEG +sec | Output showing an oversized file and a wrong type refused, and another organization's file not found | P0.5 |

P1.1 starts during phase 0. Then P1.2 and P1.10 together. Then P1.3 and P1.8. Then P1.4, P1.5, P1.6 and P1.7, three at a time. Then P1.9. Gate G1 closes the phase.

### Phase 2. Sales and receivables

Phase 2 ends with the demo company invoicing, collecting, depositing and sending statements for a month. For behavior, read [§1 Sales and accounts receivable](../research/slowbooks-pro-2026/01-sales-accounts-receivable.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P2.1 | Customers: contact and address fields, terms, tax exemption, credit limit, inactive status, a duplicate-name warning, and a balance from open documents. | UI | Video of creating a customer, the duplicate warning and deactivation | P1.3 |
| P2.2 | Products and services with an income account, a price to four decimals and a taxable flag. | UI | Screenshot of the list and form, and output showing each line rounds to the cent | P1.2 |
| P2.3 | Sales tax: tax codes with combined rates to four decimal places of a percent, a taxable flag per line, exempt customers, and sales tax payable per code. | CORE, UI | Output pairs of taxable and exempt lines in and tax per code out, and a screenshot of the tax settings | P2.2 |
| P2.4 | The `terms` and `numbering` services and the `nextNumber` shared action. | CORE | A table of terms and dates in and due dates out, with "Due on Receipt" landing on the same day, and numbers with prefix and padding, including a simulated collision that retries | P1.3 |
| P2.5a | Invoices, part one: draft, edit, post, the posting rules and the $0.00 question. | UI | Video of an invoice from draft to posted, the $0.00 question, and the drill-down into its entry | P2.1, P2.2, P2.3, P2.4 |
| P2.5b | Invoices, part two: void, duplicate, edit and repost, and the credit limit check on the server. | UI | Video of a void with its reversing entry, and the server refusing an invoice over the credit limit | P2.5a |
| P2.6 | Document PDFs and email: the `pdf` and `email` services, the renderer in the worker, the logo, and delivery status on the document. | INTEG | The demo invoice's PDF, and a Resend test-mode delivery event shown on the invoice | P2.5a, P1.10 |
| P2.7 | Receive payments: oldest invoice first, a leftover kept as credit only when the user asks, credits applied later, undeposited funds, and void rules. | UI | Video of a payment split across invoices, a kept credit applied later, and a void | P2.5a |
| P2.8 | Deposits that remember their payments, and payments that can't be voided while deposited. | UI | Video of a deposit and the refused void | P2.7 |
| P2.9 | Credit memos and bad-debt write-offs. | UI | Video of issuing, applying and voiding a credit memo, with aging before and after | P2.5b |
| P2.10 | Estimates that convert to invoices, and sales receipts with a walk-in customer. | UI | Video of both flows | P2.5a |
| P2.11 | Recurring invoices on the scheduler, with a report per item. | CORE, UI | Output of a run where one template sits in a closed period and the others still post | P2.5a |
| P2.12 | Customer statements, A/R aging tied to the receivables account, and cash-basis rules for sales. | UI | Screenshot of aging beside the receivables balance, equal to the cent | P2.7 |
| P2.13 | Pay online with Stripe Connect: onboarding, a link on each invoice, and recording from the webhook and the return page, in the invoice's currency. | INTEG, UI +sec | Stripe test-mode transcript of a euro invoice paid in euros, and one webhook delivered twice but recorded once | P2.7 |
| P2.14 | Late fees as invoice lines with their own posting. | CORE, UI | Output pairs showing the fee line added, kept through an edit and reversed by a void | P2.5b |
| P2.15 | A quick entry grid for paper backlogs. | UI | Video of ten invoices entered from the keyboard | P2.5a |

Start P2.1, P2.2 and P2.4 together. Then P2.3. Then P2.5a. Then any three of P2.5b, P2.6, P2.7, P2.10, P2.11 and P2.15. Then P2.8, P2.9, P2.12, P2.13 and P2.14 as their needs merge. Phase 3 can run beside phase 2 once P1.3 and P2.4 are in.

### Phase 3. Purchases and payables

Phase 3 ends with the demo company entering, paying and aging its bills. For behavior, read [§2 Purchasing and payables](../research/slowbooks-pro-2026/02-purchasing-payables-inventory.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P3.1 | Vendors: default expense account, terms, a 1099 flag and W-9 status, a duplicate warning, and a balance from open documents. | UI | Video of creating a vendor and the duplicate warning | P1.3 |
| P3.2 | Bills: lines by account or product, supplier sales tax spread into the cost of each line, due dates, edit and repost, void and attachments. | UI | Video of a bill with supplier tax spread over its lines, then edited and reposted | P3.1, P2.4 |
| P3.3 | Pay bills: one payment per vendor from a bank or card account, check numbers, the overdraw warning, and void rules. | UI | Video of paying three bills from two vendors and voiding one payment | P3.2 |
| P3.4 | Expenses and card charges for spending without a bill. | UI | Video of each | P3.1 |
| P3.5 | Vendor credits applied to bills. | UI | Video of a credit applied to a bill | P3.2 |
| P3.6 | Purchase orders that convert to bills. | UI | Video of a purchase order becoming a bill | P3.2 |
| P3.7 | A/P aging tied to payables, a 1099-NEC totals report that leaves out voided payments, and cash-basis rules for purchases. | UI | Screenshot of aging beside the payables balance, and a table of 1099 totals with a voided payment left out | P3.3 |

Run P3.1 first. Then P3.2 and P3.4. Then P3.3, P3.5 and P3.6. Then P3.7.

### Phase 4. Banking

Phase 4 ends with a month of demo bank activity imported, matched and reconciled. For behavior, read the banking subsections of [§3](../research/slowbooks-pro-2026/03-general-ledger-banking.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P4.1 | Bank and card accounts, and a register of ledger lines with a running balance. | UI | Screenshot of a register whose balance matches the ledger | P1.3 |
| P4.2 | Transfers, including paying a credit card. | UI | Video of paying the card from checking | P4.1 |
| P4.3 | Statement import: CSV with a column mapping saved per bank, OFX and QFX, and duplicate detection. | IMPORT | Dry-run output for three bank formats, and a second import skipped as duplicates | P4.1 |
| P4.4 | The review queue: match by amount, side, a date window and check number, add with a category, exclude and restore. | UI | Video of an automatic match, a manual match, an add, an exclude and a restore | P4.3, P2.7, P3.3 |
| P4.5 | Bank rules that suggest a category and never post on their own. | UI | Screenshot of a suggestion, and output showing nothing posted without a click | P4.4 |
| P4.6 | Reconciliation: statement balance, ticked cleared lines, a zero difference to finish, reconciled lines locked, a report and PDF, and an admin undo of the latest one. | UI | Video of a month reconciled to zero, and the report PDF | P4.4 |
| P4.7 | A Plaid connection behind a feature flag. | INTEG +sec | Plaid sandbox transcript of linking, syncing and lines arriving in the review queue | P4.4 |

Run P4.1 first. Then P4.2 and P4.3. Then P4.4. Then P4.5, P4.6 and P4.7.

### Phase 5. Reports, dashboard and tax

Phase 5 finishes the first release. For behavior, read [§5 Reports, dashboard, analytics and AI](../research/slowbooks-pro-2026/05-reports-dashboard-analytics-ai.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P5.1 | Report center: period presets, comparison columns, class and location filters, saved reports, and CSV and PDF for every report. | UI | Screenshots, plus the CSV and PDF of each report | P1.6 |
| P5.2 | Cash flow statement, indirect method. | CORE, UI | A tie-out showing the net change in cash equals the change in bank balances | P1.6 |
| P5.3 | Sales tax liability by code, and a flow to pay it. | UI | Video of the report, the payment and the liability at zero | P2.3 |
| P5.4 | Schedule C mapping for sole proprietors, with CSV export. | CORE | A table of accounts mapped to lines, with net profit equal to the P&L | P1.6 |
| P5.5 | The dashboard: bank balances, money in and out, receivables, payables, overdue invoices and profit this month, with cards arranged per user. | UI +viz | Screenshots in both themes | P2.12, P3.7, P4.1 |
| P5.6 | Search across names, numbers and amounts. | UI | Video of finding an invoice by its amount | P2.5a, P3.2 |
| P5.7 | Full export of an organization as CSV files plus JSON in one zip. | CORE | The zip's file list, with row counts that match the database | P1.3 |

P5.1, P5.2, P5.4 and P5.7 can start as soon as their needs merge, long before the rest of the phase. P5.3, P5.5 and P5.6 follow theirs. Gate G2 opens the private beta.

### Phase 6. Moving in

Phase 6 lets beta users bring their books. For behavior, read [§7 Import and migration](../research/slowbooks-pro-2026/07-import-export-migration.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P6.1 | The import framework: upload, a dry run with each row's fate, apply, safe reruns and an import log. | IMPORT | A dry run and a rerun on a fixture | P1.8 |
| P6.2 | CSV imports for customers, vendors, products, opening balances, and open invoices and bills. | IMPORT | A dry run for each file type | P6.1 |
| P6.3 | QuickBooks Online over OAuth: chart, customers, vendors, products and open documents, then history, with an ID map for reruns. | INTEG +sec | A sandbox company imported, with counts per type, a rerun that updates instead of duplicating, and `false` flags still false | P6.1 |
| P6.4 | Xero and Wave exports. | IMPORT | Dry runs on real export files | P6.1 |
| P6.5 | QuickBooks Desktop IIF files. | IMPORT | A dry run on a file with quoted commas, ALL-CAPS names, sub-accounts and credit card accounts | P6.1 |

Run P6.1 first, then the four importers three at a time.

### Phase 7. Receipts and AI

Phase 7 turns receipt photos into draft bills and expenses. For behavior, read [receipt scanning in §2](../research/slowbooks-pro-2026/02-purchasing-payables-inventory.md#receipt-scanning--engines-upload-and-intake-bucket) and [the AI parts of §5](../research/slowbooks-pro-2026/05-reports-dashboard-analytics-ai.md). AI never posts on its own, each organization turns it on, and usage has a monthly cap.

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P7.1 | A receipt inbox: upload photos and PDFs and link them to documents. | UI | Video of an upload linked to a bill | P1.10 |
| P7.2 | Receipt reading with Claude: vendor, date, totals, tax and lines as structured output, reviewed by a person before it becomes a bill or expense. | INTEG, UI +ai +sec | A table of ten fixture receipts with the fields read beside the fields expected, and a video of the review step | P7.1, P3.4 |
| P7.3 | Vendor memory: the account and category last used for each vendor. | CORE | Output pairs showing the second receipt from a vendor gets the remembered account | P7.2 |
| P7.4 | A monthly summary of profit and loss and cash in plain language, with the figures it used beside it. | INTEG +ai | The demo month's summary with its figures | P5.1 |

Run P7.1 and P7.4 together. Then P7.2. Then P7.3.

### Phase 8. Launch

Phase 8 gets the app ready for the public.

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P8.1 | Subscriptions with Stripe Billing: plans, trials, limits and the customer portal. | INTEG +sec | Stripe test-mode transcript of a trial, an upgrade and a cancellation, and a plan limit enforced | P0.4 |
| P8.2 | Onboarding: create a company, pick a chart, import or connect a bank, invite an accountant. | UI | Video from sign-up to the first invoice | P6.2, P4.3 |
| P8.3 | Security review: authorization tests for every action, a dependency audit, CodeQL, secret scanning and a penetration-test checklist. | INFRA +sec | The `/security-review` report with every high finding closed, and the authorization test output | P8.1, P8.2 |
| P8.4 | Backups: point-in-time recovery, a restore drill and a status page. | INFRA | The restore drill's log with its timings | P0.3 |
| P8.5 | Privacy policy, terms, data retention and account deletion. | UI | Video of deleting an organization, and its data gone after the retention job runs | P0.4 |
| P8.6 | Marketing site, help center and the generated API reference. | DOCS | None | P5.1 |
| P8.7 | Performance: a demo company with 10,000 invoices and a time budget for every report. | CORE | A table of report timings against their budgets | P5.1 |

P8.1, P8.4, P8.5 and P8.6 can start whenever their needs merge. P8.2 and P8.7 come next and P8.3 last. Gate G3 opens the app to the public.

### Phase 9. Modules

Phase 9 builds the rest of the app, module by module, in the order beta users ask for them. Each module's first PR refreshes its rows here, since the beta will change them, and each module ends at a module gate.

#### 9A. Classes and locations

Behavior: classes in [§3](../research/slowbooks-pro-2026/03-general-ledger-banking.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9A.1 | Class and location lists, and pickers on every document and line. | UI | Video of tagging an invoice line and a bill line | P2.5a, P3.2 |
| P9A.2 | Reports split and filtered by class and location. | UI | P&L by class with a total equal to the plain P&L | P9A.1, P5.1 |

#### 9B. Multi-currency

Behavior: foreign currency in [§1](../research/slowbooks-pro-2026/01-sales-accounts-receivable.md) and [§3](../research/slowbooks-pro-2026/03-general-ledger-banking.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9B.1 | The `fx` service, a daily rate job and manual overrides. | INTEG | Output of a day's rates fetched, and a document refusing to save without a rate | P1.1 |
| P9B.2 | Foreign-currency invoices, bills and payments, with realized gain and loss. | UI | Video of a euro invoice paid at a later rate and the gain posted | P9B.1, P2.7, P3.3 |
| P9B.3 | Period-end revaluation of open foreign balances. | CORE | Output pairs of open balances before and after, and the unrealized entry | P9B.2 |

#### 9C. Inventory

Behavior: perpetual inventory in [§2](../research/slowbooks-pro-2026/02-purchasing-payables-inventory.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9C.1 | Stock items with quantity on hand and weighted average cost. | DATA | Output of receipts at two costs and the average they produce | P2.2 |
| P9C.2 | Cost of goods sold on sales, receiving on bills, adjustments and returns. | CORE | Output pairs showing a sale posting cost at the average and a void putting it back | P9C.1, P2.5a, P3.2 |
| P9C.3 | Reorder points, low stock, and a valuation report tied to the inventory account. | UI | Screenshot of the valuation equal to the inventory account | P9C.2 |

#### 9D. Projects and job costing

Behavior: jobs and job costing in [§6](../research/slowbooks-pro-2026/06-nonprofit-jobs-job-costing.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9D.1 | Projects under customers, tagged on documents, lines and time. | UI | Video of tagging an invoice and a bill to one project | P2.5a, P3.2 |
| P9D.2 | Cost codes with a standard list loader, and cost types with burden. | UI | Screenshot of the loaded list | P9D.1 |
| P9D.3 | Budgets per project seeded from estimates, committed cost from open purchase orders, and budget against actual. | UI | Video of a budget seeded from an estimate and actuals arriving | P9D.2, P2.10, P3.6 |
| P9D.4 | A project profitability report whose total ties to the P&L. | UI | Screenshot with the tie-out | P9D.3 |

#### 9E. Fixed assets

Behavior: fixed assets in [§3](../research/slowbooks-pro-2026/03-general-ledger-banking.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9E.1 | An asset register with the purchase posted from a bank account, a bill or an opening balance. | UI | Video of each purchase route | P3.2 |
| P9E.2 | Depreciation runs, straight-line and declining balance, and disposal with a gain or loss. | CORE | Output of a year of runs and a disposal entry | P9E.1 |

#### 9F. Budgets

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9F.1 | Budgets by account and month, and budget against actual. | UI | Screenshot of the report on demo data | P5.1 |

#### 9G. Nonprofit mode

Behavior: nonprofit mode in [§6](../research/slowbooks-pro-2026/06-nonprofit-jobs-job-costing.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9G.1 | Company type and the wording layer: one dictionary for server and client, and a test that keeps them equal. | CORE, UI | Screenshots of the same screen in both wordings | P0.7 |
| P9G.2 | Funds with restrictions, and releases from restriction. | UI | Video of a restricted gift spent and then released | P9G.1, P9A.1 |
| P9G.3 | Functions on lines, allocation rules and period-end allocation runs. | CORE | Output of a run that moves unassigned cost without changing the P&L, run twice with nothing moved the second time | P9G.2 |
| P9G.4 | Statements of activities, financial position and functional expenses. | UI | Screenshots with tie-outs to the P&L and balance sheet | P9G.3 |
| P9G.5 | Donation receipts, acknowledgment letters, year-end giving statements, pledges and in-kind gifts. | UI | The PDFs, and a batch email that skips donors who opted out | P9G.1, P2.6 |

#### 9H. Payroll through a partner

Behavior users will expect: [§4 Payroll and HR](../research/slowbooks-pro-2026/04-payroll-hr.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9H.1 | Pick the partner. Compare Check and Gusto Embedded on states covered, cost, API and who carries filing liability, and write the decision record. | DOCS | None | Setup |
| P9H.2 | Employees and partner onboarding. | INTEG, UI +sec | Partner sandbox transcript of an employee onboarded | P9H.1 |
| P9H.3 | Pay runs through the partner, each posting one journal entry from the partner's figures. | INTEG +sec | A sandbox pay run and the balanced entry it posted | P9H.2 |
| P9H.4 | Time tracking that feeds pay runs and projects. | UI | Video of approved time flowing into a pay run | P9H.3, P9D.1 |
| P9H.5 | Links to the partner's tax filings and employee portal. | INTEG | Sandbox transcript of a filing status shown in BeeKeeping | P9H.3 |

#### 9I. Public API and MCP server

Behavior: API tokens in [§8](../research/slowbooks-pro-2026/08-platform-security-administration.md).

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9I.1 | API tokens stored as hashes, limited to one organization and one role, and named in the audit log. | DATA +sec | Output of a token's calls attributed in the log, and a revoked token refused | P0.6 |
| P9I.2 | A public REST API generated from the zod schemas, with rate limits and OpenAPI docs. | CORE +sec | The generated OpenAPI file, and a call over the rate limit refused | P9I.1 |
| P9I.3 | An MCP server with read tools and write actions that wait for confirmation. | INTEG +ai +sec | Transcript of an agent reading a report and drafting an invoice that waits for approval | P9I.2 |

#### 9J. Phone app

Cloud sessions have no simulator, so evidence comes from the Expo web build in Playwright.

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9J.1 | An Expo app with sign-in and organization switching. | UI | Screenshots of the web build | P0.4, P9I.2 |
| P9J.2 | Receipt capture into the inbox. | UI | Video of the web build uploading a receipt | P9J.1, P7.1 |
| P9J.3 | Approvals and the dashboard. | UI | Screenshots of the web build | P9J.1 |
| P9J.4 | App store subscriptions through RevenueCat, sharing entitlements with Stripe on the web. | INTEG +sec | RevenueCat sandbox transcript of a purchase unlocking the same plan on the web | P9J.1, P8.1 |

#### 9K. Accountant workspace

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9K.1 | Firm accounts with one list of client organizations. | UI +sec | Video of a firm user switching clients, and the cross-organization test still passing | P0.5 |
| P9K.2 | A review queue per client: uncategorized lines, unreconciled accounts and close status. | UI | Screenshot across three demo clients | P9K.1, P4.6 |

#### 9L. On request

Build these only when users ask. Each line may be more than one PR.

| Task | What to build | Type | Proof | Needs |
|---|---|---|---|---|
| P9L.1 | MYOB, Sage 50, Zoho Books, GnuCash and hledger importers, one PR each. | IMPORT | Dry runs on real exports | P6.1 |
| P9L.2 | PayPal and Square payment links. | INTEG +sec | Sandbox transcripts | P2.13 |
| P9L.3 | Check printing. | UI | The check PDF | P3.3 |
| P9L.4 | 1099-NEC and 1096 forms and e-filing. | INTEG | The forms on demo data | P3.7 |
| P9L.5 | Exemption certificates on customers. | UI | Video of an expired certificate warning | P2.3 |
| P9L.6 | Sales tax rates from a provider. | INTEG | Rates fetched for three addresses | P2.3 |
| P9L.7 | Recurring bills. | CORE | Output of a run with its report per item | P3.2, P2.11 |

## Gates

A gate closes a phase. It runs once, after the phase's last PR merges, and nothing in the next phase merges until it passes.

| Gate | After | Evidence | Reviews | Sign-off |
|---|---|---|---|---|
| G0 Foundations | Phase 0 | A fresh cloud session runs every check, and the evidence helper signs in on staging | `/security-review` over phase 0 | You |
| G1 Ledger | Phase 1 | A month of journal entries closes, and the four reports agree with each other and with the property suite | `/code-review` at high effort over the ledger code | You |
| G2 Private beta | Phase 5 | The beta scenario, below, recorded from start to finish | `/security-review` over everything since G0, and the cross-organization test | An outside accountant, then you |
| G3 Public launch | Phase 8 | A restore drill, the performance table and the sign-up-to-first-invoice video | The P8.3 security review | You |
| Module gate | Each phase 9 module | The module's scenario recorded, and the property suite extended to cover its postings | `/security-review` when the module moves money or holds credentials | You |

The beta scenario is a Playwright test that runs a demo month through the screens. It creates customers and vendors, sends invoices, takes payments, makes a deposit, enters and pays bills, imports a bank statement, matches it, reconciles, closes the month and opens every report. Its assertions check each tie-out: aging equals receivables, A/P aging equals payables, the trial balance totals agree, and cash flow equals the change in bank balances. `/evidence-driven-testing` records the run into `.artifacts/g2-beta/` with its report.

## When to stop and ask

A session stops, says what it found and asks when:

- the scope check finds an open PR changing the same files;
- the spec, the lessons table and this plan disagree, or none of them settles a money rule;
- the task needs a package, service or paid account the stack doesn't name;
- a migration would change or remove data already on staging;
- `/security-review` reports a high finding the task can't fix;
- `/greploop` reaches ten rounds without 5/5, or Greptile asks for something that breaks a hard invariant;
- a check can't run in the session.

## Keeping this plan current

- Status lives in GitHub issues and pull requests, not in this file, so parallel sessions never edit it at the same time.
- Scope changes arrive as a DOCS PR against this file and go through `/unslop` and `/greploop` like any other PR.
- When a phase 9 module starts, its first PR refreshes that module's rows, because the beta will have changed what it needs.
