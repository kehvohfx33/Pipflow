import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  AreaSeries,
  CandlestickSeries,
  LineSeries,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  CandlestickData,
  Time
} from 'lightweight-charts';
import { Undo2, Redo2, Save, Settings as GearIcon, Plus, XCircle } from 'lucide-react';
import { apiFetch } from '../../services/api';
import {
  fetchDerivCandlesDirect,
  fetchDerivInstrumentsDirect,
  subscribeDerivTicksDirect
} from '../../services/derivBrowserWs';
import { useAuth } from '../../contexts/AuthContext';
import { LiveTick } from '../../hooks/useDerivStream';
import { TimeframesBar } from '../timeframes/TimeframesBar';
import { IndicatorsPanel, IndicatorConfig } from '../indicators/IndicatorsPanel';
import { DrawingToolbar, DrawingTool } from '../drawing-tools/DrawingToolbar';
import { MarketWatchPanel, InstrumentItem } from '../market-watch/MarketWatchPanel';
import {
  OrderTicket,
  OrderTicketMode,
  SlTpUnit,
  VirtualOrderItem,
  getPipSize,
  getPriceDecimals,
  resolveSlTpTarget
} from '../../components/trading/OrderTicket';

interface MT5TradingViewProps {
  symbol?: string;
  liveTick?: LiveTick | null;
  livePricesMap?: Record<string, number>;
  onSymbolChange?: (symbol: string) => void;
  onWatchSymbolsChange?: (symbols: string[]) => void;
}

interface LiveContractSnapshot {
  currentSpot: number;
  profit: number;
  bidPrice?: number;
}

type BulkCloseFilter = 'all' | 'profitable' | 'losing' | 'buy' | 'sell' | 'over' | 'under';

