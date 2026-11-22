import React, { useEffect, useRef, useState } from 'react';
import { createChart, AreaSeries, Time } from 'lightweight-charts';
import { Folder, Bot, Puzzle, Zap, PackageOpen } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';
import { VirtualOrderItem } from '../../components/trading/OrderTicket';

interface DashboardPageProps {
  onSelectTab: (tab: string) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onSelectTab }) => {
  const { token, user, currency, branding, darkTheme, orderVersion } = useAuth();
  const [subTab, setSubTab] = useState<'summary' | 'transactions' | 'journal'>('summary');
  const [orders, setOrders] = useState<VirtualOrderItem[]>([]);
  const progressChartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ orders?: VirtualOrderItem[] }>('/orders')
      .then((res) => setOrders(Array.isArray(res?.orders) ? res.orders : []))
      .catch(() => {});
  }, [token, orderVersion]);

  const safeOrders = Array.isArray(orders) ? orders : [];
  const greetingId = user?.full_name || user?.email?.split('@')[0] || 'Trader';
  const rate = currency === 'KSH' ? branding.kesRate : 1;
  const prefix = currency === 'KSH' ? 'KSH ' : '$';

  const totalStake = safeOrders.reduce((s, o) => s + Number(o.stake), 0);
  const closed = safeOrders.filter((o) => o.status !== 'OPEN');
  const won = closed.filter((o) => Number(o.pnl) > 0);
  const lost = closed.filter((o) => Number(o.pnl) < 0);
  const totalPnl = closed.reduce((s, o) => s + Number(o.pnl), 0);
  const totalPayout = closed.reduce((s, o) => s + Number(o.stake) + Number(o.pnl), 0);

  useEffect(() => {
    if (subTab !== 'summary') return;
    const el = progressChartRef.current;
    if (!el || safeOrders.length === 0) return;

    const chart = createChart(el, {
      width: Math.max(240, el.clientWidth || 320),
      height: 180,
      layout: {
        background: { color: darkTheme ? '#0f172a' : '#f8fafc' },
        textColor: darkTheme ? '#94a3b8' : '#475569'
      },
      grid: {
        vertLines: { color: darkTheme ? '#1e293b' : '#e2e8f0' },
        horzLines: { color: darkTheme ? '#1e293b' : '#e2e8f0' }
      },
      timeScale: { timeVisible: true, secondsVisible: false }
    });

    const chronological = [...safeOrders].reverse();
    let cum = 0;
    let lastEpoch = 0;
    const points = chronological.map((o, idx) => {
      cum += Number(o.pnl || 0) * rate;
      const rawEpoch = o.closed_at
        ? Math.floor(new Date(o.closed_at).getTime() / 1000)
        : Math.floor(Date.now() / 1000) - (chronological.length - idx) * 60;
      const t = rawEpoch <= lastEpoch ? lastEpoch + 1 : rawEpoch;
      lastEpoch = t;
      return { time: t as Time, value: Number(cum.toFixed(2)) };
    });

    const isPositive = cum >= 0;
    const series = chart.addSeries(AreaSeries, {
      lineColor: isPositive ? '#26a69a' : '#f43f5e',
      topColor: isPositive ? 'rgba(38, 166, 154, 0.32)' : 'rgba(244, 63, 94, 0.32)',
      bottomColor: isPositive ? 'rgba(38, 166, 154, 0.02)' : 'rgba(244, 63, 94, 0.02)',
      lineWidth: 2
    });
    series.setData(points);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) chart.applyOptions({ width: Math.floor(rect.width) });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [subTab, safeOrders, rate, darkTheme]);

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* Dark Greeting & Quick Actions Card matching Screenshot 22 */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0e1b33] via-[#111827] to-[#0b1322] text-white p-6 space-y-6 shadow-xl border border-slate-800">
        <div className="text-center space-y-1.5">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Hello {greetingId}</h1>
          <p className="text-xs italic text-slate-400">The trend is your friend — until it ends.</p>
          <div className="pt-2 font-bold text-sm text-slate-200">Quick Actions</div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3.5">
          {[
            {
              icon: Folder,
              iconColor: 'text-amber-400',
              title: 'Upload Bot',
              desc: 'Import an XML bot strategy into the visual builder.',
              tab: 'bot_builder',
              border: 'border-blue-500/30 hover:border-blue-400'
            },
            {
              icon: Bot,
              iconColor: 'text-rose-400',
              title: 'Free Bots',
              desc: 'Browse ready-made automated strategies.',
              tab: 'freebots',
              border: 'border-emerald-500/30 hover:border-emerald-400'
            },
            {
              icon: Puzzle,
              iconColor: 'text-emerald-400',
              title: 'Bot Editor',
              desc: 'Build a custom bot with the visual parameter editor.',
              tab: 'bot_builder',
              border: 'border-purple-500/30 hover:border-purple-400'
            },
            {
              icon: Zap,
              iconColor: 'text-amber-400',
              title: 'Quick Strategy',
              desc: 'Open MT5 TradingView with TP & SL execution.',
              tab: 'trading_view',
              border: 'border-amber-500/30 hover:border-amber-400'
            }
          ].map((card) => (
            <button
              key={card.title}
              type="button"
              onClick={() => onSelectTab(card.tab)}
              className={`text-left rounded-xl border ${card.border} bg-slate-900/70 p-4 space-y-3 transition`}
            >
              <card.icon className={`w-6 h-6 ${card.iconColor}`} />
              <div>
                <div className="font-bold text-sm text-white">{card.title}</div>
                <p className="text-xs text-slate-400 mt-0.5">{card.desc}</p>
              </div>
              <div className="text-xs font-semibold text-sky-400">Open →</div>
            </button>
          ))}
        </div>
        <div className="pt-2 border-t border-slate-800/80">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Unified Trading Modules
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'markets', label: 'Markets' },
              { id: 'trading_view', label: 'Trader (MT5)' },
              { id: 'rise_fall', label: 'Rise/Fall' },
              { id: 'digits', label: 'Digits' },
              { id: 'accumulators', label: 'Accumulators' },
              { id: 'charts', label: 'Charts & SmartChart' },
              { id: 'analysistool', label: 'AI Analyser' },
              { id: 'signals', label: 'Signals' },
              { id: 'automated_bots', label: 'Automated Bots' },
              { id: 'wallets', label: 'Wallets' },
              { id: 'portfolio', label: 'Portfolio' },
              { id: 'analytics', label: 'Analytics' }
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelectTab(m.id)}
                className="px-2.5 py-1 rounded-lg bg-slate-900/90 border border-slate-700 hover:border-sky-400 text-[11px] font-semibold text-slate-200 transition"
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary / Transactions / Journal Panel matching Screenshots 3 & 5 */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-6 text-xs font-bold">
            {(['summary', 'transactions', 'journal'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSubTab(t)}
                className={`py-1.5 capitalize border-b-2 transition ${
                  subTab === t
                    ? 'border-[#26a69a] text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOrders([])}
            className="px-3 py-1 rounded-md border border-purple-300 dark:border-purple-700 text-xs font-semibold text-purple-600 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/30"
          >
            Reset
          </button>
        </div>

        <div className="min-h-[220px] p-4 flex flex-col justify-center">
          {safeOrders.length === 0 ? (
            <div className="text-center space-y-2 py-8 text-slate-500">
              {subTab === 'transactions' ? (
                <>
                  <PackageOpen className="w-10 h-10 mx-auto text-slate-300" />
                  <div className="font-bold text-sm text-slate-700 dark:text-slate-300">
                    There are no transactions to display
                  </div>
                  <p className="text-xs">Run a bot or place an MT5 virtual trade to populate your ledger.</p>
                </>
              ) : (
                <p className="text-xs">
                  When you&apos;re ready to trade, hit <strong>Run</strong>. You&apos;ll be able to track your bot&apos;s performance here.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {subTab === 'summary' && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Cumulative P&amp;L Equity Curve (Lightweight Charts)
                  </div>
                  <div
                    ref={progressChartRef}
                    className="w-full h-[180px] rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden"
                  />
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2">Symbol / Type</th>
                      <th>Entry / Exit</th>
                      <th className="text-right">Stake</th>
                      <th className="text-right">Status</th>
                      <th className="text-right">P/L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {safeOrders.slice(0, 12).map((o) => (
                      <tr key={o.id}>
                        <td className="py-2 font-semibold">
                          {o.symbol} · {o.side} {o.bot_name ? `(${o.bot_name})` : ''}
                        </td>
                        <td className="font-mono text-slate-500">
                          {Number(o.entry_price).toFixed(2)} / {o.exit_price ? Number(o.exit_price).toFixed(2) : 'OPEN'}
                        </td>
                        <td className="text-right font-mono">{Number(o.stake).toFixed(2)}</td>
                        <td className="text-right font-mono">{o.status}</td>
                        <td
                          className={`text-right font-mono font-bold ${
                            Number(o.pnl) >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {Number(o.pnl) >= 0 ? '+' : ''}
                          {Number(o.pnl).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Bottom 6-Cell Stats Grid matching Screenshots 3 & 5 */}
        <div className="grid grid-cols-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-center py-3 gap-y-3 text-xs">
          <div>
            <div className="text-slate-500">Total stake</div>
            <div className="font-bold font-mono mt-0.5">
              {prefix}
              {(totalStake * rate).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Total payout</div>
            <div className="font-bold font-mono mt-0.5">
              {prefix}
              {(totalPayout * rate).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-slate-500">No. of runs</div>
            <div className="font-bold font-mono mt-0.5">{safeOrders.length}</div>
          </div>
          <div>
            <div className="text-slate-500">Contracts lost</div>
            <div className="font-bold font-mono mt-0.5 text-rose-600">{lost.length}</div>
          </div>
          <div>
            <div className="text-slate-500">Contracts won</div>
            <div className="font-bold font-mono mt-0.5 text-emerald-600">{won.length}</div>
          </div>
          <div>
            <div className="text-slate-500">Total profit/loss</div>
            <div className={`font-bold font-mono mt-0.5 ${totalPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {prefix}
              {(totalPnl * rate).toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
