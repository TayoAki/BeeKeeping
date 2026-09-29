_SlowBooks Pro 2026 feature inventory — [← 8. Platform, Security & Administration](08-platform-security-administration.md) · [Index](README.md) · [Appendix A. Complete API endpoint catalog →](appendix-a-api-endpoints.md)_

## 9. User Interface, Desktop Apps, Deployment & Engineering

The interface is one static `index.html` shell (toolbar, left "Navigator" sidebar, status bar, splash/About box, one shared dialog and a toast region) driven by 55 plain-JavaScript files loaded in a fixed order with no framework and no build step; `app.js` hash-routes 64 addresses, applies role-aware locking and the nonprofit vocabulary at boot, and hosts the Chart of Accounts, Quick Entry and CSV pages itself. The same web app ships three ways: a native desktop window (pywebview on WebView2/WKWebView) managed by `desktop_launcher.py` and frozen with PyInstaller into a signed Windows installer and a notarized Apple Silicon DMG; a headless LAN "Server Edition" mode of that same executable; and a Docker image with single-host and production Compose files on PostgreSQL 17. Engineering rests on 44 linear Alembic revisions, five GitHub Actions workflows (Linux and Windows test jobs, CodeQL, pip-audit, Windows and macOS release builds), and a test suite of 302 pytest modules (about 2,370 test functions) plus 41 Node-driven probes and suites that exercise the browser code.

### SPA shell & boot sequence

- **Static shell** — `index.html` (`lang="en"`, title "Slowbooks Pro 2026") is served raw at `/`; the `/static` mount serves CSS/JS/JSON; `/analytics` 307-redirects to `/#/analytics`; `/health` (public) answers `{"status":"ok","version":…}`.
  - Layout: skip link → `#topbar` → `#main-area` (`<nav id="sidebar">` + `<main id="content"><div id="page-content">`) → `#statusbar`; outside the app frame: `#splash`, `#modal-overlay`/`#modal`, `#toast-container`.
  - 55 `<script>` tags in a fixed order: `desktop_shim.js` first (its `window.open` override is installed before any page runs), then `api.js`, `utils.js`, `terms.js`, the OCR helpers, about 44 page modules, the vendored Chart.js 4.4.6 (`chart.umd.js`, "self-hosted, no CDN") with `analytics.js`, `auth.js` (must precede `app.js`), `app.js` ("App must be last"), and finally `bootstrap.js`.
  - Two stylesheets: `style.css` (2,388 lines, the "Default Blue" skin) and `dark.css` (478 lines). The JavaScript totals about 22.7k lines.
- **No inline handlers in the static shell** — `bootstrap.js` wires the splash, About, theme toggle, dialog close, Sign Out, search box and toolbar buttons with `addEventListener`, so the static page does not need CSP `'unsafe-inline'`.
  - `data-nav="#/x"` buttons call `App.navigate`. `data-action="X.fn"` buttons call a no-argument function by dotted path (`callByPath`).
  - JS-rendered pages still emit inline `onclick=`. The code calls this "known migration debt", and the CSP keeps `'unsafe-inline'` for it.
  - `window.App = App` is exported on purpose: a top-level `const` is not a `window` property, and without the export every `window.App && …` guard in bootstrap would silently do nothing.
- **Boot (`App.init` on DOMContentLoaded)**
  - Registers `hashchange` → `App.navigate`, applies the saved theme, and installs the global keyboard handler and the search dropdown's click-away closer.
  - Starts the toolbar clock and the status-bar date, then runs `initSystemInfo()`: the version label, the Server Edition label, the role, the user chip, admin-page hiding and the update badge. It uses raw `fetch`, so a 401 before login never pops the sign-in prompt.
  - Loads `/api/settings` once (`App.settings`), sets up the vocabulary (`Terms.init`), shows the company name, rewrites the shell labels (`applyTerminology`), then renders the first route. A nonprofit therefore never sees a flash of "Customers".
  - `auth.js` checks `/api/auth/status` separately on DOMContentLoaded and paints the sign-in or setup overlay when needed.
- **Company identity in the chrome** — `App.showCompany()` writes "Company: &lt;name&gt;" into the status bar, the name into the toolbar (`#topbar-company`, hidden by CSS `:empty` together with its separator), and "&lt;name&gt; — Slowbooks Pro 2026" into the document title.
  - The placeholder name "My Company" is never shown. Settings calls `showCompany` after a save, so a rename appears at once.
- **Page error state** — a route whose render throws shows "Couldn't load this page" with the escaped message and a "Return to Dashboard" button. The stack goes to the console only (an S1 audit finding: no framework internals in the page).

_Key files: `index.html`, `app/static/js/app.js`, `app/static/js/bootstrap.js`, `app/main.py`_

### Hash router & page guards

- **Route table** — `App.routes` maps 64 hash paths to `{page, label, render, mount?, nonprofit?}`. `page` drives the sidebar highlight; `label` drives the status bar ("Loading X..." → "X — Ready").
- **Matching** — exact keys match first, then one-segment parameter routes: `/jobs/:id` matches `/jobs/12` but not `/jobs/12/x`. The two-level `/banking/transfers/:id` matches too, and anything else shows "Page not found".
- **Address kept in step** — when a toolbar button, shortcut, search result or self-advancing page navigates without changing the hash, `navigate()` calls `history.pushState`.
  - This fixed a 2.18.0 gate finding: the sidebar link of the page just left used to do nothing.
  - `pushState` gives Back an entry without firing a second `hashchange`.
- **Document addresses** — `App.withDocument(list, open)` renders the list page, then opens the document in the dialog on the next tick.
  - A document that has since disappeared toasts "Could not open this document".
  - Used by the invoice, payment, bill, bill payment, journal entry, deposit, expense, CC charge and transfer routes, which the bank register and report drill-downs link to line by line.
- **Aliases** — `#/check-register` calls `replaceState` to `#/banking`, so old bookmarks work and Back does not bounce. `#/xero-import` and `#/myob-import` open Migrate Data preselected on that source.
- **Page lifecycle** — a route may declare `mount()` returning a cleanup function, which runs before the next navigation. Only `#/qbo` uses it.
- **Guards** — checked before render, and again after, because the role can arrive while the first page loads:
  - a nonprofit-only route in a business company shows "X is for nonprofit companies" with Return to Dashboard / Open Settings (W-L13: bookmarks used to reach these pages);
  - `ADMIN_ONLY_PAGES` (`employees`, `payroll`, `hr-onboarding`, `hr-benefits`, `hr-deductions`, `hr-tax-forms`, `users`, `migrate`) show "X is for administrators" to any non-admin; Migrate Data has its own reason sentence;
  - `NOT_FOR_READONLY_PAGES` (`audit`) shows "X isn't open to a read-only sign-in".

_Key files: `app/static/js/app.js`, `tests/js/app_routes_probe.js`, `tests/js/toolbar_nav_probe.js`, `tests/test_toolbar_navigation.py`_

### SPA screens

| Route | Screen | Notes |
|---|---|---|
| `#/` | Dashboard — "Company Snapshot" (`DashboardPage`) | Home; toolbar Home and Alt+H; titled "&lt;Company&gt; Snapshot"; per-user customizable cards |
| `#/customers` | Customer Center (`CustomersPage`) | Customers & Sales; nonprofit label "Donor Center" |
| `#/jobs` | Jobs (`JobsPage.render`) | nonprofit "Grants" |
| `#/jobs/:id` | Job (`JobsPage.renderDetail`) | a job's own page; no sidebar link |
| `#/job-costs` | Job Cost Entries (`JobCostsPage`) | sidebar "Job Costs" under Vendors & Payables |
| `#/releases` | Releases from Restriction (`ReleasesPage`) | nonprofit-only (route flag plus hidden link) |
| `#/functional-allocations` | Functional Allocations (`AllocationsPage`) | nonprofit-only |
| `#/vendors` | Vendor Center (`VendorsPage`) | Vendors & Payables |
| `#/items` | Item List (`ItemsPage`) | sidebar "Items & Services" (Manage) |
| `#/invoices` | Create Invoices (`InvoicesPage`) | nonprofit "Create Pledges"; toolbar Create Invoice and Alt+N open the form dialog |
| `#/invoices/:id` | Invoice | list with `InvoicesPage.view(id)` in the dialog |
| `#/sales-receipts` | Enter Sales Receipts (`SalesReceiptsPage`) | nonprofit "Enter Donations" |
| `#/in-kind-gifts` | In-Kind Gifts (`InKindPage`) | nonprofit-only |
| `#/estimates` | Create Estimates (`EstimatesPage`) | — |
| `#/payments` | Receive Payments (`PaymentsPage`) | toolbar Receive Payment and Alt+P open the form dialog |
| `#/payments/:id` | Payment | list with `PaymentsPage.view(id)` |
| `#/banking` | Banking (`BankingPage`) | sidebar "Bank Accounts" |
| `#/banking/:id` | Register (`BankingPage.renderRegister`) | one account's register |
| `#/banking/transfers/:id` | Transfer | Banking with `JournalPage.view(id)` |
| `#/accounts` | Chart of Accounts (`App.renderAccounts`) | shell page inside app.js |
| `#/reports` | Report Center (`ReportsPage`) | toolbar Reports |
| `#/settings` | Company Settings (`SettingsPage`) | unsaved-changes guard |
| `#/iif` | QuickBooks Interop (`IIFPage`) | Interop |
| `#/quick-entry` | Quick Entry (`App.renderQuickEntry`) | toolbar and Alt+Q only; hidden from a read-only toolbar |
| `#/audit` | Audit Log (`AuditPage`) | refused to read-only |
| `#/purchase-orders` | Purchase Orders (`PurchaseOrdersPage`) | — |
| `#/bills` | Bills (`BillsPage`) | — |
| `#/bills/:id` | Bill | list with `BillsPage.view(id)` |
| `#/bill-payments/:id` | Bill Payment | Bills with `BillsPage.viewPayment(id)` |
| `#/credit-memos` | Credit Memos (`CreditMemosPage`) | — |
| `#/vendor-credits` | Vendor Credits (`VendorCreditsPage`) | — |
| `#/vendor-credits/:id` | Vendor Credit | `VendorCreditsPage.view(id)` opens the credit in the dialog and returns an empty page (no list underneath) |
| `#/recurring` | Recurring Invoices (`RecurringPage`) | nonprofit "Recurring Pledges" |
| `#/batch-payments` | Batch Payments (`BatchPaymentsPage`) | `data-write` link, hidden for read-only |
| `#/csv` | CSV Import/Export (`App.renderCSV`) | shell page inside app.js |
| `#/qbo` | QuickBooks Online (`QBOPage`) | the only route with `mount()` and cleanup |
| `#/tax` | Tax Reports (`TaxPage`) | — |
| `#/companies` | Companies — "Company Files" (`CompaniesPage`) | "Switch company…" in the desktop app |
| `#/employees` | Employees (`EmployeesPage`) | admin-only |
| `#/payroll` | Payroll (`PayrollPage`) | admin-only |
| `#/hr/onboarding` | Onboarding (`OnboardingPage`) | admin-only |
| `#/hr/time-entries` | Time Entries (`TimeEntriesPage`) | open to bookkeepers |
| `#/hr/pto` | Time Off (`PTOPage`) | open to bookkeepers |
| `#/hr/benefits` | Benefits (`BenefitsPage`) | admin-only |
| `#/hr/deductions` | Garnishments (`DeductionsPage`) | admin-only |
| `#/hr/tax-forms` | Tax Forms (`TaxFormsPage`) | admin-only |
| `#/reseller-permits` | Reseller Permits (`ResellerPermitsPage`) | listed under Payroll & HR |
| `#/analytics` | Analytics & AI (`AnalyticsPage`) | the server's `/analytics` redirects here |
| `#/journal` | Journal Entries (`JournalPage`) | — |
| `#/journal/:id` | Journal Entry | list with `JournalPage.view(id)` |
| `#/deposits` | Make Deposits (`DepositsPage`) | — |
| `#/deposits/:id` | Deposit | list with `DepositsPage.view(id)` |
| `#/check-register` | (alias) | `replaceState` to `#/banking` |
| `#/cc-charges` | CC Charges (`CCChargesPage`) | — |
| `#/cc-charges/:id` | CC Charge | CC Charges with `JournalPage.view(id)` |
| `#/expenses` | Enter Expenses (`ExpensesPage`) | — |
| `#/expenses/:id` | Expense | list with `ExpensesPage.showDetail(id)` |
| `#/budgets` | Budget vs Actual (`BudgetsPage`) | sidebar "Budgets" |
| `#/bank-rules` | Bank Rules (`BankRulesPage`) | — |
| `#/fixed-assets` | Fixed Assets (`FixedAssetsPage`) | — |
| `#/migrate` | Migrate Data (`MigrationPage`) | admin-only; `data-write` link |
| `#/xero-import` | Migrate Data (Xero preselected) | alias; admin-only |
| `#/myob-import` | Migrate Data (MYOB preselected) | alias; admin-only |
| `#/opening-balances` | Opening Balances (`OpeningBalancesPage`) | `data-write` link |

_Key files: `app/static/js/app.js`, `index.html`_

### Sidebar navigator

