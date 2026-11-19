INSERT INTO roles (id, name, description)
VALUES
  (1, 'trader', 'Standard Pipflowtrades workspace user'),
  (2, 'admin', 'Platform administrator')
ON CONFLICT (name) DO NOTHING;

SELECT setval('roles_id_seq', (SELECT COALESCE(MAX(id), 2) FROM roles));

-- Default settings & Bot gate password hash ("Pipflow@2026" — rotate via Admin Console after first login)
INSERT INTO application_settings (setting_key, setting_value, is_secret)
VALUES
  ('branding', '{"appName":"Pipflowtrades","tickerText":"WELCOME TO PIPFLOWTRADES — YOUR HUB FOR TRADING KNOWLEDGE, DERIV INDICES, AND MORE","kesRate":130.0}'::jsonb, FALSE),
  ('global_settings', '{"maintenanceMode":false,"allowRegistration":true,"defaultVirtualBalance":10000}'::jsonb, FALSE),
  ('site_controls', '{"showDepositWithdraw":true,"depositUrl":"https://app.deriv.com/cashier/deposit","withdrawUrl":"https://app.deriv.com/cashier/withdrawal","cashierNote":"Deposit or withdraw instantly via Official Deriv Cashier or M-Pesa / KES Payment Agent.","riskDisclaimerText":"Pipflowtrades connects directly to Official Deriv WebSocket endpoints for live market quotes, historical candles, account balance synchronization, and direct order execution through your authorized Deriv Demo or Real account. Trading synthetic and financial derivatives carries financial risk.","enabledTabs":["dashboard","bot_builder","charts","freebots","bulk_trader","analysistool","reports","trading_plan","copy_trading","dtrader","trading_view"]}'::jsonb, FALSE),
  ('bot_analyser_password_hash', '{"hash":"$2a$10$c5k0i8lC5h7vT2Y5zN1N.O7jQ6N6K3vW9wP4B8K8X4X5q3J8H8Z6q"}'::jsonb, TRUE)
ON CONFLICT (setting_key) DO NOTHING;

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
  ('hurmy-speedbot-pro-v2', 'HuRmYSPEEDBOTPROv2', 'SpeedBots', '1HZ100V', '{"tradeType":"RSI_SCALP","stake":10,"tpPct":0.08,"slPct":0.05,"martingale":2}'::jsonb, TRUE)
ON CONFLICT (slug) DO NOTHING;
