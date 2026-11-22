import React from 'react';
import { Minus, Plus, Layers, XCircle } from 'lucide-react';

export type SlTpUnit = 'Price' | 'USD' | 'Percent' | 'Pips';
export type OrderTicketMode = 'MT5' | 'OVER_UNDER' | 'RISE_FALL';

export interface VirtualOrderItem {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  stake: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  exit_price: number | null;
  pnl: number;
  status: string;
  source: string;
  bot_name?: string | null;
  deriv_contract_id?: number | null;
  execution_mode?: string | null;
  contract_type?: string | null;
  payout?: number | null;
  opened_at?: string;
  closed_at?: string | null;
}

export interface ResolvedTarget {
  active: boolean;
  price: number | null;
  usd: number | null;
  pctOfStake: number | null;
  pctPrice: number | null;
  pips: number | null;
}

export function getPipSize(symbol: string, price: number): number {
  const upper = symbol.toUpperCase();
  if (upper.includes('JPY') || upper.includes('XAU') || price >= 20) {
    return 0.01;
  }
  return 0.0001;
}

export function getPriceDecimals(symbol: string, price: number): number {
  const upper = symbol.toUpperCase();
  if (upper.includes('JPY') || upper.includes('XAU') || price >= 100) {
    return 3;
  }
  return 4;
}

export function resolveSlTpTarget(params: {
  enabled: boolean;
  rawValue: string;
  unit: SlTpUnit;
  kind: 'SL' | 'TP';
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stake: number;
  multiplier: number;
  symbol: string;
}): ResolvedTarget {
  const { enabled, rawValue, unit, kind, side, entryPrice, stake, multiplier, symbol } = params;
  if (!enabled || entryPrice <= 0 || stake <= 0 || multiplier <= 0) {
    return { active: false, price: null, usd: null, pctOfStake: null, pctPrice: null, pips: null };
  }

  const parsed = parseFloat(rawValue);
  if (!Number.isFinite(parsed) || parsed === 0) {
    return { active: false, price: null, usd: null, pctOfStake: null, pctPrice: null, pips: null };
  }

  const pipSize = getPipSize(symbol, entryPrice);
  let usdMag = 0;
  let targetPrice = entryPrice;

  if (unit === 'USD') {
    usdMag = Math.abs(parsed);
    const pctMove = usdMag / (stake * multiplier);
    const delta = entryPrice * pctMove;
    targetPrice =
      kind === 'SL'
        ? side === 'BUY'
          ? entryPrice - delta
          : entryPrice + delta
        : side === 'BUY'
          ? entryPrice + delta
          : entryPrice - delta;
  } else if (unit === 'Percent') {
    const pctStake = Math.abs(parsed);
    usdMag = (pctStake / 100) * stake;
    const pctMove = usdMag / (stake * multiplier);
    const delta = entryPrice * pctMove;
    targetPrice =
      kind === 'SL'
        ? side === 'BUY'
          ? entryPrice - delta
          : entryPrice + delta
        : side === 'BUY'
          ? entryPrice + delta
          : entryPrice - delta;
  } else if (unit === 'Pips') {
    const delta = Math.abs(parsed) * pipSize;
    targetPrice =
      kind === 'SL'
        ? side === 'BUY'
          ? entryPrice - delta
          : entryPrice + delta
        : side === 'BUY'
          ? entryPrice + delta
          : entryPrice - delta;
    usdMag = stake * (delta / entryPrice) * multiplier;
  } else {
    targetPrice = parsed;
    const delta = Math.abs(targetPrice - entryPrice);
    usdMag = stake * (delta / entryPrice) * multiplier;
  }

  const pips = Math.abs(targetPrice - entryPrice) / pipSize;
  const pctOfStake = (usdMag / stake) * 100;
  const pctPrice = (Math.abs(targetPrice - entryPrice) / entryPrice) * 100;

  return {
    active: true,
    price: Number(Math.max(0.0001, targetPrice).toFixed(getPriceDecimals(symbol, entryPrice))),
    usd: Number(usdMag.toFixed(2)),
    pctOfStake: Number(pctOfStake.toFixed(2)),
    pctPrice: Number(pctPrice.toFixed(2)),
    pips: Number(pips.toFixed(1))
  };
}

