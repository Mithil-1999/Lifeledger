# LifeVault

A private, self-hosted personal life-management web app. It covers income, expenses, bills, rent, budgets, savings, debts, tasks, reminders, a calendar, notes, documents and an encrypted password vault, all in one dashboard.

> **Status: Phases 1–6 and 8 complete.** You get secure accounts, a personal dashboard, income and expenses, budgets, bills, savings, tasks and reminders, plus **notes** (tags, categories, pin, archive) and **private document storage** (validated uploads, owner-only downloads). Phase 7 (Password Vault) hasn't been built yet, so it's still a placeholder.

Default currency is **NPR (Nepalese Rupee)**. The architecture leaves room for more currencies later.

---

## Technology stack

| Layer    | Technology                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui-style components (Radix UI), React Router, TanStack Query, React Hook Form + Zod, Recharts, Sonner toasts, Lucide icons |
| Backend  | Python, FastAPI, Pydantic v2 / pydantic-settings, SQLAlchemy 2.0, Alembic, Argon2 (argon2-cffi)      |
| Database | PostgreSQL 17 (psycopg 3 driver)                                                                    |
| Tooling  | Docker, Docker Compose, Vitest + Testing Library, pytest, ESLint                                    |

Recharts is loaded lazily in its own bundle chunk, so pages without charts (like login) never download it.

## Project structure

```text
.
├── backend/                     FastAPI application
│   ├── app/
│   │   ├── api/                 Routers (all under /api)
│   │   │   ├── router.py        Public routers + `protected_router` (auth required)
│   │   │   ├── deps.py          DB session + CurrentUser/CurrentSession guards
│   │   │   └── routes/          health, auth, dashboard, finance (categories/income/expenses),
│   │   │                        planning (budgets/bills/savings), productivity (tasks/reminders),
│   │   │                        records (notes/documents)
│   │   ├── core/                Settings, security (Argon2, tokens, password policy),
│   │   │                        CSRF, rate limiting, security headers, error handlers
│   │   ├── db/                  Declarative Base + mixins, engine/session
│   │   ├── models/              user.py, finance.py (categories, incomes, expenses),
│   │   │                        planning.py (budgets, bills, bill payments, savings goals),
│   │   │                        productivity.py (tasks, reminders), records.py (notes, documents)
│   │   ├── schemas/             Pydantic request/response models
│   │   ├── services/            Business logic: auth, email, dashboard, ledger, categories,
│   │   │                        budgets, bills, savings
│   │   └── main.py              App factory: CORS, middleware, routers
│   ├── alembic/                 Migrations 0001 baseline → 0002 auth → 0003 income/expenses
│   │                            → 0004 budgets/bills/savings → 0005 tasks/reminders
│   │                            → 0006 notes/documents
│   ├── tests/                   pytest suite
│   ├── alembic.ini
│   ├── Dockerfile
│   ├── requirements.txt
│   └── requirements-dev.txt
├── frontend/                    React + Vite SPA
│   ├── src/
│   │   ├── app/                 Providers and route table
│   │   ├── components/
│   │   │   ├── ui/              Reusable primitives (button, card, input, label, alert, sheet, dropdown…)
│   │   │   ├── forms/           Form field + password input (show/hide)
│   │   │   ├── layout/          Sidebar, top bar, mobile drawer, bottom nav, user menu
│   │   │   ├── common/          Page header, empty state, module placeholder
│   │   │   └── theme/           Light / dark / system theme
│   │   ├── config/navigation.ts Single source of truth for nav items
│   │   ├── features/auth/       Auth API, hooks, Zod schemas, route guards, auth layout
│   │   ├── features/dashboard/  Dashboard data hook, stat cards, panels, quick actions, charts
│   │   ├── features/finance/    Income/expense API, forms, filters, table, category manager
│   │   ├── features/planning/   Budgets, bills and savings API + constants
│   │   ├── features/productivity/ Tasks and reminders API + constants
│   │   ├── features/records/    Notes and documents API + constants
│   │   ├── components/charts/   Reusable Recharts components (lazy-loaded)
│   │   ├── features/system/     API health hook, status card, status indicator
│   │   ├── lib/                 API client (CSRF, 401 handling), query client, utils
│   │   ├── pages/               One page per module; pages/auth/ for sign-in flows
│   │   └── test/                Vitest tests
│   └── vite.config.ts
├── docker-compose.yml           PostgreSQL + backend + frontend (development)
├── .env.example                 Environment template (copy to .env)
└── README.md
```

