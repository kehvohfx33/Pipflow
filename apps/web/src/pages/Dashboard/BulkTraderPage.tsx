import React, { useEffect, useState } from 'react';
import { XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';
import {
  fetchDerivInstrumentsDirect,
  fetchDerivTickHistoryDirect,
  subscribeDerivTicksDirect
} from '../../services/derivBrowserWs';

interface DigitStats {
  latestPrice: number;
  latestDigit: number;
  pipSize: number;
  distribution: Array<{ digit: number; percentage: number }>;
  even: { count: number; percentage: number };
  odd: { count: number; percentage: number };
  recentParity: Array<'E' | 'O'>;
}

interface InstrumentOption {
  symbol: string;
  display_name: string;
  market: string;
}

function buildLiveStats(prices: number[], pipSize: number): DigitStats {
  const counts = Array(10).fill(0);
  const recentParity: Array<'E' | 'O'> = [];
  let even = 0;
  let odd = 0;
  for (let i = 0; i < prices.length; i++) {
    const str = prices[i].toFixed(Math.max(0, Math.min(8, pipSize)));
    const d = Number(str.charAt(str.length - 1)) || 0;
    counts[d]++;
    const isEven = d % 2 === 0;
    if (isEven) even++;
    else odd++;
    if (i >= prices.length - 12) recentParity.push(isEven ? 'E' : 'O');
  }
  const total = prices.length || 1;
  const latestPrice = prices[prices.length - 1] ?? 0;
  const latestStr = latestPrice.toFixed(Math.max(0, Math.min(8, pipSize)));
  const latestDigit = Number(latestStr.charAt(latestStr.length - 1)) || 0;
  return {
    latestPrice,
    latestDigit,
    pipSize,
    distribution: counts.map((c, digit) => ({ digit, percentage: Number(((c / total) * 100).toFixed(1)) })),
    even: { count: even, percentage: Number(((even / total) * 100).toFixed(1)) },
    odd: { count: odd, percentage: Number(((odd / total) * 100).toFixed(1)) },
    recentParity
  };
}

export const BulkTraderPage: React.FC = () => {
  const { activeDerivAccount, refreshDerivAccounts, refreshProfile, bumpOrderVersion } = useAuth();
  const [instruments, setInstruments] = useState<InstrumentOption[]>([]);
  const [symbol, setSymbol] = useState('R_100');
  const [tradeType, setTradeType] = useState<'Even/Odd' | 'Over/Under' | 'Rise/Fall'>('Even/Odd');
  const [barrierDigit, setBarrierDigit] = useState(4);
  const [ticksCount, setTicksCount] = useState(400);
  const [durationTicks, setDurationTicks] = useState(1);
  const [stake, setStake] = useState(1);
  const [noOfTrades, setNoOfTrades] = useState(3);
  const [stats, setStats] = useState<DigitStats | null>(null);
  const [orderNotice, setOrderNotice] = useState('');
  const [busy, setBusy] = useState(false);

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
    let buffer: number[] = [];
    let currentPip = 2;

    fetchDerivTickHistoryDirect(symbol, Math.min(2000, ticksCount))
      .then((hist) => {
        if (cancelled) return;
        buffer = hist.prices;
        currentPip = hist.pipSize;
        setStats(buildLiveStats(buffer, currentPip));
      })
      .catch(() => {
        apiFetch<DigitStats>(`/market/digit-analysis?symbol=${encodeURIComponent(symbol)}&count=${ticksCount}`)
          .then((res) => {
            if (!cancelled && res?.distribution) setStats(res);
          })
          .catch(() => {});
      });

    const unsub = subscribeDerivTicksDirect(symbol, (tick) => {
      if (cancelled) return;
      currentPip = tick.pipSize ?? currentPip;
      buffer = [...buffer, tick.quote].slice(-ticksCount);
      setStats(buildLiveStats(buffer, currentPip));
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [symbol, ticksCount]);

  const placeBulk = async (direction: 'PRIMARY' | 'SECONDARY') => {
    if (!stats?.latestPrice) return;
    setBusy(true);
    setOrderNotice('');
    const side: 'BUY' | 'SELL' = direction === 'PRIMARY' ? 'BUY' : 'SELL';
    const contractType =
      tradeType === 'Rise/Fall'
        ? direction === 'PRIMARY'
          ? 'CALL'
          : 'PUT'
        : tradeType === 'Over/Under'
          ? direction === 'PRIMARY'
            ? 'DIGITOVER'
            : 'DIGITUNDER'
          : direction === 'PRIMARY'
            ? 'DIGITEVEN'
            : 'DIGITODD';

    try {
      const count = Math.min(25, Math.max(1, noOfTrades));
      const res = await apiFetch<{ placedCount: number; failedCount: number }>('/orders/bulk', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          side,
          stake,
          count,
          entryPrice: stats.latestPrice,
          takeProfit: side === 'BUY' ? stats.latestPrice * 1.002 : stats.latestPrice * 0.998,
          stopLoss: side === 'BUY' ? stats.latestPrice * 0.998 : stats.latestPrice * 1.002,
          connectedAccountId: activeDerivAccount?.id ?? null,
          executionMode: activeDerivAccount ? 'deriv' : 'virtual',
          contractType,
          duration: durationTicks,
          durationUnit: 't',
          ...(tradeType === 'Over/Under' ? { barrier: barrierDigit } : {})
        })
      });
      refreshDerivAccounts(false);
      refreshProfile();
      bumpOrderVersion();
      setOrderNotice(
        `Executed ${res.placedCount}x ${contractType} trade(s) on ${symbol}${
          activeDerivAccount ? ` (${activeDerivAccount.account_type.toUpperCase()})` : ''
        }.`
      );
    } catch (err) {
      setOrderNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bulkClose = async (filter: 'all' | 'profitable' | 'losing' | 'buy' | 'sell' | 'over' | 'under') => {
    setBusy(true);
    setOrderNotice('');
    try {
      const res = await apiFetch<{ closedCount: number; totalPnl: number }>('/orders/bulk-close', {
        method: 'POST',
        body: JSON.stringify({
          filter,
          prices: stats?.latestPrice ? { [symbol]: stats.latestPrice } : {}
        })
      });
      refreshDerivAccounts(false);
      refreshProfile();
      bumpOrderVersion();
      setOrderNotice(
        `Closed ${res.closedCount} (${filter}) trade(s) · Net P/L: ${
          res.totalPnl >= 0 ? '+' : ''
        }${res.totalPnl.toFixed(2)} USD`
      );
    } catch (err) {
      setOrderNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel =
    tradeType === 'Over/Under' ? `OVER ${barrierDigit}` : tradeType === 'Rise/Fall' ? 'RISE (CALL)' : 'EVEN';
  const secondaryLabel =
    tradeType === 'Over/Under' ? `UNDER ${barrierDigit}` : tradeType === 'Rise/Fall' ? 'FALL (PUT)' : 'ODD';

  const overPct = stats
    ? stats.distribution.filter((d) => d.digit > barrierDigit).reduce((s, d) => s + d.percentage, 0)
    : 50;
  const underPct = stats
    ? stats.distribution.filter((d) => d.digit < barrierDigit).reduce((s, d) => s + d.percentage, 0)
    : 40;

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5 bg-white dark:bg-slate-900 min-h-[calc(100vh-180px)] rounded-2xl border border-slate-200 dark:border-slate-800 my-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="text-[11px] font-bold text-slate-500 uppercase">Deriv Market</label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs bg-white dark:bg-slate-800"
          >
            {instruments.length === 0 ? (
              <>
                <option value="R_100">Volatility 100 Index</option>
                <option value="R_75">Volatility 75 Index</option>
                <option value="R_50">Volatility 50 Index</option>
                <option value="R_25">Volatility 25 Index</option>
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
          <label className="text-[11px] font-bold text-slate-500 uppercase">Trade Type</label>
          <select
            value={tradeType}
            onChange={(e) => setTradeType(e.target.value as typeof tradeType)}
            className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs bg-white dark:bg-slate-800"
          >
            <option value="Even/Odd">Even/Odd</option>
            <option value="Over/Under">Over/Under</option>
            <option value="Rise/Fall">Rise/Fall</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] font-bold text-slate-500 uppercase">
            {tradeType === 'Over/Under' ? 'Barrier Digit (0–9)' : 'Ticks Sample'}
          </label>
          {tradeType === 'Over/Under' ? (
            <select
              value={barrierDigit}
              onChange={(e) => setBarrierDigit(Number(e.target.value))}
              className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs font-mono font-bold bg-white dark:bg-slate-800"
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                <option key={d} value={d}>
                  Digit {d}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={50}
              max={2000}
              value={ticksCount}
              onChange={(e) => setTicksCount(Math.max(50, Math.min(2000, Number(e.target.value) || 200)))}
              className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg py-2 text-center text-xs font-mono font-bold bg-slate-50 dark:bg-slate-800"
            />
          )}
        </div>
      </div>

      <div className="text-center">
        <div className="text-[11px] font-bold text-slate-500 uppercase">Live Deriv Spot</div>
        <div className="text-3xl font-black font-mono text-rose-500 mt-1 tabular-nums">
          {stats ? stats.latestPrice.toFixed(stats.pipSize ?? 2) : '...'}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 py-2">
          {(Array.isArray(stats.distribution) ? stats.distribution : []).map((d) => (
            <button
              key={d.digit}
              type="button"
              onClick={() => setBarrierDigit(d.digit)}
              className="flex flex-col items-center"
            >
              <div
                className={`h-12 w-12 rounded-full border-2 flex flex-col items-center justify-center text-[10px] font-bold transition ${
                  d.digit === stats.latestDigit
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-sky-300'
                    : d.digit === barrierDigit && tradeType === 'Over/Under'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                      : 'border-slate-300 dark:border-slate-700'
                }`}
              >
                <span className="text-xs font-black">{d.digit}</span>
                <span>{d.percentage.toFixed(1)}%</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {stats && (
        <div className="flex justify-center gap-1.5 flex-wrap">
          {(Array.isArray(stats.recentParity) ? stats.recentParity : []).slice(-10).map((p, idx) => (
            <span
              key={idx}
              className={`h-7 w-7 rounded-md text-white text-xs font-bold flex items-center justify-center ${
                p === 'E' ? 'bg-[#26a69a]' : 'bg-rose-600'
              }`}
            >
              {p}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5 text-center">
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase">Duration (Ticks)</label>
          <input
            type="number"
            min={1}
            max={10}
            value={durationTicks}
            onChange={(e) => setDurationTicks(Math.max(1, Number(e.target.value) || 1))}
            className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg py-2 text-center font-mono text-sm bg-slate-50 dark:bg-slate-800"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase">Stake / Trade (USD)</label>
          <input
            type="number"
            min={0.35}
            step="0.5"
            value={stake}
            onChange={(e) => setStake(Math.max(0.35, Number(e.target.value) || 1))}
            className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg py-2 text-center font-mono text-sm bg-slate-50 dark:bg-slate-800"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase">Batch Trades (1–25)</label>
          <input
            type="number"
            min={1}
            max={25}
            value={noOfTrades}
            onChange={(e) => setNoOfTrades(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
            className="w-full mt-1 border border-slate-300 dark:border-slate-700 rounded-lg py-2 text-center font-mono text-sm bg-slate-50 dark:bg-slate-800"
          />
        </div>
      </div>

      {/* Bulk Open Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={busy || !stats?.latestPrice}
          onClick={() => placeBulk('PRIMARY')}
          className="rounded-xl bg-[#26a69a] hover:bg-teal-600 disabled:opacity-50 text-white py-3 font-bold text-sm shadow-xs"
        >
          <div>
            {noOfTrades}x {primaryLabel}
          </div>
          <div className="text-xs font-mono opacity-90">
            {tradeType === 'Over/Under' ? `${overPct.toFixed(1)}%` : `${stats?.even.percentage.toFixed(1) ?? '50.0'}%`}
          </div>
        </button>
        <button
          type="button"
          disabled={busy || !stats?.latestPrice}
          onClick={() => placeBulk('SECONDARY')}
          className="rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white py-3 font-bold text-sm shadow-xs"
        >
          <div>
            {noOfTrades}x {secondaryLabel}
          </div>
          <div className="text-xs font-mono opacity-90">
            {tradeType === 'Over/Under' ? `${underPct.toFixed(1)}%` : `${stats?.odd.percentage.toFixed(1) ?? '50.0'}%`}
          </div>
        </button>
      </div>

      {/* Bulk Close Bar */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">
          Bulk Close Open Positions
        </div>
        <div className="flex flex-wrap justify-center gap-1.5 text-[11px]">
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkClose('profitable')}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold"
          >
            Close Profitable
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkClose('losing')}
            className="px-2.5 py-1.5 rounded-lg bg-amber-600 text-white font-bold"
          >
            Close Losing
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkClose('buy')}
            className="px-2.5 py-1.5 rounded-lg bg-blue-600 text-white font-bold"
          >
            Close Buy
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkClose('sell')}
            className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white font-bold"
          >
            Close Sell
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkClose('over')}
            className="px-2.5 py-1.5 rounded-lg bg-slate-700 text-white font-bold"
          >
            Close Over
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkClose('under')}
            className="px-2.5 py-1.5 rounded-lg bg-slate-700 text-white font-bold"
          >
            Close Under
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkClose('all')}
            className="px-2.5 py-1.5 rounded-lg bg-red-600 text-white font-bold inline-flex items-center gap-1"
          >
            <XCircle className="w-3.5 h-3.5" /> Close All
          </button>
        </div>
      </div>

      {orderNotice && <p className="text-center text-xs text-emerald-600 font-semibold">{orderNotice}</p>}
    </div>
  );
};
