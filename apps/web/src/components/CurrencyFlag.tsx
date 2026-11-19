import React from 'react';

interface CurrencyFlagProps {
  currency: 'USD' | 'KSH';
  className?: string;
}

export const CurrencyFlag: React.FC<CurrencyFlagProps> = ({ currency, className = 'w-7 h-7' }) => {
  if (currency === 'KSH') {
    return (
      <svg
        viewBox="0 0 64 64"
        className={`${className} rounded-full shrink-0 border border-slate-200 dark:border-slate-700 shadow-xs`}
        role="img"
        aria-label="Kenyan Shilling Flag"
      >
        <defs>
          <clipPath id="ke-flag-clip">
            <circle cx="32" cy="32" r="32" />
          </clipPath>
        </defs>
        <g clipPath="url(#ke-flag-clip)">
          <rect x="0" y="0" width="64" height="19" fill="#0b0b0b" />
          <rect x="0" y="19" width="64" height="3.5" fill="#ffffff" />
          <rect x="0" y="22.5" width="64" height="19" fill="#bb0000" />
          <rect x="0" y="41.5" width="64" height="3.5" fill="#ffffff" />
          <rect x="0" y="45" width="64" height="19" fill="#006600" />
          {/* Crossed white Maasai spears */}
          <line x1="21" y1="49" x2="43" y2="15" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="43" y1="49" x2="21" y2="15" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
          {/* Maasai shield */}
          <ellipse cx="32" cy="32" rx="7.2" ry="13.5" fill="#bb0000" stroke="#ffffff" strokeWidth="1.2" />
          <path d="M27.5 22.5 Q24.8 32 27.5 41.5 Z" fill="#0b0b0b" />
          <path d="M36.5 22.5 Q39.2 32 36.5 41.5 Z" fill="#0b0b0b" />
          <ellipse cx="32" cy="32" rx="1.6" ry="3.2" fill="#ffffff" />
          <rect x="31.3" y="20" width="1.4" height="8" fill="#ffffff" />
          <rect x="31.3" y="36" width="1.4" height="8" fill="#ffffff" />
        </g>
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 64 64"
      className={`${className} rounded-full shrink-0 border border-slate-200 dark:border-slate-700 shadow-xs`}
      role="img"
      aria-label="US Dollar Flag"
    >
      <defs>
        <clipPath id="us-flag-clip">
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath="url(#us-flag-clip)">
        <rect x="0" y="0" width="64" height="64" fill="#ffffff" />
        {[0, 2, 4, 6, 8, 10, 12].map((i) => (
          <rect key={i} x="0" y={i * (64 / 13)} width="64" height={64 / 13} fill="#d22730" />
        ))}
        <rect x="0" y="0" width="30" height={34.5} fill="#0a3161" />
        {[
          [6, 6], [13, 6], [20, 6], [26, 6],
          [9.5, 11.5], [16.5, 11.5], [23.5, 11.5],
          [6, 17], [13, 17], [20, 17], [26, 17],
          [9.5, 22.5], [16.5, 22.5], [23.5, 22.5],
          [6, 28], [13, 28], [20, 28], [26, 28]
        ].map(([cx, cy], idx) => (
          <circle key={idx} cx={cx} cy={cy} r="1.4" fill="#ffffff" />
        ))}
      </g>
    </svg>
  );
};
