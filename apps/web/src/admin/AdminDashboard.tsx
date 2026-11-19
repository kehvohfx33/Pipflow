import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield,
  ArrowLeft,
  Users,
  Activity,
  Mail,
  Bell,
  KeyRound,
  Link2,
  RefreshCw,
  FileText,
  DollarSign,
  Bot,
  Sliders,
  LogOut,
  Menu,
  X,
  Plus,
  Trash2,
  Edit3,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Copy
} from 'lucide-react';
import { apiFetch } from '../services/api';
import { useAuth, UserProfile } from '../contexts/AuthContext';

interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  role: 'trader' | 'admin';
  virtual_workspace_balance: number;
  is_active: boolean;
  created_at: string;
}

interface AdminConnectedAccount {
  id: string;
  user_id: string;
  user_email: string;
  deriv_login_id: string;
  account_type: string;
  currency: string;
  last_known_balance: number;
  balance_locked_by_admin?: boolean;
  connection_status: string;
  granted_scopes?: string[];
}

interface AdminStrategyRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  symbol: string;
  is_premium: boolean;
  strategy_config: { stake?: number; tpPct?: number; slPct?: number; martingale?: number; tradeType?: string };
}

interface AdminOrderRow {
  id: string;
  user_id: string;
  user_email: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  stake: number;
  entry_price: number;
  exit_price: number | null;
  pnl: number;
  status: string;
  execution_mode: string;
  contract_type: string;
  deriv_contract_id: number | null;
  opened_at: string;
}

interface AdminAnnouncementRow {
  id: string;
  title: string;
  message: string;
  created_at: string;
}

interface AdminOverviewData {
  adminAccount: { id: string; email: string; full_name: string } | null;
  users: AdminUserRow[];
  connectedAccounts: AdminConnectedAccount[];
  derivDiagnostics: {
    connected: boolean;
    lastConnectedAt: string | null;
    reconnectCount: number;
    lastError: string | null;
  };
  auditLogs: Array<{ id: string; action: string; target_id: string | null; ip_address: string | null; created_at: string }>;
  securityLogs: Array<{ id: string; event_type: string; severity: string; ip_address: string | null; created_at: string }>;
  emailLogs: Array<{ id: string; recipient_email: string; template_type: string; status: string; sent_at: string }>;
  settings: Array<{ setting_key: string; setting_value: Record<string, unknown> }>;
  strategies: AdminStrategyRow[];
  recentOrders: AdminOrderRow[];
  announcements: AdminAnnouncementRow[];
  commissionConfig?: {
    appId: string;
    appName: string;
    domain: string;
    targetMarkupPct: number;
    affiliateUrl: string;
    sidcCode: string;
    payoutAccount: string;
    hasAdminToken: boolean;
  };
}

interface CommissionsResponse {
  dateFrom: string;
  dateTo: string;
  config: {
    appId: string;
    appName: string;
    domain: string;
    targetMarkupPct: number;
    affiliateUrl: string;
    sidcCode: string;
    payoutAccount: string;
    hasAdminToken: boolean;
    tokenConnectedViaOAuth?: boolean;
    tokenConnectedAt?: string | null;
  };
  diagnostics?: {
    redirectUri: string;
    configuredAppId: string;
    isDefaultPublicAppId: boolean;
    usesNewOAuth2: boolean;
    hasOwnerToken: boolean;
    tokenType: 'oauth2' | 'pat' | 'legacy' | 'none';
    restHttpStatus: number | null;
    requiredScope: string;
    restEndpoint: string;
    payoutSchedule: string;
  };
  derivReport: {
    totalAppMarkupUsd: number;
    totalVolumeUsd: number;
    totalPayoutUsd: number;
    totalTransactionsCount: number;
    totalClientCount: number;
    tokenType?: 'oauth2' | 'pat' | 'legacy' | 'none';
    restHttpStatus?: number | null;
    meta?: {
      endpoint?: string;
      request_id?: string;
      response_time_ms?: number;
      timestamp?: string;
    };
    breakdownByAppId: Array<{
      app_id: number | string;
      app_markup_usd: number;
      volume_usd: number;
      payout_usd: number;
      contract_count: number;
      client_count: number;
      transactions_count?: number;
    }>;
    transactions: Array<{
      app_id: number;
      app_markup_usd: number;
      app_markup_value: number;
      client_loginid: string;
      transaction_id: number;
      transaction_time: string;
    }>;
    registeredApps: Array<{
      app_id: number;
      name: string;
      app_markup_percentage?: number;
      redirect_uri?: string;
      verification_uri?: string;
    }>;
    authorizedAccount?: { loginid: string; email?: string; currency?: string; scopes?: string[] };
    error?: string;
  };
  platformVolume: {
    totalOrders: number;
    realOrders: number;
    demoOrders: number;
    realVolumeUsd: number;
    totalVolumeUsd: number;
    realClientPnl: number;
  };
}

type AdminSectionTab = 'commissions' | 'connections' | 'users' | 'strategies' | 'orders' | 'settings' | 'logs';

