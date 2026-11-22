import React, { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, History, Info, Link2, RefreshCw, RotateCcw, Unlink, Wallet } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';

interface BalanceAdjustmentRecord {
  id: string;
  account_scope: 'demo' | 'real' | 'virtual';
  deriv_login_id?: string | null;
  broker_balance_at_sync: number;
  currency: string;
  sync_timestamp: string;
  adjustment_delta: number;
  previous_adjustment_total: number;
  new_adjustment_total: number;
  resulting_displayed_balance: number;
  reason: string;
  note?: string | null;
  created_at: string;
}

export const WalletsPage: React.FC = () => {
  const {
    user,
    authenticated,
    derivAccounts,
    activeDerivAccount,
    setActiveAccountId,
    currency,
    setCurrency,
    branding,
    siteControls,
    refreshDerivAccounts,
    refreshProfile
  } = useAuth();

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [adjustments, setAdjustments] = useState<BalanceAdjustmentRecord[]>([]);

  const rate = currency === 'KSH' ? branding.kesRate : 1;
  const prefix = currency === 'KSH' ? 'KSH ' : '$';

  const loadAdjustments = () => {
    if (!authenticated) return;
    apiFetch<{ adjustments?: BalanceAdjustmentRecord[] }>('/deriv/adjustments')
      .then((res) => setAdjustments(Array.isArray(res?.adjustments) ? res.adjustments : []))
      .catch(() => {});
  };

  useEffect(() => {
    loadAdjustments();
  }, [authenticated, derivAccounts.length]);

  const handleLinkDeriv = async () => {
    setBusy(true);
    setNotice('');
    try {
      const res = await apiFetch<{ url: string }>('/deriv/oauth/url?tab=wallets');
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (err) {
      setNotice((err as Error).message);
      setBusy(false);
    }
  };

  const handleSyncBalances = async () => {
    setBusy(true);
    setNotice('');
    try {
      await refreshDerivAccounts(true);
      await refreshProfile();
      loadAdjustments();
      setNotice('Synchronized real-time broker balances from Deriv servers.');
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    setBusy(true);
    setNotice('');
    try {
      await apiFetch(`/deriv/accounts/${accountId}/disconnect`, { method: 'POST' });
      await refreshDerivAccounts(false);
      setNotice('Deriv account unlinked from Pipflowtrade.');
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleResetVirtual = async () => {
    if (!authenticated) return;
    setBusy(true);
    try {
      await apiFetch('/orders/reset-balance', { method: 'POST' });
      await refreshProfile();
      setNotice('Virtual workspace balance reset to $10,000.00 USD.');
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const activeUsd = activeDerivAccount
    ? Number(activeDerivAccount.displayed_balance ?? activeDerivAccount.last_known_balance)
    : Number(user?.virtual_workspace_balance ?? 10000);

  const realAccounts = derivAccounts.filter((a) => a.account_type === 'real');
  const demoAccounts = derivAccounts.filter((a) => a.account_type !== 'real');

  const renderAccountCard = (acc: (typeof derivAccounts)[number]) => {
    const selected = activeDerivAccount?.id === acc.id;
    const brokerBal = Number(acc.last_known_balance ?? 0);
    const adjBal = Number(acc.platform_adjustment_balance ?? 0);
    const displayedBal = Number(acc.displayed_balance ?? acc.last_known_balance ?? 0);
    const exactOnly = acc.account_type === 'real' && (acc.exact_broker_balance_only ?? true);
    const syncTime = acc.last_synced_at ? new Date(acc.last_synced_at).toLocaleString() : 'Not yet synced';

    return (
      <div
        key={acc.id}
        className={`rounded-xl border p-4 space-y-3 transition ${
          selected
            ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20'
            : 'border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-bold text-sm flex flex-wrap items-center gap-1.5">
              <span>{acc.account_type === 'real' ? 'Real Account' : 'Demo Account'}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                {acc.deriv_login_id}
              </span>
              {acc.account_type === 'real' && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    exactOnly
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                  }`}
                >
                  {exactOnly ? 'Exact Broker Balance' : 'Platform Overlay Active'}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {acc.currency} · {acc.landing_company || 'Deriv'} · {acc.connection_status}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase text-slate-400 font-bold">Displayed Balance</div>
            <div className="font-mono font-extrabold text-sm text-emerald-600 dark:text-emerald-400 tabular-nums">
              {prefix}
              {(displayedBal * rate).toFixed(2)}
            </div>
          </div>
        </div>

        {/* Distinct Breakdown: Broker-Reported vs Platform-Side Overlay */}
        <div className="rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-2.5 space-y-1 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-500">Actual Deriv Broker Balance:</span>
            <span className="font-mono font-bold tabular-nums">
              {prefix}
              {(brokerBal * rate).toFixed(2)} ({acc.currency})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Platform Adjustment (Non-Deriv):</span>
            <span
              className={`font-mono font-bold tabular-nums ${
                adjBal > 0 ? 'text-sky-600' : adjBal < 0 ? 'text-rose-500' : 'text-slate-500'
              }`}
            >
              {adjBal >= 0 ? '+' : ''}
              {prefix}
              {(adjBal * rate).toFixed(2)}
              {exactOnly && adjBal !== 0 ? ' (Ignored — Exact Broker Mode)' : ''}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Last Broker Sync:</span>
            <span className="font-mono text-slate-500">{syncTime}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => setActiveAccountId(acc.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1 ${
              selected
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{selected ? 'Active Wallet' : 'Set Active'}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleDisconnect(acc.id)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center gap-1"
          >
            <Unlink className="w-3.5 h-3.5" /> Unlink
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Wallet className="w-5 h-5 text-violet-600" />
            <span>Unified Wallets &amp; Synchronized Deriv Balances</span>
          </h1>
          <p className="text-xs text-slate-500">
            Separate REAL and DEMO account management showing live broker balances apart from platform-side records.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleSyncBalances}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            <span>Sync Deriv Balances</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleLinkDeriv}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Link / Authorize Deriv OAuth</span>
          </button>
        </div>
      </div>

      {/* Active Wallet Summary */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0e1b33] to-[#172554] text-white p-6 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div className="space-y-1">
          <div className="text-xs font-bold uppercase tracking-wider text-sky-300">
            Active Execution Wallet ({activeDerivAccount ? activeDerivAccount.account_type.toUpperCase() : 'VIRTUAL'})
          </div>
          <div className="text-3xl font-mono font-black tabular-nums">
            {prefix}
            {(activeUsd * rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          {activeDerivAccount && (
            <div className="text-[11px] text-sky-200 font-mono">
              Broker Reported: {prefix}
              {(Number(activeDerivAccount.last_known_balance) * rate).toFixed(2)}
              {Number(activeDerivAccount.platform_adjustment_balance ?? 0) !== 0 &&
              !(activeDerivAccount.account_type === 'real' && (activeDerivAccount.exact_broker_balance_only ?? true))
                ? ` · Platform Adjustment: ${Number(activeDerivAccount.platform_adjustment_balance) >= 0 ? '+' : ''}${prefix}${(Number(activeDerivAccount.platform_adjustment_balance) * rate).toFixed(2)}`
                : ''}
            </div>
          )}
          <div className="text-xs text-slate-300">
            Display rate: 1 USD = {branding.kesRate} KSH ·{' '}
            <button
              type="button"
              onClick={() => setCurrency(currency === 'USD' ? 'KSH' : 'USD')}
              className="underline text-sky-300 font-semibold"
            >
              Switch to {currency === 'USD' ? 'KSH' : 'USD'}
            </button>
          </div>
        </div>

        {siteControls.showDepositWithdraw && (
          <div className="flex flex-wrap gap-2">
            <a
              href={siteControls.depositUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-xs font-bold inline-flex items-center gap-1"
            >
              <span>Deposit on Deriv</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
            <a
              href={siteControls.withdrawUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold inline-flex items-center gap-1"
            >
              <span>Withdraw</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>

      {notice && (
        <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-700 dark:text-sky-300 font-semibold">
          {notice}
        </div>
      )}

      {/* REAL Accounts Section */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-sm">REAL Deriv Accounts ({realAccounts.length})</h2>
          <span className="text-[11px] text-slate-400">Live execution uses verified Deriv broker funds only</span>
        </div>
        {realAccounts.length === 0 ? (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-5 text-center text-xs text-slate-500">
            No REAL Deriv accounts connected. Link your Deriv account via OAuth above.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">{realAccounts.map(renderAccountCard)}</div>
        )}
      </div>

      {/* DEMO Accounts Section */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-sm">DEMO Deriv Accounts ({demoAccounts.length})</h2>
          <span className="text-[11px] text-slate-400">Encrypted AES-256-GCM tokens stored server-side</span>
        </div>
        {demoAccounts.length === 0 ? (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-5 text-center text-xs text-slate-500">
            No DEMO Deriv accounts connected yet.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">{demoAccounts.map(renderAccountCard)}</div>
        )}
      </div>

      {/* Virtual Practice Wallet Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-bold text-sm">Pipflowtrade Virtual Practice Balance</div>
          <div className="text-xs text-slate-500">
            Used automatically when no Deriv OAuth wallet is connected or when placing virtual workspace trades.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono font-extrabold text-base text-emerald-600">
            {prefix}
            {(Number(user?.virtual_workspace_balance ?? 10000) * rate).toLocaleString('en-US', {
              minimumFractionDigits: 2
            })}
          </span>
          <button
            type="button"
            disabled={busy || !authenticated}
            onClick={handleResetVirtual}
            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset $10,000
          </button>
        </div>
      </div>

      {/* Platform-Side Adjustment Ledger (Explicitly Separated from Deriv Transactions) */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <History className="w-4 h-4 text-sky-600" />
            <span>Platform Adjustment Ledger ({adjustments.length})</span>
          </h2>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <Info className="w-3.5 h-3.5" /> Platform-side bookkeeping records only — not Deriv deposits or withdrawals
          </span>
        </div>

        {adjustments.length === 0 ? (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-5 text-center text-xs text-slate-500">
            No platform-side balance adjustments recorded on your workspace.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2">Date / Sync</th>
                  <th>Scope / Account</th>
                  <th className="text-right">Broker at Sync</th>
                  <th className="text-right">Platform Delta</th>
                  <th className="text-right">Resulting Display</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {adjustments.map((adj) => (
                  <tr key={adj.id}>
                    <td className="py-2 font-mono text-[11px]">
                      <div>{new Date(adj.created_at).toLocaleString()}</div>
                      <div className="text-slate-400">Sync: {new Date(adj.sync_timestamp).toLocaleTimeString()}</div>
                    </td>
                    <td className="font-mono text-[11px]">
                      <span className="uppercase font-bold">{adj.account_scope}</span>
                      {adj.deriv_login_id ? ` · ${adj.deriv_login_id}` : ''}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {Number(adj.broker_balance_at_sync).toFixed(2)} {adj.currency}
                    </td>
                    <td
                      className={`text-right font-mono font-bold tabular-nums ${
                        Number(adj.adjustment_delta) >= 0 ? 'text-emerald-600' : 'text-rose-500'
                      }`}
                    >
                      {Number(adj.adjustment_delta) >= 0 ? '+' : ''}
                      {Number(adj.adjustment_delta).toFixed(2)} {adj.currency}
                    </td>
                    <td className="text-right font-mono font-bold tabular-nums">
                      {Number(adj.resulting_displayed_balance).toFixed(2)} {adj.currency}
                    </td>
                    <td className="text-slate-600 dark:text-slate-300">
                      <div>{adj.reason}</div>
                      {adj.note && <div className="text-[11px] text-slate-400">{adj.note}</div>}
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
