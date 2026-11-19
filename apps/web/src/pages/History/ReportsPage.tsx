import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { VirtualOrderItem } from '../../components/trading/OrderTicket';

export const ReportsPage: React.FC = () => {
  const { token, activeDerivAccount } = useAuth();
  const [subTab, setSubTab] = useState<'trades' | 'statement'>('trades');
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'all'>('7d');
  const [orders, setOrders] = useState<VirtualOrderItem[]>([]);
  const [statement, setStatement] = useState<Array<{ transaction_id?: number; action_type?: string; amount?: number; balance_after?: number; transaction_time?: number; shortcode?: string }>>([]);
  const [error, setError] = useState('');

  const loadData = () => {
    if (!token) return;
    setError('');
    apiFetch<{ orders?: VirtualOrderItem[] }>('/orders')
      .then((res) => setOrders(Array.isArray(res?.orders) ? res.orders : []))
      .catch((err) => setError((err as Error).message));

    if (subTab === 'statement' && activeDerivAccount) {
      apiFetch<{ transactions?: typeof statement }>(`/deriv/statement/${activeDerivAccount.id}`)
        .then((res) => setStatement(Array.isArray(res?.transactions) ? res.transactions : []))
        .catch((err) => setError((err as Error).message));
    }
  };

  useEffect(loadData, [token, subTab, activeDerivAccount?.id]);

  const safeOrders = Array.isArray(orders) ? orders : [];
  const safeStatement = Array.isArray(statement) ? statement : [];
  const closed = safeOrders.filter((o) => o.status !== 'OPEN');
  const totalPnl = closed.reduce((s, o) => s + Number(o.pnl), 0);
  const wins = closed.filter((o) => Number(o.pnl) > 0).length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
  const totalStake = safeOrders.reduce((s, o) => s + Number(o.stake), 0);
  const best = closed.length > 0 ? Math.max(...closed.map((o) => Number(o.pnl)), 0) : 0;
  const worst = closed.length > 0 ? Math.min(...closed.map((o) => Number(o.pnl)), 0) : 0;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 text-xs font-bold">
          <button
            type="button"
            onClick={() => setSubTab('trades')}
            className={`px-4 py-1.5 rounded-md ${
              subTab === 'trades' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Trades
          </button>
          <button
            type="button"
            onClick={() => setSubTab('statement')}
            className={`px-4 py-1.5 rounded-md ${
              subTab === 'statement' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Statement
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              { id: 'today', label: 'Today' },
              { id: '7d', label: '7 Days' },
              { id: '30d', label: '30 Days' },
              { id: 'all', label: 'All Time' }
            ] as const
          ).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`px-3 py-1.5 rounded-full font-semibold border ${
                range === r.id
                  ? 'bg-[#0b1b36] text-white border-[#0b1b36]'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={loadData}
            className="px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* 5 KPI Summary Cards matching Screenshot 2 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Total P/L</div>
          <div className="text-lg font-black font-mono mt-1">{totalPnl.toFixed(2)} USD</div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Win Rate</div>
          <div className="text-lg font-black font-mono mt-1">{winRate.toFixed(1)}%</div>
          <div className="text-[11px] text-slate-400 font-mono">
            {wins}W / {closed.length - wins}L
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Trades</div>
          <div className="text-lg font-black font-mono mt-1">{safeOrders.length}</div>
          <div className="text-[11px] text-slate-400 font-mono">Stake: {totalStake.toFixed(2)} USD</div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Best / Worst</div>
          <div className="text-sm font-black font-mono mt-1">
            <span className="text-emerald-600">+{best.toFixed(2)}</span> /{' '}
            <span className="text-rose-600">{worst.toFixed(2)}</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Deposits / Withdrawals</div>
          <div className="text-sm font-black font-mono mt-1">
            <span className="text-emerald-600">+0.00</span> / <span className="text-rose-600">-0.00</span>
          </div>
        </div>
      </div>

      {/* Table matching Screenshot 2 */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        {subTab === 'trades' ? (
          <table className="w-full text-xs text-left">
            <thead className="bg-[#0b1b36] text-white">
              <tr>
                <th className="px-4 py-2.5">Market</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5 text-right">Stake</th>
                <th className="px-4 py-2.5 text-right">Entry / Exit</th>
                <th className="px-4 py-2.5 text-right">Profit / Loss</th>
                <th className="px-4 py-2.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {safeOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No trades recorded in this workspace yet.
                  </td>
                </tr>
              ) : (
                safeOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2.5 font-semibold">{o.symbol}</td>
                    <td className="px-4 py-2.5">
                      {o.side} {o.source === 'bot' ? `(${o.bot_name})` : '(MT5)'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{Number(o.stake).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {Number(o.entry_price).toFixed(2)} / {o.exit_price ? Number(o.exit_price).toFixed(2) : '-'}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono font-bold ${
                        Number(o.pnl) >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {Number(o.pnl) >= 0 ? '+' : ''}
                      {Number(o.pnl).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{o.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-xs text-left">
            <thead className="bg-[#0b1b36] text-white">
              <tr>
                <th className="px-4 py-2.5">Ref ID</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5 text-right">Balance After</th>
                <th className="px-4 py-2.5 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {safeStatement.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Sign in with your Deriv account to view your live Deriv statement.
                  </td>
                </tr>
              ) : (
                safeStatement.map((tx, idx) => (
                  <tr key={tx.transaction_id ?? idx}>
                    <td className="px-4 py-2.5 font-mono">{tx.transaction_id}</td>
                    <td className="px-4 py-2.5">{tx.action_type}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{tx.amount}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{tx.balance_after}</td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {tx.transaction_time ? new Date(tx.transaction_time * 1000).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
