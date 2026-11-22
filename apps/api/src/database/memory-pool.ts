import crypto from 'crypto';
import { logInfo } from '../utils/logger';

interface QueryResultLike<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

interface RoleRow {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role_id: number;
  is_email_verified: boolean;
  email_verification_token: string | null;
  password_reset_token: string | null;
  password_reset_expires_at: string | null;
  virtual_workspace_balance: number;
  preferred_currency: string;
  local_currency: string;
  is_active: boolean;
  token_version: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ConnectedAccountRow {
  id: string;
  user_id: string;
  deriv_login_id: string;
  account_type: 'demo' | 'real';
  currency: string;
  last_known_balance: number;
  balance_locked_by_admin: boolean;
  landing_company: string | null;
  connection_status: 'connected' | 'disconnected' | 'revoked' | 'error';
  is_primary: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AccountAuthorizationRow {
  id: string;
  connected_account_id: string;
  user_id: string;
  encrypted_token: string;
  token_iv: string;
  token_auth_tag: string;
  granted_scopes: string[];
  owner_consented_at: string;
  revoked_at: string | null;
  created_at: string;
}

interface VirtualOrderRow {
  id: string;
  user_id: string;
  connected_account_id: string | null;
  deriv_contract_id: number | null;
  execution_mode: string;
  contract_type: string | null;
  payout: number | null;
  source: 'manual' | 'bot';
  bot_name: string | null;
  symbol: string;
  side: 'BUY' | 'SELL';
  stake: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  exit_price: number | null;
  pnl: number;
  contract_meta: Record<string, unknown> | null;
  status: 'OPEN' | 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL';
  opened_at: string;
  closed_at: string | null;
}

interface BotStrategyRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  symbol: string;
  strategy_config: Record<string, unknown>;
  rating: number;
  is_premium: boolean;
  created_at: string;
}

interface WatchlistRow {
  id: string;
  user_id: string;
  symbol: string;
  sort_order: number;
  created_at: string;
}

interface NotificationRow {
  id: string;
  user_id: string | null;
  category: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface AppSettingRow {
  setting_key: string;
  setting_value: Record<string, unknown>;
  is_secret: boolean;
  updated_by: string | null;
  updated_at: string;
}

interface BotWorkspaceRow {
  id: string;
  user_id: string;
  name: string;
  symbol: string;
  strategy_type: string;
  xml_content: string;
  config_json: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface BotRunRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  connected_account_id: string | null;
  bot_name: string;
  symbol: string;
  contract_type: string | null;
  account_type: string;
  status: 'running' | 'paused' | 'stopped' | 'emergency_stopped';
  config_json: Record<string, unknown>;
  trades_count: number;
  wins: number;
  losses: number;
  session_pnl: number;
  last_action: string | null;
  stop_reason: string | null;
  started_at: string;
  paused_at: string | null;
  stopped_at: string | null;
}

const SEEDED_STRATEGIES: Array<Omit<BotStrategyRow, 'id' | 'rating' | 'created_at'>> = [
  { slug: '07-over-hit-n-run', name: '07_Over_Hit_n_Run', category: 'Free Bots', symbol: 'R_100', strategy_config: { tradeType: 'Digits > Over/Under', stake: 10, tpPct: 0.08, slPct: 0.05, martingale: 2 }, is_premium: true },
  { slug: 'autodifferbylegoo', name: 'AutoDifferbylegoo', category: 'Free Bots', symbol: 'R_25', strategy_config: { tradeType: 'Digits > Matches/Differs', stake: 5, tpPct: 0.06, slPct: 0.04, martingale: 1.5 }, is_premium: true },
  { slug: 'magic-recovery', name: 'MagicRecovery', category: 'SpeedBots', symbol: 'R_50', strategy_config: { tradeType: 'EMA_CROSS', stake: 15, tpPct: 0.10, slPct: 0.06, martingale: 2 }, is_premium: true },
  { slug: 'autovolt5probot1', name: 'Autovolt5Probot1', category: 'Scalper Bots', symbol: '1HZ100V', strategy_config: { tradeType: 'RSI_SCALP', stake: 10, tpPct: 0.07, slPct: 0.04, martingale: 1.5 }, is_premium: true },
  { slug: '04-20-over-edge-money-bot', name: '04_20_Over_Edge_Money_Bot', category: 'Free Bots', symbol: 'R_75', strategy_config: { tradeType: 'Digits > Over/Under', stake: 10, tpPct: 0.09, slPct: 0.05, martingale: 2 }, is_premium: true },
  { slug: 'expert-speed-bot', name: 'ExpertSpeedBotByCHOSENDOLLARPRINTERFX', category: 'SpeedBots', symbol: '1HZ90V', strategy_config: { tradeType: 'TICK_IMBALANCE', stake: 12, tpPct: 0.08, slPct: 0.05, martingale: 2 }, is_premium: true },
  { slug: 'martingale-matches-differs', name: 'martingale_matches_differs', category: 'Bots Store', symbol: 'R_10', strategy_config: { tradeType: 'Digits > Matches/Differs', stake: 5, tpPct: 0.07, slPct: 0.04, martingale: 2 }, is_premium: true },
  { slug: 'vx', name: 'Vx', category: 'Scalper Bots', symbol: 'R_50', strategy_config: { tradeType: 'MOMENTUM', stake: 10, tpPct: 0.08, slPct: 0.05, martingale: 1.5 }, is_premium: true },
  { slug: 'recover-over-bandwagon', name: 'Recover_Over_Bandwagon', category: 'Free Bots', symbol: 'R_100', strategy_config: { tradeType: 'Digits > Over/Under', stake: 10, tpPct: 0.08, slPct: 0.05, martingale: 2 }, is_premium: true },
  { slug: 'alpha-version-2026', name: 'AlphaVersion2026Edition', category: 'Free Bots', symbol: 'R_75', strategy_config: { tradeType: 'BREAKOUT', stake: 20, tpPct: 0.10, slPct: 0.06, martingale: 2 }, is_premium: true },
  { slug: 'signal-sniper-autobot', name: 'SignalSniperAutoBot', category: 'Scalper Bots', symbol: '1HZ90V', strategy_config: { tradeType: 'TICK_IMBALANCE', stake: 10, tpPct: 0.08, slPct: 0.05, martingale: 1.5 }, is_premium: true },
  { slug: 'rise-fall-switcher-bot', name: 'RiseFallswitcherBot', category: 'Free Bots', symbol: 'R_25', strategy_config: { tradeType: 'Up/Down > Rise/Fall', stake: 10, tpPct: 0.07, slPct: 0.04, martingale: 2 }, is_premium: true },
  { slug: '08-odd-myth-v3', name: '08_ODD_MYTH_V3_0', category: 'Free Bots', symbol: 'R_100', strategy_config: { tradeType: 'Digits > Even/Odd', stake: 10, tpPct: 0.08, slPct: 0.05, martingale: 2 }, is_premium: true },
  { slug: 'dstrike2', name: 'Dstrike2', category: 'SpeedBots', symbol: '1HZ100V', strategy_config: { tradeType: 'MOMENTUM', stake: 15, tpPct: 0.09, slPct: 0.05, martingale: 2 }, is_premium: true },
  { slug: 'hurmy-autobot', name: 'HuRmYAUTOBoTBYHURMYFXKE', category: 'Bots Store', symbol: 'R_75', strategy_config: { tradeType: 'EMA_CROSS', stake: 10, tpPct: 0.08, slPct: 0.05, martingale: 2 }, is_premium: true },
  { slug: 'hurmy-speedbot-pro-v2', name: 'HuRmYSPEEDBOTPROv2', category: 'SpeedBots', symbol: '1HZ100V', strategy_config: { tradeType: 'RSI_SCALP', stake: 10, tpPct: 0.08, slPct: 0.05, martingale: 2 }, is_premium: true }
];

function nowIso() {
  return new Date().toISOString();
}

function parseJsonParam(val: unknown): Record<string, unknown> | null {
  if (!val) return null;
  if (typeof val === 'object') return val as Record<string, unknown>;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export function createMemoryPool() {
  logInfo('database', 'In-memory storage fallback active (DATABASE_URL not configured)');

  const roles: RoleRow[] = [
    { id: 1, name: 'trader', description: 'Standard Pipflowtrades workspace user', created_at: nowIso() },
    { id: 2, name: 'admin', description: 'Platform administrator', created_at: nowIso() }
  ];

  const users: UserRow[] = [];
  const connectedAccounts: ConnectedAccountRow[] = [];
  const accountAuthorizations: AccountAuthorizationRow[] = [];
  const virtualOrders: VirtualOrderRow[] = [];
  const watchlists: WatchlistRow[] = [];
  const notifications: NotificationRow[] = [];
  const marketInstruments: Array<Record<string, unknown>> = [];
  const securityLogs: Array<Record<string, unknown>> = [];
  const emailLogs: Array<Record<string, unknown>> = [];
  const adminAuditLogs: Array<Record<string, unknown>> = [];
  const botWorkspaces: BotWorkspaceRow[] = [];
  const botRuns: BotRunRow[] = [];

  const botStrategies: BotStrategyRow[] = SEEDED_STRATEGIES.map((s, idx) => ({
    ...s,
    id: crypto.randomUUID(),
    rating: 5.0,
    created_at: new Date(Date.now() + idx).toISOString()
  }));

  const settings = new Map<string, AppSettingRow>([
    [
      'branding',
      {
        setting_key: 'branding',
        setting_value: {
          appName: 'Pipflowtrades',
          tickerText: 'WELCOME TO PIPFLOWTRADES — YOUR HUB FOR TRADING KNOWLEDGE, DERIV INDICES, AND MORE',
          kesRate: 130.0
        },
        is_secret: false,
        updated_by: null,
        updated_at: nowIso()
      }
    ],
    [
      'global_settings',
      {
        setting_key: 'global_settings',
        setting_value: { maintenanceMode: false, allowRegistration: true, defaultVirtualBalance: 10000 },
        is_secret: false,
        updated_by: null,
        updated_at: nowIso()
      }
    ],
    [
      'site_controls',
      {
        setting_key: 'site_controls',
        setting_value: {
          showDepositWithdraw: true,
          depositUrl: 'https://app.deriv.com/cashier/deposit',
          withdrawUrl: 'https://app.deriv.com/cashier/withdrawal',
          cashierNote: 'Deposit or withdraw instantly via Official Deriv Cashier or M-Pesa / KES Payment Agent.',
          riskDisclaimerText:
            'Pipflowtrades connects directly to Official Deriv WebSocket endpoints for live market quotes, historical candles, account balance synchronization, and direct order execution through your authorized Deriv Demo or Real account. Trading synthetic and financial derivatives carries financial risk.',
          enabledTabs: [
            'dashboard',
            'bot_builder',
            'charts',
            'freebots',
            'bulk_trader',
            'analysistool',
            'reports',
            'trading_plan',
            'copy_trading',
            'dtrader',
            'trading_view'
          ]
        },
        is_secret: false,
        updated_by: null,
        updated_at: nowIso()
      }
    ],
    [
      'bot_analyser_password_hash',
      {
        setting_key: 'bot_analyser_password_hash',
        setting_value: { hash: '$2a$10$c5k0i8lC5h7vT2Y5zN1N.O7jQ6N6K3vW9wP4B8K8X4X5q3J8H8Z6q' },
        is_secret: true,
        updated_by: null,
        updated_at: nowIso()
      }
    ]
  ]);

  const roleNameById = (roleId: number) => roles.find((r) => r.id === roleId)?.name ?? 'trader';

  async function query<T = Record<string, unknown>>(
    rawSql: string,
    params: unknown[] = []
  ): Promise<QueryResultLike<T>> {
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    const low = sql.toLowerCase();

    if (low === 'select 1' || low === 'begin' || low === 'commit' || low === 'rollback') {
      return { rows: [], rowCount: 0 };
    }

    // ROLES
    if (low.startsWith('insert into roles')) {
      return { rows: [], rowCount: 0 };
    }
    if (low.includes('from roles where name =')) {
      const role = roles.find((r) => r.name === 'admin');
      return { rows: (role ? [role] : []) as unknown as T[], rowCount: role ? 1 : 0 };
    }

    // APPLICATION SETTINGS
    if (low.includes('from application_settings where is_secret = false')) {
      const rows = Array.from(settings.values()).filter((s) => !s.is_secret);
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }
    if (low.includes('from application_settings where setting_key =')) {
      const match = sql.match(/setting_key\s*=\s*'([^']+)'/i);
      const key = match ? match[1] : String(params[0] ?? '');
      const row = settings.get(key);
      return { rows: (row ? [{ setting_value: row.setting_value }] : []) as unknown as T[], rowCount: row ? 1 : 0 };
    }
    if (low.startsWith('insert into application_settings')) {
      const literalKey = sql.match(/values\s*\(\s*'([^']+)'/i)?.[1];
      const key = literalKey ?? String(params[0]);
      const val = parseJsonParam(literalKey ? params[0] : params[1]) ?? {};
      const isSecret = literalKey ? low.includes(', true') : Boolean(params[2]);
      const updatedBy = literalKey ? (params[1] ? String(params[1]) : null) : params[3] ? String(params[3]) : null;
      settings.set(key, {
        setting_key: key,
        setting_value: val,
        is_secret: isSecret,
        updated_by: updatedBy,
        updated_at: nowIso()
      });
      return { rows: [], rowCount: 1 };
    }

    // USERS — COUNT ADMIN
    if (low.includes('count(*)::int as cnt from users') && low.includes("r.name = 'admin'")) {
      const cnt = users.filter((u) => roleNameById(u.role_id) === 'admin').length;
      return { rows: [{ cnt }] as unknown as T[], rowCount: 1 };
    }

    // USERS — INSERT
    if (low.startsWith('insert into users')) {
      const email = String(params[0] ?? '').trim().toLowerCase();
      if (users.some((u) => u.email === email)) {
        throw new Error('duplicate key value violates unique constraint "users_email_key"');
      }
      const isAdminInsert = low.includes('is_email_verified, is_active, last_login_at');
      const isOAuthInsert = low.includes('is_email_verified, virtual_workspace_balance, preferred_currency, last_login_at');

      let newUser: UserRow;
      if (isAdminInsert) {
        newUser = {
          id: crypto.randomUUID(),
          email,
          password_hash: String(params[1] ?? ''),
          full_name: String(params[2] ?? 'Platform Administrator'),
          role_id: Number(params[3] ?? 2),
          is_email_verified: true,
          email_verification_token: null,
          password_reset_token: null,
          password_reset_expires_at: null,
          virtual_workspace_balance: 10000,
          preferred_currency: 'USD',
          local_currency: 'KES',
          is_active: true,
          token_version: 1,
          last_login_at: nowIso(),
          created_at: nowIso(),
          updated_at: nowIso()
        };
      } else if (isOAuthInsert) {
        newUser = {
          id: crypto.randomUUID(),
          email,
          password_hash: String(params[1] ?? ''),
          full_name: String(params[2] ?? 'Deriv Trader'),
          role_id: 1,
          is_email_verified: true,
          email_verification_token: null,
          password_reset_token: null,
          password_reset_expires_at: null,
          virtual_workspace_balance: Number(params[3] ?? 10000),
          preferred_currency: String(params[4] ?? 'USD'),
          local_currency: 'KES',
          is_active: true,
          token_version: 1,
          last_login_at: nowIso(),
          created_at: nowIso(),
          updated_at: nowIso()
        };
      } else {
        newUser = {
          id: crypto.randomUUID(),
          email,
          password_hash: String(params[1] ?? ''),
          full_name: String(params[2] ?? 'Trader'),
          role_id: 1,
          is_email_verified: false,
          email_verification_token: params[4] ? String(params[4]) : null,
          password_reset_token: null,
          password_reset_expires_at: null,
          virtual_workspace_balance: Number(params[3] ?? 10000),
          preferred_currency: 'USD',
          local_currency: 'KES',
          is_active: true,
          token_version: 1,
          last_login_at: null,
          created_at: nowIso(),
          updated_at: nowIso()
        };
      }
      users.push(newUser);
      return {
        rows: [{ ...newUser, role_name: roleNameById(newUser.role_id) }] as unknown as T[],
        rowCount: 1
      };
    }

    // USERS — SELECTS
    if (low.includes('from users') && !low.includes('join users')) {
      if (low.includes('where u.email = $1') || low.includes('where email = $1')) {
        const email = String(params[0] ?? '').trim().toLowerCase();
        const u = users.find((x) => x.email === email);
        if (!u) return { rows: [], rowCount: 0 };
        return { rows: [{ ...u, role_name: roleNameById(u.role_id), role: roleNameById(u.role_id) }] as unknown as T[], rowCount: 1 };
      }
      if (low.includes('where u.id = $1') || low.includes('where id = $1')) {
        const id = String(params[0] ?? '');
        const u = users.find((x) => x.id === id);
        if (!u) return { rows: [], rowCount: 0 };
        return {
          rows: [{ ...u, role_name: roleNameById(u.role_id), role: roleNameById(u.role_id) }] as unknown as T[],
          rowCount: 1
        };
      }
      if (low.includes('order by u.created_at desc')) {
        const rows = [...users]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((u) => ({ ...u, role: roleNameById(u.role_id) }));
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      if (low.includes('where ca.user_id = u.id') && low.includes('ca.deriv_login_id = $1')) {
        const loginId = String(params[0] ?? '');
        const ca = connectedAccounts.find((c) => c.deriv_login_id === loginId);
        const u = ca ? users.find((x) => x.id === ca.user_id) : undefined;
        if (!u) return { rows: [], rowCount: 0 };
        return { rows: [{ ...u, role_name: roleNameById(u.role_id) }] as unknown as T[], rowCount: 1 };
      }
    }

    // USERS — UPDATES
    if (low.startsWith('update users set')) {
      if (low.includes('set last_login_at = now() where id = $1')) {
        const u = users.find((x) => x.id === String(params[0]));
        if (u) u.last_login_at = nowIso();
        return { rows: [], rowCount: u ? 1 : 0 };
      }
      if (low.includes('set virtual_workspace_balance = 10000.00 where id = $1')) {
        const u = users.find((x) => x.id === String(params[0]));
        if (u) u.virtual_workspace_balance = 10000;
        return { rows: (u ? [u] : []) as unknown as T[], rowCount: u ? 1 : 0 };
      }
      if (low.includes('virtual_workspace_balance') && low.includes('where id = $2')) {
        const delta = Number(params[0] ?? 0);
        const u = users.find((x) => x.id === String(params[1]));
        if (u) {
          u.virtual_workspace_balance = Math.max(0, Number((u.virtual_workspace_balance + delta).toFixed(2)));
        }
        return { rows: (u ? [u] : []) as unknown as T[], rowCount: u ? 1 : 0 };
      }
      if (low.includes('email_verification_token = null where email_verification_token = $1')) {
        const u = users.find((x) => x.email_verification_token === String(params[0]));
        if (u) {
          u.is_email_verified = true;
          u.email_verification_token = null;
        }
        return { rows: (u ? [{ id: u.id, email: u.email }] : []) as unknown as T[], rowCount: u ? 1 : 0 };
      }
      if (low.includes('password_reset_token = $1') && low.includes('where email = $2')) {
        const u = users.find((x) => x.email === String(params[1]).trim().toLowerCase());
        if (u) {
          u.password_reset_token = String(params[0]);
          u.password_reset_expires_at = new Date(Date.now() + 3600_000).toISOString();
        }
        return { rows: (u ? [u] : []) as unknown as T[], rowCount: u ? 1 : 0 };
      }
      if (low.includes('where password_reset_token = $2')) {
        const u = users.find(
          (x) =>
            x.password_reset_token === String(params[1]) &&
            x.password_reset_expires_at &&
            new Date(x.password_reset_expires_at).getTime() > Date.now()
        );
        if (u) {
          u.password_hash = String(params[0]);
          u.password_reset_token = null;
          u.password_reset_expires_at = null;
          u.token_version += 1;
        }
        return { rows: (u ? [{ id: u.id, email: u.email }] : []) as unknown as T[], rowCount: u ? 1 : 0 };
      }
      if (low.includes('set full_name = $2') && low.includes('where id = $1')) {
        const u = users.find((x) => x.id === String(params[0]));
        if (u) u.full_name = String(params[1]);
        return { rows: (u ? [u] : []) as unknown as T[], rowCount: u ? 1 : 0 };
      }
      if (low.includes('set email = $1, password_hash = $2') && low.includes('where id = $3')) {
        const u = users.find((x) => x.id === String(params[2]));
        if (u) {
          u.email = String(params[0]);
          u.password_hash = String(params[1]);
          u.token_version += 1;
        }
        return { rows: (u ? [u] : []) as unknown as T[], rowCount: u ? 1 : 0 };
      }
      if (low.includes('set password_hash = $1') && low.includes('where id = $4')) {
        const u = users.find((x) => x.id === String(params[3]));
        if (u) {
          u.password_hash = String(params[0]);
          if (params[1]) u.full_name = String(params[1]);
          u.role_id = Number(params[2]);
          u.is_email_verified = true;
          u.is_active = true;
          u.token_version += 1;
          u.last_login_at = nowIso();
        }
        return { rows: (u ? [u] : []) as unknown as T[], rowCount: u ? 1 : 0 };
      }
    }
    if (low.startsWith('delete from users where id = $1')) {
      const idx = users.findIndex((u) => u.id === String(params[0]));
      if (idx === -1) return { rows: [], rowCount: 0 };
      const [removed] = users.splice(idx, 1);
      return { rows: [{ email: removed.email }] as unknown as T[], rowCount: 1 };
    }

    // BOT STRATEGIES
    if (low.includes('from bot_strategies')) {
      if (low.includes('where id = $1')) {
        const found = botStrategies.filter((s) => s.id === String(params[0]));
        return { rows: found as unknown as T[], rowCount: found.length };
      }
      const ordered = low.includes('desc') ? [...botStrategies].reverse() : [...botStrategies];
      return { rows: ordered as unknown as T[], rowCount: ordered.length };
    }

    // VIRTUAL ORDERS
    if (low.startsWith('insert into virtual_orders')) {
      let row: VirtualOrderRow;
      if (low.includes('connected_account_id, deriv_contract_id')) {
        const isBot = low.includes("'bot'") || low.includes(', source, bot_name,') === false && low.includes('bot_name');
        if (isBot && params.length >= 13) {
          row = {
            id: crypto.randomUUID(),
            user_id: String(params[0]),
            connected_account_id: params[1] ? String(params[1]) : null,
            deriv_contract_id: Number(params[2]),
            execution_mode: String(params[3]),
            contract_type: String(params[4]),
            payout: params[5] !== null && params[5] !== undefined ? Number(params[5]) : null,
            source: 'bot',
            bot_name: String(params[6] ?? ''),
            symbol: String(params[7]),
            side: (params[8] as 'BUY' | 'SELL') || 'BUY',
            stake: Number(params[9]),
            entry_price: Number(params[10]),
            stop_loss: params[11] !== null && params[11] !== undefined ? Number(params[11]) : null,
            take_profit: params[12] !== null && params[12] !== undefined ? Number(params[12]) : null,
            exit_price: null,
            pnl: 0,
            contract_meta: null,
            status: 'OPEN',
            opened_at: nowIso(),
            closed_at: null
          };
        } else {
          row = {
            id: crypto.randomUUID(),
            user_id: String(params[0]),
            connected_account_id: params[1] ? String(params[1]) : null,
            deriv_contract_id: Number(params[2]),
            execution_mode: String(params[3]),
            contract_type: String(params[4]),
            payout: params[5] !== null && params[5] !== undefined ? Number(params[5]) : null,
            source: 'manual',
            bot_name: null,
            symbol: String(params[6]),
            side: (params[7] as 'BUY' | 'SELL') || 'BUY',
            stake: Number(params[8]),
            entry_price: Number(params[9]),
            stop_loss: params[10] !== null && params[10] !== undefined ? Number(params[10]) : null,
            take_profit: params[11] !== null && params[11] !== undefined ? Number(params[11]) : null,
            exit_price: null,
            pnl: 0,
            contract_meta: null,
            status: 'OPEN',
            opened_at: nowIso(),
            closed_at: null
          };
        }
      } else if (low.includes("'bot'")) {
        row = {
          id: crypto.randomUUID(),
          user_id: String(params[0]),
          connected_account_id: null,
          deriv_contract_id: null,
          execution_mode: 'virtual',
          contract_type: String(params[1]),
          payout: null,
          source: 'bot',
          bot_name: String(params[2]),
          symbol: String(params[3]),
          side: (params[4] as 'BUY' | 'SELL') || 'BUY',
          stake: Number(params[5]),
          entry_price: Number(params[6]),
          stop_loss: params[7] !== null && params[7] !== undefined ? Number(params[7]) : null,
          take_profit: params[8] !== null && params[8] !== undefined ? Number(params[8]) : null,
          exit_price: null,
          pnl: 0,
          contract_meta: parseJsonParam(params[9]),
          status: 'OPEN',
          opened_at: nowIso(),
          closed_at: null
        };
      } else {
        row = {
          id: crypto.randomUUID(),
          user_id: String(params[0]),
          connected_account_id: null,
          deriv_contract_id: null,
          execution_mode: 'virtual',
          contract_type: String(params[1]),
          payout: null,
          source: 'manual',
          bot_name: null,
          symbol: String(params[2]),
          side: (params[3] as 'BUY' | 'SELL') || 'BUY',
          stake: Number(params[4]),
          entry_price: Number(params[5]),
          stop_loss: params[6] !== null && params[6] !== undefined ? Number(params[6]) : null,
          take_profit: params[7] !== null && params[7] !== undefined ? Number(params[7]) : null,
          exit_price: null,
          pnl: 0,
          contract_meta: parseJsonParam(params[8]),
          status: 'OPEN',
          opened_at: nowIso(),
          closed_at: null
        };
      }
      virtualOrders.unshift(row);
      return { rows: [row] as unknown as T[], rowCount: 1 };
    }

    if (low.includes('from virtual_orders')) {
      if (low.includes("select distinct user_id from virtual_orders where status = 'open' and deriv_contract_id is not null")) {
        const ids = Array.from(
          new Set(virtualOrders.filter((o) => o.status === 'OPEN' && o.deriv_contract_id !== null).map((o) => o.user_id))
        );
        return { rows: ids.map((user_id) => ({ user_id })) as unknown as T[], rowCount: ids.length };
      }
      if (low.includes("where user_id = $1 and source = 'bot' and status = 'open'")) {
        const rows = virtualOrders.filter(
          (o) => o.user_id === String(params[0]) && o.source === 'bot' && o.status === 'OPEN'
        );
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      if (low.includes("where status = 'open' and symbol = $1")) {
        const rows = virtualOrders.filter((o) => o.status === 'OPEN' && o.symbol === String(params[0]));
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      if (low.includes("where id = $1 and user_id = $2 and status = 'open'")) {
        const rows = virtualOrders.filter(
          (o) => o.id === String(params[0]) && o.user_id === String(params[1]) && o.status === 'OPEN'
        );
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      if (low.includes("where user_id = $1 and status = 'open'")) {
        const rows = virtualOrders.filter((o) => o.user_id === String(params[0]) && o.status === 'OPEN');
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      if (low.includes('where user_id = $1')) {
        const rows = virtualOrders.filter((o) => o.user_id === String(params[0])).slice(0, 150);
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      if (low.includes("where status = 'open'")) {
        const rows = virtualOrders.filter((o) => o.status === 'OPEN');
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      if (low.includes('where id = $1')) {
        const rows = virtualOrders.filter((o) => o.id === String(params[0]));
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      if (low.includes('join users u')) {
        const rows = virtualOrders.slice(0, 120).map((o) => ({
          ...o,
          user_email: users.find((u) => u.id === o.user_id)?.email ?? ''
        }));
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
    }

    if (low.startsWith('update virtual_orders set')) {
      if (low.includes("status = 'closed_manual'")) {
        const o = virtualOrders.find((x) => x.id === String(params[2]));
        if (!o) return { rows: [], rowCount: 0 };
        o.status = 'CLOSED_MANUAL';
        o.exit_price = Number(params[0]);
        o.pnl = Number(params[1]);
        o.closed_at = nowIso();
        return { rows: [o] as unknown as T[], rowCount: 1 };
      }
      if (low.includes('where id = $4')) {
        const requireOpen = low.includes("and status = 'open'");
        const o = virtualOrders.find(
          (x) => x.id === String(params[3]) && (!requireOpen || x.status === 'OPEN')
        );
        if (!o) return { rows: [], rowCount: 0 };
        o.status = (params[0] as VirtualOrderRow['status']) || 'CLOSED_MANUAL';
        o.exit_price = Number(params[1]);
        o.pnl = Number(params[2]);
        o.closed_at = nowIso();
        return { rows: [o] as unknown as T[], rowCount: 1 };
      }
    }

    // WATCHLISTS
    if (low.includes('from watchlists')) {
      const rows = watchlists
        .filter((w) => w.user_id === String(params[0]))
        .map((w) => {
          const inst = marketInstruments.find((m) => m.symbol === w.symbol);
          return {
            ...w,
            display_name: inst?.display_name ?? w.symbol,
            market: inst?.market ?? 'synthetic_index'
          };
        });
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }
    if (low.startsWith('insert into watchlists')) {
      const userId = String(params[0]);
      const symbol = String(params[1]);
      if (!watchlists.some((w) => w.user_id === userId && w.symbol === symbol)) {
        const item: WatchlistRow = {
          id: crypto.randomUUID(),
          user_id: userId,
          symbol,
          sort_order: watchlists.length,
          created_at: nowIso()
        };
        watchlists.push(item);
        return { rows: [item] as unknown as T[], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (low.startsWith('delete from watchlists')) {
      const idx = watchlists.findIndex(
        (w) => w.user_id === String(params[0]) && w.symbol === String(params[1])
      );
      if (idx >= 0) watchlists.splice(idx, 1);
      return { rows: [], rowCount: idx >= 0 ? 1 : 0 };
    }

    // NOTIFICATIONS
    if (low.startsWith('insert into notifications')) {
      const n: NotificationRow = {
        id: crypto.randomUUID(),
        user_id: params[0] ? String(params[0]) : null,
        category: String(params[1] ?? 'system'),
        title: String(params[2] ?? ''),
        message: String(params[3] ?? ''),
        is_read: false,
        created_at: nowIso()
      };
      notifications.unshift(n);
      return { rows: [n] as unknown as T[], rowCount: 1 };
    }
    if (low.includes('from notifications')) {
      if (low.includes("category = 'announcement'")) {
        const rows = notifications.filter((n) => n.category === 'announcement').slice(0, 40);
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      const userId = String(params[0] ?? '');
      const rows = notifications.filter((n) => n.user_id === userId || n.user_id === null).slice(0, 60);
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }
    if (low.startsWith('update notifications set is_read = true')) {
      const n = notifications.find((x) => x.id === String(params[0]) && x.user_id === String(params[1]));
      if (n) n.is_read = true;
      return { rows: [], rowCount: n ? 1 : 0 };
    }

    // CONNECTED ACCOUNTS & AUTHORIZATIONS
    if (low.includes('from connected_accounts')) {
      if (low.includes('where ca.user_id = $1') || low.includes('where user_id = $1')) {
        const uid = String(params[0]);
        const rows = connectedAccounts
          .filter((a) => a.user_id === uid)
          .map((a) => {
            const auth = accountAuthorizations.find(
              (au) => au.connected_account_id === a.id && au.revoked_at === null
            );
            return { ...a, granted_scopes: auth?.granted_scopes ?? ['read'] };
          });
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      if (low.includes('join users u')) {
        const rows = connectedAccounts.map((a) => ({
          ...a,
          user_email: users.find((u) => u.id === a.user_id)?.email ?? '',
          granted_scopes: ['read']
        }));
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
    }
    if (low.startsWith('update connected_accounts set is_primary = false')) {
      connectedAccounts
        .filter((a) => a.user_id === String(params[0]))
        .forEach((a) => {
          a.is_primary = false;
        });
      return { rows: [], rowCount: 0 };
    }
    if (low.startsWith('insert into connected_accounts')) {
      const userId = String(params[0]);
      const loginId = String(params[1]);
      let acc = connectedAccounts.find((a) => a.user_id === userId && a.deriv_login_id === loginId);
      if (acc) {
        acc.account_type = (params[2] as 'demo' | 'real') || 'demo';
        acc.currency = String(params[3] || 'USD');
        acc.last_known_balance = Number(params[4] || 0);
        acc.landing_company = params[5] ? String(params[5]) : null;
        acc.connection_status = 'connected';
        acc.last_synced_at = nowIso();
        acc.updated_at = nowIso();
      } else {
        acc = {
          id: crypto.randomUUID(),
          user_id: userId,
          deriv_login_id: loginId,
          account_type: (params[2] as 'demo' | 'real') || 'demo',
          currency: String(params[3] || 'USD'),
          last_known_balance: Number(params[4] || 0),
          balance_locked_by_admin: false,
          landing_company: params[5] ? String(params[5]) : null,
          connection_status: 'connected',
          is_primary: Boolean(params[6]),
          last_synced_at: nowIso(),
          created_at: nowIso(),
          updated_at: nowIso()
        };
        connectedAccounts.push(acc);
      }
      return { rows: [acc] as unknown as T[], rowCount: 1 };
    }
    if (low.startsWith('insert into account_authorizations')) {
      const auth: AccountAuthorizationRow = {
        id: crypto.randomUUID(),
        connected_account_id: String(params[0]),
        user_id: String(params[1]),
        encrypted_token: String(params[2]),
        token_iv: String(params[3]),
        token_auth_tag: String(params[4]),
        granted_scopes: Array.isArray(params[5]) ? (params[5] as string[]) : ['read'],
        owner_consented_at: nowIso(),
        revoked_at: null,
        created_at: nowIso()
      };
      accountAuthorizations.unshift(auth);
      return { rows: [auth] as unknown as T[], rowCount: 1 };
    }

    // LOGS
    if (low.startsWith('insert into security_logs')) {
      securityLogs.unshift({ id: crypto.randomUUID(), created_at: nowIso(), params });
      return { rows: [], rowCount: 1 };
    }
    if (low.includes('from security_logs')) {
      return { rows: securityLogs.slice(0, 100) as unknown as T[], rowCount: securityLogs.length };
    }
    if (low.startsWith('insert into email_logs')) {
      emailLogs.unshift({ id: crypto.randomUUID(), sent_at: nowIso(), params });
      return { rows: [], rowCount: 1 };
    }
    if (low.includes('from email_logs')) {
      return { rows: emailLogs.slice(0, 80) as unknown as T[], rowCount: emailLogs.length };
    }
    if (low.startsWith('insert into administrator_audit_logs')) {
      adminAuditLogs.unshift({ id: crypto.randomUUID(), created_at: nowIso(), params });
      return { rows: [], rowCount: 1 };
    }
    if (low.includes('from administrator_audit_logs')) {
      return { rows: adminAuditLogs.slice(0, 100) as unknown as T[], rowCount: adminAuditLogs.length };
    }

    // BOT WORKSPACES
    if (low.includes('from bot_workspaces')) {
      if (low.includes('where id = $1 and user_id = $2')) {
        const rows = botWorkspaces.filter(
          (w) => w.id === String(params[0]) && w.user_id === String(params[1])
        );
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      const rows = botWorkspaces
        .filter((w) => w.user_id === String(params[0]) && w.is_active)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }
    if (low.startsWith('insert into bot_workspaces')) {
      const ws: BotWorkspaceRow = {
        id: crypto.randomUUID(),
        user_id: String(params[0]),
        name: String(params[1] ?? 'Untitled Strategy'),
        symbol: String(params[2] ?? 'R_100'),
        strategy_type: String(params[3] ?? 'custom'),
        xml_content: String(params[4] ?? ''),
        config_json: parseJsonParam(params[5]) ?? {},
        is_active: true,
        created_at: nowIso(),
        updated_at: nowIso()
      };
      botWorkspaces.unshift(ws);
      return { rows: [ws] as unknown as T[], rowCount: 1 };
    }
    if (low.startsWith('update bot_workspaces')) {
      const ws = botWorkspaces.find(
        (w) => w.id === String(params[4]) && w.user_id === String(params[5])
      );
      if (!ws) return { rows: [], rowCount: 0 };
      ws.name = String(params[0] ?? ws.name);
      ws.symbol = String(params[1] ?? ws.symbol);
      ws.xml_content = String(params[2] ?? ws.xml_content);
      ws.config_json = parseJsonParam(params[3]) ?? ws.config_json;
      ws.updated_at = nowIso();
      return { rows: [ws] as unknown as T[], rowCount: 1 };
    }
    if (low.startsWith('delete from bot_workspaces')) {
      const idx = botWorkspaces.findIndex(
        (w) => w.id === String(params[0]) && w.user_id === String(params[1])
      );
      if (idx >= 0) botWorkspaces.splice(idx, 1);
      return { rows: [], rowCount: idx >= 0 ? 1 : 0 };
    }

    // BOT RUNS
    if (low.includes('from bot_runs')) {
      const rows = botRuns
        .filter((r) => r.user_id === String(params[0]))
        .sort((a, b) => b.started_at.localeCompare(a.started_at))
        .slice(0, 50);
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }
    if (low.startsWith('insert into bot_runs')) {
      const run: BotRunRow = {
        id: crypto.randomUUID(),
        user_id: String(params[0]),
        workspace_id: params[1] ? String(params[1]) : null,
        connected_account_id: params[2] ? String(params[2]) : null,
        bot_name: String(params[3] ?? 'PipFlow Bot'),
        symbol: String(params[4] ?? 'R_100'),
        contract_type: params[5] ? String(params[5]) : null,
        account_type: String(params[6] ?? 'virtual'),
        status: 'running',
        config_json: parseJsonParam(params[7]) ?? {},
        trades_count: 0,
        wins: 0,
        losses: 0,
        session_pnl: 0,
        last_action: 'Bot run started',
        stop_reason: null,
        started_at: nowIso(),
        paused_at: null,
        stopped_at: null
      };
      botRuns.unshift(run);
      return { rows: [run] as unknown as T[], rowCount: 1 };
    }
    if (low.startsWith('update bot_runs set')) {
      const run = botRuns.find((r) => r.id === String(params[0]));
      if (!run) return { rows: [], rowCount: 0 };
      if (low.includes("status = 'paused'")) {
        run.status = 'paused';
        run.paused_at = nowIso();
        run.last_action = String(params[1] ?? 'Paused by user');
      } else if (low.includes("status = 'running'")) {
        run.status = 'running';
        run.paused_at = null;
        run.last_action = String(params[1] ?? 'Resumed by user');
      } else if (low.includes('stopped_at = now()')) {
        run.status = (params[1] as BotRunRow['status']) || 'stopped';
        run.stop_reason = params[2] ? String(params[2]) : null;
        run.trades_count = Number(params[3] ?? run.trades_count);
        run.wins = Number(params[4] ?? run.wins);
        run.losses = Number(params[5] ?? run.losses);
        run.session_pnl = Number(params[6] ?? run.session_pnl);
        run.last_action = params[7] ? String(params[7]) : run.last_action;
        run.stopped_at = nowIso();
      } else {
        run.trades_count = Number(params[1] ?? run.trades_count);
        run.wins = Number(params[2] ?? run.wins);
        run.losses = Number(params[3] ?? run.losses);
        run.session_pnl = Number(params[4] ?? run.session_pnl);
        run.last_action = params[5] ? String(params[5]) : run.last_action;
      }
      return { rows: [run] as unknown as T[], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  return {
    query,
    connect: async () => ({
      query,
      release: () => {}
    }),
    on: () => {}
  };
}
