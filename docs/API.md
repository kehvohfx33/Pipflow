# Pipflowtrade.site API & Security Documentation

## Authentication, Sessions & CSRF
- Sessions are delivered via `HttpOnly` cookie `pf_session` paired with `pf_csrf` cookie + `X-CSRF-Token` double-submit validation on state-changing routes.
- `POST /api/auth/register` — Registers a `user` account, sets session cookies, sends Brevo welcome verification email.
- `POST /api/auth/login` — Authenticates user, refreshes Deriv balances cleanly, issues session cookies.
- `POST /api/auth/logout` — Clears session cookies cleanly.
- `POST /api/auth/revoke-sessions` — Increments `token_version` to revoke all active sessions everywhere and clears cookies.
- `GET /api/auth/me` — Returns current authenticated user profile from database + cookie verification.
- `GET /api/auth/console-entry?slug=...` — Server-side constant-time validation of `ADMIN_PRIVATE_SLUG` to reveal console login entry only (grants zero privileges).
- `POST /api/bot-gate/unlock` — Verifies Market Analyser & Trading Bot password against DB hash; issues short-lived `x-bot-gate-token`.

## Official Deriv Integration
- `GET /api/deriv/oauth-url/public` / `GET /api/deriv/oauth-url` — Generates Official Deriv OAuth2 PKCE authorization URLs.
- `GET /api/deriv/oauth/callback` — Exchanges OAuth2 code, syncs Deriv accounts into `connected_accounts` & `account_authorizations`, and issues `HttpOnly` session cookies (no JWTs in query/hash URLs).
- `POST /api/deriv/connect` — Connects user-authorized Deriv token (`read` / `trade`), AES-256-GCM encrypted at rest.
- `GET /api/deriv/accounts` — Returns connected accounts including `last_known_balance` (Actual Deriv Balance), `platform_adjustment_balance`, `exact_broker_balance_only`, and computed `displayed_balance`.
- `GET /api/deriv/adjustments` — Read-only list of platform-side adjustments applied to the authenticated user's accounts.
- `POST /api/deriv/accounts/:id/sync` — Refreshes real-time broker balance from Deriv without touching platform-side adjustments.

## Market Data, Bots & Orders
- `GET /api/market/instruments`, `/api/market/candles`, `/api/market/digit-analysis`, `/api/market/external-feed`, `/api/market/ai-analysis`, `/api/market/signals`
- `GET/POST/DELETE /api/bots/workspaces`, `POST /api/bots/run|pause|resume|stop|emergency-stop|close-all`, `GET /api/bots/runs`
- `GET/POST /api/orders`, `POST /api/orders/bulk`, `POST /api/orders/bulk-close`, `POST /api/orders/:id/close`
- `POST /api/deriv/proposal`, `GET /api/deriv/contracts-for`, `GET /api/deriv/open-contract/:contractId`

## Private Console Endpoints (`ADMIN` & `OWNER`)
- `GET /api/admin/bootstrap-status`, `POST /api/admin/bootstrap` (creates sole initial `OWNER`), `POST /api/admin/login` (`OWNER` or `ADMIN`).
- **ADMIN & OWNER operational endpoints**:
  - `GET /api/admin/overview` (owner-sensitive config omitted for non-owner admins)
  - `PATCH /api/admin/users/:id/status`, `POST /api/admin/users/:id/revoke-sessions`, `PATCH /api/admin/users/:id`
  - `POST /api/admin/connected-accounts/:id/sync|disconnect|revoke`, `POST /api/admin/connected-accounts/connect`
  - `POST/PATCH/DELETE /api/admin/strategies`, `POST /api/admin/orders/:id/close`, `POST /api/admin/orders/close-all`, `DELETE /api/admin/orders/:id`, `POST/DELETE /api/admin/announcements`
- **OWNER-Exclusive Endpoints (`requireOwner`)**:
  - `PUT /api/admin/settings/admin-credentials|bot-password|branding|global|site-controls`
  - `PATCH /api/admin/users/:id/role`, `POST /api/admin/users`, `DELETE /api/admin/users/:id`, `DELETE /api/admin/connected-accounts/:id`
  - `GET /api/admin/commissions`, `GET /api/admin/commissions/oauth-url`, `PUT /api/admin/commissions/config`
  - **8-Step Synchronized Balance Management (`/api/owner/*`)**:
    - `POST /api/owner/accounts/:id/sync-for-adjustment` — Fetches live Deriv broker balance, verifies currency, records `last_synced_at`, issues signed 5-minute `syncProofToken`.
    - `POST /api/owner/accounts/:id/adjustments` — Verifies `syncProofToken` + `idempotencyKey`, adjusts `platform_adjustment_balance` inside `BEGIN ... FOR UPDATE ... COMMIT`, inserts immutable `balance_adjustments` ledger row. Never overwrites `last_known_balance`.
    - `POST /api/owner/accounts/:id/exact-mode` — Toggles `exact_broker_balance_only` (strictly matching displayed REAL balance to synchronized broker balance without overlay).
    - `POST /api/owner/users/:id/virtual-adjustments` — Transaction-safe virtual workspace balance adjustment recorded in `balance_adjustments`.
    - `GET /api/owner/balance-adjustments` — Full immutable adjustment ledger query.
