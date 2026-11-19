import React, { useEffect, useMemo, useState } from 'react';
import { HashRouter, Routes, Route, useSearchParams, useNavigate, Navigate } from 'react-router-dom';
import { AuthProvider, DerivAccountSummary, UserProfile, useAuth } from './contexts/AuthContext';
import { useDerivStream } from './hooks/useDerivStream';
import { SplashScreen } from './components/SplashScreen';
import { LandingPage } from './components/LandingPage';
import { PipflowLogo } from './components/PipflowLogo';
import { WorkspaceLayout } from './layouts/WorkspaceLayout';
import { DashboardPage } from './pages/Dashboard/DashboardPage';
import { BotBuilderPage } from './pages/Dashboard/BotBuilderPage';
import { TradingBotsPage } from './pages/Dashboard/TradingBotsPage';
import { BulkTraderPage } from './pages/Dashboard/BulkTraderPage';
import { AnalysisToolPage } from './pages/Dashboard/AnalysisToolPage';
import { RiskCalculatorPage } from './pages/Dashboard/RiskCalculatorPage';
import { CopyTradingPage } from './pages/Dashboard/CopyTradingPage';
import { ChartsPage } from './pages/Charts/ChartsPage';
import { ReportsPage } from './pages/History/ReportsPage';
import { LearningPage } from './pages/Learning/LearningPage';
import { NotificationsPage } from './pages/Notifications/NotificationsPage';
import { MT5TradingView } from './trading/chart-engine/MT5TradingView';
import { AdminDashboard } from './admin/AdminDashboard';
import { apiFetch } from './services/api';

const VerifyEmailRoute: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Verifying email...');
  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setStatus('Missing verification token.');
      return;
    }
    apiFetch(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(() => setStatus('Email verified successfully. You can now sign in.'))
      .catch((e) => setStatus((e as Error).message));
  }, [params]);

  return (
    <div className="min-h-screen bg-[#060d18] text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-[#0b1526] p-6 text-center space-y-4">
        <h1 className="font-bold text-lg">Email Verification</h1>
        <p className="text-xs text-slate-300">{status}</p>
        <button onClick={() => navigate('/')} className="px-4 py-2 rounded-lg bg-blue-600 text-xs font-bold">
          Return to Pipflowtrades
        </button>
      </div>
    </div>
  );
};

const ResetPasswordRoute: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: params.get('token'), newPassword })
      });
      setMsg('Password reset complete. You may sign in with your new password.');
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-[#060d18] text-white flex items-center justify-center p-4">
      <form onSubmit={submit} className="max-w-md w-full rounded-2xl border border-slate-800 bg-[#0b1526] p-6 space-y-3">
        <h1 className="font-bold text-lg">Set New Password</h1>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (min 8 chars)"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
          required
        />
        <button className="w-full py-2.5 rounded-lg bg-blue-600 font-bold text-sm">Reset Password</button>
        {msg && <p className="text-xs text-sky-400">{msg}</p>}
        <button type="button" onClick={() => navigate('/')} className="w-full text-xs text-slate-400">
          Back to Home
        </button>
      </form>
    </div>
  );
};

