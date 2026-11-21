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

function sanitizeBrandingValue(value: Record<string, unknown>) {
  const rawName = typeof value.appName === 'string' ? value.appName : DEFAULT_PUBLIC_SETTINGS.branding.appName;
  const rawTicker = typeof value.tickerText === 'string' ? value.tickerText : DEFAULT_PUBLIC_SETTINGS.branding.tickerText;
  return {
    ...value,
    appName: rawName.replace(/TradeDeriv/gi, 'Pipflowtrades'),
    tickerText: rawTicker
      .replace(/TRADEDERIV/g, 'PIPFLOWTRADES')
      .replace(/TradeDeriv/gi, 'Pipflowtrades')
  };
}

function sanitizeSiteControlsValue(value: Record<string, unknown>) {
  const rawDisclaimer =
    typeof value.riskDisclaimerText === 'string'
      ? value.riskDisclaimerText
      : DEFAULT_PUBLIC_SETTINGS.site_controls.riskDisclaimerText;
  return {
    ...value,
    riskDisclaimerText: rawDisclaimer.replace(/TradeDeriv/gi, 'Pipflowtrades')
  };
}

export async function getPublicSettings() {
  if (!isDatabaseConfigured) return DEFAULT_PUBLIC_SETTINGS;
  try {
    const res = await pool.query(
      `SELECT setting_key, setting_value FROM application_settings WHERE is_secret = FALSE`
    );
    const map: Record<string, unknown> = { ...DEFAULT_PUBLIC_SETTINGS };
    for (const row of res.rows) {
      if (row.setting_key === 'branding' && row.setting_value && typeof row.setting_value === 'object') {
        map[row.setting_key] = sanitizeBrandingValue(row.setting_value as Record<string, unknown>);
      } else if (
        row.setting_key === 'site_controls' &&
        row.setting_value &&
        typeof row.setting_value === 'object'
      ) {
        map[row.setting_key] = sanitizeSiteControlsValue(row.setting_value as Record<string, unknown>);
      } else {
        map[row.setting_key] = row.setting_value;
      }
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
