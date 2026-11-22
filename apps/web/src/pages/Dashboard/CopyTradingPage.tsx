import React from 'react';
import { ShieldCheck, TrendingUp, Wallet } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export const CopyTradingPage: React.FC = () => {
  const { user, activeDerivAccount, derivAccounts, setActiveAccountId, currency, branding } = useAuth();

  const rate = currency === 'KSH' ? branding.kesRate : 1;
  const prefix = currency === 'KSH' ? 'KSH ' : '$';
  const activeBalance = activeDerivAccount
    ? Number(activeDerivAccount.displayed_balance ?? activeDerivAccount.last_known_balance)
    : Number(user?.virtual_workspace_balance ?? 10000);

  return (
    <div className="min-h-[calc(100vh-180px)] bg-[#0b1526] text-white p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="rounded-xl bg-emerald-600/20 border border-emerald-500/40 px-4 py-3 text-center text-xs font-bold text-emerald-300">
          Copy Trading &amp; Active Account Mode
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#101d33] p-5 space-y-3">
          <div className="flex items-center gap-2 text-sky-400 text-xs font-bold uppercase">
            <ShieldCheck className="w-4 h-4" />
            <span>Strategy Mirroring Overview</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Mirror verified bots and market entries directly across your active Real or Demo trading mode with automatic Stop-Loss and Take-Profit controls.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-[#101d33] p-5 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-300">
            <span className="flex items-center gap-1.5">
              <Wallet className="w-4 h-4 text-emerald-400" />
              <span>Available Trading Accounts</span>
            </span>
            <span className="font-mono text-emerald-400">
              Active: {prefix}
              {(activeBalance * rate).toFixed(2)}
            </span>
          </div>

          {derivAccounts.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-[#0b1526] py-5 text-center text-xs text-slate-400">
              Using Demo Practice Workspace ({prefix}
              {(activeBalance * rate).toFixed(2)})
            </div>
          ) : (
            <div className="space-y-2">
              {derivAccounts.map((acc) => {
                const isSelected = activeDerivAccount?.id === acc.id;
                const effectiveBal = Number(acc.displayed_balance ?? acc.last_known_balance);
                const bal = effectiveBal * rate;
                const lowReal = acc.account_type === 'real' && effectiveBal < 2;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => setActiveAccountId(acc.id)}
                    className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-xs text-left transition ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-950/30'
                        : 'border-slate-800 bg-[#0b1526] hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-sky-400" />
                      <div>
                        <div className="font-bold">
                          {acc.account_type === 'real' ? 'Real Trading Account' : 'Demo Practice Account'}
                        </div>
                        <div className="text-[11px] text-slate-400">{acc.currency}</div>
                      </div>
                    </div>
                    <div className={`font-mono font-bold ${lowReal ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {prefix}
                      {bal.toFixed(2)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
