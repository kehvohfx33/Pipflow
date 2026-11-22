import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, AreaSeries, Time } from 'lightweight-charts';
import { BarChart3 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';
import { VirtualOrderItem } from '../../components/trading/OrderTicket';
import { RiskCalculatorPage } from '../Dashboard/RiskCalculatorPage';

export const AnalyticsPage: React.FC = () => {
  const { authenticated, darkTheme, orderVersion } = useAuth();
  const [orders, setOrders] = useState<VirtualOrderItem[]>([]);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authenticated) return;
    apiFetch<{ orders?: VirtualOrderItem[] }>('/orders')
      .then((res) => setOrders(Array.isArray(res?.orders) ? res.orders : []))
      .catch(() => {});
  }, [authenticated, orderVersion]);

  const metrics = useMemo(() => {
    const settled = orders.filter((o) => o.status !== 'OPEN');
    const wins = settled.filter((o) => Number(o.pnl) > 0);
    const losses = settled.filter((o) => Number(o.pnl) < 0);
    const grossWin = wins.reduce((s, o) => s + Number(o.pnl), 0);
    const grossLoss = Math.abs(losses.reduce((s, o) => s + Number(o.pnl), 0));
    const netPnl = settled.reduce((s, o) => s + Number(o.pnl), 0);
    const winRate = settled.length > 0 ? (wins.length / settled.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
    const bestTrade = settled.reduce((m, o) => Math.max(m, Number(o.pnl)), 0);
    const worstTrade = settled.reduce((m, o) => Math.min(m, Number(o.pnl)), 0);
    return { settled, wins, losses, netPnl, winRate, profitFactor, bestTrade, worstTrade };
  }, [orders]);

  useEffect(() => {
    const el = chartRef.current;
    if (!el || metrics.settled.length === 0) return;

    const chart = createChart(el, {
      width: Math.max(260, el.clientWidth || 320),
      height: 240,
      layout: {
        background: { color: darkTheme ? '#0f172a' : '#ffffff' },
        textColor: darkTheme ? '#94a3b8' : '#475569'
      },
      grid: {
        vertLines: { color: darkTheme ? '#1e293b' : '#f1f5f9' },
        horzLines: { color: darkTheme ? '#1e293b' : '#f1f5f9' }
      },
      timeScale: { timeVisible: true }
    });

    const chronological = [...metrics.settled].reverse();
    let cum = 0;
    let lastEpoch = 0;
    const pts = chronological.map((o, idx) => {
      cum += Number(o.pnl);
      const raw = o.closed_at
        ? Math.floor(new Date(o.closed_at).getTime() / 1000)
        : Math.floor(Date.now() / 1000) - (chronological.length - idx) * 60;
      const t = raw <= lastEpoch ? lastEpoch + 1 : raw;
      lastEpoch = t;
      return { time: t as Time, value: Number(cum.toFixed(2)) };
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: cum >= 0 ? '#26a69a' : '#f43f5e',
      topColor: cum >= 0 ? 'rgba(38, 166, 154, 0.3)' : 'rgba(244, 63, 94, 0.3)',
      bottomColor: 'rgba(0,0,0,0)',
      lineWidth: 2
    });
    series.setData(pts);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w && w > 0) chart.applyOptions({ width: Math.floor(w) });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [metrics.settled, darkTheme]);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-emerald-500" />
          <span>Performance Analytics &amp; Risk Sizing</span>
        </h1>
        <p className="text-xs text-slate-500">
          Real realized equity curve, win rate, profit factor, and integrated stake recovery planner.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-slate-400 font-bold uppercase text-[10px]">Net Realized P/L</div>
          <div className={`text-xl font-mono font-extrabold mt-1 ${metrics.netPnl >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
            {metrics.netPnl >= 0 ? '+' : ''}${metrics.netPnl.toFixed(2)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-slate-400 font-bold uppercase text-[10px]">Win Rate</div>
          <div className="text-xl font-mono font-extrabold mt-1">{metrics.winRate.toFixed(1)}%</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-slate-400 font-bold uppercase text-[10px]">Profit Factor</div>
          <div className="text-xl font-mono font-extrabold mt-1">{metrics.profitFactor.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-slate-400 font-bold uppercase text-[10px]">Best Trade</div>
          <div className="text-xl font-mono font-extrabold mt-1 text-emerald-600">+${metrics.bestTrade.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-slate-400 font-bold uppercase text-[10px]">Worst Drawdown</div>
          <div className="text-xl font-mono font-extrabold mt-1 text-rose-500">${metrics.worstTrade.toFixed(2)}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Cumulative Equity Curve</div>
        {metrics.settled.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-xs text-slate-400">
            Execute and settle trades to populate your real-time equity curve.
          </div>
        ) : (
          <div ref={chartRef} className="w-full h-[240px]" />
        )}
      </div>

      {/* Embedded Risk & Martingale Sizing Calculator */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-2">
        <RiskCalculatorPage />
      </div>
    </div>
  );
};
