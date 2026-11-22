import React, { useEffect, useState } from 'react';
import { VirtualOrderItem } from '../trading/OrderTicket';

interface LiveSnapshot {
  currentSpot: number;
  profit: number;
  bidPrice?: number;
}

interface PositionsPanelProps {
  orders: VirtualOrderItem[];
  liveContracts: Record<string, LiveSnapshot>;
  livePricesMap?: Record<string, number>;
  contractFilter?: (order: VirtualOrderItem) => boolean;
  onSell: (orderId: string, currentPrice: number) => Promise<void>;
  sellingId: string | null;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const ContractPositionsList: React.FC<PositionsPanelProps> = ({
  orders,
  liveContracts,
  livePricesMap = {},
  contractFilter,
  onSell,
  sellingId
}) => {
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const scoped = contractFilter ? orders.filter(contractFilter) : orders;
  const open = scoped.filter((o) => o.status === 'OPEN');
  const closed = scoped.filter((o) => o.status !== 'OPEN');

  const estimateProfit = (o: VirtualOrderItem) => {
    if (liveContracts[o.id]) return Number(liveContracts[o.id].profit);
    const live = Number(livePricesMap[o.symbol] ?? o.entry_price);
    const entry = Number(o.entry_price);
    if (!entry) return 0;
    const pct = o.side === 'BUY' ? (live - entry) / entry : (entry - live) / entry;
    return Number((Number(o.stake) * pct * 100).toFixed(2));
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
        <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs font-bold">
          <button
            type="button"
            onClick={() => setTab('open')}
            className={`px-3 py-1 rounded-md transition ${
              tab === 'open' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Open ({open.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('closed')}
            className={`px-3 py-1 rounded-md transition ${
              tab === 'closed' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Recent Closed ({closed.length})
          </button>
        </div>
      </div>

      <div className="p-3">
        {tab === 'open' ? (
          open.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">
              No active contracts right now. Configure trade parameters and click Buy to enter.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {open.map((o) => {
                const pnl = estimateProfit(o);
                const isGain = pnl >= 0;
                const bidVal = Number(liveContracts[o.id]?.bidPrice ?? Math.max(0, Number(o.stake) + pnl));
                const elapsedSec = o.opened_at
                  ? Math.max(0, (nowMs - new Date(o.opened_at).getTime()) / 1000)
                  : 0;
                return (
                  <div
                    key={o.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3.5 space-y-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 dark:text-white">{o.symbol}</span>
                      <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-sky-300 font-mono text-[10px] font-bold">
                        {o.contract_type || o.side}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                      <span>Elapsed: {formatDuration(elapsedSec)}</span>
                      <span>{o.execution_mode?.toUpperCase() || 'VIRTUAL'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <div className="text-[10px] text-slate-400">Profit/Loss</div>
                        <div className={`font-mono font-bold text-sm ${isGain ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {isGain ? '+' : ''}
                          {pnl.toFixed(2)} USD
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Contract Value</div>
                        <div className="font-mono font-bold text-sm">{bidVal.toFixed(2)} USD</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Stake</div>
                        <div className="font-mono font-semibold">{Number(o.stake).toFixed(2)} USD</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Payout</div>
                        <div className="font-mono font-semibold">
                          {o.payout ? `${Number(o.payout).toFixed(2)} USD` : 'Live'}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={sellingId === o.id}
                      onClick={() => onSell(o.id, Number(livePricesMap[o.symbol] ?? o.entry_price))}
                      className="w-full py-2 rounded-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs transition"
                    >
                      {sellingId === o.id ? 'Closing...' : `Close / Sell (${bidVal.toFixed(2)} USD)`}
                    </button>
                  </div>
                );
              })}
            </div>
          )
        ) : closed.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">No settled contracts in this session yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Contract</th>
                  <th className="px-3 py-2 text-right">Stake</th>
                  <th className="px-3 py-2 text-right">Entry / Exit</th>
                  <th className="px-3 py-2 text-right">P/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {closed.slice(0, 20).map((o) => (
                  <tr key={o.id}>
                    <td className="px-3 py-2 font-semibold">{o.symbol}</td>
                    <td className="px-3 py-2 font-mono">{o.contract_type || o.side}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(o.stake).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {Number(o.entry_price).toFixed(2)} → {o.exit_price ? Number(o.exit_price).toFixed(2) : '-'}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-bold ${
                        Number(o.pnl) >= 0 ? 'text-emerald-600' : 'text-rose-500'
                      }`}
                    >
                      {Number(o.pnl) >= 0 ? '+' : ''}
                      {Number(o.pnl).toFixed(2)} USD
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