function formatConvertedInput(
  resolved: ResolvedTarget,
  nextUnit: SlTpUnit,
  kind: 'SL' | 'TP',
  symbol: string,
  entryPrice: number,
  stake: number
): string {
  if (!resolved.active) {
    if (nextUnit === 'USD') return kind === 'SL' ? `-${Math.max(1, stake * 0.5).toFixed(2)}` : `${(stake * 1.5).toFixed(2)}`;
    if (nextUnit === 'Percent') return kind === 'SL' ? '50.0' : '150.0';
    if (nextUnit === 'Pips') return kind === 'SL' ? '50.0' : '150.0';
    return entryPrice > 0
      ? (entryPrice * (kind === 'SL' ? 0.995 : 1.005)).toFixed(getPriceDecimals(symbol, entryPrice))
      : '';
  }

  if (nextUnit === 'USD' && resolved.usd !== null) {
    return kind === 'SL' ? `-${resolved.usd.toFixed(2)}` : resolved.usd.toFixed(2);
  }
  if (nextUnit === 'Percent' && resolved.pctOfStake !== null) {
    return resolved.pctOfStake.toFixed(1);
  }
  if (nextUnit === 'Pips' && resolved.pips !== null) {
    return resolved.pips.toFixed(1);
  }
  if (nextUnit === 'Price' && resolved.price !== null) {
    return resolved.price.toFixed(getPriceDecimals(symbol, entryPrice));
  }
  return '';
}

interface OrderTicketProps {
  symbol: string;
  latestPrice: number;
  stake: number;
  setStake: (v: number) => void;
  lotSize: number;
  setLotSize: (lots: number) => void;
  orderMode: OrderTicketMode;
  setOrderMode: (m: OrderTicketMode) => void;
  digitPrediction: number;
  setDigitPrediction: (d: number) => void;
  durationTicks: number;
  setDurationTicks: (t: number) => void;
  bulkCount: number;
  setBulkCount: (n: number) => void;
  multiplier: number;
  setMultiplier: (v: number) => void;
  previewSide: 'BUY' | 'SELL';
  setPreviewSide: (s: 'BUY' | 'SELL') => void;
  slEnabled: boolean;
  setSlEnabled: (v: boolean) => void;
  tpEnabled: boolean;
  setTpEnabled: (v: boolean) => void;
  slUnit: SlTpUnit;
  setSlUnit: (u: SlTpUnit) => void;
  tpUnit: SlTpUnit;
  setTpUnit: (u: SlTpUnit) => void;
  slInput: string;
  setSlInput: (v: string) => void;
  tpInput: string;
  setTpInput: (v: string) => void;
  onPlaceOrder: (side: 'BUY' | 'SELL', customContractType?: string) => Promise<void>;
  onBulkClose?: (filter: 'all' | 'profitable' | 'losing' | 'buy' | 'sell' | 'over' | 'under') => Promise<void>;
  placingSide?: 'BUY' | 'SELL' | null;
  openOrders: VirtualOrderItem[];
  onCloseOrder: (id: string) => Promise<void>;
  authenticated: boolean;
  error: string;
  accountLabel?: string;
}

