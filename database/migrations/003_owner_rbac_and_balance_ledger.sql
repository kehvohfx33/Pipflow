-- Migration 003: Owner / Admin / User RBAC and Immutable Synchronized Balance Ledger

INSERT INTO roles (id, name, description)
VALUES
  (1, 'trader', 'Legacy standard Pipflowtrade workspace user'),
  (2, 'admin', 'Operations administrator (non-financial, non-settings)'),
  (3, 'owner', 'Platform owner with exclusive settings and financial adjustment privileges'),
  (4, 'user', 'Standard registered Pipflowtrade user')
ON CONFLICT (name) DO NOTHING;

SELECT setval('roles_id_seq', (SELECT COALESCE(MAX(id), 4) FROM roles));

ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS platform_adjustment_balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exact_broker_balance_only BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE connected_accounts
SET exact_broker_balance_only = TRUE
WHERE account_type = 'real' AND platform_adjustment_balance = 0;

CREATE TABLE IF NOT EXISTS balance_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(128) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connected_account_id UUID REFERENCES connected_accounts(id) ON DELETE SET NULL,
  account_scope VARCHAR(16) NOT NULL CHECK (account_scope IN ('virtual', 'demo', 'real')),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  broker_balance_at_sync NUMERIC(18, 4) NOT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  sync_timestamp TIMESTAMPTZ NOT NULL,
  adjustment_delta NUMERIC(18, 4) NOT NULL,
  previous_adjustment_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  new_adjustment_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  resulting_displayed_balance NUMERIC(18, 4) NOT NULL,
  reason VARCHAR(160) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_adjustments_user_created
  ON balance_adjustments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_adjustments_account_created
  ON balance_adjustments(connected_account_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_balance_adjustments_mutation_fn()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'balance_adjustments ledger is immutable and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_balance_adjustments_mutation ON balance_adjustments;
CREATE TRIGGER prevent_balance_adjustments_mutation
BEFORE UPDATE OR DELETE ON balance_adjustments
FOR EACH ROW EXECUTE FUNCTION prevent_balance_adjustments_mutation_fn();
