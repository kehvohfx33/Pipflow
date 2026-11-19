import { isDatabaseConfigured, pool } from './pool';
import { logError, logInfo } from '../utils/logger';
import bcrypt from 'bcryptjs';

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

ALTER TABLE connected_accounts ADD COLUMN IF NOT EXISTS balance_locked_by_admin BOOLEAN NOT NULL DEFAULT FALSE;

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

CREATE TABLE IF NOT EXISTS watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(64) NOT NULL REFERENCES market_instruments(symbol) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(40) NOT NULL CHECK (category IN ('security', 'connection', 'system', 'announcement', 'trade_sim')),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS application_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  stake NUMERIC(18, 2) NOT NULL,
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

ALTER TABLE virtual_orders ADD COLUMN IF NOT EXISTS connected_account_id UUID REFERENCES connected_accounts(id) ON DELETE SET NULL;
ALTER TABLE virtual_orders ADD COLUMN IF NOT EXISTS deriv_contract_id BIGINT;
ALTER TABLE virtual_orders ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(24) NOT NULL DEFAULT 'virtual';
ALTER TABLE virtual_orders ADD COLUMN IF NOT EXISTS contract_type VARCHAR(32) DEFAULT 'MULTUP';
ALTER TABLE virtual_orders ADD COLUMN IF NOT EXISTS payout NUMERIC(18, 4);
ALTER TABLE virtual_orders ADD COLUMN IF NOT EXISTS contract_meta JSONB;

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

CREATE TABLE IF NOT EXISTS security_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const SEED_SQL = `
INSERT INTO roles (id, name, description)
VALUES
  (1, 'trader', 'Standard Pipflowtrades workspace user'),
  (2, 'admin', 'Platform administrator')
ON CONFLICT (name) DO NOTHING;

INSERT INTO application_settings (setting_key, setting_value, is_secret)
VALUES
  ('branding', '{"appName":"TradeDeriv","tickerText":"WELCOME TO TRADEDERIV — YOUR HUB FOR TRADING KNOWLEDGE, DERIV INDICES, AND MORE","kesRate":130.0}'::jsonb, FALSE),
  ('global_settings', '{"maintenanceMode":false,"allowRegistration":true,"defaultVirtualBalance":10000}'::jsonb, FALSE),
  ('site_controls', '{"showDepositWithdraw":true,"depositUrl":"https://app.deriv.com/cashier/deposit","withdrawUrl":"https://app.deriv.com/cashier/withdrawal","cashierNote":"Deposit or withdraw instantly via Official Deriv Cashier or M-Pesa / KES Payment Agent.","riskDisclaimerText":"TradeDeriv connects directly to Official Deriv WebSocket endpoints for live market quotes, historical candles, account balance synchronization, and direct order execution through your authorized Deriv Demo or Real account. Trading synthetic and financial derivatives carries financial risk.","enabledTabs":["dashboard","bot_builder","charts","freebots","bulk_trader","analysistool","reports","trading_plan","copy_trading","dtrader","trading_view"]}'::jsonb, FALSE),
  ('bot_analyser_password_hash', '{"hash":"$2a$10$c5k0i8lC5h7vT2Y5zN1N.O7jQ6N6K3vW9wP4B8K8X4X5q3J8H8Z6q"}'::jsonb, TRUE)
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO bot_strategies (slug, name, category, symbol, strategy_config, is_premium)
VALUES
  ('07-over-hit-n-run', '07_Over_Hit_n_Run', 'Free Bots', 'R_100', '{"tradeType":"Digits > Over/Under","stake":10,"tpPct":0.08,"slPct":0.05,"martingale":2}'::jsonb, TRUE),
  ('autodifferbylegoo', 'AutoDifferbylegoo', 'Free Bots', 'R_25', '{"tradeType":"Digits > Matches/Differs","stake":5,"tpPct":0.06,"slPct":0.04,"martingale":1.5}'::jsonb, TRUE),
  ('magic-recovery', 'MagicRecovery', 'SpeedBots', 'R_50', '{"tradeType":"EMA_CROSS","stake":15,"tpPct":0.10,"slPct":0.06,"martingale":2}'::jsonb, TRUE),
  ('autovolt5probot1', 'Autovolt5Probot1', 'Scalper Bots', '1HZ100V', '{"tradeType":"RSI_SCALP","stake":10,"tpPct":0.07,"slPct":0.04,"martingale":1.5}'::jsonb, TRUE),
  ('alpha-version-2026', 'AlphaVersion2026Edition', 'Free Bots', 'R_75', '{"tradeType":"BREAKOUT","stake":20,"tpPct":0.10,"slPct":0.06,"martingale":2}'::jsonb, TRUE),
  ('signal-sniper-autobot', 'SignalSniperAutoBot', 'Scalper Bots', '1HZ90V', '{"tradeType":"TICK_IMBALANCE","stake":10,"tpPct":0.08,"slPct":0.05,"martingale":1.5}'::jsonb, TRUE)
ON CONFLICT (slug) DO NOTHING;
`;

let schemaReady = false;
let schemaPromise: Promise<void> | null = null;

async function syncEnvAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  if (!adminEmail || !adminPassword || adminPassword.length < 8) {
    return;
  }
  const existingAdmin = await pool.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE role_id = 2`);
  if ((existingAdmin.rows[0]?.cnt ?? 0) > 0) {
    return;
  }
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role_id, is_email_verified, is_active)
     VALUES ($1, $2, 'Platform Administrator', 2, TRUE, TRUE)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role_id = 2,
       is_email_verified = TRUE,
       is_active = TRUE,
       updated_at = NOW()`,
    [adminEmail, passwordHash]
  );
  logInfo('database', `Seeded admin account in users table: ${adminEmail}`);
}

export async function ensureDatabaseSchema(): Promise<void> {
  if (!isDatabaseConfigured) {
    logInfo('database', 'DATABASE_URL not configured yet; skipping schema bootstrap');
    return;
  }
  if (schemaReady) {
    return;
  }
  if (!schemaPromise) {
    schemaPromise = (async () => {
      try {
        await pool.query(SCHEMA_SQL);
        await pool.query(SEED_SQL);
        await syncEnvAdminUser();
        schemaReady = true;
        logInfo('database', 'Neon PostgreSQL schema and seed verified');
      } catch (err) {
        schemaPromise = null;
        logError('database', 'Failed to initialize Neon PostgreSQL schema (check DATABASE_URL)', err);
      }
    })();
  }
  await schemaPromise;
}
