import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Menu,
  Phone,
  ChevronDown,
  SlidersHorizontal,
  Play,
  Square,
  AlertTriangle,
  X,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  GripVertical,
  LayoutGrid,
  Bot,
  LineChart,
  Layers,
  Activity,
  FileBarChart2,
  Calculator,
  Copy,
  TrendingUp,
  BarChart2,
  Bell,
  BookOpen,
  LogOut,
  RotateCcw,
  Sun,
  Moon,
  ArrowUpRight
} from 'lucide-react';
import { CurrencyFlag } from '../components/CurrencyFlag';
import { PipflowLogo } from '../components/PipflowLogo';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../services/api';

export interface NavTabItem {
  id: string;
  label: string;
  visible: boolean;
}

export const DEFAULT_NAV_TABS: NavTabItem[] = [
  { id: 'dashboard', label: 'Dashboard', visible: true },
  { id: 'bot_builder', label: 'Bot Builder', visible: true },
  { id: 'charts', label: 'Charts', visible: true },
  { id: 'freebots', label: 'Trading Bots', visible: true },
  { id: 'bulk_trader', label: 'Bulk Trader', visible: true },
  { id: 'analysistool', label: 'Analysis Tool', visible: true },
  { id: 'reports', label: 'Reports', visible: true },
  { id: 'trading_plan', label: 'Risk Calculator', visible: true },
  { id: 'copy_trading', label: 'Copy Trading', visible: true },
  { id: 'dtrader', label: 'DTrader', visible: true },
  { id: 'trading_view', label: 'TradingView', visible: true }
];

function getTabIcon(id: string) {
  switch (id) {
    case 'dashboard':
      return LayoutGrid;
    case 'bot_builder':
      return Bot;
    case 'charts':
      return LineChart;
    case 'freebots':
      return Bot;
    case 'bulk_trader':
      return Layers;
    case 'analysistool':
      return Activity;
    case 'reports':
      return FileBarChart2;
    case 'trading_plan':
      return Calculator;
    case 'copy_trading':
      return Copy;
    case 'dtrader':
      return TrendingUp;
    default:
      return BarChart2;
  }
}

interface WorkspaceLayoutProps {
  activeTab: string;
  onSelectTab: (id: string) => void;
  botRunning: boolean;
  onToggleBot: () => void;
  onBackToLanding?: () => void;
  children: React.ReactNode;
}