## Environment setup

All configuration comes from environment variables. One `.env` file at the repository root is shared by Docker Compose, the backend and the frontend dev server.

```bash
cp .env.example .env
```

Then edit `.env`:

| Variable                | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `APP_SECRET_KEY`        | Application secret. Generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Must be 32+ chars in production. |
| `POSTGRES_USER/PASSWORD/DB` | Credentials Docker Compose uses to create the database.            |
| `POSTGRES_HOST_PORT`    | Host port the Compose DB is published on (localhost only). Change it if 5432 is taken. |
| `DATABASE_URL`          | Backend connection string when running **outside** Docker (`postgresql+psycopg://user:pass@host:port/db`). |
| `FRONTEND_URL`          | Allowed CORS origin (the SPA).                                           |
| `BACKEND_URL`           | Public URL of the API.                                                   |
| `VITE_API_PROXY_TARGET` | Where the Vite dev server proxies `/api` requests.                       |
| `APP_TIMEZONE`          | IANA timezone for "today" and month boundaries (default `Asia/Kathmandu`). |
| `REGISTRATION_ENABLED`  | Allow new sign-ups. **Set to `false` once your account exists.**        |
| `COOKIE_SECURE`         | Send cookies only over HTTPS. Must be `true` in production.              |
| `SESSION_IDLE_TIMEOUT_MINUTES` / `SESSION_LIFETIME_HOURS` / `SESSION_REMEMBER_ME_DAYS` | Session expiry. |
| `PASSWORD_RESET_TOKEN_MINUTES` | How long a reset link stays valid (default 30).                    |
| `EMAIL_BACKEND`, `SMTP_*`, `EMAIL_FROM` | Email delivery for password resets (see below).           |
| `RATE_LIMIT_ENABLED` / `TRUST_PROXY_HEADERS` | Rate limiting; only trust `X-Forwarded-For` behind your own proxy. |
| `DOCUMENT_STORAGE_DIR` / `DOCUMENT_MAX_BYTES` / `DOCUMENT_QUOTA_BYTES` | Private file storage location, per-file size limit, and per-user quota. |

`.env` is git-ignored. **Never commit real secrets.**

## Running with Docker (recommended)

You need Docker Desktop (or Docker Engine with the Compose plugin).

```bash
cp .env.example .env        # then edit the secrets
docker compose up --build
```

| Service  | URL                                  |
| -------- | ------------------------------------ |
| Frontend | http://localhost:5173                |
| API      | http://localhost:8000/api/health     |
| API docs | http://localhost:8000/api/docs (disabled in production) |
| Postgres | `localhost:${POSTGRES_HOST_PORT}` (bound to 127.0.0.1 only) |

When the backend container starts, it runs `alembic upgrade head` before launching the API. Source folders are bind-mounted, so code changes hot-reload.

Useful commands:

```bash
docker compose logs -f backend
docker compose exec backend pytest
docker compose exec backend alembic revision --autogenerate -m "describe change"
docker compose down            # stop
docker compose down -v         # stop AND delete the database volume
```

> On Windows, if hot reload doesn't pick up file changes inside Docker, run the frontend and backend locally instead (see below).

## Running locally (without Docker)

Requirements: Python 3.12+, Node.js 22.22+ (or 24), and a PostgreSQL 15+ server.

**1. Database.** Create a role and database that match `DATABASE_URL` in `.env`:

```sql
CREATE ROLE lifevault LOGIN PASSWORD 'your-password';
CREATE DATABASE lifevault OWNER lifevault;
```

**2. Backend**

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

**3. Frontend** (in a second terminal)

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173. The Vite dev server proxies `/api/*` to the backend, so the browser only ever talks to one origin.

## Development commands

| Where      | Command                     | What it does                          |
| ---------- | --------------------------- | ------------------------------------- |
| `backend`  | `uvicorn app.main:app --reload` | Run the API with auto-reload       |
| `backend`  | `alembic upgrade head`      | Apply migrations                      |
| `backend`  | `alembic revision --autogenerate -m "msg"` | Create a migration     |
| `frontend` | `npm run dev`               | Start the Vite dev server             |
| `frontend` | `npm run build`             | Type-check and build for production   |
| `frontend` | `npm run lint`              | ESLint                                |
| `frontend` | `npm run typecheck`         | TypeScript only                       |

