import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, AreaSeries, IPriceLine, ISeriesApi, Time } from 'lightweight-charts';
import { apiFetch } from '../../services/api';
import {
  fetchDerivCandlesDirect,
  fetchDerivInstrumentsDirect,
  subscribeDerivTicksDirect
} from '../../services/derivBrowserWs';
import { LiveTick } from '../../hooks/useDerivStream';
import { useAuth } from '../../contexts/AuthContext';
import { VirtualOrderItem } from '../../components/trading/OrderTicket';
import { safeGetItem, safeSetItem } from '../../utils/safeStorage';

import { SmartChartWrapper } from '../../components/deriv/SmartChartWrapper';
import { CandlestickSeries } from 'lightweight-charts';

interface ChartsPageProps {
  mode: 'charts' | 'dtrader';
  symbol?: string;
  liveTick?: LiveTick | null;
  onOpenTradingView: () => void;
  onSymbolChange?: (symbol: string) => void;
}

const CHART_TIMEFRAMES = [
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '15m', value: 900 },
  { label: '1h', value: 3600 },
  { label: '4h', value: 14400 },
  { label: '1d', value: 86400 }
];

import { InstrumentItem } from '../../trading/market-watch/MarketWatchPanel';

interface ExternalFeedResp {
  symbol: string;
  price: number | null;
  provider: string;
  status: 'live' | 'delayed' | 'unavailable';
  timestamp: string;
  message?: string;
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>;
}

