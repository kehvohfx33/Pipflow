import React from 'react';

export interface DigitStatsData {
  counts: number[];
  percentages: number[];
  totalTicks: number;
  evenPct: number;
  oddPct: number;
}

export function computeDigitStats(prices: number[], pipSize = 2): DigitStatsData {
  const counts = Array.from({ length: 10 }, () => 0);
  let even = 0;
  let odd = 0;

  for (const p of prices) {
    const fixed = Number(p).toFixed(Math.max(0, pipSize));
    const ch = fixed.slice(-1);
    const d = Number(ch);
    if (Number.isInteger(d) && d >= 0 && d <= 9) {
      counts[d] += 1;
      if (d % 2 === 0) even += 1;
      else odd += 1;
    }
  }

  const totalTicks = prices.length;
  const percentages = counts.map((c) => (totalTicks > 0 ? Number(((c / totalTicks) * 100).toFixed(1)) : 0));
  return {
    counts,
    percentages,
    totalTicks,
    evenPct: totalTicks > 0 ? Number(((even / totalTicks) * 100).toFixed(1)) : 50,
    oddPct: totalTicks > 0 ? Number(((odd / totalTicks) * 100).toFixed(1)) : 50
  };
}

interface DigitStatsPanelProps {
  currentPrice: number | null;
  pipSize?: number;
  digitStats: DigitStatsData;
  selectedDigit: number;
  onDigitSelect: (digit: number) => void;
  recentDigits?: number[];
}

export const DigitStatsPanel: React.FC<DigitStatsPanelProps> = ({
  currentPrice,
  pipSize = 2,
  digitStats,
  selectedDigit,
  onDigitSelect,
  recentDigits = []
}) => {
  const formattedPrice = currentPrice !== null && currentPrice > 0 ? currentPrice.toFixed(pipSize) : '---';
  const prefix = formattedPrice === '---' ? '---' : formattedPrice.slice(0, -1);
  const lastChar = formattedPrice === '---' ? '-' : formattedPrice.slice(-1);
  const maxPct = Math.max(...digitStats.percentages);
  const minPct = Math.min(...digitStats.percentages);

  return (
    <div className="space-y-4">
      {/* Live Current Spot + Highlighted Last Digit */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-center space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Live Spot &amp; Last Digit</div>
        <div className="text-3xl sm:text-4xl font-mono font-extrabold tracking-tight">
          <span className="text-slate-800 dark:text-slate-100">{prefix}</span>
          <span className="text-blue-600 dark:text-sky-400 text-4xl sm:text-5xl underline decoration-2 underline-offset-4">
            {lastChar}
          </span>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Last Digit:</span>
          <span className="w-7 h-7 rounded-full bg-blue-600 text-white font-mono font-extrabold inline-flex items-center justify-center">
            {lastChar}
          </span>
        </div>

        {recentDigits.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-1 pt-2">
            {recentDigits.slice(-20).map((d, idx) => (
              <span
                key={`${idx}-${d}`}
                className={`w-6 h-6 rounded-md font-mono text-xs font-bold inline-flex items-center justify-center border ${
                  d === selectedDigit
                    ? 'bg-blue-600 text-white border-blue-500'
                    : d % 2 === 0
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
                }`}
              >
                {d}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Interactive 0-9 Digit Prediction Grid (from digits-no-chart-app) */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-700 dark:text-slate-200">
            Last Digit Prediction &amp; Distribution ({digitStats.totalTicks} ticks)
          </span>
          <span className="text-[11px] font-mono text-slate-400">
            Even {digitStats.evenPct}% · Odd {digitStats.oddPct}%
          </span>
        </div>

        <div className="grid grid-cols-5 gap-2 sm:gap-3">
          {digitStats.percentages.map((pct, digit) => {
            const isSelected = digit === selectedDigit;
            const isHighest = digitStats.totalTicks > 0 && pct === maxPct;
            const isLowest = digitStats.totalTicks > 0 && pct === minPct;
            return (
              <button
                key={digit}
                type="button"
                onClick={() => onDigitSelect(digit)}
                className={`flex flex-col items-center justify-center rounded-xl py-2.5 px-1 border transition ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md ring-2 ring-blue-400/40'
                    : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                }`}
              >
                <span className="text-lg sm:text-xl font-mono font-extrabold">{digit}</span>
                <span
                  className={`text-[11px] font-mono font-semibold ${
                    isSelected
                      ? 'text-blue-100'
                      : isHighest
                        ? 'text-emerald-500'
                        : isLowest
                          ? 'text-rose-500'
                          : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {pct.toFixed(1)}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