## Testing

```bash
# Backend. Database tests use a separate "<db>_test" database (or TEST_DATABASE_URL).
# It is dropped and re-created on every run, migrated from empty to head, and downgraded
# to base at the end, so every run also proves the migrations work on a clean database.
# The database role needs CREATEDB (the Docker Compose superuser has it).
cd backend
pytest

# Frontend: routing, placeholder pages, API connectivity states, theme switching
cd frontend
npm test
```

Manual smoke test:

```bash
curl http://localhost:8000/api/health
# {"status":"ok","service":"LifeVault API","version":"0.1.0","environment":"development","database":"ok"}
```

If PostgreSQL is unreachable, the endpoint returns **HTTP 503** with `"database": "unavailable"`. The dashboard's *System status* card and the top-bar indicator show that state.

## API

| Method | Path                        | Auth | Description |
| ------ | --------------------------- | ---- | ----------- |
| GET    | `/api/health`               | –    | API liveness + database connectivity check |
| GET    | `/api/auth/csrf`            | –    | Issue/return the CSRF token (cookie + body) |
| GET    | `/api/auth/config`          | –    | `{registration_enabled, password_min_length}` |
| POST   | `/api/auth/register`        | –    | Create account and sign in (201; 409 duplicate email/username) |
| POST   | `/api/auth/login`           | –    | `{identifier, password, remember_me}`, where identifier is an email or username |
| POST   | `/api/auth/logout`          | –    | Revoke the current session and clear the cookie (204) |
| POST   | `/api/auth/forgot-password` | –    | Always 202 with the same message (no account enumeration) |
| POST   | `/api/auth/reset-password`  | –    | `{token, new_password, confirm_new_password}` (204) |
| GET    | `/api/auth/me`              | ✔    | Current user |
| GET    | `/api/dashboard/summary`    | ✔    | Everything the dashboard shows, scoped to the signed-in user (see below) |
| GET    | `/api/categories?kind=`     | ✔    | Built-in categories plus your custom ones (`kind` = `income` or `expense`) |
| POST   | `/api/categories`           | ✔    | Create a custom category `{kind, name}` (409 if the name exists) |
| PATCH  | `/api/categories/{id}`      | ✔    | Rename a custom category (built-ins: 403) |
| DELETE | `/api/categories/{id}`      | ✔    | Delete an unused custom category (409 if records use it) |
| GET    | `/api/incomes`, `/api/expenses` | ✔ | List with `search`, `category_id`, `payment_method`, `date_from`, `date_to`, `is_recurring`, `min_amount`, `max_amount`, `sort`, `page`, `page_size`. Returns `{items, total_count, total_amount, currency, page, page_size}`, where `total_amount` sums **all** matches, not just the page |
| POST   | `/api/incomes`, `/api/expenses` | ✔ | Create (201) |
| GET / PUT / DELETE | `/api/incomes/{id}`, `/api/expenses/{id}` | ✔ | Read, replace, or delete one record (404 if it isn't yours) |
| GET    | `/api/incomes/summary?year=`, `/api/expenses/summary?year=` | ✔ | Year total, the current month's total, 12 monthly totals, and totals by category |
| GET    | `/api/budgets?month=YYYY-MM` | ✔ | The month's budgets with spent, remaining, percentage used and status, plus totals and spending outside any budget |
| POST   | `/api/budgets`              | ✔ | `{category_id, month, amount, warning_threshold}` (409 if the category already has a budget that month) |
| PUT / DELETE | `/api/budgets/{id}`   | ✔ | Change the amount or threshold, or delete |
| POST   | `/api/budgets/copy`         | ✔ | `{from_month, to_month}`: copies budgets, skipping categories already set up |
| GET    | `/api/bills?status=&category=` | ✔ | Bills (overdue first), with overdue and due-soon counts and totals, and the amount paid this month |
| POST   | `/api/bills`                | ✔ | Create a bill |
| GET / PUT / DELETE | `/api/bills/{id}` | ✔ | Read, replace, or delete one bill |
| POST   | `/api/bills/{id}/pay`       | ✔ | `{paid_on, amount?, record_expense, payment_method}`. Logs the payment; recurring bills move to the next due date |
| GET    | `/api/bills/{id}/payments`  | ✔ | Payment history |
| GET / POST | `/api/savings-goals`    | ✔ | Goals with progress and totals, or create a goal |
| GET / PUT / DELETE | `/api/savings-goals/{id}` | ✔ | Read, update, or delete a goal (changing the balance logs an adjustment) |
| GET / POST | `/api/savings-goals/{id}/contributions` | ✔ | History, or `{kind: deposit or withdrawal, amount, date, note}` |
| GET    | `/api/tasks?view=&status=&priority=&category=&search=` | ✔ | `view` is today, upcoming, overdue, completed or all. Returns the items plus counts for every view |
| GET    | `/api/tasks/pending`        | ✔ | “You haven't worked on these tasks”: *Not started* tasks, split into overdue, due soon (3 days) and the rest |
| GET    | `/api/tasks/categories`     | ✔ | Categories you've used |
| POST   | `/api/tasks`                | ✔ | Create a task |
| GET / PUT / DELETE | `/api/tasks/{id}`  | ✔ | Read, replace, or delete one task |
| PATCH  | `/api/tasks/{id}/status`    | ✔ | `{status}`. Completing a recurring task creates its next occurrence |
| GET    | `/api/reminders?view=`      | ✔ | `view` is due, upcoming, completed or all. Returns the items plus counts |
| POST   | `/api/reminders`            | ✔ | `{title, notes, remind_at (ISO with timezone), repeat, interval_count, interval_unit}` |
| GET / PUT / DELETE | `/api/reminders/{id}` | ✔ | Read, replace (which reactivates it and clears any snooze), or delete |
| POST   | `/api/reminders/{id}/snooze` | ✔ | `{minutes}` or `{until}` |
| POST   | `/api/reminders/{id}/complete` | ✔ | One-time reminders become completed; repeating ones move to the next occurrence |
| GET    | `/api/notes?view=&search=&category=&tag=` | ✔ | `view` is active, archived or all. Pinned notes come first; the response includes counts |
| GET    | `/api/notes/tags`           | ✔ | Tags on your active notes, with counts |
| POST   | `/api/notes`                | ✔ | `{title, content, category, tags, is_pinned, is_archived}` |
| GET / PUT / DELETE | `/api/notes/{id}` | ✔ | Read, replace, or delete one note |
| PATCH  | `/api/notes/{id}`           | ✔ | `{is_pinned?, is_archived?}` (archiving unpins) |
| GET    | `/api/documents?search=&category=&file_kind=&date_from=&date_to=&sort=` | ✔ | Metadata, plus storage used, quota, size limit and allowed file types |
| POST   | `/api/documents`            | ✔ | `multipart/form-data`: `file`, `category`, optional `title`, `description`, `document_date` |
| GET / PUT / DELETE | `/api/documents/{id}` | ✔ | Read metadata, edit metadata, or delete (the file is removed from storage) |
| GET    | `/api/documents/{id}/download?inline=` | ✔ | Download (owner only). `inline=true` works for PDFs and images only |
| POST   | `/api/auth/change-password` | ✔    | Change password, sign out other devices |

Every `POST` needs the `X-CSRF-Token` header (see below). Validation errors return `422 {"detail", "errors": [{loc, msg, type}]}` and never echo the submitted values back.

## Income & expenses

- **Record fields:** amount, date, category, payment method (cash, bank transfer, card, mobile wallet such as eSewa or Khalti, cheque, other), recurring plus how often (weekly, monthly, quarterly, yearly), description and notes. Income also has a **source**.
- **Built-in categories:**
  - *Income:* Salary, Freelance, Business, Allowance, Investment, Gift, Other.
  - *Expenses:* Rent, Food, Groceries, Electricity, Water, Internet/Wi-Fi, Mobile, Transportation, Fuel, Education, Medical, Shopping, Clothing, Entertainment, Subscription, Travel, Family, Personal Care, Household, Loan Payment, Insurance, Other.
  - *Custom categories* are private to each user. Built-ins can't be renamed or deleted, and a category in use can't be deleted.
- **Money rules:**
  - Amounts are stored as `NUMERIC(14,2)` and sent as strings (`"1250.50"`), with at most 2 decimal places and always greater than 0.
  - Totals are computed by PostgreSQL `SUM()`. Neither the server nor the browser uses floating-point numbers for money; the Finance page's net figure is computed with integer cents.
  - Each record has a currency. Only NPR is accepted for now (`supported_currencies` in settings).
- **Recurring** records are only labelled for now. Automatically creating the next occurrence belongs to Phase 11 (automation).
- **Pages:** Income, Expenses (with a category manager) and a Finance overview for the year. Filters are stored in the URL. There's a table on desktop and cards on phones, and deleting always asks for confirmation.
- **Dashboard:**
  - *Monthly income and expenses* cover the current month in `APP_TIMEZONE`.
  - *Current balance* is all income minus all expenses dated up to today; future-dated records don't count yet.
  - *Charts:* the last 6 months of income vs expenses, this month's expenses by category, and monthly spending.

## Budgets, bills & savings

- **Budgets** are per expense category, per month. *Spent* always comes from your real expenses in that month.
  - Each budget reports *remaining* (negative when over), *percent used* (one decimal) and a status: **on track**, **near limit** once spending reaches the warning threshold (1–100%, default 80%), or **over budget**.
  - The threshold check uses exact arithmetic, so 799.99 of 1000 isn't flagged at 80% just because it rounds to "80.0%".
  - "Copy from last month" duplicates last month's budgets without overwriting ones you've already set.
- **Bills**
  - *Categories:* Room rent, Wi-Fi, Electricity, Water, Mobile, Subscription, Insurance, Loan, Other.
  - *Frequencies:* one-time, weekly, monthly, quarterly, yearly.
  - *Status:* **Pending** and **Paid** are stored, while **Overdue** is always worked out (pending and past its due date), so it can't go stale.
  - *Paying a bill:* marking it paid logs a payment. A one-time bill becomes Paid; a recurring bill moves to its next due date. A bill due on the 31st returns to the 31st after shorter months.
  - *Recording the expense:* you can also record the payment as an expense in the matching category (for example Wi-Fi → Internet/Wi-Fi, Loan → Loan Payment).
  - *Deleting:* a bill deletes its payment history, but expenses already recorded from it are kept.
- **Savings goals** track a target amount, current amount, optional target date and description.
  - Deposits, withdrawals and balance edits are all logged, so the current amount always equals the logged history. That same history draws the dashboard's savings-over-time chart.
  - You can't withdraw more than the balance.
  - Progress shows the percentage saved and the amount left. With a target date, it also shows how much to save per month, rounded **up** to the cent so paying it actually reaches the goal.
- **Dashboard:** *Budget remaining* covers this month's budgets, and *Savings* is the total across your goals. Both say "not set up yet" instead of showing 0 when you have no budgets or goals. The bills panel lists overdue bills and those due in the next 30 days, and the savings chart shows the last 6 months.
- **Debts** isn't in any scheduled phase yet, so its page stays a placeholder. Loan repayments can be tracked as *Loan* bills in the meantime.

## Tasks & reminders

- **Task fields:** title, description, category (free text with suggestions), priority (Low, Medium, High, Urgent), status (Not started, In progress, Completed, Cancelled), due date, due time, recurring (daily, weekly, monthly or yearly), created date, and completed date (set automatically on completion and cleared when a task is reopened).
- **Views:** *Today* (open tasks due today), *Upcoming* (due later), *Overdue*, *Completed* and *All*, each with a count. You can also filter by priority, category, status and text search.
- **Overdue is derived, never stored.** An open task is overdue once its due date has passed, or once its due time has passed on the due date, in `APP_TIMEZONE`. A task with no due time is due by the end of that day. Completed and cancelled tasks are never overdue.
- **“You haven't worked on these tasks”** is based **only on the stored status**: tasks still *Not started*, grouped into overdue, due within 3 days, and the rest. Nothing is inferred from your activity.
- **Recurring tasks:** completing one records the completion and creates the next occurrence, with the same details and the next due date.
  - Missed occurrences are skipped, so you never get a pile of past-due copies.
  - A task due on the 31st returns to the 31st after shorter months.
  - Reopening and completing again doesn't create a duplicate.
- **Reminders** can be one-time, daily, weekly, monthly, yearly, or custom (“every N days/weeks/months/years”).
  - *Times:* reminder times are stored in UTC and repeat on the local wall clock, so a 9:00 reminder stays at 9:00. The API rejects times without a timezone offset.
  - *Snoozing* (10 minutes, 1 hour, 3 hours, or tomorrow at 9:00) delays when a reminder fires.
  - *Completing* finishes a one-time reminder, or moves a repeating one to its next future occurrence.
  - *Editing* reactivates a reminder and clears any snooze.
- **Delivery:** in this phase, reminders appear as **Due now** inside LifeVault (the page refreshes every minute). Push, email and browser notifications are Phase 11.
- **Dashboard:**
  - *Tasks:* Today, Not started (excluding overdue) and Overdue, with full counts.
  - *Reminders:* due and upcoming reminders.
  - *Quick actions:* all five open the real “add” forms.

## Notes & documents

- **Notes:** title, plain-text content, category (Personal, Work, Education, Finance, Ideas, Important, Other), up to 20 tags, pin and archive.
  - Search covers the title, content and tags; you can also filter by category or tag.
  - Content is stored and shown **as plain text** (never rendered as HTML), so pasted markup can't run.
  - Tags are normalised: lower-case, with `#` and extra spaces removed.
- **Documents:** title, category, description, date and the file itself. You can upload, view metadata, edit details, download, delete, search, and filter by category, file type or date.
- **Upload validation:**
  - *Allowed types:* only an allowlist, **identified from the file's bytes**, not its name or the type the browser sends: PDF, PNG, JPEG, WebP, TXT, CSV, DOCX and XLSX. The extension must also match the contents.
  - *Refused:* SVG and HTML (they can carry scripts), executables, Office files with macros, and empty files.
  - *Size and quota:* files over `DOCUMENT_MAX_BYTES` (default 10 MB) are refused **before the upload is read**, based on `Content-Length`, and checked again while reading. Each user also has a storage quota, `DOCUMENT_QUOTA_BYTES` (default 1 GB).
  - *Filenames:* cleaned (no paths or control characters; Nepali and other scripts are kept) and used only for the download name.
- **Storage:** files are saved under `DOCUMENT_STORAGE_DIR` (default `backend/var/documents/`, git-ignored) at `<user id>/<random name>`. No part of the path comes from you, the folder is **outside any web-served directory**, and writes are atomic.
  - Files are only reachable through the API, which checks the owner on every request; anyone else gets `404`.
  - Downloads are sent as attachments with `Cache-Control: private, no-store` and `nosniff`.
  - Inline viewing is limited to PDFs and images. Images are served inside a CSP `sandbox`; PDFs get a locked-down CSP.
  - Deleting a document removes the file from disk.
  - Stored files aren't encrypted at rest yet. Keep the storage folder on an encrypted disk, and back it up together with the database.

## Dashboard

`GET /api/dashboard/summary` returns one payload with these sections: `finance` (monthly income, expenses, balance, savings, budget remaining), `tasks` (today, pending, overdue), `bills` (upcoming, overdue), `reminders` (upcoming) and `charts` (income vs expenses, expense categories, monthly spending, savings). It also returns the current `period`.

- Each section has `available` and `available_from_phase`. Until a module exists, its values are `null` or empty lists, and the UI shows an empty state that says which phase adds it. No placeholder numbers are ever sent or shown.
- **Money** is a Decimal on the server and a string in JSON (`{"amount": "1234.50", "currency": "NPR"}`), so no precision is lost. The UI formats NPR with South Asian grouping (`NPR 12,34,567.50`).
- **"Today" and month boundaries** use `APP_TIMEZONE` (default `Asia/Kathmandu`), not the server's clock zone.
- Later phases fill a section by replacing its builder in `backend/app/services/dashboard.py` with real queries filtered by `user.id`. The response shape stays the same.
- Reusable chart components live in `frontend/src/components/charts/` (`IncomeExpenseChart`, `ExpenseCategoryChart`, `MonthlySpendingChart`, `SavingsChart`, `ChartCard`). Each includes a screen-reader data table.
- **Quick actions** (Add income, expense, task, reminder, bill) open a "Coming in Phase N" dialog until their forms exist. Nothing pretends to save.

## Authentication design

- **Passwords** are hashed with **Argon2id** (argon2-cffi defaults, RFC 9106) and transparently re-hashed on login if the parameters change. Plaintext passwords are never stored or logged. Request models use `SecretStr` so they're masked in reprs and tracebacks.
- **Password policy:** 12–128 characters, at least three of lowercase, uppercase, numbers and symbols, not a common password, and not containing your name, username or email. It's enforced on the server and mirrored in the UI.
- **Sessions are server-side.** Login creates a random 256-bit token sent in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `COOKIE_SECURE=true`). The database stores only an HMAC-SHA256 of the token, keyed with `APP_SECRET_KEY`. That makes logout, "sign out other devices" and password resets real revocations.
- **Expiry:** sessions end after `SESSION_IDLE_TIMEOUT_MINUTES` of inactivity (default 8 h) or `SESSION_LIFETIME_HOURS` in total (default 12 h). With "Keep me signed in", the session and cookie last `SESSION_REMEMBER_ME_DAYS` (default 30).
- **CSRF:** double-submit token. `GET /api/auth/csrf` sets a readable `lv_csrf` cookie, and every state-changing `/api` request must echo it in `X-CSRF-Token`. The token rotates on login and logout (the new value is returned in the `X-CSRF-Token` response header).
- **Authorization:** protected endpoints depend on `CurrentUser`. Routers from later phases attach to `protected_router` in `app/api/router.py`, which requires an active, signed-in user for every route. Disabled accounts lose access immediately.
- **Rate limiting** (in-memory, per process):

  | Endpoint | Limits |
  | --- | --- |
  | login | 5/min per IP+account, 20/15 min per IP |
  | register | 5/h per IP |
  | forgot password | 5/h per IP, 3/h per email |
  | reset password | 10/h per IP |
  | change password | 5/15 min per user |

  Exceeding a limit returns `429` with `Retry-After`. If you ever run multiple workers or replicas, move the limiter to Redis.