- **Header**
  - "Slowbooks Pro" with "2026 Edition · v2.18.1"; the version comes from `/api/system` and shows "…" until it loads.
  - In Server Edition mode (`server_mode`), the edition line and the splash subtitle are replaced by "Server Edition". The version then shows only in the footer, as "vX · Server".
- **Update notice** — `#sidebar-update` sits at the top of the sidebar (moved there from the footer so it is actually seen) and takes no space when the install is current.
- **48 links**: Dashboard plus 47 links in 8 groups. Icons are Unicode glyphs.
  - Customers & Sales: Customers, Jobs, Invoices, Sales Receipts, In-Kind Gifts\*, Estimates, Payments, Recurring Invoices, Credit Memos, Batch Payments†.
  - Vendors & Payables: Vendors, Purchase Orders, Bills, Vendor Credits, Job Costs, Expenses.
  - Manage: Items & Services, Employees, Payroll.
  - Payroll & HR: Onboarding, Time Entries, Time Off, Benefits, Garnishments, Tax Forms, Reseller Permits.
  - Banking: Bank Accounts, Bank Rules, Fixed Assets, Opening Balances†, Migrate Data†, Make Deposits, CC Charges.
  - Accounting: Chart of Accounts, Journal Entries, Releases from Restriction\*, Functional Allocations\*, Budgets, Reports, Analytics & AI, Tax Reports.
  - Interop: QuickBooks Interop, QuickBooks Online, CSV Import/Export.
  - System: Settings, Audit Log, Companies.
  - \* `data-nonprofit`: shown only in nonprofit mode. † `data-write`: hidden for a read-only sign-in.
- **Visibility rules**
  - Audit Log is hidden for read-only users.
  - On multi-user installs, `ADMIN_ONLY_PAGES` links are hidden for non-admins; Time Entries and Time Off stay visible because they are daily books.
- **Active state** — the `.active` class (gold left border, bold) follows `route.page`.
- **Footer**
  - "Using SlowBooks for real work? Tell us →" links to GitHub Discussions #39 and opens in the system browser from the desktop app.
  - Then the version and "© 2026 Slowbooks".
- **Nonprofit words** — section and link texts pass through `T()`: "Customers & Sales" becomes "Donors & Contributions", Invoices becomes Pledges, Jobs becomes Grants, and so on.

_Key files: `index.html`, `app/static/js/app.js`, `app/static/css/style.css`_

### Toolbar & status bar

- **Toolbar (`#topbar`, 40 px gradient)**
  - Brand "Slowbooks Pro 2026", then the company name, then **Home**, **New Customer**, **Create Invoice**, **Receive Payment**, **Quick Entry**, **Reports**, the global search box, and on the right: user chip, theme toggle, clock, **About**, **Sign Out**.
  - New Customer, Create Invoice and Receive Payment call `CustomersPage.showForm`, `InvoicesPage.showForm` and `PaymentsPage.showForm` directly, so the dialog opens over the current page.
  - For read-only users the three create buttons and Quick Entry are hidden. In nonprofit mode, New Customer reads "New Donor" and Create Invoice reads "Create Pledge".
  - The user chip appears only on multi-user installs and reads "&lt;display name or username&gt; · &lt;role&gt;".
  - The theme toggle shows ☼ or ☾ with a coloured glow so the target is obvious.
  - The clock shows "hh:mm" in en-US format and refreshes every 60 s.
- **Status bar (`#statusbar`, 24 px)**
  - Left: `#status-text` reads Ready, "Loading X...", "X — Ready", "Error loading page", the guard sentences, or, behind the auth overlay, "Sign in to continue" / "Set up this company to continue".
  - Middle: `#status-company` ("Company: &lt;name&gt;"). The shell ships the placeholder "Company: bookkeeper.sbk" until settings load.
  - Right: `#status-date`, the long date (e.g. "Monday, September 29, 2026").
- **Contrast** — the toolbar and status-bar text uses `--text-secondary`, because muted text measured 2.57–2.66:1 on those gradients (2.18.0 macOS contrast sweep).

_Key files: `index.html`, `app/static/js/app.js`, `app/static/js/bootstrap.js`, `app/static/css/style.css`_

### Splash / About screen

- **Shown at every load of the shell** — the overlay has no `hidden` class in `index.html`. It is dismissed with **OK**, or **I understand** while the terms are showing, and **About** re-opens it.
- **Content**
  - "Slowbooks Pro" / "2026 Edition" (or "Server Edition").
  - The tagline: free and source-available, no caps, no subscriptions; born to replace QuickBooks Pro 2003 after Intuit's activation servers died.
  - The legal line: "Independent reimplementation built from published SDK documentation (QBFC 5.0)… Not affiliated with Intuit Inc."
- **What's new**
  - `bootstrap.js` fetches the public `/static/whats-new.json` and `/health`, so the panel works before login.
  - It shows the entry for the running version, falling back to the first key, as "What's new in 2.18.1 — Names from QuickBooks come across clean" followed by its bullets.
  - The file holds 29 releases (2.7.0 → 2.18.1) and is edited at release time; the checklist requires the key to equal `__version__`.
  - The version shows up here and in the sidebar; there is no separate build-number field.
- **License notice (LICENSE §13)**
  - A four-point short form of the terms, with a link to LICENSE v2.0, stays shown until acknowledged:
    1. free use, no selling or paid service;
    2. figures are aids, not advice;
    3. no warranty, liability or maintenance, and a hold-harmless;
    4. Illinois law, Will County venue.
  - The acknowledgement is stored as `localStorage["slowbooks.license_ack"] = "2.0"`, so it is recorded once per browser profile. The desktop WebView profile persists, which makes it once per install; each Server Edition browser sees it once; if storage fails, the terms show again.
- **Look** — a navy gradient box with a gold border and a 0.3 s fade-in. Panels behind the What's new and terms text keep the text at AA contrast.

_Key files: `index.html`, `app/static/js/bootstrap.js`, `app/static/whats-new.json`, `tests/test_first_run_terms.py`, `tests/test_whats_new.py`_

### First run, sign-in, sign-out & company switching

- **Auth overlay (`auth.js`)** — a full-screen overlay (z-index 99999) whose view is chosen by `/api/auth/status`: `setup_needed` shows setup, anything else shows sign-in.
  - It is race-safe: a burst of parallel 401s shares one status check and paints at most one overlay.
  - While the overlay is up, `API.request` never resolves, and the page reloads after success. Nothing behind the dialog reports a false error.
  - The status bar behind it is repainted too; it used to say "Error loading page · Company: bookkeeper.sbk".
- **Setup view ("Set up Slowbooks Pro 2026")**
  - Fields: Your name\*, Your email\*, Company name\* (prefilled from the existing file), Company email, Password\* (8+ characters) and Confirm\*.
  - A notice appears when the company file already holds books ("Setup only adds your operator password").
  - Length and match are checked client-side, then the form POSTs `/api/auth/setup`. A 409 ("already set up") switches to sign-in.
- **Sign-in view ("Unlock &lt;Company&gt;")**
  - Names the books being unlocked.
  - On multi-user installs, a "Who is signing in?" select of usernames appears above Password.
  - A 409 ("no password set") switches to setup.
  - Links: "First time? Set up Slowbooks →", and in the desktop app "Choose a different company →".
  - The company link is drawn when the status says `desktop` or the bridge exists; macOS injects the bridge late. A click waits for `pywebviewready`, and after 5 s explains "The company list opens in the SlowBooks Pro window".
- **Form accessibility** — every field has `<label for>`, `required` together with `aria-required="true"`, and an `aria-hidden` asterisk. Focus goes to the first field, and all colours are tested at ≥4.5:1 on the card.
- **Desktop first launch** — the company picker ("No companies yet — create your first one below.") leads to "+ Create New Company", the company opens, the setup overlay appears, and after sign-in the splash with the license terms.
- **Sign Out (toolbar)** — confirms "Sign out of Slowbooks?", then POSTs `/api/auth/logout`; errors are ignored, since the cookie may already be gone.
  - In the desktop app, `pywebview.api.show_picker()` stops this company's server and reloads the picker in the same window.
  - In a browser, the page reloads to the sign-in screen, which lists users on multi-user installs.
- **Companies page ("Company Files")**
  - Lists companies with "(currently open)", the file or database name, description and last access.
  - **+ New Company** is admin-only; its dialog has Company Name, Database Name (server installs only, `[a-z0-9_]+`) and Description, plus a live "Setting up… this takes a few seconds" line.
  - **Switch company…** (desktop only) signs out and opens the picker; if the logout fails with anything other than a 401, it refuses.

_Key files: `app/static/js/auth.js`, `app/static/js/bootstrap.js`, `app/static/js/companies.js`, `desktop_launcher.py`, `tests/test_first_run.py`, `tests/js/auth_prompt_probe.js`, `tests/js/auth_picker_link_probe.js`_

### Keyboard shortcuts

- **Alt+N** — new invoice dialog (`InvoicesPage.showForm()`) over the current page.
- **Alt+P** — Receive Payment dialog (`PaymentsPage.showForm()`).
- **Alt+Q** — go to Quick Entry.
- **Alt+H** — go to the Dashboard.
- **Alt+D** — toggle dark mode.
- **Read-only sign-ins** — Alt+N, Alt+P and Alt+Q show the read-only sentence as an info toast instead of opening a locked blank form.
- **Ctrl+S** — submits the open dialog's form (`requestSubmit`). The browser's own Save is suppressed only when a dialog form exists.
- **Ctrl+Enter** — submits Quick Entry ("Save & Next").
- **Ctrl+K, or `/` outside a field** — focuses the global search box.
- **Escape**
  - closes the dialog;
  - in the search box, clears it and closes the dropdown;
  - cancels the closing-date password prompt, which listens in the capture phase so the form underneath stays open.
- **Tab / Shift+Tab** — cycle inside an open dialog (focus trap).
- **PDF viewer window (desktop)** — Cmd/Ctrl+P and Cmd/Ctrl+S open the PDF in the system's PDF app.
- **Implementation** — one `keydown` listener in `app.js` compares a lower-case `e.key` with `altKey`/`ctrlKey`. There are no ⌘ (`metaKey`) variants in the SPA.

_Key files: `app/static/js/app.js`, `app/static/js/utils.js`, `app/static/js/bootstrap.js`, `app/static/js/api.js`, `desktop_launcher.py`_

### Global search

- **Query** — typing 2+ characters in the toolbar box calls `GET /api/search?q=` after a 300 ms debounce.
  - The server returns at most 5 hits per section.
  - A query that is an amount ("612.30", "$1,234.50") matches to the cent, using a half-cent window: document totals, the open balance on invoices and bills, and payment amounts.
- **Sections**, in order: Customers, Vendors, Items, Invoices, Sales Receipts, Estimates, Credit Memos, Bills, Payments. The Customers, Invoices and Sales Receipts labels pass through `T()`.
- **Row text** — documents read "number · who · amount"; payments read "date · customer · amount".
- **Click targets**
  - Invoices, sales receipts, bills and payments open their document view dialog.
  - Customers, vendors, items, estimates and credit memos navigate to their list page.
- **Closing**
  - "No results" when nothing matches.
  - The dropdown closes on a click outside, on Escape (which also clears the box), or on choosing a result; an error hides it silently.
  - A generic `.hidden { display:none !important }` rule was added because the dropdown never actually closed and left a 2 px sliver under the toolbar.
- **Nonprofit mode** — the placeholder is rewritten through `Terms.text` ("Search donors, pledges...").

_Key files: `app/static/js/app.js`, `app/static/js/bootstrap.js`, `app/static/js/utils.js`, `app/routes/search.py`, `tests/test_search_amounts.py`_

### Dialogs, focus management & notifications

- **One shared dialog** — `#modal` carries `role="dialog"`, `aria-modal="true"`, `aria-labelledby="modal-title"` and `tabindex=-1`, and is driven by `openModal(title, html, {wide})` / `closeModal()`. Opening a new dialog replaces the current content.
- **Focus handling**
  - Opening remembers the opener and focuses the first focusable control in the body, or the dialog itself.
  - Tab and Shift+Tab cycle only among visible focusables; Escape closes.
  - Focus returns to the opener if it still exists.
