import React, { useState } from 'react';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { DerivAccountSummary } from '../../contexts/AuthContext';

interface RealAccountConfirmModalProps {
  open: boolean;
  account: DerivAccountSummary | null;
  botName: string;
  symbol: string;
  stake: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export const RealAccountConfirmModal: React.FC<RealAccountConfirmModalProps> = ({
  open,
  account,
  botName,
  symbol,
  stake,
  onCancel,
  onConfirm
}) => {
  const [checked, setChecked] = useState(false);

  if (!open || !account) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full border border-rose-500/40 shadow-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
            <ShieldAlert className="w-6 h-6 shrink-0" />
            <div>
              <h3 className="font-extrabold text-base">Confirm Real-Money Bot Execution</h3>
              <p className="text-[11px] text-slate-500">Deriv Real Account Authorization Required</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close modal">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 p-3 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-slate-500">Target Account</span>
            <span className="font-mono font-bold text-rose-700 dark:text-rose-300">
              REAL · {account.deriv_login_id} ({account.currency})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Available Balance</span>
            <span className="font-mono font-bold">
              {Number(account.displayed_balance ?? account.last_known_balance).toFixed(2)} {account.currency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Bot / Market / Stake</span>
            <span className="font-mono font-bold">
              {botName} · {symbol} · ${stake.toFixed(2)}
            </span>
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-rose-600"
          />
          <span>
            I confirm that I want automated real-money orders placed on Deriv account{' '}
            <strong>{account.deriv_login_id}</strong> and accept all trading risks.
          </span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setChecked(false);
              onCancel();
            }}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold"
          >
            Cancel (Stay Safe)
          </button>
          <button
            type="button"
            disabled={!checked}
            onClick={() => {
              setChecked(false);
              onConfirm();
            }}
            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-extrabold inline-flex items-center gap-1.5"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Start Real Bot</span>
          </button>
        </div>
      </div>
    </div>
  );
};
