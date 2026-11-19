import React from 'react';

export const SplashScreen: React.FC = () => {
  return (
    <div
      className="min-h-screen bg-[#050c16] text-white flex items-center justify-center p-4"
      style={{
        backgroundImage:
          'linear-gradient(to right, rgba(30, 58, 95, 0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(30, 58, 95, 0.14) 1px, transparent 1px)',
        backgroundSize: '36px 36px'
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-800/80 bg-[#0b1523]/95 p-6 shadow-2xl space-y-5">
        <div className="flex items-center gap-3.5 justify-center">
          <img
            src="/assets/aistudio/IMG-20261115-WA0009_aca2a037.jpg"
            alt="Pipflow.site Logo"
            className="h-12 w-12 rounded-full object-cover border border-emerald-500/60 shadow-lg bg-black"
          />
          <div className="text-left">
            <div className="text-lg font-extrabold tracking-tight">
              <span className="text-indigo-400">Pipflow</span>
              <span className="text-sky-400">trades</span>
            </div>
            <div className="text-[10px] font-semibold tracking-[0.22em] text-slate-400">
              ANALYTICS • BOTS • SIGNALS
            </div>
          </div>
        </div>

        {/* Red diagonal trend chart card */}
        <div
          className="h-24 rounded-xl border border-slate-800 bg-[#08121e] relative overflow-hidden flex items-center justify-center"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(56, 189, 248, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(56, 189, 248, 0.06) 1px, transparent 1px)',
            backgroundSize: '18px 18px'
          }}
        >
          <svg viewBox="0 0 300 80" className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="splash-glow" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#fb7185" stopOpacity="1" />
              </linearGradient>
            </defs>
            <path d="M0 64 L300 18" stroke="url(#splash-glow)" strokeWidth="2.5" fill="none" />
          </svg>
        </div>

        <div className="space-y-2 text-center">
          <div className="flex items-center justify-center gap-2 text-xs text-slate-300">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-slate-600 border-t-sky-400 animate-spin" />
            <span>Initializing Pipflowtrades session...</span>
          </div>
          <div className="text-xs font-medium text-emerald-400">Preparing workspace</div>
          <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full w-4/5 rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500 animate-pulse" />
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-500 pt-1">
          © 2026 Pipflowtrades. All rights reserved.
        </p>
      </div>
    </div>
  );
};
