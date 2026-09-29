# Agent workflow

Every task moves through the same four beats, each backed by a skill in
`.claude/skills/`. This file governs all work in BeeKeeping. The sections
under [BeeKeeping specifics](#beekeeping-specifics) say how the beats run
here, and they win where they differ from the generic text.

## Workflow

1. **Isolate — `/new-feature`.** Every new feature starts in a fresh Git
   worktree branched from `origin/main` so agents can work in parallel
   without conflicts. Never build on `main`.
2. **Build — `/code-structure`.** Write code to the service-layer
   architecture: actions/boundaries orchestrate the "why/when", a service
   layer owns the reusable "how", with explicit inputs and structured
   returns.
3. **Prove — `/evidence-driven-testing`.** Verify with the repo's checks
   plus runtime evidence. Capture the **before** state while reproducing the
   issue — prior to fixing it, when it is cheapest — and the **after** once
   the change works.
4. **Ship — `/before-and-after`, then `/ocr-review`.** Open the PR with
   before/after proof embedded in the description (screenshot or video
   whenever the change has a visible surface; measured numbers or output
   pairs when it doesn't). Run `/ocr-review` until a review round finds
   **no critical, high or medium issues**. Finish by presenting the PR URL.

Ship-beat notes:

- `/before-and-after` drives the `@vercel/before-and-after` CLI. `--markdown`
  uploads the pair and prints a PR-ready table; it also accepts existing
  PNGs, so evidence gathered while developing can be reused as-is.
- In containers/VMs where Chrome fails with "No usable sandbox", set
  `AGENT_BROWSER_ARGS="--no-sandbox"` for the capture command.
- The default upload host (0x0.st) is public — fine for ordinary UI shots;
  pass `--upload-url` for anything sensitive.
- BeeKeeping screenshots and videos show the demo company only. Never
  capture real books, bank numbers or customer data, whatever the host.

## Writing for humans

Run `/unslop` over anything a person will read, before you commit, post, or
send it: commit messages, the PR title and body, README and doc edits, code
comments, and the closing reply. It strips AI tells (em dashes, filler,
hedging, chatbot phrases, puffery, bold-label lists) and replaces fancy
words with plain ones and passive voice with active. Apply it to text you
wrote or changed, not to prose you didn't touch.

## Multi-agent rules

- Never commit directly to `main`.
- One worktree and one branch per task and per agent — never reuse or modify
  another agent's worktree, branch, or uncommitted work.
- **Scope check** before starting: skim open PRs' changed files
  (`gh pr list`, `gh pr diff <n> --name-only`) and look for uncommitted work
  in shared checkouts. On overlap, stop and ask for direction.
- Never force-push to `main` — and never plain `--force` anywhere; only
  `--force-with-lease`, only on your own task branch.
- Resolve lockfile conflicts by regenerating, never by hand-merging.
- Worktrees don't isolate shared resources: confirm a dev-server port
  answers *your* process before trusting it, and don't run schema
  experiments against a shared database.
- If a conflict can't be resolved confidently, stop and report instead of
  guessing.

## Completing a task

1. Keep changes limited to the assigned task.
2. Run the repo's checks: `pnpm check` and `pnpm build`, as listed under
   [Commands and checks](#commands-and-checks).
3. Assemble the evidence captured along the way into before/after pairs.
4. Commit with a clear message, rebase onto the latest `origin/main`, and
   rerun the checks.
5. Push (`git push -u origin <branch>`; after rebasing an already-pushed
   branch, `--force-with-lease`).
6. Open the PR with a body that follows `.github/pull_request_template.md`.
   Its five parts are the acceptance rules, what changed, how it was tested,
   before/after proof, and any risks or follow-up work. Back every claim
   with evidence. Run the title and body through `/unslop` before posting.
7. Run `/ocr-review` until a review round finds **no critical, high or
   medium issues**.
8. End by presenting the PR URL.

Do not merge the PR unless explicitly instructed. Keep the worktree until
the PR is merged or closed.

## BeeKeeping specifics

### What we're building

BeeKeeping is a double-entry bookkeeping app. `docs/build-plan.md` says
what we're building and why. `docs/execution-plan.md` lists every task and
says how each skill runs on it. The behavior reference is the SlowBooks Pro
2026 feature inventory in `research/slowbooks-pro-2026/`. Before starting a
task, read its row in the execution plan and the inventory section its
phase links.

### Hard invariants

- Clean room. Build from the inventory. Never open, copy or paraphrase
  SlowBooks Pro source code, templates or assets, and never add them to this
  repo. Its license forbids using its code in a paid product.
- Every posting goes through the shared `postEntry` action. Journal
  entries always balance. Posted entries are never edited or deleted; a correction is a
  reversing entry.
- System accounts such as receivables and payables are found by their
  role, never by account number.
- Every query is scoped to one organization. Row-level security in Postgres
  is the backstop, not the only check.
- Secrets, tokens and bank numbers never reach logs, the audit log,
  screenshots or error messages.

### Commands and checks

The repo pins Node 22 in `.nvmrc` and pnpm 10.33.0 in the `packageManager`
field of `package.json`. pnpm refuses to install on Node older than 22.18,
the first release that runs TypeScript files without a flag. Run every
command from the repo root.

| Command | What it does |
|---|---|
| `pnpm install --frozen-lockfile` | Installs exactly what the lockfile lists. Run plain `pnpm install` only when you change dependencies. |
| `pnpm typecheck` | Runs `tsc` on the root files and on every package. |
| `pnpm lint` | Runs ESLint on the whole repo, layer rules included. A warning fails it. |
| `pnpm format:check` | Checks Prettier formatting. `pnpm format` fixes it. |
| `pnpm test` | Runs Vitest in every package and the repo tests in `tests/`. A test marked `.only` fails the run. |
| `pnpm build` | Builds the web app. |
| `pnpm check` | Runs typecheck, lint, format:check and test, in that order. |
| `pnpm db:start` | Starts the throwaway Postgres on port 54320, with its files in `/tmp/beekeeping-postgres`. `pnpm db:stop` stops it for every checkout on the machine. |
| `pnpm db:migrate` | Applies pending migrations to `MIGRATION_DATABASE_URL`, which logs in as the database owner. When it isn't set, migrates this checkout's development database on the throwaway Postgres and creates the app's local login. |
| `pnpm -s db:url` | Prints the URL the app uses for this checkout's development database. Run `pnpm db:migrate` once first, then `export DATABASE_URL="$(pnpm -s db:url)"`. Without `-s`, pnpm's banner lands in the variable too. |

A task is ready for review when `pnpm check` and `pnpm build` pass. CI runs
the same steps on every PR and on pushes to `main` and `claude/**`, in
`.github/workflows/ci.yml`, against a Postgres 16 service. P0.7 adds
`pnpm test:e2e` and lists it here.

Databases:

- The throwaway Postgres runs the Postgres 16 that the cloud image has, so
  it needs no Docker. Tests and `pnpm db:migrate` start it when needed. One
  server serves every checkout, and each checkout gets its own development
  database, named after its path.
- The app's connections start as the `beekeeping_app` role, so row-level
  security covers every query. The app logs in as a login role of its own,
  a `NOINHERIT` member of `beekeeping_app` with no rights of its own, so
  even `SET ROLE NONE` leaves it nothing to read. It never logs in as the
  database owner: the health check answers 503 if it does. Migrations and
  test setup log in as the owner.
- On a new server, after the first migration, an admin creates the app's
  login with a password from the secret store:
  `CREATE ROLE beekeeping_web LOGIN NOINHERIT PASSWORD '...'; GRANT beekeeping_app TO beekeeping_web;`.
  `DATABASE_URL` logs in as `beekeeping_web`. `MIGRATION_DATABASE_URL`
  logs in as the owner, and only migrations use it. The throwaway Postgres
  gets a `beekeeping_web` with no password from `pnpm db:migrate`.
- Each test project migrates one template database, and each test file
  clones it with `createTestDatabase()` from `@beekeeping/db/testing`. Files
  never share rows. Its `appUrl` logs in the way the app does, for
  `openDatabase`; its `url` logs in as the owner, for setting up rows and
  checking results. A package whose tests need a database adds
  `@beekeeping/db/testing/global-setup` to its Vitest `globalSetup`, as
  `apps/web` does.
- Set `TEST_DATABASE_ADMIN_URL` to run the tests on another server, as CI
  does. Never point it at a server with real data: tests create and drop
  databases there.
- Migrations live in `packages/db/drizzle`. Write the schema in
  `packages/db/src/schema` and run `pnpm --filter @beekeeping/db db:generate`.

How the workspace fits together:

- `apps/web`, `apps/worker` and `packages/*` follow the layers in
  `docs/build-plan.md`. `eslint.config.js` refuses imports that cross a
  layer boundary, whether by package name, by relative path or through
  `import()`. `tests/layer-boundaries.test.ts` checks every layer against
  its own copy of the policy.
- Packages export their TypeScript source from `src/index.ts`. Relative
  imports name the real `.ts` file, and ESLint refuses `.js`, so plain Node,
  Vitest and Next.js all run the same source with no build step.
- Versions that several packages share live in the `catalog` of
  `pnpm-workspace.yaml`. A package asks for one with `"catalog:"`.
- `tests/workspace.test.ts` fails when a package has no typecheck script,
  loosens the strict settings of `tsconfig.base.json`, or has no layer rule.

### Environment quick reference

- The base branch is `main` once it exists. Until then, branch from the
  current default branch. Never commit to either directly.
- Claude Code on the web has no `gh` CLI. Use the GitHub MCP tools for what
  the skills do with `gh`: list open PRs and their changed files for the
  scope check, open PRs, post the review summary, and read, answer and
  resolve review threads.
- Claude Code assigns the task branch. Per `new-feature`, skip its worktree
  steps 3 and 4.
- When a cloud session starts, `.claude/hooks/session-start.sh` runs
  `pnpm install --frozen-lockfile` and installs the `ocr` CLI if it's
  missing, so the checks run straight away. Local sessions skip the hook.
- Cloud sessions have no display. Use the headless path in
  `evidence-driven-testing` and keep evidence in `.artifacts/<task-name>/`,
  which is gitignored.
- Chromium is preinstalled for Playwright. For `before-and-after` in a
  container, set `AGENT_BROWSER_ARGS="--no-sandbox"`.
- Code review runs on open-code-review, the `ocr` command. If a session
  lacks it, install it with `npm install -g @alibaba-group/open-code-review@1.12.10`.
  With no model configured for OCR, `/ocr-review` uses delegation mode and a
  reviewer subagent does the review. Review rules and skipped paths live in
  `.opencodereview/rule.json`.

## Skill sources

| Skill | Source |
|---|---|
| `new-feature`, `code-structure`, `evidence-driven-testing` | michaelshimeles/skills |
| `before-and-after` | michaelshimeles/skills, vendored from [vercel-labs/before-and-after](https://github.com/vercel-labs/before-and-after) (or `npx skills add vercel-labs/before-and-after`) |
| `open-code-review`, `open-code-review-delegate` | [alibaba/open-code-review](https://github.com/alibaba/open-code-review) at commit `f93ff15`, Apache-2.0, with the license in each folder |
| `ocr-review` | Written for BeeKeeping. Runs the review loop on open-code-review |
| `unslop` | michaelshimeles/skills, vendored from [cursor/plugins (pstack)](https://github.com/cursor/plugins/tree/main/pstack/skills/unslop); frontmatter edited so agents apply it unprompted (`disable-model-invocation` dropped, description scoped to text the agent writes or edits for people), body untouched |

Installed from [michaelshimeles/skills](https://github.com/michaelshimeles/skills)
at commit `4b72f46` on 2026-09-29. `code-structure`, `new-feature` and
`evidence-driven-testing` ship without a license file. That collection's
`greploop` and `greploop-apps` skills were removed the same day, when
BeeKeeping moved its code review from Greptile to open-code-review.
