import React from 'react';

export interface TimeframeOption {
  label: string;
  seconds: number;
}

export const TIMEFRAME_OPTIONS: TimeframeOption[] = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '4h', seconds: 14400 },
  { label: '24h', seconds: 86400 }
];

export const TimeframesBar: React.FC<{
  granularity: number;
  onChange: (seconds: number) => void;
}> = ({ granularity, onChange }) => {
  return (
    <div className="flex items-center gap-1">
      {TIMEFRAME_OPTIONS.map((tf) => (
        <button
          key={tf.seconds}
          type="button"
          onClick={() => onChange(tf.seconds)}
          className={`px-2 py-1 rounded text-xs font-semibold transition ${
            granularity === tf.seconds
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
          }`}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
};
