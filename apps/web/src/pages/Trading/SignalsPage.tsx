import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Radio, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../services/api';

interface SignalSetup {
  symbol: string;
  timeframe: string;
  dataSource: string;
  status: string;
  timestamp: string;
  spot: number;
  bias: 'BUY' | 'SELL' | 'NEUTRAL';
  regime: string;
  confidence: number;
  entryZone: { low: number; high: number };
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  invalidationCondition: string;
  rationale: string[];
}

interface SignalsPageProps {
  onSendToTrader: (symbol: string, side: 'BUY' | 'SELL', sl: number, tp: number) => void;
  onOpenChart: (symbol: string) => void;
}

export const SignalsPage: React.FC<SignalsPageProps> = ({ onSendToTrader, onOpenChart }) => {
  const [signals, setSignals] = useState<SignalSetup[]>([]);
  const [granularity, setGranularity] = useState(300);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');

  const loadSignals = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ signals?: SignalSetup[] }>(`/market/signals?granularity=${granularity}`);
      setSignals(Array.isArray(res?.signals) ? res.signals : []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSignals();
  }, [granularity]);

  const visible = signals.filter((s) => (filter === 'ALL' ? true : s.bias === filter));

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Radio className="w-5 h-5 text-emerald-500" />
            <span>Quantitative Trading Signals</span>
          </h1>
          <p className="text-xs text-slate-500">
            Multi-market setups computed strictly from real Deriv &amp; XAUUSD candles (EMA20/50/200, RSI-14, MACD, ATR-14 &amp; Pivot S/R).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold">
            {(['ALL', 'BUY', 'SELL'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md ${
                  filter === f ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <select
            value={granularity}
            onChange={(e) => setGranularity(Number(e.target.value))}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
          >
            <option value={60}>1m TF</option>
            <option value={300}>5m TF</option>
            <option value={900}>15m TF</option>
            <option value={3600}>1H TF</option>
          </select>

          <button
            type="button"
            disabled={loading}
            onClick={loadSignals}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Scan Markets</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 p-3 text-xs text-rose-600">
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((sig) => {
          const isBuy = sig.bias === 'BUY';
          const isSell = sig.bias === 'SELL';
          return (
            <div
              key={sig.symbol}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-extrabold text-base text-slate-900 dark:text-white">{sig.symbol}</div>
                  <div className="text-[11px] text-slate-400">
                    {sig.timeframe} · {sig.regime} · {sig.dataSource}
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-black ${
                    isBuy
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : isSell
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {sig.bias} · {sig.confidence}%
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 text-xs font-mono">
                <div>
                  <div className="text-[10px] text-slate-400">Spot / Entry Zone</div>
                  <div className="font-bold">{sig.spot}</div>
                  <div className="text-[10px] text-slate-500">
                    {sig.entryZone.low} – {sig.entryZone.high}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Risk : Reward</div>
                  <div className="font-bold text-blue-600 dark:text-sky-400">1 : {sig.riskRewardRatio}</div>
                  <div className="text-[10px] text-slate-500">{sig.status.toUpperCase()}</div>
                </div>
                <div>
                  <div className="text-[10px] text-rose-500">Stop Loss</div>
                  <div className="font-bold text-rose-600">{sig.stopLoss}</div>
                </div>
                <div>
                  <div className="text-[10px] text-emerald-500">Take Profit</div>
                  <div className="font-bold text-emerald-600">{sig.takeProfit}</div>
                </div>
              </div>

              <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                <div className="font-semibold text-amber-600 dark:text-amber-400 flex items-start gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Invalidation: {sig.invalidationCondition}</span>
                </div>
                {sig.rationale.slice(0, 2).map((r, i) => (
                  <div key={i} className="text-slate-500 dark:text-slate-400">
                    • {r}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-1 gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChart(sig.symbol)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  View Chart
                </button>
                {sig.bias !== 'NEUTRAL' && (
                  <button
                    type="button"
                    onClick={() => onSendToTrader(sig.symbol, sig.bias === 'BUY' ? 'BUY' : 'SELL', sig.stopLoss, sig.takeProfit)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1"
                  >
                    <span>Send Setup to Trader</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="text-[10px] font-mono text-slate-400 text-right">
                {new Date(sig.timestamp).toLocaleTimeString()}
              </div>
            </div>
          );
        })}
      </div>

      {!loading && visible.length === 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-10 text-center text-xs text-slate-500">
          No live signals matching filter. Try switching to ALL or clicking Scan Markets.
        </div>
      )}
    </div>
  );
};
