# Agentic back office

BeeKeeping handles a small business's back office with agents doing the routine work and people approving it. This document plans the three parts that make that possible: an MCP server that lets any AI agent work in BeeKeeping, dashboards that show the business and the agents at a glance, and built-in back-office routines that run on a schedule. The tasks that build them are in the [execution plan](execution-plan.md).

Written 2026-09-29.

## Is BeeKeeping agentic by default?

It wasn't in the first draft of the plan. People clicked through screens, AI read receipts and wrote a monthly summary, and agents could reach the books only through an API in the last phase. That made agents an add-on.

From this revision it is. Every action a person can take, an agent can take too, through the same rules. The MCP server arrives in phase 1, with the ledger. Dashboards arrive in phase 5, and the built-in routines in phase 6, before the private beta. Agents draft and people post by default, so nothing moves money or reaches a customer without a person saying yes, unless an admin decides otherwise.

## What handling the back office means

| Job | How often | The agent | The person |
|---|---|---|---|
| Bank lines | Daily | Matches each line to a posting the ledger already has, and suggests a category for the rest | Approves what the policy doesn't allow the agent to post |
| Receipts | As they arrive | Reads each receipt and drafts the bill or expense with the file attached | Approves the draft |
| Invoicing | As work is done | Drafts invoices from time, estimates and recurring schedules | Approves and sends |
| Collections | Weekly | Lists overdue invoices, drafts reminders in the company's tone, records promises to pay | Approves each reminder |
| Paying bills | Weekly | Proposes which bills to pay from due dates and the cash forecast | Approves the run |
| Reconciliation | Monthly | Matches the statement and lists the differences | Finishes the reconciliation |
| Month-end close | Monthly | Runs the close checklist, drafts adjusting entries and the close report | Approves the entries and sets the closing date |
| Sales tax | Each filing period | Prepares the liability by tax code and the payment | Approves the payment and files |
| Reporting | Weekly and monthly | Sends a digest with the dashboards and the approvals waiting | Reads it |
| Questions | Any time | Answers from the books in the person's own AI app | Asks |

## How it fits the architecture

**One action registry, three doors.** Every action registers its name, its input and output schemas, the role it needs, its kind and its approval category. The kinds are read, draft, post and admin. The web app, the MCP server and the REST API are all generated from the registry, so an agent can do exactly what a person in the same role can do, under the same checks, and nothing more.

**Two kinds of agents use the MCP tools.**

1. The customer's own agent, such as Claude in claude.ai, Claude Desktop or Claude Code, or ChatGPT or Cursor. It connects to BeeKeeping's MCP server with the customer's sign-in.
2. BeeKeeping's built-in routines, which run on a schedule in the worker with Claude, each under an agent identity of its own.

**Agents are principals.** Each agent has an identity, a role and scopes. The audit log records the agent that acted and the person who approved.

```
 a person           their AI app            BeeKeeping routines
    |                    |                          |
 web app            MCP server                 worker + Claude
    \                    |                          /
     +------------- action registry --------------+
                         |
            actions: roles, org check, policies, approvals
                         |
               services and postEntry -> Postgres
```

## The MCP server

### Connection and sign-in

- A remote server over Streamable HTTP at `/mcp` on the web service.
- Sign-in follows the MCP authorization spec: OAuth with PKCE, the protected resource metadata endpoint, and dynamic client registration so AI apps can connect without manual setup. Tokens are bound to BeeKeeping as their audience and never passed on to other services.
- Each grant picks one organization and one scope: read, draft or post. A post scope still goes through approvals. Admin actions are never offered over MCP.
- Headless agents use API tokens instead, stored as hashes and limited to one organization and one role.
- The official TypeScript MCP SDK serves the protocol. Check that the auth library covers the current MCP authorization spec before P1.11 starts.

### Tools

Each tool maps to one registered action. Defaults for write tools are in brackets: *none* means the tool only drafts, *ask* means a person approves each call, *policy* means the organization's policy decides.

