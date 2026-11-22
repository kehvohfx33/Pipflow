import React, { useEffect, useMemo, useState } from 'react';
import { Gauge } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';
import { LiveTick } from '../../hooks/useDerivStream';
import { ChartBarrier, SmartChartWrapper } from '../../components/deriv/SmartChartWrapper';
import { SymbolSelector, useDerivSymbolsCatalog } from '../../components/deriv/SymbolSelector';
import { ContractPositionsList } from '../../components/deriv/PositionsCards';
import { VirtualOrderItem } from '../../components/trading/OrderTicket';

interface AccumulatorsPageProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  liveTick: LiveTick | null;
  livePricesMap: Record<string, number>;
}

const GROWTH_RATES = [0.01, 0.02, 0.03, 0.04, 0.05];

export const AccumulatorsPage: React.FC<AccumulatorsPageProps> = ({
  symbol,
  onSymbolChange,
  liveTick,
  livePricesMap
}) => {
  const { token, activeDerivAccount, refreshDerivAccounts, refreshProfile, orderVersion, bumpOrderVersion } = useAuth();
  const synthSymbols = useDerivSymbolsCatalog(true);
  const effectiveSymbol = synthSymbols.some((s) => s.symbol === symbol) ? symbol : '1HZ100V';

  const [growthRate, setGrowthRate] = useState(0.03);
  const [stake, setStake] = useState(10);
  const [useTakeProfit, setUseTakeProfit] = useState(false);
  const [takeProfitUsd, setTakeProfitUsd] = useState(25);
  const [quote, setQuote] = useState<{
    payout: number;
    askPrice: number;
    spot: number;
    contractParams?: {
      high_barrier?: string;
      low_barrier?: string;
      tick_size_percentage?: number;
      maximum_ticks?: number;
      maximum_payout?: number;
    };
  } | null>(null);
  const [quoteErr, setQuoteErr] = useState('');
  const [placing, setPlacing] = useState(false);
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [orders, setOrders] = useState<VirtualOrderItem[]>([]);
  const [liveContracts, setLiveContracts] = useState<Record<string, { currentSpot: number; profit: number; bidPrice?: number }>>({});

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

  useEffect(() => {
    let cancelled = false;
    setQuoteErr('');
    const t = setTimeout(() => {
      apiFetch<typeof quote>('/deriv/proposal', {
        method: 'POST',
        body: JSON.stringify({
          symbol: effectiveSymbol,
          contractType: 'ACCU',
          stake,
          growthRate,
          ...(useTakeProfit && takeProfitUsd > 0 ? { takeProfit: takeProfitUsd } : {})
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
  }, [effectiveSymbol, growthRate, stake, useTakeProfit, takeProfitUsd]);

  const barriers = useMemo((): ChartBarrier[] => {
    const high = quote?.contractParams?.high_barrier;
    const low = quote?.contractParams?.low_barrier;
    if (!high || !low) return [];
    return [
      {
        shade: 'BETWEEN',
        color: '#26a69a',
        shadeColor: 'rgba(38, 166, 154, 0.14)',
        high,
        low,
        relative: false
      }
    ];
  }, [quote]);

  const openAccu = orders.find((o) => o.status === 'OPEN' && String(o.contract_type || '').toUpperCase() === 'ACCU');

  const handleBuy = async () => {
    if (!token) {
      setNotice('Please sign in to open an Accumulator contract.');
      return;
    }
    setPlacing(true);
    setNotice('');
    try {
      const res = await apiFetch<{ derivExecution?: { contractId: number } }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          symbol: effectiveSymbol,
          side: 'BUY',
          stake,
          entryPrice: liveTick?.quote ?? quote?.spot ?? 0,
          contractType: 'ACCU',
          growthRate,
          ...(useTakeProfit && takeProfitUsd > 0 ? { takeProfitUsd } : {}),
          connectedAccountId: activeDerivAccount?.id ?? null,
          executionMode: activeDerivAccount ? 'deriv' : 'virtual'
        })
      });
      setNotice(
        res.derivExecution
          ? `Opened Accumulator #${res.derivExecution.contractId} (${Math.round(growthRate * 100)}%) on ${effectiveSymbol}.`
          : `Opened virtual Accumulator (${Math.round(growthRate * 100)}%) on ${effectiveSymbol}.`
      );
      loadOrders();
      refreshDerivAccounts(false);
      refreshProfile();
      bumpOrderVersion();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setPlacing(false);
    }
  };

  const handleSell = async (orderId: string, price: number) => {
    setSellingId(orderId);
    try {
      await apiFetch(`/orders/${orderId}/close`, {
        method: 'POST',
        body: JSON.stringify({ exitPrice: price })
      });
      loadOrders();
      refreshDerivAccounts(false);
      refreshProfile();
      bumpOrderVersion();
    } finally {
      setSellingId(null);
    }
  };

  const activeBidVal = openAccu
    ? Number(liveContracts[openAccu.id]?.bidPrice ?? Math.max(0, Number(openAccu.stake) + Number(liveContracts[openAccu.id]?.profit ?? 0)))
    : 0;

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-4 space-y-4">
      <div className="grid lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-8 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Gauge className="w-5 h-5 text-emerald-600" />
                <span>Deriv Accumulators Terminal</span>
              </h1>
              <p className="text-xs text-slate-500">
                Exponential compound payout per tick while spot stays inside barriers. Close early anytime.
              </p>
            </div>
            {liveTick && (
              <div className="px-3 py-1.5 rounded-xl bg-slate-900 text-white font-mono text-sm font-bold tabular-nums">
                Spot: {liveTick.quote}
              </div>
            )}
          </div>

          <SmartChartWrapper
            chartId="accumulator-chart"
            symbol={effectiveSymbol}
            onSymbolChange={onSymbolChange}
            defaultGranularity={0}
            barriers={barriers}
            fallbackSpot={liveTick?.quote}
          />
        </div>

        {/* Right: Accumulator Controls */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-xs">
          <SymbolSelector value={effectiveSymbol} onChange={onSymbolChange} symbols={synthSymbols} />

          {/* Growth Rate Selector */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-bold">
              <span>Growth Rate</span>
              <span className="font-mono text-emerald-600">{Math.round(growthRate * 100)}% per tick</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {GROWTH_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setGrowthRate(rate)}
                  className={`py-2 rounded-xl font-mono text-xs font-extrabold border transition ${
                    growthRate === rate
                      ? 'bg-[#26a69a] text-white border-[#26a69a]'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {Math.round(rate * 100)}%
                </button>
              ))}
            </div>
          </div>

          {/* Stake */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Stake (USD)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={stake}
              onChange={(e) => setStake(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-mono font-bold"
            />
          </div>

          {/* Optional Take Profit */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
            <label className="flex items-center justify-between text-xs font-bold cursor-pointer">
              <span>Take Profit (USD)</span>
              <input
                type="checkbox"
                checked={useTakeProfit}
                onChange={(e) => setUseTakeProfit(e.target.checked)}
                className="w-4 h-4 accent-[#26a69a]"
              />
            </label>
            {useTakeProfit && (
              <input
                type="number"
                min={1}
                step={1}
                value={takeProfitUsd}
                onChange={(e) => setTakeProfitUsd(Math.max(1, Number(e.target.value) || 1))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-mono font-bold"
              />
            )}
          </div>

          {/* Live ACCU Proposal Parameters */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Maximum Payout</span>
              <span className="font-mono font-bold text-emerald-600">
                {quote?.contractParams?.maximum_payout
                  ? `${Number(quote.contractParams.maximum_payout).toFixed(2)} USD`
                  : quote
                    ? `${quote.payout.toFixed(2)} USD`
                    : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Max Ticks</span>
              <span className="font-mono font-bold">{quote?.contractParams?.maximum_ticks ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Barrier Range</span>
              <span className="font-mono font-bold">
                {quote?.contractParams?.low_barrier && quote?.contractParams?.high_barrier
                  ? `${quote.contractParams.low_barrier} – ${quote.contractParams.high_barrier}`
                  : 'Syncing...'}
              </span>
            </div>
            {quoteErr && <div className="text-[11px] text-rose-500 pt-1">{quoteErr}</div>}
          </div>

          {openAccu ? (
            <button
              type="button"
              disabled={sellingId === openAccu.id}
              onClick={() => handleSell(openAccu.id, Number(livePricesMap[openAccu.symbol] ?? openAccu.entry_price))}
              className="w-full py-3 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-sm shadow-md transition"
            >
              {sellingId === openAccu.id ? 'Closing...' : `Close Accumulator (${activeBidVal.toFixed(2)} USD)`}
            </button>
          ) : (
            <button
              type="button"
              disabled={placing}
              onClick={handleBuy}
              className="w-full py-3 rounded-full bg-[#26a69a] hover:bg-teal-600 disabled:opacity-50 text-white font-extrabold text-sm shadow-md transition"
            >
              {placing ? 'Starting Accumulator...' : `Buy Accumulator · ${stake.toFixed(2)} USD`}
            </button>
          )}

          {notice && (
            <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-2.5 text-xs text-blue-700 dark:text-sky-300 font-semibold text-center">
              {notice}
            </div>
          )}
        </div>
      </div>

      <ContractPositionsList
        orders={orders}
        liveContracts={liveContracts}
        livePricesMap={livePricesMap}
        contractFilter={(o) => String(o.contract_type || '').toUpperCase() === 'ACCU'}
        onSell={handleSell}
        sellingId={sellingId}
      />
    </div>
  );
};
