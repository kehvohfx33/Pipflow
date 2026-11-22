import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { apiFetch } from '../../services/api';
import { fetchDerivInstrumentsDirect } from '../../services/derivBrowserWs';

export interface DerivSymbolOption {
  symbol: string;
  display_name: string;
  market: string;
  submarket?: string;
  pip_size?: number;
  exchange_is_open?: boolean;
  is_trading_suspended?: boolean;
}

const FALLBACK_SYMBOLS: DerivSymbolOption[] = [
  { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index', market: 'synthetic_index' },
  { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index', market: 'synthetic_index' },
  { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index', market: 'synthetic_index' },
  { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index', market: 'synthetic_index' },
  { symbol: '1HZ90V', display_name: 'Volatility 90 (1s) Index', market: 'synthetic_index' },
  { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index', market: 'synthetic_index' },
  { symbol: 'R_10', display_name: 'Volatility 10 Index', market: 'synthetic_index' },
  { symbol: 'R_25', display_name: 'Volatility 25 Index', market: 'synthetic_index' },
  { symbol: 'R_50', display_name: 'Volatility 50 Index', market: 'synthetic_index' },
  { symbol: 'R_75', display_name: 'Volatility 75 Index', market: 'synthetic_index' },
  { symbol: 'R_100', display_name: 'Volatility 100 Index', market: 'synthetic_index' },
  { symbol: 'BOOM1000', display_name: 'Boom 1000 Index', market: 'synthetic_index' },
  { symbol: 'BOOM500', display_name: 'Boom 500 Index', market: 'synthetic_index' },
  { symbol: 'CRASH1000', display_name: 'Crash 1000 Index', market: 'synthetic_index' },
  { symbol: 'CRASH500', display_name: 'Crash 500 Index', market: 'synthetic_index' },
  { symbol: 'JD10', display_name: 'Jump 10 Index', market: 'synthetic_index' },
  { symbol: 'JD25', display_name: 'Jump 25 Index', market: 'synthetic_index' },
  { symbol: 'frxEURUSD', display_name: 'EUR/USD', market: 'forex' },
  { symbol: 'frxGBPUSD', display_name: 'GBP/USD', market: 'forex' },
  { symbol: 'frxUSDJPY', display_name: 'USD/JPY', market: 'forex' },
  { symbol: 'frxXAUUSD', display_name: 'Gold / USD (Deriv)', market: 'commodities' },
  { symbol: 'cryBTCUSD', display_name: 'BTC/USD', market: 'cryptocurrency' },
  { symbol: 'cryETHUSD', display_name: 'ETH/USD', market: 'cryptocurrency' }
];

export function useDerivSymbolsCatalog(filterSyntheticsOnly = false) {
  const [symbols, setSymbols] = useState<DerivSymbolOption[]>(FALLBACK_SYMBOLS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const merged = new Map<string, DerivSymbolOption>();
      try {
        const res = await apiFetch<{ instruments?: DerivSymbolOption[] }>('/market/instruments');
        if (Array.isArray(res?.instruments)) {
          res.instruments.forEach((i) => merged.set(i.symbol, i));
        }
      } catch {
        // fallback below
      }
      if (merged.size < 45) {
        try {
          const direct = await fetchDerivInstrumentsDirect();
          direct.forEach((i) => {
            if (!merged.has(i.symbol)) merged.set(i.symbol, i);
          });
        } catch {
          // ignore
        }
      }
      if (!cancelled && merged.size > 0) {
        setSymbols(Array.from(merged.values()));
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () => (filterSyntheticsOnly ? symbols.filter((s) => s.market === 'synthetic_index') : symbols),
    [symbols, filterSyntheticsOnly]
  );
}

interface SymbolSelectorProps {
  value: string;
  onChange: (symbol: string) => void;
  symbols: DerivSymbolOption[];
  className?: string;
}

export const SymbolSelector: React.FC<SymbolSelectorProps> = ({ value, onChange, symbols, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const current = symbols.find((s) => s.symbol === value) ?? {
    symbol: value,
    display_name: value,
    market: 'synthetic_index'
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return symbols;
    return symbols.filter(
      (s) =>
        s.symbol.toLowerCase().includes(q) ||
        s.display_name.toLowerCase().includes(q) ||
        s.market.toLowerCase().includes(q)
    );
  }, [symbols, search]);

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-left shadow-xs hover:border-blue-500 transition"
      >
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{current.display_name}</div>
          <div className="text-[11px] font-mono text-slate-500">
            {current.symbol} · {current.market.replace(/_/g, ' ').toUpperCase()}
          </div>
        </div>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1.5 z-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-4 top-4.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search instrument (e.g. R_100, 1HZ10V, EURUSD)..."
              autoFocus
              className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((item) => (
              <button
                key={item.symbol}
                type="button"
                onClick={() => {
                  onChange(item.symbol);
                  setOpen(false);
                  setSearch('');
                }}
                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-blue-50 dark:hover:bg-slate-800 transition ${
                  item.symbol === value ? 'bg-blue-50/70 dark:bg-blue-950/40 font-bold' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-slate-900 dark:text-white">{item.display_name}</div>
                  <div className="text-[10px] font-mono text-slate-400">{item.symbol}</div>
                </div>
                <span className="text-[10px] uppercase font-mono text-slate-500 shrink-0 ml-2">
                  {item.market.replace(/_/g, ' ')}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No matching Deriv instruments</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
