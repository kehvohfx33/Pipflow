import React, { useEffect, useState } from 'react';
import { Briefcase, RefreshCw, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';
import { VirtualOrderItem } from '../../components/trading/OrderTicket';
import { ContractPositionsList } from '../../components/deriv/PositionsCards';

export const PortfolioPage: React.FC<{ livePricesMap: Record<string, number> }> = ({ livePricesMap }) => {
  const { token, orderVersion, refreshDerivAccounts, refreshProfile, bumpOrderVersion } = useAuth();
  const [orders, setOrders] = useState<VirtualOrderItem[]>([]);
  const [liveContracts, setLiveContracts] = useState<Record<string, { currentSpot: number; profit: number; bidPrice?: number }>>({});
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadOrders = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ orders?: VirtualOrderItem[]; liveContracts?: typeof liveContracts }>('/orders');
      setOrders(Array.isArray(res?.orders) ? res.orders : []);
      setLiveContracts(res?.liveContracts || {});
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    const id = setInterval(loadOrders, 4000);
    return () => clearInterval(id);
  }, [token, orderVersion]);

  const openPositions = orders.filter((o) => o.status === 'OPEN');

  const handleSell = async (orderId: string, exitPrice: number) => {
    setSellingId(orderId);
    try {
      await apiFetch(`/orders/${orderId}/close`, {
        method: 'POST',
        body: JSON.stringify({ exitPrice })
      });
      await loadOrders();
      refreshDerivAccounts(false);
      refreshProfile();
      bumpOrderVersion();
    } finally {
      setSellingId(null);
    }
  };

  const handleBulkClose = async (filter: 'all' | 'profitable' | 'losing') => {
    await apiFetch('/orders/bulk-close', {
      method: 'POST',
      body: JSON.stringify({ filter, prices: livePricesMap })
    });
    await loadOrders();
    refreshDerivAccounts(false);
    refreshProfile();
    bumpOrderVersion();
  };

  const totalOpenStake = openPositions.reduce((s, o) => s + Number(o.stake), 0);
  const floatingPnl = openPositions.reduce((s, o) => s + Number(liveContracts[o.id]?.profit ?? 0), 0);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-blue-600" />
            <span>Unified Open Portfolio &amp; Contract Management</span>
          </h1>
          <p className="text-xs text-slate-500">
            Live tracking across Rise/Fall, Digits, Accumulators, Multipliers, and Automated Bot positions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadOrders}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold inline-flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {openPositions.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => handleBulkClose('profitable')}
                className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
              >
                Close All Profitable
              </button>
              <button
                type="button"
                onClick={() => handleBulkClose('all')}
                className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5" /> Close All ({openPositions.length})
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-[11px] text-slate-400 font-bold uppercase">Open Contracts</div>
          <div className="text-2xl font-mono font-extrabold mt-1">{openPositions.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-[11px] text-slate-400 font-bold uppercase">Allocated Stake</div>
          <div className="text-2xl font-mono font-extrabold mt-1">${totalOpenStake.toFixed(2)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="text-[11px] text-slate-400 font-bold uppercase">Floating P/L</div>
          <div
            className={`text-2xl font-mono font-extrabold mt-1 ${
              floatingPnl >= 0 ? 'text-emerald-600' : 'text-rose-500'
            }`}
          >
            {floatingPnl >= 0 ? '+' : ''}${floatingPnl.toFixed(2)}
          </div>
        </div>
      </div>

      <ContractPositionsList
        orders={orders}
        liveContracts={liveContracts}
        livePricesMap={livePricesMap}
        onSell={handleSell}
        sellingId={sellingId}
      />
    </div>
  );
};
