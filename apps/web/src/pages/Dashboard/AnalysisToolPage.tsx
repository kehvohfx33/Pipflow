import React, { useEffect, useMemo, useState } from 'react';
import { Activity, TrendingUp, Zap } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';
import {
  fetchDerivInstrumentsDirect,
  fetchDerivTickHistoryDirect,
  subscribeDerivTicksDirect
} from '../../services/derivBrowserWs';

interface DigitStats {
  symbol: string;
  count: number;
  latestPrice: number;
  latestDigit: number;
  pipSize: number;
  distribution: Array<{ digit: number; count: number; percentage: number }>;
  even: { count: number; percentage: number };
  odd: { count: number; percentage: number };
  recentParity: Array<'E' | 'O'>;
}

interface InstrumentOption {
  symbol: string;
  display_name: string;
  market: string;
}

function extractLastDigit(price: number, pipSize: number): number {
  const formatted = price.toFixed(Math.max(0, Math.min(8, pipSize)));
  const d = Number(formatted.charAt(formatted.length - 1));
  return Number.isNaN(d) ? 0 : d;
}

function computeStatsFromPrices(symbol: string, prices: number[], pipSize: number): DigitStats {
  const digitCounts = Array(10).fill(0);
  const recentParity: Array<'E' | 'O'> = [];
  let even = 0;
  let odd = 0;

  for (let i = 0; i < prices.length; i++) {
    const d = extractLastDigit(prices[i], pipSize);
    digitCounts[d]++;
    const isEven = d % 2 === 0;
    if (isEven) even++;
    else odd++;
    if (i >= prices.length - 16) recentParity.push(isEven ? 'E' : 'O');
  }

  const total = prices.length || 1;
  const latestPrice = prices[prices.length - 1] ?? 0;
  const latestDigit = extractLastDigit(latestPrice, pipSize);

  return {
    symbol,
    count: prices.length,
    latestPrice,
    latestDigit,
    pipSize,
    distribution: digitCounts.map((c, digit) => ({
      digit,
      count: c,
      percentage: Number(((c / total) * 100).toFixed(1))
    })),
    even: { count: even, percentage: Number(((even / total) * 100).toFixed(1)) },
    odd: { count: odd, percentage: Number(((odd / total) * 100).toFixed(1)) },
    recentParity
  };
}

function computeRsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / period / (losses / period);
  return Number((100 - 100 / (1 + rs)).toFixed(1));
}

