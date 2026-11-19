import { isDatabaseConfigured, pool } from '../database/pool';

const DEFAULT_PUBLIC_SETTINGS = {
  branding: {
    appName: 'Pipflowtrades',
    tickerText: 'WELCOME TO PIPFLOWTRADES — YOUR HUB FOR TRADING KNOWLEDGE, DERIV INDICES, AND MORE',
    kesRate: 130
  },
  global_settings: {
    maintenanceMode: false,
    allowRegistration: true,
    defaultVirtualBalance: 10000
  },
  site_controls: {
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
  }
};

export async function getPublicSettings() {
  if (!isDatabaseConfigured) return DEFAULT_PUBLIC_SETTINGS;
  try {
    const res = await pool.query(
      `SELECT setting_key, setting_value FROM application_settings WHERE is_secret = FALSE`
    );
    const map: Record<string, unknown> = { ...DEFAULT_PUBLIC_SETTINGS };
    for (const row of res.rows) {
      map[row.setting_key] = row.setting_value;
    }
    return map;
  } catch {
    return DEFAULT_PUBLIC_SETTINGS;
  }
}

export async function upsertSetting(key: string, value: unknown, isSecret: boolean, adminId: string) {
  await pool.query(
    `INSERT INTO application_settings (setting_key, setting_value, is_secret, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, NOW())
     ON CONFLICT (setting_key) DO UPDATE SET
       setting_value = EXCLUDED.setting_value,
       is_secret = EXCLUDED.is_secret,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [key, JSON.stringify(value), isSecret, adminId]
  );
}
