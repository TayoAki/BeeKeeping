_SlowBooks Pro 2026 feature inventory — [← 7. Import, Export, Migration & Interoperability](07-import-export-migration.md) · [Index](README.md) · [9. User Interface, Desktop Apps, Deployment & Engineering →](09-ui-desktop-deployment-engineering.md)_

## 8. Platform, Security & Administration

SlowBooks Pro serves one company per server process and keeps everything that belongs to that company (books, settings, saved credentials, users, API tokens, uploaded files, audit trail) inside that company's own database: one SQLite file per company on the desktop, one PostgreSQL database per company on a server. One middleware in `app/main.py` handles sign-in and access for every request. It accepts a signed session cookie (Argon2id password sign-in, single-password or per-user "Server Edition") or a scoped `sbp_` Bearer token, and applies a coarse three-role RBAC policy. Around that core the section covers Fernet encryption of saved credentials and payroll bank data, per-company backups with automatic safety copies, a SQLAlchemy-level audit log with per-user attribution, SHA-256 audit hashes on payroll tax forms, a closing-date lock with a rate-limited override password, and startup checks that refuse to boot a misconfigured production deployment. The desktop app and Server Edition (`--serve-lan`) run as plain-HTTP loopback or LAN servers. Docker and production deployments are expected to sit behind a TLS proxy with `FORCE_HTTPS=true`.

### Authentication & first-run setup