export const AnalysisToolPage: React.FC = () => {
  const { token, activeDerivAccount, refreshDerivAccounts, refreshProfile, bumpOrderVersion } = useAuth();
  const [subTab, setSubTab] = useState<'Dcircles' | 'Signals' | 'Over/Under' | 'Rise/Fall'>('Dcircles');
  const [instruments, setInstruments] = useState<InstrumentOption[]>([]);
  const [symbol, setSymbol] = useState('R_100');
  const [ticksWindow, setTicksWindow] = useState(500);
  const [barrierDigit, setBarrierDigit] = useState(4);
  const [stake, setStake] = useState(5);
  const [prices, setPrices] = useState<number[]>([]);
  const [pipSize, setPipSize] = useState(2);
  const [stats, setStats] = useState<DigitStats | null>(null);
  const [error, setError] = useState('');
  const [tradeMsg, setTradeMsg] = useState('');
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadInstruments = async () => {
      const merged = new Map<string, InstrumentOption>();
      try {
        const res = await apiFetch<{ instruments?: InstrumentOption[] }>('/market/instruments');
        if (Array.isArray(res?.instruments)) {
          res.instruments.forEach((item) => merged.set(item.symbol, item));
        }
      } catch {
        // Fallback to direct Deriv
      }
      if (merged.size < 45) {
        try {
          const direct = await fetchDerivInstrumentsDirect();
          direct.forEach((item) => {
            if (!merged.has(item.symbol)) merged.set(item.symbol, item);
          });
        } catch {
          // ignore
        }
      }
      if (!cancelled && merged.size > 0) setInstruments(Array.from(merged.values()));
    };
    loadInstruments();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError('');

    const seedHistory = async () => {
      try {
        const direct = await fetchDerivTickHistoryDirect(symbol, Math.min(2000, ticksWindow));
        if (!cancelled && direct.prices.length > 0) {
          setPipSize(direct.pipSize);
          setPrices(direct.prices.slice(-ticksWindow));
          setStats(computeStatsFromPrices(symbol, direct.prices.slice(-ticksWindow), direct.pipSize));
          return;
        }
      } catch {
        // Fallback to backend digit-analysis endpoint
      }

      try {
        const backend = await apiFetch<DigitStats>(
          `/market/digit-analysis?symbol=${encodeURIComponent(symbol)}&count=${ticksWindow}`
        );
        if (!cancelled && backend?.distribution) {
          setPipSize(backend.pipSize ?? 2);
          setStats(backend);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };

    seedHistory();

    const unsub = subscribeDerivTicksDirect(symbol, (tick) => {
      if (cancelled) return;
      const ps = tick.pipSize ?? pipSize;
      setPipSize(ps);
      setPrices((prev) => {
        const next = [...prev, tick.quote].slice(-ticksWindow);
        setStats(computeStatsFromPrices(symbol, next, ps));
        return next;
      });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [symbol, ticksWindow]);

  const safeDistribution = Array.isArray(stats?.distribution) ? stats!.distribution : [];
  const safeRecentParity = Array.isArray(stats?.recentParity) ? stats!.recentParity : [];
  const maxPct = Math.max(...(safeDistribution.length > 0 ? safeDistribution.map((d) => d.percentage) : [0]));
  const minPct = Math.min(...(safeDistribution.length > 0 ? safeDistribution.map((d) => d.percentage) : [100]));

  const overStats = useMemo(() => {
    const over = safeDistribution.filter((d) => d.digit > barrierDigit).reduce((s, d) => s + d.percentage, 0);
    const under = safeDistribution.filter((d) => d.digit < barrierDigit).reduce((s, d) => s + d.percentage, 0);
    const match = safeDistribution.find((d) => d.digit === barrierDigit)?.percentage ?? 0;
    return {
      over: Number(over.toFixed(1)),
      under: Number(under.toFixed(1)),
      match: Number(match.toFixed(1))
    };
  }, [safeDistribution, barrierDigit]);

  const trendStats = useMemo(() => {
    if (prices.length < 10) return { rsi: 50, risePct: 50, fallPct: 50, sma10: 0, sma30: 0, bias: 'NEUTRAL' };
    let rises = 0;
    let falls = 0;
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > prices[i - 1]) rises++;
      else if (prices[i] < prices[i - 1]) falls++;
    }
    const tot = rises + falls || 1;
    const sma10 = prices.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, prices.length);
    const sma30 = prices.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, prices.length);
    const rsi = computeRsi(prices, 14);
    const bias = sma10 > sma30 && rsi >= 52 ? 'BULLISH (CALL)' : sma10 < sma30 && rsi <= 48 ? 'BEARISH (PUT)' : 'CONSOLIDATING';
    return {
      rsi,
      risePct: Number(((rises / tot) * 100).toFixed(1)),
      fallPct: Number(((falls / tot) * 100).toFixed(1)),
      sma10,
      sma30,
      bias
    };
  }, [prices]);

  const executeInstantTrade = async (
    side: 'BUY' | 'SELL',
    contractType: string,
    barrier?: number
  ) => {
    if (!token || !stats?.latestPrice) {
      setTradeMsg('Sign in to execute instant trades.');
      return;
    }
    setExecuting(true);
    setTradeMsg('');
    try {
      await apiFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          side,
          stake,
          entryPrice: stats.latestPrice,
          contractType,
          duration: 1,
          durationUnit: 't',
          barrier,
          connectedAccountId: activeDerivAccount?.id ?? null,
          executionMode: activeDerivAccount ? 'deriv' : 'virtual'
        })
      });
      setTradeMsg(
        `Instant ${contractType}${barrier !== undefined ? ` (${barrier})` : ''} placed on ${symbol} ($${stake}).`
      );
      refreshDerivAccounts(false);
      refreshProfile();
      bumpOrderVersion();
    } catch (err) {
      setTradeMsg((err as Error).message);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {(['Dcircles', 'Over/Under', 'Rise/Fall', 'Signals'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSubTab(t)}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition ${
                subTab === t
                  ? 'bg-[#1d6ae5] text-white border-[#1d6ae5]'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
            <Activity className="w-3.5 h-3.5" /> Live Deriv Feed
          </span>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-xs">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Deriv Instrument:</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800"
            >
              {instruments.length === 0 ? (
                <>
                  <option value="R_100">Volatility 100 Index</option>
                  <option value="R_75">Volatility 75 Index</option>
                  <option value="R_50">Volatility 50 Index</option>
                  <option value="R_25">Volatility 25 Index</option>
                  <option value="1HZ100V">Volatility 100 (1s) Index</option>
                  <option value="1HZ90V">Volatility 90 (1s) Index</option>
                </>
              ) : (
                instruments.map((inst) => (
                  <option key={inst.symbol} value={inst.symbol}>
                    {inst.symbol} — {inst.display_name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Instant Stake (USD):</label>
            <input
              type="number"
              min={0.35}
              step="0.5"
              value={stake}
              onChange={(e) => setStake(Math.max(0.35, Number(e.target.value) || 1))}
              className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-mono font-bold bg-white dark:bg-slate-800"
            />
          </div>
        </div>

        {stats ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-100 dark:bg-slate-800 rounded-xl px-4 py-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Live Spot Price</div>
                <div className="text-2xl font-black font-mono tabular-nums">{stats.latestPrice.toFixed(stats.pipSize)}</div>
              </div>
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Momentum / RSI(14)</div>
                <div className="text-sm font-bold font-mono text-blue-600 dark:text-sky-400">
                  {trendStats.bias} · RSI {trendStats.rsi}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Last Digit</div>
                <div className="text-2xl font-black font-mono text-blue-600 dark:text-sky-400">{stats.latestDigit}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold">Ticks Sample:</span>
                <input
                  type="number"
                  min={50}
                  max={2000}
                  value={ticksWindow}
                  onChange={(e) => setTicksWindow(Math.max(50, Math.min(2000, Number(e.target.value) || 200)))}
                  className="w-24 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 text-center font-mono bg-transparent"
                />
              </div>
              <span className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                Analyzed: {stats.count} real ticks
              </span>
            </div>

            {/* 0-9 Colored Digit Circles */}
            <div className="grid grid-cols-5 gap-3 py-2">
              {safeDistribution.map((d) => {
                const isMax = d.percentage === maxPct;
                const isMin = d.percentage === minPct;
                const isCurrent = d.digit === stats.latestDigit;
                return (
                  <button
                    key={d.digit}
                    type="button"
                    onClick={() => setBarrierDigit(d.digit)}
                    className="flex flex-col items-center group"
                    title={`Click to analyze Over/Under ${d.digit}`}
                  >
                    <div
                      className={`h-14 w-14 rounded-full flex flex-col items-center justify-center border-2 text-xs font-bold transition ${
                        isMax
                          ? 'bg-blue-600 text-white border-blue-700'
                          : isMin
                            ? 'bg-rose-600 text-white border-rose-700'
                            : isCurrent
                              ? 'bg-amber-500 text-slate-900 border-blue-500 ring-2 ring-blue-400/50'
                              : d.digit === barrierDigit
                                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                                : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      <span className="text-sm font-black">{d.digit}</span>
                      <span className="text-[10px] font-mono tabular-nums">{d.percentage}%</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Over/Under & Rise/Fall Interactive Distribution */}
            <div className="grid sm:grid-cols-2 gap-3 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span>Over / Under Barrier ({barrierDigit})</span>
                  <select
                    value={barrierDigit}
                    onChange={(e) => setBarrierDigit(Number(e.target.value))}
                    className="border border-slate-300 dark:border-slate-700 rounded px-2 py-0.5 bg-transparent font-mono"
                  >
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                      <option key={d} value={d}>
                        Digit {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-emerald-600 font-bold">OVER {barrierDigit}: {overStats.over}%</span>
                  <span className="text-slate-400">EQ: {overStats.match}%</span>
                  <span className="text-rose-600 font-bold">UNDER {barrierDigit}: {overStats.under}%</span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    disabled={executing}
                    onClick={() => executeInstantTrade('BUY', 'DIGITOVER', barrierDigit)}
                    className="py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1"
                  >
                    <Zap className="w-3 h-3" /> Instant OVER {barrierDigit}
                  </button>
                  <button
                    type="button"
                    disabled={executing}
                    onClick={() => executeInstantTrade('SELL', 'DIGITUNDER', barrierDigit)}
                    className="py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1"
                  >
                    <Zap className="w-3 h-3" /> Instant UNDER {barrierDigit}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="inline-flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5 text-blue-600" /> Rise / Fall &amp; Even/Odd
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">
                    Rise {trendStats.risePct}% / Fall {trendStats.fallPct}%
                  </span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-emerald-600 font-bold">EVEN: {stats.even.percentage}%</span>
                  <span className="text-rose-600 font-bold">ODD: {stats.odd.percentage}%</span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    disabled={executing}
                    onClick={() => executeInstantTrade('BUY', 'DIGITEVEN')}
                    className="py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold"
                  >
                    Instant EVEN
                  </button>
                  <button
                    type="button"
                    disabled={executing}
                    onClick={() => executeInstantTrade('SELL', 'DIGITODD')}
                    className="py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
                  >
                    Instant ODD
                  </button>
                </div>
              </div>
            </div>

            {tradeMsg && (
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-sky-300 font-semibold">
                {tradeMsg}
              </div>
            )}

            {/* Even/Odd Progress & Recent Parity */}
            <div className="space-y-2.5 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="font-bold text-sm">Even / Odd Live Distribution</div>
              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span>Even</span>
                  <span className="font-mono tabular-nums">
                    {stats.even.count} ({stats.even.percentage}%)
                  </span>
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${stats.even.percentage}%` }} />
                </div>
              </div>

              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span>Odd</span>
                  <span className="font-mono tabular-nums">
                    {stats.odd.count} ({stats.odd.percentage}%)
                  </span>
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500 transition-all" style={{ width: `${stats.odd.percentage}%` }} />
                </div>
              </div>

              <div>
                <div className="text-xs font-bold mb-2">Recent Parity Sequence</div>
                <div className="flex gap-1.5 flex-wrap">
                  {safeRecentParity.map((p, idx) => (
                    <span
                      key={idx}
                      className={`h-6 w-6 rounded-full text-white text-[11px] font-bold flex items-center justify-center ${
                        p === 'E' ? 'bg-emerald-600' : 'bg-rose-600'
                      }`}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400">
            {error ? <span className="text-rose-500">{error}</span> : 'Connecting to real-time Deriv tick stream...'}
          </div>
        )}
      </div>
    </div>
  );
};
