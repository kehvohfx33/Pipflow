-- Clean Database Rebuild Script (Neon / PostgreSQL)
-- Wipes all application tables in safe dependency order and rebuilds a fresh, hardened schema + seed.
-- Leaves 0 administrator users so the Owner initializes credentials cleanly on first visit to /#/_console.

BEGIN;

DROP TABLE IF EXISTS security_logs CASCADE;
DROP TABLE IF EXISTS administrator_audit_logs CASCADE;
DROP TABLE IF EXISTS email_logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS watchlists CASCADE;
DROP TABLE IF EXISTS market_data_cache CASCADE;
DROP TABLE IF EXISTS virtual_orders CASCADE;
DROP TABLE IF EXISTS account_authorizations CASCADE;
DROP TABLE IF EXISTS connected_accounts CASCADE;
DROP TABLE IF EXISTS bot_strategies CASCADE;
DROP TABLE IF EXISTS application_settings CASCADE;
DROP TABLE IF EXISTS market_instruments CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
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
CREATE INDEX idx_users_role_id ON users(role_id);

CREATE TABLE connected_accounts (
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
CREATE INDEX idx_connected_accounts_user ON connected_accounts(user_id, is_primary DESC);

CREATE TABLE account_authorizations (
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
CREATE INDEX idx_account_auth_active
  ON account_authorizations(connected_account_id, user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE market_instruments (
  symbol VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(150) NOT NULL,
  market VARCHAR(64) NOT NULL,
  submarket VARCHAR(64),
  pip_size NUMERIC(12, 8) NOT NULL DEFAULT 0.01,
  is_trading_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  exchange_is_open BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE market_data_cache (
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
CREATE INDEX idx_market_data_cache_lookup ON market_data_cache(symbol, granularity, epoch DESC);

CREATE TABLE watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(64) NOT NULL REFERENCES market_instruments(symbol) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(40) NOT NULL CHECK (category IN ('security', 'connection', 'system', 'announcement', 'trade_sim')),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);

CREATE TABLE email_logs (
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
CREATE INDEX idx_email_logs_user_sent ON email_logs(user_id, sent_at DESC);

CREATE TABLE application_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE administrator_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  target_type VARCHAR(64),
  target_id VARCHAR(128),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_admin_audit_created ON administrator_audit_logs(created_at DESC);

CREATE TABLE virtual_orders (
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
CREATE INDEX idx_virtual_orders_user_status ON virtual_orders(user_id, status, opened_at DESC);
CREATE INDEX idx_virtual_orders_contract ON virtual_orders(deriv_contract_id) WHERE deriv_contract_id IS NOT NULL;

CREATE TABLE bot_strategies (
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

CREATE TABLE security_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_security_logs_user_created ON security_logs(user_id, created_at DESC);

INSERT INTO roles (id, name, description)
VALUES
  (1, 'trader', 'Standard Pipflowtrades workspace user'),
  (2, 'admin', 'Platform administrator');

SELECT setval('roles_id_seq', (SELECT COALESCE(MAX(id), 2) FROM roles));

INSERT INTO application_settings (setting_key, setting_value, is_secret)
VALUES
  ('branding', '{"appName":"Pipflowtrades","tickerText":"WELCOME TO PIPFLOWTRADES — YOUR HUB FOR TRADING KNOWLEDGE, DERIV INDICES, AND MORE","kesRate":130.0}'::jsonb, FALSE),
  ('global_settings', '{"maintenanceMode":false,"allowRegistration":true,"defaultVirtualBalance":10000}'::jsonb, FALSE),
  ('site_controls', '{"showDepositWithdraw":true,"depositUrl":"https://app.deriv.com/cashier/deposit","withdrawUrl":"https://app.deriv.com/cashier/withdrawal","cashierNote":"Deposit or withdraw instantly via Official Deriv Cashier or M-Pesa / KES Payment Agent.","riskDisclaimerText":"Pipflowtrades connects directly to Official Deriv WebSocket endpoints for live market quotes, historical candles, account balance synchronization, and direct order execution through your authorized Deriv Demo or Real account. Trading synthetic and financial derivatives carries financial risk.","enabledTabs":["dashboard","bot_builder","charts","freebots","bulk_trader","analysistool","reports","trading_plan","copy_trading","dtrader","trading_view"]}'::jsonb, FALSE),
  ('bot_analyser_password_hash', '{"hash":"$2a$10$c5k0i8lC5h7vT2Y5zN1N.O7jQ6N6K3vW9wP4B8K8X4X5q3J8H8Z6q"}'::jsonb, TRUE);

INSERT INTO bot_strategies (slug, name, category, symbol, strategy_config, is_premium)
VALUES
  ('07-over-hit-n-run', '07_Over_Hit_n_Run', 'Free Bots', 'R_100', '{"tradeType":"Digits > Over/Under","stake":10,"tpPct":0.08,"slPct":0.05,"martingale":2}'::jsonb, TRUE),
  ('autodifferbylegoo', 'AutoDifferbylegoo', 'Free Bots', 'R_25', '{"tradeType":"Digits > Matches/Differs","stake":5,"tpPct":0.06,"slPct":0.04,"martingale":1.5}'::jsonb, TRUE),
  ('magic-recovery', 'MagicRecovery', 'SpeedBots', 'R_50', '{"tradeType":"EMA_CROSS","stake":15,"tpPct":0.10,"slPct":0.06,"martingale":2}'::jsonb, TRUE),
  ('autovolt5probot1', 'Autovolt5Probot1', 'Scalper Bots', '1HZ100V', '{"tradeType":"RSI_SCALP","stake":10,"tpPct":0.07,"slPct":0.04,"martingale":1.5}'::jsonb, TRUE),
  ('04-20-over-edge-money-bot', '04_20_Over_Edge_Money_Bot', 'Free Bots', 'R_75', '{"tradeType":"Digits > Over/Under","stake":10,"tpPct":0.09,"slPct":0.05,"martingale":2}'::jsonb, TRUE),
  ('expert-speed-bot', 'ExpertSpeedBotByCHOSENDOLLARPRINTERFX', 'SpeedBots', '1HZ90V', '{"tradeType":"TICK_IMBALANCE","stake":12,"tpPct":0.08,"slPct":0.05,"martingale":2}'::jsonb, TRUE),
  ('martingale-matches-differs', 'martingale_matches_differs', 'Bots Store', 'R_10', '{"tradeType":"Digits > Matches/Differs","stake":5,"tpPct":0.07,"slPct":0.04,"martingale":2}'::jsonb, TRUE),
  ('vx', 'Vx', 'Scalper Bots', 'R_50', '{"tradeType":"MOMENTUM","stake":10,"tpPct":0.08,"slPct":0.05,"martingale":1.5}'::jsonb, TRUE),
  ('recover-over-bandwagon', 'Recover_Over_Bandwagon', 'Free Bots', 'R_100', '{"tradeType":"Digits > Over/Under","stake":10,"tpPct":0.08,"slPct":0.05,"martingale":2}'::jsonb, TRUE),
  ('alpha-version-2026', 'AlphaVersion2026Edition', 'Free Bots', 'R_75', '{"tradeType":"BREAKOUT","stake":20,"tpPct":0.10,"slPct":0.06,"martingale":2}'::jsonb, TRUE),
  ('signal-sniper-autobot', 'SignalSniperAutoBot', 'Scalper Bots', '1HZ90V', '{"tradeType":"TICK_IMBALANCE","stake":10,"tpPct":0.08,"slPct":0.05,"martingale":1.5}'::jsonb, TRUE),
  ('rise-fall-switcher-bot', 'RiseFallswitcherBot', 'Free Bots', 'R_25', '{"tradeType":"Up/Down > Rise/Fall","stake":10,"tpPct":0.07,"slPct":0.04,"martingale":2}'::jsonb, TRUE),
  ('08-odd-myth-v3', '08_ODD_MYTH_V3_0', 'Free Bots', 'R_100', '{"tradeType":"Digits > Even/Odd","stake":10,"tpPct":0.08,"slPct":0.05,"martingale":2}'::jsonb, TRUE),
  ('dstrike2', 'Dstrike2', 'SpeedBots', '1HZ100V', '{"tradeType":"MOMENTUM","stake":15,"tpPct":0.09,"slPct":0.05,"martingale":2}'::jsonb, TRUE),
  ('hurmy-autobot', 'HuRmYAUTOBoTBYHURMYFXKE', 'Bots Store', 'R_75', '{"tradeType":"EMA_CROSS","stake":10,"tpPct":0.08,"slPct":0.05,"martingale":2}'::jsonb, TRUE),
  ('hurmy-speedbot-pro-v2', 'HuRmYSPEEDBOTPROv2', 'SpeedBots', '1HZ100V', '{"tradeType":"RSI_SCALP","stake":10,"tpPct":0.08,"slPct":0.05,"martingale":2}'::jsonb, TRUE);

COMMIT;
