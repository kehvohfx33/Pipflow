import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../services/api';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'trader' | 'admin';
  is_email_verified: boolean;
  virtual_workspace_balance: number;
  preferred_currency: string;
  local_currency: string;
}

export interface DerivAccountSummary {
  id: string;
  deriv_login_id: string;
  account_type: 'demo' | 'real';
  currency: string;
  last_known_balance: number;
  landing_company: string | null;
  connection_status: 'connected' | 'disconnected' | 'revoked' | 'error';
  is_primary: boolean;
  last_synced_at: string | null;
  granted_scopes?: string[];
}

export interface BrandingSettings {
  appName: string;
  tickerText: string;
  kesRate: number;
}

export interface GlobalSiteSettings {
  maintenanceMode: boolean;
  allowRegistration: boolean;
  defaultVirtualBalance: number;
}

export interface SiteControlsSettings {
  showDepositWithdraw: boolean;
  depositUrl: string;
  withdrawUrl: string;
  cashierNote: string;
  riskDisclaimerText: string;
  enabledTabs: string[];
}

export interface SharedBotConfig {
  botName: string;
  marketGroup: string;
  subMarket: string;
  symbol: string;
  alternateMarkets: boolean;
  alternateMode: string;
  tradeTypeCategory: string;
  tradeType: 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD' | 'CALL' | 'MULTUP';
  contractTypeLabel: 'Over' | 'Under' | 'Even' | 'Odd' | 'Rise' | 'Fall' | 'Multiplier';
  candleInterval: string;
  restartOnError: boolean;
  virtualHook: boolean;
  virtualHookLosses: number;
  restartLastTradeOnError: boolean;
  stake: number;
  initialPrediction: number;
  recoveryPrediction: number;
  entryPointDigit: number;
  martingale: number;
  numberOfWins: number;
  stopLoss: number;
  useMartingale: boolean;
  durationUnit: 't' | 's' | 'm' | 'h' | 'd';
  duration: number;
  tradeEachTick: boolean;
  entrySignalMode: boolean;
  conditionJoin: 'or' | 'and';
  conditionLookback: number;
  conditionComparator: '>=' | '<=' | '==' | '!=' | '>' | '<';
  conditionDigit: number;
  purchaseAction: 'Over' | 'Under' | 'Even' | 'Odd' | 'Rise' | 'Fall';
  allowBulkPurchase: boolean;
  bulkTradesCount: number;
  tpPct: number;
  slPct: number;
}

export const DEFAULT_BOT_CONFIG: SharedBotConfig = {
  botName: 'Pipflow_Over_Under_Pro',
  marketGroup: 'synthetics',
  subMarket: 'Continuous Indices',
  symbol: '1HZ90V',
  alternateMarkets: false,
  alternateMode: 'Sequential',
  tradeTypeCategory: 'Digits',
  tradeType: 'DIGITUNDER',
  contractTypeLabel: 'Under',
  candleInterval: '1 minute',
  restartOnError: false,
  virtualHook: false,
  virtualHookLosses: 1,
  restartLastTradeOnError: true,
  stake: 0.5,
  initialPrediction: 8,
  recoveryPrediction: 5,
  entryPointDigit: 0,
  martingale: 2,
  numberOfWins: 5,
  stopLoss: 50,
  useMartingale: true,
  durationUnit: 't',
  duration: 1,
  tradeEachTick: false,
  entrySignalMode: true,
  conditionJoin: 'or',
  conditionLookback: 1,
  conditionComparator: '>=',
  conditionDigit: 8,
  purchaseAction: 'Under',
  allowBulkPurchase: false,
  bulkTradesCount: 1,
  tpPct: 0.08,
  slPct: 0.05
};

const DEFAULT_SITE_CONTROLS: SiteControlsSettings = {
  showDepositWithdraw: true,
  depositUrl: 'https://app.deriv.com/cashier/deposit',
  withdrawUrl: 'https://app.deriv.com/cashier/withdrawal',
  cashierNote: 'Instant Deriv Cashier & M-Pesa / KES Agent Settlement',
  riskDisclaimerText:
    'Pipflowtrades connects directly to Official Deriv WebSocket endpoints for live market quotes, historical candles, account balance synchronization, and direct order execution through your authorized Deriv Demo or Real account. Trading synthetic and financial derivatives carries financial risk.',
  enabledTabs: [
    'dashboard',
    'markets',
    'trading_view',
    'rise_fall',
    'digits',
    'accumulators',
    'charts',
    'bot_builder',
    'freebots',
    'analysistool',
    'signals',
    'automated_bots',
    'wallets',
    'portfolio',
    'reports',
    'analytics',
    'notifications',
    'settings',
    'bulk_trader',
    'trading_plan',
    'copy_trading',
    'dtrader'
  ]
};

