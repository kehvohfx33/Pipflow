# Pipflowtrade.site PostgreSQL Database Schema

All core relational tables reside in `database/schema.sql` and incremental migrations in `database/migrations/`:

1. **`roles`**: Defines `owner` (id `3`), `admin` (id `2`), `user` (id `4`), and legacy `trader` (id `1`).
2. **`users`**: Stores user credentials (`bcryptjs`), verification/reset tokens, `token_version` (for instant session revocation), preferred/local currencies, and `virtual_workspace_balance` (strictly for the local virtual practice workspace).
3. **`connected_accounts`**: Stores synchronized Deriv account metadata (`deriv_login_id`, `account_type` `demo` | `real`, `currency`, `last_known_balance` = actual Deriv broker balance, `platform_adjustment_balance`, `exact_broker_balance_only`, `landing_company`, `connection_status`, `last_synced_at`).
4. **`balance_adjustments`**: Immutable, append-only ledger (protected by a PostgreSQL trigger rejecting `UPDATE`/`DELETE`) storing every Owner platform-side adjustment with `idempotency_key`, `account_scope` (`virtual` | `demo` | `real`), `owner_user_id`, `broker_balance_at_sync`, `currency`, `sync_timestamp`, `adjustment_delta`, `previous_adjustment_total`, `new_adjustment_total`, `resulting_displayed_balance`, `reason`, and `note`.
5. **`account_authorizations`**: Stores AES-256-GCM encrypted Deriv tokens (`encrypted_token`, `token_iv`, `token_auth_tag`, `granted_scopes`, `owner_consented_at`, `revoked_at`). Never exposed to frontend clients.
6. **`market_instruments` & `market_data_cache`**: Cached Deriv symbols and OHLC candle bars.
7. **`watchlists` & `notifications` & `email_logs`**: User watchlists, notifications, and Brevo transactional email audit records.
8. **`application_settings`**: JSONB settings including `branding`, `global_settings`, `site_controls`, and secret keys (`admin_credentials`, `bot_analyser_password_hash`, `deriv_commission_config`).
9. **`administrator_audit_logs` & `security_logs`**: Audit trails for owner/admin mutations and authentication events.
10. **`virtual_orders`, `bot_strategies`, `bot_workspaces`, `bot_runs`**: Unified trading positions and automated bot session logs.