export const WorkspaceLayout: React.FC<WorkspaceLayoutProps> = ({
  activeTab,
  onSelectTab,
  botRunning,
  onToggleBot,
  onBackToLanding,
  children
}) => {
  const navigate = useNavigate();
  const {
    user,
    token,
    derivAccounts,
    activeDerivAccount,
    setActiveAccountId,
    branding,
    siteControls,
    fastExecution,
    setFastExecution,
    darkTheme,
    setDarkTheme,
    currency,
    setCurrency,
    refreshProfile,
    logout
  } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountTab, setAccountTab] = useState<'real' | 'demo'>(() =>
    activeDerivAccount?.account_type === 'real' ? 'real' : 'demo'
  );
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);
  const [gmtNow, setGmtNow] = useState(() => new Date().toISOString().replace('T', ' ').slice(0, 19) + ' GMT');
  const [tabs, setTabs] = useState<NavTabItem[]>(() => {
    try {
      const saved = localStorage.getItem('pipflow_nav_tabs');
      return saved ? (JSON.parse(saved) as NavTabItem[]) : DEFAULT_NAV_TABS;
    } catch {
      return DEFAULT_NAV_TABS;
    }
  });

  useEffect(() => {
    if (activeDerivAccount?.account_type) {
      setAccountTab(activeDerivAccount.account_type);
    }
  }, [activeDerivAccount?.account_type]);

  useEffect(() => {
    const id = setInterval(() => {
      setGmtNow(new Date().toISOString().replace('T', ' ').slice(0, 19) + ' GMT');
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const displayUsdBalance = activeDerivAccount
    ? Number(activeDerivAccount.last_known_balance)
    : Number(user?.virtual_workspace_balance ?? 10000);

  const isRealAccount = activeDerivAccount?.account_type === 'real';
  // Real money in green unless strictly below $2.00 USD -> turns red; Demo remains green
  const isBalanceLowRed = isRealAccount && displayUsdBalance < 2;

  const balanceColorClass = isBalanceLowRed
    ? 'text-rose-600 dark:text-rose-400'
    : 'text-emerald-600 dark:text-emerald-400';

  const formattedBalance =
    currency === 'USD'
      ? `${displayUsdBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
      : `KSH ${(displayUsdBalance * branding.kesRate).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}`;

  const visibleTabs = tabs.filter(
    (t) =>
      t.visible &&
      (!Array.isArray(siteControls.enabledTabs) ||
        siteControls.enabledTabs.length === 0 ||
        siteControls.enabledTabs.includes(t.id))
  );

  const moveTab = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= tabs.length) return;
    const copy = [...tabs];
    const [removed] = copy.splice(idx, 1);
    copy.splice(next, 0, removed);
    setTabs(copy);
  };

  const saveArrangement = () => {
    localStorage.setItem('pipflow_nav_tabs', JSON.stringify(tabs));
    setArrangeOpen(false);
  };

  const handleResetVirtualBalance = async () => {
    if (!token) return;
    await apiFetch('/orders/reset-balance', { method: 'POST' });
    await refreshProfile();
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-20">
      {/* Top Header matching reference screenshot */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-2 sm:px-4 py-2 flex items-center justify-between gap-1.5 sm:gap-2 relative z-30">
        <div className="flex items-center gap-1 sm:gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 shrink-0"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <PipflowLogo compact />

          {/* KSH | USD Stylized Switcher Pill */}
          <div className="relative flex items-center gap-1 shrink-0">
            <div className="flex items-center rounded border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 shadow-xs">
              <button
                type="button"
                onClick={() => setCurrency('KSH')}
                className={`px-2 py-1 rounded-xs text-[11px] font-black tracking-tight transition ${
                  currency === 'KSH'
                    ? 'bg-[#0b5ed7] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700'
                }`}
              >
                KSH
              </button>
              <button
                type="button"
                onClick={() => setCurrency('USD')}
                className={`px-2 py-1 rounded-xs text-[11px] font-black tracking-tight transition ${
                  currency === 'USD'
                    ? 'bg-[#c93b2b] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700'
                }`}
              >
                USD
              </button>
            </div>

            <button
              type="button"
              onClick={() => setCurrencyDropdownOpen((v) => !v)}
              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100"
              aria-label="Currency options"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {currencyDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-44 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1.5 z-50 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setCurrency('USD');
                    setCurrencyDropdownOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <CurrencyFlag currency="USD" className="w-5 h-5" /> US Dollar (USD)
                  </span>
                  {currency === 'USD' && <span className="text-emerald-600 font-bold">●</span>}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrency('KSH');
                    setCurrencyDropdownOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <CurrencyFlag currency="KSH" className="w-5 h-5" /> Kenyan Shilling
                  </span>
                  {currency === 'KSH' && <span className="text-emerald-600 font-bold">●</span>}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onSelectTab('learning')}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 shrink-0"
            title="Support & Learning Hub"
          >
            <Phone className="w-4 h-4 fill-current" />
          </button>
        </div>

        {/* Right Side: Purple Deposit / Withdraw button + Country Flag SVG + Balance + Chevron */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {siteControls.showDepositWithdraw && (
            <a
              href={currency === 'KSH' ? siteControls.withdrawUrl : siteControls.depositUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 sm:px-3.5 py-1.5 rounded-md bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-[11px] sm:text-xs font-bold shadow-xs transition whitespace-nowrap inline-flex items-center gap-1"
            >
              <span>{currency === 'KSH' ? 'Withdraw' : 'Deposit'}</span>
              <ArrowUpRight className="w-3 h-3 hidden sm:inline" />
            </a>
          )}

          <button
            type="button"
            onClick={() => {
              setAccountTab(activeDerivAccount?.account_type === 'real' ? 'real' : 'demo');
              setAccountModalOpen(true);
            }}
            className="flex items-center gap-1 sm:gap-2 px-1 sm:px-1.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0"
            title="Switch Account or Inspect Balance"
          >
            <CurrencyFlag currency={currency} className="w-6 h-6 sm:w-7 sm:h-7" />
            <span className={`font-extrabold text-xs sm:text-base tabular-nums whitespace-nowrap ${balanceColorClass}`}>
              {formattedBalance}
            </span>
            <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600 dark:text-slate-300" />
          </button>
        </div>
      </header>

      {/* Red Marquee Ticker Banner */}
      <div className="bg-[#c8102e] text-white text-[11px] font-bold py-1 overflow-hidden">
        <div className="animate-pipflow-marquee">
          <span className="mx-10">{branding.tickerText}</span>
          <span className="mx-10">{branding.tickerText}</span>
        </div>
      </div>

      {/* Navy Navigation Tab Bar */}
      <nav className="bg-[#0a2351] text-white flex items-center overflow-x-auto no-scrollbar border-b border-blue-950">
        <button
          type="button"
          onClick={() => setArrangeOpen(true)}
          className="px-3.5 py-2.5 border-r border-blue-900 hover:bg-blue-900/60 shrink-0"
          title="Arrange navigation tabs"
        >
          <SlidersHorizontal className="w-4 h-4 text-rose-400" />
        </button>
        {visibleTabs.map((tab) => {
          const Icon = getTabIcon(tab.id);
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`px-3.5 sm:px-4 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 border-r border-blue-900/50 transition ${
                isActive
                  ? 'bg-[#163a7a] text-white border-b-2 border-b-sky-400'
                  : 'text-slate-200 hover:bg-blue-900/40'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-rose-400' : 'text-rose-400/80'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Main Page Viewport */}
      <main className="flex-1 min-w-0">{children}</main>

      {/* Floating Risk Disclaimer Pill */}
      <div className="fixed bottom-13 left-2.5 z-20">
        <button
          type="button"
          onClick={() => setDisclaimerOpen(true)}
          className="inline-flex items-center gap-1 bg-amber-400 hover:bg-amber-300 text-slate-900 text-[10px] sm:text-[11px] font-bold px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md shadow-md"
        >
          <AlertTriangle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          <span>Risk Disclaimer</span>
        </button>
      </div>

      {/* Bottom Persistent Bot Runner Bar matching screenshot */}
      <footer className="fixed bottom-0 inset-x-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-2.5 sm:px-3 py-2 flex items-center justify-between gap-2 z-30">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggleBot}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded font-bold text-xs text-white shrink-0 transition ${
              botRunning ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#26a69a] hover:bg-teal-600'
            }`}
          >
            {botRunning ? (
              <>
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run</span>
              </>
            )}
          </button>

          <div className="flex-1 max-w-lg truncate text-center text-xs font-semibold text-slate-700 dark:text-slate-200 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
            {botRunning ? 'Bot is running (Live Deriv Feed)' : 'Bot is not running'}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setFastExecution(!fastExecution)}
          className="flex items-center gap-2 text-[11px] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded shrink-0"
          title="Toggle FAST vs SAFE bot execution mode"
        >
          <span className="text-slate-600 dark:text-slate-300 leading-tight text-left">
            Execution
            <br className="sm:hidden" />{' '}
            <strong className="text-slate-900 dark:text-white">{fastExecution ? 'FAST' : 'SAFE'}</strong>
          </span>
          <span
            className={`w-9 h-5 rounded-full p-0.5 transition inline-flex items-center ${
              fastExecution ? 'bg-[#26a69a]' : 'bg-slate-300 dark:bg-slate-700'
            }`}
          >
            <span
              className={`w-4 h-4 rounded-full bg-white shadow-xs transition-transform ${
                fastExecution ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </span>
        </button>
      </footer>

      {/* Side Drawer Menu (Accessible across all layouts & devices) */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[85vw] bg-white dark:bg-slate-900 h-full shadow-2xl p-4 flex flex-col justify-between border-r border-slate-200 dark:border-slate-800 overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setMenuOpen(false)}>
                    <X className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                  </button>
                  <PipflowLogo compact disableSecretTrigger />
                  <span className="font-bold text-base">Menu</span>
                </div>
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{branding.appName}</span>
              </div>

              <div className="space-y-1 text-sm">
                <div className="flex items-center justify-between py-2.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className="flex items-center gap-2.5">
                    {darkTheme ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                    <span>Dark theme</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDarkTheme(!darkTheme)}
                    className={`w-10 h-5 rounded-full transition p-0.5 ${darkTheme ? 'bg-blue-600' : 'bg-slate-300'}`}
                  >
                    <span
                      className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                        darkTheme ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between py-2.5 px-2">
                  <span className="text-slate-700 dark:text-slate-300">Currency display</span>
                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setCurrency('USD')}
                      className={currency === 'USD' ? 'text-blue-600' : 'text-slate-400'}
                    >
                      USD
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setCurrency('KSH')}
                      className={currency === 'KSH' ? 'text-blue-600' : 'text-slate-400'}
                    >
                      KSH
                    </button>
                  </div>
                </div>

                {siteControls.showDepositWithdraw && (
                  <div className="space-y-1">
                    <a
                      href={siteControls.depositUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setMenuOpen(false)}
                      className="w-full flex items-center justify-between py-2.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-left text-violet-600 dark:text-violet-400 font-semibold"
                    >
                      <span>Deposit on Deriv</span>
                      <ArrowUpRight className="w-4 h-4" />
                    </a>
                    <a
                      href={siteControls.withdrawUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setMenuOpen(false)}
                      className="w-full flex items-center justify-between py-2.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-left text-violet-600 dark:text-violet-400 font-semibold"
                    >
                      <span>Withdraw on Deriv</span>
                      <ArrowUpRight className="w-4 h-4" />
                    </a>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onSelectTab('reports');
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 py-2.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
                >
                  <FileBarChart2 className="w-4 h-4" />
                  <span>Reports</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectTab('notifications');
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 py-2.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
                >
                  <Bell className="w-4 h-4" />
                  <span>Notifications</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectTab('learning');
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 py-2.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Learning Hub</span>
                </button>

                {token ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2.5 py-2.5 px-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 font-semibold text-left"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Log out</span>
                  </button>
                ) : (
                  onBackToLanding && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onBackToLanding();
                      }}
                      className="w-full flex items-center gap-2.5 py-2.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-blue-600 font-semibold text-left"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign In / Register</span>
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex items-center justify-between text-[11px] font-mono text-slate-500">
              <span>{gmtNow}</span>
              <span className="h-2.5 w-2.5 rounded-full bg-teal-500" title="System online" />
            </div>
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {/* Real / Demo Account Switcher Modal */}
      {accountModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="grid grid-cols-2 border-b border-slate-200 dark:border-slate-800 text-sm font-bold">
              <button
                type="button"
                onClick={() => setAccountTab('real')}
                className={`py-3 transition ${
                  accountTab === 'real'
                    ? 'border-b-2 border-rose-500 text-slate-900 dark:text-white'
                    : 'text-slate-400'
                }`}
              >
                Real
              </button>
              <button
                type="button"
                onClick={() => setAccountTab('demo')}
                className={`py-3 transition ${
                  accountTab === 'demo'
                    ? 'border-b-2 border-rose-500 text-slate-900 dark:text-white'
                    : 'text-slate-400'
                }`}
              >
                Demo
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase">
                <span>Trading Accounts</span>
              </div>

              {derivAccounts.filter((a) => a.account_type === accountTab).length === 0 ? (
                <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-3 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <div className="font-semibold">
                    {accountTab === 'demo' ? 'Virtual Practice Account' : 'No Real Account Available'}
                  </div>
                  {accountTab === 'demo' ? (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-slate-500">Demo Practice Mode</span>
                      <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">
                        {Number(user?.virtual_workspace_balance ?? 10000).toFixed(2)} USD
                      </span>
                    </div>
                  ) : (
                    <p>Sign in via Deriv from the landing screen to activate your Real Trading Account.</p>
                  )}
                </div>
              ) : (
                derivAccounts
                  .filter((a) => a.account_type === accountTab)
                  .map((acc) => {
                    const accLowReal = acc.account_type === 'real' && Number(acc.last_known_balance) < 2;
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => {
                          setActiveAccountId(acc.id);
                          setAccountModalOpen(false);
                        }}
                        className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:ring-2 hover:ring-blue-500 text-left transition"
                      >
                        <div>
                          <div className="font-bold text-sm">
                            {acc.account_type === 'real' ? 'Real Trading Account' : 'Demo Practice Account'}
                          </div>
                          <div className="text-xs text-slate-500">{acc.currency} Wallet</div>
                        </div>
                        <div
                          className={`font-bold text-sm font-mono ${
                            accLowReal ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {Number(acc.last_known_balance).toLocaleString('en-US', {
                            minimumFractionDigits: 2
                          })}{' '}
                          {acc.currency}
                        </div>
                      </button>
                    );
                  })
              )}

              {accountTab === 'demo' && token && (
                <button
                  type="button"
                  onClick={handleResetVirtualBalance}
                  className="w-full py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset virtual balance ($10,000)</span>
                </button>
              )}

              <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setAccountModalOpen(false)}
                  className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Arrange Navigation Tabs Modal */}
      {arrangeOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md p-5 space-y-3 max-h-[85vh] overflow-y-auto border border-slate-200 dark:border-slate-800 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-base">Arrange navigation tabs</h3>
                <p className="text-xs text-slate-500">Reorder tabs or hide the ones you do not use.</p>
              </div>
              <button type="button" onClick={() => setArrangeOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              {tabs.map((tab, idx) => (
                <div
                  key={tab.id}
                  className="flex items-center justify-between border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-slate-400" />
                    <span className="font-medium">{tab.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => moveTab(idx, -1)}
                      className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveTab(idx, 1)}
                      className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setTabs((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, visible: !x.visible } : x))
                        )
                      }
                      className="p-1"
                    >
                      {tab.visible ? (
                        <Eye className="w-4 h-4 text-[#26a69a]" />
                      ) : (
                        <EyeOff className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setTabs(DEFAULT_NAV_TABS)}
                className="px-3 py-1.5 rounded-lg border text-xs font-semibold"
              >
                Reset
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setArrangeOpen(false)}
                  className="px-3 py-1.5 rounded-lg border text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveArrangement}
                  className="px-4 py-1.5 rounded-lg bg-[#26a69a] text-white text-xs font-bold"
                >
                  Save arrangement
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Risk Disclaimer Modal */}
      {disclaimerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-5 space-y-3 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>Risk &amp; Compliance Disclaimer</span>
              </h3>
              <button type="button" onClick={() => setDisclaimerOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {siteControls.riskDisclaimerText}
            </p>
            <button
              type="button"
              onClick={() => setDisclaimerOpen(false)}
              className="w-full py-2 rounded-lg bg-blue-600 text-white text-xs font-bold"
            >
              Understood
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