const MainWorkspace: React.FC = () => {
  const {
    token,
    user,
    activeDerivAccount,
    botGateUnlocked,
    setBotGateUnlocked,
    globalSettings,
    botConfig,
    fastExecution,
    setSession,
    refreshProfile,
    refreshDerivAccounts,
    refreshBranding,
    bumpOrderVersion,
    logout
  } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [booting, setBooting] = useState(true);
  const [oauthExchanging, setOauthExchanging] = useState(false);
  const [oauthError, setOauthError] = useState('');
  const [publicMode, setPublicMode] = useState(false);
  const [activeTab, setActiveTabState] = useState(() => localStorage.getItem('pipflow_active_tab') || 'dashboard');
  const [activeSymbol, setActiveSymbolState] = useState(() => localStorage.getItem('pipflow_active_symbol') || 'R_25');
  const [watchSymbols, setWatchSymbols] = useState<string[]>([]);
  const [botRunning, setBotRunning] = useState(false);

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    localStorage.setItem('pipflow_active_tab', tab);
  };

  const setActiveSymbol = (sym: string) => {
    setActiveSymbolState(sym);
    localStorage.setItem('pipflow_active_symbol', sym);
  };

  const {
    ticksBySymbol,
    lastOrderEvent,
    settingsVersion,
    accountVersion,
    suspendedCount,
    botStoppedCount
  } = useDerivStream(token, activeSymbol, watchSymbols);

  const livePricesMap = useMemo(() => {
    const map: Record<string, number> = {};
    Object.values(ticksBySymbol).forEach((t) => {
      map[t.symbol] = t.quote;
    });
    return map;
  }, [ticksBySymbol]);

  // Handle Official Deriv OAuth2 return back to the site dashboard (?oauth_token=... OR ?deriv_connected=... OR ?acct1=...&token1=...)
  useEffect(() => {
    const oauthErr = searchParams.get('deriv_error');
    if (oauthErr) {
      setOauthError(`Deriv OAuth error: ${oauthErr}`);
      setSearchParams({}, { replace: true });
      return;
    }

    const targetTab = searchParams.get('tab') || 'dashboard';
    const derivConnected = searchParams.get('deriv_connected');
    if (derivConnected) {
      setPublicMode(false);
      setActiveTab(targetTab);
      refreshDerivAccounts(false);
      refreshProfile();
      setSearchParams({}, { replace: true });
      return;
    }

    const returnedJwt = searchParams.get('oauth_token');
    if (returnedJwt) {
      setOauthExchanging(true);
      localStorage.setItem('pipflow_token', returnedJwt);
      apiFetch<{ user: UserProfile }>('/auth/me')
        .then((res) => {
          setSession(returnedJwt, res.user);
          setPublicMode(false);
          setActiveTab(targetTab);
          return refreshDerivAccounts(false);
        })
        .catch((err) => setOauthError((err as Error).message))
        .finally(() => {
          setSearchParams({}, { replace: true });
          setOauthExchanging(false);
        });
      return;
    }

    // Also support Deriv redirecting directly to site root URL with ?acct1=...&token1=...
    const winParams = new URLSearchParams(window.location.search);
    const directTokens: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const t = winParams.get(`token${i}`) || searchParams.get(`token${i}`);
      if (t) directTokens.push(t);
    }

    if (directTokens.length > 0) {
      setOauthExchanging(true);
      apiFetch<{ token?: string; user?: UserProfile; accounts?: DerivAccountSummary[] }>('/deriv/oauth/exchange', {
        method: 'POST',
        body: JSON.stringify({ tokens: directTokens })
      })
        .then((res) => {
          if (res.token && res.user) {
            setSession(res.token, res.user, res.accounts);
          }
          setPublicMode(false);
          setActiveTab(targetTab);
          return refreshDerivAccounts(false);
        })
        .catch((err) => setOauthError((err as Error).message))
        .finally(() => {
          if (window.location.search) {
            window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
          }
          setSearchParams({}, { replace: true });
          setOauthExchanging(false);
        });
    }
  }, [searchParams]);

  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), 750);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (lastOrderEvent?.type === 'order_closed' || lastOrderEvent?.type === 'bot_order_opened') {
      refreshProfile();
      refreshDerivAccounts(false);
      bumpOrderVersion();
    }
  }, [lastOrderEvent, refreshProfile, refreshDerivAccounts, bumpOrderVersion]);

  // Instant reflection of Admin alterations across site and individual accounts
  useEffect(() => {
    if (settingsVersion > 0) {
      refreshBranding();
    }
  }, [settingsVersion, refreshBranding]);

  useEffect(() => {
    if (accountVersion > 0) {
      refreshProfile();
      refreshDerivAccounts(false);
      bumpOrderVersion();
    }
  }, [accountVersion, refreshProfile, refreshDerivAccounts, bumpOrderVersion]);

  useEffect(() => {
    if (botStoppedCount > 0) {
      setBotRunning(false);
    }
  }, [botStoppedCount]);

  useEffect(() => {
    if (suspendedCount > 0) {
      logout();
    }
  }, [suspendedCount, logout]);

  useEffect(() => {
    if (token && botGateUnlocked) {
      apiFetch<{ running: boolean }>('/bots/status', {}, true)
        .then((res) => setBotRunning(res.running))
        .catch(() => {});
    }
  }, [token, botGateUnlocked]);

  if (booting || oauthExchanging) {
    return <SplashScreen />;
  }

  if (globalSettings.maintenanceMode && user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-[#060d18] text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-[#0b1526] p-6 text-center space-y-4 shadow-2xl">
          <div className="flex justify-center">
            <PipflowLogo compact />
          </div>
          <h1 className="text-lg font-extrabold text-amber-400">Platform Maintenance Mode</h1>
          <p className="text-xs text-slate-300 leading-relaxed">
            Pipflowtrades is currently undergoing scheduled maintenance. Please check back shortly.
          </p>
        </div>
      </div>
    );
  }

  if (!token && !publicMode) {
    return (
      <LandingPage
        initialOAuthError={oauthError}
        onOpenPublicCharts={() => {
          setPublicMode(true);
          setActiveTab('trading_view');
        }}
      />
    );
  }

  const handleToggleBot = async () => {
    if (!token) {
      setPublicMode(false);
      return;
    }
    if (!botGateUnlocked) {
      setActiveTab('freebots');
      return;
    }
    if (botRunning) {
      await apiFetch('/bots/stop', { method: 'POST' }, true);
      setBotRunning(false);
    } else {
      try {
        const effectiveContract =
          botConfig.purchaseAction === 'Over'
            ? 'DIGITOVER'
            : botConfig.purchaseAction === 'Under'
              ? 'DIGITUNDER'
              : botConfig.purchaseAction === 'Even'
                ? 'DIGITEVEN'
                : botConfig.purchaseAction === 'Odd'
                  ? 'DIGITODD'
                  : botConfig.tradeType;

        await apiFetch(
          '/bots/run',
          {
            method: 'POST',
            body: JSON.stringify({
              symbol: botConfig.symbol,
              botName: botConfig.botName,
              stake: botConfig.stake,
              tpPct: botConfig.tpPct,
              slPct: botConfig.slPct,
              stopLossUsd: botConfig.stopLoss,
              maxWins: botConfig.numberOfWins,
              contractType: effectiveContract,
              barrier: botConfig.initialPrediction,
              recoveryPrediction: botConfig.recoveryPrediction,
              duration: botConfig.duration,
              durationUnit: botConfig.durationUnit,
              martingale: botConfig.martingale,
              useMartingale: botConfig.useMartingale,
              allowBulkPurchase: botConfig.allowBulkPurchase,
              bulkTradesCount: botConfig.bulkTradesCount,
              fastExecution,
              entryCondition: {
                enabled: botConfig.entrySignalMode,
                lookback: botConfig.conditionLookback,
                comparator: botConfig.conditionComparator,
                digit: botConfig.conditionDigit,
                tradeEachTick: botConfig.tradeEachTick
              },
              connectedAccountId: activeDerivAccount?.id ?? null
            })
          },
          true
        );
        setBotRunning(true);
      } catch (err) {
        if ((err as { code?: string }).code === 'BOT_GATE_LOCKED') {
          localStorage.removeItem('pipflow_bot_gate');
          setBotGateUnlocked(false);
          setActiveTab('freebots');
        }
      }
    }
  };

  return (
    <WorkspaceLayout
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      botRunning={botRunning}
      onToggleBot={handleToggleBot}
      onBackToLanding={() => setPublicMode(false)}
    >
      {activeTab === 'dashboard' && <DashboardPage onSelectTab={setActiveTab} />}
      {activeTab === 'bot_builder' && (
        <BotBuilderPage
          onBotStarted={() => setBotRunning(true)}
          onOpenCharts={() => setActiveTab('charts')}
        />
      )}
      {activeTab === 'charts' && (
        <ChartsPage
          mode="charts"
          symbol={activeSymbol}
          liveTick={ticksBySymbol[activeSymbol] ?? null}
          onSymbolChange={setActiveSymbol}
          onOpenTradingView={() => setActiveTab('trading_view')}
        />
      )}
      {activeTab === 'freebots' && <TradingBotsPage onBotStarted={() => setBotRunning(true)} />}
      {activeTab === 'bulk_trader' && <BulkTraderPage />}
      {activeTab === 'analysistool' && <AnalysisToolPage />}
      {activeTab === 'reports' && <ReportsPage />}
      {activeTab === 'trading_plan' && <RiskCalculatorPage />}
      {activeTab === 'copy_trading' && <CopyTradingPage />}
      {activeTab === 'dtrader' && (
        <ChartsPage
          mode="dtrader"
          symbol={activeSymbol}
          liveTick={ticksBySymbol[activeSymbol] ?? null}
          onSymbolChange={setActiveSymbol}
          onOpenTradingView={() => setActiveTab('trading_view')}
        />
      )}
      {activeTab === 'trading_view' && (
        <MT5TradingView
          symbol={activeSymbol}
          liveTick={ticksBySymbol[activeSymbol] ?? null}
          livePricesMap={livePricesMap}
          onSymbolChange={setActiveSymbol}
          onWatchSymbolsChange={setWatchSymbols}
        />
      )}
      {activeTab === 'learning' && <LearningPage />}
      {activeTab === 'notifications' && <NotificationsPage />}
    </WorkspaceLayout>
  );
};

const HiddenAdminGate: React.FC = () => {
  const { user } = useAuth();
  let unlocked = false;
  try {
    unlocked = sessionStorage.getItem('pf_secret_console') === '1';
  } catch {
    unlocked = false;
  }

  const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
  const isOAuthReturn = user?.role === 'admin' && new URLSearchParams(hashQuery).get('commission_connected') === '1';

  if (!unlocked && !isOAuthReturn) {
    return <Navigate to="/" replace />;
  }

  return <AdminDashboard />;
};

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/_console" element={<HiddenAdminGate />} />
          <Route path="/verify-email" element={<VerifyEmailRoute />} />
          <Route path="/reset-password" element={<ResetPasswordRoute />} />
          <Route path="*" element={<MainWorkspace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
