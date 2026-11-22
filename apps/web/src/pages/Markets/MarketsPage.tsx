import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, Bot, CandlestickChart, Search, Sparkles, TrendingUp } from 'lucide-react';
import { apiFetch } from '../../services/api';
import { LiveTick } from '../../hooks/useDerivStream';
import { DerivSymbolOption, useDerivSymbolsCatalog } from '../../components/deriv/SymbolSelector';
import { subscribeDerivMultiTicksDirect } from '../../services/derivBrowserWs';

interface MarketsPageProps {
  livePricesMap?: Record<string, number>;
  ticksBySymbol?: Record<string, LiveTick>;
  onOpenSymbolIn: (tab: string, symbol: string) => void;
}

interface ExternalGoldQuote {
  symbol: string;
  price: number;
  changePct?: number | null;
  provider: string;
  status: 'live' | 'delayed' | 'unavailable';
  timestamp: string;
  message?: string;
}

export const MarketsPage: React.FC<MarketsPageProps> = ({
  livePricesMap = {},
  onOpenSymbolIn
}) => {
  const symbols = useDerivSymbolsCatalog(false);
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [spotCache, setSpotCache] = useState<Record<string, number>>({});
  const [goldFeed, setGoldFeed] = useState<ExternalGoldQuote | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadGold = () => {
      apiFetch<ExternalGoldQuote>('/market/external-feed?symbol=XAUUSD&granularity=300&count=12')
        .then((res) => {
          if (!cancelled) setGoldFeed(res);
        })
        .catch(() => {});
    };
    loadGold();
    const id = setInterval(loadGold, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return symbols.filter((s) => {
      if (marketFilter !== 'all' && s.market !== marketFilter) return false;
      if (!q) return true;
      return (
        s.symbol.toLowerCase().includes(q) ||
        s.display_name.toLowerCase().includes(q) ||
        s.market.toLowerCase().includes(q)
      );
    });
  }, [symbols, marketFilter, search]);

  const topWatchSymbols = useMemo(() => filtered.slice(0, 24).map((s) => s.symbol), [filtered]);

  useEffect(() => {
    if (topWatchSymbols.length === 0) return;
    const unsub = subscribeDerivMultiTicksDirect(topWatchSymbols, (tick) => {
      setSpotCache((prev) => ({ ...prev, [tick.symbol]: tick.quote }));
    });
    return () => unsub();
  }, [topWatchSymbols.join(',')]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(symbols.map((s) => s.market)));
    return ['all', ...unique];
  }, [symbols]);

  const renderQuote = (item: DerivSymbolOption) => {
    const val = livePricesMap[item.symbol] ?? spotCache[item.symbol];
    if (!val) return '---';
    const decimals = val >= 100 ? 2 : val >= 10 ? 3 : 5;
    return val.toFixed(decimals);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            <span>Global Markets Explorer</span>
          </h1>
          <p className="text-xs text-slate-500">
            Live Deriv Synthetic Indices, Forex, Commodities, Crypto &amp; independent External XAU/USD feed.
          </p>
        </div>
      </div>

      {/* Independent External XAUUSD Feed Banner */}
      <div className="rounded-2xl border border-amber-400/40 bg-gradient-to-r from-[#0e1b33] to-[#1a1308] text-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
            <span>XAU/USD Spot Gold · External Feed</span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                goldFeed?.status === 'live'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : goldFeed?.status === 'delayed'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-rose-500/20 text-rose-300'
              }`}
            >
              {goldFeed?.status?.toUpperCase() || 'LOADING'}
            </span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl sm:text-3xl font-mono font-black tabular-nums">
              {goldFeed?.price ? `$${Number(goldFeed.price).toFixed(2)}` : 'Feed Unavailable'}
            </span>
            {goldFeed?.changePct !== null && goldFeed?.changePct !== undefined && (
              <span
                className={`text-xs font-mono font-bold ${
                  goldFeed.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {goldFeed.changePct >= 0 ? '+' : ''}
                {goldFeed.changePct}%
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-400">
            Source: {goldFeed?.provider || 'Yahoo Finance / GoldPrice'} · Updated:{' '}
            {goldFeed?.timestamp ? new Date(goldFeed.timestamp).toLocaleTimeString() : '—'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenSymbolIn('charts', 'XAUUSD')}
            className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5"
          >
            <CandlestickChart className="w-3.5 h-3.5" />
            <span>Open Gold Chart</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenSymbolIn('analysistool', 'XAUUSD')}
            className="px-3.5 py-2 rounded-lg border border-amber-400/50 hover:bg-amber-500/10 text-amber-200 font-bold text-xs inline-flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Gold Analysis</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setMarketFilter(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize border transition whitespace-nowrap ${
                marketFilter === cat
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {cat === 'all' ? `All Markets (${symbols.length})` : cat.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter symbols (R_100, EURUSD, Gold)..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Instruments Table / Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.slice(0, 48).map((item) => {
          const isSynth = item.market === 'synthetic_index';
          return (
            <div
              key={item.symbol}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 hover:border-blue-500/60 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm text-slate-900 dark:text-white truncate">{item.display_name}</div>
                  <div className="text-[11px] font-mono text-slate-400">
                    {item.symbol} · {item.market.replace(/_/g, ' ').toUpperCase()}
                  </div>
                </div>
                <span className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
                  {renderQuote(item)}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenSymbolIn('rise_fall', item.symbol)}
                  className="px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-sky-300 text-[11px] font-bold hover:bg-blue-100"
                >
                  Rise/Fall
                </button>
                {isSynth && (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpenSymbolIn('digits', item.symbol)}
                      className="px-2.5 py-1 rounded-md bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-[11px] font-bold hover:bg-purple-100"
                    >
                      Digits
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenSymbolIn('accumulators', item.symbol)}
                      className="px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold hover:bg-emerald-100"
                    >
                      Accumulators
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onOpenSymbolIn('trading_view', item.symbol)}
                  className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <TrendingUp className="w-3 h-3" /> Trader
                </button>
                <button
                  type="button"
                  onClick={() => onOpenSymbolIn('analysistool', item.symbol)}
                  className="px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[11px] font-bold inline-flex items-center gap-0.5"
                >
                  AI <ArrowUpRight className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpenSymbolIn('bot_builder', item.symbol)}
                  className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-bold inline-flex items-center gap-0.5"
                >
                  <Bot className="w-3 h-3" /> Bot
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
