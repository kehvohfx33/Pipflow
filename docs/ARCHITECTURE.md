# Pipflowtrade.site System Architecture

## 1. Market Layer (Official Deriv WebSocket API)
- Connects to `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`.
- Manages automatic exponential-backoff reconnection and 30-second keepalive pings (`{ "ping": 1 }`) inside `apps/api/src/integrations/deriv/websocket.ts`.
- Public endpoints (`active_symbols`, `ticks_history`, `ticks`) stream live market instruments, historical OHLC candles, and real-time ticks across SmartCharts (`@deriv-com/smartcharts-champion`) and MT5 candlestick charts (`lightweight-charts`).
- Account endpoints (`authorize`, `balance`, `statement`, `buy`, `sell`, `proposal`, `proposal_open_contract`) execute strictly with explicit owner consent and encrypted tokens.

## 2. Application Layer (Node.js, Express, WebSockets, PostgreSQL)
- **Unified Deriv Modules**: Integrates Deriv Bot Builder (`apps/deriv-bot`), Accumulators (`apps/deriv-accumulators`), Digits (`apps/deriv-digits`), and Rise / Fall (`apps/deriv-rise-fall`) into one branded SPA with shared routing, shared session state, and shared database context.
- **Session & CSRF Protection**: User and administrative sessions use `HttpOnly` `pf_session` cookies paired with CSRF double-submit header validation (`pf_csrf` / `X-CSRF-Token`), WebSocket cookie authentication, server-side `token_version` session revocation, and strict resource ownership checks.
- **Synchronized Balance Management**: `connected_accounts.last_known_balance` strictly stores the actual Deriv broker-reported balance and is never overwritten by owner adjustments. Platform-side adjustments are stored separately (`platform_adjustment_balance`) and recorded in an immutable, idempotent ledger (`balance_adjustments`) after completing the mandatory 8-step live Deriv synchronization flow.
- **Token Security**: Authorized Deriv tokens are encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) and are never exposed to the frontend or logs.

## 3. Private Owner & Administration Layer (`OWNER` / `ADMIN` / `USER`)
- Three-tier RBAC (`owner`, `admin`, `user`, plus legacy `trader` compatibility).
- **OWNER** has exclusive authority over platform-wide settings, user role assignments, partner commission config, and the 8-step synchronized balance adjustment & virtual adjustment workflows.
- Both the 20-tap logo interaction and `ADMIN_PRIVATE_SLUG` (`/ops/:slug`) strictly reveal the login/bootstrap UI entry and never grant privileges or expose administrative configuration to unauthenticated or ordinary user clients.
- All privileged operations are logged in `administrator_audit_logs` and `security_logs`.