interface AuthContextValue {
  token: string | null;
  user: UserProfile | null;
  derivAccounts: DerivAccountSummary[];
  activeDerivAccount: DerivAccountSummary | null;
  setActiveAccountId: (id: string | null) => void;
  botGateUnlocked: boolean;
  setBotGateUnlocked: (v: boolean) => void;
  branding: BrandingSettings;
  globalSettings: GlobalSiteSettings;
  siteControls: SiteControlsSettings;
  botConfig: SharedBotConfig;
  setBotConfig: React.Dispatch<React.SetStateAction<SharedBotConfig>>;
  fastExecution: boolean;
  setFastExecution: (v: boolean) => void;
  darkTheme: boolean;
  setDarkTheme: (v: boolean) => void;
  currency: 'USD' | 'KSH';
  setCurrency: (c: 'USD' | 'KSH') => void;
  orderVersion: number;
  bumpOrderVersion: () => void;
  setSession: (token: string, user: UserProfile, freshAccounts?: DerivAccountSummary[]) => void;
  refreshProfile: () => Promise<void>;
  refreshDerivAccounts: (sync?: boolean) => Promise<void>;
  refreshBranding: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('pipflow_token'));
  const [user, setUser] = useState<UserProfile | null>(() => {
    const raw = localStorage.getItem('pipflow_user');
    try {
      return raw ? (JSON.parse(raw) as UserProfile) : null;
    } catch {
      return null;
    }
  });
  const [derivAccounts, setDerivAccounts] = useState<DerivAccountSummary[]>([]);
  const [activeAccountId, setActiveAccountIdState] = useState<string | null>(() =>
    localStorage.getItem('pipflow_active_account_id')
  );
  const [botGateUnlocked, setBotGateUnlocked] = useState<boolean>(true);
  const [darkTheme, setDarkThemeState] = useState<boolean>(
    () => localStorage.getItem('pipflow_dark') === 'true'
  );
  const [currency, setCurrencyState] = useState<'USD' | 'KSH'>(() =>
    localStorage.getItem('pipflow_currency') === 'KSH' ? 'KSH' : 'USD'
  );
  const [orderVersion, setOrderVersion] = useState(0);
  const [fastExecution, setFastExecution] = useState<boolean>(true);

  const setActiveAccountId = useCallback((id: string | null) => {
    setActiveAccountIdState(id);
    if (id) {
      localStorage.setItem('pipflow_active_account_id', id);
    } else {
      localStorage.removeItem('pipflow_active_account_id');
    }
  }, []);

  const setCurrency = useCallback((next: 'USD' | 'KSH') => {
    setCurrencyState(next);
    localStorage.setItem('pipflow_currency', next);
  }, []);

  const bumpOrderVersion = useCallback(() => {
    setOrderVersion((v) => v + 1);
  }, []);
  const [botConfig, setBotConfig] = useState<SharedBotConfig>(() => {
    try {
      const saved = localStorage.getItem('pipflow_bot_config');
      return saved ? { ...DEFAULT_BOT_CONFIG, ...(JSON.parse(saved) as Partial<SharedBotConfig>) } : DEFAULT_BOT_CONFIG;
    } catch {
      return DEFAULT_BOT_CONFIG;
    }
  });
  const [branding, setBranding] = useState<BrandingSettings>({
    appName: 'Pipflowtrades',
    tickerText: 'WELCOME TO PIPFLOWTRADES — YOUR HUB FOR TRADING KNOWLEDGE, DERIV INDICES, AND MORE',
    kesRate: 130
  });
  const [globalSettings, setGlobalSettings] = useState<GlobalSiteSettings>({
    maintenanceMode: false,
    allowRegistration: true,
    defaultVirtualBalance: 10000
  });
  const [siteControls, setSiteControls] = useState<SiteControlsSettings>(DEFAULT_SITE_CONTROLS);

  useEffect(() => {
    try {
      localStorage.setItem('pipflow_bot_config', JSON.stringify(botConfig));
    } catch {
      // Ignore storage quota errors
    }
  }, [botConfig]);

  const setDarkTheme = (val: boolean) => {
    setDarkThemeState(val);
    localStorage.setItem('pipflow_dark', String(val));
    document.documentElement.classList.toggle('dark', val);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkTheme);
  }, [darkTheme]);

  const refreshBranding = useCallback(async () => {
    try {
      const res = await apiFetch<{
        branding?: Partial<BrandingSettings>;
        global_settings?: Partial<GlobalSiteSettings>;
        site_controls?: Partial<SiteControlsSettings>;
      }>('/settings/public');
      if (res.branding) {
        setBranding((prev) => ({
          appName: res.branding?.appName || prev.appName,
          tickerText: res.branding?.tickerText || prev.tickerText,
          kesRate: Number(res.branding?.kesRate || prev.kesRate)
        }));
      }
      if (res.global_settings) {
        setGlobalSettings((prev) => ({
          maintenanceMode: Boolean(res.global_settings?.maintenanceMode),
          allowRegistration: res.global_settings?.allowRegistration !== false,
          defaultVirtualBalance: Number(res.global_settings?.defaultVirtualBalance ?? prev.defaultVirtualBalance)
        }));
      }
      if (res.site_controls) {
        setSiteControls((prev) => ({
          showDepositWithdraw: res.site_controls?.showDepositWithdraw !== false,
          depositUrl: res.site_controls?.depositUrl || prev.depositUrl,
          withdrawUrl: res.site_controls?.withdrawUrl || prev.withdrawUrl,
          cashierNote: res.site_controls?.cashierNote || prev.cashierNote,
          riskDisclaimerText: res.site_controls?.riskDisclaimerText || prev.riskDisclaimerText,
          enabledTabs:
            Array.isArray(res.site_controls?.enabledTabs) && res.site_controls!.enabledTabs!.length > 0
              ? Array.from(new Set([...res.site_controls!.enabledTabs!, ...DEFAULT_SITE_CONTROLS.enabledTabs]))
              : prev.enabledTabs
        }));
      }
    } catch {
      // Ignore transient errors
    }
  }, []);

  useEffect(() => {
    refreshBranding();
  }, [refreshBranding]);

  const logout = useCallback(() => {
    localStorage.removeItem('pipflow_token');
    localStorage.removeItem('pipflow_user');
    localStorage.removeItem('pipflow_active_account_id');
    localStorage.removeItem('pipflow_active_tab');
    localStorage.removeItem('pipflow_active_symbol');
    localStorage.removeItem('pipflow_chart_granularity');
    localStorage.removeItem('pipflow_order_mode');
    setToken(null);
    setUser(null);
    setDerivAccounts([]);
    setActiveAccountIdState(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const activeToken = localStorage.getItem('pipflow_token') || token;
    if (!activeToken) return;
    try {
      const res = await apiFetch<{ user?: UserProfile }>('/auth/me');
      if (res?.user) {
        setUser(res.user);
        localStorage.setItem('pipflow_user', JSON.stringify(res.user));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
      }
    }
  }, [token, logout]);

  const refreshDerivAccounts = useCallback(async (sync = false) => {
    const activeToken = localStorage.getItem('pipflow_token') || token;
    if (!activeToken) return;
    try {
      const res = await apiFetch<{ accounts?: DerivAccountSummary[] }>(
        `/deriv/accounts${sync ? '?sync=1' : ''}`
      );
      if (Array.isArray(res?.accounts)) {
        setDerivAccounts(res.accounts);
      }
    } catch {
      // Ignore if DB not configured
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      refreshProfile();
      refreshDerivAccounts(false);
    }
  }, [token, refreshProfile, refreshDerivAccounts]);

  const setSession = (
    newToken: string,
    newUser: UserProfile,
    freshAccounts?: DerivAccountSummary[]
  ) => {
    localStorage.setItem('pipflow_token', newToken);
    localStorage.setItem('pipflow_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    if (Array.isArray(freshAccounts)) {
      setDerivAccounts(freshAccounts);
      if (activeAccountId && !freshAccounts.some((a) => a.id === activeAccountId)) {
        localStorage.removeItem('pipflow_active_account_id');
        setActiveAccountIdState(null);
      }
    }
  };

  const safeDerivAccounts = Array.isArray(derivAccounts) ? derivAccounts : [];

  const activeDerivAccount =
    safeDerivAccounts.find((a) => a.id === activeAccountId) ??
    safeDerivAccounts.find((a) => a.account_type === 'real' && a.connection_status === 'connected') ??
    safeDerivAccounts.find((a) => a.is_primary) ??
    safeDerivAccounts[0] ??
    null;

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        derivAccounts: safeDerivAccounts,
        activeDerivAccount,
        setActiveAccountId,
        botGateUnlocked,
        setBotGateUnlocked,
        branding,
        globalSettings,
        siteControls,
        botConfig,
        setBotConfig,
        fastExecution,
        setFastExecution,
        darkTheme,
        setDarkTheme,
        currency,
        setCurrency,
        orderVersion,
        bumpOrderVersion,
        setSession,
        refreshProfile,
        refreshDerivAccounts,
        refreshBranding,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