- **No account enumeration:** failed logins always say *"Invalid email/username or password."* (unknown user, wrong password or disabled account), and unknown users still pay the full hashing cost. Forgot-password always returns the same response, and emails go out in the background.
- **Registration** is meant for creating your own account. Set `REGISTRATION_ENABLED=false` afterwards.

### Password reset

1. `POST /api/auth/forgot-password` creates a random single-use token that expires after 30 minutes. Only its HMAC is stored, and requesting a new link invalidates older ones.
2. The email link is `FRONTEND_URL/reset-password#token=…`. The token sits in the URL **fragment**, which browsers never send to servers, so it can't leak into access logs or `Referer` headers. The page strips it from the address bar straight away.
3. A successful reset changes the password and **signs out every session**.

**Development (`EMAIL_BACKEND=dev_outbox`):** emails are written as `.eml` files to `backend/var/dev-outbox/`, which is git-ignored. Open the newest file and copy the link. Settings validation refuses this backend in production.

**Production (`EMAIL_BACKEND=smtp`):** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `EMAIL_FROM`. Any SMTP relay or transactional email provider works (SES, Postmark, Mailgun, Gmail with an app password…). The integration point is `send_email()` in `backend/app/services/email.py`. To use a provider's HTTP API instead, add a backend there.

## Security baseline

