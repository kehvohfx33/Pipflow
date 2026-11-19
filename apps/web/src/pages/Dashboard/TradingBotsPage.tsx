import React, { useEffect, useState } from 'react';
import { Bot, Star, Search, Play, Square, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';

interface StrategyRecord {
  id: string;
  slug: string;
  name: string;
  category: string;
  symbol: string;
  rating: number;
  is_premium: boolean;
  strategy_config: { stake?: number; tpPct?: number; slPct?: number; tradeType?: string; martingale?: number };
}

interface BotStatusTelemetry {
  running: boolean;
  symbol?: string;
  botName?: string;
  stake?: number;
  currentStake?: number;
  tradesCount?: number;
  wins?: number;
  losses?: number;
  sessionPnl?: number;
  lastAction?: string;
}

export const TradingBotsPage: React.FC<{ onBotStarted: () => void }> = ({ onBotStarted }) => {
  const { activeDerivAccount, refreshDerivAccounts, refreshProfile } = useAuth();
  const [category, setCategory] = useState('All Bots');
  const [search, setSearch] = useState('');
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [stakeOverride, setStakeOverride] = useState<number>(10);
  const [liveStatus, setLiveStatus] = useState<BotStatusTelemetry>({ running: false });
  const [busy, setBusy] = useState(false);

  const loadStatus = () => {
    apiFetch<BotStatusTelemetry>('/bots/status')
      .then((res) => setLiveStatus(res || { running: false }))
      .catch(() => {});
  };

  useEffect(() => {
    setLoading(true);
    apiFetch<{ strategies?: StrategyRecord[] }>('/bots/strategies')
      .then((res) => setStrategies(Array.isArray(res?.strategies) ? res.strategies : []))
      .catch((err) => setStatusMsg((err as Error).message))
      .finally(() => setLoading(false));

    loadStatus();
    const id = setInterval(loadStatus, 2500);
    return () => clearInterval(id);
  }, []);

  const categories = ['All Bots', 'Free Bots', 'Scalper Bots', 'SpeedBots'];
  const filtered = (Array.isArray(strategies) ? strategies : []).filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.symbol.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (category === 'All Bots') return true;
    return s.category.toLowerCase().includes(category.toLowerCase());
  });

  const handleLoadAndRun = async (bot: StrategyRecord) => {
    setBusy(true);
    setStatusMsg('');
    const chosenStake = stakeOverride > 0 ? stakeOverride : bot.strategy_config?.stake ?? 10;
    try {
      const res = await apiFetch<BotStatusTelemetry>('/bots/run', {
        method: 'POST',
        body: JSON.stringify({
          symbol: bot.symbol,
          botName: bot.name,
          stake: chosenStake,
          tpPct: bot.strategy_config?.tpPct ?? 0.08,
          slPct: bot.strategy_config?.slPct ?? 0.05,
          martingale: bot.strategy_config?.martingale ?? 1.5,
          useMartingale: true,
          connectedAccountId: activeDerivAccount?.id ?? null
        })
      });
      setLiveStatus(res);
      setStatusMsg(
        `Instant bot "${bot.name}" running on ${bot.symbol}${
          activeDerivAccount ? ` (${activeDerivAccount.account_type.toUpperCase()})` : ''
        } with $${chosenStake} stake.`
      );
      onBotStarted();
      refreshDerivAccounts(false);
    } catch (err) {
      setStatusMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await apiFetch('/bots/stop', { method: 'POST' });
      setLiveStatus({ running: false });
      setStatusMsg('Active trading bot stopped.');
    } catch (err) {
      setStatusMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCloseAllBotTrades = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ closedCount: number; totalPnl: number }>('/bots/close-all', {
        method: 'POST',
        body: JSON.stringify({})
      });
      setLiveStatus({ running: false });
      setStatusMsg(
        `Closed ${res.closedCount} open bot position(s) immediately · Net P/L: ${
          res.totalPnl >= 0 ? '+' : ''
        }${res.totalPnl.toFixed(2)} USD`
      );
      refreshDerivAccounts(false);
      refreshProfile();
    } catch (err) {
      setStatusMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      {/* Live Running Bot Monitor */}
      {liveStatus.running && (
        <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="space-y-1">
            <div className="font-bold text-emerald-700 dark:text-emerald-300">
              ● ACTIVE BOT: {liveStatus.botName} ({liveStatus.symbol})
            </div>
            <div className="font-mono tabular-nums text-slate-600 dark:text-slate-300 flex flex-wrap gap-3">
              <span>Current Stake: ${Number(liveStatus.currentStake ?? 0).toFixed(2)}</span>
              <span>Trades: {liveStatus.tradesCount ?? 0}</span>
              <span className="text-emerald-600">Wins: {liveStatus.wins ?? 0}</span>
              <span className="text-rose-500">Losses: {liveStatus.losses ?? 0}</span>
              <span className={Number(liveStatus.sessionPnl ?? 0) >= 0 ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>
                P/L: {Number(liveStatus.sessionPnl ?? 0) >= 0 ? '+' : ''}
                ${Number(liveStatus.sessionPnl ?? 0).toFixed(2)}
              </span>
            </div>
            {liveStatus.lastAction && <div className="text-[11px] text-slate-500">{liveStatus.lastAction}</div>}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleStop}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold inline-flex items-center gap-1"
            >
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleCloseAllBotTrades}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold inline-flex items-center gap-1"
            >
              <XCircle className="w-3.5 h-3.5" /> Close Bot Trades
            </button>
          </div>
        </div>
      )}

      {/* Sub-tabs + Stake Override */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold border whitespace-nowrap transition ${
                category === cat
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-sky-300'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
          <span>Stake (USD):</span>
          <input
            type="number"
            min={0.35}
            step={1}
            value={stakeOverride}
            onChange={(e) => setStakeOverride(Math.max(0.35, Number(e.target.value) || 1))}
            className="w-20 font-mono font-bold text-right bg-transparent focus:outline-none"
          />
        </label>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search bots by name or Deriv symbol..."
          className="w-full rounded-xl border-2 border-blue-800/40 bg-white dark:bg-slate-900 pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-blue-600"
        />
      </div>

      {statusMsg && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-xs text-slate-500">Loading automated trading bots...</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((bot) => (
            <div
              key={bot.id}
              className="relative rounded-2xl border-2 border-blue-900/50 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-xs overflow-hidden"
            >
              {bot.is_premium && (
                <span className="absolute top-0 right-0 bg-amber-400 text-slate-900 text-[10px] font-black px-3 py-1 rounded-bl-xl">
                  PRO BOT
                </span>
              )}

              <div className="flex items-center gap-2.5 pt-1">
                <Bot className="w-6 h-6 text-blue-600 dark:text-sky-400 shrink-0" />
                <div className="min-w-0">
                  <div className="font-bold text-sm text-blue-900 dark:text-sky-300 truncate">{bot.name}</div>
                  <div className="text-[11px] font-mono text-slate-400">
                    {bot.symbol} · {bot.category}
                  </div>
                </div>
              </div>

              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex justify-between">
                <span>Mode: {bot.strategy_config?.tradeType || 'Momentum'}</span>
                <span>
                  TP {bot.strategy_config?.tpPct ?? 0.08}% / SL {bot.strategy_config?.slPct ?? 0.05}%
                </span>
              </div>

              <div className="flex items-center justify-center gap-1 text-amber-400">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} className="w-4 h-4 fill-current" />
                ))}
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => handleLoadAndRun(bot)}
                className="w-full py-2.5 rounded-lg bg-[#1d6ae5] hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs tracking-wide transition inline-flex items-center justify-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                <span>RUN BOT INSTANTLY</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
