import React from 'react';
import { BookOpen, Shield, TrendingUp, Activity } from 'lucide-react';

export const LearningPage: React.FC = () => {
  const modules = [
    {
      icon: TrendingUp,
      title: '01. MT5 Take Profit & Stop Loss Discipline',
      summary: 'Learn how to place Stop Loss below key swing lows and Take Profit at measured risk-to-reward ratios (1:2 or 1:3) directly on the TradingView terminal.'
    },
    {
      icon: Activity,
      title: '02. Deriv Synthetic Indices & Volatility Feeds',
      summary: 'Understand Volatility 25, 50, 75, 100, and 1-second (1HZ) indices streamed in real time via the Official Deriv WebSocket API.'
    },
    {
      icon: Shield,
      title: '03. Martingale & Drawdown Capital Protection',
      summary: 'Use the Risk Calculator to cap single-trade exposure at 2% of capital and pre-compute 4-loss recovery thresholds before running automated strategies.'
    },
    {
      icon: BookOpen,
      title: '04. Read-Only API Authorization & Token Hygiene',
      summary: 'PIPFLOW encrypts user-owned read-only tokens with AES-256-GCM. Never share write/trade tokens with third parties or expose credentials in browser storage.'
    }
  ];

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6">
        <h1 className="text-xl font-extrabold">PIPFLOW Trading &amp; Risk Learning Hub</h1>
        <p className="text-xs text-slate-500 mt-1">
          Practical documentation on market structure, technical indicators, and safe Deriv API workflows.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {modules.map((m) => (
          <div
            key={m.title}
            className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-2.5"
          >
            <m.icon className="w-5 h-5 text-blue-600 dark:text-sky-400" />
            <h2 className="font-bold text-sm">{m.title}</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{m.summary}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
