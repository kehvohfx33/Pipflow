import React, { useEffect, useState } from 'react';
import { Hash } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';
import { fetchDerivTickHistoryDirect, subscribeDerivTicksDirect } from '../../services/derivBrowserWs';
import { SymbolSelector, useDerivSymbolsCatalog } from '../../components/deriv/SymbolSelector';
import { computeDigitStats, DigitStatsPanel } from '../../components/deriv/DigitStatsPanel';
import { ContractPositionsList } from '../../components/deriv/PositionsCards';
import { VirtualOrderItem } from '../../components/trading/OrderTicket';

interface DigitsPageProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  livePricesMap: Record<string, number>;
}

type DigitMode = 'even_odd' | 'over_under' | 'matches_differs';

export const DigitsPage: React.FC<DigitsPageProps> = ({
  symbol,
  onSymbolChange,
  livePricesMap
}) => {
  const { token, activeDerivAccount, refreshDerivAccounts, refreshProfile, orderVersion, bumpOrderVersion } = useAuth();
  const synthSymbols = useDerivSymbolsCatalog(true);

  const effectiveSymbol = synthSymbols.some((s) => s.symbol === symbol) ? symbol : 'R_100';

  const [mode, setMode] = useState<DigitMode>('over_under');
  const [subChoice, setSubChoice] = useState<'primary' | 'secondary'>('primary');
  const [selectedDigit, setSelectedDigit] = useState(4);
  const [durationTicks, setDurationTicks] = useState(1);
  const [stake, setStake] = useState(5);
  const [sampleCount, setSampleCount] = useState(200);
  const [tickPrices, setTickPrices] = useState<number[]>([]);
  const [pipSize, setPipSize] = useState(2);
  const [quote, setQuote] = useState<{ payout: number; askPrice: number } | null>(null);
  const [quoteErr, setQuoteErr] = useState('');
  const [placing, setPlacing] = useState(false);
  const [notice, setNotice] = useState('');
  const [orders, setOrders] = useState<VirtualOrderItem[]>([]);
  const [liveContracts, setLiveContracts] = useState<Record<string, { currentSpot: number; profit: number; bidPrice?: number }>>({});
  const [sellingId, setSellingId] = useState<string | null>(null);

  const contractType =
    mode === 'even_odd'
      ? subChoice === 'primary'
        ? 'DIGITEVEN'
        : 'DIGITODD'
      : mode === 'over_under'
        ? subChoice === 'primary'
          ? 'DIGITOVER'
          : 'DIGITUNDER'
        : subChoice === 'primary'
          ? 'DIGITMATCH'
          : 'DIGITDIFF';

  const needsBarrier = mode !== 'even_odd';

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
    fetchDerivTickHistoryDirect(effectiveSymbol, sampleCount)
      .then((res) => {
        if (!cancelled) {
          setPipSize(res.pipSize || 2);
          setTickPrices(res.prices.slice(-sampleCount));
        }
      })
      .catch(() => {});

    const unsub = subscribeDerivTicksDirect(effectiveSymbol, (tick) => {
      if (cancelled) return;
      if (tick.pipSize) setPipSize(tick.pipSize);
      setTickPrices((prev) => [...prev, tick.quote].slice(-sampleCount));
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [effectiveSymbol, sampleCount]);

  useEffect(() => {
    let cancelled = false;
    setQuoteErr('');
    const t = setTimeout(() => {
      apiFetch<{ payout: number; askPrice: number }>('/deriv/proposal', {
        method: 'POST',
        body: JSON.stringify({
          symbol: effectiveSymbol,
          contractType,
          stake,
          duration: durationTicks,
          durationUnit: 't',
          ...(needsBarrier ? { barrier: selectedDigit } : {})
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
  }, [effectiveSymbol, contractType, stake, durationTicks, selectedDigit, needsBarrier]);

  const digitStats = computeDigitStats(tickPrices, pipSize);
  const currentPrice = tickPrices.length > 0 ? tickPrices[tickPrices.length - 1] : null;
  const recentDigits = tickPrices.slice(-20).map((p) => Number(p.toFixed(pipSize).slice(-1)));

  const handleBuy = async () => {
    if (!token) {
      setNotice('Please sign in to place Digits contracts.');
      return;
    }
    setPlacing(true);
    setNotice('');
    try {
      const res = await apiFetch<{ derivExecution?: { contractId: number } }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          symbol: effectiveSymbol,
          side: subChoice === 'primary' ? 'BUY' : 'SELL',
          stake,
          entryPrice: currentPrice ?? 0,
          contractType,
          duration: durationTicks,
          durationUnit: 't',
          ...(needsBarrier ? { barrier: selectedDigit } : {}),
          connectedAccountId: activeDerivAccount?.id ?? null,
          executionMode: activeDerivAccount ? 'deriv' : 'virtual'
        })
      });
      setNotice(
        res.derivExecution
          ? `Purchased ${contractType} #${res.derivExecution.contractId} on ${effectiveSymbol}.`
          : `Opened virtual ${contractType} contract on ${effectiveSymbol}.`
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

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Hash className="w-5 h-5 text-purple-600" />
            <span>Deriv Digits Terminal</span>
          </h1>
          <p className="text-xs text-slate-500">
            Even/Odd, Over/Under, and Matches/Differs with real-time last-digit frequency analytics.
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5">
          <span>Tick Window:</span>
          <select
            value={sampleCount}
            onChange={(e) => setSampleCount(Number(e.target.value))}
            className="bg-transparent font-mono font-bold focus:outline-none"
          >
            <option value={50}>50 ticks</option>
            <option value={100}>100 ticks</option>
            <option value={200}>200 ticks</option>
            <option value={500}>500 ticks</option>
            <option value={1000}>1000 ticks</option>
          </select>
        </label>
      </div>

      <div className="grid lg:grid-cols-12 gap-4 items-start">
        {/* Left: Live Digit Spot + 0-9 Distribution Bar */}
        <div className="lg:col-span-8">
          <DigitStatsPanel
            currentPrice={currentPrice}
            pipSize={pipSize}
            digitStats={digitStats}
            selectedDigit={selectedDigit}
            onDigitSelect={setSelectedDigit}
            recentDigits={recentDigits}
          />
        </div>

        {/* Right: Trade Controls */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-xs">
          <SymbolSelector value={effectiveSymbol} onChange={onSymbolChange} symbols={synthSymbols} />

          {/* Contract Category */}
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-[11px] font-bold">
            {[
              { id: 'over_under' as DigitMode, label: 'Over/Under' },
              { id: 'even_odd' as DigitMode, label: 'Even/Odd' },
              { id: 'matches_differs' as DigitMode, label: 'Match/Differs' }
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`py-2 rounded-lg transition ${
                  mode === m.id ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs' : 'text-slate-500'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Primary vs Secondary Contract Button */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSubChoice('primary')}
              className={`py-2.5 rounded-xl text-xs font-extrabold border transition ${
                subChoice === 'primary'
                  ? 'bg-[#26a69a] text-white border-[#26a69a]'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
              }`}
            >
              {mode === 'even_odd' ? 'Even' : mode === 'over_under' ? `Over ${selectedDigit}` : `Matches ${selectedDigit}`}
            </button>
            <button
              type="button"
              onClick={() => setSubChoice('secondary')}
              className={`py-2.5 rounded-xl text-xs font-extrabold border transition ${
                subChoice === 'secondary'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
              }`}
            >
              {mode === 'even_odd' ? 'Odd' : mode === 'over_under' ? `Under ${selectedDigit}` : `Differs ${selectedDigit}`}
            </button>
          </div>

          {/* Ticks & Stake */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-500">Ticks (1–10)</label>
              <input
                type="number"
                min={1}
                max={10}
                value={durationTicks}
                onChange={(e) => setDurationTicks(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-full mt-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono font-bold"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500">Stake (USD)</label>
              <input
                type="number"
                min={0.35}
                step={0.5}
                value={stake}
                onChange={(e) => setStake(Math.max(0.35, Number(e.target.value) || 1))}
                className="w-full mt-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono font-bold"
              />
            </div>
          </div>

          {/* Quote Box */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-3 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Contract</span>
              <span className="font-mono font-bold">
                {contractType}
                {needsBarrier ? ` (${selectedDigit})` : ''}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Potential Payout</span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {quote ? `${quote.payout.toFixed(2)} USD` : 'Quoting...'}
              </span>
            </div>
            {quoteErr && <div className="text-[11px] text-rose-500 pt-1">{quoteErr}</div>}
          </div>

          <button
            type="button"
            disabled={placing}
            onClick={handleBuy}
            className="w-full py-3 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-extrabold text-sm shadow-md transition"
          >
            {placing ? 'Executing...' : `Buy ${contractType} · ${stake.toFixed(2)} USD`}
          </button>

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
        contractFilter={(o) => String(o.contract_type || '').toUpperCase().startsWith('DIGIT')}
        onSell={handleSell}
        sellingId={sellingId}
      />
    </div>
  );
};
