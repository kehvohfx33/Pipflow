# PIPFLOW API & Permission Flow Documentation

## Authentication & Authorization
- `POST /api/auth/register` — Registers trader account, sends Brevo welcome & verification email.
- `POST /api/auth/login` — Issues JWT session token.
- `GET /api/auth/verify-email?token=...` — Marks email verified.
- `POST /api/auth/forgot-password` / `POST /api/auth/reset-password` — Brevo password recovery flow.
- `POST /api/bot-gate/unlock` — Verifies Market Analyser & Trading Bot password against Neon DB hash; issues short-lived `x-bot-gate-token`.

## Official Deriv Read-Only Integration
- `GET /api/deriv/oauth-url` — Generates Official Deriv OAuth2 authorization URL (`read` scope).
- `GET /api/deriv/oauth/callback` — Receives Deriv OAuth redirect tokens (`acct1`, `token1`, ...), verifies read-only account metadata via `authorize`, encrypts token with AES-256-GCM, and redirects to frontend.
- `POST /api/deriv/connect` — Requires `{ apiToken, ownerConsent: true }`; verifies via Deriv `authorize`, stores read-only metadata in `connected_accounts` and encrypted token in `account_authorizations`.
- `GET /api/deriv/accounts` — Lists connected Deriv accounts (`demo` vs `real`, status, balance) without exposing tokens.
- `POST /api/deriv/accounts/:id/sync` — Refreshes live read-only balance from Deriv API.
- `POST /api/deriv/accounts/:id/disconnect` & `POST /api/deriv/accounts/:id/revoke` — Disconnects or revokes authorization.
- `GET /api/deriv/statement/:accountId` — Fetches read-only Deriv statement transactions.

## Market Data & Virtual MT5 / Bot Endpoints
- `GET /api/market/instruments` — Active Deriv market instruments.
- `GET /api/market/candles?symbol=R_25&granularity=60` — Historical + cached OHLC candles.
- `GET /api/market/digit-analysis?symbol=R_100&count=1000` — *(Requires `x-bot-gate-token`)* Live tick digit frequency & Even/Odd distribution.
- `GET /api/bots/strategies` / `POST /api/bots/run` / `POST /api/bots/stop` — *(Requires `x-bot-gate-token`)* Database-backed bot runner using live Deriv ticks.
- `GET /api/orders` / `POST /api/orders` / `POST /api/orders/:id/close` — MT5 virtual orders with live TP/SL monitoring.
- `GET /api/watchlists` / `POST /api/watchlists` / `DELETE /api/watchlists/:symbol` — User watchlist management.

## Administrator Endpoints (`role === 'admin'`)
- `GET /api/admin/overview` — Users, read-only connected accounts, Deriv WS diagnostics, security logs, audit logs, email logs.
- `PATCH /api/admin/users/:id/virtual-balance` — Edits local virtual workspace balance (audited).
- `PATCH /api/admin/users/:id/status` — Activates or suspends user account.
- `PUT /api/admin/settings/bot-password` — Updates Market Analyser & Bot DB password hash.
- `PUT /api/admin/settings/branding` & `PUT /api/admin/settings/global` — Updates branding & global config.
- `POST /api/admin/announcements` — Broadcasts notification & optional Brevo email.
