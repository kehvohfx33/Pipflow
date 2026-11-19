import React, { useState } from 'react';

export const RiskCalculatorPage: React.FC = () => {
  const [capital, setCapital] = useState<string>('');
  const cap = Number(capital) || 0;
  const stake = cap * 0.02;
  const takeProfit = stake * 5;
  const stopLoss = stake * 15; // 1 + 2 + 4 + 8 = 15x stake (4 consecutive martingale losses)

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <div className="rounded-2xl bg-[#1e2736] text-white p-6 sm:p-8 space-y-5 shadow-2xl border border-slate-700/60">
        <h1 className="text-center text-sky-400 font-extrabold text-xl tracking-[0.14em] uppercase">
          Martingale Calculator
        </h1>

        <div className="flex items-center justify-between gap-3">
          <label className="text-xs sm:text-sm font-semibold text-slate-200 shrink-0">
            Initial Capital (USD):
          </label>
          <input
            type="number"
            min={0}
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            placeholder="Enter capital"
            className="flex-1 rounded-lg bg-[#374151] border border-slate-600 px-3 py-2 text-sm text-center text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between rounded-xl bg-[#263244] border border-slate-700/60 px-4 py-3 text-xs sm:text-sm">
            <span className="text-slate-200 font-medium">Stake (2% of Capital):</span>
            <span className="font-mono font-bold text-sky-400">{stake.toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[#263244] border border-slate-700/60 px-4 py-3 text-xs sm:text-sm">
            <span className="text-slate-200 font-medium">Take Profit (5x Stake):</span>
            <span className="font-mono font-bold text-sky-400">{takeProfit.toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[#263244] border border-slate-700/60 px-4 py-3 text-xs sm:text-sm">
            <span className="text-slate-200 font-medium">Stop Loss (4 Losses Sum):</span>
            <span className="font-mono font-bold text-sky-400">{stopLoss.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
