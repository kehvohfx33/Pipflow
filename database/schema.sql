CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. roles
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(150),
  role_id INTEGER NOT NULL REFERENCES roles(id),
  is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verification_token TEXT,
  password_reset_token TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  virtual_workspace_balance NUMERIC(18, 2) NOT NULL DEFAULT 10000.00,
  preferred_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  local_currency VARCHAR(10) NOT NULL DEFAULT 'KES',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  token_version INTEGER NOT NULL DEFAULT 1,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);

-- 3. connected_accounts (Deriv account metadata; never stores passwords)
CREATE TABLE IF NOT EXISTS connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deriv_login_id VARCHAR(64) NOT NULL,
  account_type VARCHAR(16) NOT NULL CHECK (account_type IN ('demo', 'real')),
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  last_known_balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  balance_locked_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
  landing_company VARCHAR(64),
  connection_status VARCHAR(32) NOT NULL DEFAULT 'connected'
    CHECK (connection_status IN ('connected', 'disconnected', 'revoked', 'error')),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, deriv_login_id)
);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_user ON connected_accounts(user_id, is_primary DESC);

-- 4. account_authorizations (AES-256-GCM encrypted Deriv token; never exposed to frontend)
CREATE TABLE IF NOT EXISTS account_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_auth_tag TEXT NOT NULL,
  granted_scopes TEXT[] NOT NULL DEFAULT ARRAY['read'],
  owner_consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_auth_active
  ON account_authorizations(connected_account_id, user_id, created_at DESC)
  WHERE revoked_at IS NULL;

-- 5. market_instruments
CREATE TABLE IF NOT EXISTS market_instruments (
  symbol VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(150) NOT NULL,
  market VARCHAR(64) NOT NULL,
  submarket VARCHAR(64),
  pip_size NUMERIC(12, 8) NOT NULL DEFAULT 0.01,
  is_trading_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  exchange_is_open BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. market_data_cache
CREATE TABLE IF NOT EXISTS market_data_cache (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(64) NOT NULL REFERENCES market_instruments(symbol) ON DELETE CASCADE,
  granularity INTEGER NOT NULL,
  epoch BIGINT NOT NULL,
  open_price NUMERIC(18, 8) NOT NULL,
  high_price NUMERIC(18, 8) NOT NULL,
  low_price NUMERIC(18, 8) NOT NULL,
  close_price NUMERIC(18, 8) NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, granularity, epoch)
);
CREATE INDEX IF NOT EXISTS idx_market_data_cache_lookup
  ON market_data_cache(symbol, granularity, epoch DESC);

-- 7. watchlists
CREATE TABLE IF NOT EXISTS watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(64) NOT NULL REFERENCES market_instruments(symbol) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

-- 8. notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(40) NOT NULL CHECK (category IN ('security', 'connection', 'system', 'announcement', 'trade_sim')),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- 9. email_logs
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_email VARCHAR(255) NOT NULL,
  template_type VARCHAR(64) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  brevo_message_id VARCHAR(128),
  status VARCHAR(32) NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_logs_user_sent ON email_logs(user_id, sent_at DESC);

-- 10. application_settings
CREATE TABLE IF NOT EXISTS application_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. administrator_audit_logs
CREATE TABLE IF NOT EXISTS administrator_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  target_type VARCHAR(64),
  target_id VARCHAR(128),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON administrator_audit_logs(created_at DESC);

-- 12. virtual_orders
CREATE TABLE IF NOT EXISTS virtual_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connected_account_id UUID REFERENCES connected_accounts(id) ON DELETE SET NULL,
  deriv_contract_id BIGINT,
  execution_mode VARCHAR(24) NOT NULL DEFAULT 'virtual',
  contract_type VARCHAR(32) DEFAULT 'MULTUP',
  payout NUMERIC(18, 4),
  source VARCHAR(32) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'bot')),
  bot_name VARCHAR(120),
  symbol VARCHAR(64) NOT NULL,
  side VARCHAR(8) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  stake NUMERIC(18, 2) NOT NULL CHECK (stake > 0),
  entry_price NUMERIC(18, 8) NOT NULL,
  stop_loss NUMERIC(18, 8),
  take_profit NUMERIC(18, 8),
  exit_price NUMERIC(18, 8),
  pnl NUMERIC(18, 2) NOT NULL DEFAULT 0,
  contract_meta JSONB,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED_TP', 'CLOSED_SL', 'CLOSED_MANUAL')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_virtual_orders_user_status ON virtual_orders(user_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_virtual_orders_contract ON virtual_orders(deriv_contract_id) WHERE deriv_contract_id IS NOT NULL;

-- 13. bot_strategies
CREATE TABLE IF NOT EXISTS bot_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'Free Bots',
  symbol VARCHAR(64) NOT NULL DEFAULT 'R_100',
  strategy_config JSONB NOT NULL,
  rating NUMERIC(2, 1) NOT NULL DEFAULT 5.0,
  is_premium BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. security_logs
CREATE TABLE IF NOT EXISTS security_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_security_logs_user_created ON security_logs(user_id, created_at DESC);
