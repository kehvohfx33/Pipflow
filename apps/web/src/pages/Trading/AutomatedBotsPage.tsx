import React, { useEffect, useState } from 'react';
import { Bot, Pause, Play, ShieldAlert, Square, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';

interface BotStatusResponse {
  running: boolean;
  paused?: boolean;
  runId?: string | null;
  symbol?: string;
  botName?: string;
  contractType?: string;
  stake?: number;
  currentStake?: number;
  tradesCount?: number;
  wins?: number;
  losses?: number;
  sessionPnl?: number;
  lastAction?: string;
  executionMode?: string;
  startedAt?: string;
}

interface BotRunRecord {
  id: string;
  bot_name: string;
  symbol: string;
  contract_type: string;
  account_mode: string;
  status: string;
  initial_stake: number;
  trades_count: number;
  wins: number;
  losses: number;
  session_pnl: number;
  stop_reason?: string | null;
  started_at: string;
  stopped_at?: string | null;
}

export const AutomatedBotsPage: React.FC<{ onGoToBuilder: () => void }> = ({ onGoToBuilder }) => {
  const { activeDerivAccount, refreshDerivAccounts, refreshProfile } = useAuth();
  const [status, setStatus] = useState<BotStatusResponse>({ running: false });
  const [runs, setRuns] = useState<BotRunRecord[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadAll = () => {
    apiFetch<BotStatusResponse>('/bots/status')
      .then((res) => setStatus(res || { running: false }))
      .catch(() => {});
    apiFetch<{ runs?: BotRunRecord[] }>('/bots/runs')
      .then((res) => setRuns(Array.isArray(res?.runs) ? res.runs : []))
      .catch(() => {});
  };

  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 2500);
    return () => clearInterval(id);
  }, []);

  const act = async (endpoint: string, label: string) => {
    setBusy(true);
    setNotice('');
    try {
      const res = await apiFetch<Record<string, unknown>>(endpoint, {
        method: 'POST',
        body: JSON.stringify({})
      });
      setNotice(
        endpoint === '/bots/emergency-stop'
          ? `Emergency stop completed: closed ${res.closedCount ?? 0} trade(s), P/L ${Number(res.totalPnl ?? 0).toFixed(2)} USD.`
          : `${label} applied cleanly.`
      );
      loadAll();
      refreshDerivAccounts(false);
      refreshProfile();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-600" />
            <span>Automated Bot Execution Engine</span>
          </h1>
          <p className="text-xs text-slate-500">
            Persistent server-side bot execution continues running safely even when navigating across pages.
          </p>
        </div>

        <button
          type="button"
          onClick={onGoToBuilder}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
        >
          Configure Bot Strategy →
        </button>
      </div>

      {/* Active Safety Mode Indicator */}
      <div
        className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 text-xs ${
          activeDerivAccount?.account_type === 'real'
            ? 'border-rose-400/50 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
            : 'border-emerald-400/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
        }`}
      >
        <div className="flex items-center gap-2 font-bold">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            Active Account Scope:{' '}
            {activeDerivAccount
              ? `${activeDerivAccount.account_type.toUpperCase()} (${activeDerivAccount.deriv_login_id})`
              : 'VIRTUAL DEMO WORKSPACE'}
          </span>
        </div>
        <span className="font-mono">
          {activeDerivAccount?.account_type === 'real'
            ? 'Real trading requires explicit confirmation before every start'
            : 'Demo / Virtual safety mode active'}
        </span>
      </div>

      {/* Live Engine Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Live Engine Telemetry</div>
            <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">
              {status.running
                ? `${status.botName} · ${status.symbol} (${status.paused ? 'PAUSED' : 'RUNNING'})`
                : 'No Bot Currently Running'}
            </div>
          </div>

          {status.running && (
            <div className="flex flex-wrap items-center gap-2">
              {status.paused ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act('/bots/resume', 'Bot resumed')}
                  className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1"
                >
                  <Play className="w-3.5 h-3.5" /> Resume
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act('/bots/pause', 'Bot paused')}
                  className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold inline-flex items-center gap-1"
                >
                  <Pause className="w-3.5 h-3.5" /> Pause
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => act('/bots/stop', 'Bot stopped')}
                className="px-3.5 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1"
              >
                <Square className="w-3.5 h-3.5" /> Stop
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => act('/bots/emergency-stop', 'Emergency stop')}
                className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5" /> Emergency Stop &amp; Close All
              </button>
            </div>
          )}
        </div>

        {status.running && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 text-xs font-mono">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <div className="text-[10px] text-slate-400">Contract</div>
              <div className="font-bold">{status.contractType}</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <div className="text-[10px] text-slate-400">Current Stake</div>
              <div className="font-bold">${Number(status.currentStake ?? 0).toFixed(2)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <div className="text-[10px] text-slate-400">Trades Executed</div>
              <div className="font-bold">{status.tradesCount ?? 0}</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <div className="text-[10px] text-slate-400">Wins / Losses</div>
              <div className="font-bold">
                <span className="text-emerald-600">{status.wins ?? 0}</span> /{' '}
                <span className="text-rose-500">{status.losses ?? 0}</span>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <div className="text-[10px] text-slate-400">Session P/L</div>
              <div
                className={`font-bold ${
                  Number(status.sessionPnl ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-500'
                }`}
              >
                {Number(status.sessionPnl ?? 0) >= 0 ? '+' : ''}
                ${Number(status.sessionPnl ?? 0).toFixed(2)}
              </div>
            </div>
          </div>
        )}

        {status.lastAction && (
          <div className="text-xs font-mono text-slate-500 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 rounded-lg">
            Latest event: {status.lastAction}
          </div>
        )}

        {notice && (
          <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-700 dark:text-sky-300 font-semibold">
            {notice}
          </div>
        )}
      </div>

      {/* Persistent DB Bot Runs History */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-bold text-sm">
          Bot Execution Audit Log ({runs.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Bot / Contract</th>
                <th className="px-4 py-2.5">Symbol</th>
                <th className="px-4 py-2.5">Account Mode</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Trades (W/L)</th>
                <th className="px-4 py-2.5 text-right">Net P/L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-bold">{r.bot_name}</div>
                    <div className="text-[10px] font-mono text-slate-400">{r.contract_type}</div>
                  </td>
                  <td className="px-4 py-2.5 font-mono">{r.symbol}</td>
                  <td className="px-4 py-2.5 font-mono uppercase">{r.account_mode}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] font-bold">
                      {r.status}
                    </span>
                    {r.stop_reason && <div className="text-[10px] text-slate-400 mt-0.5">{r.stop_reason}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {r.trades_count} ({r.wins}/{r.losses})
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-mono font-bold ${
                      Number(r.session_pnl) >= 0 ? 'text-emerald-600' : 'text-rose-500'
                    }`}
                  >
                    {Number(r.session_pnl) >= 0 ? '+' : ''}
                    {Number(r.session_pnl).toFixed(2)} USD
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No persisted automated bot sessions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
