-- Migration 002: Unified Bot Workspaces and Persistent Bot Runs

CREATE TABLE IF NOT EXISTS bot_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  symbol VARCHAR(64) NOT NULL DEFAULT 'R_100',
  strategy_type VARCHAR(80) NOT NULL DEFAULT 'custom',
  xml_content TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bot_workspaces_user ON bot_workspaces(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS bot_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES bot_workspaces(id) ON DELETE SET NULL,
  connected_account_id UUID REFERENCES connected_accounts(id) ON DELETE SET NULL,
  bot_name VARCHAR(150) NOT NULL,
  symbol VARCHAR(64) NOT NULL,
  contract_type VARCHAR(32),
  account_type VARCHAR(16) NOT NULL DEFAULT 'virtual',
  status VARCHAR(24) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'paused', 'stopped', 'emergency_stopped')),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  trades_count INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  session_pnl NUMERIC(18, 2) NOT NULL DEFAULT 0,
  last_action TEXT,
  stop_reason TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bot_runs_user_started ON bot_runs(user_id, started_at DESC);
