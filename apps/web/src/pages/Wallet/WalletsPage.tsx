import React, { useState } from 'react';
import { ArrowUpRight, CheckCircle2, Link2, RefreshCw, RotateCcw, Unlink, Wallet } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';

export const WalletsPage: React.FC = () => {
  const {
    user,
    token,
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

  const rate = currency === 'KSH' ? branding.kesRate : 1;
  const prefix = currency === 'KSH' ? 'KSH ' : '$';

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
      setNotice('Synchronized real-time balances from Deriv servers.');
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
      setNotice('Deriv account unlinked from PipFlowTrade.');
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleResetVirtual = async () => {
    if (!token) return;
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
    ? Number(activeDerivAccount.last_known_balance)
    : Number(user?.virtual_workspace_balance ?? 10000);

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Wallet className="w-5 h-5 text-violet-600" />
            <span>Unified Wallets &amp; Deriv Accounts</span>
          </h1>
          <p className="text-xs text-slate-500">
            Manage linked Deriv Demo &amp; Real accounts, encrypted server-side OAuth tokens, and Virtual Practice funds.
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

      {/* Linked Deriv Accounts List */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-sm">Authorized Deriv Trading Wallets ({derivAccounts.length})</h2>
          <span className="text-[11px] text-slate-400">Encrypted AES-256-GCM tokens stored server-side</span>
        </div>

        {derivAccounts.length === 0 ? (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-6 text-center space-y-2 text-xs text-slate-500">
            <p>No Deriv OAuth accounts connected yet. You can trade with the Virtual Practice Wallet or link Deriv above.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {derivAccounts.map((acc) => {
              const selected = activeDerivAccount?.id === acc.id;
              return (
                <div
                  key={acc.id}
                  className={`rounded-xl border p-4 space-y-3 transition ${
                    selected
                      ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-sm flex items-center gap-1.5">
                        <span>{acc.account_type === 'real' ? 'Real Account' : 'Demo Account'}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                          {acc.deriv_login_id}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {acc.currency} · {acc.landing_company || 'Deriv'} · {acc.connection_status}
                      </div>
                    </div>
                    <div className="font-mono font-extrabold text-sm text-emerald-600 dark:text-emerald-400">
                      {prefix}
                      {(Number(acc.last_known_balance) * rate).toFixed(2)}
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
            })}
          </div>
        )}
      </div>

      {/* Virtual Practice Wallet Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-bold text-sm">PipFlowTrade Virtual Practice Balance</div>
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
            disabled={busy || !token}
            onClick={handleResetVirtual}
            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset $10,000
          </button>
        </div>
      </div>
    </div>
  );
};
