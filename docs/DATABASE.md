# PIPFLOW Neon PostgreSQL Database Schema

All core relational tables reside in `database/schema.sql`:

1. **`roles`**: Defines `trader` and `admin` RBAC roles.
2. **`users`**: Stores user credentials (bcrypt hashes), verification/reset tokens, preferred/local currencies, and `virtual_workspace_balance`.
3. **`connected_accounts`**: Stores read-only Deriv account metadata (`deriv_login_id`, `account_type` `demo` | `real`, `currency`, `last_known_balance`, `landing_company`, `connection_status`).
4. **`account_authorizations`**: Stores AES-256-GCM encrypted read-only Deriv tokens (`encrypted_token`, `token_iv`, `token_auth_tag`, `granted_scopes`, `owner_consented_at`, `revoked_at`). Never exposed to frontend or admins.
5. **`market_instruments`**: Cached active Deriv instruments (`symbol`, `display_name`, `market`, `submarket`, `pip_size`).
6. **`market_data_cache`**: Cached OHLC candle bars indexed by `(symbol, granularity, epoch DESC)`.
7. **`watchlists`**: User-pinned trading instruments.
8. **`notifications`**: In-app security, connection, trade simulation, and admin announcements.
9. **`email_logs`**: Audit log of every transactional email sent via Brevo (`messageId`, `status`, `error_message`).
10. **`application_settings`**: JSONB settings including `branding`, `global_settings`, and secret `bot_analyser_password_hash`.
11. **`administrator_audit_logs`**: Immutable trail of administrator actions with IP address and metadata.
12. **Supporting Tables**: `virtual_orders` (MT5 TP/SL virtual ledger), `bot_strategies` (database-backed strategy catalog), `security_logs` (auth & security events).