export const ChartsPage: React.FC<ChartsPageProps> = ({
  mode,
  symbol: symbolProp,
  liveTick,
  onOpenTradingView,
  onSymbolChange
}) => {
  const {
    authenticated,
    darkTheme,
    activeDerivAccount,
    refreshDerivAccounts,
    refreshProfile,
    orderVersion,
    bumpOrderVersion
  } = useAuth();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const barrierLinesRef = useRef<IPriceLine[]>([]);
  const lastBarTimeRef = useRef<number>(0);
  const [instruments, setInstruments] = useState<InstrumentItem[]>([]);
  const [symbol, setSymbol] = useState(symbolProp || 'R_25');
  const [engine, setEngine] = useState<'candles' | 'smartchart' | 'xauusd'>(() =>
    symbolProp === 'XAUUSD' ? 'xauusd' : 'smartchart'
  );
  const [externalMeta, setExternalMeta] = useState<Omit<ExternalFeedResp, 'candles'> | null>(null);
  const [granularity, setGranularityState] = useState(() => {
    const saved = Number(safeGetItem('pipflow_chart_granularity'));
    return Number.isFinite(saved) && saved > 0 ? saved : 60;
  });
  const setGranularity = (g: number) => {
    setGranularityState(g);
    safeSetItem('pipflow_chart_granularity', String(g));
  };
  const [latestPrice, setLatestPrice] = useState(0);
  const [stake, setStake] = useState(10);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState<'ok' | 'err'>('ok');
  const [chartError, setChartError] = useState('');
  const [openOrders, setOpenOrders] = useState<VirtualOrderItem[]>([]);

  useEffect(() => {
    if (symbolProp && symbolProp !== symbol) {
      setSymbol(symbolProp);
      if (symbolProp === 'XAUUSD') setEngine('xauusd');
    }
  }, [symbolProp]);

  const loadOpenOrders = () => {
    if (!authenticated) return;
    apiFetch<{ orders?: VirtualOrderItem[] }>('/orders')
      .then((res) => {
        const list = Array.isArray(res?.orders) ? res.orders : [];
        setOpenOrders(list.filter((o) => o.status === 'OPEN'));
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadOpenOrders();
  }, [authenticated, orderVersion]);

  useEffect(() => {
    let cancelled = false;
    const loadInstruments = async () => {
      const merged = new Map<string, InstrumentItem>();
      try {
        const res = await apiFetch<{ instruments?: InstrumentItem[] }>('/market/instruments');
        if (Array.isArray(res?.instruments)) {
          res.instruments.forEach((item) => merged.set(item.symbol, item));
        }
      } catch {
        // Fallback to direct Deriv active_symbols
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
      if (!cancelled && merged.size > 0) {
        setInstruments(Array.from(merged.values()));
      }
    };
    loadInstruments();
    return () => {
      cancelled = true;
    };
  }, []);

  const groupedInstruments = useMemo(() => {
    const groups: Record<string, InstrumentItem[]> = {};
    instruments.forEach((item) => {
      const key = item.market || 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [instruments]);

  const selectSymbol = (next: string) => {
    if (next === 'XAUUSD') {
      setEngine('xauusd');
    } else if (engine === 'xauusd') {
      setEngine('smartchart');
    }
    setSymbol(next);
    onSymbolChange?.(next);
  };

  useEffect(() => {
    if (engine === 'smartchart') return;
    const el = chartContainerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      width: Math.max(260, el.clientWidth || 320),
      height: Math.max(430, el.clientHeight || 540),
      layout: {
        background: { color: darkTheme ? '#0f172a' : '#ffffff' },
        textColor: darkTheme ? '#cbd5e1' : '#334155'
      },
      grid: {
        vertLines: { color: darkTheme ? '#1e293b' : '#f1f5f9' },
        horzLines: { color: darkTheme ? '#1e293b' : '#f1f5f9' }
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false
      }
    });

    if (engine === 'xauusd') {
      const cs = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350'
      });
      candleSeriesRef.current = cs;
      seriesRef.current = null;
    } else {
      const area = chart.addSeries(AreaSeries, {
        lineColor: '#334155',
        topColor: 'rgba(100, 116, 139, 0.28)',
        bottomColor: 'rgba(100, 116, 139, 0.02)',
        lineWidth: 2
      });
      seriesRef.current = area;
      candleSeriesRef.current = null;
    }

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) {
        chart.applyOptions({
          width: Math.floor(rect.width),
          ...(rect.height > 0 ? { height: Math.floor(rect.height) } : {})
        });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      barrierLinesRef.current = [];
      chart.remove();
      seriesRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [darkTheme, engine]);

  useEffect(() => {
    if (engine === 'smartchart') return;
    let cancelled = false;
    setChartError('');

    if (engine === 'xauusd') {
      const fetchGold = () => {
        apiFetch<ExternalFeedResp>(`/market/external-feed?symbol=XAUUSD&granularity=${granularity}&count=180`)
          .then((res) => {
            if (cancelled) return;
            setExternalMeta({
              symbol: res.symbol,
              price: res.price,
              provider: res.provider,
              status: res.status,
              timestamp: res.timestamp,
              message: res.message
            });
            if (res.price) setLatestPrice(res.price);
            if (candleSeriesRef.current && Array.isArray(res.candles) && res.candles.length > 0) {
              candleSeriesRef.current.setData(res.candles.map((c) => ({ ...c, time: c.time as Time })));
            } else if (res.status === 'unavailable') {
              setChartError(res.message || 'External XAUUSD feed temporarily unavailable.');
            }
          })
          .catch((err) => {
            if (!cancelled) setChartError((err as Error).message);
          });
      };
      fetchGold();
      const id = setInterval(fetchGold, 15000);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }

    const load = async () => {
      try {
        const direct = await fetchDerivCandlesDirect(symbol, granularity, 180);
        if (direct && direct.length > 0) return direct;
        throw new Error('Empty direct feed');
      } catch {
        const res = await apiFetch<{ candles: Array<{ time: number; close: number }> }>(
          `/market/candles?symbol=${encodeURIComponent(symbol)}&granularity=${granularity}&count=180`
        );
        if (res.candles && res.candles.length > 0) return res.candles;
        throw new Error('Candle feed temporarily unavailable');
      }
    };

    load()
      .then((candles) => {
        if (cancelled || !seriesRef.current) return;
        barrierLinesRef.current.forEach((l) => {
          try {
            seriesRef.current?.removePriceLine(l);
          } catch {
            // ignore
          }
        });
        barrierLinesRef.current = [];

        const pts = candles.map((c) => ({ time: c.time as Time, value: c.close }));
        seriesRef.current.setData(pts);
        const last = pts[pts.length - 1];
        if (last) {
          lastBarTimeRef.current = Number(last.time);
          setLatestPrice(last.value);
        } else {
          lastBarTimeRef.current = 0;
        }
      })
      .catch((err) => {
        if (!cancelled) setChartError((err as Error).message);
      });

    const directUnsub = subscribeDerivTicksDirect(symbol, (tick) => {
      if (cancelled || tick.symbol !== symbol || !seriesRef.current) return;
      const barTime = Math.floor(tick.epoch / granularity) * granularity;
      if (barTime < lastBarTimeRef.current) return;
      lastBarTimeRef.current = barTime;
      setLatestPrice(tick.quote);
      seriesRef.current.update({ time: barTime as Time, value: tick.quote });
    });

    return () => {
      cancelled = true;
      directUnsub();
    };
  }, [symbol, granularity, mode, darkTheme, engine]);

  useEffect(() => {
    if (!seriesRef.current || engine !== 'candles') return;
    barrierLinesRef.current.forEach((l) => {
      try {
        seriesRef.current?.removePriceLine(l);
      } catch {
        // ignore
      }
    });
    barrierLinesRef.current = [];

    openOrders
      .filter((o) => o.symbol === symbol)
      .forEach((o) => {
        if (!seriesRef.current) return;
        barrierLinesRef.current.push(
          seriesRef.current.createPriceLine({
            price: Number(o.entry_price),
            color: '#2563eb',
            lineWidth: 1,
            title: `${o.side} Entry`
          })
        );
        if (o.take_profit) {
          barrierLinesRef.current.push(
            seriesRef.current.createPriceLine({
              price: Number(o.take_profit),
              color: '#059669',
              lineWidth: 2,
              lineStyle: 2,
              title: 'TP'
            })
          );
        }
        if (o.stop_loss) {
          barrierLinesRef.current.push(
            seriesRef.current.createPriceLine({
              price: Number(o.stop_loss),
              color: '#dc2626',
              lineWidth: 2,
              lineStyle: 2,
              title: 'SL'
            })
          );
        }
      });
  }, [openOrders, symbol, darkTheme, engine]);

  useEffect(() => {
    if (engine === 'candles' && liveTick && liveTick.symbol === symbol && seriesRef.current) {
      const barTime = Math.floor(liveTick.epoch / granularity) * granularity;
      if (barTime < lastBarTimeRef.current) return;
      lastBarTimeRef.current = barTime;
      setLatestPrice(liveTick.quote);
      seriesRef.current.update({ time: barTime as Time, value: liveTick.quote });
    }
  }, [liveTick, symbol, granularity, engine]);

  const handlePlaceDtraderOrder = async (tradeSide: 'BUY' | 'SELL') => {
    if (!authenticated || !latestPrice) return;
    setSide(tradeSide);
    setNotice('');
    setNoticeType('ok');
    try {
      const res = await apiFetch<{ derivExecution?: { contractId: number } }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          side: tradeSide,
          stake,
          entryPrice: latestPrice,
          takeProfit: tradeSide === 'BUY' ? latestPrice * 1.005 : latestPrice * 0.995,
          stopLoss: tradeSide === 'BUY' ? latestPrice * 0.995 : latestPrice * 1.005,
          connectedAccountId: activeDerivAccount?.id ?? null,
          executionMode: activeDerivAccount ? 'deriv' : 'virtual'
        })
      });
      refreshDerivAccounts(false);
      refreshProfile();
      loadOpenOrders();
      bumpOrderVersion();
      if (res.derivExecution) {
        setNotice(
          `Executed ${tradeSide} on ${activeDerivAccount?.account_type === 'real' ? 'Real' : 'Demo'} Account (#${res.derivExecution.contractId}) · ${symbol} @ ${latestPrice.toFixed(3)}.`
        );
      } else {
        setNotice(`Opened virtual ${tradeSide} position on ${symbol} @ ${latestPrice.toFixed(3)}.`);
      }
    } catch (err) {
      setNoticeType('err');
      setNotice((err as Error).message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Chart Engine Selector */}
          <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold">
            <button
              type="button"
              onClick={() => setEngine('smartchart')}
              className={`px-3 py-1.5 rounded-md ${
                engine === 'smartchart' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Deriv SmartChart
            </button>
            <button
              type="button"
              onClick={() => setEngine('candles')}
              className={`px-3 py-1.5 rounded-md ${
                engine === 'candles' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Lightweight Feed
            </button>
            <button
              type="button"
              onClick={() => {
                setEngine('xauusd');
                setSymbol('XAUUSD');
              }}
              className={`px-3 py-1.5 rounded-md ${
                engine === 'xauusd' ? 'bg-amber-500 text-slate-950' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              XAU/USD Gold
            </button>
          </div>

          {engine !== 'xauusd' && (
            <select
              value={symbol}
              onChange={(e) => selectSymbol(e.target.value)}
              className="text-xs font-bold border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 max-w-[230px]"
            >
              {instruments.length === 0 ? (
                <>
                  <option value="1HZ90V">Volatility 90 (1s) Index</option>
                  <option value="1HZ100V">Volatility 100 (1s) Index</option>
                  <option value="R_100">Volatility 100 Index</option>
                  <option value="R_75">Volatility 75 Index</option>
                  <option value="R_25">Volatility 25 Index</option>
                </>
              ) : (
                Object.entries(groupedInstruments).map(([market, list]) => (
                  <optgroup key={market} label={market.replace(/_/g, ' ').toUpperCase()}>
                    {list.map((i) => (
                      <option key={i.symbol} value={i.symbol}>
                        {i.symbol} — {i.display_name}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
          )}

          {engine !== 'smartchart' && (
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
              {CHART_TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  type="button"
                  onClick={() => setGranularity(tf.value)}
                  className={`px-2 py-1 rounded text-[11px] font-bold transition ${
                    granularity === tf.value
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {engine === 'xauusd' && externalMeta && (
            <span className="text-[11px] font-mono text-amber-600 dark:text-amber-400">
              {externalMeta.provider} · {externalMeta.status.toUpperCase()} ·{' '}
              {new Date(externalMeta.timestamp).toLocaleTimeString()}
            </span>
          )}
          <span className="px-3 py-1 rounded bg-slate-900 text-white font-mono text-xs font-bold tabular-nums">
            {latestPrice.toFixed(latestPrice > 0 && latestPrice < 20 ? 4 : 3)}
          </span>
          {mode === 'charts' && (
            <button
              type="button"
              onClick={onOpenTradingView}
              className="px-4 py-2 rounded-lg bg-[#1d6ae5] hover:bg-blue-700 text-white text-xs font-bold"
            >
              MT5 Terminal
            </button>
          )}
        </div>
      </div>

      {chartError && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 px-3 py-2 text-xs text-rose-600">
          {chartError}
        </div>
      )}

      {engine === 'smartchart' ? (
        <SmartChartWrapper
          chartId="unified-trading-smartchart"
          symbol={symbol === 'XAUUSD' ? 'frxXAUUSD' : symbol}
          onSymbolChange={selectSymbol}
          defaultGranularity={granularity}
          heightClass="h-[480px] sm:h-[580px] lg:h-[640px]"
          fallbackSpot={liveTick?.quote ?? latestPrice}
        />
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div ref={chartContainerRef} className="w-full h-[460px] sm:h-[560px] lg:h-[640px]" />
        </div>
      )}

      {mode === 'dtrader' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold">
            <span>
              {activeDerivAccount
                ? `DTrader (${activeDerivAccount.account_type === 'real' ? 'Real Account' : 'Demo Account'})`
                : 'DTrader (Virtual)'}
            </span>
            <span className="text-blue-600">Direct Market Execution · {symbol}</span>
          </div>
          <div className="flex items-center justify-between border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
            <button type="button" onClick={() => setStake((s) => Math.max(1, s - 1))} className="px-3 font-bold text-lg">
              -
            </button>
            <span className="font-mono font-bold text-sm">{stake} USD Stake</span>
            <button type="button" onClick={() => setStake((s) => s + 1)} className="px-3 font-bold text-lg">
              +
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={!authenticated || latestPrice <= 0}
              onClick={() => handlePlaceDtraderOrder('BUY')}
              className={`w-full py-3 rounded-lg bg-[#26a69a] hover:bg-teal-600 disabled:opacity-50 text-white font-bold text-sm ${
                side === 'BUY' ? 'ring-2 ring-emerald-300' : ''
              }`}
            >
              {activeDerivAccount
                ? `Buy / Up (${activeDerivAccount.account_type === 'real' ? 'Real' : 'Demo'})`
                : 'Buy / Up (Virtual)'}
            </button>
            <button
              type="button"
              disabled={!authenticated || latestPrice <= 0}
              onClick={() => handlePlaceDtraderOrder('SELL')}
              className={`w-full py-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-sm ${
                side === 'SELL' ? 'ring-2 ring-rose-300' : ''
              }`}
            >
              {activeDerivAccount
                ? `Sell / Down (${activeDerivAccount.account_type === 'real' ? 'Real' : 'Demo'})`
                : 'Sell / Down (Virtual)'}
            </button>
          </div>
          {notice && (
            <p
              className={`text-xs text-center font-semibold ${
                noticeType === 'err' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {notice}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