export const AdminDashboard: React.FC = () => {
  const { token, user, setSession, refreshBranding, refreshProfile, refreshDerivAccounts, logout } = useAuth();
  const navigate = useNavigate();

  const [activeSection, setActiveSection] = useState<AdminSectionTab>('commissions');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bootstrapChecked, setBootstrapChecked] = useState(false);
  const [adminInitialized, setAdminInitialized] = useState(true);
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Auth inputs
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPwd, setLoginPwd] = useState('');
  const [fullName, setFullName] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Commission state
  const todayStr = new Date().toISOString().slice(0, 10);
  const thirtyAgoStr = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(thirtyAgoStr);
  const [dateTo, setDateTo] = useState(todayStr);
  const [commData, setCommData] = useState<CommissionsResponse | null>(null);
  const [loadingComm, setLoadingComm] = useState(false);
  const [commAppId, setCommAppId] = useState('');
  const [commAppName, setCommAppName] = useState('TradeDeriv');
  const [commDomain, setCommDomain] = useState('https://tradederiv-eiiy.onrender.com');
  const [commTargetPct, setCommTargetPct] = useState(2.0);
  const [commAffiliateUrl, setCommAffiliateUrl] = useState('');
  const [commSidc, setCommSidc] = useState('');
  const [commPayoutAcc, setCommPayoutAcc] = useState('');
  const [commAdminToken, setCommAdminToken] = useState('');
  const [connectingCommOAuth, setConnectingCommOAuth] = useState(false);

  // Connections state
  const [editingAccId, setEditingAccId] = useState<string | null>(null);
  const [editAccBalanceVal, setEditAccBalanceVal] = useState('');
  const [connectTargetUserId, setConnectTargetUserId] = useState('');
  const [connectApiToken, setConnectApiToken] = useState('');
  const [connectBusy, setConnectBusy] = useState(false);

  // Users CRUD state
  const [userSearch, setUserSearch] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'trader' | 'admin'>('trader');
  const [newUserBalance, setNewUserBalance] = useState(10000);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserBalance, setEditUserBalance] = useState('');
  const [editUserRole, setEditUserRole] = useState<'trader' | 'admin'>('trader');
  const [editUserPassword, setEditUserPassword] = useState('');

  // Strategies CRUD state
  const [newStratName, setNewStratName] = useState('');
  const [newStratCat, setNewStratCat] = useState('Free Bots');
  const [newStratSym, setNewStratSym] = useState('R_100');
  const [newStratStake, setNewStratStake] = useState(10);
  const [newStratTp, setNewStratTp] = useState(0.08);
  const [newStratSl, setNewStratSl] = useState(0.05);
  const [newStratPremium, setNewStratPremium] = useState(true);
  const [editingStratId, setEditingStratId] = useState<string | null>(null);
  const [editStratName, setEditStratName] = useState('');
  const [editStratSym, setEditStratSym] = useState('');
  const [editStratStake, setEditStratStake] = useState(10);

  // Settings, Site Controls & Announcements CRUD state
  const [adminEmailInput, setAdminEmailInput] = useState('');
  const [adminPwdInput, setAdminPwdInput] = useState('');
  const [tickerText, setTickerText] = useState('');
  const [kesRate, setKesRate] = useState(130);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [defaultVirtualBalance, setDefaultVirtualBalance] = useState(10000);
  const [showDepositWithdraw, setShowDepositWithdraw] = useState(true);
  const [depositUrl, setDepositUrl] = useState('https://app.deriv.com/cashier/deposit');
  const [withdrawUrl, setWithdrawUrl] = useState('https://app.deriv.com/cashier/withdrawal');
  const [cashierNote, setCashierNote] = useState('Instant Deriv Cashier & M-Pesa / KES Agent Settlement');
  const [riskDisclaimerText, setRiskDisclaimerText] = useState('');
  const [enabledTabs, setEnabledTabs] = useState<string[]>([
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
  ]);
  const [announceTitle, setAnnounceTitle] = useState('');
  const [announceMsg, setAnnounceMsg] = useState('');
  const [sendEmail, setSendEmail] = useState(true);

  useEffect(() => {
    apiFetch<{ initialized: boolean }>('/admin/bootstrap-status')
      .then((res) => setAdminInitialized(res.initialized))
      .catch((err) => {
        setError((err as Error).message || 'Unable to verify database bootstrap status');
      })
      .finally(() => setBootstrapChecked(true));
  }, []);

  useEffect(() => {
    const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
    const params = new URLSearchParams(hashQuery);
    if (params.get('commission_connected') === '1') {
      try {
        sessionStorage.setItem('pf_secret_console', '1');
      } catch {
        // ignore
      }
      setNotice('Deriv Owner token (application_read) connected securely via OAuth2. Live statistics refreshed.');
      setActiveSection('commissions');
      window.history.replaceState({}, document.title, window.location.pathname + '#/_console');
    }
  }, []);

  const loadCommissions = (from = dateFrom, to = dateTo) => {
    if (!token || user?.role !== 'admin') return;
    setLoadingComm(true);
    apiFetch<CommissionsResponse>(
      `/admin/commissions?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`
    )
      .then((res) => {
        setCommData(res);
        if (res.config) {
          setCommAppId(res.config.appId || '');
          setCommAppName(res.config.appName || 'TradeDeriv');
          setCommDomain(res.config.domain || 'https://tradederiv-eiiy.onrender.com');
          setCommTargetPct(Number(res.config.targetMarkupPct ?? 2.0));
          setCommAffiliateUrl(res.config.affiliateUrl || '');
          setCommSidc(res.config.sidcCode || '');
          setCommPayoutAcc(res.config.payoutAccount || '');
        }
      })
      .catch(() => {})
      .finally(() => setLoadingComm(false));
  };

  const loadOverview = () => {
    if (!token || user?.role !== 'admin') return;
    setError('');
    setLoadingOverview(true);
    apiFetch<AdminOverviewData>('/admin/overview')
      .then((overview) => {
        setData(overview);
        if (overview.adminAccount?.email) {
          setAdminEmailInput(overview.adminAccount.email);
        }
        const brandingRow = overview.settings?.find((s) => s.setting_key === 'branding')?.setting_value as
          | { tickerText?: string; kesRate?: number }
          | undefined;
        if (brandingRow) {
          if (brandingRow.tickerText) setTickerText(brandingRow.tickerText);
          if (brandingRow.kesRate) setKesRate(Number(brandingRow.kesRate));
        }
        const globalRow = overview.settings?.find((s) => s.setting_key === 'global_settings')?.setting_value as
          | { maintenanceMode?: boolean; allowRegistration?: boolean; defaultVirtualBalance?: number }
          | undefined;
        if (globalRow) {
          setMaintenanceMode(Boolean(globalRow.maintenanceMode));
          setAllowRegistration(globalRow.allowRegistration !== false);
          setDefaultVirtualBalance(Number(globalRow.defaultVirtualBalance ?? 10000));
        }
        const siteControlsRow = overview.settings?.find((s) => s.setting_key === 'site_controls')?.setting_value as
          | {
              showDepositWithdraw?: boolean;
              depositUrl?: string;
              withdrawUrl?: string;
              cashierNote?: string;
              riskDisclaimerText?: string;
              enabledTabs?: string[];
            }
          | undefined;
        if (siteControlsRow) {
          setShowDepositWithdraw(siteControlsRow.showDepositWithdraw !== false);
          if (siteControlsRow.depositUrl) setDepositUrl(siteControlsRow.depositUrl);
          if (siteControlsRow.withdrawUrl) setWithdrawUrl(siteControlsRow.withdrawUrl);
          if (siteControlsRow.cashierNote) setCashierNote(siteControlsRow.cashierNote);
          if (siteControlsRow.riskDisclaimerText) setRiskDisclaimerText(siteControlsRow.riskDisclaimerText);
          if (Array.isArray(siteControlsRow.enabledTabs) && siteControlsRow.enabledTabs.length > 0) {
            setEnabledTabs(siteControlsRow.enabledTabs);
          }
        }
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingOverview(false));
  };

  useEffect(() => {
    loadOverview();
    loadCommissions();
  }, [token, user?.role]);

  const handleAdminAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setAuthSubmitting(true);
    try {
      const endpoint = adminInitialized ? '/admin/login' : '/admin/bootstrap';
      const res = await apiFetch<{ token: string; user: UserProfile }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          email: loginEmail,
          password: loginPwd,
          ...(adminInitialized ? {} : { fullName })
        })
      });
      setSession(res.token, res.user);
      setAdminInitialized(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleExitAdmin = (signOutCompletely: boolean) => {
    try {
      sessionStorage.removeItem('pf_secret_console');
    } catch {
      // ignore
    }
    if (signOutCompletely) {
      logout();
    }
    navigate('/');
  };

  if (!token || user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sky-400 font-bold text-base">
              <Shield className="w-5 h-5" />
              <span>
                {!bootstrapChecked
                  ? 'Checking Database Setup...'
                  : adminInitialized
                    ? 'TradeDeriv Owner Console'
                    : 'Initialize Owner Account'}
              </span>
            </div>
            <button type="button" onClick={() => navigate('/')} className="text-xs text-slate-400 hover:text-white">
              Return to Site
            </button>
          </div>
          <p className="text-xs text-slate-400">
            {!bootstrapChecked
              ? 'Verifying PostgreSQL owner configuration...'
              : adminInitialized
                ? 'Sign in with your PostgreSQL owner/administrator credentials to manage live Deriv commissions, users, bots, and orders.'
                : 'No administrator exists yet. Set your platform owner email and password below to initialize the console.'}
          </p>
          {error && (
            <div className="rounded-lg bg-rose-950/60 border border-rose-700 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}
          <form onSubmit={handleAdminAuth} className="space-y-3">
            {bootstrapChecked && !adminInitialized && (
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Owner Full Name"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm"
              />
            )}
            <input
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="Owner Email"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm"
              required
            />
            <input
              type="password"
              value={loginPwd}
              onChange={(e) => setLoginPwd(e.target.value)}
              placeholder={!bootstrapChecked || adminInitialized ? 'Owner Password' : 'Create Owner Password (min 8 chars)'}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm"
              required
            />
            <button
              type="submit"
              disabled={!bootstrapChecked || authSubmitting}
              className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 font-bold text-sm"
            >
              {!bootstrapChecked
                ? 'Checking Setup...'
                : authSubmitting
                  ? 'Authenticating...'
                  : adminInitialized
                    ? 'Sign In to Owner Console'
                    : 'Save Owner Credentials'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const usersList = Array.isArray(data?.users) ? data!.users : [];
  const accountsList = Array.isArray(data?.connectedAccounts) ? data!.connectedAccounts : [];
  const strategiesList = Array.isArray(data?.strategies) ? data!.strategies : [];
  const recentOrders = Array.isArray(data?.recentOrders) ? data!.recentOrders : [];
  const announcementsList = Array.isArray(data?.announcements) ? data!.announcements : [];

  const filteredUsers = userSearch.trim()
    ? usersList.filter(
        (u) =>
          u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
          u.full_name?.toLowerCase().includes(userSearch.toLowerCase())
      )
    : usersList;

  const realCount = accountsList.filter((a) => a.account_type === 'real' && a.connection_status === 'connected').length;
  const demoCount = accountsList.filter((a) => a.account_type === 'demo' && a.connection_status === 'connected').length;

  const navItems: Array<{ id: AdminSectionTab; label: string; icon: React.FC<{ className?: string }> }> = [
    { id: 'commissions', label: 'Commissions & Markup', icon: DollarSign },
    { id: 'connections', label: 'Deriv Accounts', icon: Link2 },
    { id: 'users', label: 'Users CRUD', icon: Users },
    { id: 'strategies', label: 'Bots & Strategies', icon: Bot },
    { id: 'orders', label: 'Orders & Trades', icon: Activity },
    { id: 'settings', label: 'Site & Announcements', icon: Sliders },
    { id: 'logs', label: 'Audit & Security', icon: FileText }
  ];

  const SidebarContent = (
    <div className="flex flex-col h-full justify-between p-4 bg-slate-900 text-white">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-black text-sm tracking-tight">
            <Shield className="w-5 h-5 text-sky-400" />
            <span>Pipflow Owner</span>
          </div>
          <button type="button" onClick={() => setDrawerOpen(false)} className="lg:hidden text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveSection(item.id);
                  setDrawerOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition text-left ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-2 border-t border-slate-800 pt-4 text-xs">
        <div className="px-2 text-[11px] text-slate-400 truncate">{data?.adminAccount?.email ?? user.email}</div>
        <button
          type="button"
          onClick={() => handleExitAdmin(false)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 font-semibold"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Return to Trader Site
        </button>
        <button
          type="button"
          onClick={() => handleExitAdmin(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 font-semibold"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign Out Owner
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-800 sticky top-0 h-screen">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 h-full shadow-2xl">{SidebarContent}</div>
          <div className="flex-1 bg-black/60" onClick={() => setDrawerOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Sticky Executive Header */}
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="font-black text-sm sm:text-base truncate">
                {navItems.find((n) => n.id === activeSection)?.label}
              </h1>
              <p className="text-[11px] text-slate-500 truncate">
                Deriv Stream:{' '}
                <span className={data?.derivDiagnostics.connected ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>
                  {data?.derivDiagnostics.connected ? 'LIVE' : 'RECONNECTING'}
                </span>{' '}
                · {usersList.length} Traders · {accountsList.length} Linked Accounts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                loadOverview();
                loadCommissions();
              }}
              disabled={loadingOverview || loadingComm}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingOverview || loadingComm ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => handleExitAdmin(false)}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Workspace</span>
            </button>
          </div>
        </header>

        <main className="p-3 sm:p-6 max-w-6xl w-full mx-auto space-y-5">
          {/* Responsive Mobile & Tablet Section Strip */}
          <div className="flex lg:hidden items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 border transition ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Executive KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-[11px] font-semibold text-slate-500">Live App Markup (Deriv)</div>
              <div className="text-xl font-black font-mono tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">
                ${Number(commData?.derivReport.totalAppMarkupUsd ?? 0).toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {commData?.derivReport.totalTransactionsCount ?? 0} contracts · {commData?.derivReport.totalClientCount ?? 0} clients
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-[11px] font-semibold text-slate-500">Partner Volume &amp; Payout</div>
              <div className="text-xl font-black font-mono tabular-nums mt-1">
                ${Number(commData?.derivReport.totalVolumeUsd ?? 0).toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Payout: ${Number(commData?.derivReport.totalPayoutUsd ?? 0).toFixed(2)} · Real Vol: $
                {Number(commData?.platformVolume.realVolumeUsd ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-[11px] font-semibold text-slate-500">Traders / Active Accounts</div>
              <div className="text-xl font-black font-mono tabular-nums mt-1">
                {usersList.length} <span className="text-slate-400 text-sm">/ {accountsList.length}</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Real: {realCount} · Demo: {demoCount}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
              <div className="text-[11px] font-semibold text-slate-500">Orders &amp; Bots</div>
              <div className="text-xl font-black font-mono tabular-nums mt-1">
                {recentOrders.length} <span className="text-slate-400 text-sm">/ {strategiesList.length} bots</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Open orders: {recentOrders.filter((o) => o.status === 'OPEN').length}
              </div>
            </div>
          </div>

          {notice && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {/* TAB 1: DERIV APP MARKUP & AFFILIATE COMMISSIONS */}
          {activeSection === 'commissions' && (
            <div className="space-y-4">
              {/* Commission Setup & Status Checklist */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-bold text-sm sm:text-base flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-emerald-600" />
                      <span>Deriv Partners App Markup (`/applications/v1/markup-statistics`)</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Live aggregated markup, volume, payout, contract count, and client count directly from Deriv
                      Partners REST API (`Bearer` token with `application_read` + `Deriv-App-ID`). Zero mockup data.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 bg-transparent font-mono"
                    />
                    <span className="text-slate-400">to</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 bg-transparent font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => loadCommissions(dateFrom, dateTo)}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold"
                    >
                      Query Deriv API
                    </button>
                  </div>
                </div>

                {/* Live Diagnostics & Owner OAuth2 Connect */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-sm flex items-center gap-2">
                      {commData?.diagnostics?.hasOwnerToken && commData?.diagnostics?.restHttpStatus === 200 ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      )}
                      <span>Diagnostics &amp; Owner Token (`application_read`)</span>
                    </div>
                    <button
                      type="button"
                      disabled={connectingCommOAuth}
                      onClick={async () => {
                        setError('');
                        setConnectingCommOAuth(true);
                        try {
                          const res = await apiFetch<{ url: string }>('/admin/commissions/oauth-url');
                          window.location.href = res.url;
                        } catch (err) {
                          setError((err as Error).message);
                          setConnectingCommOAuth(false);
                        }
                      }}
                      className="px-3.5 py-2 rounded-lg bg-[#ff444f] hover:bg-rose-600 disabled:opacity-60 text-white font-bold inline-flex items-center gap-1.5"
                    >
                      <span>
                        {connectingCommOAuth
                          ? 'Redirecting to Deriv...'
                          : commData?.diagnostics?.hasOwnerToken
                            ? 'Reconnect Owner Token via Deriv OAuth2'
                            : 'Connect Owner Token via Deriv (application_read)'}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Configured App ID</div>
                      <div className="font-mono font-bold mt-0.5 flex items-center gap-1.5">
                        <span>{commData?.diagnostics?.configuredAppId || '1089'}</span>
                        {commData?.diagnostics?.isDefaultPublicAppId && (
                          <span className="text-[10px] text-amber-600 font-sans">(Public default — enter yours)</span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Owner Token Status</div>
                      <div className="font-mono font-bold mt-0.5">
                        {commData?.diagnostics?.hasOwnerToken ? (
                          <span className="text-emerald-600">
                            Connected ({commData.diagnostics.tokenType.toUpperCase()})
                          </span>
                        ) : (
                          <span className="text-amber-600">Pending Owner Token</span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Partners REST HTTP</div>
                      <div className="font-mono font-bold mt-0.5">
                        {commData?.diagnostics?.restHttpStatus ? (
                          <span
                            className={
                              commData.diagnostics.restHttpStatus === 200 ? 'text-emerald-600' : 'text-rose-500'
                            }
                          >
                            HTTP {commData.diagnostics.restHttpStatus}
                          </span>
                        ) : (
                          <span className="text-slate-400">Not queried</span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">OAuth Redirect URI</div>
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <span className="font-mono text-[10px] truncate">
                          {commData?.diagnostics?.redirectUri || '—'}
                        </span>
                        {commData?.diagnostics?.redirectUri && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(commData.diagnostics!.redirectUri);
                              setNotice('Copied exact OAuth Redirect URI to clipboard.');
                            }}
                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                            title="Copy Redirect URI"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {commData?.diagnostics?.isDefaultPublicAppId && (
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-amber-800 dark:text-amber-200">
                      <strong>Important:</strong> You are currently using public fallback App ID <code>1089</code>. Public
                      App ID 1089 cannot accumulate or query your own Partner App Markup. Register your app on{' '}
                      <a
                        href="https://developers.deriv.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline font-bold"
                      >
                        developers.deriv.com
                      </a>{' '}
                      with the exact Redirect URI above and enter your App ID / Client ID below.
                    </div>
                  )}

                  {/* Monthly Payout Settlement Explanation */}
                  <div className="rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sky-900 dark:text-sky-200">
                    <div className="max-w-3xl leading-relaxed">
                      <strong>How Commissions Transfer to Your Real Trading Account:</strong>{' '}
                      {commData?.diagnostics?.payoutSchedule ||
                        'Deriv automatically settles accumulated App Markup payouts monthly (around the 15th) directly to your linked Deriv CR real payout trading account configured in the Deriv Developer Portal.'}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href="https://developers.deriv.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-700 text-white font-bold inline-flex items-center gap-1"
                      >
                        <span>Developer Portal</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <a
                        href="https://app.deriv.com/cashier"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1"
                      >
                        <span>Deriv Cashier</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>

                {commData?.derivReport.error && (
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    Deriv Commission API Notice: {commData.derivReport.error}
                  </div>
                )}

                {/* Partners API Breakdown by App ID */}
                {(commData?.derivReport.breakdownByAppId ?? []).length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                      <span>Partners Markup Breakdown (`/applications/v1/markup-statistics`)</span>
                      {commData?.derivReport.meta?.request_id && (
                        <span className="font-mono text-[10px] font-normal">
                          req: {commData.derivReport.meta.request_id} ({commData.derivReport.meta.response_time_ms ?? 0}ms)
                        </span>
                      )}
                    </div>
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                          <tr>
                            <th className="px-3 py-2">App ID</th>
                            <th className="px-3 py-2 text-right">Markup (USD)</th>
                            <th className="px-3 py-2 text-right">Volume (USD)</th>
                            <th className="px-3 py-2 text-right">Payout (USD)</th>
                            <th className="px-3 py-2 text-right">Contracts</th>
                            <th className="px-3 py-2 text-right">Clients</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {commData!.derivReport.breakdownByAppId.map((row) => (
                            <tr key={String(row.app_id)}>
                              <td className="px-3 py-2 font-mono font-bold">{row.app_id}</td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600">
                                ${Number(row.app_markup_usd ?? 0).toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">${Number(row.volume_usd ?? 0).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right font-mono">${Number(row.payout_usd ?? 0).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right font-mono">{row.contract_count ?? 0}</td>
                              <td className="px-3 py-2 text-right font-mono">{row.client_count ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Registered Apps from Deriv `app_list` (Legacy WS supplemental if applicable) */}
                {(commData?.derivReport.registeredApps ?? []).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Live Deriv Registered Apps (`app_list`)
                    </div>
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                          <tr>
                            <th className="px-3 py-2">App ID</th>
                            <th className="px-3 py-2">App Name</th>
                            <th className="px-3 py-2">Markup %</th>
                            <th className="px-3 py-2">Redirect URI</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {commData!.derivReport.registeredApps.map((app) => (
                            <tr key={app.app_id}>
                              <td className="px-3 py-2 font-mono font-bold">{app.app_id}</td>
                              <td className="px-3 py-2 font-semibold">{app.name}</td>
                              <td className="px-3 py-2 font-mono font-bold">
                                <span
                                  className={
                                    Number(app.app_markup_percentage ?? 0) > 0 ? 'text-emerald-600' : 'text-rose-500'
                                  }
                                >
                                  {Number(app.app_markup_percentage ?? 0).toFixed(2)}%
                                </span>
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-500 truncate max-w-xs">
                                {app.redirect_uri || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Commission Configuration Form */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setError('');
                    setNotice('');
                    try {
                      await apiFetch('/admin/commissions/config', {
                        method: 'PUT',
                        body: JSON.stringify({
                          appId: commAppId,
                          appName: commAppName,
                          domain: commDomain,
                          targetMarkupPct: commTargetPct,
                          affiliateUrl: commAffiliateUrl,
                          sidcCode: commSidc,
                          payoutAccount: commPayoutAcc,
                          ...(commAdminToken.trim() ? { adminToken: commAdminToken.trim() } : {})
                        })
                      });
                      setCommAdminToken('');
                      setNotice('Deriv App Markup & Affiliate Partner configuration saved securely.');
                      loadCommissions(dateFrom, dateTo);
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                  className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-950/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-xs"
                >
                  <div>
                    <label className="block font-semibold text-slate-500 mb-1">Deriv App ID / Client ID</label>
                    <input
                      value={commAppId}
                      onChange={(e) => setCommAppId(e.target.value)}
                      placeholder="e.g. 68942 or 34YwLWpKr0..."
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-500 mb-1">Verified Site Domain</label>
                    <input
                      value={commDomain}
                      onChange={(e) => setCommDomain(e.target.value)}
                      placeholder="https://pipflow.site"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-500 mb-1">Target Markup % (0–3%)</label>
                    <input
                      type="number"
                      min={0}
                      max={3}
                      step={0.1}
                      value={commTargetPct}
                      onChange={(e) => setCommTargetPct(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-500 mb-1">Owner Payout CR Account</label>
                    <input
                      value={commPayoutAcc}
                      onChange={(e) => setCommPayoutAcc(e.target.value)}
                      placeholder="CR1234567"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-500 mb-1">Affiliate / IB Sign-Up Link</label>
                    <input
                      value={commAffiliateUrl}
                      onChange={(e) => setCommAffiliateUrl(e.target.value)}
                      placeholder="https://track.deriv.com/_..."
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-500 mb-1">Partner SIDC / UTM Code</label>
                    <input
                      value={commSidc}
                      onChange={(e) => setCommSidc(e.target.value)}
                      placeholder="sidc partner code"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-500 mb-1">
                      Owner Token (`application_read` PAT or OAuth2){' '}
                      {commData?.config.hasAdminToken && (
                        <span className="text-emerald-600">(Encrypted Token Saved)</span>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={commAdminToken}
                        onChange={(e) => setCommAdminToken(e.target.value)}
                        placeholder="Paste Deriv PAT / Token with application_read scope..."
                        className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono"
                      />
                      <button
                        type="submit"
                        className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold shrink-0"
                      >
                        Save &amp; Sync
                      </button>
                    </div>
                  </div>
                </form>
              </div>

              {/* Client Commission Transactions Table */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm">Client Markup Commission Ledger (`app_markup_details`)</h3>
                  <span className="text-xs font-mono text-slate-500">
                    {(commData?.derivReport.transactions ?? []).length} entries
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Time</th>
                        <th className="px-3 py-2">Client LoginID</th>
                        <th className="px-3 py-2">App ID</th>
                        <th className="px-3 py-2">Transaction ID</th>
                        <th className="px-3 py-2 text-right">Markup Earned (USD)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(commData?.derivReport.transactions ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                            No Deriv app markup transactions in this date range yet. Ensure App Markup % &gt; 0% and a
                            Read+Admin token is saved above.
                          </td>
                        </tr>
                      ) : (
                        commData!.derivReport.transactions.map((tx) => (
                          <tr key={`${tx.transaction_id}-${tx.client_loginid}`}>
                            <td className="px-3 py-2 font-mono">{tx.transaction_time}</td>
                            <td className="px-3 py-2 font-mono font-bold">{tx.client_loginid}</td>
                            <td className="px-3 py-2 font-mono">{tx.app_id}</td>
                            <td className="px-3 py-2 font-mono">{tx.transaction_id}</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600">
                              +${Number(tx.app_markup_usd).toFixed(4)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DERIV CONNECTED ACCOUNTS CRUD */}
          {activeSection === 'connections' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-bold text-sm sm:text-base">Manage Deriv Connections</h2>
                  <p className="text-xs text-slate-500">
                    Connect user accounts via Official OAuth2 or API Token, sync balances, revoke tokens, or delete links.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setError('');
                    try {
                      const res = await apiFetch<{ url: string }>('/deriv/oauth-url');
                      window.location.href = res.url;
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                  className="px-3.5 py-2 rounded-lg bg-[#ff444f] hover:bg-rose-600 text-white text-xs font-bold shrink-0"
                >
                  Connect via Deriv OAuth2
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError('');
                  setConnectBusy(true);
                  try {
                    const res = await apiFetch<{ primaryLoginId: string; count: number }>(
                      '/admin/connected-accounts/connect',
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          userId: connectTargetUserId || undefined,
                          apiToken: connectApiToken
                        })
                      }
                    );
                    setConnectApiToken('');
                    setNotice(`Connected ${res.count} Deriv account(s) (Primary: ${res.primaryLoginId}).`);
                    refreshDerivAccounts(false);
                    loadOverview();
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setConnectBusy(false);
                  }
                }}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800"
              >
                <select
                  value={connectTargetUserId}
                  onChange={(e) => setConnectTargetUserId(e.target.value)}
                  className="sm:col-span-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs"
                >
                  <option value="">Owner Account ({user.email})</option>
                  {usersList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
                <input
                  type="password"
                  value={connectApiToken}
                  onChange={(e) => setConnectApiToken(e.target.value)}
                  placeholder="Deriv API token (Read + Trade)..."
                  className="sm:col-span-5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                  required
                />
                <button
                  type="submit"
                  disabled={connectBusy}
                  className="sm:col-span-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold"
                >
                  {connectBusy ? 'Linking...' : 'Link Deriv Token'}
                </button>
              </form>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {accountsList.length === 0 ? (
                  <div className="py-8 text-center text-slate-400">No Deriv accounts connected yet.</div>
                ) : (
                  accountsList.map((a) => {
                    const canTrade = a.granted_scopes?.includes('trade');
                    return (
                      <div key={a.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-0.5 min-w-0">
                          <div className="font-mono font-bold flex flex-wrap items-center gap-2">
                            <span>{a.deriv_login_id}</span>
                            <span className="text-[10px] uppercase text-slate-500">({a.account_type})</span>
                            <span className={canTrade ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600'}>
                              {canTrade ? 'Read + Trade' : 'Read-Only'}
                            </span>
                            {a.balance_locked_by_admin && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-sans font-semibold">
                                DB Locked
                              </span>
                            )}
                          </div>
                          <div className="text-slate-500 truncate">
                            {a.user_email} · {a.connection_status}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center sm:justify-end gap-2 font-mono">
                          {editingAccId === a.id ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                value={editAccBalanceVal}
                                onChange={(e) => setEditAccBalanceVal(e.target.value)}
                                className="w-24 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs bg-transparent"
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch(`/admin/connected-accounts/${a.id}/balance`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ balance: Number(editAccBalanceVal) })
                                  });
                                  setEditingAccId(null);
                                  refreshDerivAccounts(false);
                                  loadOverview();
                                }}
                                className="px-2 py-1 rounded bg-emerald-600 text-white font-sans font-bold"
                              >
                                Save
                              </button>
                            </div>
                          ) : (
                            <span className="font-bold tabular-nums mr-2">
                              {Number(a.last_known_balance).toFixed(2)} {a.currency}
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setEditingAccId(a.id);
                              setEditAccBalanceVal(String(a.last_known_balance));
                            }}
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-blue-600 font-sans font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await apiFetch(`/admin/connected-accounts/${a.id}/sync`, { method: 'POST' });
                                setNotice(`Synced ${a.deriv_login_id} from Deriv.`);
                                refreshDerivAccounts(false);
                                loadOverview();
                              } catch (err) {
                                setError((err as Error).message);
                              }
                            }}
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-sky-600 font-sans font-semibold"
                          >
                            Sync
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/admin/connected-accounts/${a.id}/revoke`, { method: 'POST' });
                              setNotice(`Revoked ${a.deriv_login_id}.`);
                              loadOverview();
                            }}
                            className="px-2 py-1 rounded border border-amber-200 dark:border-amber-900 text-amber-600 font-sans font-semibold"
                          >
                            Revoke
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/admin/connected-accounts/${a.id}`, { method: 'DELETE' });
                              setNotice(`Deleted ${a.deriv_login_id}.`);
                              loadOverview();
                            }}
                            className="px-2 py-1 rounded border border-rose-200 dark:border-rose-900 text-rose-600 font-sans font-semibold"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 3: USERS FULL CRUD */}
          {activeSection === 'users' && (
            <div className="space-y-4">
              {/* Create User Form */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError('');
                  setNotice('');
                  try {
                    await apiFetch('/admin/users', {
                      method: 'POST',
                      body: JSON.stringify({
                        email: newUserEmail,
                        fullName: newUserName,
                        password: newUserPassword,
                        role: newUserRole,
                        virtualBalance: newUserBalance
                      })
                    });
                    setNewUserEmail('');
                    setNewUserName('');
                    setNewUserPassword('');
                    setNotice(`Created ${newUserRole} account for ${newUserEmail}.`);
                    loadOverview();
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 grid sm:grid-cols-6 gap-2.5 text-xs"
              >
                <div className="sm:col-span-6 font-bold text-sm flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-blue-600" /> Create New User / Trader
                </div>
                <input
                  type="email"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="Email address"
                  className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-2"
                />
                <input
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Full Name"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-2"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  placeholder="Password (min 6)"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-2"
                />
                <div className="flex gap-1.5">
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as 'trader' | 'admin')}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-2"
                  >
                    <option value="trader">Trader</option>
                    <option value="admin">Admin</option>
                  </select>
                  <input
                    type="number"
                    value={newUserBalance}
                    onChange={(e) => setNewUserBalance(Number(e.target.value))}
                    className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-2 font-mono"
                    title="Virtual Workspace Balance"
                  />
                </div>
                <button type="submit" className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold py-2">
                  Create User
                </button>
              </form>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-bold text-sm sm:text-base">
                    Registered Users ({filteredUsers.length})
                  </h2>
                  <input
                    type="search"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Filter by email or name..."
                    className="w-full sm:w-64 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-xs"
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2">Email &amp; Name</th>
                        <th>Role</th>
                        <th>Virtual Balance</th>
                        <th>Status</th>
                        <th className="text-right">CRUD Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredUsers.map((u) => (
                        <tr key={u.id}>
                          <td className="py-2.5">
                            <div className="font-semibold">{u.email}</div>
                            {editingUserId === u.id ? (
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                <input
                                  value={editUserName}
                                  onChange={(e) => setEditUserName(e.target.value)}
                                  placeholder="Full Name"
                                  className="border rounded px-2 py-0.5 text-xs bg-transparent"
                                />
                                <input
                                  type="password"
                                  value={editUserPassword}
                                  onChange={(e) => setEditUserPassword(e.target.value)}
                                  placeholder="New password (optional)"
                                  className="border rounded px-2 py-0.5 text-xs bg-transparent"
                                />
                              </div>
                            ) : (
                              <div className="text-[11px] text-slate-400">{u.full_name}</div>
                            )}
                          </td>
                          <td className="uppercase text-[11px] font-semibold">
                            {editingUserId === u.id ? (
                              <select
                                value={editUserRole}
                                onChange={(e) => setEditUserRole(e.target.value as 'trader' | 'admin')}
                                className="border rounded px-1.5 py-0.5 bg-white dark:bg-slate-900"
                              >
                                <option value="trader">trader</option>
                                <option value="admin">admin</option>
                              </select>
                            ) : (
                              u.role
                            )}
                          </td>
                          <td className="font-mono tabular-nums">
                            {editingUserId === u.id ? (
                              <input
                                type="number"
                                value={editUserBalance}
                                onChange={(e) => setEditUserBalance(e.target.value)}
                                className="w-24 border rounded px-1.5 py-0.5 text-xs bg-transparent"
                              />
                            ) : (
                              `$${Number(u.virtual_workspace_balance).toFixed(2)}`
                            )}
                          </td>
                          <td>{u.is_active ? 'Active' : 'Suspended'}</td>
                          <td className="text-right space-x-2">
                            {editingUserId === u.id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await apiFetch(`/admin/users/${u.id}`, {
                                      method: 'PATCH',
                                      body: JSON.stringify({
                                        fullName: editUserName,
                                        role: editUserRole,
                                        virtualBalance: Number(editUserBalance),
                                        ...(editUserPassword.length >= 6 ? { newPassword: editUserPassword } : {})
                                      })
                                    });
                                    setEditingUserId(null);
                                    setEditUserPassword('');
                                    setNotice(`Updated user ${u.email}.`);
                                    refreshProfile();
                                    loadOverview();
                                  }}
                                  className="px-2 py-1 rounded bg-emerald-600 text-white font-bold"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingUserId(null);
                                    setEditUserPassword('');
                                  }}
                                  className="px-2 py-1 rounded border border-slate-300"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingUserId(u.id);
                                    setEditUserName(u.full_name || '');
                                    setEditUserBalance(String(u.virtual_workspace_balance));
                                    setEditUserRole(u.role);
                                    setEditUserPassword('');
                                  }}
                                  className="text-blue-600 font-semibold hover:underline inline-flex items-center gap-0.5"
                                >
                                  <Edit3 className="w-3 h-3" /> Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await apiFetch(`/admin/users/${u.id}/status`, {
                                      method: 'PATCH',
                                      body: JSON.stringify({ isActive: !u.is_active })
                                    });
                                    loadOverview();
                                  }}
                                  className="text-amber-600 font-semibold hover:underline"
                                >
                                  {u.is_active ? 'Suspend' : 'Activate'}
                                </button>
                                {u.id !== user.id && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await apiFetch(`/admin/users/${u.id}`, { method: 'DELETE' });
                                      setNotice(`Deleted user ${u.email}.`);
                                      loadOverview();
                                    }}
                                    className="text-rose-600 font-semibold hover:underline inline-flex items-center gap-0.5"
                                  >
                                    <Trash2 className="w-3 h-3" /> Delete
                                  </button>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: BOT STRATEGIES CRUD */}
          {activeSection === 'strategies' && (
            <div className="space-y-4">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError('');
                  try {
                    await apiFetch('/admin/strategies', {
                      method: 'POST',
                      body: JSON.stringify({
                        name: newStratName,
                        category: newStratCat,
                        symbol: newStratSym,
                        isPremium: newStratPremium,
                        strategyConfig: {
                          tradeType: 'Momentum',
                          stake: newStratStake,
                          tpPct: newStratTp,
                          slPct: newStratSl,
                          martingale: 1.5
                        }
                      })
                    });
                    setNewStratName('');
                    setNotice(`Created bot strategy "${newStratName}".`);
                    loadOverview();
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 grid sm:grid-cols-6 gap-2.5 text-xs"
              >
                <div className="sm:col-span-6 font-bold text-sm flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-blue-600" /> Add Automated Trading Bot Strategy
                </div>
                <input
                  required
                  value={newStratName}
                  onChange={(e) => setNewStratName(e.target.value)}
                  placeholder="Bot Strategy Name"
                  className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-2"
                />
                <select
                  value={newStratCat}
                  onChange={(e) => setNewStratCat(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-2"
                >
                  <option>Free Bots</option>
                  <option>Scalper Bots</option>
                  <option>SpeedBots</option>
                </select>
                <input
                  value={newStratSym}
                  onChange={(e) => setNewStratSym(e.target.value)}
                  placeholder="Symbol (R_100)"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-2 font-mono"
                />
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={newStratStake}
                    onChange={(e) => setNewStratStake(Number(e.target.value))}
                    className="w-16 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-2 font-mono"
                    title="Default Stake"
                  />
                  <label className="flex items-center gap-1 text-[11px]">
                    <input
                      type="checkbox"
                      checked={newStratPremium}
                      onChange={(e) => setNewStratPremium(e.target.checked)}
                    />
                    Pro
                  </label>
                </div>
                <button type="submit" className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold py-2">
                  Add Bot
                </button>
              </form>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2">Name</th>
                      <th>Category</th>
                      <th>Symbol</th>
                      <th>Stake</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {strategiesList.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 font-bold">
                          {editingStratId === s.id ? (
                            <input
                              value={editStratName}
                              onChange={(e) => setEditStratName(e.target.value)}
                              className="border rounded px-2 py-0.5 bg-transparent"
                            />
                          ) : (
                            s.name
                          )}
                        </td>
                        <td>{s.category}</td>
                        <td className="font-mono">
                          {editingStratId === s.id ? (
                            <input
                              value={editStratSym}
                              onChange={(e) => setEditStratSym(e.target.value)}
                              className="w-24 border rounded px-2 py-0.5 bg-transparent"
                            />
                          ) : (
                            s.symbol
                          )}
                        </td>
                        <td className="font-mono">
                          {editingStratId === s.id ? (
                            <input
                              type="number"
                              value={editStratStake}
                              onChange={(e) => setEditStratStake(Number(e.target.value))}
                              className="w-20 border rounded px-2 py-0.5 bg-transparent"
                            />
                          ) : (
                            `$${Number(s.strategy_config?.stake ?? 10)}`
                          )}
                        </td>
                        <td className="text-right space-x-2">
                          {editingStratId === s.id ? (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch(`/admin/strategies/${s.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({
                                      name: editStratName,
                                      symbol: editStratSym,
                                      strategyConfig: { ...s.strategy_config, stake: editStratStake }
                                    })
                                  });
                                  setEditingStratId(null);
                                  loadOverview();
                                }}
                                className="px-2 py-1 rounded bg-emerald-600 text-white font-bold"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingStratId(null)}
                                className="px-2 py-1 rounded border"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingStratId(s.id);
                                  setEditStratName(s.name);
                                  setEditStratSym(s.symbol);
                                  setEditStratStake(Number(s.strategy_config?.stake ?? 10));
                                }}
                                className="text-blue-600 font-semibold hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch(`/admin/strategies/${s.id}`, { method: 'DELETE' });
                                  loadOverview();
                                }}
                                className="text-rose-600 font-semibold hover:underline"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: ORDERS & TRADES MANAGEMENT */}
          {activeSection === 'orders' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-sm sm:text-base">Live &amp; Recent Platform Orders ({recentOrders.length})</h2>
                <button
                  type="button"
                  disabled={recentOrders.filter((o) => o.status === 'OPEN').length === 0}
                  onClick={async () => {
                    const res = await apiFetch<{ closedCount: number }>('/admin/orders/close-all', { method: 'POST' });
                    setNotice(`Force-closed ${res.closedCount} open platform position(s).`);
                    loadOverview();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-bold"
                >
                  Close All Open Platform Trades ({recentOrders.filter((o) => o.status === 'OPEN').length})
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2">Trader</th>
                      <th>Symbol / Side</th>
                      <th>Mode</th>
                      <th>Stake</th>
                      <th>Status</th>
                      <th className="text-right">P/L</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {recentOrders.map((o) => (
                      <tr key={o.id}>
                        <td className="py-2 truncate max-w-[160px]">{o.user_email}</td>
                        <td className="font-semibold">
                          {o.symbol}{' '}
                          <span className={o.side === 'BUY' ? 'text-blue-600' : 'text-rose-600'}>{o.side}</span>
                        </td>
                        <td className="font-mono text-[11px]">{o.execution_mode}</td>
                        <td className="font-mono tabular-nums">${Number(o.stake).toFixed(2)}</td>
                        <td className="font-mono text-[11px]">{o.status}</td>
                        <td
                          className={`text-right font-mono font-bold tabular-nums ${
                            Number(o.pnl) >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {Number(o.pnl) >= 0 ? '+' : ''}
                          {Number(o.pnl).toFixed(2)}
                        </td>
                        <td className="text-right space-x-2">
                          {o.status === 'OPEN' && (
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/admin/orders/${o.id}/close`, { method: 'POST' });
                                loadOverview();
                              }}
                              className="text-amber-600 font-semibold hover:underline"
                            >
                              Force Close
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/admin/orders/${o.id}`, { method: 'DELETE' });
                              loadOverview();
                            }}
                            className="text-rose-600 font-semibold hover:underline"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: SITE SETTINGS, BRANDING & ANNOUNCEMENTS */}
          {activeSection === 'settings' && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2.5">
                <h2 className="font-bold text-sm flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-sky-600" /> Owner Email &amp; Password
                </h2>
                <input
                  type="email"
                  value={adminEmailInput}
                  onChange={(e) => setAdminEmailInput(e.target.value)}
                  placeholder="Admin Email"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
                />
                <input
                  type="password"
                  value={adminPwdInput}
                  onChange={(e) => setAdminPwdInput(e.target.value)}
                  placeholder="New Admin Password (min 8 chars, optional)"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
                />
                <button
                  type="button"
                  onClick={async () => {
                    setError('');
                    try {
                      const res = await apiFetch<{ token: string; user: UserProfile }>(
                        '/admin/settings/admin-credentials',
                        {
                          method: 'PUT',
                          body: JSON.stringify({
                            newEmail: adminEmailInput,
                            ...(adminPwdInput ? { newPassword: adminPwdInput } : {})
                          })
                        }
                      );
                      setSession(res.token, res.user);
                      setAdminPwdInput('');
                      setNotice('Owner credentials updated.');
                      loadOverview();
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                  className="w-full py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold"
                >
                  Update Credentials
                </button>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
                <h2 className="font-bold text-sm flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-blue-600" /> Global Site &amp; Registration Config
                </h2>
                <label className="flex items-center justify-between text-xs">
                  <span>Allow New Registrations</span>
                  <input
                    type="checkbox"
                    checked={allowRegistration}
                    onChange={(e) => setAllowRegistration(e.target.checked)}
                    className="accent-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between text-xs">
                  <span>Maintenance Mode</span>
                  <input
                    type="checkbox"
                    checked={maintenanceMode}
                    onChange={(e) => setMaintenanceMode(e.target.checked)}
                    className="accent-rose-600"
                  />
                </label>
                <label className="flex items-center justify-between text-xs">
                  <span>Default Virtual Balance ($)</span>
                  <input
                    type="number"
                    value={defaultVirtualBalance}
                    onChange={(e) => setDefaultVirtualBalance(Number(e.target.value))}
                    className="w-24 border rounded px-2 py-1 text-right font-mono bg-transparent"
                  />
                </label>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/admin/settings/global', {
                      method: 'PUT',
                      body: JSON.stringify({ maintenanceMode, allowRegistration, defaultVirtualBalance })
                    });
                    setNotice('Global platform settings saved.');
                    loadOverview();
                  }}
                  className="w-full py-2 rounded-lg bg-blue-600 text-white text-xs font-bold"
                >
                  Save Global Settings
                </button>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
                <h2 className="font-bold text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-600" /> Branding, Marquee Ticker &amp; KES Rate
                </h2>
                <input
                  value={tickerText}
                  onChange={(e) => setTickerText(e.target.value)}
                  placeholder="Marquee ticker text..."
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
                />
                <input
                  type="number"
                  value={kesRate}
                  onChange={(e) => setKesRate(Number(e.target.value))}
                  placeholder="USD to KES Rate"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
                />
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/admin/settings/branding', {
                      method: 'PUT',
                      body: JSON.stringify({ appName: 'Pipflowtrades', tickerText, kesRate })
                    });
                    await refreshBranding();
                    setNotice('Branding updated live.');
                    loadOverview();
                  }}
                  className="w-full py-2 rounded-lg bg-slate-800 text-white text-xs font-bold"
                >
                  Save Branding
                </button>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2.5">
                <h2 className="font-bold text-sm flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-500" /> Broadcast &amp; Manage Announcements
                </h2>
                <input
                  value={announceTitle}
                  onChange={(e) => setAnnounceTitle(e.target.value)}
                  placeholder="Announcement Title"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-xs"
                />
                <textarea
                  value={announceMsg}
                  onChange={(e) => setAnnounceMsg(e.target.value)}
                  placeholder="Announcement Message..."
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-xs"
                />
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                  <span>Also send via Brevo Email</span>
                </label>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/admin/announcements', {
                      method: 'POST',
                      body: JSON.stringify({ title: announceTitle, message: announceMsg, sendEmail })
                    });
                    setAnnounceTitle('');
                    setAnnounceMsg('');
                    setNotice('Announcement broadcast.');
                    loadOverview();
                  }}
                  className="w-full py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                >
                  Broadcast Announcement
                </button>
                {announcementsList.length > 0 && (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-36 overflow-y-auto pt-2 text-xs">
                    {announcementsList.map((ann) => (
                      <div key={ann.id} className="py-1.5 flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{ann.title}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/admin/announcements/${ann.id}`, { method: 'DELETE' });
                            loadOverview();
                          }}
                          className="text-rose-500 hover:underline shrink-0"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Full Site Features, Cashier & Navigation Tab Controls */}
              <div className="sm:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-4">
                <h2 className="font-bold text-sm flex items-center gap-2">
                  <Shield className="w-4 h-4 text-violet-600" /> Site Controls, Cashier Links &amp; Visible Workspace Tabs
                </h2>

                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <label className="sm:col-span-2 flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
                    <span className="font-semibold">Show Top-Bar Deposit / Withdraw Cashier Button</span>
                    <input
                      type="checkbox"
                      checked={showDepositWithdraw}
                      onChange={(e) => setShowDepositWithdraw(e.target.checked)}
                      className="accent-violet-600"
                    />
                  </label>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Deposit Cashier URL</label>
                    <input
                      value={depositUrl}
                      onChange={(e) => setDepositUrl(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Withdrawal Cashier URL</label>
                    <input
                      value={withdrawUrl}
                      onChange={(e) => setWithdrawUrl(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 font-mono text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-500 mb-1">Cashier Settlement Note</label>
                    <input
                      value={cashierNote}
                      onChange={(e) => setCashierNote(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-500 mb-1">Risk Disclaimer Modal Text</label>
                    <textarea
                      rows={2}
                      value={riskDisclaimerText}
                      onChange={(e) => setRiskDisclaimerText(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Enabled Navigation Tabs Across Site</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'dashboard', label: 'Dashboard' },
                      { id: 'bot_builder', label: 'Bot Builder' },
                      { id: 'charts', label: 'Charts' },
                      { id: 'freebots', label: 'Trading Bots' },
                      { id: 'bulk_trader', label: 'Bulk Trader' },
                      { id: 'analysistool', label: 'Analysis Tool' },
                      { id: 'reports', label: 'Reports' },
                      { id: 'trading_plan', label: 'Risk Calculator' },
                      { id: 'copy_trading', label: 'Copy Trading' },
                      { id: 'dtrader', label: 'DTrader' },
                      { id: 'trading_view', label: 'TradingView' }
                    ].map((tab) => {
                      const active = enabledTabs.includes(tab.id);
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() =>
                            setEnabledTabs((prev) =>
                              prev.includes(tab.id) ? prev.filter((x) => x !== tab.id) : [...prev, tab.id]
                            )
                          }
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition ${
                            active
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/admin/settings/site-controls', {
                      method: 'PUT',
                      body: JSON.stringify({
                        showDepositWithdraw,
                        depositUrl,
                        withdrawUrl,
                        cashierNote,
                        riskDisclaimerText,
                        enabledTabs
                      })
                    });
                    await refreshBranding();
                    setNotice('Site controls & visible workspace tabs updated live.');
                    loadOverview();
                  }}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold"
                >
                  Save Site Controls &amp; Visible Tabs
                </button>
              </div>
            </div>
          )}

          {/* TAB 7: AUDIT, SECURITY & EMAIL LOGS */}
          {activeSection === 'logs' && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2">
                <h3 className="font-bold text-sm flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-sky-600" /> Admin &amp; Security Audit Trail
                </h3>
                <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {(data?.auditLogs ?? []).length === 0 ? (
                    <div className="py-6 text-center text-slate-400">No audit entries recorded yet.</div>
                  ) : (
                    (data?.auditLogs ?? []).slice(0, 40).map((log) => (
                      <div key={log.id} className="py-2 flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold truncate">{log.action}</span>
                        <span className="text-slate-400 shrink-0">{new Date(log.created_at).toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2">
                <h3 className="font-bold text-sm flex items-center gap-1.5">
                  <Mail className="w-4 h-4 text-blue-600" /> Brevo Email Delivery Logs
                </h3>
                <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {(data?.emailLogs ?? []).length === 0 ? (
                    <div className="py-6 text-center text-slate-400">No email logs recorded yet.</div>
                  ) : (
                    (data?.emailLogs ?? []).slice(0, 40).map((em) => (
                      <div key={em.id} className="py-2 flex items-center justify-between gap-2">
                        <span className="truncate">
                          {em.template_type} → {em.recipient_email}
                        </span>
                        <span
                          className={
                            em.status === 'sent' ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'
                          }
                        >
                          {em.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
