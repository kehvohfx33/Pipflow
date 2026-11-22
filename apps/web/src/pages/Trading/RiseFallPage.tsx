import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Clock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';
import { LiveTick } from '../../hooks/useDerivStream';
import { SmartChartWrapper } from '../../components/deriv/SmartChartWrapper';
import { SymbolSelector, useDerivSymbolsCatalog } from '../../components/deriv/SymbolSelector';
import { ContractPositionsList } from '../../components/deriv/PositionsCards';
import { VirtualOrderItem } from '../../components/trading/OrderTicket';

interface RiseFallPageProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  liveTick: LiveTick | null;
  livePricesMap: Record<string, number>;
}

type Direction = 'rise' | 'fall';
type DurationUnit = 't' | 's' | 'm' | 'h' | 'd';
type ExpiryMode = 'duration' | 'endtime';

export const RiseFallPage: React.FC<RiseFallPageProps> = ({
  symbol,
  onSymbolChange,
  liveTick,
  livePricesMap
}) => {
  const { token, activeDerivAccount, refreshDerivAccounts, refreshProfile, orderVersion, bumpOrderVersion } = useAuth();
  const symbols = useDerivSymbolsCatalog(false);

  const [direction, setDirection] = useState<Direction>('rise');
  const [allowEquals, setAllowEquals] = useState(false);
  const [stake, setStake] = useState(10);
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('duration');
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('t');
  const [duration, setDuration] = useState(5);
  const [endDateStr, setEndDateStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [endTimeStr, setEndTimeStr] = useState(() => {
    const d = new Date(Date.now() + 15 * 60_000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  });

  const [quote, setQuote] = useState<{ payout: number; askPrice: number; spot: number } | null>(null);
  const [quoteErr, setQuoteErr] = useState('');
  const [orders, setOrders] = useState<VirtualOrderItem[]>([]);
  const [liveContracts, setLiveContracts] = useState<Record<string, { currentSpot: number; profit: number; bidPrice?: number }>>({});
  const [placing, setPlacing] = useState(false);
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [tradeNotice, setTradeNotice] = useState('');

  const contractType = direction === 'rise' ? (allowEquals ? 'CALLE' : 'CALL') : allowEquals ? 'PUTE' : 'PUT';

  const dateExpiryEpoch =
    expiryMode === 'endtime'
      ? Math.floor(new Date(`${endDateStr}T${endTimeStr}:00Z`).getTime() / 1000)
      : undefined;

  const loadOrders = () => {
    if (!token) return;
    apiFetch<{ orders?: VirtualOrderItem[]; liveContracts?: Record<string, { currentSpot: number; profit: number; bidPrice?: number }> }>('/orders')
      .then((res) => {
        setOrders(Array.isArray(res?.orders) ? res.orders : []);
        setLiveContracts(res?.liveContracts || {});
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadOrders();
  }, [token, orderVersion]);

  // Live Deriv proposal quote
  useEffect(() => {
    let cancelled = false;
    setQuoteErr('');
    const t = setTimeout(() => {
      apiFetch<{ payout: number; askPrice: number; spot: number }>('/deriv/proposal', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          contractType,
          stake,
          duration: expiryMode === 'duration' ? duration : undefined,
          durationUnit: expiryMode === 'duration' ? durationUnit : undefined,
          dateExpiry: expiryMode === 'endtime' ? dateExpiryEpoch : undefined,
          allowEquals
        })
      })
        .then((res) => {
          if (!cancelled) setQuote(res);
        })
        .catch((err) => {
          if (!cancelled) setQuoteErr((err as Error).message);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [symbol, contractType, stake, duration, durationUnit, expiryMode, endDateStr, endTimeStr, allowEquals]);

  const handleBuy = async () => {
    if (!token) {
      setTradeNotice('Please sign in to place Rise/Fall trades.');
      return;
    }
    setPlacing(true);
    setTradeNotice('');
    try {
      const res = await apiFetch<{ derivExecution?: { contractId: number } }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          side: direction === 'rise' ? 'BUY' : 'SELL',
          stake,
          entryPrice: liveTick?.quote ?? quote?.spot ?? 0,
          contractType,
          duration: expiryMode === 'duration' ? duration : undefined,
          durationUnit: expiryMode === 'duration' ? durationUnit : undefined,
          dateExpiry: expiryMode === 'endtime' ? dateExpiryEpoch : undefined,
          allowEquals,
          connectedAccountId: activeDerivAccount?.id ?? null,
          executionMode: activeDerivAccount ? 'deriv' : 'virtual'
        })
      });
      setTradeNotice(
        res.derivExecution
          ? `Purchased ${contractType} #${res.derivExecution.contractId} on ${symbol}.`
          : `Opened virtual ${contractType} contract on ${symbol}.`
      );
      loadOrders();
      refreshDerivAccounts(false);
      refreshProfile();
      bumpOrderVersion();
    } catch (err) {
      setTradeNotice((err as Error).message);
    } finally {
      setPlacing(false);
    }
  };

  const handleSell = async (orderId: string, currentPrice: number) => {
    setSellingId(orderId);
    try {
      await apiFetch(`/orders/${orderId}/close`, {
        method: 'POST',
        body: JSON.stringify({ exitPrice: currentPrice })
      });
      loadOrders();
      refreshDerivAccounts(false);
      refreshProfile();
      bumpOrderVersion();
    } finally {
      setSellingId(null);
    }
  };

  const payoutPct = quote && quote.askPrice > 0 ? (((quote.payout - quote.askPrice) / quote.askPrice) * 100).toFixed(1) : null;

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-4 space-y-4">
      <div className="grid lg:grid-cols-12 gap-4 items-start">
        {/* Left: Live SmartChart from risefall ZIP */}
        <div className="lg:col-span-8 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">Deriv Rise / Fall Terminal</h1>
              <p className="text-xs text-slate-500">
                Real-time SmartCharts feed with live contract proposals &amp; early exit controls.
              </p>
            </div>
            {liveTick && (
              <div className="px-3 py-1.5 rounded-xl bg-slate-900 text-white font-mono text-sm font-bold tabular-nums">
                Spot: {liveTick.quote}
              </div>
            )}
          </div>

          <SmartChartWrapper
            chartId="rise-fall-chart"
            symbol={symbol}
            onSymbolChange={onSymbolChange}
            defaultGranularity={0}
            fallbackSpot={liveTick?.quote}
          />
        </div>

        {/* Right: Rise / Fall Trade Controls */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-xs">
          <SymbolSelector value={symbol} onChange={onSymbolChange} symbols={symbols} />

          {/* Direction Toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setDirection('rise')}
              className={`py-2.5 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
                direction === 'rise'
                  ? 'bg-[#26a69a] text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <ArrowUpRight className="w-4 h-4" /> Rise
            </button>
            <button
              type="button"
              onClick={() => setDirection('fall')}
              className={`py-2.5 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
                direction === 'fall'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <ArrowDownRight className="w-4 h-4" /> Fall
            </button>
          </div>

          {/* Allow Equals */}
          <label className="flex items-center justify-between text-xs font-semibold border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 cursor-pointer">
            <span>Allow Equals ({direction === 'rise' ? 'CALLE' : 'PUTE'})</span>
            <input
              type="checkbox"
              checked={allowEquals}
              onChange={(e) => setAllowEquals(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
          </label>

          {/* Expiry Mode */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setExpiryMode('duration')}
                className={`py-1.5 rounded-md ${
                  expiryMode === 'duration' ? 'bg-white dark:bg-slate-900 shadow-xs text-blue-600' : 'text-slate-500'
                }`}
              >
                Duration
              </button>
              <button
                type="button"
                onClick={() => setExpiryMode('endtime')}
                className={`py-1.5 rounded-md flex items-center justify-center gap-1 ${
                  expiryMode === 'endtime' ? 'bg-white dark:bg-slate-900 shadow-xs text-blue-600' : 'text-slate-500'
                }`}
              >
                <Clock className="w-3 h-3" /> End Time (GMT)
              </button>
            </div>

            {expiryMode === 'duration' ? (
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={durationUnit}
                  onChange={(e) => setDurationUnit(e.target.value as DurationUnit)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
                >
                  <option value="t">Ticks</option>
                  <option value="s">Seconds</option>
                  <option value="m">Minutes</option>
                  <option value="h">Hours</option>
                  <option value="d">Days</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={durationUnit === 't' ? 10 : 365}
                  value={duration}
                  onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono font-bold text-center"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={endDateStr}
                  onChange={(e) => setEndDateStr(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-xs font-mono"
                />
                <input
                  type="time"
                  value={endTimeStr}
                  onChange={(e) => setEndTimeStr(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-xs font-mono"
                />
              </div>
            )}
          </div>

          {/* Stake */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Stake (USD)</label>
            <input
              type="number"
              min={0.35}
              step={0.5}
              value={stake}
              onChange={(e) => setStake(Math.max(0.35, Number(e.target.value) || 1))}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-mono font-bold"
            />
          </div>

          {/* Live Proposal Quote Summary */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-3 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Contract Type</span>
              <span className="font-mono font-bold">{contractType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Payout</span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {quote ? `${quote.payout.toFixed(2)} USD (${payoutPct}%)` : 'Quoting...'}
              </span>
            </div>
            {quoteErr && <div className="text-[11px] text-rose-500 pt-1">{quoteErr}</div>}
          </div>

          <button
            type="button"
            disabled={placing}
            onClick={handleBuy}
            className={`w-full py-3 rounded-full font-extrabold text-sm text-white shadow-md transition ${
              direction === 'rise' ? 'bg-[#26a69a] hover:bg-teal-600' : 'bg-rose-600 hover:bg-rose-700'
            } disabled:opacity-50`}
          >
            {placing
              ? 'Placing Order...'
              : `Buy ${direction === 'rise' ? 'Rise' : 'Fall'} · ${stake.toFixed(2)} USD`}
          </button>

          {tradeNotice && (
            <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-2.5 text-xs text-blue-700 dark:text-sky-300 font-semibold text-center">
              {tradeNotice}
            </div>
          )}
        </div>
      </div>

      {/* Rise/Fall Positions */}
      <ContractPositionsList
        orders={orders}
        liveContracts={liveContracts}
        livePricesMap={livePricesMap}
        contractFilter={(o) => ['CALL', 'PUT', 'CALLE', 'PUTE'].includes(String(o.contract_type || '').toUpperCase())}
        onSell={handleSell}
        sellingId={sellingId}
      />
    </div>
  );
};