| Area | Read tools | Write tools |
|---|---|---|
| Company and reports | `get_overview`, `run_report`, `get_account_activity`, `search` | |
| Dashboards | `list_dashboards`, `show_dashboard` | |
| Customers and sales | `list_customers`, `get_customer`, `list_invoices`, `get_invoice`, `list_overdue_invoices` | `create_customer` [none], `draft_invoice` [none], `send_invoice` [ask], `record_payment` [ask], `draft_reminder` [none], `send_reminder` [ask] |
| Vendors and purchases | `list_vendors`, `list_bills`, `get_bill`, `list_bills_due` | `create_vendor` [none], `draft_bill` [none], `post_bill` [ask], `propose_bill_run` [none], `schedule_bill_payments` [ask] |
| Banking | `list_bank_accounts`, `list_bank_lines`, `suggest_matches` | `match_bank_line` [policy], `categorize_bank_line` [policy], `exclude_bank_line` [ask] |
| Receipts | `list_receipts` | `read_receipt` [none], `draft_from_receipt` [none] |
| Journal and close | `get_close_checklist`, `run_close_checks` | `draft_journal_entry` [none], `post_journal_entry` [ask], `propose_adjustments` [none], `request_closing_date` [ask] |
| Approvals | `list_my_requests`, `get_approval` | `request_approval` [none] |
| Payroll, phase 9 | `get_payroll_summary` | `prepare_pay_run` [ask] |

`run_report` covers profit and loss, balance sheet, trial balance, cash flow, both agings, sales tax and the general ledger, each with a period.

Agents never get these, whatever their scope: managing users and roles, bank account numbers, API tokens, deleting data, moving the closing date backward, and changing approval policies.

Every tool follows the same rules:

- The description says what the tool does, when to use it and what it returns, with one example call.
- Every write tool takes `dry_run`. A dry run returns the exact journal entry or change the call would make, and writes nothing.
- Every write tool takes an idempotency key, so a retried call never posts twice.
- Read tools carry the read-only annotation, so AI apps can run them without asking.
- Results carry structured output with a schema, plus a one-line text summary.
- Lists page with a cursor and stop at 100 rows. Reports need a date range.
- Errors carry the action's reason code, such as `period_locked`, and a plain sentence.
- Free text that came from documents, such as memos, vendor names and email bodies, is marked as untrusted data in the result.

### Resources and prompts

- Resources expose the chart of accounts, the organization's settings without secrets, any document by its URI, and any report by its URI and period.
- Prompts give AI apps one-click workflows: weekly back-office review, month-end close, chase overdue invoices, review this week's bank lines, prepare Friday's bill run, and explain this month's profit and loss.

### Dashboards over MCP

`show_dashboard` returns the dashboard's numbers as structured output. AI apps that support the MCP Apps extension also get an interactive view of the dashboard, the same charts as the web app, inside the conversation. Apps without it get a compact table and a link to the page.

### Many tools

There will be more than 60 tools. Their descriptions stay short and grouped by area. The built-in routines only load the tools their job needs, use tool search with deferred loading when a routine needs a wide set, and keep the tool list stable and sorted so prompt caching works.

## Dashboards

Rules for every dashboard:

- Every number comes from the same report queries as the report center, so a dashboard never disagrees with a report. SlowBooks's analytics used a different basis from its reports and showed different totals.
- Each dashboard is defined once as a query and a view. The web app, the MCP server and the weekly digest email all render that one definition.
- Every tile and chart links to the report or list behind it.
- Charts follow the `dataviz` skill: both themes, accessible colors and a text alternative for screen readers.

| Dashboard | Answers | What it shows | Arrives |
|---|---|---|---|
| Today | What needs me now? | Approvals waiting, bank lines to review, overdue invoices, bills due this week, receipts in the inbox, failed jobs and the close checklist | Phase 5, then grows in phase 6 |
| Cash | How much cash do we have, and where is it going? | Bank and card balances, a 13-week forecast of collections, bills and payroll, money in and out by week, and runway | Phase 5 |
| Receivables | Who owes us, and how late are they? | A/R aging tied to the receivables account, days sales outstanding, and the overdue list with each last reminder and promised date | Phase 5 |
| Payables | What do we owe, and when? | A/P aging tied to the payables account, bills due by week and scheduled payments | Phase 5 |
| Profit | Are we making money? | Profit and loss this month against last month and last year, gross margin, expenses by category, and budget against actual once budgets exist | Phase 5 |
| Tax | What tax do we owe, and when? | Sales tax liability by code with due dates, and vendors approaching the 1099 threshold | Phase 5 |
| Close | Is last month closed? | The close checklist for each month: accounts reconciled, agings tied, no uncategorized lines, adjusting entries reviewed, closing date set | Phase 6 |
| Agent activity | What did the agents do, and was it right? | Actions by agent and routine, approvals requested, approved and rejected, undo links, errors, AI spend and the acceptance rate per routine | Phase 6 |
| Payroll | What does the team cost? | The next pay run, liabilities due and cost by month | Phase 9, with payroll |

