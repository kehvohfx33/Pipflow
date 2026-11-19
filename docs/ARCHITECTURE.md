# PIPFLOW System Architecture

## 1. Market Layer (Official Deriv WebSocket API)
- Connects to `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`.
- Manages automatic exponential-backoff reconnection and 30-second keepalive pings (`{ "ping": 1 }`) inside `apps/api/src/integrations/deriv/websocket.ts`.
- Public endpoints (`active_symbols`, `ticks_history`, `ticks`) stream live market instruments, historical OHLC candles, and real-time ticks without requiring user credentials.
- Read-only account endpoints (`authorize`, `balance`, `statement`, `profit_table`) run exclusively with explicit owner authorization (`read` scope only).

## 2. Application Layer (Node.js, Express, WebSockets, Neon PostgreSQL)
- **Virtual MT5 Terminal & Bot Engine**: Evaluates live Deriv ticks against open virtual orders (`virtual_orders`) to trigger Take Profit (`CLOSED_TP`) and Stop Loss (`CLOSED_SL`) automatically in Neon PostgreSQL. Real-money Deriv trade execution is intentionally disabled to maintain strict read-only non-custodial compliance.
- **Database Password Gate**: Market Analyser and Trading Bot endpoints require a valid `x-bot-gate-token` issued after verifying a password against the bcrypt hash stored in `application_settings.bot_analyser_password_hash`.
- **Token Security**: Owner-authorized read-only Deriv tokens are encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) and are never returned to the frontend, logged, or exposed to administrators.

## 3. Administration Layer
- Accessible via **10 consecutive clicks** on the `pipflow.site` logo OR via the private administrator URL (`/#/admin-${VITE_ADMIN_PRIVATE_SLUG}`).
- Protected by server-side JWT + database `admin` role verification.
- Logs all administrative actions (branding updates, global settings, virtual balance adjustments, bot password updates, announcements) in `administrator_audit_logs`.
