import React, { useEffect, useRef, useState } from 'react';
import {
  RotateCw,
  FolderOpen,
  Save,
  LayoutGrid,
  TrendingUp,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Play,
  Square,
  XCircle,
  Sparkles,
  FileText,
  ShoppingBag,
  Zap,
  X
} from 'lucide-react';
import { DEFAULT_BOT_CONFIG, SharedBotConfig, useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../services/api';
import { fetchDerivInstrumentsDirect } from '../../services/derivBrowserWs';

interface BotBuilderPageProps {
  onBotStarted: () => void;
  onOpenCharts?: () => void;
}

interface BotStatusTelemetry {
  running: boolean;
  symbol?: string;
  botName?: string;
  stake?: number;
  currentStake?: number;
  tradesCount?: number;
  wins?: number;
  losses?: number;
  sessionPnl?: number;
  lastAction?: string;
  lastQuote?: number | null;
}

interface InstrumentOption {
  symbol: string;
  display_name: string;
  market: string;
}

const MARKET_GROUPS: Record<string, { label: string; subMarkets: Record<string, Array<{ symbol: string; name: string }>> }> = {
  synthetics: {
    label: 'synthetics',
    subMarkets: {
      'Continuous Indices': [
        { symbol: '1HZ90V', name: 'Volatility 90 (1s) Index' },
        { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index' },
        { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index' },
        { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index' },
        { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index' },
        { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index' },
        { symbol: 'R_100', name: 'Volatility 100 Index' },
        { symbol: 'R_75', name: 'Volatility 75 Index' },
        { symbol: 'R_50', name: 'Volatility 50 Index' },
        { symbol: 'R_25', name: 'Volatility 25 Index' },
        { symbol: 'R_10', name: 'Volatility 10 Index' }
      ],
      'Crash/Boom Indices': [
        { symbol: 'BOOM1000', name: 'Boom 1000 Index' },
        { symbol: 'BOOM500', name: 'Boom 500 Index' },
        { symbol: 'CRASH1000', name: 'Crash 1000 Index' },
        { symbol: 'CRASH500', name: 'Crash 500 Index' }
      ],
      'Jump Indices': [
        { symbol: 'JD10', name: 'Jump 10 Index' },
        { symbol: 'JD25', name: 'Jump 25 Index' },
        { symbol: 'JD50', name: 'Jump 50 Index' },
        { symbol: 'JD75', name: 'Jump 75 Index' },
        { symbol: 'JD100', name: 'Jump 100 Index' }
      ]
    }
  },
  forex: {
    label: 'forex',
    subMarkets: {
      'Major Pairs': [
        { symbol: 'frxEURUSD', name: 'EUR/USD' },
        { symbol: 'frxGBPUSD', name: 'GBP/USD' },
        { symbol: 'frxUSDJPY', name: 'USD/JPY' },
        { symbol: 'frxAUDUSD', name: 'AUD/USD' }
      ]
    }
  },
  cryptocurrency: {
    label: 'cryptocurrency',
    subMarkets: {
      'Crypto Pairs': [
        { symbol: 'cryBTCUSD', name: 'BTC/USD' },
        { symbol: 'cryETHUSD', name: 'ETH/USD' }
      ]
    }
  }
};

export const BotBuilderPage: React.FC<BotBuilderPageProps> = ({ onBotStarted, onOpenCharts }) => {
  const {
    activeDerivAccount,
    botConfig,
    setBotConfig,
    fastExecution,
    refreshDerivAccounts,
    refreshProfile
  } = useAuth();

  const [instruments, setInstruments] = useState<InstrumentOption[]>([]);
  const [zoomPct, setZoomPct] = useState(100);
  const [history, setHistory] = useState<SharedBotConfig[]>([]);
  const [redoStack, setRedoStack] = useState<SharedBotConfig[]>([]);
  const [fixedVarsOpen, setFixedVarsOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [vhModalOpen, setVhModalOpen] = useState(false);
  const [blocksDrawerOpen, setBlocksDrawerOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('Over/Under digit sniper on Volatility 90 (1s) with 2x martingale');
  const [xmlStatus, setXmlStatus] = useState('');
  const [runningMsg, setRunningMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<BotStatusTelemetry>({ running: false });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const patchConfig = (patch: Partial<SharedBotConfig>) => {
    setHistory((prev) => [...prev.slice(-19), botConfig]);
    setRedoStack([]);
    setBotConfig((prev) => ({ ...prev, ...patch }));
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack((r) => [...r, botConfig]);
    setHistory((h) => h.slice(0, -1));
    setBotConfig(prev);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory((h) => [...h, botConfig]);
    setRedoStack((r) => r.slice(0, -1));
    setBotConfig(next);
  };

  const refreshStatus = () => {
    apiFetch<BotStatusTelemetry>('/bots/status')
      .then((res) => setStatus(res || { running: false }))
      .catch(() => {});
  };

  useEffect(() => {
    apiFetch<{ instruments?: InstrumentOption[] }>('/market/instruments')
      .then((res) => {
        if (Array.isArray(res?.instruments) && res.instruments.length > 0) setInstruments(res.instruments);
        else return fetchDerivInstrumentsDirect().then((list) => setInstruments(Array.isArray(list) ? list : []));
      })
      .catch(() => {
        fetchDerivInstrumentsDirect().then((list) => setInstruments(Array.isArray(list) ? list : [])).catch(() => {});
      });
    refreshStatus();
    const id = setInterval(refreshStatus, 2500);
    return () => clearInterval(id);
  }, []);

  const handleXmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text().catch(() => '');
    const symMatch = text.match(/<field name="SYMBOL_LIST">([^<]+)<\/field>/i);
    const stakeMatch = text.match(/<field name="AMOUNT"[^>]*>([\d.]+)<\/field>/i);
    const predMatch = text.match(/<field name="PREDICTION"[^>]*>(\d)<\/field>/i);
    patchConfig({
      botName: file.name.replace(/\.xml$/i, ''),
      ...(symMatch?.[1] ? { symbol: symMatch[1].trim() } : {}),
      ...(stakeMatch?.[1] ? { stake: Math.max(0.35, Number(stakeMatch[1]) || 0.5) } : {}),
      ...(predMatch?.[1] ? { initialPrediction: Number(predMatch[1]) } : {})
    });
    setXmlStatus(`Imported strategy XML: ${file.name}`);
  };

  const handleExportXml = () => {
    const xml = `<xml xmlns="https://developers.google.com/blockly/xml">
  <block type="trade_definition">
    <field name="MARKET_LIST">${botConfig.marketGroup}</field>
    <field name="SUBMARKET_LIST">${botConfig.subMarket}</field>
    <field name="SYMBOL_LIST">${botConfig.symbol}</field>
    <field name="TRADETYPE_LIST">${botConfig.tradeType}</field>
    <field name="CONTRACTTYPE_LIST">${botConfig.contractTypeLabel}</field>
    <field name="CANDLEINTERVAL">${botConfig.candleInterval}</field>
    <field name="DURATION">${botConfig.duration}</field>
    <field name="DURATION_UNIT">${botConfig.durationUnit}</field>
    <field name="AMOUNT">${botConfig.stake}</field>
    <field name="PREDICTION">${botConfig.initialPrediction}</field>
    <field name="RECOVERY_PREDICTION">${botConfig.recoveryPrediction}</field>
    <field name="MARTINGALE">${botConfig.useMartingale ? botConfig.martingale : 1}</field>
    <field name="MAX_WINS">${botConfig.numberOfWins}</field>
    <field name="STOP_LOSS">${botConfig.stopLoss}</field>
  </block>
</xml>`;
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${botConfig.botName || 'pipflow-bot'}.xml`;
    a.click();
    URL.revokeObjectURL(url);
    setXmlStatus(`Exported ${botConfig.botName}.xml`);
  };

  const handleRunBot = async () => {
    setBusy(true);
    setRunningMsg('');
    try {
      const effectiveContract =
        botConfig.purchaseAction === 'Over'
          ? 'DIGITOVER'
          : botConfig.purchaseAction === 'Under'
            ? 'DIGITUNDER'
            : botConfig.purchaseAction === 'Even'
              ? 'DIGITEVEN'
              : botConfig.purchaseAction === 'Odd'
                ? 'DIGITODD'
                : botConfig.tradeType;

      const res = await apiFetch<BotStatusTelemetry>('/bots/run', {
        method: 'POST',
        body: JSON.stringify({
          symbol: botConfig.symbol,
          botName: botConfig.botName,
          stake: botConfig.stake,
          tpPct: botConfig.tpPct,
          slPct: botConfig.slPct,
          stopLossUsd: botConfig.stopLoss,
          maxWins: botConfig.numberOfWins,
          contractType: effectiveContract,
          barrier: botConfig.initialPrediction,
          recoveryPrediction: botConfig.recoveryPrediction,
          duration: botConfig.duration,
          durationUnit: botConfig.durationUnit,
          martingale: botConfig.martingale,
          useMartingale: botConfig.useMartingale,
          allowBulkPurchase: botConfig.allowBulkPurchase,
          bulkTradesCount: botConfig.bulkTradesCount,
          fastExecution,
          entryCondition: {
            enabled: botConfig.entrySignalMode,
            lookback: botConfig.conditionLookback,
            comparator: botConfig.conditionComparator,
            digit: botConfig.conditionDigit,
            tradeEachTick: botConfig.tradeEachTick
          },
          connectedAccountId: activeDerivAccount?.id ?? null
        })
      });
      setStatus(res);
      setRunningMsg(
        `Instant execution active: "${botConfig.botName}" (${effectiveContract}) on ${botConfig.symbol}${
          activeDerivAccount ? ` · ${activeDerivAccount.account_type.toUpperCase()} Account` : ''
        }.`
      );
      onBotStarted();
      refreshDerivAccounts(false);
    } catch (err) {
      setRunningMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleStopBot = async () => {
    setBusy(true);
    try {
      await apiFetch('/bots/stop', { method: 'POST' });
      setStatus({ running: false });
      setRunningMsg('Bot stopped cleanly.');
    } catch (err) {
      setRunningMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCloseAllBotTrades = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ closedCount: number; totalPnl: number }>('/bots/close-all', {
        method: 'POST',
        body: JSON.stringify({})
      });
      setStatus({ running: false });
      setRunningMsg(
        `Stopped & closed ${res.closedCount} bot trade(s) · Net P/L: ${
          res.totalPnl >= 0 ? '+' : ''
        }${res.totalPnl.toFixed(2)} USD`
      );
      refreshDerivAccounts(false);
      refreshProfile();
    } catch (err) {
      setRunningMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyAiGoal = (preset?: Partial<SharedBotConfig>, label?: string) => {
    if (preset) {
      patchConfig(preset);
      setXmlStatus(`AI Bot Generator built "${label || preset.botName}" into your workspace.`);
      setAiModalOpen(false);
      return;
    }
    const lower = aiPrompt.toLowerCase();
    const isOver = lower.includes('over');
    const isEven = lower.includes('even');
    const isRise = lower.includes('rise') || lower.includes('fall');
    patchConfig({
      botName: 'AI_Generated_Strategy',
      symbol: lower.includes('100') ? '1HZ100V' : lower.includes('75') ? 'R_75' : '1HZ90V',
      tradeType: isRise ? 'CALL' : isEven ? 'DIGITEVEN' : isOver ? 'DIGITOVER' : 'DIGITUNDER',
      tradeTypeCategory: isRise ? 'Up/Down' : 'Digits',
      contractTypeLabel: isRise ? 'Rise' : isEven ? 'Even' : isOver ? 'Over' : 'Under',
      purchaseAction: isRise ? 'Rise' : isEven ? 'Even' : isOver ? 'Over' : 'Under',
      initialPrediction: isOver ? 4 : 8,
      recoveryPrediction: isOver ? 2 : 5,
      stake: 0.5,
      martingale: 2,
      useMartingale: !lower.includes('no martingale')
    });
    setXmlStatus('AI Bot Generator compiled custom parameters from your description.');
    setAiModalOpen(false);
  };

  const currentMarketGroup = MARKET_GROUPS[botConfig.marketGroup] ?? MARKET_GROUPS.synthetics;
  const subMarketEntries = Object.entries(currentMarketGroup.subMarkets);
  const symbolOptions =
    currentMarketGroup.subMarkets[botConfig.subMarket] ?? subMarketEntries[0]?.[1] ?? [];

  const pillSelectClass =
    'rounded-full bg-white text-slate-900 border border-slate-300 px-2.5 py-0.5 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer';
  const pillInputClass =
    'rounded-full bg-white text-slate-900 border border-slate-300 px-2.5 py-0.5 text-[11px] font-mono font-bold text-center focus:outline-none focus:ring-1 focus:ring-sky-500';
  const jigsawRowClass =
    'flex flex-wrap items-center gap-1.5 rounded-md border border-slate-400/60 bg-[#e4e6e9] dark:bg-slate-800 px-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-100 shadow-2xs';

  return (
    <div className="flex min-h-[calc(100vh-170px)] bg-white dark:bg-slate-950 relative">
      {/* Left Vertical Blockly Toolbox Rail (Exact Match to Screenshot) */}
      <aside className="w-11 sm:w-12 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col items-center py-3 gap-4 text-slate-700 dark:text-slate-300 shrink-0 select-none">
        <button
          type="button"
          onClick={() => {
            setBotConfig(DEFAULT_BOT_CONFIG);
            setXmlStatus('Workspace blocks reset to Volatility 90 (1s) Over/Under defaults');
          }}
          title="Reset Workspace"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <RotateCw className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Import Bot XML"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
        <input ref={fileInputRef} type="file" accept=".xml" onChange={handleXmlUpload} className="hidden" />

        <button
          type="button"
          onClick={handleExportXml}
          title="Save / Export Strategy XML"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Save className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setBlocksDrawerOpen((v) => !v)}
          title="Quick Strategy Blocks"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <LayoutGrid className="w-4 h-4 text-emerald-600" />
        </button>

        <button
          type="button"
          onClick={() => onOpenCharts?.()}
          title="Open Live Charts"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <TrendingUp className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleUndo}
          disabled={history.length === 0}
          title="Undo"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
        >
          <Undo2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleRedo}
          disabled={redoStack.length === 0}
          title="Redo"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
        >
          <Redo2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setZoomPct((z) => Math.min(120, z + 5))}
          title="Zoom In"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setZoomPct((z) => Math.max(75, z - 5))}
          title="Zoom Out"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
      </aside>

      {/* Main Blockly Canvas Area */}
      <div className="flex-1 min-w-0 p-3 sm:p-4 overflow-x-auto bg-white dark:bg-slate-950">
        <div
          className="space-y-4 max-w-4xl origin-top-left transition-transform"
          style={{ transform: zoomPct !== 100 ? `scale(${zoomPct / 100})` : undefined }}
        >
          {/* Top Bar: Emerald AI Bot Generator + Live Control Chips */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAiModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#00a884] hover:bg-[#008f70] text-white text-xs sm:text-sm font-bold shadow-xs transition"
              >
                <Sparkles className="w-4 h-4" />
                <span>AI Bot Generator</span>
              </button>

              {status.running ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleStopBot}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Stop</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleCloseAllBotTrades}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Close Trades</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRunBot}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#0f4c64] hover:bg-[#0b3a4d] text-white text-xs font-bold"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{busy ? 'Starting...' : 'Run Now'}</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
              <span>Zoom: {zoomPct}%</span>
              <input
                value={botConfig.botName}
                onChange={(e) => patchConfig({ botName: e.target.value })}
                aria-label="Bot Name"
                className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1 text-[11px] text-slate-800 dark:text-slate-100 w-36 sm:w-44"
              />
            </div>
          </div>

          {/* Live Bot Status Banner */}
          {status.running && (
            <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
                <span className="font-sans font-bold text-emerald-700 dark:text-emerald-300">
                  ● RUNNING: {status.botName} ({status.symbol})
                </span>
                <span>Stake: ${Number(status.currentStake ?? botConfig.stake).toFixed(2)}</span>
                <span>Trades: {status.tradesCount ?? 0}</span>
                <span className="text-emerald-600 font-bold">W: {status.wins ?? 0}</span>
                <span className="text-rose-500 font-bold">L: {status.losses ?? 0}</span>
                <span className={Number(status.sessionPnl ?? 0) >= 0 ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>
                  P/L: {Number(status.sessionPnl ?? 0) >= 0 ? '+' : ''}${Number(status.sessionPnl ?? 0).toFixed(2)}
                </span>
              </div>
              {status.lastAction && <span className="text-[11px] text-slate-600 dark:text-slate-300">{status.lastAction}</span>}
            </div>
          )}

          {xmlStatus && (
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
              {xmlStatus}
            </div>
          )}
          {runningMsg && (
            <div className="rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 px-3 py-1.5 text-xs text-sky-800 dark:text-sky-200">
              {runningMsg}
            </div>
          )}

          {/* =====================================================================
              BLOCK 1: Dark-Teal (#0f4c64) "1. Trade parameters" Blockly Structure
              ===================================================================== */}
          <div className="border-l-[10px] border-[#0f4c64] rounded-md overflow-hidden shadow-xs">
            {/* Hat Header */}
            <div className="bg-[#0f4c64] text-white px-3 py-2 text-xs font-bold flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 opacity-90" />
              <span>1. Trade parameters</span>
            </div>

            {/* Grey Block Body */}
            <div className="bg-[#e6e8ec] dark:bg-slate-800/90 p-2.5 sm:p-3 space-y-2 text-[11px] text-slate-800 dark:text-slate-100">
              {/* Cascading Market Row */}
              <div className="rounded border border-slate-400/50 bg-[#dfe2e6] dark:bg-slate-900/70 p-2.5 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">Market:</span>
                  <select
                    value={botConfig.marketGroup}
                    onChange={(e) => {
                      const nextGroup = e.target.value;
                      const grp = MARKET_GROUPS[nextGroup];
                      const firstSub = Object.keys(grp.subMarkets)[0];
                      const firstSym = grp.subMarkets[firstSub]?.[0]?.symbol || '1HZ90V';
                      patchConfig({ marketGroup: nextGroup, subMarket: firstSub, symbol: firstSym });
                    }}
                    className={pillSelectClass}
                  >
                    {Object.keys(MARKET_GROUPS).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-500">&gt;</span>
                  <select
                    value={botConfig.subMarket}
                    onChange={(e) => {
                      const nextSub = e.target.value;
                      const firstSym = currentMarketGroup.subMarkets[nextSub]?.[0]?.symbol || botConfig.symbol;
                      patchConfig({ subMarket: nextSub, symbol: firstSym });
                    }}
                    className={pillSelectClass}
                  >
                    {subMarketEntries.map(([subName]) => (
                      <option key={subName} value={subName}>
                        {subName}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-500">&gt;</span>
                  <select
                    value={botConfig.symbol}
                    onChange={(e) => patchConfig({ symbol: e.target.value })}
                    className={`${pillSelectClass} max-w-[220px]`}
                  >
                    {symbolOptions.map((s) => (
                      <option key={s.symbol} value={s.symbol}>
                        {s.name}
                      </option>
                    ))}
                    {instruments
                      .filter((i) => !symbolOptions.some((so) => so.symbol === i.symbol))
                      .slice(0, 40)
                      .map((i) => (
                        <option key={i.symbol} value={i.symbol}>
                          {i.display_name} ({i.symbol})
                        </option>
                      ))}
                  </select>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <span>Alternate markets (Continuous Indices only):</span>
                  <input
                    type="checkbox"
                    checked={botConfig.alternateMarkets}
                    onChange={(e) => patchConfig({ alternateMarkets: e.target.checked })}
                    className="w-3.5 h-3.5 accent-[#0f4c64]"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <span>Alternate mode:</span>
                  {botConfig.alternateMarkets && (
                    <select
                      value={botConfig.alternateMode}
                      onChange={(e) => patchConfig({ alternateMode: e.target.value })}
                      className={pillSelectClass}
                    >
                      <option value="Sequential">Sequential (V10–V100)</option>
                      <option value="Random">Random Volatility</option>
                    </select>
                  )}
                </div>
              </div>

              {/* Trade Type Row */}
              <div className={jigsawRowClass}>
                <span className="font-semibold">Trade Type:</span>
                <select
                  value={botConfig.tradeTypeCategory}
                  onChange={(e) => {
                    const cat = e.target.value;
                    if (cat === 'Digits') {
                      patchConfig({
                        tradeTypeCategory: cat,
                        tradeType: 'DIGITUNDER',
                        contractTypeLabel: 'Under',
                        purchaseAction: 'Under'
                      });
                    } else if (cat === 'Up/Down') {
                      patchConfig({
                        tradeTypeCategory: cat,
                        tradeType: 'CALL',
                        contractTypeLabel: 'Rise',
                        purchaseAction: 'Rise'
                      });
                    } else {
                      patchConfig({
                        tradeTypeCategory: cat,
                        tradeType: 'MULTUP',
                        contractTypeLabel: 'Multiplier',
                        purchaseAction: 'Rise'
                      });
                    }
                  }}
                  className={pillSelectClass}
                >
                  <option value="Digits">Digits</option>
                  <option value="Up/Down">Up/Down</option>
                  <option value="Multipliers">Multipliers</option>
                </select>
                <span className="text-slate-500">&gt;</span>
                <select
                  value={botConfig.tradeType}
                  onChange={(e) => {
                    const tt = e.target.value as SharedBotConfig['tradeType'];
                    const label: SharedBotConfig['contractTypeLabel'] =
                      tt === 'DIGITOVER'
                        ? 'Over'
                        : tt === 'DIGITUNDER'
                          ? 'Under'
                          : tt === 'DIGITEVEN'
                            ? 'Even'
                            : tt === 'DIGITODD'
                              ? 'Odd'
                              : tt === 'CALL'
                                ? 'Rise'
                                : 'Multiplier';
                    patchConfig({
                      tradeType: tt,
                      contractTypeLabel: label,
                      purchaseAction: label === 'Multiplier' ? 'Rise' : label
                    });
                  }}
                  className={pillSelectClass}
                >
                  <option value="DIGITUNDER">Over/Under</option>
                  <option value="DIGITOVER">Over/Under (Over)</option>
                  <option value="DIGITEVEN">Even/Odd (Even)</option>
                  <option value="DIGITODD">Even/Odd (Odd)</option>
                  <option value="CALL">Rise/Fall</option>
                  <option value="MULTUP">MT5 Multiplier</option>
                </select>
              </div>

              {/* Contract Type Row */}
              <div className={jigsawRowClass}>
                <span className="font-semibold">Contract Type:</span>
                <select
                  value={botConfig.contractTypeLabel}
                  onChange={(e) => {
                    const lbl = e.target.value as SharedBotConfig['contractTypeLabel'];
                    const tt: SharedBotConfig['tradeType'] =
                      lbl === 'Over'
                        ? 'DIGITOVER'
                        : lbl === 'Under'
                          ? 'DIGITUNDER'
                          : lbl === 'Even'
                            ? 'DIGITEVEN'
                            : lbl === 'Odd'
                              ? 'DIGITODD'
                              : lbl === 'Multiplier'
                                ? 'MULTUP'
                                : 'CALL';
                    patchConfig({
                      contractTypeLabel: lbl,
                      tradeType: tt,
                      purchaseAction: lbl === 'Multiplier' ? 'Rise' : lbl
                    });
                  }}
                  className={pillSelectClass}
                >
                  <option value="Under">Under</option>
                  <option value="Over">Over</option>
                  <option value="Even">Even</option>
                  <option value="Odd">Odd</option>
                  <option value="Rise">Rise</option>
                  <option value="Fall">Fall</option>
                </select>
              </div>

              {/* Default Candle Interval Row */}
              <div className={jigsawRowClass}>
                <span className="font-semibold">Default Candle Interval:</span>
                <select
                  value={botConfig.candleInterval}
                  onChange={(e) => patchConfig({ candleInterval: e.target.value })}
                  className={pillSelectClass}
                >
                  <option value="1 minute">1 minute</option>
                  <option value="3 minutes">3 minutes</option>
                  <option value="5 minutes">5 minutes</option>
                  <option value="15 minutes">15 minutes</option>
                  <option value="1 hour">1 hour</option>
                </select>
              </div>

              {/* Error & Virtual Hook Rows */}
              <div className="rounded border border-slate-400/50 bg-[#dfe2e6] dark:bg-slate-900/70 p-2.5 space-y-2">
                <label className="flex flex-wrap items-center gap-2 cursor-pointer">
                  <span>Restart buy/sell on error (disable for better performance):</span>
                  <input
                    type="checkbox"
                    checked={botConfig.restartOnError}
                    onChange={(e) => patchConfig({ restartOnError: e.target.checked })}
                    className="w-3.5 h-3.5 accent-[#0f4c64]"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <span>Virtual Hook:</span>
                  <input
                    type="checkbox"
                    checked={botConfig.virtualHook}
                    onChange={(e) => patchConfig({ virtualHook: e.target.checked })}
                    className="w-3.5 h-3.5 accent-[#0f4c64]"
                  />
                  <button
                    type="button"
                    onClick={() => setVhModalOpen(true)}
                    className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400 hover:underline"
                  >
                    <span className="text-slate-700 dark:text-slate-200">VH Settings</span>
                    <Zap className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                  </button>
                </div>
              </div>

              <div className={jigsawRowClass}>
                <span>Restart last trade on error (bot ignores the unsuccessful trade):</span>
                <input
                  type="checkbox"
                  checked={botConfig.restartLastTradeOnError}
                  onChange={(e) => patchConfig({ restartLastTradeOnError: e.target.checked })}
                  className="w-3.5 h-3.5 accent-[#0f4c64]"
                />
              </div>

              {/* Sub-bar: Run once at start */}
              <div className="bg-[#0f4c64] text-white px-3 py-1.5 rounded-t text-xs font-bold mt-2">
                Run once at start:
              </div>
              <div className="pl-2 sm:pl-3 space-y-1">
                <div className={jigsawRowClass}>
                  <span>set</span>
                  <span className={`${pillSelectClass} inline-flex items-center`}>Stake ▾</span>
                  <span>to</span>
                  <input
                    type="number"
                    min={0.35}
                    step={0.1}
                    value={botConfig.stake}
                    onChange={(e) => patchConfig({ stake: Math.max(0.35, Number(e.target.value) || 0.35) })}
                    className={`${pillInputClass} w-16`}
                  />
                </div>

                <div className={jigsawRowClass}>
                  <span>set</span>
                  <span className={`${pillSelectClass} inline-flex items-center`}>Initial Prediction ▾</span>
                  <span>to</span>
                  <input
                    type="number"
                    min={0}
                    max={9}
                    value={botConfig.initialPrediction}
                    onChange={(e) =>
                      patchConfig({ initialPrediction: Math.max(0, Math.min(9, Number(e.target.value) || 0)) })
                    }
                    className={`${pillInputClass} w-14`}
                  />
                </div>

                <div className={jigsawRowClass}>
                  <span>set</span>
                  <span className={`${pillSelectClass} inline-flex items-center`}>Recovery Prediction ▾</span>
                  <span>to</span>
                  <input
                    type="number"
                    min={0}
                    max={9}
                    value={botConfig.recoveryPrediction}
                    onChange={(e) =>
                      patchConfig({ recoveryPrediction: Math.max(0, Math.min(9, Number(e.target.value) || 0)) })
                    }
                    className={`${pillInputClass} w-14`}
                  />
                </div>

                <div className={jigsawRowClass}>
                  <span>set</span>
                  <span className={`${pillSelectClass} inline-flex items-center`}>Entry Point Digit ▾</span>
                  <span>to</span>
                  <input
                    type="number"
                    min={0}
                    max={9}
                    value={botConfig.entryPointDigit}
                    onChange={(e) =>
                      patchConfig({ entryPointDigit: Math.max(0, Math.min(9, Number(e.target.value) || 0)) })
                    }
                    className={`${pillInputClass} w-14`}
                  />
                </div>

                <div className={jigsawRowClass}>
                  <span>set</span>
                  <span className={`${pillSelectClass} inline-flex items-center`}>Martingale ▾</span>
                  <span>to</span>
                  <input
                    type="number"
                    min={1}
                    step={0.5}
                    value={botConfig.martingale}
                    onChange={(e) => patchConfig({ martingale: Math.max(1, Number(e.target.value) || 1) })}
                    className={`${pillInputClass} w-14`}
                  />
                </div>

                <div className={jigsawRowClass}>
                  <span>set</span>
                  <span className={`${pillSelectClass} inline-flex items-center`}>Number of Wins ▾</span>
                  <span>to</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={botConfig.numberOfWins}
                    onChange={(e) => patchConfig({ numberOfWins: Math.max(1, Number(e.target.value) || 1) })}
                    className={`${pillInputClass} w-16`}
                  />
                </div>

                <div className={jigsawRowClass}>
                  <span>set</span>
                  <span className={`${pillSelectClass} inline-flex items-center`}>Stop Loss ▾</span>
                  <span>to</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={botConfig.stopLoss}
                    onChange={(e) => patchConfig({ stopLoss: Math.max(1, Number(e.target.value) || 1) })}
                    className={`${pillInputClass} w-16`}
                  />
                </div>

                <div className={jigsawRowClass}>
                  <span>set</span>
                  <span className={`${pillSelectClass} inline-flex items-center`}>Use Martingale ▾</span>
                  <span>to</span>
                  <select
                    value={botConfig.useMartingale ? 'true' : 'false'}
                    onChange={(e) => patchConfig({ useMartingale: e.target.value === 'true' })}
                    className={pillSelectClass}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setFixedVarsOpen((v) => !v)}
                    className="rounded border border-slate-400/60 bg-[#dfe2e6] dark:bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200"
                  >
                    Fixed Variables {fixedVarsOpen ? '▾' : '▸'}
                  </button>
                  {fixedVarsOpen && (
                    <div className="mt-1 grid sm:grid-cols-2 gap-2 rounded border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900 p-2.5">
                      <label className="flex items-center justify-between gap-2">
                        <span>Take Profit Target (%)</span>
                        <input
                          type="number"
                          step="0.01"
                          value={botConfig.tpPct}
                          onChange={(e) => patchConfig({ tpPct: Number(e.target.value) })}
                          className={`${pillInputClass} w-20`}
                        />
                      </label>
                      <label className="flex items-center justify-between gap-2">
                        <span>Stop Loss Trigger (%)</span>
                        <input
                          type="number"
                          step="0.01"
                          value={botConfig.slPct}
                          onChange={(e) => patchConfig({ slPct: Number(e.target.value) })}
                          className={`${pillInputClass} w-20`}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {/* Sub-bar: Trade options */}
              <div className="bg-[#0f4c64] text-white px-3 py-1.5 rounded-t text-xs font-bold mt-2">
                Trade options:
              </div>
              <div className={`${jigsawRowClass} ml-2 sm:ml-3`}>
                <span className="font-semibold">Duration:</span>
                <select
                  value={botConfig.durationUnit}
                  onChange={(e) => patchConfig({ durationUnit: e.target.value as SharedBotConfig['durationUnit'] })}
                  className={pillSelectClass}
                >
                  <option value="t">Ticks</option>
                  <option value="s">Seconds</option>
                  <option value="m">Minutes</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={botConfig.duration}
                  onChange={(e) => patchConfig({ duration: Math.max(1, Number(e.target.value) || 1) })}
                  className={`${pillInputClass} w-12`}
                />

                <span className="font-semibold">Stake: USD</span>
                <span className={pillSelectClass}>Stake ({botConfig.stake})</span>
                <span className="text-[10px] text-slate-600 dark:text-slate-300">(min: 0.35 - max: 50000)</span>

                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <span>Trade each tick:</span>
                  <input
                    type="checkbox"
                    checked={botConfig.tradeEachTick}
                    onChange={(e) => patchConfig({ tradeEachTick: e.target.checked })}
                    className="w-3.5 h-3.5 accent-[#0f4c64]"
                  />
                </label>

                <span>Prediction:</span>
                <span className={pillSelectClass}>Prediction ({botConfig.initialPrediction})</span>
              </div>
            </div>
          </div>

          {/* =====================================================================
              BLOCK 2: Dark-Teal (#0f4c64) "2. Purchase conditions" Blockly Structure
              ===================================================================== */}
          <div className="border-l-[10px] border-[#0f4c64] rounded-md overflow-hidden shadow-xs">
            <div className="bg-[#0f4c64] text-white px-3 py-2 text-xs font-bold flex items-center gap-2">
              <ShoppingBag className="w-3.5 h-3.5 opacity-90" />
              <span>2. Purchase conditions</span>
            </div>

            <div className="bg-[#e6e8ec] dark:bg-slate-800/90 p-2.5 sm:p-3 space-y-2 text-[11px] text-slate-800 dark:text-slate-100">
              {/* IF Condition Pill Row */}
              <div className={jigsawRowClass}>
                <span className="font-bold">if</span>
                <select
                  value={botConfig.entrySignalMode ? 'entry_signal' : 'always'}
                  onChange={(e) => patchConfig({ entrySignalMode: e.target.value === 'entry_signal' })}
                  className={pillSelectClass}
                >
                  <option value="entry_signal">Entry Signal</option>
                  <option value="always">Immediate Tick</option>
                </select>
                <select
                  value={botConfig.conditionJoin}
                  onChange={(e) => patchConfig({ conditionJoin: e.target.value as 'or' | 'and' })}
                  className={pillSelectClass}
                >
                  <option value="or">or</option>
                  <option value="and">and</option>
                </select>
                <span>Last</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={botConfig.conditionLookback}
                  onChange={(e) =>
                    patchConfig({ conditionLookback: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })
                  }
                  className={`${pillInputClass} w-12`}
                />
                <span>digits are</span>
                <select
                  value={botConfig.conditionComparator}
                  onChange={(e) =>
                    patchConfig({
                      conditionComparator: e.target.value as SharedBotConfig['conditionComparator']
                    })
                  }
                  className={pillSelectClass}
                >
                  <option value=">=">greater than or equal to</option>
                  <option value="<=">less than or equal to</option>
                  <option value="==">equal to</option>
                  <option value="!=">not equal to</option>
                  <option value=">">greater than</option>
                  <option value="<">less than</option>
                </select>
                <span>digit</span>
                <input
                  type="number"
                  min={0}
                  max={9}
                  value={botConfig.conditionDigit}
                  onChange={(e) =>
                    patchConfig({ conditionDigit: Math.max(0, Math.min(9, Number(e.target.value) || 0)) })
                  }
                  className={`${pillInputClass} w-12`}
                />
                <span className="font-bold">then</span>
              </div>

              {/* Nested Action Blocks */}
              <div className="pl-4 sm:pl-6 space-y-1.5">
                <div className={jigsawRowClass}>
                  <span>set</span>
                  <span className={pillSelectClass}>Entry Signal ▾</span>
                  <span>to</span>
                  <select
                    value={botConfig.entrySignalMode ? 'true' : 'false'}
                    onChange={(e) => patchConfig({ entrySignalMode: e.target.value === 'true' })}
                    className={pillSelectClass}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </div>

                <div className="rounded border border-slate-400/50 bg-[#dfe2e6] dark:bg-slate-900/70 p-2.5 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">Purchase</span>
                    <select
                      value={botConfig.purchaseAction}
                      onChange={(e) =>
                        patchConfig({ purchaseAction: e.target.value as SharedBotConfig['purchaseAction'] })
                      }
                      className={pillSelectClass}
                    >
                      <option value="Under">Under</option>
                      <option value="Over">Over</option>
                      <option value="Even">Even</option>
                      <option value="Odd">Odd</option>
                      <option value="Rise">Rise</option>
                      <option value="Fall">Fall</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span>Allow Bulk Purchase:</span>
                    <select
                      value={botConfig.allowBulkPurchase ? 'Yes' : 'No'}
                      onChange={(e) => patchConfig({ allowBulkPurchase: e.target.value === 'Yes' })}
                      className={pillSelectClass}
                    >
                      <option value="No">No</option>
                      <option value="Yes">Yes</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span>No. of Trades:</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={botConfig.bulkTradesCount}
                      onChange={(e) =>
                        patchConfig({ bulkTradesCount: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })
                      }
                      className={`${pillInputClass} w-14`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Blocks Popover */}
      {blocksDrawerOpen && (
        <div className="fixed left-14 top-36 z-40 w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between font-bold">
            <span>Strategy Building Blocks</span>
            <button type="button" onClick={() => setBlocksDrawerOpen(false)}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              applyAiGoal(
                {
                  botName: 'V90_Under8_Recovery5',
                  symbol: '1HZ90V',
                  tradeType: 'DIGITUNDER',
                  contractTypeLabel: 'Under',
                  purchaseAction: 'Under',
                  initialPrediction: 8,
                  recoveryPrediction: 5,
                  stake: 0.5,
                  martingale: 2,
                  useMartingale: true
                },
                'V90 Under 8 Recovery 5'
              );
              setBlocksDrawerOpen(false);
            }}
            className="w-full text-left px-2.5 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-sky-50 font-semibold"
          >
            Load V90 (1s) Under 8 / Rec 5
          </button>
          <button
            type="button"
            onClick={() => {
              applyAiGoal(
                {
                  botName: 'V100_Over4_Bulk3',
                  symbol: 'R_100',
                  tradeType: 'DIGITOVER',
                  contractTypeLabel: 'Over',
                  purchaseAction: 'Over',
                  initialPrediction: 4,
                  recoveryPrediction: 2,
                  stake: 1,
                  allowBulkPurchase: true,
                  bulkTradesCount: 3
                },
                'V100 Over 4 Bulk 3'
              );
              setBlocksDrawerOpen(false);
            }}
            className="w-full text-left px-2.5 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-sky-50 font-semibold"
          >
            Load V100 Over 4 (3x Bulk)
          </button>
        </div>
      )}

      {/* AI Bot Generator Modal */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md p-5 space-y-4 border border-slate-200 dark:border-slate-800 shadow-2xl text-xs">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base flex items-center gap-2 text-[#00a884]">
                <Sparkles className="w-4 h-4" />
                <span>AI Bot Generator</span>
              </h3>
              <button type="button" onClick={() => setAiModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <p className="text-slate-500">
              Describe your target strategy or pick a verified Blockly preset to populate all blocks automatically.
            </p>
            <textarea
              rows={3}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  applyAiGoal(
                    {
                      botName: 'AI_Over4_Hit_n_Run',
                      symbol: 'R_100',
                      tradeType: 'DIGITOVER',
                      contractTypeLabel: 'Over',
                      purchaseAction: 'Over',
                      initialPrediction: 4,
                      recoveryPrediction: 2,
                      stake: 1,
                      martingale: 2
                    },
                    'Over 4 Hit & Run'
                  )
                }
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Over 4 Sniper Preset
              </button>
              <button
                type="button"
                onClick={() =>
                  applyAiGoal(
                    {
                      botName: 'AI_Under8_Recovery5',
                      symbol: '1HZ90V',
                      tradeType: 'DIGITUNDER',
                      contractTypeLabel: 'Under',
                      purchaseAction: 'Under',
                      initialPrediction: 8,
                      recoveryPrediction: 5,
                      stake: 0.5,
                      martingale: 2
                    },
                    'Under 8 / Rec 5'
                  )
                }
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Under 8 / Rec 5 Preset
              </button>
            </div>
            <button
              type="button"
              onClick={() => applyAiGoal()}
              className="w-full py-2.5 rounded-lg bg-[#00a884] hover:bg-[#008f70] text-white font-bold"
            >
              Generate Blockly Strategy
            </button>
          </div>
        </div>
      )}

      {/* Virtual Hook Settings Modal */}
      {vhModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm p-5 space-y-3 border border-slate-200 dark:border-slate-800 shadow-2xl text-xs">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-amber-500" />
                <span>Virtual Hook Settings</span>
              </h3>
              <button type="button" onClick={() => setVhModalOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="flex items-center justify-between">
              <span>Enable Virtual Hook Pre-Check</span>
              <input
                type="checkbox"
                checked={botConfig.virtualHook}
                onChange={(e) => patchConfig({ virtualHook: e.target.checked })}
                className="accent-[#0f4c64]"
              />
            </label>
            <label className="flex items-center justify-between">
              <span>Wait for Virtual Losses before Real Entry</span>
              <input
                type="number"
                min={0}
                max={10}
                value={botConfig.virtualHookLosses}
                onChange={(e) =>
                  patchConfig({ virtualHookLosses: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })
                }
                className="w-16 rounded border px-2 py-1 text-center font-mono bg-transparent"
              />
            </label>
            <button
              type="button"
              onClick={() => setVhModalOpen(false)}
              className="w-full py-2 rounded-lg bg-[#0f4c64] text-white font-bold"
            >
              Apply Virtual Hook
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