export const MT5TradingView: React.FC<MT5TradingViewProps> = ({
  symbol: symbolProp,
  liveTick,
  livePricesMap = {},
  onSymbolChange,
  onWatchSymbolsChange
}) => {
  const {
    token,
    user,
    darkTheme,
    activeDerivAccount,
    refreshProfile,
    refreshDerivAccounts,
    orderVersion,
    bumpOrderVersion
  } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const progressChartRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const indicatorSeriesRef = useRef<Array<ISeriesApi<'Line'>>>([]);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastCandleRef = useRef<CandlestickData | null>(null);
  const barsRef = useRef<CandlestickData[]>([]);
  const activeToolRef = useRef<DrawingTool>('crosshair');

  const [symbol, setSymbol] = useState(symbolProp || 'R_25');
  const [granularity, setGranularityState] = useState(() => {
    const saved = Number(localStorage.getItem('pipflow_chart_granularity'));
    return Number.isFinite(saved) && saved > 0 ? saved : 86400;
  });
  const setGranularity = (g: number) => {
    setGranularityState(g);
    localStorage.setItem('pipflow_chart_granularity', String(g));
  };
  const [instruments, setInstruments] = useState<InstrumentItem[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>(['R_25', 'R_100', '1HZ90V']);
  const [activeTool, setActiveTool] = useState<DrawingTool>('crosshair');
  const [showDrawings, setShowDrawings] = useState(true);
  const [customLines, setCustomLines] = useState<number[]>([]);
  const [indicators, setIndicators] = useState<IndicatorConfig>({
    sma20: false,
    ema50: false,
    bollinger: false
  });
  const [barsVersion, setBarsVersion] = useState(0);
  const [loadingChart, setLoadingChart] = useState(true);
  const [chartError, setChartError] = useState('');
  const [latestClose, setLatestClose] = useState(0);
  const [priceDelta, setPriceDelta] = useState<{ abs: number; pct: number }>({ abs: 0, pct: 0 });

  // MT5 Virtual & Deriv Order states (SL/TP default to USD currency count)
  const [lotSize, setLotSize] = useState(0.1);
  const [stake, setStake] = useState(10);
  const [orderMode, setOrderModeState] = useState<OrderTicketMode>(() => {
    const saved = localStorage.getItem('pipflow_order_mode');
    return saved === 'OVER_UNDER' || saved === 'RISE_FALL' ? saved : 'MT5';
  });
  const setOrderMode = (m: OrderTicketMode) => {
    setOrderModeState(m);
    localStorage.setItem('pipflow_order_mode', m);
  };
  const [digitPrediction, setDigitPrediction] = useState(4);
  const [durationTicks, setDurationTicks] = useState(5);
  const [bulkCount, setBulkCount] = useState(1);
  const [multiplier, setMultiplier] = useState(100);
  const [previewSide, setPreviewSide] = useState<'BUY' | 'SELL'>('BUY');
  const [slEnabled, setSlEnabled] = useState(true);
  const [tpEnabled, setTpEnabled] = useState(true);
  const [slUnit, setSlUnit] = useState<SlTpUnit>('USD');
  const [tpUnit, setTpUnit] = useState<SlTpUnit>('USD');
  const [slInput, setSlInput] = useState('-5.00');
  const [tpInput, setTpInput] = useState('15.00');
  const [placingSide, setPlacingSide] = useState<'BUY' | 'SELL' | null>(null);
  const [bulkClosing, setBulkClosing] = useState<BulkCloseFilter | null>(null);
  const [orders, setOrders] = useState<VirtualOrderItem[]>([]);
  const [liveContracts, setLiveContracts] = useState<Record<string, LiveContractSnapshot>>({});
  const [visibleMarketSymbols, setVisibleMarketSymbols] = useState<string[]>([]);
  const [orderError, setOrderError] = useState('');
  const [orderNotice, setOrderNotice] = useState('');
  const [dockTab, setDockTab] = useState<'open' | 'history' | 'summary'>('open');

  useEffect(() => {
    activeToolRef.current = activeTool;
    if (chartRef.current) {
      chartRef.current.applyOptions({
        crosshair: { mode: activeTool === 'crosshair' ? 1 : 0 }
      });
    }
  }, [activeTool]);

  useEffect(() => {
    if (symbolProp && symbolProp !== symbol) {
      setSymbol(symbolProp);
    }
  }, [symbolProp]);

  const selectSymbol = (sym: string) => {
    setSymbol(sym);
    if (slUnit === 'Price') setSlInput('');
    if (tpUnit === 'Price') setTpInput('');
    onSymbolChange?.(sym);
  };

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

    if (token) {
      apiFetch<{ watchlist?: Array<{ symbol: string }> }>('/watchlists')
        .then((res) => {
          if (Array.isArray(res?.watchlist) && res.watchlist.length > 0) {
            setWatchlist(res.watchlist.map((w) => w.symbol));
          }
        })
        .catch(() => {});
      loadOrders();
    }

    return () => {
      cancelled = true;
    };
  }, [token]);

  const loadOrders = () => {
    if (!token) return;
    apiFetch<{ orders?: VirtualOrderItem[]; liveContracts?: Record<string, LiveContractSnapshot> }>('/orders')
      .then((res) => {
        setOrders(Array.isArray(res?.orders) ? res.orders : []);
        if (res?.liveContracts) setLiveContracts(res.liveContracts);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (token && orderVersion > 0) {
      loadOrders();
    }
  }, [token, orderVersion]);

  useEffect(() => {
    if (!token) return;
    const hasOpenDeriv = orders.some((o) => o.status === 'OPEN' && o.deriv_contract_id);
    if (!hasOpenDeriv) return;
    const id = setInterval(() => {
      loadOrders();
    }, 6000);
    return () => clearInterval(id);
  }, [token, orders.length]);

  useEffect(() => {
    if (!onWatchSymbolsChange) return;
    const openSyms = orders.filter((o) => o.status === 'OPEN').map((o) => o.symbol);
    onWatchSymbolsChange([...visibleMarketSymbols, ...watchlist, ...openSyms, symbol]);
  }, [visibleMarketSymbols, watchlist, orders, symbol, onWatchSymbolsChange]);

  // Initialize Lightweight Charts instance once per theme change
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: Math.max(260, el.clientWidth || 320),
      height: 460,
      layout: {
        background: { color: darkTheme ? '#0f172a' : '#ffffff' },
        textColor: darkTheme ? '#cbd5e1' : '#1e293b'
      },
      grid: {
        vertLines: { color: darkTheme ? '#1e293b' : '#f1f5f9' },
        horzLines: { color: darkTheme ? '#1e293b' : '#f1f5f9' }
      },
      crosshair: { mode: activeToolRef.current === 'crosshair' ? 1 : 0 },
      rightPriceScale: {
        borderColor: darkTheme ? '#334155' : '#e2e8f0'
      },
      timeScale: {
        borderColor: darkTheme ? '#334155' : '#e2e8f0',
        timeVisible: true,
        secondsVisible: false
      }
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#059669',
      downColor: '#dc2626',
      borderVisible: false,
      wickUpColor: '#059669',
      wickDownColor: '#dc2626',
      priceFormat: {
        type: 'price',
        precision: 4,
        minMove: 0.0001
      }
    });

    chart.subscribeClick((param) => {
      if (activeToolRef.current === 'hline' && param.point) {
        const price = series.coordinateToPrice(param.point.y);
        if (price !== null) {
          setCustomLines((prev) => [...prev, Number(price.toFixed(4))]);
        }
      }
    });

    chartRef.current = chart;
    candleSeriesRef.current = series;

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) {
        chart.applyOptions({ width: Math.floor(rect.width) });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      indicatorSeriesRef.current = [];
      priceLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [darkTheme]);

  // Fetch real Deriv historical candlesticks whenever symbol or timeframe changes
  useEffect(() => {
    let cancelled = false;
    setLoadingChart(true);
    setChartError('');

    const loadCandles = async () => {
      try {
        const res = await apiFetch<{
          candles: Array<{ time: number; open: number; high: number; low: number; close: number }>;
        }>(`/market/candles?symbol=${encodeURIComponent(symbol)}&granularity=${granularity}&count=300`);
        if (res.candles && res.candles.length > 0) return res.candles;
        throw new Error('Empty candle feed from backend');
      } catch {
        return fetchDerivCandlesDirect(symbol, granularity, 300);
      }
    };

    loadCandles()
      .then((rawBars) => {
        if (cancelled || !candleSeriesRef.current || !chartRef.current) return;
        const bars: CandlestickData[] = rawBars.map((c) => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close
        }));

        barsRef.current = bars;
        candleSeriesRef.current.setData(bars);

        const last = bars[bars.length - 1];
        const prev = bars[bars.length - 2];
        if (last) {
          lastCandleRef.current = last;
          setLatestClose(last.close);
          if (prev) {
            const diff = last.close - prev.close;
            setPriceDelta({ abs: diff, pct: (diff / prev.close) * 100 });
          }
          setSlInput((curr) => (slUnit === 'Price' && !curr ? (last.close * 0.995).toFixed(4) : curr));
          setTpInput((curr) => (tpUnit === 'Price' && !curr ? (last.close * 1.005).toFixed(4) : curr));
        }

        chartRef.current.timeScale().fitContent();
        setBarsVersion((v) => v + 1);
      })
      .catch((err) => {
        if (!cancelled) setChartError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoadingChart(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, granularity, darkTheme]);

  // Render technical indicators, MT5 TP/SL order lines, and custom lines cleanly without duplicating
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const bars = barsRef.current;
    if (!chart || !candleSeries || bars.length === 0) return;

    indicatorSeriesRef.current.forEach((s) => {
      try {
        chart.removeSeries(s);
      } catch {
        // ignore
      }
    });
    indicatorSeriesRef.current = [];

    priceLinesRef.current.forEach((line) => {
      try {
        candleSeries.removePriceLine(line);
      } catch {
        // ignore
      }
    });
    priceLinesRef.current = [];

    if (indicators.sma20 && bars.length > 20) {
      const sma = chart.addSeries(LineSeries, { color: '#2563eb', lineWidth: 2, priceLineVisible: false });
      sma.setData(
        bars.slice(19).map((_, idx) => {
          const avg = bars.slice(idx, idx + 20).reduce((s, b) => s + b.close, 0) / 20;
          return { time: bars[idx + 19].time, value: avg };
        })
      );
      indicatorSeriesRef.current.push(sma);
    }

    if (indicators.ema50 && bars.length > 50) {
      const ema = chart.addSeries(LineSeries, { color: '#d97706', lineWidth: 2, priceLineVisible: false });
      const k = 2 / 51;
      let prevEma = bars.slice(0, 50).reduce((s, b) => s + b.close, 0) / 50;
      ema.setData(
        bars.slice(50).map((b) => {
          prevEma = b.close * k + prevEma * (1 - k);
          return { time: b.time, value: prevEma };
        })
      );
      indicatorSeriesRef.current.push(ema);
    }

    if (indicators.bollinger && bars.length > 20) {
      const upper = chart.addSeries(LineSeries, { color: '#9333ea', lineWidth: 1, priceLineVisible: false });
      const lower = chart.addSeries(LineSeries, { color: '#9333ea', lineWidth: 1, priceLineVisible: false });
      const upperData: Array<{ time: Time; value: number }> = [];
      const lowerData: Array<{ time: Time; value: number }> = [];
      for (let i = 19; i < bars.length; i++) {
        const slice = bars.slice(i - 19, i + 1);
        const mean = slice.reduce((s, b) => s + b.close, 0) / 20;
        const sd = Math.sqrt(slice.reduce((s, b) => s + Math.pow(b.close - mean, 2), 0) / 20);
        upperData.push({ time: bars[i].time, value: mean + 2 * sd });
        lowerData.push({ time: bars[i].time, value: mean - 2 * sd });
      }
      upper.setData(upperData);
      lower.setData(lowerData);
      indicatorSeriesRef.current.push(upper, lower);
    }

    orders
      .filter((o) => o.status === 'OPEN' && o.symbol === symbol)
      .forEach((o) => {
        priceLinesRef.current.push(
          candleSeries.createPriceLine({
            price: Number(o.entry_price),
            color: '#2563eb',
            lineWidth: 1,
            title: `${o.side} Entry`
          })
        );
        if (o.take_profit) {
          priceLinesRef.current.push(
            candleSeries.createPriceLine({
              price: Number(o.take_profit),
              color: '#059669',
              lineWidth: 2,
              lineStyle: 2,
              title: 'TP'
            })
          );
        }
        if (o.stop_loss) {
          priceLinesRef.current.push(
            candleSeries.createPriceLine({
              price: Number(o.stop_loss),
              color: '#dc2626',
              lineWidth: 2,
              lineStyle: 2,
              title: 'SL'
            })
          );
        }
      });

    if (latestClose > 0 && orderMode === 'MT5') {
      const previewSl = resolveSlTpTarget({
        enabled: slEnabled,
        rawValue: slInput,
        unit: slUnit,
        kind: 'SL',
        side: previewSide,
        entryPrice: latestClose,
        stake,
        multiplier,
        symbol
      });
      const previewTp = resolveSlTpTarget({
        enabled: tpEnabled,
        rawValue: tpInput,
        unit: tpUnit,
        kind: 'TP',
        side: previewSide,
        entryPrice: latestClose,
        stake,
        multiplier,
        symbol
      });

      if (previewTp.active && previewTp.price !== null) {
        priceLinesRef.current.push(
          candleSeries.createPriceLine({
            price: previewTp.price,
            color: 'rgba(16, 185, 129, 0.55)',
            lineWidth: 1,
            lineStyle: 3,
            title: `Plan TP (+$${previewTp.usd?.toFixed(2)})`
          })
        );
      }
      if (previewSl.active && previewSl.price !== null) {
        priceLinesRef.current.push(
          candleSeries.createPriceLine({
            price: previewSl.price,
            color: 'rgba(244, 63, 94, 0.55)',
            lineWidth: 1,
            lineStyle: 3,
            title: `Plan SL (-$${previewSl.usd?.toFixed(2)})`
          })
        );
      }
    }

    if (showDrawings) {
      customLines.forEach((price) => {
        priceLinesRef.current.push(
          candleSeries.createPriceLine({
            price,
            color: '#0284c7',
            lineWidth: 1,
            lineStyle: 1,
            title: 'Line'
          })
        );
      });
    }
  }, [
    barsVersion,
    indicators,
    orders,
    customLines,
    showDrawings,
    symbol,
    latestClose,
    orderMode,
    slEnabled,
    tpEnabled,
    slInput,
    tpInput,
    slUnit,
    tpUnit,
    previewSide,
    stake,
    multiplier
  ]);

  const applyLiveTick = (quote: number, epoch: number) => {
    if (!candleSeriesRef.current || !lastCandleRef.current) return;
    setLatestClose(quote);
    const barTime = Math.floor(epoch / granularity) * granularity;
    const prev = lastCandleRef.current;
    const prevTime = Number(prev.time);
    if (barTime < prevTime) return;

    if (barTime > prevTime) {
      const nextBar: CandlestickData = {
        time: barTime as Time,
        open: prev.close,
        high: Math.max(prev.close, quote),
        low: Math.min(prev.close, quote),
        close: quote
      };
      lastCandleRef.current = nextBar;
      candleSeriesRef.current.update(nextBar);
    } else {
      const updatedBar: CandlestickData = {
        ...prev,
        high: Math.max(prev.high, quote),
        low: Math.min(prev.low, quote),
        close: quote
      };
      lastCandleRef.current = updatedBar;
      candleSeriesRef.current.update(updatedBar);
    }
  };

  useEffect(() => {
    const unsub = subscribeDerivTicksDirect(symbol, (tick) => {
      if (tick.symbol === symbol) {
        applyLiveTick(tick.quote, tick.epoch);
      }
    });
    return () => unsub();
  }, [symbol, granularity]);

  useEffect(() => {
    if (!liveTick || liveTick.symbol !== symbol) return;
    applyLiveTick(liveTick.quote, liveTick.epoch);
  }, [liveTick, symbol, granularity]);

  const handleToggleWatchlist = async (sym: string) => {
    const exists = watchlist.includes(sym);
    setWatchlist((prev) => (exists ? prev.filter((x) => x !== sym) : [...prev, sym]));
    if (!token) return;
    if (exists) {
      await apiFetch(`/watchlists/${encodeURIComponent(sym)}`, { method: 'DELETE' }).catch(() => {});
    } else {
      await apiFetch('/watchlists', { method: 'POST', body: JSON.stringify({ symbol: sym }) }).catch(() => {});
    }
  };

  const handlePlaceOrder = async (side: 'BUY' | 'SELL', customContractType?: string) => {
    setOrderError('');
    setOrderNotice('');
    setPlacingSide(side);
    try {
      const resolvedSl =
        orderMode === 'MT5'
          ? resolveSlTpTarget({
              enabled: slEnabled,
              rawValue: slInput,
              unit: slUnit,
              kind: 'SL',
              side,
              entryPrice: latestClose,
              stake,
              multiplier,
              symbol
            })
          : { active: false, price: null, usd: null };
      const resolvedTp =
        orderMode === 'MT5'
          ? resolveSlTpTarget({
              enabled: tpEnabled,
              rawValue: tpInput,
              unit: tpUnit,
              kind: 'TP',
              side,
              entryPrice: latestClose,
              stake,
              multiplier,
              symbol
            })
          : { active: false, price: null, usd: null };

      const payload = {
        symbol,
        side,
        stake,
        multiplier,
        entryPrice: latestClose,
        stopLoss: resolvedSl.active ? resolvedSl.price : null,
        takeProfit: resolvedTp.active ? resolvedTp.price : null,
        stopLossUsd: resolvedSl.active ? resolvedSl.usd : null,
        takeProfitUsd: resolvedTp.active ? resolvedTp.usd : null,
        contractType: customContractType,
        barrier: customContractType?.startsWith('DIGIT') ? digitPrediction : undefined,
        duration: customContractType ? durationTicks : undefined,
        durationUnit: customContractType ? 't' : undefined,
        connectedAccountId: activeDerivAccount?.id ?? null,
        executionMode: activeDerivAccount ? 'deriv' : 'virtual'
      };

      if (bulkCount > 1) {
        const res = await apiFetch<{ placedCount: number; failedCount: number }>('/orders/bulk', {
          method: 'POST',
          body: JSON.stringify({ ...payload, count: bulkCount })
        });
        setOrderNotice(`Opened ${res.placedCount} bulk ${side} positions on ${symbol}.`);
      } else {
        await apiFetch('/orders', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setOrderNotice(`Placed ${side} ${lotSize.toFixed(2)} lots on ${symbol} @ ${latestClose.toFixed(4)}`);
      }
      loadOrders();
      bumpOrderVersion();
      refreshDerivAccounts(false);
      refreshProfile();
    } catch (err) {
      setOrderError((err as Error).message);
    } finally {
      setPlacingSide(null);
    }
  };

  const handleCloseOrder = async (orderId: string) => {
    setOrderError('');
    try {
      await apiFetch(`/orders/${orderId}/close`, {
        method: 'POST',
        body: JSON.stringify({ exitPrice: latestClose })
      });
      loadOrders();
      bumpOrderVersion();
      refreshDerivAccounts(false);
      refreshProfile();
    } catch (err) {
      setOrderError((err as Error).message);
    }
  };

  const handleBulkClose = async (filter: BulkCloseFilter) => {
    setOrderError('');
    setOrderNotice('');
    setBulkClosing(filter);
    try {
      const pricesSnapshot: Record<string, number> = {
        ...livePricesMap,
        ...(latestClose > 0 ? { [symbol]: latestClose } : {})
      };
      const res = await apiFetch<{ closedCount: number; totalPnl: number }>('/orders/bulk-close', {
        method: 'POST',
        body: JSON.stringify({ filter, prices: pricesSnapshot })
      });
      setOrderNotice(
        `Closed ${res.closedCount} (${filter}) position${res.closedCount === 1 ? '' : 's'} · Net P/L: ${
          res.totalPnl >= 0 ? '+' : ''
        }${res.totalPnl.toFixed(2)} USD`
      );
      loadOrders();
      bumpOrderVersion();
      refreshDerivAccounts(false);
      refreshProfile();
    } catch (err) {
      setOrderError((err as Error).message);
    } finally {
      setBulkClosing(null);
    }
  };

  const safeInstruments = Array.isArray(instruments) ? instruments : [];
  const safeOrders = Array.isArray(orders) ? orders : [];
  const activeName = safeInstruments.find((i) => i.symbol === symbol)?.display_name || symbol;
  const openOrders = safeOrders.filter((o) => o.status === 'OPEN');
  const closedOrders = safeOrders.filter((o) => o.status !== 'OPEN');

  const groupedInstruments = useMemo(() => {
    const groups: Record<string, InstrumentItem[]> = {};
    for (const item of safeInstruments) {
      const key = item.market || 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }, [safeInstruments]);

  const estimateOrderFloating = (o: VirtualOrderItem) => {
    if (liveContracts[o.id]) {
      return Number(liveContracts[o.id].profit);
    }
    const current = Number(livePricesMap[o.symbol] ?? (o.symbol === symbol && latestClose > 0 ? latestClose : o.entry_price));
    const entry = Number(o.entry_price);
    const pct = o.side === 'BUY' ? (current - entry) / entry : (entry - current) / entry;
    return Number((Number(o.stake) * pct * 100).toFixed(2));
  };

  const totalFloatingPnl = openOrders.reduce((s, o) => s + estimateOrderFloating(o), 0);
  const usedMargin = openOrders.reduce((s, o) => s + Number(o.stake || 0), 0);
  const accountBalance = activeDerivAccount
    ? Number(activeDerivAccount.last_known_balance ?? 0)
    : Number(user?.virtual_workspace_balance ?? 10000);
  const equity = accountBalance + totalFloatingPnl;
  const freeMargin = Math.max(0, equity - usedMargin);
  const totalRealizedPnl = closedOrders.reduce((s, o) => s + Number(o.pnl || 0), 0);

  // Lightweight Charts Cumulative Realized P&L Progress Chart in Exposure Summary
  useEffect(() => {
    if (dockTab !== 'summary') return;
    const el = progressChartRef.current;
    if (!el || closedOrders.length === 0) return;

    const chart = createChart(el, {
      width: Math.max(240, el.clientWidth || 320),
      height: 170,
      layout: {
        background: { color: darkTheme ? '#0f172a' : '#f8fafc' },
        textColor: darkTheme ? '#94a3b8' : '#475569'
      },
      grid: {
        vertLines: { color: darkTheme ? '#1e293b' : '#e2e8f0' },
        horzLines: { color: darkTheme ? '#1e293b' : '#e2e8f0' }
      },
      timeScale: { timeVisible: true, secondsVisible: false }
    });

    const chronological = [...closedOrders].reverse();
    let cum = 0;
    let lastEpoch = 0;
    const points = chronological.map((o, idx) => {
      cum += Number(o.pnl || 0);
      const rawEpoch = o.closed_at
        ? Math.floor(new Date(o.closed_at).getTime() / 1000)
        : Math.floor(Date.now() / 1000) - (chronological.length - idx) * 60;
      const t = rawEpoch <= lastEpoch ? lastEpoch + 1 : rawEpoch;
      lastEpoch = t;
      return { time: t as Time, value: Number(cum.toFixed(2)) };
    });

    const isPositive = cum >= 0;
    const series = chart.addSeries(AreaSeries, {
      lineColor: isPositive ? '#10b981' : '#f43f5e',
      topColor: isPositive ? 'rgba(16, 185, 129, 0.32)' : 'rgba(244, 63, 94, 0.32)',
      bottomColor: isPositive ? 'rgba(16, 185, 129, 0.02)' : 'rgba(244, 63, 94, 0.02)',
      lineWidth: 2
    });
    series.setData(points);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) chart.applyOptions({ width: Math.floor(rect.width) });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [dockTab, closedOrders, darkTheme]);

  const decimals = getPriceDecimals(symbol, latestClose);
  const pipSize = getPipSize(symbol, latestClose);
  const spread = latestClose > 0 ? Math.max(pipSize * 1.2, latestClose * 0.00025) : 0;

  return (
    <div className="p-3 space-y-3 max-w-[1520px] mx-auto">
      {/* MT5 Top Telemetry Strip */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#141a23] px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono tabular-nums">
          <span>
            <span className="text-slate-500 font-sans">Balance: </span>
            <strong className="text-slate-900 dark:text-white">${accountBalance.toFixed(2)}</strong>
          </span>
          <span>
            <span className="text-slate-500 font-sans">Equity: </span>
            <strong className={equity >= accountBalance ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}>
              ${equity.toFixed(2)}
            </strong>
          </span>
          <span>
            <span className="text-slate-500 font-sans">In Trades: </span>
            <strong className="text-slate-700 dark:text-slate-200">${usedMargin.toFixed(2)}</strong>
          </span>
          <span>
            <span className="text-slate-500 font-sans">Available: </span>
            <strong className="text-slate-700 dark:text-slate-200">${freeMargin.toFixed(2)}</strong>
          </span>
          <span>
            <span className="text-slate-500 font-sans">Live P/L: </span>
            <strong className={totalFloatingPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}>
              {totalFloatingPnl >= 0 ? '+' : ''}
              {totalFloatingPnl.toFixed(2)} USD
            </strong>
          </span>
        </div>
        {orderNotice && (
          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{orderNotice}</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Main MT5 Chart Canvas */}
        <div className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#141a23] overflow-hidden shadow-xs">
          {/* Chart Top Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-sky-400">
                1. Market &amp; Chart
              </span>
              <select
                value={symbol}
                onChange={(e) => selectSymbol(e.target.value)}
                className="font-bold text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 max-w-[260px]"
              >
                {safeInstruments.length === 0 ? (
                  <>
                    <option value="R_25">R_25 (Volatility 25)</option>
                    <option value="R_50">R_50 (Volatility 50)</option>
                    <option value="R_75">R_75 (Volatility 75)</option>
                    <option value="R_100">R_100 (Volatility 100)</option>
                    <option value="1HZ90V">1HZ90V (Volatility 90 1s)</option>
                    <option value="1HZ100V">1HZ100V (Volatility 100 1s)</option>
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

              <button
                type="button"
                onClick={() => handleToggleWatchlist(symbol)}
                title="Pin to Watchlist"
                className="p-1 rounded-full border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>

              <TimeframesBar granularity={granularity} onChange={setGranularity} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <IndicatorsPanel
                config={indicators}
                onToggle={(k) => setIndicators((prev) => ({ ...prev, [k]: !prev[k] }))}
              />
              <button
                type="button"
                onClick={() => setCustomLines((prev) => prev.slice(0, -1))}
                title="Undo Drawing"
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button type="button" title="Redo" className="p-1 text-slate-400">
                <Redo2 className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-semibold text-blue-600 flex items-center gap-1">
                <Save className="w-3.5 h-3.5" /> Save
              </span>
              <GearIcon className="w-3.5 h-3.5 text-slate-500" />
            </div>
          </div>

          {/* Instrument Subheader with Sell / Buy Prices */}
          <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-bold text-slate-900 dark:text-white">{activeName}</span>
              <span className="font-mono text-rose-500 font-bold tabular-nums">
                SELL {latestClose.toFixed(decimals)}
              </span>
              <span className="font-mono text-blue-600 dark:text-sky-400 font-bold tabular-nums">
                BUY {(latestClose + spread).toFixed(decimals)}
              </span>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                Spread {(spread / pipSize).toFixed(1)} pts
              </span>
              <span className={`font-mono ${priceDelta.abs >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {priceDelta.abs >= 0 ? '+' : ''}
                {priceDelta.abs.toFixed(decimals)} ({priceDelta.pct >= 0 ? '+' : ''}
                {priceDelta.pct.toFixed(2)}%)
              </span>
            </div>
            {loadingChart && <span className="text-slate-400">Loading live Deriv candles...</span>}
            {chartError && <span className="text-rose-500">{chartError}</span>}
          </div>

          {/* Chart Body with Left Drawing Rail */}
          <div className="flex w-full overflow-hidden">
            <DrawingToolbar
              activeTool={activeTool}
              onSelect={setActiveTool}
              showDrawings={showDrawings}
              onToggleShow={() => setShowDrawings((s) => !s)}
              onClearDrawings={() => setCustomLines([])}
            />
            <div ref={containerRef} className="min-w-0 flex-1 w-full h-[340px] sm:h-[420px] lg:h-[460px] relative overflow-hidden" />
          </div>
        </div>

        {/* Right Side MT5 Order Ticket + Market Watch */}
        <div className="lg:col-span-4 space-y-3">
          <OrderTicket
            symbol={symbol}
            latestPrice={latestClose}
            stake={stake}
            setStake={setStake}
            lotSize={lotSize}
            setLotSize={setLotSize}
            orderMode={orderMode}
            setOrderMode={setOrderMode}
            digitPrediction={digitPrediction}
            setDigitPrediction={setDigitPrediction}
            durationTicks={durationTicks}
            setDurationTicks={setDurationTicks}
            bulkCount={bulkCount}
            setBulkCount={setBulkCount}
            multiplier={multiplier}
            setMultiplier={setMultiplier}
            previewSide={previewSide}
            setPreviewSide={setPreviewSide}
            slEnabled={slEnabled}
            setSlEnabled={setSlEnabled}
            tpEnabled={tpEnabled}
            setTpEnabled={setTpEnabled}
            slUnit={slUnit}
            setSlUnit={setSlUnit}
            tpUnit={tpUnit}
            setTpUnit={setTpUnit}
            slInput={slInput}
            setSlInput={setSlInput}
            tpInput={tpInput}
            setTpInput={setTpInput}
            onPlaceOrder={handlePlaceOrder}
            onBulkClose={handleBulkClose}
            placingSide={placingSide}
            openOrders={openOrders}
            onCloseOrder={handleCloseOrder}
            authenticated={Boolean(token)}
            error={orderError}
            accountLabel={
              activeDerivAccount
                ? `${activeDerivAccount.account_type === 'real' ? 'Real Trading Account' : 'Demo Practice Account'} (${activeDerivAccount.currency})`
                : 'MT5 Order Ticket (Virtual)'
            }
          />

          <MarketWatchPanel
            instruments={safeInstruments}
            activeSymbol={symbol}
            watchlist={watchlist}
            onSelectSymbol={selectSymbol}
            onToggleWatchlist={handleToggleWatchlist}
            livePrices={livePricesMap}
            onVisibleSymbolsChange={setVisibleMarketSymbols}
          />
        </div>
      </div>

      {/* MT5 Bottom Terminal Dock: 3. Open Trades / History / Quick Bulk Close */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#141a23] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-sky-400 mr-1">
              3. Manage Trades
            </span>
            <button
              type="button"
              onClick={() => setDockTab('open')}
              className={`px-3 py-1.5 rounded-lg transition ${
                dockTab === 'open'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Open Positions ({openOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setDockTab('history')}
              className={`px-3 py-1.5 rounded-lg transition ${
                dockTab === 'history'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              History ({closedOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setDockTab('summary')}
              className={`px-3 py-1.5 rounded-lg transition ${
                dockTab === 'summary'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Exposure Summary
            </button>
          </div>

          {/* Bulk Close Controls */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {(
              [
                { id: 'profitable', label: 'Close Profitable', cls: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
                { id: 'losing', label: 'Close Losing', cls: 'bg-amber-600 hover:bg-amber-700 text-white' },
                { id: 'buy', label: 'Close All BUY', cls: 'bg-blue-600 hover:bg-blue-700 text-white' },
                { id: 'sell', label: 'Close All SELL', cls: 'bg-rose-600 hover:bg-rose-700 text-white' },
                { id: 'over', label: 'Close Over', cls: 'bg-slate-700 hover:bg-slate-800 text-white' },
                { id: 'under', label: 'Close Under', cls: 'bg-slate-700 hover:bg-slate-800 text-white' },
                { id: 'all', label: 'Close All Trades', cls: 'bg-red-600 hover:bg-red-700 text-white' }
              ] as Array<{ id: BulkCloseFilter; label: string; cls: string }>
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                disabled={!token || openOrders.length === 0 || bulkClosing !== null}
                onClick={() => handleBulkClose(btn.id)}
                className={`px-2.5 py-1 rounded-md font-bold transition disabled:opacity-40 inline-flex items-center gap-1 ${btn.cls}`}
              >
                {btn.id === 'all' && <XCircle className="w-3 h-3" />}
                {bulkClosing === btn.id ? 'Closing...' : btn.label}
              </button>
            ))}
          </div>
        </div>

        {dockTab === 'open' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-[#1b232e] text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Symbol</th>
                  <th className="px-3 py-2.5">Type / Contract</th>
                  <th className="px-3 py-2.5">Lots / Stake</th>
                  <th className="px-3 py-2.5">Entry</th>
                  <th className="px-3 py-2.5">Current</th>
                  <th className="px-3 py-2.5">SL / TP</th>
                  <th className="px-3 py-2.5 text-right">Floating P/L</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {openOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                      No open positions. Use the MT5 Order Ticket on the right to place single or bulk trades.
                    </td>
                  </tr>
                ) : (
                  openOrders.map((o) => {
                    const current = Number(
                      liveContracts[o.id]?.currentSpot ??
                        livePricesMap[o.symbol] ??
                        (o.symbol === symbol && latestClose > 0 ? latestClose : o.entry_price)
                    );
                    const floating = estimateOrderFloating(o);
                    return (
                      <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-bold">
                          {o.symbol}
                          {o.deriv_contract_id && (
                            <div className="text-[10px] font-mono font-normal text-emerald-600">
                              #{o.deriv_contract_id}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`font-bold ${o.side === 'BUY' ? 'text-blue-600' : 'text-rose-600'}`}>
                            {o.side}
                          </span>{' '}
                          <span className="font-mono text-[11px] text-slate-500">{o.contract_type || 'MULT'}</span>
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">
                          {(Number(o.stake) / 100).toFixed(2)} lots · ${Number(o.stake).toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">{Number(o.entry_price).toFixed(4)}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">{current.toFixed(4)}</td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500 tabular-nums">
                          {o.stop_loss ? Number(o.stop_loss).toFixed(2) : '-'} /{' '}
                          {o.take_profit ? Number(o.take_profit).toFixed(2) : '-'}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono font-bold tabular-nums ${
                            floating >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                          }`}
                        >
                          {floating >= 0 ? '+' : ''}
                          {floating.toFixed(2)} USD
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleCloseOrder(o.id)}
                            className="px-2.5 py-1 rounded bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 hover:bg-rose-100 font-bold text-[11px]"
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {dockTab === 'history' && (
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-[#1b232e] text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Symbol</th>
                  <th className="px-3 py-2.5">Side / Mode</th>
                  <th className="px-3 py-2.5">Stake</th>
                  <th className="px-3 py-2.5">Entry → Exit</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Realized P/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {closedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                      No closed trades yet.
                    </td>
                  </tr>
                ) : (
                  closedOrders.slice(0, 40).map((o) => {
                    const pnl = Number(o.pnl || 0);
                    return (
                      <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2 font-bold">{o.symbol}</td>
                        <td className="px-3 py-2">
                          <span className={o.side === 'BUY' ? 'text-blue-600 font-bold' : 'text-rose-600 font-bold'}>
                            {o.side}
                          </span>{' '}
                          <span className="text-[11px] text-slate-500">{o.contract_type || o.source}</span>
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">${Number(o.stake).toFixed(2)}</td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[11px]">
                          {Number(o.entry_price).toFixed(2)} → {o.exit_price ? Number(o.exit_price).toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2 text-[11px] font-mono text-slate-500">{o.status}</td>
                        <td
                          className={`px-4 py-2 text-right font-mono font-bold tabular-nums ${
                            pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {pnl >= 0 ? '+' : ''}
                          {pnl.toFixed(2)} USD
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {dockTab === 'summary' && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="text-slate-400">Open Exposure</div>
                <div className="text-base font-mono font-bold tabular-nums mt-1">${usedMargin.toFixed(2)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="text-slate-400">Floating P/L</div>
                <div
                  className={`text-base font-mono font-bold tabular-nums mt-1 ${
                    totalFloatingPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {totalFloatingPnl >= 0 ? '+' : ''}
                  ${totalFloatingPnl.toFixed(2)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="text-slate-400">Realized P/L</div>
                <div
                  className={`text-base font-mono font-bold tabular-nums mt-1 ${
                    totalRealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {totalRealizedPnl >= 0 ? '+' : ''}
                  ${totalRealizedPnl.toFixed(2)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="text-slate-400">Closed Trades</div>
                <div className="text-base font-mono font-bold tabular-nums mt-1">{closedOrders.length}</div>
              </div>
            </div>
            {closedOrders.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Cumulative P&amp;L Progress (Lightweight Charts)
                </div>
                <div
                  ref={progressChartRef}
                  className="w-full h-[170px] rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