- **Closing** — the × button (`aria-label="Close dialog"`), Escape, or Cancel. Clicking the backdrop does not close it.
- **Sizes**
  - Default maximum width is 700 px, with a scrolling body.
  - `modal--wide` goes up to `min(1280px, 96vw)` for wide line-item grids (#174), and such grids scroll sideways inside `.table-container--scroll`.
  - The pay-run table keeps its Employee column sticky.
- **Read-only locking on open** — `openModal` runs the read-only form locking and write-control hiding on the dialog body.
- **Submit feedback** — `disableSubmitButtons()` / `enableSubmitButtons()` change primary buttons to "Saving...".
- **Closing-date password prompt** — built by `api.js` as its own stacked `role="dialog"`: labelled title, the server's sentence, a password field, a `role="alert"` error line, Cancel / "Make this change".
  - Escape is captured so only the prompt closes.
  - Prompts are queued one at a time, and focus is restored afterwards.
- **Toasts**
  - `#toast-container` has `role="status"`, `aria-live="polite"` and `aria-atomic="false"`, and sits bottom-right above the status bar. Types are success, error and info.
  - Duration is 3 s plus 60 ms per character beyond 40, at least 6 s for errors and never more than 15 s. Hovering holds a toast, leaving restarts a 2 s timer, and a click dismisses it.
  - `toastAction(message, label, fn, ms)` adds one button, such as the desktop "Show in folder", shown for 10 s, or 20 s when a folder-permission note is attached.
- **Other feedback**
  - Destructive steps use native `confirm()`: sign out, delete account, reset dashboard.
  - Other live regions: the Settings "Unsaved changes" note and the New Company progress line (`role="status"`, `aria-live="polite"`).

_Key files: `app/static/js/utils.js`, `app/static/js/api.js`, `index.html`, `app/static/css/style.css`, `tests/test_toast_duration.py`_

### Unsaved-changes guard

- **Settings only** — the page snapshots its named form fields when it loads or saves, and shows "Unsaved changes" in a sticky save bar (`role="status"`, `aria-live="polite"`) that keeps "Save Settings" in reach.
- **Leave guard**
  - Installed on the first Settings render, it wraps `App.navigate` — the one path every in-app move takes.
  - Leaving asks "You have unsaved changes in Settings. Leave without saving them?"; Cancel puts `#/settings` back in the address bar.
  - A `beforeunload` prompt covers reloads and closing the window.
- **Rules**
  - Sections that save themselves (AI, classes, users, tokens) are not counted.
  - The page is never dirty for a non-admin or read-only user, whose fields are locked.
  - Changing the company type warns that other unsaved edits will be saved with it.
- **Dashboard** — Customize mode tracks a `_dirty` flag but has no leave prompt; Cancel reloads the saved layout.

_Key files: `app/static/js/settings.js`, `app/static/js/dashboard.js`, `tests/test_settings_unsaved_changes.py`, `tests/js/settings_unsaved_probe.js`_

### Role-aware UI (read-only and bookkeeper sign-ins)

- **Where the role comes from** — `/api/auth/status`; the UI assumes `admin` until told otherwise. `App.setRole`:
  - toggles `body.role-readonly`, a hook with no CSS rule;
  - re-navigates if the open page became admin-only;
  - runs `rolePass` on `#page-content` and `#modal-body`, and keeps it applied with a `MutationObserver` as pages and dialogs re-render or fill in later (skytech sweep, 2.18.0).
- **Read-only: toolbar and sidebar** — the create shortcuts and Quick Entry disappear from the toolbar; `data-write` links and Audit Log disappear from the sidebar.
- **Read-only: `hideWriteControls`** hides:
  - elements marked `data-write`; fields marked this way stay visible but disabled;
  - file choosers;
  - buttons labelled "+ …";
  - a page header's primary button;
  - "Edit" when it sits beside "View";
  - any button whose `onclick` calls one of the 110 `App.WRITE_ACTIONS` (void, mark sent, duplicate, uploads, apply credit, reconcile, feed sync, imports, late fees, …).
- **Read-only: `lockForms`** — every form without `data-readonly-ok`:
  - disables its fields;
  - dims its buttons, except close/Cancel and `data-readonly-ok` buttons;
  - blocks submit with a toast;
  - shows the note "Your sign-in is read-only: you can look, but not save changes. An administrator can change your role under Settings → Users."
- **What read-only keeps** — View, Print, Save PDF, reports, IIF/CSV exports, and opening a record, which shows it locked.
- **Bookkeeper, or any non-admin (`adminPass`)**
  - `[data-admin]` controls are hidden; fields marked this way are shown locked.
  - `form[data-admin-fields]` fields are locked.
  - `[data-admin-note]` sentences appear, explaining why company settings, backups, new company files, the logo and QBO connect/import are the administrator's.
- **Marker counts** — the shell and page modules carry 83 `data-write` and 50 `data-admin` markers. The server's 403 remains the actual enforcement.

_Key files: `app/static/js/app.js`, `app/static/js/utils.js`, `tests/test_readonly_ui.py`, `tests/test_readonly_write_actions.py`, `tests/test_bookkeeper_ui.py`, `tests/test_readonly_browser.py`, `tests/js/readonly_marks_probe.js`, `tests/js/admin_controls_probe.js`_

### API client (`api.js`)

- **Helpers** — `API.get/post/put/del` (the spelling is `del`, not `delete`) prefix `/api`, send JSON, and use `credentials: "same-origin"`.
  - `post`/`put` accept `opts.query`, for example the `?force=true` retry after a duplicate-warning 409.
- **Special statuses**
  - 401 hands off to `SlowbooksAuth.promptAuth()`.
  - 429 becomes "Rate limit exceeded -- slow down and try again".
  - A network failure becomes "SlowBooks isn't responding (network error) — if this keeps happening, close and relaunch SlowBooks Pro."
- **Error sentences** — a string `detail` is shown as is. A 422 list becomes each entry's plain `message`, or `field: msg`. An object becomes its `.message`.
  - `err.status`, `err.detail` and `err.body` are kept so callers can inspect 409/422 responses.
  - `API.responseError(res, fallback)` does the same for pages that call `fetch()` themselves (uploads, downloads), including non-JSON proxy pages, which show "(HTTP n)".
- **Closing-date override** — a 403 carrying `X-Closing-Date-Override: password` or `wrong-password` prompts for the password and resends the same change once with `X-Closing-Date-Password`. The value is percent-encoded and never stored; `locked` means no prompt.

_Key files: `app/static/js/api.js`, `tests/js/api_request_probe.js`, `tests/js/direct_fetch_errors_probe.js`, `tests/test_direct_fetch_errors.py`_

### Formatting & shared UI utilities

- **Money**
  - `formatCurrency`: `Intl` en-US USD with the minus first ("-$10.00", never "$-10.00").
  - `SalesLines.money`: home currency as `$`; a foreign document as "EUR 850.00" or "EUR -10.00".
  - `SalesLines.rate`: up to 4 decimals ("$0.045").
  - `SalesLines.cents`: half-up rounding via an exponent shift, avoiding the 1.005 × 100 float error.
  - `SalesLines.tax`: integer cents × ten-thousandths of a percent, so 1.0875% of $175,800 is $1,911.83.
  - The PDF filters `pdf_service._format_currency` / `_format_rate` use the same signs, and both sides are tested (Python and `node --test`).
- **Other formats**
  - `formatDate`: "Sep 29, 2026", or "Invalid date".
  - `todayISO`: the local date.
  - `formatFileSize`: "18 bytes", "4.2 KB", "1.3 MB".
  - `storedFileNote`: notes for attachments copied from, or missing from, the pre-2.18 shared uploads folder.
  - `escapeHtml` (escapes `& < > " '`) and `statusBadge`.
- **List pages**
  - `renderListPage`: header, status filter, empty state and sortable columns. Sorting is numeric when both values parse, otherwise case-insensitive; date columns sort newest-first on the first click; ▲▼ marks the active column.
  - `listRows` / `listCapNote`: shows the newest 500 rows with a "Show all" button.
  - `fetchAllPages`: reads 1,000-row pages until an empty page, capped at 1,000 pages.
- **Shared form pickers**
  - Class, Customer:Job (`JobPicker` narrows jobs to the chosen customer), and cost codes.
  - `TaxExempt.enforce`: a non-taxable customer disables every Tax box and restores them on switching back.
  - The nonprofit fund/function pickers with Split-by-rule.
  - `pickerAccounts`: active accounts of the given types, hiding nonprofit-only accounts in a business company.
  - Currency and rate (10 currencies; `prefillFxRate` fills the rate from `/api/fx/rate` but never overwrites a typed one).
  - Country (63 countries, US/CA/IE/GB/AU first).
- **`copyToClipboard(text, label, el)`** — explains when the page is not a secure context: plain HTTP on a LAN address fails, while loopback counts as secure. It selects the text so Ctrl+C / ⌘C works as the fallback (#137).
- **`chartColor(name)`** — reads the `--chart-*` CSS variables, with fallbacks when no stylesheet is loaded.

_Key files: `app/static/js/utils.js`, `app/static/js/invoices.js`, `app/services/pdf_service.py`, `tests/js/money_signs.test.cjs`, `tests/test_document_money_signs.py`, `tests/test_clipboard_helper.py`_

### Documents, PDFs & downloads (browser vs desktop)

- **Browser installs** — PDFs, print previews, CSV/IIF exports and attachments open through `window.open`, `target="_blank"` or `<a download>`, sharing the session cookie. There is no `window.print()`; printing goes through the PDFs.
- **Desktop shim (`desktop_shim.js`)**
  - Active when `window.pywebview` exists or the user agent contains "WebView2".
  - It overrides `window.open` and captures clicks on same-origin `a[target=_blank]` and `a[download]`, skipping `blob:` links.
  - It fetches the document from the page itself with the `X-Slowbooks-Desktop: 1` header; the server rewrites `Content-Disposition: attachment` to `inline` for such requests. What happens next depends on the response:
  - **PDF** → `open_document_pdf`.
    - The file is saved to `Documents/SlowBooks Pro/Documents` (invoices, statements, estimates, receipts, credit memos, pledges, donor letters, checks, POs, bills, vendor credits) or `…/Reports` (everything else), never overwritten (a " (2)" suffix is added), and shown in a viewer window.
    - A toast reads "Saved to … [Show in folder]".
  - **HTML print preview** → `open_document_html`, a new native window.
  - **Anything else** (CSV, IIF, images, attachments) → `save_document_file`.
    - Attachments and employee documents go to `Documents`, other files to `Reports`; the toast offers Show in folder.
    - Without the bridge, a blob `<a download>` is the fallback.
  - **Settings → Backups "Download"** → `save_backup_file` copies the backup straight from disk to `~/Downloads`, with no HTTP request.
  - **Employee-portal (`/portal/…`) links** → `open_external` to the system browser, so the portal gets its own cookie. External links (the update badge, the Discussions link) and the QBO **Connect** flow also open in the system browser.
  - **Bridge liveness check** — at `pywebviewready`, or after 8 s, an empty bridge produces an explicit error toast instead of silent dead buttons (a lesson from the 2.9.0 macOS gate). Every branch reports its own failure.
  - **Why this design** — three alternatives were tried and rejected, as recorded in the file:
    - an iframe overlay, blocked by the app's own `frame-ancestors 'none'`;
    - a second native window, which lost the session cookie;
    - `fetch()` of attachment responses, which WebView2 intercepts as a native download.
  - `window.SlowbooksDesktop.saveFile(blob, name, folder)` serves pages that fetch files themselves, such as the IIF export; it returns `false` in a browser.
- **PDF viewer window (launcher `_VIEWER_PAGE`)**
  - The PDF is shown under a toolbar: file name, "Saved in &lt;folder&gt;", a status note, **Open in &lt;app&gt;** and **Show in folder**. The app name is the system's default PDF app — Preview or Microsoft Edge, found via `NSWorkspace` or `AssocQueryStringW` — with "your PDF app" as the fallback.
  - The page is an iframe of the `file://` PDF, and Cmd/Ctrl+P and Cmd/Ctrl+S open the file in that app.
  - Buttons stay disabled until the bridge is ready, and the page follows the OS dark scheme.
  - Its bridge is bound to one file and path-guarded.

_Key files: `app/static/js/desktop_shim.js`, `desktop_launcher.py`, `app/main.py`, `app/static/js/iif.js`, `tests/test_desktop_downloads.py`, `tests/test_desktop_pdf_viewer.py`, `tests/js/desktop_downloads_probe.js`, `tests/js/pdf_viewer_page_probe.js`, `tests/js/tax_forms_shim_probe.js`_

### Built-in shell pages: Quick Entry, Chart of Accounts, CSV (UI only)

- **Quick Entry Mode (`#/quick-entry`)** — batch entry of paper invoices.
  - Fields: Customer\*, Date\* (today), Terms (Net 15/30/45/60 or Due on Receipt; Net 30 selected) and PO #.
  - Line grid: Item (fills description and rate), Description, Qty, Rate and Amount, with "+ Add Line" and a running total.
  - **Save & Next (Ctrl+Enter)** posts an invoice with tax rate 0 and prepends "#N created — customer — total" to a session log.
  - Afterwards the form resets and focus returns to Customer; lines with no rate and no description are skipped.
- **Chart of Accounts (`#/accounts`)**
  - Accounts are grouped Asset → Liability → Equity → Income → COGS → Expense; Equity and Income pass through `T()`.
  - Each row shows the number in monospace, the name, a "control" badge whose tooltip gives the account's posting purpose, an "inactive" badge, the type and the balance.
  - Row actions: Edit, Deactivate or Reactivate, and Delete; control accounts have no Delete.
  - "Show/Hide N inactive" appears only when inactive accounts exist.
  - The account form requires a number (digits, or sub-accounts like `6150.1` / `6150-01`, max 20 characters). For a control account the number and type are locked, with an explanation that renaming is allowed.
  - **Import…** posts `/api/csv/import/accounts` as a dry run first (CSV, a spreadsheet with the same headers, or hledger `.journal`/`.txt`), shows "N to create, N to update… Nothing has been written yet" with a per-row plan, then "Import N changes".
    - "Replace the seeded chart" deactivates unused accounts the file does not name.
    - A template is at `/static/downloads/chart-of-accounts-template.csv`.
- **CSV Import / Export (`#/csv`)**
  - Ten export links: customers, vendors, items, invoices, bills, sales receipts, deposits, classes, jobs and chart of accounts.
  - Imports cover customers, vendors, items and accounts; the accounts import applies directly (`dry_run=0`).
  - Results show created/updated/skipped counts and per-row errors. The import panel is `data-write`.

_Key files: `app/static/js/app.js`, `app/static/downloads/chart-of-accounts-template.csv`, `tests/test_chart_import.py`, `tests/test_control_accounts.py`_

### Theme system (Default Blue + dark mode)

- **"Default Blue" (light) palette** — `:root` custom properties: navy `#003366`, blue `#336699`, gold `#cc9933`, teal section headings, and more.
  - Chrome in the Windows-Classic spirit: Tahoma / Segoe UI at a 12 px base, Consolas for numbers, bevelled buttons, gradient table headers, 14 px XP-style WebKit scrollbars.
  - Tinted "paper" form backgrounds: invoice yellow `#fffef5`, estimate green `#f5fff8`.
  - Fixed dimensions: 200 px sidebar, 40 px toolbar, 24 px status bar, 1,100 px maximum content width.
- **Dark mode**
  - `dark.css` redefines the same variables and adds component overrides under `[data-theme="dark"]` on `<html>`.
  - Toggled from the toolbar button or Alt+D. `App.toggleTheme` writes `localStorage["slowbooks-theme"]` (light/dark), and `App.loadTheme` applies it at boot.
  - The default is light; the SPA does not read the OS `prefers-color-scheme`. The preference is kept per browser profile, and the desktop app's WebView profile persists.
- **Contrast built into the tokens** — each colour's measured ratio is recorded in the CSS comments.
  - Muted text is `#626282` in light and `#8790a2` in dark.
  - Dark toasts keep the light theme's green, red and blue so white text stays readable.
  - Notes, hints and badges get dark tints.
- **Charts**
  - `--chart-*` colours are defined per theme, each ≥3:1 on its card (WCAG 1.4.11), and `chartColor()` reads them.
  - `toggleTheme` dispatches `slowbooks:themechange`; the dashboard's Balance Sheet Trend and the Analytics charts redraw on it, because canvas ink is painted rather than styled (a 1.06:1 axis finding at the 2.16.0 gate).
- **Print** — `@media print` hides the sidebar, toolbar, status bar, buttons, dialog and toasts.
- **Narrow screens** — only the dashboard, Analytics and QBO grids reflow (breakpoints at 900, 800 and 560 px). The shell itself is desktop-width, with `body { overflow:hidden }`.

_Key files: `app/static/css/style.css`, `app/static/css/dark.css`, `app/static/js/app.js`, `app/static/js/utils.js`, `app/static/js/dashboard.js`, `app/static/js/analytics.js`, `tests/test_theme_redraw.py`, `tests/test_chart_colors.py`_

### Accessibility (WCAG 2.1 AA posture, PDF/UA-1)

- **Posture** — the project says it "strives to conform to WCAG 2.1 AA" and deliberately makes no compliance claim, because no body certifies it. Barriers are triaged as bugs, reported through issues or support@slowbookspro.com.
- **Shell measures in code**
  - Skip link as the first tab stop, and landmarks (`nav`, `main`).
  - `scope="col"` on every table header; a test enforces it across all JS and `index.html`.
  - `aria-label` on icon-only × buttons.
  - Polite live region for toasts, and true dialog semantics with focus trap and restore.
  - Disabled buttons styled as disabled, and a global link colour for both themes (a bare `<a>` had measured 1.73:1).
- **Contrast** — AA contrast for muted text in both themes, graphics at ≥3:1, and the sign-in/setup screen colours tested at ≥4.5:1.
- **Tagged PDFs** — `pdf_service.render_pdf` writes every PDF with `pdf_variant="pdf/ua-1"`, falling back to a plain PDF if the WeasyPrint build cannot.
  - Every Jinja template (24 top-level files) that has `<html>` declares `lang`, and every one that has `<head>` declares a `<title>`; partials named `_…` are exempt. A test enforces this.
  - CI renders an invoice and checks `pdfinfo` reports "Tagged: yes", plus `/StructTreeRoot` and `/Lang en` via pypdf.
- **Automated sweeps** — `test_theme_contrast.py` and `test_dialog_contrast.py` are playwright sweeps of every page and every dialog in both themes, plus the splash, sign-in/setup, the closing-date prompt and the desktop PDF window.
  - They mirror the macOS gate's scorer: translucent layers are composited, gradients are scored at their worst stop, and text alpha counts.
  - Thresholds are 4.5:1, or 3:1 for large text.
- **Known gaps listed in the docs**
  - Landmarks and skip links for the chart-of-accounts tree and long forms.
  - A/R aging bars are colour-coded, with text only in the legend.
  - No keyboard drag ordering; the dashboard uses arrow buttons instead.
- **History** — the design notes record the six SPA audit fixes and the PDF tagging work as shipped in v2.8.0.

_Key files: `index.html`, `app/static/js/utils.js`, `app/services/pdf_service.py`, `docs/accessibility.md`, `docs/design/accessibility.md`, `tests/test_accessibility.py`, `tests/test_theme_contrast.py`, `tests/test_dialog_contrast.py`, `tests/test_css_hidden_and_contrast.py`_

### Terminology hook (brief)

- **`T(key)`** returns the nonprofit word from the 48-entry `TERMS_NONPROFIT` dictionary (Customer→Donor, Invoice→Pledge, Sales Receipt→Donation, Class→Fund, Job→Grant, Equity→Net Assets, P&L→Statement of Activities, and so on). It handles plurals and lower case.
- **`Terms.text(prose)`** rewrites whole words in sentences, longest phrase first, keeping case.
- **Boot wiring** — `Terms.init(settings)` reads `company_type`, and `App.applyTerminology()` rewrites the shell once at boot and toggles `[data-nonprofit]` / `[data-business-only]`.
- **One dictionary** — tests parse the JS literal and compare it with `app/services/terminology.py`. The nonprofit module covers the rest.

_Key files: `app/static/js/terms.js`, `app/static/js/app.js`, `tests/test_terminology.py`_

### Desktop launcher: environment, data folders & first-run preparation

- **One entry point** — the same file runs from source (`python desktop_launcher.py`) and frozen by PyInstaller.
  - Frozen detection uses `sys.frozen` / `_MEIPASS`. Read-only app files live in the bundle; everything writable lives in per-user data.
- **Data directory**
  - Set by `SLOWBOOKS_DATA_DIR` or `--data-dir`.
  - Defaults: Windows `%LOCALAPPDATA%\SlowBooksPro\data`; macOS `~/Library/Application Support/SlowBooksPro/data`; elsewhere `~/.slowbookspro/data`.
  - `app/services/company_service.data_dir()` duplicates this resolution so both always agree.
- **Config directory (holds `.env`)** — when frozen, the data directory's parent, e.g. `%LOCALAPPDATA%\SlowBooksPro\.env`; from source, the checkout.
- **Data-directory contents**
  - `companies/*.db` (one SQLite file per company, with a slugged file name such as `acme-consulting-llc.db`) and the `companies.json` manifest, which remembers the last opened company.
  - `backups/`.
  - `webview/`: the persistent WebView profile plus `app-version.txt`.
  - `viewer/`: PDF viewer pages, deleted after a day.
  - `launcher.log` and `connect-urls.txt`.
  - `Reports/` and `Documents/`, the save fallbacks.
  - `launcher-scratch.db` when frozen.
- **`prepare_env()` (idempotent)**
  - Copies `.env.example` on first run, `chmod 600` on POSIX, and exports `SLOWBOOKS_ENV_FILE`.
  - Forces `APP_DEBUG=true`, `FORCE_HTTPS=false` and `APP_HOST=127.0.0.1`, which are right for loopback.
  - Generates `PAYROLL_ENCRYPTION_SECRET` when it is blank or the shipped placeholder, plus `SESSION_SECRET_KEY` and a Fernet `SETTINGS_ENCRYPTION_KEY`. Nothing is ever written into the signed bundle.
  - Creates `companies/`.
- **Server child environment** — `DATABASE_URL` (the company file), `APP_DEBUG`, `FORCE_HTTPS`, `APP_HOST`, `APP_PORT`, `SLOWBOOKS_DATA_DIR`, `SLOWBOOKS_ENV_FILE`, plus two flags:
  - `SLOWBOOKS_SERVER_MODE`: 1 when bound beyond loopback;
  - `SLOWBOOKS_DESKTOP=1`: turns on the update check and, for loopback clients only, the desktop CSP.
- **Frozen native bootstrap**
  - Windows: registers the bundled `gtk` DLL folder (`WEASYPRINT_DLL_DIRECTORIES`, `os.add_dll_directory`) and writes a `fonts.conf` pointing fontconfig at `C:\Windows\Fonts` with a writable cache.
  - macOS: prepends `Contents/Frameworks` to `DYLD_FALLBACK_LIBRARY_PATH` and writes a `fonts.conf` for `/System/Library/Fonts`, `/Library/Fonts` and `~/Library/Fonts`, plus a cache.
  - The frozen launcher points `DATABASE_URL` at a scratch SQLite file before the first app import, because the bundle ships no psycopg2.
- **Server-side support for the desktop**
  - Every response carries `Cache-Control: no-cache`, because the persistent WebView2 profile served stale HTML/JS after updates.
  - The CSP adds `'unsafe-eval'` only when `SLOWBOOKS_DESKTOP=1` and the client is loopback. pywebview builds its bridge with `new Function`, and WKWebView enforced the CSP on it; LAN browsers keep the strict policy (#98).

_Key files: `desktop_launcher.py`, `app/services/company_service.py`, `app/config.py`, `app/main.py`, `.env.example`, `tests/test_desktop_mode.py`_

### Desktop launcher: company picker, window & native bridge

- **Company picker** — the first thing the window shows, modelled on QuickBooks' File → Open Company (`PICKER_HTML`).
  - Lists each company's name and file, marks "last opened", offers "Open ›", "+ Create New Company" and a status line.
  - On the window's first load it opens the last company automatically, straight to that company's sign-in.
  - After Sign out or Switch company the picker stays put (`auto_open` off).
- **Opening a company (`launch_company`)**, step by step:
  1. **Single-instance check** — if a healthy `/health` already answers on the port, it stops with "SlowBooks Pro is already running (another window is open)…".
  2. Validates the file name.
  3. In window mode only, persists `DATABASE_URL` and last-opened.
  4. Runs `alembic upgrade head`, in-process when frozen.
  5. Starts the server and polls `/health` every 0.5 s for up to 120 s, stopping early if the child exits.
  6. Hands the URL back for the picker's own JS to navigate to, which avoids a pywebview promise race.
- **Window**
  - pywebview window "SlowBooks Pro 2026", 1280×860, minimum 900×600, with `gui="edgechromium"` forced on Windows.
  - `private_mode=False` with `storage_path=<data>/webview` gives one shared cookie jar, and logins survive restarts.
  - `ALLOW_DOWNLOADS=True`, since pywebview cancels downloads by default.
  - WebView disk caches (Cache, Code Cache, GPUCache) are purged on the first launch of a new version; cookies are kept.
  - The server stops when the window closes.
- **Bridge (`PickerApi`, exposed as `window.pywebview.api`)**
  - Methods: `list_companies`, `create_company`, `open_company`, `show_picker`, `open_document_html`, `open_document_pdf`, `save_document_file`, `save_backup_file`, `reveal_path`, and `open_external` (http(s) only).
  - All internal state is underscore-private. pywebview serializes public attributes recursively, and storing the Window publicly produced endless recursion spam.
- **Save locations**
  - Documents is resolved with Windows `SHGetKnownFolderPath`, which respects OneDrive Known Folder Move, or `~/Documents` elsewhere.
  - A refused write (`PermissionError`: macOS TCC, Windows Controlled Folder Access) falls back to the data folder, with a note naming both folders and the remedy.
  - The macOS Info.plist carries `NSDocumentsFolderUsageDescription` / `NSDownloadsFolderUsageDescription` explanations for the consent prompts.
- **Guards**
  - `reveal_path` accepts only the saved-document roots and `~/Downloads`; it uses Explorer `/select,`, Finder `open -R`, or `xdg-open`.
  - Only an existing `.pdf` inside those roots is ever handed to another program.
  - The backup copy validates the file name and stays inside `BACKUP_DIR`; a name that is taken gets a " (n)" suffix.
- **Viewer bridge (`DocumentViewerApi`)** — offers `open_in_default_app` and `show_in_folder`, bound to the one file the window shows. No method takes a path.

_Key files: `desktop_launcher.py`, `app/static/js/desktop_shim.js`, `app/services/company_service.py`, `tests/test_desktop_pdf_viewer.py`, `tests/test_desktop_save_permissions.py`, `tests/test_desktop_pdf_names.py`_

### Desktop launcher: modes, flags & platform workarounds

- **Flags**
  - `--no-window`, `--serve-lan` with optional `--bind IP`, `--port N` (default `APP_PORT` from `.env`, else 3001), `--data-dir PATH`, `--hidden`, `--setup-only`, `--smoke-test`.
  - The internal flags `--_serve` and `--_repair-schema --database-url <url> [--dry-run]` are handled before argparse.
- **Headless modes** (`--no-window`, `--serve-lan`)
  - They open the last company, else the first, else create "My Company".
  - They never rewrite the desktop app's `DATABASE_URL` or last-opened company (#110).
  - `--serve-lan` binds 0.0.0.0 or one interface and prints a "Your team connects at http://&lt;host&gt;:&lt;port&gt;" banner (hostname and primary IP, "plain HTTP — trusted networks only"). The banner is also written to `connect-urls.txt`, and on frozen Windows it appears as a non-blocking popup.
- **WebView2 missing (Windows)**
  - Detection reads the EdgeUpdate `Clients\{F3017226-…}` `pv` value under HKLM, WOW6432Node and HKCU. This matters because pywebview would otherwise fall back silently to the IE control, where nothing works.
  - The message is tailored: the frozen build is told to install the runtime or use the installer, never "python … --no-window" (#149).
  - A Yes/No box offers "Open SlowBooks Pro in your web browser instead?". Yes serves on loopback, opens the system browser, and holds an OK box — "Click OK to stop SlowBooks Pro".
- **Other startup failures** — pywebview not installed, or a window that fails to start, print install hints and `--no-window` guidance, including a per-platform note for macOS Cocoa.
- **Logging**
  - `--hidden` is automatic when frozen, because the exe has `console=False`; output is appended to `launcher.log` under a timestamp header.
  - A fatal error raises a native box naming the log: `MessageBoxW` on Windows, `osascript display alert` on macOS.
  - stdout/stderr are reconfigured to UTF-8 with `errors="replace"`, after a `--help` crash on cp1252 consoles.
- **Server child (`--_serve`, frozen)**
  - Imports `app.main` itself so import tracebacks show in full, then runs `uvicorn.run(..., use_colors=False)`.
  - On POSIX, a watchdog thread exits when the launcher dies or the child is re-parented. This fixes the macOS Cmd-Q orphan server (#52), while Server Edition's long-lived parent is unaffected.
  - Source runs start `python -m uvicorn app.main:app --no-use-colors` instead.
  - Stopping means terminate, wait 10 s, then kill.
- **Windows timer resolution (#107)** — off unless `SLOWBOOKS_TIMER_RESOLUTION_MS` is set. When it is, the server child:
  1. opts out of Windows 11 timer throttling (`SetProcessInformation`, ProcessPowerThrottling);
  2. calls `timeBeginPeriod(N)`;
  3. logs the resolution before and after (`NtQueryTimerResolution`);
  4. undoes it on exit.
- **`--smoke-test` (used by CI)**
  - Runs on port 3999: prepares the env, creates "Smoke Test Co", migrates, serves and checks `/health`.
  - Then renders a WeasyPrint PDF and reports the OCR engine; on macOS, Apple Vision must be selected, and the Cocoa backend import is checked first.
  - Exits 0 or 1.
- **`--_repair-schema`** — runs `app.services.schema_repair` inside the frozen runtime for half-upgraded databases (#132/#144). It prints the revision before and after and any empty tables it dropped.
- **Source helpers**
  - `run.py` calls `uvicorn.run("app.main:app", host=APP_HOST, port=APP_PORT, reload=APP_DEBUG)`.
  - `restart-server.sh` restarts a checkout's local server through an untracked `.local-server/start_server.py`. It refuses root and finds Python via `SLOWBOOKS_PYTHON`, `.venv`, or a QBO test venv.

_Key files: `desktop_launcher.py`, `run.py`, `restart-server.sh`, `tests/test_launcher_headless_state.py`, `tests/test_launcher_without_webview2.py`, `tests/test_windows_timer_resolution.py`, `tests/test_server_mode.py`_

### Windows packaging & installer

- **PyInstaller spec (one-folder build)**
  - Bundles `index.html`, `alembic.ini`, `.env.example`, `app/static`, `app/templates` and `migrations/` as files, because Alembic loads scripts from disk.
  - Also bundles `scripts/windows/*.ps1` (to `_internal\scripts\windows`) and `scripts/repair-schema.py`.
  - Adds the CI-staged `gtk-dlls/*.dll` into `gtk/`.
  - Hidden imports: all `app`, `uvicorn` and `alembic` submodules, `webview.platforms.winforms`, `clr`, `clr_loader`, the SQLite dialect, `weasyprint`, and `winrt` (guarded).
  - Excludes psycopg2. The exe has `console=False` and no UPX; `slowbookspro.ico` is built in CI from `assets/icon-256.png` at 16–256 px.
- **Version resource (#106)** — `version_info.py` writes a `VSVersionInfo` from `app/__init__.py`, so Properties → Details and inventory tools can read the version.
  - FileVersion/ProductVersion come from the app version; CompanyName is VonHoltenCodes; ProductName is "SlowBooks Pro 2026"; FileDescription reads "SlowBooks Pro 2026 — bookkeeping".
- **OCR extras** — `requirements-ocr.txt` pins eight `winrt-*` 3.2.1 wheels (runtime, Media.Ocr, Graphics.Imaging, Storage.Streams, Foundation, Foundation.Collections, Globalization, Data.Pdf) for the built-in Windows OCR engine. They are frozen into this build only.
- **Inno Setup script (`SlowBooksPro.iss`)**
  - Produces `SlowBooksPro-Setup-x64.exe`, LZMA2 solid-compressed with the modern wizard, x64 only.
  - Installs to `{autopf}\SlowBooks Pro 2026` with a Start Menu entry, an uninstall entry and an optional desktop icon (unchecked by default).
  - **License page** — shows LICENSE and requires acceptance (§13), then keeps a copy as `LICENSE.txt`.
  - **WebView2** — bundles Microsoft's Evergreen bootstrapper (about 2 MB) and runs it `/silent /install` only when the registry check says the runtime is missing.
  - **Upgrades**
    - `CloseApplications=yes` asks running copies to close.
    - `[Code]` runs `taskkill /F /IM SlowBooksPro.exe /T` before install and uninstall, since the windowless server child cannot be asked.
    - `[InstallDelete]` wipes `{app}\_internal`, so stale `.dist-info` folders never mix versions.
  - **User data** — `%LOCALAPPDATA%\SlowBooksPro` is never touched by install, upgrade or uninstall.
  - A post-install checkbox offers "Launch SlowBooks Pro 2026".

_Key files: `packaging/windows/SlowBooksPro.spec`, `packaging/windows/SlowBooksPro.iss`, `packaging/windows/version_info.py`, `packaging/windows/requirements-ocr.txt`, `.github/workflows/windows.yml`, `tests/test_windows_version_info.py`_

### macOS packaging, signing & notarization

- **Target** — Apple Silicon (`arm64`), macOS 14+. Intel Macs are pointed at Docker. The macOS maintainer is @ContractorKeith.
- **Spec (`SlowBooksPro-mac.spec`)**
  - Collects the same data files as the Windows build, minus the PowerShell scripts.
  - Seeds six Homebrew dylibs that WeasyPrint dlopens (gobject, pango, pangoft2, harfbuzz, harfbuzz-subset, fontconfig). PyInstaller's hook cannot find Homebrew libraries on Apple Silicon.
  - Hidden imports: `webview.platforms.cocoa`, plus the pyobjc Vision, Quartz, objc and Foundation modules for built-in OCR.
  - Produces `SlowBooks Pro.app`, bundle id `com.vonholtencodes.slowbookspro`.
- **Info.plist**
  - `CFBundleShortVersionString` is the app version; `CFBundleVersion` is `version+<12-char SHA>`, so two builds of one release can be told apart.
  - `LSMinimumSystemVersion` is 14.0 and `LSArchitecturePriority` is arm64.
  - It also carries the local-network, Documents and Downloads usage strings.
- **One HarfBuzz (#141)** — the spec excludes `PIL._imagingft` and `PIL.ImageFont`, then aborts the build unless exactly one `libharfbuzz.0.dylib` exists and it is Homebrew's.
  - Pillow's copy used to take the versioned name, and Pango then crashed on the first PDF.
  - A test guards that the app never draws text with Pillow.
- **Bundle tools**
  - `prepare_bundle.py` removes PyInstaller's Resources→Frameworks symlinks, which Apple's notarization treats as code.
  - `audit_bundle.py` checks every Mach-O has an arm64 slice, every dependency resolves inside the bundle or to `/System/Library` / `/usr/lib`, no symlink escapes or dangles, and the six required libraries are present.
  - `build_icon.py` produces a full iconset (16–1024 px) for `iconutil`.
  - Pinned build tools: PyInstaller 6.22.0, hooks-contrib 2026.6, Pillow 12.3.0, pyobjc Vision/Quartz 12.2.2.
- **`release.py`** — turns an Actions artifact into a signed, notarized, stapled DMG:
  1. verifies `SHA256SUMS`, the commit SHA, the arm64 architecture, the version and the Actions run metadata (`--local-build` accepts a build from the maintainer's Mac);
  2. selects the single Developer ID identity;
  3. signs every Mach-O inside-out with a timestamp and the hardened runtime on executables — never `--deep` to sign — retrying only Apple timestamp-service blips (3 tries, 30 s / 60 s back-off);
  4. runs `spctl` policy checks before notarization;
  5. notarizes the bare `.app` and staples it first, so a copy dragged to Applications launches offline;
  6. builds a UDZO DMG with an Applications symlink, signs, notarizes and staples it;
  7. mounts the final DMG and runs `stapler validate` on the app inside;
  8. writes an evidence directory (notary logs, codesign details, native-linkage report, SHA256SUMS).
  - `--notary-keychain` supports signing over SSH.
- **Runbook (`packaging/macos/README.md`)** — CI signing with repo secrets, and the same script as the local fallback.
  - Installed-app acceptance remains a human gate: launch from the image and from a copy, create and reopen a company, render a PDF with a logo, back up, export, and check `launcher.log`.
  - In-fleet notes for the Macbase1 signer: `hdiutil` instead of `create-dmg`, which hangs without a GUI, and sign only after the smoke test.

_Key files: `packaging/macos/SlowBooksPro-mac.spec`, `packaging/macos/release.py`, `packaging/macos/audit_bundle.py`, `packaging/macos/prepare_bundle.py`, `packaging/macos/build_icon.py`, `packaging/macos/requirements-build.txt`, `packaging/macos/README.md`, `tests/test_macos_harfbuzz_collision.py`, `tests/test_macos_packaging.py`, `tests/test_macos_release.py`_

### Server Edition (LAN serving from the Windows build)

- **Quick trial** — `SlowBooksPro.exe --serve-lan` serves plain HTTP on port 3001 until the process ends. The connect URLs appear in a popup and in `connect-urls.txt`.
- **`serveredition-install.ps1`** — requires an elevated shell and takes `-Port 3001`, `-ExePath`, and `-DataDir` (default `C:\ProgramData\SlowBooksPro`).
  - Checks that the exe exists before anything else (#65); it is normally found three levels above the script inside the bundle.
  - Copies desktop books into the new data home once, and only when the server has none: `.db`/`.json`/`.env*` files plus the `companies`, `uploads` and `backups` folders.
  - Opens the Windows Firewall port (rule "SlowBooks Pro Server Edition").
  - Registers the scheduled task `SlowBooksProServer`: ONSTART, runs as SYSTEM, highest privileges, with `"<exe>" --serve-lan --port N --data-dir "<dir>"`. Backslash-quoting works around PowerShell 5.1 argument mangling under `Program Files`.
  - Starts the task and prints the team's connect URLs (computer name plus non-loopback IPv4 addresses).
- **`serveredition-uninstall.ps1`** — ends and deletes the task and the firewall rule, and deliberately leaves `C:\ProgramData\SlowBooksPro` in place.
- **`update-server-edition.ps1`**
  - Accepts `-RunId`, which uses `gh run download` of the `SlowBooksPro-windows-x64` artifact, or `-ZipPath`.
  - Unpacks zip-in-zip up to three levels and checks the `_internal` layout.
  - Stops `SlowBooksPro` processes, swaps the files in `-InstallDir` (default `C:\SlowBooksServer\SlowBooksPro-windows-x64`) and reruns the task.
  - Waits up to 60 s for `/health` and prints the version. Data is never touched, and the script is kept ASCII-only so Windows PowerShell 5.1 parses it.
- **In the app**
  - Settings → Users adds users. Once more than one exists, sign-in shows a username picker and the toolbar shows the user chip.
  - The sidebar and splash read "Server Edition" whenever the launcher serves beyond loopback.
  - SQLite runs with WAL, `busy_timeout=5000` and `synchronous=NORMAL` so readers proceed during a write, plus `secure_delete=ON` so deleted documents are overwritten in the file.

_Key files: `scripts/windows/serveredition-install.ps1`, `scripts/windows/serveredition-uninstall.ps1`, `scripts/windows/update-server-edition.ps1`, `desktop_launcher.py`, `app/database.py`, `docs/server-edition.md`_

### Update channel

- **`/api/system`** returns `version`, `desktop`, `server_mode` and `update_check_enabled`.
  - The check is enabled only when `SLOWBOOKS_DESKTOP=1` (desktop and Server Edition) and `SLOWBOOKS_UPDATE_CHECK` is not 0, false, no or off. Docker installs never check.
- **`/api/system/update-check`** — the backend, not the browser, fetches `https://dl.slowbookspro.com/latest.json`.
  - 6 s timeout, `User-Agent: SlowBooksPro/<ver>`, results cached for 12 h, and any failure means "no update".
  - It compares versions numerically and returns the latest version, the download URL and the notes URL.
- **Sidebar badge** — "↑ Version X is available — See what changed →", with the tooltip "You are on vY — opens the download page". It opens the download page in the system browser and never blocks or animates.
- **`scripts/publish-latest.sh [vX.Y.Z]`**
  - Defaults to the newest `v*` tag and writes `latest.json` with the version, `download_url` https://www.slowbookspro.com/#install, and `notes_url` pointing at the GitHub release.
  - rsyncs it to `/var/www/dl.slowbookspro.com` on `SSH_HOST` (default `starbase2-lan`).
  - Meant to run after the release is verified on real Windows, because publishing is what lights the badge on existing installs.

_Key files: `app/routes/system.py`, `app/static/js/app.js`, `scripts/publish-latest.sh`, `tests/test_system_routes.py`_

### Docker image & Compose deployments

- **`Dockerfile`**
  - Base image `python:3.13-slim`. Environment: `PYTHONDONTWRITEBYTECODE`, `PYTHONUNBUFFERED`, `PIP_NO_CACHE_DIR`, `PYTHONHASHSEED=random`, `PYTHONMALLOC=pymalloc`.
  - apt packages: cairo/pango/gdk-pixbuf (WeasyPrint), `postgresql-client` (`pg_dump`/`pg_restore`), and `tesseract-ocr` plus `poppler-utils` for receipt OCR.
  - Installs `requirements.txt` only, so the image has no dev tools, and precompiles site-packages and `/app` with `compileall`.
  - **Volume ownership** — the Dockerfile, not the entrypoint, creates `/app/backups` and `/app/app/static/uploads` owned by the `slowbooks` user (uid 1000), then switches to that user.
    - A named volume takes the owner of the image's folder, and root-owned volumes had broken every backup and upload.
  - `EXPOSE 3001`. `HEALTHCHECK` every 30 s with a 5 s timeout, 20 s start period and 3 retries, using a stdlib urllib probe of `/health`.
- **`docker-entrypoint.sh`**, in order:
  1. waits up to 30 s for `pg_isready` (`PGHOST`/`PGPORT`/`PGUSER`);
  2. runs `alembic upgrade head`;
  3. runs `python scripts/seed_database.py`, which is idempotent;
  4. runs a boot-time wiring self-check (`pytest tests/test_wiring.py`) before binding the port — only when pytest is importable and `SKIP_BOOT_SELFCHECK` is unset;
  5. `exec uvicorn app.main:app --host 0.0.0.0 --port ${APP_PORT:-3001} --workers ${APP_WORKERS:-2} --loop uvloop --http httptools --access-log`.
- **Multiple workers** — each worker's startup `create_all` is serialized with a PostgreSQL advisory lock (`pg_advisory_xact_lock`), after two workers raced on `CREATE TYPE`.
- **`docker-compose.yml` (single host, `docker compose up`)**
  - `postgres:17-alpine`, tuned (`shared_buffers=256MB`, `effective_cache_size=1GB`, `work_mem=16MB`, `maintenance_work_mem=64MB`, `max_connections=100`), with a `pg_isready` healthcheck and host port `${POSTGRES_PORT:-5433}`.
  - The app waits for a healthy database and publishes `${APP_PORT:-3001}:3001`.
  - Named volumes: `postgres_data`, `slowbooks_uploads` → `/app/app/static/uploads`, `slowbooks_backups` → `/app/backups`.
  - `SLOWBOOKS_PRIVATE_NETWORK=1` (default) relaxes exactly two production guards, database TLS and the HTTPS redirect; the encryption-key guards stay.
  - `PAYROLL_ENCRYPTION_SECRET` is required through `${…:?}`. Optional: `SETTINGS_ENCRYPTION_KEY`, `SESSION_SECRET_KEY`, the company and employer identity variables, and a commented `PYTHON_JIT`.
- **`docker-compose.prod.yml`**
  - PostgreSQL runs with `ssl=on` and a mounted `./certs/postgres` key pair, and publishes no host port.
  - The app uses `?sslmode=require`, forces `APP_DEBUG=false`, and sets `FORCE_HTTPS` (default true), `HSTS_MAX_AGE`, a 4 h idle timeout, rate limiting on, and `TRUST_PROXY_HEADERS` (default false).
  - `PAYROLL_ENCRYPTION_SECRET`, `SESSION_SECRET_KEY`, `CORS_ALLOW_ORIGINS` and the `POSTGRES_*` values are required. It runs 4 workers and only `expose`s 3001; you bring your own TLS proxy.
- **`.dockerignore`** — excludes `.git`, `.github`, `.claude`, `.env`, caches, virtual environments, `backups/`, `screenshots/`, `docs/` and `*.md`. `tests/` stays in the image, which is what the wiring self-check needs.
- **Default port** — 3001 everywhere, except the smoke test (3999) and the manual integration script (8000).

_Key files: `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.yml`, `docker-compose.prod.yml`, `.dockerignore`, `app/main.py`, `tests/test_docker_volume_owner.py`_

### Database migrations (Alembic)

- **Scale** — 44 revisions form one linear chain, from `915defbcc493` (initial schema) to the head `e2b7c4d9a1f3` (employee portal links kept as a digest plus an encrypted copy). They run automatically in the Docker entrypoint and whenever the launcher opens a company.
- **`alembic.ini`** — `script_location = migrations`, with a placeholder `sqlalchemy.url`.
- **`migrations/env.py`**
  - Loads `.env` (or `SLOWBOOKS_ENV_FILE`) without overriding real environment variables, so `alembic upgrade head` sees the same secrets as the app.
  - Gives a programmatic `config.attributes["database_url"]` (per-company migrations) precedence over `DATABASE_URL`.
  - Keeps existing loggers alive during in-process runs.
- **Notable revisions**
  - `27e17711c1a2` 19 feature tables.
  - `e5f6a7b8c9d0` bank rules, budgets, attachments, email templates, 1099 fields.
  - `f6a7b8c9d0e1` inventory, saved reports, duplicate detection.
  - `f7a8b9c0d1e2`, `a7b8c9d0e1f2`, `b8c9d0e1f2a3` payroll tiers 1–3.
  - `e3f4a5b6c7d8` multi-currency; `f4a5b6c7d8e9` fixed assets.
  - `b6c7d8e9f0a1` Server Edition audit username.
  - `e9f0a1b2c3d4`, `f0a1b2c3d4e5`, `a1b2c3d4e5f6` jobs, cost codes and the job-cost model.
  - `d5e6f7a8b9c0` benefits engine.
  - `f1a2b3c4d5e6`, `a2b3c4d5e6f7`, `b3c4d5e6f7a8` nonprofit dimensions and documents.
  - `a0b1c2d3e4f5` users and `c4d5e6f7a8b9` API tokens, both previously created only by `create_all`.
  - `e7f8a9b0c1d2` banking on the ledger (#114); `f8a9b0c1d2e3` vendor credits (#129).
  - `a9b0c1d2e3f4` money columns to `Numeric(15,2)`; the four-decimal rate and price revisions.
  - `c5e1f7a9b3d2` company files stored in the company's own database.
- **Startup guard (#132)** — the app refuses to start against a database behind head, because `create_all` would half-upgrade it.
  - When it detects a half-upgraded file, it names the repair command that exists on that install: the frozen `--_repair-schema` or `scripts/repair-schema.py`.
  - A database with no `alembic_version` table is treated as new and allowed.
  - After the guard, `create_all` fills in tables the migrations do not cover.

_Key files: `alembic.ini`, `migrations/env.py`, `migrations/versions/`, `app/main.py`, `app/services/schema_repair.py`, `scripts/repair-schema.py`, `tests/test_startup_migration_guard.py`, `tests/test_schema_repair.py`_

### Installation options & hosting guides

- **INSTALL.md options**
  - **Option 0 — Windows installer (signed)** — a self-contained desktop window with books in `%LOCALAPPDATA%\SlowBooksPro`.
    - Covers Controlled Folder Access fallbacks and the allow-list steps, `.db` snapshot backups, and the single-user trade-off.
  - **Option 0A — macOS DMG** — drag to Applications, arm64 on macOS 14+, data in `~/Library/Application Support/SlowBooksPro/data`.
  - **Option 1 — Docker** — `cp .env.example .env`, set `PAYROLL_ENCRYPTION_SECRET` (openssl or Python), `docker compose up`, open http://localhost:3001.
    - Also explains the private-network flag, changing `APP_PORT`, `CORS_ALLOW_ORIGINS`, and copying backups out with `docker compose cp`.
  - **Option 2 — Native Linux** — apt libraries, an optional tesseract/poppler, and `gir1.2-webkit2-4.1` for a desktop window; Postgres user and database; a PEP 668-required venv.
    - Then `alembic upgrade head`, `python scripts/seed_database.py`, `python run.py`. `APP_DEBUG=true` is advised for local use, because `FORCE_HTTPS` would redirect to a TLS port that does not exist.
  - **Option 3 — Native macOS** — Homebrew postgresql@17, cairo, pango and gdk-pixbuf, then the same steps.
  - **Demo data** — `python scripts/seed_irs_mock_data.py`, or `docker compose exec slowbooks python scripts/seed_irs_mock_data.py`.
  - **Troubleshooting** — WeasyPrint libraries, port in use, database refused, `pg_dump` missing.
- **Cloud hosting guide** (`docs/cloud-hosting.md`, one-VPS recipe of about an hour)
  - Opens with a licence note: your own books are fine; hosting for strangers is not.
  - Sizing: 1 vCPU, 2 GB RAM and 25 GB on Ubuntu 24.04 or Debian 12, about $5–12 a month.
  - Hardening: ufw, fail2ban and unattended-upgrades, SSH key only.
  - Setup: generated secrets, a self-signed Postgres certificate, and a `docker-compose.proxy.yml` override binding `127.0.0.1:3001`, with Caddy obtaining the certificate automatically.
  - Operations: nightly `pg_dump` shipped off the box (rclone or scp) plus snapshots, and updates by checking out the new tag and running `up -d --build`.
  - States what the setup does not give: no two-factor sign-in (suggests a VPN or Cloudflare Access), no managed service.
- **TLS proxy guide** (`docs/tls-proxy-setup.md`)
  - Covers Caddy, nginx with certbot, Traefik, and cloud load balancers (which must set `X-Forwarded-Proto`).
  - Verification: 200 over HTTPS, a redirect from HTTP, an SSL Labs grade; HSTS preload is optional.
  - A pitfalls table lists cookie refusal, redirect loops, cached HSTS, Let's Encrypt rate limits, and 502 errors.

_Key files: `INSTALL.md`, `docs/cloud-hosting.md`, `docs/tls-proxy-setup.md`, `docs/server-edition.md`, `README.md`_

### Seed & demo data

- **`scripts/seed_database.py`** — idempotent: it skips any database that already has accounts. It seeds the 56-account chart from `app/seed/chart_of_accounts.py`, which follows the "Contractor" numbering of QuickBooks 2003 EasyStep, as `is_system` accounts, plus a default Equipment fixed-asset type.
- **`scripts/seed_irs_mock_data.py`** — "Henry Brown's Auto Body Shop" from IRS Publication 583 (Rev. December 2024), pages 16–23.
  - Creates 13 vendors, 8 customers, 8 items, 10 invoices, 3 estimates and 5 payments, dated in the current year.
  - Invoice numbers start at 2001 or at the next number free; vendors and items that already exist are skipped, and the script refuses to run twice (it keys on the customer "John E. Marks").
  - It prints the totals invoiced, paid and outstanding.

_Key files: `scripts/seed_database.py`, `scripts/seed_irs_mock_data.py`, `app/seed/chart_of_accounts.py`, `app/seed/fixed_assets.py`_

### Dependencies & tooling configuration

- **Runtime (`requirements.txt`)**
  - Web stack: FastAPI `>=0.135,<0.142`, `uvicorn[standard]`, Starlette `>=1.0.1` (pinned for CVE fixes).
  - Data: SQLAlchemy `>=2.0.40,<2.1` (2.1's `postgresql://` means psycopg 3), Alembic, `psycopg2-binary==2.9.12`, Pydantic 2 with pydantic-settings, `python-dotenv==1.2.2`.
  - Documents: `jinja2==3.1.6`, `weasyprint==70.0` (CVE-driven), `pydyf==0.12.1`, `python-multipart==0.0.32`.
  - Import and integrations: ofxparse, python-dateutil, stripe `<16`, python-quickbooks, intuit-oauth, pyjwt `>=2.10`.
  - Security and HTTP: cryptography `>=48.0.1,<51`, httpx, argon2-cffi, itsdangerous, slowapi.
  - OCR adds no Python dependencies; it shells out to tesseract and poppler.
- **Dev (`requirements-dev.txt`)** — pytest, pytest-cov, black, ruff, pypdf.
  - The Windows CI job adds pytest-timeout. Neither Playwright nor Node is listed in any requirements file; the tests that need them skip when they are absent.
- **Desktop (`requirements-desktop.txt`)** — `pywebview==6.2.1`.
- **`pyproject.toml`** — ruff configuration only: rules `E4`, `E7`, `E9`, `F`, pinned explicitly so ruff upgrades cannot fail the build, with `E741` allowed in tests. black uses its defaults.
- **`pytest.ini`** — `testpaths = tests`, `-ra --strict-markers --disable-warnings`, one marker (`integration`: needs tesseract/poppler), and Deprecation/PendingDeprecation warnings ignored.
- **Python versions** — the Docker image and CI tests use 3.13; the Windows and macOS desktop builds use 3.12, which pythonnet needs.

_Key files: `requirements.txt`, `requirements-dev.txt`, `requirements-desktop.txt`, `pyproject.toml`, `pytest.ini`_

### CI/CD workflows

- **`ci.yml`** — runs on pushes to `main`, `server-edition`, `feat/v2.8`, `claude/**` and `se/**`, and on PRs to the first three. In-progress runs are cancelled on a new push.
  - **Lint** (ubuntu-latest, Python 3.13): `black --check` and `ruff check` over `app/ tests/ scripts/`.
  - **Test** (ubuntu, 3.13): installs the WeasyPrint libraries plus tesseract and poppler, then `pytest --cov=app` with an in-memory SQLite `DATABASE_URL`. `coverage.xml` is uploaded for 7 days.
  - **Test on Windows** (windows-latest, 3.13): `pytest -q --timeout=300`, without tesseract, poppler or GTK.
    - It enforces a skip budget, `MAX_SKIPS=97`, so a quiet rise in skipped tests fails the job (#121).
  - **pip-audit** — `--strict` on `requirements.txt` as a PR gate.
  - **Docker build** (needs Test) — `docker build`, then `python -c "import app.main"` inside the image.
- **`codeql.yml`** — pushes to `main`/`feat/v2.8`, PRs, and weekly on Monday at 06:00 UTC.
  - A Python + JavaScript matrix with autobuild and analyze. It is skipped on forks, which lack code scanning.
- **`pip-audit.yml`** — Sundays at 14:00 UTC, plus manual dispatch.
  - Runs `pip-audit -r requirements.txt --strict`. On findings it files a de-duplicated issue labelled `security` and `pip-audit`, then fails.
- **`windows.yml`** — `v*` tags and manual dispatch; windows-latest in the `release` environment with OIDC, on Python 3.12.
  1. Checks that the tag matches the version.
  2. Uses MSYS2 MINGW64 as a donor for the pango/fontconfig DLLs, copying the closure found by `ntldd` and requiring at least 15 DLLs.
  3. Installs everything in one pip resolver pass and fails on any duplicate distribution.
  4. Builds the `.ico`, runs PyInstaller, then `--smoke-test` (8 min) and a version-resource check.
  5. Signs the exe with Azure Trusted Signing (OIDC, no stored secret).
  6. Builds the portable zip, fetches the WebView2 bootstrapper (must exceed 500 KB) and runs Inno Setup (installed via choco if missing).
  7. Signs the installer and writes `SHA256SUMS.windows`.
  8. Uploads the artifact and, on a tag, attaches the files to the GitHub Release.
- **`macos.yml`** — manual dispatch (with `expected_sha`), the `macos-build` branch, and `v*` tags.
  - **Build** (macos-14 arm64, Python 3.12):
    1. verifies the exact SHA and arm64;
    2. validates the version against the tag;
    3. runs `brew install pango fontconfig gobject-introspection`;
    4. builds the icon, then runs PyInstaller;
    5. validates the bundle: prepare, clear xattrs, re-apply the ad-hoc signature, `plutil` checks, `lipo`, `codesign --verify --deep --strict`, the linkage audit;
    6. runs the smoke test;
    7. uploads the unsigned app zip, a transport DMG, `pip freeze`, the brew versions, `build-info.txt` and `SHA256SUMS`, kept 7 days.
  - **Sign** (canonical repo only) — imports the Developer ID certificate from secrets into a throwaway keychain, stores notary credentials, and runs `release.py`.
    - It stages the versioned DMG plus a stable-named `SlowBooksPro-macos-arm64.dmg`, `SHA256SUMS.macos` and `release-evidence.tar.gz`.
    - The keychain is always deleted afterwards, and evidence is uploaded on failure.
  - **Release** (tags) — attaches those files to the GitHub Release.

_Key files: `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/workflows/pip-audit.yml`, `.github/workflows/windows.yml`, `.github/workflows/macos.yml`_

### Repository governance

- **`CODEOWNERS`** — `* @VonHoltenCodes`. With branch protection, nothing lands on `main` without the owner's review.
- **Issue templates**
  - Bug report: labelled `bug`, title "[Bug] ", with sections for what happened, steps, expected behaviour, environment (version, Python, OS, browser, deployment), logs and workaround.
  - Feature request: labelled `enhancement`, with problem, proposal, alternatives, scope checkboxes and context.
  - `config.yml` disables blank issues and links to private security advisories and Discussions.
- **PR template** — sections for Summary, Changes, Test plan (pytest, black, ruff, manual check, "Tested in dark mode"), Contributor terms (a `Signed-off-by` checkbox), Screenshots, Security implications, Database changes, Documentation and Related issues.
- **Secrets hygiene** — `.gitguardian.yaml` makes ggshield ignore `tests/**`, whose fixture passwords are fake. CONTRIBUTING notes that GitGuardian's GitHub App ignores that file, so fixture passwords are kept away from username keys.
- **`.gitattributes`** — LF normalization everywhere (`*.sh` forced to LF for Docker) and a byte-exact Bank of America CSV fixture.
- **`.gitignore`** — keeps `.env`, `*.db`, `.slowbooks-master.key`, `.slowbooks-session.key`, uploads, dumps, `.local-server/` and the generated macOS `.icns` out of Git.

_Key files: `.github/CODEOWNERS`, `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.gitguardian.yaml`, `.gitattributes`, `.gitignore`_

### Test suite

- **Scale**
  - 302 `tests/test_*.py` modules plus `conftest.py`, with about 2,370 `def test_` functions; parametrized cases expand this.
  - `tests/js/` holds 32 `*_probe.js` scripts. Each is driven by pytest through `node` and prints JSON for Python to assert on; about 44 modules shell out to Node and skip without it.
  - `tests/js/` also holds 9 `*.test.cjs` `node:test` suites, which `tests/test_js_node_suites.py` runs with `node --test`. A suite also fails on "generated asynchronous activity".
  - Fixtures: a real-shape Bank of America CSV, hledger files, three OCR receipt PDFs, QuickBooks report CSVs, and a QuickBooks for Mac IIF.
- **Isolation (`conftest.py`)**
  - `SLOWBOOKS_DATA_DIR`, the `.env` path and the settings key all point into a temporary folder per run, never the machine's real books (`test_suite_isolation.py`).
  - One file-backed SQLite database is built once; each test runs in a rolled-back transaction with savepoints.
  - A pristine-table sentinel covers accounts, customers, vendors, transactions and users, and names the test that leaked rows.
  - A hook turns a missing WeasyPrint native stack into a skip. Rate limiting and idle expiry are off, and the OCR engine is pinned to tesseract.
- **Browser (playwright)** — `test_browser_ui.py` covers form layout at 1280×800, the pay-run view, the toolbar and Back, and the permit form. `test_theme_contrast.py` and `test_dialog_contrast.py` are the contrast sweeps, and `test_readonly_browser.py` checks every route as admin versus read-only. Each skips as a whole module without playwright or Chromium.
- **UI logic via Node probes** — the router and document routes, toolbar navigation, auth prompt and picker link, read-only and admin marks, the settings unsaved guard, desktop downloads and the PDF viewer page, theme redraw, money signs, receive payment, tax-rate forms, and more.
- **Accessibility** — `test_accessibility.py` (7 checks), `test_chart_colors.py`, `test_css_hidden_and_contrast.py`, `test_disabled_buttons.py`.
- **Wiring and contract audits**
  - `test_wiring.py`: every SPA call resolves to a route, and no backend route is an orphan outside a 37-entry allowlist.
  - `test_sensitive_route_auth_contract.py`, and `test_api_sweep.py` (no GET route returns 5xx).
  - `test_schemas_audit.py` (the `date: date` shadowing trap), `test_jinja_autoescape_audit.py`, `test_subprocess_safety_audit.py`, `test_no_nplus1_in_list_endpoints.py`.
  - `test_onclick_attributes_parse.py` parses rendered markup with a real HTML parser; `test_no_decomp_strings_in_dom.py`.
- **Desktop and packaging** — `test_desktop_mode.py` (23 tests), the PDF viewer (13), downloads (7), save permissions (5, with real EPERM errors), PDF names, headless state (3), running without WebView2 (9), the Windows timer (6), Windows version info, the macOS HarfBuzz check, macOS packaging (5) and release (15), Docker volume ownership, server mode (9), the startup migration guard (5), schema repair, first run, and the terms and What's new feeds.
- **Domain suites** — examples by file count: 25 QBO, 15 tax, 14 banking, 10 invoice, 9 report, 8 IIF, 6 OCR, 6 dashboard. Their content belongs to other sections.

_Key files: `tests/conftest.py`, `tests/test_js_node_suites.py`, `tests/test_wiring.py`, `tests/test_suite_isolation.py`, `tests/test_browser_ui.py`, `tests/js/`, `pytest.ini`_

### Developer, audit & maintenance scripts

- **`scripts/integration_test_frontend.py`** — a manual live-HTTP smoke test of the Tier 1–3 HR/payroll UI against `http://127.0.0.1:8000`.
  - It calls the auth setup, employees, onboarding, time-entry, PTO, deductions, W-2 form and portal-token endpoints, and fetches the SPA's JS and CSS.
  - If no server answers, it starts uvicorn against `sqlite:///./test.db`. It lives outside `tests/` so pytest does not collect it.
- **`scripts/audit/vocab_walk.py`** — "Pass A" of the vocabulary audit.
  - Walks a running server (`--base URL`, password from `SLOWBOOKS_QA_PASSWORD`) in both company types. It collects JSON values, PDF text (via `pdftotext`) and HTML text, and reports business words that survive in nonprofit mode.
  - It classifies each hit as a source-backed code leak, seeded data, document face, or dynamic data.
  - It is read-only apart from switching `company_type`, which it restores, and writes a JSON report. The release gate runs it.
- **Maintenance**
  - `scripts/repair-schema.py` (half-upgraded databases).
  - `scripts/repair_employee_enums.py` and `scripts/repair_rounding_drift.py` (dry-run by default; `--apply`, `--json`).
  - `scripts/run_recurring.py` (a cron job for recurring invoices).
  - `scripts/backup.sh` (`pg_dump | gzip`, keeps the 30 most recent).
  - `tools/clean_iif.py` (writes a cleaned copy of an IIF file: unquotes names and re-cases ALL-CAPS names).
- **`cloudflare/`** — an optional self-hosted Workers AI gateway (`worker.js`, `wrangler.toml`); see the AI section.

_Key files: `scripts/integration_test_frontend.py`, `scripts/audit/vocab_walk.py`, `scripts/repair-schema.py`, `scripts/repair_employee_enums.py`, `scripts/repair_rounding_drift.py`, `scripts/run_recurring.py`, `scripts/backup.sh`, `tools/clean_iif.py`, `cloudflare/README.md`_

### Engineering process docs

- **`docs/development.md`**
  - A tech-stack table and project tree, plus where new code goes: routers in `app/routes`, models, schemas, a SPA page module registered in `app.js`, and tests.
  - Also covers running pytest, the wiring audit as a boot tripwire, the manual integration script, lint commands and the contributor flow. Several of its figures are stale; see Notes.
- **`docs/wiring-audit.md`** — the "spider-web from both ends" method:
  - grep the SPA for `API.get/post/put/del` and `fetch`;
  - grep the routers for prefixes and decorators;
  - cross-reference by method and path, with path parameters matched by position.
  - It records the round-1 fixes: three `API.delete` typos, the missing PTO policy GET/PUT, PTO approve/reject aliases, and `/pdf` variants for tax forms.
  - It lists the call styles the collector handles and how `${…}` is normalized to `*`, gives a re-run recipe (`comm -23` diff), and names the intentional orphan routes.
- **`docs/release-checklist.md`** — before tagging:
  - add the `whats-new.json` entry and move the CHANGELOG items;
  - do the docs pass: README "What's New" (last three releases) and the operations count, `features.md`, CONTRIBUTING, the website including the LLM-facing `llms.txt` and agent template, and file templates;
  - pass the three-platform gate in the SlowBooks-Pro-Testing repo, cutting the tag from the SHA named in `GATE.md`.
  - Deployment sections 1–11 then cover secrets, the database (`sslmode`), required environment variables, payroll accounts, TLS, backups (cron plus gpg), monitoring (`login_attempts`, `audit_log`, `document_audits`), pip-audit, tax-form caveats, HIPAA, pre-flight curls and post-launch checks.
- **`CONTRIBUTING.md`**
  - `main` is protected with required code-owner review. Releases go through the three-platform gate (Windows 11, macOS on Apple Silicon, Linux + Docker/PostgreSQL). A fork-first flow is described for new contributors.
  - Platform maintainers are named, along with branch prefixes (`claude/`, `fix/`, `feat/`, `docs/`, `parked/`) and commit-message style (`git commit -s`).
  - **Project rules**:
    - USA only;
    - "the company's words, everywhere";
    - a saved email template is never rewritten;
    - no importer without a real exported file;
    - an error never asks for the impossible;
    - desktop and Server Edition are one program.
  - Also covers the steps for adding a feature, the backend-only allowlist, the `date: date` trap and Jinja `autoescape=True` rules, and security-sensitive change flags.

_Key files: `docs/development.md`, `docs/wiring-audit.md`, `docs/release-checklist.md`, `CONTRIBUTING.md`, `SECURITY.md`_

### License & contributor terms

- **License** — SlowBooks Pro 2026 Source Available License, version 2.0, © 2026 Trent Von Holten. It applies to releases published after it first appeared; earlier releases keep the license they shipped with.
- **Allowed**
  - A perpetual, worldwide, royalty-free right to use, copy, modify, merge and redistribute.
  - Personal use; internal use by any organization, for-profit included, including keeping clients' or members' books; education and research.
  - Building and selling separate programs that interoperate through the HTTP API, file formats or company-file format, which are not "Derivative Works".
  - Each release's license is irrevocable for that release.
- **Forbidden**
  - Selling, renting, leasing or sublicensing the software or a derivative, or charging for a copy.
  - Offering it to outsiders as a hosted, managed or online service they pay for (keeping your own clients' books is allowed; selling them access is not).
  - Embedding it in a paid product or service.
  - Removing notices or the attribution.
  - Using the Licensor's name or the names "SlowBooks" / "SlowBooks Pro" for a derivative; forks must be renamed.
- **Conditions**
  - Free redistribution must include the license and the notice, and keep "SlowBooks Pro 2026 — originally created by Trent Von Holten" in the documentation or an About screen.
  - Contributions come in under the Contributor Terms.
- **Disclaimers**
  - Tax, payroll and filing outputs (W-2/W-3/940/941, state withholding, sales tax, Schedule C, NACHA) are "aids, not advice"; nothing is filed for you.
  - No warranty and no maintenance obligation; liability is capped at the price paid, which is zero.
  - You indemnify the Licensor and contributors.
  - Third-party services are your own relationship.
  - The license terminates automatically on breach of §3 or §4, though internal use of copies you have may continue.
  - Illinois law, with venue in Will County.
  - Using the software is acceptance. The desktop app and the Windows installer show the terms before first use (§13).
- **Contributor Terms (`CONTRIBUTING.md`)**
  - Contributors keep copyright but grant Trent Von Holten a perpetual, irrevocable, royalty-free licence including the right to relicense.
  - They warrant the right to contribute (employer code included) and grant a patent licence. Contributions come as-is.
  - Agreement is given through a `Signed-off-by` line on every commit; contributions made before September 2026 keep their original licence.

_Key files: `LICENSE`, `CONTRIBUTING.md`, `index.html`, `packaging/windows/SlowBooksPro.iss`_

### Roadmap & design notes (planned — not shipped)

- **Kiosk mode for Server Edition (planned — not shipped)** — a shop-owned device logged in once under a restricted `kiosk` role, with a per-person PIN.
  - **Employee kiosk**: a time clock with job and cost-code picker, "my pay stubs", and time-off requests through the portal pages.
  - **Point of sale**: keyed entry first (item grid or barcode, per-item tax, cash or "card taken outside", receipts, refunds and voids, an end-of-day Z report); card terminals and cash-drawer hardware later.
  - A proposed kiosk login by last-4 SSN plus name is parked as weak authentication.
- **Owed payroll items (planned — not shipped)** — pay-run void (reversing the journal entry, the burden job-cost entry and the BenefitYTD bumps), cancelling an approved PTO request, effective-dated state withholding tables, the January verification pass on the state tables, and per-state SUI filing forms (only scaffolding exists).
- **Security and ops (planned — not shipped)** — remove CSP `script-src 'unsafe-inline'`, either by rewriting each file to `addEventListener` or with a delegated `data-action` dispatcher; an external penetration test.
- **Future features (planned — not shipped)**
  - Activity log / CRM timeline per customer.
  - Email integration with replies and bounces feeding back.
  - An AI-staged inbound-mail queue: parse, match, classify with sentiment, stage, and let the user review. It never auto-applies.
  - A DocumentAudit hash-chain viewer (the endpoints already exist).
  - A portal time-entry submit page (the endpoint exists).
  - A Stripe pricing and checkout surface.
  - Direct model-level tests for 20 models.
- **Canada support (planned — not shipped; PARKED)**
  - Four seams: tax codes with recoverable components (to be built first as a general feature); a CPP/EI/T4127 payroll engine; GST/HST, PD7A, T4 and ROE filings; and Canadian words and seeds.
  - An immutable `company.country` switch would select all of it.
  - Sized at roughly two v2.7-sized stages, with conditions set before it is unparked and open questions on Quebec.
- **Accountant file sharing (planned — not shipped; DESIGN)** — two candidates, neither chosen:
  - **A**: a Fernet-encrypted export sent to a self-hosted Cloudflare Worker drop-box, with a TTL and a PIN sent out of band;
  - **B**: scheduled email reusing the `run_recurring.py` pattern and `email_service`.
  - The prerequisite, SMTP password encryption at rest, has already shipped.
- **Server Edition TLS (planned — not shipped)** — `docs/server-edition.md` says TLS support is planned; LAN mode is plain HTTP today.

_Key files: `docs/todo.md`, `docs/design/README.md`, `docs/design/canada.md`, `docs/design/accountant-sharing.md`, `docs/server-edition.md`_

### Notes, gaps & discrepancies

- **Docs vs code**
  - **Where the update notice is** — `INSTALL.md` says the app's *footer* shows "Update available", and `publish-latest.sh` says it lights the footer badge. The code draws the badge at the *top* of the sidebar (`#sidebar-update`), reading "Version X is available".
  - **Switching companies** — `INSTALL.md` and the launcher's docstring say every launch asks which company to open, and that switching means closing and relaunching. The code auto-opens the last company on the window's first load, and Sign Out or Companies → "Switch company…" returns to the picker without a restart (`show_picker`).
  - **When "SERVER EDITION" appears** — `docs/server-edition.md` says the header changes the moment a second user exists. The code keys the label on `server_mode`, which is set only when the launcher serves beyond loopback (`--serve-lan`). A second user adds only the username picker, the user chip and a toast.
  - **Where Users lives** — `docs/cloud-hosting.md` says "Manage → Users". Users are under Settings → Users; the Manage group holds Items, Employees and Payroll.
  - **UI counts in `docs/features.md`** — it claims "35+ SPA routes, 34 sidebar nav links" and a global search over six entity types. The code has 64 routes and 48 links, and search also covers sales receipts, credit memos and bills, plus amount matching.
  - **Stale figures in `docs/development.md`** — "50 routers, 300+ routes" (`app/main.py` includes 75 routers; the README says 545 operations), "WeasyPrint 60.2" (the pin is 70.0), "452 pytest tests", "app.js … 40 routes", and "CI gates a curated file allowlist". CI now checks `app/ tests/ scripts/` in full.
  - **Wiring audit test count** — `docs/wiring-audit.md` says `tests/test_wiring.py` has three tests; it has four (the fourth checks that the allowlist names only real routes without callers).
  - **Size of the seeded chart** — `INSTALL.md` says the chart has 57 accounts and `README.md` a "50-account contractor chart"; `app/seed/chart_of_accounts.py` lists 56.
  - **Payroll accounts in the release checklist** — §3a tells operators to create accounts 2300–2360, 6110 and 6120 before the first pay run; the seed already includes all of them (and 2370–2390, 6130–6160). The checklist also calls SQLite "dev / tests" only, though desktop installs run on it.
  - **Copyright on the Windows exe** — `packaging/windows/version_info.py` stamps "Copyright © VonHoltenCodes. MIT License." into the resource, which contradicts LICENSE (Source Available v2.0, © Trent Von Holten).
  - **`docs/todo.md` email item** — it says no email transport is wired; `app/services/email_service.py` sends over SMTP (with STARTTLS).
  - **`docs/design/README.md`** — its index lists only two of the directory's eight design documents and says "nothing in this directory is committed product behaviour", while `accessibility.md`, `benefits-engine.md` and `nonprofit.md` are marked SHIPPED or BUILT.
  - **Proxy headers** — `docs/tls-proxy-setup.md` says the app reads `X-Forwarded-For`/`X-Forwarded-Proto` whenever present; in code, `X-Forwarded-For` is honoured only with `TRUST_PROXY_HEADERS=true` (default false).
  - **Minor stale comments**
    - `ci.yml` says the migration tests walk 36 migrations; there are 44.
    - The `app.js` clock comment says it "ticks once a second"; it updates every 60 s.
    - The `conftest.py` header calls the suite database in-memory; the fixture uses a file.
    - `publish-latest.sh`'s header names starbase1; the default `SSH_HOST` is `starbase2-lan`.
    - `CHANGELOG.md` keeps every 2.x release as a heading under `## [Unreleased]`.
- **Code-level observations**
  - **Wiring self-check never fails the boot** — the check in `docker-entrypoint.sh` pipes pytest into `tail -5` under `set -e` without `pipefail`. The `if !` therefore tests `tail`'s exit status, so a failing check would not stop the container. The production image has no pytest, so the check never runs there anyway. This contradicts the README's "drift … fails the boot".
  - **Server Edition install may miss desktop books** — `serveredition-install.ps1` looks for desktop books in `%LOCALAPPDATA%\SlowBooksPro\*.db` and `…\companies\`. The launcher keeps them in `%LOCALAPPDATA%\SlowBooksPro\data\companies\`, and when frozen reads `.env` from the data directory's parent (`C:\ProgramData\` under the task's `--data-dir`), while the script copies `.env*` into the data directory itself. As written, the copy step appears not to find books in the default desktop layout. No test covers it; this is from reading the code, not a run.
  - **Private-network path skips the migration-head guard** — with `SLOWBOOKS_PRIVATE_NETWORK=1` (the default in compose), the startup checks return before `_refuse_a_database_behind_head()`. The entrypoint's own `alembic upgrade head` covers the shipped path.
  - **Vestigial `X-Company-Id` header** — `api.js` and `qbo.js` send it from `localStorage.slowbooks_company`, but no SPA code sets that key and no server code reads the header.
  - **Theme button glyph** — the toolbar button ships as ☼ in light mode, while `toggleTheme` sets ☾ for light and ☼ for dark, so the first light-mode load shows the "dark" glyph.
  - **Keyboard and screen-reader gaps**
    - The global search input has only a placeholder, no label.
    - Search results are clickable `<div>`s, not focusable or announced options.
    - The theme button's accessible name is its glyph (it has only a `title`).
    - Shortcuts have no ⌘ variants.
    - No `prefers-reduced-motion` or `prefers-color-scheme` handling exists in the SPA (the splash fades and toasts slide in unconditionally).
    - The shell is not responsive.
  - **Playwright suites skip in CI** — neither CI job installs playwright, so the browser, contrast and read-only sweeps skip there (the Windows skip budget accounts for this). They run on the QA gate and dev machines.
  - **`integration_test_frontend.py` is stale** — it imports `requests`, which is not in any requirements file, and hard-codes `cwd="/home/user/SlowBooks-Pro-2026"` for auto-starting the server.
  - **Unused IRS seed table** — `seed_irs_mock_data.py` defines Pub 583's January daily-sales table (25 days) but never inserts it.
  - **Unused CSS hook** — `body.role-readonly` is toggled but no stylesheet rule uses it.
- **Known limitations (documented)**
  - **Server Edition** is plain HTTP for trusted LANs only (no TLS yet), aimed at 2–10 users, and shows the list of usernames before sign-in.
  - **macOS builds** are Apple Silicon on macOS 14+ only.
  - **WebView2-absent path** — its end-to-end run on a machine genuinely missing the runtime is recorded in the launcher as uncovered (unit-tested with a fake registry).
  - **No two-factor sign-in.**
  - **Tax forms** are not pixel-exact IRS replicas.
  - **Windows timer tuning** is off by default.
  - **Different Python versions** — the desktop builds use 3.12 while CI tests 3.13.

_Key files: `INSTALL.md`, `docs/features.md`, `docs/development.md`, `docs/server-edition.md`, `docs/cloud-hosting.md`, `docs/wiring-audit.md`, `docs/release-checklist.md`, `docker-entrypoint.sh`, `scripts/windows/serveredition-install.ps1`, `packaging/windows/version_info.py`, `app/static/js/api.js`_

---

_[← 8. Platform, Security & Administration](08-platform-security-administration.md) · [Index](README.md) · [Appendix A. Complete API endpoint catalog →](appendix-a-api-endpoints.md)_
