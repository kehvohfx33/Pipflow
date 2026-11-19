import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Star } from 'lucide-react';

export interface InstrumentItem {
  symbol: string;
  display_name: string;
  market: string;
  pip_size?: number;
}

const MARKET_TABS = [
  { id: 'all', label: 'All' },
  { id: 'synthetic_index', label: 'Synthetic' },
  { id: 'forex', label: 'Forex' },
  { id: 'cryptocurrency', label: 'Crypto' },
  { id: 'commodities', label: 'Metals/Cmd' },
  { id: 'indices', label: 'Indices' }
];

function getInstrumentDecimals(item: InstrumentItem, live?: number): number {
  const pip = Number(item.pip_size ?? 0);
  if (pip > 0 && pip < 1) {
    return Math.min(5, Math.max(2, Math.round(Math.log10(1 / pip))));
  }
  if (live !== undefined && live < 20) return 4;
  return 2;
}

export const MarketWatchPanel: React.FC<{
  instruments: InstrumentItem[];
  activeSymbol: string;
  watchlist: string[];
  onSelectSymbol: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
  livePrices: Record<string, number>;
  onVisibleSymbolsChange?: (symbols: string[]) => void;
}> = ({
  instruments,
  activeSymbol,
  watchlist,
  onSelectSymbol,
  onToggleWatchlist,
  livePrices,
  onVisibleSymbolsChange
}) => {
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [onlyWatchlist, setOnlyWatchlist] = useState(false);
  const lastReportedRef = useRef('');

  const safeInstruments = Array.isArray(instruments) ? instruments : [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return safeInstruments
      .filter((i) => (!onlyWatchlist ? true : watchlist.includes(i.symbol)))
      .filter((i) => {
        if (marketFilter === 'all') return true;
        const m = (i.market || '').toLowerCase();
        if (marketFilter === 'synthetic_index') return m.includes('synthetic') || m.includes('random');
        if (marketFilter === 'commodities') return m.includes('commodit') || m.includes('metal');
        return m === marketFilter;
      })
      .filter(
        (i) =>
          !q ||
          i.display_name.toLowerCase().includes(q) ||
          i.symbol.toLowerCase().includes(q)
      );
  }, [safeInstruments, onlyWatchlist, watchlist, marketFilter, search]);

  useEffect(() => {
    if (!onVisibleSymbolsChange) return;
    const topVisible = filtered.slice(0, 30).map((i) => i.symbol);
    const key = topVisible.join(',');
    if (key && key !== lastReportedRef.current) {
      lastReportedRef.current = key;
      onVisibleSymbolsChange(topVisible);
    }
  }, [filtered, onVisibleSymbolsChange]);

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#141a23] p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
            Market Watch
          </span>
          <span className="ml-1.5 text-[10px] font-mono text-slate-400 tabular-nums">
            ({filtered.length}/{safeInstruments.length})
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOnlyWatchlist((w) => !w)}
          className={`text-[11px] font-semibold px-2 py-0.5 rounded transition ${
            onlyWatchlist
              ? 'bg-amber-400 text-slate-900'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300'
          }`}
        >
          ★ ({watchlist.length})
        </button>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex flex-wrap gap-1">
        {MARKET_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMarketFilter(tab.id)}
            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
              marketFilter === tab.id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-slate-50 dark:bg-[#1b232e]">
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all Deriv pairs (XAU, EURUSD, R_100, BTC)..."
          className="w-full text-xs bg-transparent focus:outline-none"
        />
      </div>

      {/* MT5 Column Header */}
      <div className="grid grid-cols-12 text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-1.5">
        <span className="col-span-6">Symbol</span>
        <span className="col-span-3 text-right">Bid</span>
        <span className="col-span-3 text-right">Ask</span>
      </div>

      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
        {filtered.length === 0 ? (
          <div className="py-5 text-center text-slate-400">No matching Deriv pairs</div>
        ) : (
          filtered.map((item) => {
            const isStarred = watchlist.includes(item.symbol);
            const live = livePrices[item.symbol];
            const decimals = getInstrumentDecimals(item, live);
            const pipStep = Number(item.pip_size ?? 0) > 0 ? Number(item.pip_size) * 2 : live !== undefined && live < 20 ? 0.0002 : 0.02;
            const spread = live !== undefined ? Math.max(pipStep, live * 0.00025) : 0;
            const bid = live !== undefined ? live : null;
            const ask = live !== undefined ? live + spread : null;
            return (
              <div
                key={item.symbol}
                className={`grid grid-cols-12 items-center py-1.5 px-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800/70 ${
                  activeSymbol === item.symbol
                    ? 'bg-blue-50/80 dark:bg-blue-950/40 font-bold text-blue-600 dark:text-sky-400'
                    : ''
                }`}
              >
                <div className="col-span-6 flex items-center gap-1.5 min-w-0 pr-1">
                  <button
                    type="button"
                    onClick={() => onToggleWatchlist(item.symbol)}
                    className={`shrink-0 ${isStarred ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}`}
                    title="Toggle Watchlist"
                  >
                    <Star className="w-3 h-3 fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSymbol(item.symbol)}
                    className="min-w-0 text-left truncate"
                  >
                    <div className="truncate leading-tight">{item.display_name}</div>
                    <div className="text-[10px] font-mono text-slate-400">{item.symbol}</div>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectSymbol(item.symbol)}
                  className="col-span-3 text-right font-mono text-[11px] tabular-nums text-rose-500 dark:text-rose-400"
                >
                  {bid !== null ? bid.toFixed(decimals) : '—'}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectSymbol(item.symbol)}
                  className="col-span-3 text-right font-mono text-[11px] tabular-nums text-blue-600 dark:text-sky-400"
                >
                  {ask !== null ? ask.toFixed(decimals) : '—'}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