- **Sign-in gate (`require_session` middleware)** — every path needs an authenticated session or a valid API token, except an explicit exempt list:
  - Exact paths: `/`, `/health`, `/openapi.json`, `/analytics`, `/favicon.ico`, `/api/stripe/webhook` (provider signature), `/api/qbo/callback` (Intuit OAuth redirect; protected by its own `state` check).
  - Prefixes: `/static/`, `/api/auth/`, `/pay/` (public customer pay page), `/portal/` (employee self-service, token-based).
  - Regex: `^/api/payments/[a-z0-9_]+/(webhook|create-checkout-session)$` (provider signature, or the invoice's payment token as capability).
  - An unauthenticated request gets 401 `{"detail": "Not authenticated"}`. On any 401 the SPA (`api.js`) opens the sign-in or setup overlay (`auth.js`) and holds the failed request until the page reloads after sign-in.
- **Auth status** — `GET /api/auth/status` (public) returns:
  - `setup_needed`, `authenticated`, `multi_user`.
  - `company_name`: blank while it is still the shipped placeholder "My Company"; otherwise falls back to the company-picker (manifest) name.
  - `desktop`: true only for the desktop window (`SLOWBOOKS_DESKTOP=1`, not `SLOWBOOKS_SERVER_MODE=1`, request from loopback).
  - `usernames`: active users, sorted. Sent only on a multi-user install and only to a caller who is not signed in. Names only, never roles.
  - `has_data`: sent only while setup is needed; says whether any transaction exists. The setup form then warns "This company file already contains books…".
  - `user {username, display_name, role}` when signed in.
  - A session that fails the restart check or the company check (below) is cleared here and reported as signed out.
- **First-run setup** — `POST /api/auth/setup` (public, one time only).
  - `password` is required. The schema allows 1–512 characters; the service then requires at least 8 (400 "Password must be at least 8 characters").
  - Optional fields, with maximum lengths: `company_name` (200), `company_address1`/`company_address2` (200), `company_city` (100), `company_state` (50), `company_zip` (20), `company_phone` (50), `company_email` (200), `company_website` (200), `company_tax_id` (50), `operator_name` (200), `operator_email` (200), `default_terms` (100), `default_tax_rate` (20). Unknown fields → 422 (StrictModel).
  - Non-blank values go through the same checks as Settings before anything is written. For example, `default_tax_rate` must be 0–100 with at most 4 decimals (422).
  - 409 "Password already set — use /login" once any password exists.
  - 409 if `company_name` is already used by another company file on the install (SQLite manifest check).
  - Stores the Argon2id hash in the settings row `auth_password_hash`. Creates the `admin` user row with the same hash; its display name is the operator name, or "Operator". Syncs the company-picker name. Signs the caller in: the session is cleared first, then populated.
  - SPA form fields: Your name\*, Your email\*, Company name\* (prefilled from status), Company email, Password\*, Confirm password\*. The page checks for at least 8 characters and a matching confirmation, and sends only those fields.
- **Login** — `POST /api/auth/login` `{password, username?}` (public).
  - Rate limit: 5 per minute per client address.
  - Before setup: 409 "Setup required — set a password first". The SPA then switches to the setup view.
  - Single-user install: any `username` is ignored; the password is checked against the one active user.
  - Multi-user install (more than one active user): `username` is required (400 "Username required") and matched after trimming and lowercasing. Inactive users cannot sign in.
  - Wrong credentials: 401 "Incorrect password" (single-user) or "Incorrect username or password" (multi-user).
  - Every attempt that reaches the handler writes a `login_attempts` row: timestamp, client IP (≤45 characters, honouring `TRUST_PROXY_HEADERS`), user-agent (≤255 characters) and a success flag.
    - No username is stored.
    - 429, 400 and 409 answers are not recorded.
    - No API or screen reads the table.
  - On success:
    - `users.last_login_at` is updated. The audit row for that update is attributed to the user who signed in.
    - The session is cleared and repopulated: `authenticated`, `user_id`, `username`, `display_name`, `role`, boot id, company id.
- **Password hashing** — argon2-cffi `PasswordHasher()` with library defaults. The code comment gives Argon2id, time_cost 3, 64 MiB, parallelism 4, about 100 ms per verify. A mismatch or a malformed hash counts as failure. Legacy installs that have only the settings-table hash get an `admin` user row created on first login, with no interaction (`ensure_admin_user`).
- **Logout** — `POST /api/auth/logout` clears the session and always answers `{"status":"ok"}`. The toolbar **Sign Out** button asks "Sign out of Slowbooks?". In the desktop window it then opens the company picker; in a browser it reloads to the sign-in screen, which lists usernames on a multi-user install.
- **"Ask for the password each time SlowBooks Pro starts"** — setting `ask_password_on_start` (`true`/`false`, default `false`).
  - Desktop builds only (`SLOWBOOKS_DESKTOP=1`, which also covers `--serve-lan`).
  - Each server start generates a random `BOOT_ID`. A session signed in under an earlier start is cleared and gets 401 "SlowBooks Pro was restarted. Enter the password to continue."
  - UI: Settings → **Sign-in** section, shown only when `/api/system` reports `desktop`. Its note says a Server Edition restart signs everyone out.
  - Not applied on Docker, where two workers means two boot ids.
- **A sign-in belongs to one company**:
  - Each company stores a random 128-bit `company_session_id` setting, which the settings API never returns. Sign-in records it in the session.
  - A session recorded for another company is cleared: 401 "That sign-in was for another company. Enter this company's password to continue."
  - Sessions from before 2.18.0 carry no company id and are adopted by the first company they are used on.
- **Sign-in screen**:
  - Title "Unlock <Company name>" (or "Unlock Slowbooks") and a "First time? Set up Slowbooks →" link.
  - On a multi-user install, a **Who is signing in?** dropdown of usernames, or a Username field if no list is available.
  - In the desktop window, a "Choose a different company →" link that opens the launcher's picker.
- **Not implemented**:
  - MFA/2FA.
  - Per-account lockout; only the per-IP rate limit applies.
  - Self-service password change for non-admins; an admin resets passwords in Settings → Users.
  - Password complexity rules beyond a minimum of 8 characters.
  - CSRF tokens; the design relies on `SameSite=Strict` cookies and the CORS allowlist.

_Key files: `app/routes/auth.py`, `app/services/auth.py`, `app/models/auth.py`, `app/main.py`, `app/static/js/auth.js`, `app/static/js/bootstrap.js`_

### Sessions & cookies

- **Session cookie** — Starlette `SessionMiddleware` with cookie `slowbooks_session`, max-age 30 days, `SameSite=Strict`, `HttpOnly` (Starlette's default), and `Secure` exactly when `FORCE_HTTPS` is true. The payload is signed with itsdangerous but not encrypted: whoever holds the cookie can read username, role, user id, display name, boot id and company id.
- **Idle timeout** — `SESSION_IDLE_TIMEOUT_SECONDS`, default 14400 (4 h); `0` disables it.
  - Sliding window: every authenticated request to a gated path stamps `last_activity`.
  - A request after the window has passed clears the session: 401 "Session expired (idle timeout)".
  - Exempt paths neither check nor refresh the timer. Token requests skip it.
- **Signing secret resolution**:
  1. `SESSION_SECRET_KEY` env var.
  2. `.slowbooks-session.key` at the repo or install root, created 0600 via `mkstemp` + `os.replace`.
  3. A random per-process key, with a logged warning. Every restart then signs everyone out.
  - The desktop launcher generates `SESSION_SECRET_KEY` into the per-user `.env`.
- **Rotation on sign-in** — setup and login clear the session before populating it.
- **Revocation limits** — sessions are stateless signed cookies.
  - Logout only clears the caller's own cookie. A copy of an authenticated cookie stays valid until its max-age, the idle timeout, a restart or company mismatch, or a change of signing secret.
  - Role is read from the cookie, never from the `users` table, so demotion and deactivation take effect at the user's next sign-in.
- **Legacy sessions** — a session with no role is treated as `admin` everywhere: the middleware, `current_role()`, the users route and the tokens route.
- **Portal cookie** (employee self-service) — HttpOnly, `SameSite=Strict`, `Secure` when `FORCE_HTTPS`, path `/portal`. Portal responses override the defaults with `Referrer-Policy: no-referrer` and `Cache-Control: no-store, max-age=0`.

_Key files: `app/main.py`, `app/services/auth.py`, `app/config.py`, `app/routes/portal.py`_

### Users, roles & RBAC

- **Roles** — `admin`, `bookkeeper`, `readonly` (`VALID_ROLES`). Both users and API tokens carry a role. Settings labels: "Admin — everything", "Bookkeeper — daily books, no admin", "Read-only — reports and lookups".
- **Central policy (`_role_allows` in `app/main.py`)** — applied to sessions and tokens alike:
  - **admin** — every method on every path.
  - **HR-sensitive paths** are refused to every non-admin for every method, reads included:
    - Prefixes `/api/payroll`, `/api/tax-forms`, `/api/benefits`, `/api/deductions`, `/api/onboarding`.
    - `/api/employees/{id}/(portal-token|portal-access|everify|bank-accounts|documents|ytd)`.
  - **readonly** — `GET`/`HEAD`/`OPTIONS` only, and nothing under `/api/audit`, because audit payloads snapshot full records.
  - **bookkeeper** — every read, and every write except these admin-write prefixes: `/api/users`, `/api/tokens`, `/api/settings`, `/api/backups`, `/api/companies`, `/api/migration`, `/api/qbo/connect-manual`, `/api/employees`.
  - A refusal is 403 "Your role doesn't allow this action".
  - `/api/pto` and `/api/time-entries` remain daily books, open to bookkeepers.
- **In-route admin checks** (`require_admin` / `_require_admin`, 403 "Admin role required") cover reads and finer rules the middleware does not:
  - `GET /api/users` and `GET /api/tokens`.
  - Backup download.
  - Logo upload and delete.
  - Legacy-uploads folder `GET` and `DELETE`.
  - `PUT /api/analytics/ai-config` and `POST /api/analytics/ai-config/test`.
  - QuickBooks Online `auth-url`, `connect-manual`, `disconnect`, `import-runs` (POST), `import` and `import/{entity}`.
- **Narrowed answers for allowed requests** (`app/routes/_roles.py`: `current_role`, `is_admin`, `require_admin`):
  - Every role can list employees (`GET /api/employees`, `/{id}`) as a directory. Non-admins get these fields blanked: `ssn_last_four`, `pay_rate`, `cost_rate`, `burden_pct`, `filing_status`, `multiple_jobs`, `dependents_amount`, `other_income_annual`, `deductions_annual`, `extra_withholding`, `address1`/`address2`/`city`/`state`/`zip`, `residence_state`, `wc_class_code`, `state_allowances`, `state_extra_withholding`, `state_rate_override`, `local_tax_rate`.
  - Read-only `GET /api/payments/payment-link/{invoice_id}` gets 403 when the invoice has no payment token yet, because creating one is a write.
- **API-token restrictions on top of role**:
  - No access at all to `/api/users*` or `/api/tokens*` (403 "API tokens cannot manage users or tokens").
  - Cannot set `closing_date_password`, and cannot clear or roll back `closing_date`.
  - Never carries the closing-date override password.
- **User management (admin only, no DELETE)** — users are deactivated rather than deleted, so their usernames stay meaningful in the audit trail.
  - `POST /api/users` `{username, display_name?, password, role}`.
    - The username is trimmed and lowercased, then must match `^[a-z0-9][a-z0-9._-]{2,49}$` (3–50 characters; 400 otherwise).
    - Role must be one of the three (400 "Invalid role").
    - Password: at least 8 characters (400); at most 512 (422).
    - Duplicate username: 409 "Username already exists".
    - Display name defaults to `username.title()`.
  - `PUT /api/users/{id}` accepts any subset of `display_name`, `role`, `is_active` and `password` (a reset; a blank password is ignored). Unknown id: 404.
  - **Last-admin guard** — demoting or deactivating the only active admin is refused with 409 "Cannot remove the last active admin".
  - The list returns `id, username, display_name, role, is_active, created_at, last_login_at`. Password hashes are never returned.
  - UI: Settings → **Users — Server Edition** (loaded only for an admin).
    - The table shows Username, Name, Role (a select that saves immediately) and Last login, with **Deactivate/Reactivate** and **Reset password** (prompt) buttons.
    - The **Add User** form has Username, Display name, Password and Role (default Bookkeeper). Toast: "User added — this deployment is now Server Edition".
- **SPA role gating (cosmetic; the server enforces)**:
  - `App.setRole()` runs from `/api/auth/status`.
  - `data-admin` controls are hidden or disabled for non-admins. `form[data-admin-fields]` fields are locked, and `data-admin-note` sentences are shown.
  - For `readonly`:
    - Forms are locked with "Your sign-in is read-only: you can look, but not save changes…".
    - `+ New…` buttons, page-header primary actions, `data-write` controls, file choosers and about 100 named write actions (`App.WRITE_ACTIONS`) are hidden.
    - The Audit Log nav item is hidden.
  - A MutationObserver re-applies all of this as pages re-render.
  - Admin-only pages for other roles: employees, payroll, hr-onboarding, hr-benefits, hr-deductions, hr-tax-forms, users, migrate. They show "<page> is for administrators".

_Key files: `app/main.py`, `app/routes/_roles.py`, `app/routes/users.py`, `app/models/users.py`, `app/routes/employees.py`, `app/static/js/app.js`, `app/static/js/settings.js`_

### Server Edition (multi-user & LAN serving)

- **No separate build or license** — "Server Edition" is the same app with more than one active user (`is_multi_user`). The RBAC policy applies to any non-admin principal regardless of user count.
- **What changes once a second active user exists**:
  - Login requires a username (400 without one).
  - `/api/auth/status` lists usernames to anyone not yet signed in. docs/server-edition.md describes this as a trusted-network trade-off.
  - The failure message becomes "Incorrect username or password".
  - The top bar shows a user chip "<display name> · <role>".
  - Non-admin sign-ins have the HR and payroll sidebar pages hidden.
- **Going back to single-user** — deactivating users until only one is active restores password-only login against the remaining active user, who by the last-admin rule is always an admin.
- **LAN serving** — `SlowBooksPro.exe --serve-lan [--bind IP] [--port N] [--data-dir DIR]`.
  - Headless. Binds `0.0.0.0` or the `--bind` interface; port defaults to 3001.
  - Serves the last-opened company, else the first in the manifest, else a newly created "My Company". Does not overwrite the desktop app's last-opened choice (`persist=False`).
  - Server environment: `APP_DEBUG=true`, `FORCE_HTTPS=false`, `SLOWBOOKS_DESKTOP=1`, `SLOWBOOKS_SERVER_MODE=1`. The result is plain HTTP with no HSTS and no Secure cookie.
  - Connect URLs are printed, written to `connect-urls.txt` in the data folder, and shown in a popup on frozen Windows.
  - With `server_mode` true, the sidebar and splash read "Server Edition" and the version label reads "vX · Server".
  - LAN browsers get the strict CSP. The desktop `'unsafe-eval'` relaxation requires a loopback client.
- **Windows permanent install** (from docs and `scripts/windows/`):
  - `serveredition-install.ps1` (run elevated) registers scheduled task `SlowBooksProServer` at boot as SYSTEM running `--serve-lan --port 3001 --data-dir C:\ProgramData\SlowBooksPro`. It adds firewall rule "SlowBooks Pro Server Edition" and, the first time, copies existing desktop books in.
  - `serveredition-uninstall.ps1` never deletes data.
  - `update-server-edition.ps1 -RunId …|-ZipPath …` swaps the program files and restarts the task.
- **Limits**:
  - Plain HTTP; the docs say trusted LANs only and TLS is "planned".
  - One company per server process.
  - Rate-limit and closing-date-lock counters are per process.
  - Docs describe the design target as 2–10 people.

_Key files: `app/services/auth.py`, `app/routes/auth.py`, `app/routes/system.py`, `app/static/js/app.js`, `desktop_launcher.py`, `scripts/windows/serveredition-install.ps1`, `docs/server-edition.md`_

### API tokens (agents & integrations)

- **Purpose** — non-human principals such as AI agents, agentic CLIs, the receipt service and scripts. They authenticate with `Authorization: Bearer sbp_…` and carry a role exactly like a user; the RBAC middleware cannot tell them apart.
- **Secret format** — `sbp_` followed by `secrets.token_urlsafe(32)` (256 random bits, 47 characters in total).
  - Stored only as the SHA-256 hex digest (unique, indexed). A fast deterministic hash is used because the secret is random.
  - `token_hint` keeps the first 10 characters (for example `sbp_ab12cd`) so a token in a config file can be matched to its row.
  - The full secret appears once, in the create response. The UI shows it in "Copy this token now — it will never be shown again" with a **Copy** button.
- **Management (admin session only)** — `GET/POST /api/tokens` and `PUT /api/tokens/{id}`.
  - `label` is 1–100 characters and unique (409 "Label already exists").
  - Role must be one of the three (400 "Invalid role").
  - `PUT` can rename the label or set `is_active`. There is no DELETE: tokens are revoked and can be reactivated, keeping the label meaningful in the audit trail.
  - `created_by` records the admin's username (or "operator").
  - UI: Settings → **API Tokens — agents & integrations**.
    - Columns: Label, Token hint, Role, Last used, and Revoke/Reactivate.
    - The create form has Label (placeholder "e.g. claude-code, receipt-service") and Role (default Read-only).
- **Resolution** — the middleware hashes the bearer secret and looks up an active row.
  - An unknown, revoked or non-`sbp_` token gets 401.
  - When a request carries both a session cookie and a token, the session wins.
  - `last_used_at` is updated at most every 5 minutes. That write is audited as user `system`.
- **Behaviour**:
  - No expiry: a token is valid until revoked.
  - No idle timeout.
  - Audit rows are attributed to `token:<label>`.
  - Preferences written by a token go to the shared no-user row.
  - The closing-date override is unavailable.
  - A token may move `closing_date` forward but never clear or roll it back. Attempting either gets 403 "API tokens cannot clear or roll back the closing date (currently …)". Setting the override password gets 403 "API tokens cannot set the closing-date override password."
  - Tokens are blocked from user and token management whatever their role.
- **Agent discoverability**:
  - `/openapi.json` is public.
  - The spec declares an HTTP bearer security scheme `BearerToken` ("Scoped API token from Settings -> API Tokens … Session cookies from POST /api/auth/login are accepted equivalently"), applied globally. Public routes are marked `security: []`.
  - The API description lists agent conventions:
    - Unknown fields are rejected with 422.
    - Posted documents are voided, not deleted; `DELETE` answers 405 and names the `/void` route.
    - A document `tax_rate` is a fraction, while `default_tax_rate` is a percent string.
    - Enums are declared in the spec.

_Key files: `app/routes/api_tokens.py`, `app/services/api_token_service.py`, `app/models/api_tokens.py`, `app/main.py`, `app/database.py`, `app/static/js/settings.js`_

### Multi-company (company files & databases)

- **Two storage modes, chosen by `DATABASE_URL`**:
  - `sqlite:///…`: desktop mode, one `.db` file per company.
  - PostgreSQL: server mode, one database per company on the same server.
  - A process always serves exactly the database `DATABASE_URL` names.
- **Desktop (SQLite)**:
  - Data root: `SLOWBOOKS_DATA_DIR`, else `%LOCALAPPDATA%\SlowBooksPro\data` (Windows), `~/Library/Application Support/SlowBooksPro/data` (macOS) or `~/.slowbookspro/data` (other).
  - Company files live in `<data>/companies/<slug>.db`. The manifest `<data>/companies.json` holds `{"companies":[{"name","file"}],"last_opened"}` and is read BOM-tolerant (`utf-8-sig`).
  - File names are derived from the company name: lowercased, non-alphanumerics become `-`, at most 63 characters plus `.db`. They must match `^[a-z0-9][a-z0-9_-]{0,62}\.db$`; basename, leading-dot and `..` checks plus normpath containment guard against traversal.
  - Creating a company refuses:
    - an empty name;
    - a name with no letters or digits;
    - a derived file name that already exists or is already in the manifest (400 "A company file named '<file>' already exists").
  - Creation runs `alembic upgrade head` on the new file (never `create_all`), writes the typed `company_name` into its settings, seeds the full chart of accounts (`is_system=True`) and the default fixed-asset type, and registers the file in the manifest. The first company created becomes `last_opened`. A failed creation deletes the half-made file.
  - A missing manifest is logged once at startup ("Company manifest not found…").
- **Server (PostgreSQL)**:
  - `POST /api/companies` requires `database_name` matching `^[a-zA-Z][a-zA-Z0-9_-]{0,62}$`.
  - It runs `CREATE DATABASE` (quoted identifier, AUTOCOMMIT, via the `postgres` maintenance DB), then migrates and seeds as above, then registers a `companies` row (`name`, `database_name`, `description`).
  - Errors are 400 with a message: missing or invalid name, "already exists", or "Failed to create company database. Check server logs for details.".
  - `GET` lists the active `companies` rows plus the served database, always flagged `is_current`. When the served database has no `companies` row, a row is synthesized for it, named from `company_name` (or the database name).
- **Listing** — `GET /api/companies` (any role).
  - SQLite rows are `{name, file, is_current}`, after first syncing the manifest name to the books' `company_name`.
  - PostgreSQL rows are `{id, name, database_name, description, last_accessed, is_current}`.
  - Creating a company (`POST`) is admin-only.
- **Company names stay unique**:
  - Setup and `PUT /api/settings` refuse a `company_name` that another company file uses, compared case-insensitively or by derived file name, with 409 "Another company file (<file>) is already named '<name>'…".
  - A rename in Settings or a restore updates the manifest entry (`sync_manifest_name`). The books' own name always wins.
- **Switching companies**:
  - Desktop: **Company Files** page (`#/companies`) → **Switch company…**, desktop window only.
    - Asks "Sign out of this company and choose another?", then `POST /api/auth/logout`.
    - Opens the launcher picker, which stops the company's server, then migrates and starts the chosen one.
    - If sign-out fails with anything other than 401, the picker does not open.
  - Server installs: no in-app switch. The page says "the served company is chosen on the host PC".
- **Per-company files** — logo, attachments, employee documents (W-4/I-9 and so on) and pending receipt scans are rows in each company's own `stored_files` table (see *Attachments & company file store*). A company is therefore one file or one database, and a backup carries its files.
- **Company Files page UI**:
  - One card per company with name, file or database name, "(currently open)", description and last accessed.
  - **+ New Company** (admin) opens a modal with Company Name\*, Database Name ("Server installs only — auto-generated on desktop", pattern `[a-z0-9_]+`) and Description. The modal shows "Setting up … — this takes a few seconds."

_Key files: `app/routes/companies.py`, `app/services/company_service.py`, `app/models/companies.py`, `app/static/js/companies.js`, `desktop_launcher.py`_

### Settings catalog & validation

- **Storage** — a single key/value `settings` table (`key` unique, `value` text, `updated_at`). Reads merge the stored rows over `DEFAULT_SETTINGS` (70 keys). `GET /api/settings` is open to every role; `PUT /api/settings` and `POST /api/settings/test-email` are admin-only (writes under an admin prefix).
- **Company**:
  - `company_type` (`business`|`nonprofit`, enum-checked; default `business`). Drives vocabulary, nonprofit nav and reports; data never changes. In the SPA, changing it asks for confirmation, saves at once and reloads; switching to nonprofit also calls `POST /api/nonprofit/setup-accounts`.
  - `company_name` (default "My Company"), `company_address1`, `company_address2`, `company_city`, `company_state`, `company_zip`, `company_phone`, `company_email`, `company_website`, `company_tax_id`.
  - `operator_name`, `operator_email`.
- **Sign-in** — `ask_password_on_start` (`true`|`false`, enum-checked).
- **Document defaults and numbering**:
  - `default_terms` (default "Net 30"; the UI offers Net 15/30/45/60 and Due on Receipt; not validated server-side).
  - `default_tax_rate` (percent string 0–100 with at most 4 decimals; blank saves "0"; default "0.0").
  - `invoice_prefix` (default "").
  - `invoice_next_number` (whole number ≥1, typed leading zeros kept, so "0001" numbers invoices 0001, 0002…; default "1001").
  - `estimate_prefix` (default "E-"), `estimate_next_number` (≥1; default "1001").
  - `invoice_notes` (default "Thank you for your business."), `invoice_footer`.
  - `pdf_paper_size` (`letter`|`a4` in the UI; not validated server-side).
- **Closing date** — `closing_date` (ISO `YYYY-MM-DD` or empty; unparseable input is refused rather than silently turning the lock off) and `closing_date_password` (encrypted).
- **Email (SMTP)** — `smtp_host`, `smtp_port` (1–65535; default 587), `smtp_user`, `smtp_password` (encrypted), `smtp_from_email`, `smtp_from_name`, `smtp_use_tls` (default "true", meaning STARTTLS).
  - **Send Test Email** (`POST /api/settings/test-email`) mails `smtp_from_email`, or `smtp_user` when that is blank.
  - 400 "SMTP not configured" without a host.
  - 502 "Test email failed to send. See the email log for the reason." when the send fails; 500 generic on an exception. SMTP error text is logged, never returned.
- **Logo**:
  - `company_logo_path` holds `""` or `/api/uploads/logo/<id>`. Any other value renders no logo.
  - `invoice_show_logo` (`true`|`false`, enum-checked) applies to invoices only: PDF, print and emailed attachments.
- **Setup and currency** — `chart_setup_source`, `chart_setup_ready_at` (opening-balance wizard metadata) and `home_currency` (default "USD").
- **Online payments**:
  - Stripe: `stripe_enabled`, `stripe_publishable_key`, `stripe_secret_key` (enc), `stripe_webhook_secret` (enc).
  - PayPal: `paypal_enabled`, `paypal_environment` (sandbox|live), `paypal_client_id`, `paypal_client_secret` (enc), `paypal_webhook_id`.
  - Square: `square_enabled`, `square_environment` (sandbox|production), `square_access_token` (enc), `square_location_id`, `square_webhook_signature_key` (enc), `square_notification_url` (the exact URL Square signs).
- **Bank feed (SimpleFIN)** — `simplefin_access_url` (enc; embeds basic-auth credentials), `simplefin_account_map` ("{}"), `simplefin_accounts_cache` ("[]"), `simplefin_last_sync`.
- **QuickBooks Online**:
  - `qbo_enabled`, `qbo_client_id`, `qbo_client_secret` (enc), `qbo_redirect_uri` (default `http://localhost:3001/api/qbo/callback`), `qbo_environment` (default sandbox).
  - `qbo_access_token` (enc), `qbo_refresh_token` (enc), `qbo_realm_id`, `qbo_token_expires_at`, `qbo_oauth_state` (CSRF state).
- **Late fees** — `late_fee_enabled`, `late_fee_rate` (percent 0–100; default 1.5), `late_fee_grace_days` (whole number ≥0; default 15).
- **Receipt scanning** — `ocr_engine` (`auto`|`tesseract`, enum-checked; the `SLOWBOOKS_OCR_ENGINE` env var outranks it). The UI saves it as soon as it changes.
- **Keys stored outside `DEFAULT_SETTINGS`** — which `PUT /api/settings` therefore cannot write:
  - `auth_password_hash` and `company_session_id`: hidden from reads.
  - `walk_in_customer_id`.
  - AI Insights keys, written by `PUT /api/analytics/ai-config` (admin):
    - `ai_provider` must be one of `grok`, `groq`, `cloudflare`, `cloudflare_worker`, `anthropic`, `openai`, `gemini`, `custom` (else 400).
    - `ai_model`.
    - `ai_api_key` is Fernet-encrypted. Omitting it keeps the stored key; `""` removes it.
    - `ai_cloudflare_account_id` must be 32 lowercase hex characters.
    - `ai_worker_url` and `ai_endpoint_url` must be `https://` only, with no embedded credentials, no localhost, private, link-local, reserved or multicast hosts, and at most 2048 characters.
    - Test button: `POST /api/analytics/ai-config/test` (admin, 20/minute).
- **`PUT /api/settings` semantics**:
  - Accepts any subset of keys. Keys outside `DEFAULT_SETTINGS` are silently dropped: the body model allows extra fields, unlike the rest of the API.
  - Enum keys with other values: 422 "<key> must be one of: …".
  - All values are checked before any is written. Every problem is reported together in one 422 ending "Nothing was saved."
  - A secret key sent back as the redaction placeholder `********` is skipped, so saving the page never overwrites a stored secret.
  - Returns the redacted settings.
- **Redaction** — `redact_secrets()` replaces every non-empty value in `ENCRYPTED_SETTINGS_KEYS` with `********` for every role, admin included. The same function redacts the `company` dict handed to email templates and donor documents (GHSA-c3v4-f43f-4wqm), so `{{ company.smtp_password }}` renders asterisks. `auth_password_hash`, `session_secret` and `company_session_id` are excluded from every settings read and are never returned by the settings API (but see the audit-log note below).
- **Unreadable-secret detection**:
  - A `fernet:` value that no configured key decrypts reads as empty, never as an error. Uses of it fail closed: webhooks without a secret are refused, and a closing date without a readable password refuses changes.
  - `GET /api/settings/unreadable-secrets` returns `{"keys":[…]}`.
  - Settings shows an admin banner naming where each one must be re-entered, for example "the email password, under Email (SMTP)" or "the QuickBooks Online connection: connect again…". `ai_api_key` is included.
- **Settings page (`#/settings`, "Company Settings")**:
  - Sections, in order: Company Information, Company Logo, Invoice Defaults (the heading follows the company's vocabulary), Sign-in (desktop only), Closing Date, Email (SMTP), Online Payments, QuickBooks Online, AI Insights, Receipt Scanning, Late Fees, Email Templates, Classes, Cost Types, Cost Codes, Equipment, Backup / Restore, Files from earlier versions, Users, API Tokens.
  - A sticky **Save Settings** bar shows an "Unsaved changes" indicator. Leaving the page with unsaved edits asks for confirmation, and a `beforeunload` guard covers closing the tab.
  - Non-admins see the fields locked with "Company settings are changed by an administrator."

_Key files: `app/routes/settings.py`, `app/services/settings_service.py`, `app/models/settings.py`, `app/routes/analytics.py`, `app/services/ai_service.py`, `app/static/js/settings.js`_

### Encryption & key management

- **Encrypted settings** (`app/services/crypto.py`) — Fernet (AES-128-CBC + HMAC-SHA256), stored as `fernet:v1:<token>`.
  - Encrypted keys: `closing_date_password`, `smtp_password`, `stripe_secret_key`, `stripe_webhook_secret`, `paypal_client_secret`, `square_access_token`, `square_webhook_signature_key`, `qbo_client_secret`, `qbo_access_token`, `qbo_refresh_token`, `simplefin_access_url`, plus `ai_api_key` (written by the analytics route).
  - `set_setting` encrypts on write and never double-encrypts. Values without the prefix are treated as legacy plaintext.
  - At every boot `upgrade_plaintext_secrets()` encrypts any legacy plaintext secret rows, logging a constant message.
- **Settings key resolution (first hit wins)**:
  1. `SETTINGS_ENCRYPTION_KEY` env var. The desktop launcher generates one into the per-user `.env`.
  2. `.slowbooks-master.key` at the repo or install root.
  3. A key derived from `PAYROLL_ENCRYPTION_SECRET` via HKDF-SHA256 (salt `slowbooks-settings-key-v1`, info "slowbooks settings encryption"). A key derived from `PAYROLL_ENCRYPTION_SECRET_PREV` is added as a decrypt-only fallback (MultiFernet). The shipped placeholder secret is never used. This path lets a Docker container be recreated without losing saved passwords.
  4. Generate a new Fernet key into `.slowbooks-master.key` (0600, atomic write), with a warning to back it up.
  - The key is never stored in the database.
- **Payroll field encryption** (`app/services/encryption.py`) — Fernet keyed by PBKDF2-HMAC-SHA256 (480,000 iterations, static salt `slowbooks-payroll-v1`) from `PAYROLL_ENCRYPTION_SECRET`. Ciphertext is prefixed `v1:`; unprefixed legacy ciphertext still decrypts.
  - Used for `EmployeeBankAccount.routing_number_enc` / `account_number_enc` and `Employee.portal_token_enc`. The copy of the portal link an admin can see again is encrypted; lookup uses its SHA-256 digest.
  - Decryption tries the current key, then `PAYROLL_ENCRYPTION_SECRET_PREV`. It returns `None` for undecryptable data and logs an error.
  - Keys are derived at import, so changing them needs a restart.
  - SSNs are never stored in full; only `ssn_last_four` is kept, in plaintext.
- **Rotation / rewrap CLI** — `python -m app.services.encryption rewrap [--dry-run]`.
  - Re-encrypts bank-account fields under the current payroll key.
  - When the settings key source is `derived`, it also rewraps every `fernet:` settings row via `MultiFernet.rotate`.
  - Prints checked, already current, rewrapped and failed counts. Exits 1 if anything failed to decrypt; failures are logged, never wiped.
  - Documented procedure: move the live secret to `…_PREV`, set a new `PAYROLL_ENCRYPTION_SECRET`, restart, rewrap, then drop `…_PREV`.
- **Startup guard on keys** — a non-SQLite database with the placeholder payroll secret is fatal even under `APP_DEBUG=true`. In production the placeholder is fatal for any database (see *Startup guards*).
- **Other hashes**:
  - Passwords: Argon2id.
  - API tokens and portal links: SHA-256.
  - The closing-date password is encrypted (reversible), not hashed, and compared in constant time.

_Key files: `app/services/crypto.py`, `app/services/encryption.py`, `app/services/settings_service.py`, `app/models/payroll.py`, `app/models/bank_accounts.py`, `.env.example`_

### Closing date & override password

- **Lock** — with `closing_date` set, every posting path that calls `check_closing_date` (28 modules) refuses a transaction dated on or before it. The answer is 403 "Transaction date X is on or before the closing date (Y). Modifications to closed periods are not allowed."
- **Override** — when `closing_date_password` is set, a signed-in person can resend the refused change with header `X-Closing-Date-Password`.
  - The header is percent-encoded UTF-8, at most 1024 characters decoded. The comparison uses `hmac.compare_digest` over bytes.
  - The refusal adds header `X-Closing-Date-Override`:
    - `password` when none was given ("…Enter the closing-date password to make this change.").
    - `wrong-password` when the password did not match ("…The closing-date password you entered is not correct.").
    - `locked` during a lockout.
  - With no password configured, no header is sent and the change is simply refused.
  - The SPA (`api.js`) shows a masked "This date is in a closed period" dialog (**Make this change** / **Cancel**) and resends only that one request. The password is never stored.
  - The password travels on the DB session (`db.info`) and a request contextvar. Only an authenticated session's request carries it; API tokens never do.
- **Lockout**:
  - 5 wrong passwords within a 10-minute window lock the override for 10 minutes. During the lock even the right password is refused, and requests without a password are told at once.
  - The message reads "Too many wrong closing-date passwords were entered; try again in N minute(s)."
  - A right password clears the count.
  - Counters are in process memory, per company database URL, and reset on restart.
  - Wrong attempts are logged without the value.
- **Audit** — each request that uses the override writes one audit row (`closing_date`, `OVERRIDE`, `{closing_date, transaction_date}`, source `closing_date_override`) in the same transaction.
- **Changing the lock**:
  - Admins change it in Settings → **Closing Date**. A state line reads "Closed through …" or "No closing date: every period is open." and shows any pending unsaved change; a **Clear** button empties the date.
  - Tokens may only move the date forward (see *API tokens*).
  - An unreadable stored password means no override is possible; changes are still refused, never a 500.

_Key files: `app/services/closing_date.py`, `app/routes/settings.py`, `app/database.py`, `app/services/request_context.py`, `app/static/js/api.js`, `app/static/js/settings.js`_

### User preferences

- **Per-user JSON blobs** — `GET/PUT/DELETE /api/preferences/{key}`.
  - The key must match `^[a-z][a-z0-9_]{0,49}$` (422 "Preference key must be a short snake_case name").
  - `PUT` body is `{"value": {...}}` with an object value (422 `Send {"value": {...}}`), at most 16,000 characters of JSON (422 "Preference is too large").
  - `DELETE` restores the default. `GET` of an unset key returns `{"value": null}`.
- **Scoping** — rows are keyed by `(user_id, key)` with a unique constraint and cascade on user delete. Legacy operator sessions and API tokens have no `user_id` and share the `NULL` row.
- **Role effect** — `PUT`/`DELETE` are writes, so read-only sign-ins cannot save preferences.
- **Current use** — the dashboard layout (key `dashboard`, `{order: [...]}`) with save and reset.

_Key files: `app/routes/preferences.py`, `app/models/preferences.py`, `app/static/js/dashboard.js`_

### Backups & restore

- **Where** — `BACKUP_DIR` is `$SLOWBOOKS_DATA_DIR/backups` (desktop), else `<repo root>/backups`; in Docker that is `/app/backups`, volume `slowbooks_backups`. The folder is shared by every company on an install.
- **Create** (`POST /api/backups`, admin; optional `{notes}`):
  - SQLite: a consistent snapshot through the `sqlite3` online backup API.
  - PostgreSQL: `pg_dump -F c` (custom format) with a 300 s timeout and `PGPASSWORD` from `DATABASE_URL`.
  - File name: `<company-slug>_YYYYMMDD_HHMMSS.<db|sql>`. The slug is the company's file stem or database name, never the old anonymous `slowbooks`. Two backups in the same second get `-2`, `-3`… instead of overwriting.
  - A `backups` row (`filename`, `file_size`, `backup_type`, `notes`) is recorded. The answer is `{success, filename, file_size}`; a failure is 500.
- **List** (`GET /api/backups`, any role) — this company's backups that exist on disk, newest first.
  - A file counts as this company's when it is named for this company's slug. Legacy `slowbooks_*` files count when the `backups` table lists them or when a SQLite copy's `company_name` matches.
  - Other companies' backups are not listed.
  - Each entry: `id`, `filename`, `file_size`, `backup_type` (`manual` or `pre-restore`), `notes`, `created_at`.
- **Download** (`GET /api/backups/download/{filename}`, admin only in-route) — serves only files in this company's list, as `application/octet-stream`.
  - Invalid name: 400. Not in the list or missing: 404.
  - A backup is the whole company, including password hashes, encrypted keys and HR records, so only an admin may download it.
  - The desktop window's **Download** copies the file straight into `~/Downloads` through the launcher bridge (`save_backup_file`), adding a "(n)" suffix when the name is taken.
- **Restore** (`POST /api/backups/restore` `{filename, allow_other_company?}`, admin). Checks run in this order, and a refusal changes nothing:
  1. 400 invalid name (the file must match `^[A-Za-z0-9_.-]+\.(sql|dump|backup|db)$`: basename only, no leading dot, no `..`, normpath containment).
  2. 404 missing file.
  3. 409 `{"code":"qbo_import_running"}` while a QuickBooks Online import is active.
  4. 409 `{"code":"other_company", backup_company, current_company}` when the backup names another company, by its stored `company_name` (SQLite only) or its file-name slug, unless `allow_other_company=true`. The message allows for a company renamed since the backup was made.
  5. 409 `{"code":"newer_version"}` when a SQLite backup's `alembic_version` is unknown to this build ("Update SlowBooks Pro, then restore it.").
  - Then:
    - A `backups`/`RESTORE` audit row is committed in the current books.
    - A safety backup `<slug>_<stamp>-before-restore.<ext>` (`backup_type` `pre-restore`) is taken; if that fails, 500 and nothing is restored.
    - The restore runs. SQLite: the engine pool is disposed, then the online backup API copies over the live file. PostgreSQL: `pg_restore --clean --if-exists`.
    - On a server error the safety copy is put back.
    - SQLite only: the restored books are brought to this build's schema with `alembic upgrade head`. If that fails, the safety copy is restored and the answer is 500.
    - The company-picker name is synced to the restored books.
  - The answer includes `safety_backup`.
- **Restore UI** — Settings → **Backup / Restore**.
  - Buttons: **Create Backup**, **Download**, **Restore…**.
  - Restore opens a modal: "This replaces everything in <company>…", a required checkbox "I understand that everything since <when> will be replaced.", and the button **Replace my books with this backup**.
  - Another company's backup asks a second time ("Restore it over this company anyway?").
  - The page reloads after success.
- **Server script** (`scripts/backup.sh`) — `pg_dump -U $DB_USER $DB_NAME | gzip` to `$BACKUP_DIR/bookkeeper_YYYYMMDD_HHMMSS.sql.gz`.
  - Defaults: `BACKUP_DIR=~/bookkeeper-backups`, `DB_NAME`/`DB_USER` `bookkeeper`.
  - Plain-SQL format, restored with `psql`.
  - Keeps the 30 most recent dumps.
- **Limits**:
  - No scheduled or automatic in-app backups and no retention or pruning of in-app backups.
  - The PostgreSQL newer-version check, content-based ownership check and post-restore upgrade exist only for SQLite `.db` backups; PostgreSQL relies on the file-name slug.
  - PostgreSQL backups use a `.sql` extension although they are custom-format dumps.

_Key files: `app/routes/backups.py`, `app/services/backup_service.py`, `app/services/storage.py`, `app/models/backups.py`, `app/static/js/settings.js`, `scripts/backup.sh`, `desktop_launcher.py`_

### Audit log

- **Automatic capture** — a SQLAlchemy `after_flush` hook, registered once on `SessionLocal` and idempotent, writes one `audit_log` row per INSERT, UPDATE and DELETE on every table.
  - Columns: `table_name`, `record_id`, `action`, `old_values`, `new_values` (JSON snapshots), `changed_fields`, `timestamp`, `source` ("api"), `username`.
  - INSERT stores the full new row. UPDATE stores only changed attributes, old and new. DELETE stores the full old row.
  - Money (`Decimal`) is kept as exact strings, dates in ISO format, enums as their values.
- **Exclusions**:
  - Not audited: `audit_log` itself, `portal_accesses`, `login_attempts`, `document_audits`, `email_log`.
  - Column `password_hash` is recorded as `"***"`.
  - `LargeBinary` file bytes (`stored_files.data`) are never copied. The file's name, size and sha256 are.
- **Manual events** (`log_event`):
  - `backups`/`RESTORE` (source `admin`).
  - `closing_date`/`OVERRIDE` (source `closing_date_override`).
  - `shared_uploads`/`DELETE` (source `admin`, when the legacy uploads folder is cleared).
- **Attribution**:
  - A signed-in person's actions record their username.
  - Token actions record `token:<label>`.
  - Anything without a principal records `system` (for example boot-time writes and token `last_used_at` stamps).
  - The username travels on the request's DB session (`db.info["acting_username"]`, set by `get_db`), with a pure-ASGI middleware contextvar as fallback, so attribution survives the frozen Windows runtime.
  - Login self-attributes its own `last_login_at` update.
- **Viewer** — `#/audit` (**Audit Log**).
  - Filters: table (from `GET /api/audit/tables`), action (INSERT/UPDATE/DELETE), and a From/To date range.
  - Shows the latest 100 rows: Time (UTC converted to local), User, Table, ID, Action, and Changes (field old → new for updates, the first 3 fields for inserts, "Record deleted" for deletes).
  - The API adds `record_id` and `offset` filters; `limit` defaults to 100, maximum 500.
  - Open to admin and bookkeeper. Read-only roles are refused by the server, and the SPA shows "…isn't open to a read-only sign-in".
- **Not audited**:
  - Sessions opened on other engines, such as creating a new company or reading other company files.
  - Rate-limited or refused requests.

_Key files: `app/services/audit.py`, `app/models/audit.py`, `app/routes/audit.py`, `app/schemas/audit.py`, `app/database.py`, `app/services/request_context.py`, `app/static/js/audit.js`_

### Document audit hashes (tax forms)

- **What is hashed** — when a W-2, W-3, 940 or 941 PDF is generated (`GET`/`POST /api/payroll/forms/…/pdf`), the app takes SHA-256 over a canonical JSON of `{"company": <employer block>, "data": <computed form data>}`. Keys are sorted, separators compact, Decimals written as strings and dates in ISO format.
  - The hash covers content only. Re-rendering the same data another day gives the same hash.
- **Row written for every render** — `document_audits(id, doc_type, doc_key, content_hash, created_at)`.
  - `doc_type` and `doc_key`: `w2` → `emp<id>-yr<year>`; `w3` → `yr<year>`; `940` → `yr<year>`; `941` → `yr<year>-q<quarter>`.
- **PDF footer** — "Generated <YYYY-MM-DD HH:MM:SS UTC> · Audit ID #<id> · Hash <first 16 hex>".
- **Verification endpoints**:
  - `GET /api/document-audits`: optional `doc_type` and `doc_key` filters; `limit` 1–500, default 50; newest first.
  - `GET /api/document-audits/{id}`: 404 "Audit row not found".
  - `GET /api/document-audits/verify/{content_hash}`: exactly 64 lowercase hex characters (400 otherwise); returns every matching row.
  - Open to every signed-in role.
- **Limits**:
  - Independent per-document hashes, not a chain and not a digital signature; the database row is the trust anchor.
  - The hash is of the data, not the PDF bytes, so it can only be recomputed by regenerating the form.
  - No viewer UI (listed as future work in `docs/todo.md`).
  - 1099-NEC and 1096 PDFs carry no audit footer.

_Key files: `app/services/document_audit.py`, `app/models/document_audit.py`, `app/routes/document_audit.py`, `app/routes/payroll/tax_forms.py`, `app/templates/w2.html`, `app/templates/form_941.html`_

### Attachments & company file store

- **Company files live in the company's database** — since 2.18.0 every upload is its own row in `stored_files`. Nothing is written to disk.
  - Columns: `kind` (`logo`, `attachment`, `employee_document`, `receipt_scan`), `original_name`, `content_type`, `size`, `sha256`, deferred `data` (LargeBinary), `token`, `legacy_path`, `from_shared_folder`, `missing`, `created_at`.
  - IDs are never reused (`sqlite_autoincrement`).
  - A second upload with the same name is a second row.
  - Deleting an attachment deletes its bytes, and SQLite's `secure_delete=ON` overwrites the freed pages.
  - Pending receipt scans are swept after 24 h.
- **Record attachments** — `POST /api/attachments/{entity_type}/{entity_id}` (multipart `file`; admin or bookkeeper).
  - Entity types: `invoice`, `bill`, `expense`, `estimate`, `purchase_order`, `vendor_credit`, `vendor`, `customer`. Anything else: 400 "Invalid entity type. Allowed: …".
  - Allowed extensions: `.pdf .png .jpg .jpeg .gif .webp .txt .csv .doc .docx .xls .xlsx .zip`.
  - Allowed MIME types: `application/pdf`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `text/plain`, `text/csv`, `application/msword`, the DOCX, XLS and XLSX types, and `application/zip`. HTML, SVG and executables are excluded because files are served back under their stored type.
  - Extension and declared MIME type are each checked (400 "File extension '…' not allowed" / "MIME type '…' not allowed").
  - Maximum 50 MB (400 "File too large (max 50MB)").
  - File names are reduced to `Path(...).name`. Names that are empty or start with a dot are refused (400 "Invalid filename"). Characters outside `A-Za-z0-9 ._()-` become `_`.
- **List, download and delete**:
  - `GET /api/attachments/{entity_type}/{entity_id}` lists newest first: `id, entity_type, entity_id, filename, file_path ("stored_files/<id>"), mime_type, file_size, uploaded_at, from_shared_folder, missing`. The size is blanked when bytes are missing.
  - `GET /api/attachments/download/{id}` (declared before the catch-all route on purpose) returns the bytes with `Content-Disposition: attachment` and an RFC 6266 `filename*=UTF-8''…` plus an ASCII fallback. It also sets a sandbox CSP: `default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox`.
  - `DELETE /api/attachments/{id}` removes the row and its bytes.
  - These routes never return or delete employee documents (404), which share the table.
- **Employee documents (HR vault)** — `/api/employees/{id}/documents` routes, admin-only through the HR policy. Same extension and MIME allowlist, a `doc_category` form field (default `general`, at most 50 characters), and a 20 MB limit through `read_limited` (413 "The document is too large (limit 20 MB).").
- **Upgrade from the shared folder**:
  - Migration `c5e1f7a9b3d2` copies, once per company, each file its rows point at from the pre-2.18 shared `uploads` folder.
  - Copies are flagged `from_shared_folder`, because the file may be another company's. The UI notes it next to the file.
  - Files that were absent become `missing` rows with no bytes, answering 404 "…Attach the file again."
  - `/static/uploads/*` always answers 404; the folder is never served.
- **Other upload limits** — imports and scans (CSV, IIF, bank OFX/QFX/CSV, migration files, fixed-asset CSV, OCR receipt scans) go through `read_limited`: 20 MB, 413 "<label> is too large (limit 20 MB).". Saved-report parameters are capped at 64 KB and preferences at 16,000 characters.

_Key files: `app/services/file_store.py`, `app/models/stored_files.py`, `app/models/attachments.py`, `app/routes/attachments.py`, `app/schemas/attachments.py`, `app/services/upload_limits.py`, `app/routes/employees.py`, `app/database.py`_

### Company logo & legacy uploads folder

- **Upload** — `POST /api/uploads/logo` (admin; multipart `file`).
  - Allowed declared types: PNG, JPEG, GIF, WebP, SVG. Anything else gets 400 "Logo must be a PNG, JPEG, GIF, WebP, or SVG image (got '…')."
  - Empty file: 400. Over 5 MB: 400 "Logo is too large (N KB). Maximum 5 MB."
  - The stored name's extension comes from the verified content type, never from the uploaded file name.
  - Replacing a logo deletes the previous logo rows and their bytes, stores a new `logo` row, and sets `company_logo_path` to `/api/uploads/logo/<id>`, so the address changes with the image.
  - Answer: `{path, message}`.
- **Read**:
  - `GET /api/uploads/logo` (any role) returns `{path, filename, content_type, size, from_shared_folder, missing}`.
  - `GET /api/uploads/logo/{file_id}` serves the image with the sandbox CSP. Only `kind=logo` rows are served; anything else gets 404 "No logo is set."
  - SVG is safe here because it is shown only through `<img>`, embedded in PDFs, or served sandboxed.
- **Remove** — `DELETE /api/uploads/logo` (admin) drops every logo row and clears the setting.
- **PDFs** — the logo is embedded as a `data:` URI. Invoices honour `invoice_show_logo`; other documents include the logo whenever one is set. A logo that fails to load leaves the document without one rather than failing it.
- **UI** — Settings → **Company Logo**.
  - Preview, file chooser (admin), **Remove logo** ("Remove the company logo? Documents print without one until you upload another."), the hint "PNG, JPG, GIF, WebP, or SVG · max 5 MB · 200×80 px recommended", and a **Show company logo on invoices** checkbox.
  - A note appears when the logo was copied from the shared folder or is missing.
- **Legacy shared uploads folder** (`storage.uploads_root()`: `app/static/uploads` on a server, `<data dir>/uploads` on the desktop):
  - `GET /api/uploads/legacy` (admin) returns `{files, bytes, pending_companies, can_remove}`.
  - `DELETE /api/uploads/legacy` (admin) deletes the folder's regular files and any folders left empty, keeping the folder itself.
    - Refused with 409 while any company on the install has not yet run the copy migration. SQLite companies are checked read-only, including `immutable` mode for idle WAL files; PostgreSQL checks every database in the `companies` table.
    - Never follows symlinks or Windows junctions, stays on the same device, and descends at most 32 levels, using descriptor-relative calls on Linux and macOS.
    - An audit row records the removal.
  - UI: Settings → **Files from earlier versions** (admin, shown only while files remain). It explains which companies still need to be opened; **Remove them** is disabled until none do, and asks for confirmation first.

_Key files: `app/routes/uploads.py`, `app/services/file_store.py`, `app/services/legacy_uploads.py`, `app/services/storage.py`, `app/services/pdf_service.py`, `app/main.py`, `app/static/js/settings.js`_

### Security middleware, headers & CORS

- **Middleware order** — Starlette makes the last-added middleware the outermost. From outside in:
  1. `SessionMiddleware`
  2. `ActingUserContextMiddleware` (pure ASGI; contextvars for the acting user and closing-date password)
  3. `require_session` (sign-in gate and RBAC)
  4. `HTTPSRedirectMiddleware` (only when `FORCE_HTTPS`)
  5. `security_headers`
  6. `GZipMiddleware` (responses ≥1 KB, level 5)
  7. `CORSMiddleware`
  8. Routes and exception handlers.
- **Security headers** — set on every response that passes through the headers middleware, only when the route has not set the header itself. The portal uses this to send `no-referrer`/`no-store`, and served files send a sandbox CSP. The code comment also names the public pay page, but `public.py` sets no headers of its own.
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Cache-Control: no-cache`, so WebView2 revalidates after updates.
  - `Content-Security-Policy`.
  - `Strict-Transport-Security: max-age=<HSTS_MAX_AGE>; includeSubDomains; preload`, only when `FORCE_HTTPS`. The default is 63072000 s (2 years).
- **CSP (strict)** — `default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'`.
  - `'unsafe-eval'` is added only when `SLOWBOOKS_DESKTOP=1` and the client is loopback, because pywebview's bridge needs it on macOS WebKit. LAN, Server Edition and Docker browsers never get it.
  - Removing `'unsafe-inline'` remains an open TODO.
  - Served files (attachments, logo) override the CSP with the sandbox policy.
- **Desktop download fix** — a request carrying `X-Slowbooks-Desktop` has `Content-Disposition: attachment…` rewritten to `inline…`, so WebView2 and WKWebView `fetch()` calls can read PDFs and CSVs.
- **HTTPS redirect** — `FORCE_HTTPS=true`, the default when `APP_DEBUG=false`, adds Starlette's stock `HTTPSRedirectMiddleware`, emits HSTS and sets `Secure` on the session and portal cookies. The app code never reads `X-Forwarded-Proto`. Whether a proxied request counts as HTTPS depends on uvicorn's proxy-header trust, and the entrypoint does not configure it.
- **CORS**:
  - Explicit allowlist from `CORS_ALLOW_ORIGINS` (comma-separated). Default: `http://localhost:<APP_PORT>` and `http://127.0.0.1:<APP_PORT>`.
  - Never a wildcard. `allow_credentials=True`, all methods, all headers.
  - `docker-compose.prod.yml` requires the variable to be set.
- **Proxy trust**:
  - `TRUST_PROXY_HEADERS=true` makes the recorded client IP (login attempts, portal accesses) take the first `X-Forwarded-For` hop. Default off, because the header is client-spoofable on a direct deploy.
  - The rate limiter always keys on the socket peer.
- **Other**:
  - Uploads folder not served.
  - `/openapi.json` public.
  - Legacy `/analytics` answers 307 to `/#/analytics`.
  - The Docker image runs as UID 1000 (`slowbooks`) and has a `HEALTHCHECK` on `/health`.

_Key files: `app/main.py`, `app/config.py`, `app/services/request_utils.py`, `app/services/file_store.py`, `Dockerfile`, `docker-compose.prod.yml`_

### Startup guards & production configuration

- **`_run_startup_security_checks()`** — run in the lifespan before any request is served:
  1. **Unconditional**: a non-SQLite `DATABASE_URL` with `PAYROLL_ENCRYPTION_SECRET` equal to the public default `slowbooks-dev-payroll-key-change-me` is fatal, even under `APP_DEBUG=true`.
  2. **When `APP_DEBUG=false`**: the default payroll secret is fatal for any database.
  3. `SLOWBOOKS_PRIVATE_NETWORK=1` (default in `docker-compose.yml`) logs a warning and skips the remaining transport checks. The migration-head check is skipped too.
  4. A non-SQLite `DATABASE_URL` must contain `sslmode`, or `ssl` in any case; the check is a substring test. Otherwise fatal: "DATABASE_URL does not specify TLS mode in production".
  5. `FORCE_HTTPS=false` is fatal.
  6. **Migration-head guard**: if `alembic_version` exists and differs from this build's head, the app refuses to start. Otherwise `create_all()` would half-upgrade the database.
     - For an ordinary old database the message says to run `alembic upgrade head`.
     - When a pending revision's tables already exist (`looks_half_upgraded`), it prints the repair command for the install: `python3 scripts/repair-schema.py --database-url <url>`, or `SlowBooksPro.exe --_repair-schema` in a frozen bundle.
     - A database with no `alembic_version` is new and is allowed.
     - An unreadable version is logged and the start proceeds.
  7. `create_all()` for anything the migrations do not cover. On PostgreSQL it runs under `pg_advisory_xact_lock(7264013)` so multiple uvicorn workers do not race on enum creation.
- **Boot diagnostics, which never block startup**:
  - A one-time warning when the desktop company manifest is missing.
  - A warning listing any missing control accounts. Posting that needs them answers 409 until they are restored.
  - The plaintext-secret upgrader.
- **Shipped deployment profiles**:
  - Desktop launcher: `APP_DEBUG=true`, `FORCE_HTTPS=false`, `APP_HOST=127.0.0.1`. It generates a random payroll secret, session key and settings key into the per-user `.env` (mode 0600 on non-Windows).
  - `docker-compose.yml`: `SLOWBOOKS_PRIVATE_NETWORK=1`, `FORCE_HTTPS=false`, `PAYROLL_ENCRYPTION_SECRET` required (`:?`), 2 workers.
  - `docker-compose.prod.yml`: `sslmode=require` Postgres with mounted certificates, Postgres port not published, `APP_DEBUG=false`, `FORCE_HTTPS` true by default, `SESSION_SECRET_KEY`, `PAYROLL_ENCRYPTION_SECRET` and `CORS_ALLOW_ORIGINS` required, 4 workers, and a TLS proxy expected in front.
  - The Docker entrypoint waits up to 30 s for Postgres, runs `alembic upgrade head`, seeds, and runs `tests/test_wiring.py` only if pytest is installed; `SKIP_BOOT_SELFCHECK=1` skips it.

_Key files: `app/main.py`, `app/services/schema_repair.py`, `app/config.py`, `docker-compose.yml`, `docker-compose.prod.yml`, `docker-entrypoint.sh`, `desktop_launcher.py`_

### Rate limiting

- **Engine** — slowapi `Limiter(key_func=get_remote_address)`, keyed on the socket peer address. It uses slowapi's default in-memory storage, so counts are per process and per worker. `RATE_LIMIT_ENABLED` defaults to on; `0`, `false`, `no` or `off` disables it.
- **Response** — 429 from slowapi's default handler, with body `{"error": "Rate limit exceeded: …"}`. The SPA shows "Rate limit exceeded -- slow down and try again".
- **Limits**:
  - `POST /api/auth/login`: 5/minute.
  - `POST /api/payments/{provider}/create-checkout-session` (public): 10/minute.
  - Portal `GET` pages (`/portal/`, `/portal/paystubs`, `/portal/profile`, `/portal/bank`, `/portal/pto`, and the legacy `/portal/{token}` variants): 30/minute.
  - Portal `POST` (profile, bank, pto, and the legacy token variants): 10/minute.
  - `POST /api/analytics/ai-config/test` and `POST /api/analytics/ai-actions/{key}`: 20/minute.
  - `POST /api/analytics/ai-insights` and `POST /api/analytics/ai-query`: 10/minute.
  - `POST /api/ocr/receipt`: 30/minute.
  - `POST /api/ocr/intake/{id}/region`: 60/minute.
- **Separate lock** — the closing-date override lockout (5 wrong in 10 minutes → locked 10 minutes) is its own in-process counter (see *Closing date*).

_Key files: `app/services/rate_limit.py`, `app/main.py`, `app/routes/auth.py`, `app/routes/portal.py`, `app/routes/analytics.py`, `app/routes/ocr.py`, `app/routes/provider_payments.py`_

### Errors, validation messages & request context

- **Validation errors (422)** — FastAPI's error list is kept unchanged, and each entry gets a plain-English `message` naming the field as the form labels it.
  - Examples: "Name is required.", "Name must be 200 characters or fewer.", "Line 2: Quantity must be a number.", "Email must be an email address, like name@example.com.", "'x' is not a field this accepts."
  - Acronyms such as EIN, SSN, SMTP and URL are capitalised.
  - Nonprofit companies get the messages reworded into their vocabulary.
  - NaN and Infinity values echoed from the request are turned into strings, so a 422 never becomes a 500.
  - The SPA (`API.errorMessage`) shows the messages.
- **Unknown fields** — request bodies derive from `StrictModel` (`extra="forbid"`) and answer 422. `PUT /api/settings` and `PUT /api/preferences` are the exceptions.
- **HTTPException wording** — for nonprofit companies every string `detail` is reworded at the boundary, whole-word and case-preserving; for example "Invoice not found" becomes "Pledge not found".
- **`DELETE` on a posted document** — 405 "Posted documents are voided, not deleted: use POST <path>/void" when a matching `/void` route exists.
- **Missing control account** — 409 naming the account number and name. Nothing is posted.
- **Safe error text** (`safe_message`):
  - Only a sentence raised with `user_text` (`DataProblem`) reaches the user.
  - An `IntegrityError` is reduced to its constraint line ("Database constraint: …").
  - Other SQLAlchemy errors become "Database error — the server log has the details".
  - Decimal errors become "a number could not be read".
  - Anything else becomes "unexpected error — the server log has the details", with the traceback logged.
  - Backup, restore and SMTP failures log details and answer generically, except the PostgreSQL backup and restore paths noted below.
  - FastAPI debug mode is never enabled, so unhandled exceptions answer a plain 500.
- **Request context** — two contextvars.
  - `acting_username`, used by the audit hooks.
  - `closing_date_password`, never logged or echoed.
  - `get_db()` also stamps both onto the request's DB session (`db.info`), which works reliably even where contextvar propagation does not. For token requests it stamps `token:<label>`.
- **Download names** — `content_disposition()` builds RFC 6266 headers (`filename*=UTF-8''…` plus an ASCII fallback), so names such as "Łódź" no longer cause a 500.

_Key files: `app/main.py`, `app/services/validation_messages.py`, `app/services/safe_errors.py`, `app/schemas/common.py`, `app/services/request_context.py`, `app/services/request_utils.py`, `app/database.py`_

### System info, update check & health

- **`GET /health`** — public liveness probe returning `{"status":"ok","version":"2.18.1"}`. It makes no database check. Used by the Docker `HEALTHCHECK` and the desktop launcher's startup wait.
- **`GET /api/system`** (signed in) — `{version, desktop, server_mode, update_check_enabled}`. The SPA uses it for the sidebar and footer version label ("vX" or "vX · Server"), the "Server Edition" label, and the desktop-only Sign-in settings section.
- **`GET /api/system/update-check`** (signed in):
  - Active only when `SLOWBOOKS_DESKTOP=1` and `SLOWBOOKS_UPDATE_CHECK` is not `0`, `false`, `no` or `off`. Otherwise it answers `{"update_available": false}` without any network request.
  - Fetches `https://dl.slowbookspro.com/latest.json` with User-Agent `SlowBooksPro/<version>` and a 6 s timeout. The request reveals the install's IP address and version to that host.
  - Compares versions numerically ("v2.1.0" → (2,1,0)).
  - Answers `{update_available, latest_version, download_url, notes_url}`, cached for 12 h per process. Any failure means "no update".
  - The SPA shows a non-blocking "Version X is available" badge at the top of the sidebar.
- **App version** — `app/__init__.py` `__version__ = "2.18.1"`. It is served in the OpenAPI spec, `/health` and `/api/system`.

_Key files: `app/routes/system.py`, `app/main.py`, `app/__init__.py`, `app/static/js/app.js`, `Dockerfile`_

### Schema repair & maintenance scripts

- **`scripts/repair-schema.py --database-url <url> [--dry-run]`** — frozen builds use `SlowBooksPro.exe --_repair-schema …`. It recovers a database that `create_all()` half-upgraded.
  1. Proves the migration machinery loads before changing anything.
  2. Drops, in one pass, the tables the pending revisions will create, but only when they exist and are empty. If any holds rows it refuses: "…This needs a person."
  3. Runs `alembic upgrade head`, with a retry net of up to 25 rounds for "already exists".
  - Prints the revision before and after, the dropped tables, and OK or FAILED. Exit code 0 or 1.
- **`scripts/repair_employee_enums.py [--apply] [--json]`** — raw-SQL scan for `employees.pay_type` and `role` values outside their enums (such rows make `GET /api/employees` fail with a 500). A dry run by default. `--apply` normalizes values to `HOURLY` and `EMPLOYEE` (least privilege); `pay_rate` is untouched.
- **`scripts/repair_rounding_drift.py [--apply] [--json]`** — detects header drift on invoices, bills, estimates and purchase orders, where the subtotal differs from the sum of line amounts, or tax, total or balance due disagree. `--apply` rewrites header totals only, never lines. Journal debit/credit imbalances on invoices and bills are reported, never auto-fixed.
- **Key rewrap** — `python -m app.services.encryption rewrap [--dry-run]` (see *Encryption*).
- **Server backup** — `scripts/backup.sh` (see *Backups*).

_Key files: `scripts/repair-schema.py`, `app/services/schema_repair.py`, `scripts/repair_employee_enums.py`, `scripts/repair_rounding_drift.py`, `app/services/encryption.py`, `desktop_launcher.py`_

### Environment variables

- **`DATABASE_URL`** (default `postgresql://bookkeeper:bookkeeper@localhost:5432/bookkeeper`) — a `sqlite:///` URL selects desktop mode. The engine pool uses `pool_pre_ping` everywhere; on PostgreSQL it adds `pool_size` 10, `max_overflow` 20, `pool_recycle` 1800 and LIFO reuse. SQLite connections set `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL` and `secure_delete=ON`.
- **`APP_HOST`** (`0.0.0.0`), **`APP_PORT`** (3001; also sets the CORS default).
- **`APP_DEBUG`** (`false`) — relaxes the production transport guards and enables uvicorn reload in `run.py`. It does not relax the key guard for real databases.
- **`FORCE_HTTPS`** — defaults to true unless `APP_DEBUG=true`. Enables the redirect, HSTS and Secure cookies.
- **`HSTS_MAX_AGE`** (63072000).
- **`TRUST_PROXY_HEADERS`** (`false`).
- **`SESSION_IDLE_TIMEOUT_SECONDS`** (14400; `0` disables).
- **`SESSION_SECRET_KEY`** (unset → key file).
- **`RATE_LIMIT_ENABLED`** (`1`).
- **`CORS_ALLOW_ORIGINS`** (unset → loopback on `APP_PORT`).
- **`PAYROLL_ENCRYPTION_SECRET`** (placeholder default, refused where it matters), **`PAYROLL_ENCRYPTION_SECRET_PREV`** (rotation fallback).
- **`SETTINGS_ENCRYPTION_KEY`** (optional; see the key resolution order).
- **`SLOWBOOKS_PRIVATE_NETWORK`** (`1` relaxes the database TLS and `FORCE_HTTPS` checks for a single host).
- **`SLOWBOOKS_DESKTOP`** (launcher sets `1`) — enables the desktop CSP relaxation for loopback, ask-password-on-start, the update check and `desktop` status.
- **`SLOWBOOKS_SERVER_MODE`** (launcher sets `1` when binding beyond loopback).
- **`SLOWBOOKS_DATA_DIR`** (data root for companies, manifest, backups and legacy uploads), **`SLOWBOOKS_ENV_FILE`** (which `.env` to load; default `<repo root>/.env`).
- **`SLOWBOOKS_UPDATE_CHECK`** (on; `0`, `false`, `no` or `off` disables), **`SLOWBOOKS_OCR_ENGINE`** (overrides `ocr_engine`).
- **`COMPANY_NAME`/`COMPANY_ADDRESS`/`COMPANY_PHONE`/`COMPANY_EMAIL`** — used only as fallbacks in payroll documents when the settings are blank.
- **`DEFAULT_TERMS`/`DEFAULT_TAX_RATE`** — read into config but not used anywhere.
- **`EMPLOYER_EIN`/`EMPLOYER_STATE`/`SUTA_RATE`** — payroll.
- **Docker only** — `APP_WORKERS` (2 in dev compose, 4 in prod compose), `SKIP_BOOT_SELFCHECK`, `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`, `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`.

_Key files: `app/config.py`, `app/database.py`, `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml`, `desktop_launcher.py`_

### Security policy & compliance documents

- **`SECURITY.md`**:
  - Supported version: the latest main branch.
  - Report privately through GitHub private vulnerability reporting, or by email to the maintainer (address in the file). Do not open public issues.
  - Timeline: acknowledgment within 48 h, assessment within 1 week, fix "as soon as practical".
  - Lists the measures in place (sessions, transport, headers, at-rest encryption, portal tokens, input validation, CORS, SSRF, non-root Docker, pinned dependencies).
  - Fixed-advisory table: GHSA-rh68-48w8-pj8r, GHSA-rh75-6834-f66j, GHSA-pwj7-6qq3-h4fj, GHSA-rm5h-555g-vpjj (all 2.9.2), and CodeQL alert 58 / #104 SSRF (2.9.3).
  - Known considerations: designed for a LAN or a single machine; use a TLS proxy for external access; OAuth and SMTP secrets live in the database; do not commit `.slowbooks-session.key`; treat portal URLs like password-reset links.
- **`docs/security-hardening.md`**:
  - Engineering log of the hardening pass: startup checks, HTTPS redirect, HSTS, Secure cookie, CSP, route-overridable headers, portal token expiry (90-day idle, 1-year hard, 410 Gone), portal no-referrer and no-store, `v1:` ciphertext, the `_PREV` key.
  - OWASP Top-10 mapping.
  - Production checklist.
  - The AST-based CI test `tests/test_subprocess_safety_audit.py`: no `shell=True`, `os.system` or `os.popen`, and quoted `$VAR` in bash scripts.
- **`docs/tls-proxy-setup.md`** — Caddy, nginx + certbot, and Traefik recipes; notes on cloud load balancers; a pitfalls table (redirect loops, HSTS caching, Let's Encrypt rate limits).
- **`docs/hipaa-compliance.md`** (last updated 2026-05-21):
  - Says the app is **not a HIPAA-covered system by default**: it stores no claims, diagnoses or treatment data.
  - Maps the §164.312 technical safeguards:
    - automatic logoff via the idle timeout;
    - Fernet encryption at rest for bank numbers and AI keys;
    - audit controls: `login_attempts`, `audit_log`, `document_audits`, portal `last_used`;
    - integrity: Fernet HMAC and tax-form hashes;
    - authentication: Argon2id, the 5/min login limit and 192-bit portal tokens;
    - transmission: HTTPS, HSTS and the database TLS guard.
  - Administrative and physical safeguards are mostly the customer's responsibility; backups count as the contingency plan.
  - Admitted gaps:
    - no role-based access control (stale; see Notes);
    - employee names and addresses not encrypted;
    - no retention or purge enforcement;
    - no breach-notification alerting;
    - no employee data-export endpoint;
    - no BAA template;
    - no FIPS 140-2 attestation;
    - no HSM/KMS key escrow.
  - Recommends TLS, restricted database access with `verify-full`, GPG-encrypted off-host backups, annual payroll key rotation, and weekly review of login and audit logs.
  - Notes that "aligned" is not "certified", and tracks pyjwt PYSEC-2025-183.

_Key files: `SECURITY.md`, `docs/security-hardening.md`, `docs/tls-proxy-setup.md`, `docs/hipaa-compliance.md`, `docs/server-edition.md`, `docs/operations.md`_

### API endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/api/auth/status` | Public. Setup/sign-in state, multi-user flag, usernames (multi-user, before sign-in), company name, desktop flag, current user and role |
| POST | `/api/auth/setup` | Public, one time only. Set the operator password (≥8) plus optional company and operator settings; creates the `admin` user and signs in (409 once set) |
| POST | `/api/auth/login` | Public, 5/min. Password (+ username on multi-user); records `login_attempts`; issues the session |
| POST | `/api/auth/logout` | Public. Clears the session cookie |
| GET | `/api/users` | Admin. List users (no hashes) |
| POST | `/api/users` | Admin. Create a user (username rules, role, password ≥8; 409 duplicate) |
| PUT | `/api/users/{user_id}` | Admin. Change display name, role, active flag or password; refuses to remove the last active admin (409) |
| GET | `/api/tokens` | Admin session only. List API tokens (hint, role, last used; never secrets) |
| POST | `/api/tokens` | Admin session only. Create a token; returns the `sbp_…` secret once |
| PUT | `/api/tokens/{token_id}` | Admin session only. Rename or revoke/reactivate a token |
| GET | `/api/companies` | Any role. List company files (SQLite manifest) or company databases (PostgreSQL) with `is_current` |
| POST | `/api/companies` | Admin. Create a company file or database (migrated and seeded) |
| GET | `/api/backups` | Any role. This company's backups on disk, newest first |
| POST | `/api/backups` | Admin. Create a backup (SQLite snapshot / `pg_dump -F c`) |
| GET | `/api/backups/download/{filename}` | Admin. Download one of this company's backups |
| POST | `/api/backups/restore` | Admin. Restore with safety backup; 409 `other_company` / `newer_version` / `qbo_import_running` |
| GET | `/api/settings` | Any role. All settings merged over defaults, secrets redacted |
| GET | `/api/settings/unreadable-secrets` | Any role. Encrypted settings no configured key can decrypt |
| PUT | `/api/settings` | Admin. Validate-all-then-save; placeholder-safe for secrets; token closing-date guard |
| POST | `/api/settings/test-email` | Admin. Send an SMTP test email |
| GET | `/api/preferences/{key}` | Any role. This user's preference JSON (or null) |
| PUT | `/api/preferences/{key}` | Admin/bookkeeper. Save `{"value": {...}}` (≤16,000 chars) |
| DELETE | `/api/preferences/{key}` | Admin/bookkeeper. Reset the preference to default |
| GET | `/api/audit` | Admin/bookkeeper. Audit rows (filters: table_name, action, record_id, start_date, end_date; limit ≤500, offset) |
| GET | `/api/audit/tables` | Admin/bookkeeper. Distinct audited table names |
| GET | `/api/document-audits` | Any role. Tax-form hash rows (doc_type, doc_key, limit 1–500) |
| GET | `/api/document-audits/{audit_id}` | Any role. One audit row (the ID printed in a PDF footer) |
| GET | `/api/document-audits/verify/{content_hash}` | Any role. Rows matching a 64-hex SHA-256 |
| POST | `/api/attachments/{entity_type}/{entity_id}` | Admin/bookkeeper. Upload an attachment (allowlisted type/extension, ≤50 MB) into the company database |
| GET | `/api/attachments/download/{attachment_id}` | Any role. Download an attachment (sandbox CSP); never employee documents |
| GET | `/api/attachments/{entity_type}/{entity_id}` | Any role. List a record's attachments |
| DELETE | `/api/attachments/{attachment_id}` | Admin/bookkeeper. Delete an attachment and its bytes |
| POST | `/api/uploads/logo` | Admin. Upload or replace the company logo (PNG/JPEG/GIF/WebP/SVG, ≤5 MB) |
| GET | `/api/uploads/logo` | Any role. Current logo info (path, name, type, size, shared-folder/missing flags) |
| DELETE | `/api/uploads/logo` | Admin. Remove the logo and its bytes |
| GET | `/api/uploads/logo/{file_id}` | Any role. The logo image (sandbox CSP) |
| GET | `/api/uploads/legacy` | Admin. What the pre-2.18 shared uploads folder still holds and which companies still need it |
| DELETE | `/api/uploads/legacy` | Admin. Clear that folder's files (409 while a company still needs them) |
| GET | `/api/system` | Any role. Version, desktop/server mode, whether the update check is enabled |
| GET | `/api/system/update-check` | Any role. Desktop-only proxied check of `latest.json` (12 h cache) |
| GET | `/api/analytics/ai-config` | Any role (analytics router). AI provider settings for display (never the key) |
| PUT | `/api/analytics/ai-config` | Admin (analytics router). Save AI provider, model, key (Fernet) and SSRF-validated URLs |
| POST | `/api/analytics/ai-config/test` | Admin, 20/min (analytics router). Smoke-test the AI provider |
| GET | `/health` | Public. Liveness `{status, version}` |
| GET | `/` | Public. SPA shell (`index.html`) |
| GET | `/favicon.ico` | Public. Favicon |
| GET | `/analytics` | Public. 307 redirect to `/#/analytics` |
| GET, HEAD | `/static/uploads/{rest}` | Always 404; the legacy uploads folder is never served |
| GET | `/openapi.json` | Public. OpenAPI spec with the `BearerToken` scheme |
| GET | `/docs`, `/redoc` | FastAPI defaults; behind the sign-in gate |

### Notes, gaps & discrepancies

- **Code observations: access control**
  - **Password hash in the audit log** — audit redaction matches the column name `password_hash` only. The settings row `auth_password_hash`, which holds the operator's Argon2id hash in its `value` column, is snapshotted in plain form into `audit_log` whenever it is written. Admins and bookkeepers can read it through `GET /api/audit?table_name=settings`. The test suite checks redaction only for the `users` table.
  - **Bookkeepers can read HR data through the audit log** — HR and payroll routes are admin-only, but bookkeepers may read `/api/audit`. Audit rows for `employees`, pay stubs and bank-account rows expose historical values (pay rates, addresses, SSN last four, ciphertexts) that the employee routes blank for non-admins.
  - **AI key ciphertext exposed** — `GET /api/settings` returns the `ai_api_key` ciphertext (`fernet:v1:…`) to every role, including read-only. The key is not in `ENCRYPTED_SETTINGS_KEYS`, so it is not redacted; it is still encrypted.
  - **Document audits open to all roles** — `/api/document-audits` is readable by every role. The route's header comment says "admin-only lookup".
  - **Sessions cannot be revoked server-side** — role, deactivation and logout changes do not invalidate existing cookies before they expire.
- **Code observations: middleware and deployment**
  - **Middleware order** — derived from the registration order:
    - The gate's 401/403 answers and the HTTPS redirect are produced outside the security-headers middleware, so they carry no CSP or nosniff headers.
    - The HTTPS redirect sits inside the sign-in gate, so an unauthenticated plain-HTTP API call gets 401 rather than a redirect. The comment in `main.py` calls the redirect the "OUTERMOST request gate".
    - CORS is innermost, so a cross-origin preflight to a gated path is answered 401 by the gate. The CORS tests use only the exempt `/api/auth/status`.
  - **Rate-limiter address** — the limiter keys on the socket peer, not `TRUST_PROXY_HEADERS`. Behind a proxy that uvicorn does not trust, all clients share one bucket. `.env.example` says the limiter "then use[s] the real client address".
  - **Per-process counters** — rate-limit and closing-date-lock counters live in process memory, per uvicorn worker (2–4 in Docker), and reset on restart.
  - **Docker health check with `FORCE_HTTPS`** (inferred) — with `FORCE_HTTPS=true` (the `docker-compose.prod.yml` default), `/health` is also redirected. The image `HEALTHCHECK` probes plain `http://127.0.0.1:3001/health` with no forwarded-proto header. `config.py` names health probes as a reason to disable `FORCE_HTTPS`, which the startup guard refuses without `SLOWBOOKS_PRIVATE_NETWORK=1`.
  - **Private-network flag skips the migration guard** — `SLOWBOOKS_PRIVATE_NETWORK=1` also skips the migration-head guard. The Docker entrypoint migrates first anyway.
  - **Loose TLS check** — the database TLS guard is a substring test for `ssl` anywhere in `DATABASE_URL`.
  - **PostgreSQL company creation drops URL options** — the new database's URL is built by cutting `DATABASE_URL` at its last `/`, so query options such as `?sslmode=require` are not carried to the `CREATE DATABASE` and migration connections.
  - **Interactive API docs unusable** (inferred) — FastAPI's `/docs` and `/redoc` sit behind the gate and load their assets from a CDN that the CSP does not allow. Only `/openapi.json` is intended for use.
- **Code observations: errors, keys and files**
  - **PostgreSQL error text reaches the client** — `pg_dump` stderr is returned verbatim, and `pg_restore` stderr up to 500 characters, in the HTTP error detail. Everything else follows the no-exception-text policy.
  - **Rewrap gaps**:
    - The rewrap CLI does not re-encrypt `Employee.portal_token_enc`. After `…_PREV` is dropped, the admin's "copy link again" returns nothing; the link itself still works.
    - A key supplied via `SETTINGS_ENCRYPTION_KEY` or the key file has no previous-key fallback or rewrap path. Changing it leaves saved secrets unreadable until they are re-entered.
  - **Upload size checks**:
    - Attachment uploads read the whole body before the 50 MB check and answer 400, not 413.
    - The declared MIME type is trusted without sniffing, and the extension and MIME type need not agree.
    - The target record's existence is not checked.
    - Employee documents are effectively capped at 20 MB (`read_limited`), behind a redundant "max 50MB" check.
  - **Backup script failure branch** — `scripts/backup.sh` runs under `set -eo pipefail`, so the script exits on a failed dump before its failure branch runs. A partial `.gz` can be left behind.
  - **429 on the sign-in screen** — slowapi's 429 body uses `error`, not `detail`, so the sign-in overlay shows "Request failed" when rate-limited. The main `api.js` wrapper special-cases 429.
- **Discrepancies: docs vs code**
  - `SECURITY.md`:
    - "Single-user session authentication": multi-user RBAC exists.
    - "Path.is_relative_to()" traversal checks: the code uses basename, regex and normpath/startswith, and attachments are no longer on disk.
    - AI keys "encrypted with the same Fernet scheme" as bank data: they use the settings key (`crypto.py`), not the PBKDF2 payroll key.
    - The known-considerations list omits that OAuth and SMTP secrets are now Fernet-encrypted.
    - The fixed-advisory table omits GHSA-c3v4-f43f-4wqm (email-template secret leak, fixed in 2.12.0 per the CHANGELOG).
  - `docs/security-hardening.md`:
    - Names `startup_security_checks()` and "three checks". The code is `_run_startup_security_checks()`, with the unconditional key check and the `SLOWBOOKS_PRIVATE_NETWORK` bypass as well.
    - Describes a "308" redirect. The app uses Starlette's stock `HTTPSRedirectMiddleware`, which upstream answers with 307.
    - Its test counts (452) are stale.
  - `docs/tls-proxy-setup.md`:
    - "The app reads X-Forwarded-For and X-Forwarded-Proto correctly": `X-Forwarded-For` is read only with `TRUST_PROXY_HEADERS=true`, and `X-Forwarded-Proto` is never read by app code.
    - "Should 308": see above.
    - Suggests `FORCE_HTTPS=false` behind a proxy, which the production startup guard refuses.
  - `docs/operations.md`:
    - `backup.sh` output is named `bookkeeper-YYYY-MM-DD-HHMM.sql.gz`; the code writes `bookkeeper_YYYYMMDD_HHMMSS.sql.gz`.
    - `document_audits` is called a "hash chain"; the rows are independent hashes.
    - `login_attempts` is described as "every admin login attempt"; the table stores no username and skips 429, 400 and 409 answers.
  - `docs/server-edition.md`: "the header reads SERVER EDITION" once a second user exists. The label follows `--serve-lan` server mode, not the user count; a second user adds the username prompt and the user chip.
  - `docs/hipaa-compliance.md`:
    - Says "Single-operator design; no multi-tenant users yet" and lists "No role-based access control" as a high-severity gap, both stale.
    - Claims "content-hash chaining".
  - `docs/features.md`:
    - `/api/backups/{id}/download`; actual: `/api/backups/download/{filename}`.
    - `/api/attachments/{type}/{id}` for GET, POST and DELETE; actual DELETE is `/api/attachments/{id}`, plus a separate download route.
    - "Multi-Company… switchable from UI": desktop picker only; server installs cannot switch.
    - Tax-form audit hashes claimed for 1099-NEC and 1096: only W-2, W-3, 940 and 941 have them.
  - `.env.example`: `DEFAULT_TERMS` and `DEFAULT_TAX_RATE` are presented as company defaults but are never used. `COMPANY_*` values act only as payroll-document fallbacks and are not seeded into Settings.
  - API description: "Unknown fields are rejected". Exceptions: `PUT /api/settings` silently drops unknown keys, and preferences accept any object.
- **Discrepancies: code comments vs code**
  - `main.py`: the CORS comment says to override with `ALLOWED_ORIGINS`; the variable read is `CORS_ALLOW_ORIGINS`.
  - `models/preferences.py`: "API-token principals never write preferences" is not enforced.
  - `models/backups.py`: `backup_type` is documented as "manual, auto"; the code produces only `manual` and `pre-restore`.
  - The SPA sends an `X-Company-Id` header (from `localStorage.slowbooks_company`) that no server code reads.
  - The SPA QBO Redirect URI fallback is `http://localhost:8000/…`; the server default is `:3001`.
  - `companies.last_accessed` is never updated after creation.
  - Dead code: `get_company_db_url`, `check_password`, `require_auth`, `list_backup_files`.
- **Known limitations, TODOs and feature flags**:
  - No MFA or per-account lockout.
  - Non-admins cannot change their own password.
  - No in-app scheduled backups or backup retention.
  - Server Edition runs plain HTTP ("TLS support is planned").
  - CSP still allows `'unsafe-inline'` (open TODO).
  - No document-audit viewer UI.
  - A restricted `kiosk` role for Server Edition is planned in `docs/todo.md`; it is not implemented.

---

_[← 7. Import, Export, Migration & Interoperability](07-import-export-migration.md) · [Index](README.md) · [9. User Interface, Desktop Apps, Deployment & Engineering →](09-ui-desktop-deployment-engineering.md)_