- All configuration and secrets come from environment variables. `.env` and key/cert files are git-ignored.
- The app refuses to start in production with a weak or placeholder `APP_SECRET_KEY`, with `DEBUG=true`, with `COOKIE_SECURE=false`, or with the dev email outbox.
- CORS is restricted to `FRONTEND_URL` (plus optional `CORS_EXTRA_ORIGINS`).
- Every API response sets security headers: `nosniff`, `X-Frame-Options: DENY`, a strict CSP, Referrer-Policy and Permissions-Policy.
- Interactive API docs are disabled in production.
- Docker publishes ports on `127.0.0.1` only, and the backend container runs as a non-root user.
- All database access goes through SQLAlchemy with bound parameters. There's no string-built SQL.

- Unhandled errors return a generic `500` to the client. Details stay in the server log, and request bodies are never logged.
- Authentication, CSRF protection and rate limiting are covered above. Vault encryption and upload hardening come in their own phases. This is a personal project, and no application is perfectly secure.

## Roadmap

| Phase | Scope                                      |
| ----- | ------------------------------------------ |
| 1     | Project foundation ✅                      |
| 2     | Authentication ✅                          |
| 3     | Dashboard ✅                               |
| 4     | Income and expenses ✅                     |
| 5     | Budget, bills, rent and savings ✅         |
| 6     | Tasks and reminders ✅                     |
| 7     | Secure password vault                      |
| 8     | Notes and documents ✅                     |
| 9     | Calendar                                   |
| 10    | Reports and analytics                      |
| 11    | Notifications and automation               |
| 12    | Settings, security audit and production    |