## Back-office routines

The built-in agents. Each routine has a schedule, a list of tools it may use, the policy that decides what it can do alone, and an evaluation that shows it works.

| Routine | Runs | Does on its own by default | Asks first | Proof it works |
|---|---|---|---|---|
| Bank review | Daily | Matches lines to existing postings when amount, side and date agree exactly | New categories, and any line over $500 | Accuracy on 200 labelled demo bank lines |
| Receipt intake | When a receipt arrives | Reads it and drafts the bill or expense | Posting the draft | Field accuracy on 50 fixture receipts |
| Collections | Weekly | Drafts reminders for overdue invoices | Sending each reminder | Drafts reviewed on 20 demo cases |
| Bill run | Weekly | Proposes the run from due dates and the cash forecast | Scheduling payments | The proposal matches due dates and cash on demo data |
| Month-end close | Monthly, on the third | Runs the checklist, drafts adjusting entries and the close report | Posting entries and setting the closing date | The checklist completes on the demo month |
| Weekly digest | Mondays | Sends the digest | Nothing, it only reports | Every number in it equals the reports |
| Anomaly watch | Daily | Flags possible duplicates, unusual amounts and new vendors | Nothing posts | It finds the anomalies seeded in the demo company |

How a routine runs:

- The worker starts the run on schedule, under the routine's agent identity.
- It calls Claude with the routine's instructions and only the tools that routine may use, and runs each tool call through the action registry, so every check a person faces applies to the agent too.
- Each run has limits: a maximum number of tool calls, a token budget, a time limit, and the organization's monthly AI spend cap.
- Every tool call and result goes into the run record, which the Agent activity dashboard shows.
- An admin can pause one routine or all agents for the organization with one switch.
- The first choice for building the loop is the Claude API's tool runner in our worker, because its per-turn hooks give us the approval gates. The alternative is Managed Agents with scheduled deployments calling our MCP server, which moves the loop to Anthropic. P6.1 decides between them. Load the `claude-api` skill before writing any of this code.

## Approvals and policies

- Every write action has an approval category: none for drafts, policy, always ask, or never for agents.
- An organization sets a policy per category. The options are always ask, allow below an amount, allow when an exact match or a bank rule supports it, and never.
- The defaults are cautious. Agents draft and people post. Nothing moves money or sends a customer an email without a person, unless an admin changes the policy.
- An approval request shows the dry-run result, the agent's reason, the source documents, and buttons to approve, edit or reject.
- In a conversation, the MCP server asks the person directly through MCP elicitation when the AI app supports it. Otherwise the request waits in the approval queue on the Today dashboard.
- The agent that asked can't approve its own request. Payments above a limit the admin sets need a second person.
- Undo is a void. Every agent posting can be reversed from the Agent activity dashboard.

## Safety

- The action layer enforces scopes, roles, policies and the organization check on the server, so no prompt can talk an agent past them.
- Text from documents is data, not instructions. The routines' instructions say so, tool results mark it, and write tools only accept structured arguments.
- Tool results never contain secrets. Bank numbers are masked and keys are never returned.
- Rate limits apply per token and per routine, and each organization has a monthly AI spend cap.
- A suite of agent scenarios on the demo company runs in CI every night. A routine whose acceptance rate drops below its bar is paused and flagged.
- Every MCP, token, approval and routine task gets `/security-review`.

## How the skills build it

Every agent task follows the execution plan's task loop. On top of that:

- Load `claude-api` before writing MCP server code, routine code or anything else that calls Claude.
- Load `dataviz` before any dashboard or chart code.
- Run `/security-review` on every MCP, token, approval and routine task.
- Proof for an MCP tool is a transcript of a client calling it against the demo company, from the MCP Inspector or an AI app, saved in `.artifacts/<task>/`.
- Proof for a routine is its evaluation score and the run log of one run on the demo company.
- Proof for a dashboard is screenshots in both themes from the web app and, where the app supports it, from an AI app over MCP.

## Decisions for you

1. Which AI apps to support first. I'd start with Claude in claude.ai, Claude Desktop and Claude Code, then add ChatGPT and Cursor.
2. The default approval limits, such as letting the bank review post exact matches and asking about anything over $500.
3. Whether the built-in routines come with every plan or as a paid add-on, since each run costs AI usage.
4. Where the digest and the approval requests reach you: email only, or Slack as well.
