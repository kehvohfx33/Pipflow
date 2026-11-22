import React, { useState } from 'react';
import {
  ArrowRight,
  Bot,
  BarChart3,
  Shield,
  Users,
  Check,
  Zap,
  LineChart,
  ExternalLink
} from 'lucide-react';
import { PipflowLogo } from './PipflowLogo';
import { apiFetch } from '../services/api';
import { useAuth, UserProfile, DerivAccountSummary } from '../contexts/AuthContext';

interface LandingPageProps {
  onOpenPublicCharts: () => void;
  initialOAuthError?: string;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onOpenPublicCharts, initialOAuthError = '' }) => {
  const { setSession } = useAuth();
  const [modalMode, setModalMode] = useState<'none' | 'login' | 'register' | 'forgot'>('none');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState(initialOAuthError);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  const handleDerivOAuth = async (mode: 'login' | 'signup' = 'login') => {
    setOauthLoading(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{ url: string; signupUrl?: string }>(
        `/deriv/oauth-url/public?mode=${encodeURIComponent(mode)}`
      );
      window.location.href = mode === 'signup' && res.signupUrl ? res.signupUrl : res.url;
    } catch (err) {
      setErrorMsg((err as Error).message);
      setOauthLoading(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      if (modalMode === 'forgot') {
        const res = await apiFetch<{ message: string }>('/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
        setStatusMsg(res.message);
      } else {
        const path = modalMode === 'register' ? '/auth/register' : '/auth/login';
        const res = await apiFetch<{
          user: UserProfile;
          accounts?: DerivAccountSummary[];
        }>(path, {
          method: 'POST',
          body: JSON.stringify({ email, password, fullName })
        });
        setSession(res.user, res.accounts);
        setModalMode('none');
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#060d18] text-white">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#060d18]/90 backdrop-blur px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <PipflowLogo />
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => handleDerivOAuth('login')}
              disabled={oauthLoading}
              className="px-4 py-1.5 rounded-full bg-white text-slate-900 text-xs font-bold flex items-center gap-1.5 hover:bg-slate-100 transition whitespace-nowrap"
            >
              <span>{oauthLoading ? 'Connecting...' : 'Login Now'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-4xl mx-auto px-4 pt-12 pb-10 text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full border border-slate-700 bg-slate-900/70 text-xs text-sky-400">
          <Zap className="w-3.5 h-3.5 text-sky-400" />
          <span>Your connected trading workspace</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-balance">
          Welcome to{' '}
          <span className="text-sky-400">Pipfl</span>
          <span className="text-rose-500">ow</span>
          <span className="text-cyan-300">trades</span>
        </h1>

        <p className="max-w-xl mx-auto text-sm sm:text-base text-slate-400">
          Your all-in-one workspace for automated analysis, smart bots, MT5-inspired charts, and real-time Deriv market insights.
        </p>

        {initialOAuthError && modalMode === 'none' && (
          <div className="max-w-md mx-auto rounded-xl bg-rose-950/60 border border-rose-700 px-4 py-2.5 text-xs text-rose-300">
            {initialOAuthError}
          </div>
        )}

        {/* Stacked Primary CTAs — clean alignment + Official Deriv OAuth Sign-Up / Login */}
        <div className="max-w-xs mx-auto space-y-3 pt-2">
          <button
            onClick={() => handleDerivOAuth('login')}
            disabled={oauthLoading}
            className="w-full py-3 px-6 rounded-full bg-gradient-to-r from-rose-500 via-pink-500 to-purple-600 font-bold text-sm shadow-lg shadow-rose-500/20 flex items-center justify-center gap-2 hover:opacity-95 transition"
          >
            <span>{oauthLoading ? 'Redirecting to Deriv...' : 'Start Trading Now (Deriv)'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            onClick={() => setModalMode('login')}
            className="w-full py-2.5 px-6 rounded-full border-2 border-amber-400/80 bg-emerald-600/80 hover:bg-emerald-600 font-bold text-sm transition"
          >
            Existing Account Login
          </button>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => handleDerivOAuth('signup')}
              disabled={oauthLoading}
              className="py-2.5 px-4 rounded-full bg-indigo-600 hover:bg-indigo-700 font-bold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <span>Sign Up on Deriv</span>
              <ExternalLink className="w-3 h-3" />
            </button>
            <button
              onClick={onOpenPublicCharts}
              className="py-2.5 px-4 rounded-full border border-slate-700 hover:border-sky-400 font-semibold text-xs text-slate-200 flex items-center justify-center gap-1.5 transition"
            >
              <LineChart className="w-3.5 h-3.5 text-sky-400" />
              <span>Live Charts</span>
            </button>
          </div>

          <div className="flex items-center justify-center gap-2 pt-0.5">
            <button
              onClick={() => setModalMode('register')}
              className="px-4 py-1.5 rounded-full border border-slate-700 hover:border-slate-500 text-xs text-slate-300 transition"
            >
              Email Sign Up
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400 pt-2">
          <span className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-sky-400" /> Official Deriv OAuth2
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-sky-400" /> Public Market Analysis
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-sky-400" /> Virtual Account Available
          </span>
        </div>

        {/* Preview Cards BB / PA */}
        <div className="grid sm:grid-cols-2 gap-4 pt-6 text-left">
          <div className="rounded-2xl border border-slate-800 bg-[#0b1526] p-5 space-y-3">
            <div className="h-12 w-12 rounded-full border border-sky-500/40 bg-slate-900 flex items-center justify-center font-bold text-sm text-sky-300 mx-auto">
              BB
            </div>
            <p className="text-xs italic text-slate-400 text-center">
              Load a strategy into the visual workspace and inspect its blocks before choosing to run.
            </p>
            <div className="text-center pt-1">
              <div className="font-bold text-sm">Bot Builder</div>
              <div className="text-xs text-sky-400">Editable strategies</div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0b1526] p-5 space-y-3">
            <div className="h-12 w-12 rounded-full border border-rose-500/40 bg-slate-900 flex items-center justify-center font-bold text-sm text-rose-300 mx-auto">
              PA
            </div>
            <p className="text-xs italic text-slate-400 text-center">
              Review symbol history and digit distributions without sharing credentials with public feeds.
            </p>
            <div className="text-center pt-1">
              <div className="font-bold text-sm">Public Analysis</div>
              <div className="text-xs text-sky-400">Live market data</div>
            </div>
          </div>
        </div>

        {/* Stat Circles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-6 max-w-2xl mx-auto">
          {[
            { num: '85', label: 'XML Bots' },
            { num: '5', label: 'Analysis Views' },
            { num: '4', label: 'Speed Modes' },
            { num: '1', label: 'Connected Workspace' }
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-2">
              <div className="h-16 w-16 rounded-full border border-slate-800 bg-[#0b1526] flex items-center justify-center text-rose-400 font-bold text-lg">
                {stat.num}
              </div>
              <span className="text-xs text-slate-400">{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Powerful Features Section */}
      <section className="max-w-4xl mx-auto px-4 py-10 space-y-6">
        <div className="text-center space-y-2">
          <span className="inline-block px-3 py-1 rounded-full border border-slate-800 bg-slate-900 text-[11px] font-bold tracking-wider text-sky-400">
            PLATFORM
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold">Powerful Features for Modern Traders</h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Explore your tools before making a trading decision across MT5 charts, analysis, and bots.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {[
            {
              icon: Bot,
              title: 'AI-Powered Trading Bots',
              sub: 'Editable automation',
              desc: 'Configure strategies, inspect their logic, and run automated paper execution on live Deriv feeds.'
            },
            {
              icon: BarChart3,
              title: 'Real-Time Market Analysis',
              sub: 'Data-driven decisions',
              desc: 'Explore MT5 candlestick charts, digit distributions, and live Deriv history before deciding.'
            },
            {
              icon: Users,
              title: 'Unified Trading Accounts',
              sub: 'Real & Demo switching',
              desc: 'Trade seamlessly across your real and demo trading modes inside one clean workspace.'
            },
            {
              icon: Shield,
              title: 'Risk Management Tools',
              sub: 'Plan your limits',
              desc: 'Configure Take Profit, Stop Loss, and Martingale stake sizing with strict workspace limits.'
            }
          ].map((feat) => (
            <div key={feat.title} className="rounded-2xl border border-slate-800 bg-[#0b1526] p-5 space-y-2.5">
              <div className="h-10 w-10 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-sky-400">
                <feat.icon className="w-5 h-5" />
              </div>
              <div className="font-bold text-base">{feat.title}</div>
              <div className="text-xs text-sky-400 font-medium">{feat.sub}</div>
              <p className="text-xs text-slate-400 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why Choose Pipflowtrades */}
      <section className="max-w-4xl mx-auto px-4 pb-16 space-y-8">
        <div className="rounded-2xl border border-slate-800 bg-[#0b1526] p-6 space-y-4">
          <div className="text-center space-y-1">
            <span className="inline-block px-3 py-0.5 rounded-full border border-slate-800 text-[10px] font-bold text-sky-400">
              WHY PIPFLOWTRADES
            </span>
            <h3 className="text-2xl font-extrabold">Why Choose Pipflowtrades?</h3>
            <p className="text-xs text-slate-400">Keep analysis, automation, and risk planning together</p>
          </div>
          <div className="space-y-2.5">
            {[
              'Inspect editable XML strategies before running',
              'Public symbol data available via Official Deriv WebSocket',
              'Instant switching between Real and Demo trading modes',
              'Review settlement-based session reports & MT5 TP/SL history',
              'Choose explicit Stop-Loss and Take-Profit levels on charts',
              'Responsive workspace for desktop and mobile'
            ].map((line) => (
              <div key={line} className="flex items-center gap-3 rounded-xl border border-slate-800/80 bg-[#08101c] px-4 py-2.5 text-xs text-slate-200">
                <span className="h-5 w-5 rounded-full bg-rose-500/15 text-rose-400 flex items-center justify-center shrink-0">
                  <Check className="w-3.5 h-3.5" />
                </span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-[#1f1024] via-[#0d172a] to-[#0b1930] p-8 text-center space-y-4">
          <span className="inline-block px-3 py-0.5 rounded-full border border-slate-700 text-[10px] font-bold text-sky-400">
            GET STARTED
          </span>
          <h3 className="text-2xl font-extrabold">Ready to Explore Your Workspace?</h3>
          <p className="text-xs text-slate-300">Connect with Official Deriv OAuth2 or create a workspace account.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => handleDerivOAuth('login')}
              disabled={oauthLoading}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-rose-500 to-indigo-600 font-bold text-xs shadow-lg"
            >
              Continue with Deriv <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleDerivOAuth('signup')}
              disabled={oauthLoading}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-slate-700 hover:border-sky-400 font-bold text-xs"
            >
              Sign Up on Deriv <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <footer className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-center sm:justify-between gap-3 text-xs text-slate-500">
          <span>Pipflowtrades (pipflowtrade.site) — Deriv API Trading &amp; Automation Workspace</span>
          <nav aria-label="Public Sections" className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-400">
            <a href="/charts" className="hover:text-sky-400 transition">Live Charts</a>
            <a href="/trading-view" className="hover:text-sky-400 transition">MT5 Terminal</a>
            <a href="/bots" className="hover:text-sky-400 transition">Trading Bots</a>
            <a href="/analysis" className="hover:text-sky-400 transition">Market Analysis</a>
            <a href="/learning" className="hover:text-sky-400 transition">Learning Hub</a>
          </nav>
        </footer>
      </section>

      {/* Auth Modal */}
      {modalMode !== 'none' && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0b1526] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">
                {modalMode === 'login' && 'Sign In to Pipflowtrades'}
                {modalMode === 'register' && 'Create Pipflowtrades Account'}
                {modalMode === 'forgot' && 'Password Recovery'}
              </h2>
              <button onClick={() => setModalMode('none')} className="text-xs text-slate-400 hover:text-white">
                Close
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="space-y-3">
                {modalMode !== 'forgot' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDerivOAuth('login')}
                      disabled={oauthLoading}
                      className="w-full py-2.5 rounded-lg bg-[#ff444f] hover:bg-rose-600 font-bold text-xs text-white flex items-center justify-center gap-2 transition"
                    >
                      <span>{oauthLoading ? 'Connecting to Deriv...' : 'Continue with Official Deriv OAuth2'}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="h-px flex-1 bg-slate-800" />
                      <span>or use Pipflowtrades email</span>
                      <span className="h-px flex-1 bg-slate-800" />
                    </div>
                  </>
                )}

                {modalMode === 'register' && (
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full Name"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm"
                    required
                  />
                )}
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email Address"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm"
                  required
                />
                {modalMode !== 'forgot' && (
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password (min 8 chars)"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm"
                    required
                  />
                )}

                {errorMsg && (
                  <div className="rounded-lg bg-rose-950/60 border border-rose-700 px-3 py-2 text-xs text-rose-300">
                    {errorMsg}
                  </div>
                )}
                {statusMsg && (
                  <div className="rounded-lg bg-emerald-950/60 border border-emerald-700 px-3 py-2 text-xs text-emerald-300">
                    {statusMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 font-bold text-sm"
                >
                  {loading
                    ? 'Processing...'
                    : modalMode === 'register'
                      ? 'Create Account'
                      : modalMode === 'forgot'
                        ? 'Send Recovery Email'
                        : 'Sign In'}
                </button>

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  {modalMode === 'login' ? (
                    <>
                      <button type="button" onClick={() => setModalMode('register')} className="hover:text-white">
                        Create account
                      </button>
                      <button type="button" onClick={() => setModalMode('forgot')} className="hover:text-white">
                        Forgot password?
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setModalMode('login')} className="hover:text-white">
                      Back to Login
                    </button>
                  )}
                </div>
              </form>
          </div>
        </div>
      )}
    </div>
  );
};