export const OrderTicket: React.FC<OrderTicketProps> = ({
  symbol,
  latestPrice,
  stake,
  setStake,
  lotSize,
  setLotSize,
  orderMode,
  setOrderMode,
  digitPrediction,
  setDigitPrediction,
  durationTicks,
  setDurationTicks,
  bulkCount,
  setBulkCount,
  multiplier,
  setMultiplier,
  previewSide,
  setPreviewSide,
  slEnabled,
  setSlEnabled,
  tpEnabled,
  setTpEnabled,
  slUnit,
  setSlUnit,
  tpUnit,
  setTpUnit,
  slInput,
  setSlInput,
  tpInput,
  setTpInput,
  onPlaceOrder,
  onBulkClose,
  placingSide = null,
  openOrders,
  onCloseOrder,
  authenticated,
  error,
  accountLabel
}) => {
  const decimals = getPriceDecimals(symbol, latestPrice);
  const pipSize = getPipSize(symbol, latestPrice);
  const spread = latestPrice > 0 ? Math.max(pipSize * 1.2, latestPrice * 0.00025) : 0;
  const bidPrice = latestPrice;
  const askPrice = latestPrice > 0 ? latestPrice + spread : 0;

  const updateByLots = (nextLots: number) => {
    const clampedLots = Math.max(0.01, Math.min(100, Number(nextLots.toFixed(2))));
    setLotSize(clampedLots);
    setStake(Math.max(1, Number((clampedLots * 100).toFixed(2))));
  };

  const updateByStake = (nextStake: number) => {
    const clampedStake = Math.max(0.5, Number(nextStake.toFixed(2)));
    setStake(clampedStake);
    setLotSize(Math.max(0.01, Number((clampedStake / 100).toFixed(2))));
  };

  const slResolved = resolveSlTpTarget({
    enabled: slEnabled,
    rawValue: slInput,
    unit: slUnit,
    kind: 'SL',
    side: previewSide,
    entryPrice: latestPrice,
    stake,
    multiplier,
    symbol
  });

  const tpResolved = resolveSlTpTarget({
    enabled: tpEnabled,
    rawValue: tpInput,
    unit: tpUnit,
    kind: 'TP',
    side: previewSide,
    entryPrice: latestPrice,
    stake,
    multiplier,
    symbol
  });

  const slExceedsMax = slResolved.active && slResolved.usd !== null && slResolved.usd >= stake;
  const rrRatio =
    slResolved.active &&
    tpResolved.active &&
    slResolved.usd &&
    tpResolved.usd &&
    slResolved.usd > 0
      ? (tpResolved.usd / slResolved.usd).toFixed(1)
      : null;

  const stepValue = (kind: 'SL' | 'TP', dir: -1 | 1) => {
    const unit = kind === 'SL' ? slUnit : tpUnit;
    const raw = kind === 'SL' ? slInput : tpInput;
    const setter = kind === 'SL' ? setSlInput : setTpInput;
    const curr = parseFloat(raw) || 0;

    if (unit === 'USD') {
      const step = stake >= 20 ? 1 : 0.5;
      if (kind === 'SL') {
        const nextMag = Math.max(0.5, Math.min(stake, Math.abs(curr) - dir * step));
        setter(`-${nextMag.toFixed(2)}`);
      } else {
        const nextVal = Math.max(0.5, curr + dir * step);
        setter(nextVal.toFixed(2));
      }
      return;
    }

    if (unit === 'Percent') {
      const next = Math.max(1, curr + dir * 5);
      setter((kind === 'SL' ? Math.min(99, next) : next).toFixed(1));
      return;
    }

    if (unit === 'Pips') {
      const next = Math.max(0.5, curr + dir * 5);
      setter(next.toFixed(1));
      return;
    }

    const base = curr > 0 ? curr : latestPrice;
    const step = pipSize * 10;
    setter(Math.max(0.0001, base + dir * step).toFixed(decimals));
  };

  const applyRrPreset = (ratio: number) => {
    const baseRiskUsd = slResolved.active && slResolved.usd ? slResolved.usd : Math.max(1, stake * 0.5);
    if (!slEnabled) {
      setSlEnabled(true);
      if (slUnit === 'USD') setSlInput(`-${baseRiskUsd.toFixed(2)}`);
    }
    setTpEnabled(true);
    const targetUsd = baseRiskUsd * ratio;
    const syntheticTarget: ResolvedTarget = {
      active: true,
      usd: Number(targetUsd.toFixed(2)),
      pctOfStake: Number(((targetUsd / Math.max(1, stake)) * 100).toFixed(2)),
      pctPrice: latestPrice > 0 ? Number(((targetUsd / (stake * multiplier)) * 100).toFixed(2)) : 0,
      pips:
        latestPrice > 0
          ? Number(((latestPrice * (targetUsd / (stake * multiplier))) / pipSize).toFixed(1))
          : 0,
      price:
        latestPrice > 0
          ? Number(
              (
                latestPrice *
                (previewSide === 'BUY'
                  ? 1 + targetUsd / (stake * multiplier)
                  : 1 - targetUsd / (stake * multiplier))
              ).toFixed(decimals)
            )
          : null
    };
    setTpInput(formatConvertedInput(syntheticTarget, tpUnit, 'TP', symbol, latestPrice, stake));
  };

  const handleSlUnitChange = (nextUnit: SlTpUnit) => {
    setSlInput(formatConvertedInput(slResolved, nextUnit, 'SL', symbol, latestPrice, stake));
    setSlUnit(nextUnit);
  };

  const handleTpUnitChange = (nextUnit: SlTpUnit) => {
    setTpInput(formatConvertedInput(tpResolved, nextUnit, 'TP', symbol, latestPrice, stake));
    setTpUnit(nextUnit);
  };

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#141a23] p-3.5 space-y-3 text-slate-900 dark:text-slate-100">
      {/* Account & Bid/Ask Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-sky-400 truncate">
          2. Place Trade · {accountLabel || 'Order Ticket'}
        </span>
        <span className="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
          {bidPrice > 0 ? `${bidPrice.toFixed(decimals)} / ${askPrice.toFixed(decimals)}` : symbol}
        </span>
      </div>

      {/* Order Mode Tabs */}
      <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-[#1b232e] text-[11px] font-bold">
        {[
          { id: 'MT5' as OrderTicketMode, label: 'MT5 Buy/Sell' },
          { id: 'OVER_UNDER' as OrderTicketMode, label: 'Over / Under' },
          { id: 'RISE_FALL' as OrderTicketMode, label: 'Rise / Fall' }
        ].map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setOrderMode(m.id)}
            className={`py-1.5 rounded-md transition ${
              orderMode === m.id
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* MT5 Volume (Lots) & Synced Stake */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-700 dark:text-slate-300">Trade Size (Lots)</span>
          <div className="flex items-center gap-1">
            {[0.01, 0.05, 0.1, 0.5, 1.0].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => updateByLots(preset)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                  Math.abs(lotSize - preset) < 0.001
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {preset.toFixed(2)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1b232e] overflow-hidden">
          <button
            type="button"
            onClick={() => updateByLots(lotSize - (lotSize >= 1 ? 0.1 : 0.01))}
            className="px-3 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition"
            aria-label="Decrease lot size"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <input
            type="number"
            min={0.01}
            max={100}
            step={0.01}
            value={lotSize}
            onChange={(e) => updateByLots(Number(e.target.value) || 0.01)}
            className="w-full bg-transparent text-center text-sm font-mono font-bold tabular-nums focus:outline-none py-1.5"
          />
          <button
            type="button"
            onClick={() => updateByLots(lotSize + (lotSize >= 1 ? 0.1 : 0.01))}
            className="px-3 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition"
            aria-label="Increase lot size"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Margin / Stake (USD) + Batch Orders Count */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Margin / Stake (USD)
            </label>
            <input
              type="number"
              min={0.5}
              step={1}
              value={stake}
              onChange={(e) => updateByStake(Number(e.target.value) || 1)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1b232e] px-2.5 py-1.5 font-mono font-bold text-xs tabular-nums focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
              <Layers className="w-3 h-3" /> Bulk Orders
            </label>
            <select
              value={bulkCount}
              onChange={(e) => setBulkCount(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1b232e] px-2.5 py-1.5 font-mono font-bold text-xs focus:outline-none"
            >
              <option value={1}>1 Position (Single)</option>
              <option value={2}>2 Positions (Bulk)</option>
              <option value={3}>3 Positions (Bulk)</option>
              <option value={5}>5 Positions (Bulk)</option>
              <option value={10}>10 Positions (Bulk)</option>
            </select>
          </div>
        </div>

        {orderMode === 'MT5' ? (
          <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            <span>Exposure: ${(stake * multiplier).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
            <div className="flex items-center gap-1">
              {[50, 100, 200, 400].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMultiplier(m)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                    multiplier === m
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  x{m}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-xs">
            {orderMode === 'OVER_UNDER' && (
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Barrier Digit (0–9)
                </label>
                <select
                  value={digitPrediction}
                  onChange={(e) => setDigitPrediction(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1b232e] px-2.5 py-1.5 font-mono font-bold text-xs"
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                    <option key={d} value={d}>
                      Digit {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={orderMode === 'RISE_FALL' ? 'col-span-2' : ''}>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Duration (Ticks)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={durationTicks}
                onChange={(e) => setDurationTicks(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1b232e] px-2.5 py-1.5 font-mono font-bold text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {/* RR Ratio Bar & SL/TP Sections for MT5 Market */}
      {orderMode === 'MT5' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-semibold text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                RR {rrRatio ? `1:${rrRatio}` : '—'}
              </span>
              {[
                { label: '1:1', ratio: 1 },
                { label: '1:1.5', ratio: 1.5 },
                { label: '1:2', ratio: 2 }
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyRrPreset(preset.ratio)}
                  className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-200 transition"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="inline-flex rounded-md bg-slate-100 dark:bg-slate-800 p-0.5 text-[10px] font-bold">
              <button
                type="button"
                onClick={() => setPreviewSide('BUY')}
                className={`px-2 py-0.5 rounded transition ${
                  previewSide === 'BUY' ? 'bg-blue-600 text-white' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => setPreviewSide('SELL')}
                className={`px-2 py-0.5 rounded transition ${
                  previewSide === 'SELL' ? 'bg-rose-600 text-white' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                SELL
              </button>
            </div>
          </div>

          {/* Stop Loss */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Stop Loss <span className="text-[10px] font-normal text-slate-400">(Max Loss Limit)</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={slEnabled}
                onClick={() => setSlEnabled(!slEnabled)}
                className={`w-9 h-5 rounded-full transition p-0.5 ${
                  slEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                    slEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {slEnabled && (
              <>
                <div className="flex items-stretch gap-1.5">
                  <div
                    className={`flex-1 flex items-center rounded-lg border bg-slate-50 dark:bg-[#1b232e] overflow-hidden ${
                      slExceedsMax
                        ? 'border-rose-500 ring-1 ring-rose-500/40'
                        : 'border-rose-400/70 dark:border-rose-500/70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => stepValue('SL', -1)}
                      className="px-2.5 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition"
                      aria-label="Step Stop Loss down"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={slInput}
                      onChange={(e) => setSlInput(e.target.value)}
                      placeholder={slUnit === 'USD' ? `-${(stake * 0.5).toFixed(2)}` : 'SL'}
                      className="w-full min-w-0 bg-transparent text-center text-xs font-mono font-bold tabular-nums focus:outline-none py-1.5 px-1"
                    />
                    <button
                      type="button"
                      onClick={() => stepValue('SL', 1)}
                      className="px-2.5 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition"
                      aria-label="Step Stop Loss up"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <select
                    value={slUnit}
                    onChange={(e) => handleSlUnitChange(e.target.value as SlTpUnit)}
                    aria-label="Stop Loss unit"
                    className="w-28 shrink-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-[#1b232e] px-2 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none"
                  >
                    <option value="Price">Price</option>
                    <option value="USD">USD</option>
                    <option value="Percent">Loss in %</option>
                    <option value="Pips">Pips</option>
                  </select>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono tabular-nums">
                  <span className={slExceedsMax ? 'text-rose-500 font-semibold' : 'text-rose-500/80'}>
                    Max -{stake.toFixed(2)} USD
                  </span>
                  {slResolved.active && slResolved.price !== null && (
                    <span className="text-slate-500 dark:text-slate-400">
                      {slResolved.price.toFixed(decimals)} | -{slResolved.pctOfStake?.toFixed(1)}% |{' '}
                      {slResolved.pips?.toFixed(1)} pips
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Take Profit */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Take Profit <span className="text-[10px] font-normal text-slate-400">(Auto-Close Target)</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={tpEnabled}
                onClick={() => setTpEnabled(!tpEnabled)}
                className={`w-9 h-5 rounded-full transition p-0.5 ${
                  tpEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                    tpEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {tpEnabled && (
              <>
                <div className="flex items-stretch gap-1.5">
                  <div className="flex-1 flex items-center rounded-lg border border-emerald-400/70 dark:border-emerald-500/60 bg-slate-50 dark:bg-[#1b232e] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => stepValue('TP', -1)}
                      className="px-2.5 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition"
                      aria-label="Step Take Profit down"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={tpInput}
                      onChange={(e) => setTpInput(e.target.value)}
                      placeholder={tpUnit === 'USD' ? `${(stake * 1.5).toFixed(2)}` : 'TP'}
                      className="w-full min-w-0 bg-transparent text-center text-xs font-mono font-bold tabular-nums focus:outline-none py-1.5 px-1"
                    />
                    <button
                      type="button"
                      onClick={() => stepValue('TP', 1)}
                      className="px-2.5 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition"
                      aria-label="Step Take Profit up"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <select
                    value={tpUnit}
                    onChange={(e) => handleTpUnitChange(e.target.value as SlTpUnit)}
                    aria-label="Take Profit unit"
                    className="w-28 shrink-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-[#1b232e] px-2 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none"
                  >
                    <option value="Price">Price</option>
                    <option value="USD">USD</option>
                    <option value="Percent">Profit in %</option>
                    <option value="Pips">Pips</option>
                  </select>
                </div>

                {tpResolved.active && tpResolved.price !== null && (
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      +{tpResolved.usd?.toFixed(2)} USD
                    </span>
                    <span>
                      {tpResolved.price.toFixed(decimals)} | +{tpResolved.pctOfStake?.toFixed(1)}% |{' '}
                      {tpResolved.pips?.toFixed(1)} pips
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 px-2.5 py-1.5 text-[11px] text-rose-600 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Dual Execution Buttons */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          disabled={!authenticated || latestPrice <= 0 || placingSide !== null}
          onClick={() =>
            onPlaceOrder(
              'SELL',
              orderMode === 'OVER_UNDER' ? 'DIGITUNDER' : orderMode === 'RISE_FALL' ? 'PUT' : undefined
            )
          }
          className="rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white py-2.5 px-2 font-bold text-xs transition flex flex-col items-center justify-center gap-0.5"
        >
          <span>
            {placingSide === 'SELL'
              ? `Placing ${bulkCount > 1 ? `${bulkCount}x ` : ''}...`
              : orderMode === 'OVER_UNDER'
                ? `${bulkCount > 1 ? `${bulkCount}x ` : ''}UNDER ${digitPrediction}`
                : orderMode === 'RISE_FALL'
                  ? `${bulkCount > 1 ? `${bulkCount}x ` : ''}FALL (Drops)`
                  : `${bulkCount > 1 ? `${bulkCount}x ` : ''}SELL (${lotSize.toFixed(2)} lots)`}
          </span>
          <span className="text-[10px] font-mono font-normal opacity-90">
            {orderMode === 'MT5' ? 'Price Down · ' : ''}
            {bidPrice > 0 ? bidPrice.toFixed(decimals) : '—'}
          </span>
        </button>

        <button
          type="button"
          disabled={!authenticated || latestPrice <= 0 || placingSide !== null}
          onClick={() =>
            onPlaceOrder(
              'BUY',
              orderMode === 'OVER_UNDER' ? 'DIGITOVER' : orderMode === 'RISE_FALL' ? 'CALL' : undefined
            )
          }
          className="rounded-lg bg-[#1d6ae5] hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 px-2 font-bold text-xs transition flex flex-col items-center justify-center gap-0.5"
        >
          <span>
            {placingSide === 'BUY'
              ? `Placing ${bulkCount > 1 ? `${bulkCount}x ` : ''}...`
              : orderMode === 'OVER_UNDER'
                ? `${bulkCount > 1 ? `${bulkCount}x ` : ''}OVER ${digitPrediction}`
                : orderMode === 'RISE_FALL'
                  ? `${bulkCount > 1 ? `${bulkCount}x ` : ''}RISE (Goes Up)`
                  : `${bulkCount > 1 ? `${bulkCount}x ` : ''}BUY (${lotSize.toFixed(2)} lots)`}
          </span>
          <span className="text-[10px] font-mono font-normal opacity-90">
            {orderMode === 'MT5' ? 'Price Up · ' : ''}
            {askPrice > 0 ? askPrice.toFixed(decimals) : '—'}
          </span>
        </button>
      </div>

      {!authenticated && (
        <p className="text-[11px] text-slate-500">Sign in to execute live Deriv or virtual MT5 positions.</p>
      )}

      {openOrders.length > 0 && (
        <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 space-y-2">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase">
              Open ({openOrders.length})
            </span>
            {onBulkClose && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onBulkClose('profitable')}
                  className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold"
                >
                  +Profit
                </button>
                <button
                  type="button"
                  onClick={() => onBulkClose('losing')}
                  className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 text-[10px] font-semibold"
                >
                  -Loss
                </button>
                <button
                  type="button"
                  onClick={() => onBulkClose('all')}
                  className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 text-[10px] font-semibold inline-flex items-center gap-0.5"
                >
                  <XCircle className="w-2.5 h-2.5" /> All
                </button>
              </div>
            )}
          </div>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {openOrders.slice(0, 12).map((o) => {
              const entry = Number(o.entry_price);
              const pct = o.side === 'BUY' ? (latestPrice - entry) / entry : (entry - latestPrice) / entry;
              const livePnl =
                o.symbol === symbol && latestPrice > 0
                  ? Number((Number(o.stake) * pct * multiplier).toFixed(2))
                  : 0;
              return (
                <div
                  key={o.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 p-2 text-[11px] flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-bold truncate">
                      <span className={o.side === 'BUY' ? 'text-blue-600' : 'text-rose-600'}>{o.side}</span>{' '}
                      {o.symbol}{' '}
                      <span className="text-[10px] font-mono text-slate-400">
                        {(Number(o.stake) / 100).toFixed(2)} lots
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-slate-500">
                      Entry {entry.toFixed(2)} · SL {o.stop_loss ? Number(o.stop_loss).toFixed(2) : '-'} · TP{' '}
                      {o.take_profit ? Number(o.take_profit).toFixed(2) : '-'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-mono font-bold ${livePnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {livePnl >= 0 ? '+' : ''}
                      {livePnl.toFixed(2)}
                    </div>
                    <button
                      type="button"
                      onClick={() => onCloseOrder(o.id)}
                      className="text-[10px] text-rose-600 hover:underline font-semibold"
                    >
                      Close
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
