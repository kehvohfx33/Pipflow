import React from 'react';

export interface IndicatorConfig {
  sma20: boolean;
  ema50: boolean;
  bollinger: boolean;
}

export const IndicatorsPanel: React.FC<{
  config: IndicatorConfig;
  onToggle: (key: keyof IndicatorConfig) => void;
}> = ({ config, onToggle }) => {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onToggle('sma20')}
        className={`px-2 py-1 rounded text-[11px] font-semibold border transition ${
          config.sma20
            ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-sky-300'
            : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
        }`}
      >
        ƒx SMA(20)
      </button>
      <button
        type="button"
        onClick={() => onToggle('ema50')}
        className={`px-2 py-1 rounded text-[11px] font-semibold border transition ${
          config.ema50
            ? 'border-amber-600 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
            : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
        }`}
      >
        ƒx EMA(50)
      </button>
      <button
        type="button"
        onClick={() => onToggle('bollinger')}
        className={`px-2 py-1 rounded text-[11px] font-semibold border transition ${
          config.bollinger
            ? 'border-purple-600 bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300'
            : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
        }`}
      >
        ƒx BB(20,2)
      </button>
    </div>
  );
};
