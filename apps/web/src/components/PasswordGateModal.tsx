import React, { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface PasswordGateModalProps {
  title?: string;
  onUnlocked: () => void;
}

export const PasswordGateModal: React.FC<PasswordGateModalProps> = ({
  title = 'Market Analyser & Trading Bot Access',
  onUnlocked
}) => {
  const { setBotGateUnlocked } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ gateToken: string }>('/bot-gate/unlock', {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      localStorage.setItem('pipflow_bot_gate', res.gateToken);
      setBotGateUnlocked(true);
      onUnlocked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-blue-600/15 text-blue-600 dark:text-sky-400 flex items-center justify-center shrink-0">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-bold text-base text-slate-900 dark:text-white">{title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verified against database access credentials.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Workspace Access Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter database password..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          {error && (
            <div className="rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-2.5 text-sm flex items-center justify-center gap-2 transition"
          >
            <ShieldCheck className="w-4 h-4" />
            {loading ? 'Verifying against Neon DB...' : 'Unlock Market Analyser & Bots'}
          </button>
        </form>
      </div>
    </div>
  );
};
