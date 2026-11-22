import { isStorageReady, pool } from '../database/pool';
import { derivConnectionManager } from '../integrations/deriv/connection-manager';
import { fetchTickHistory } from '../integrations/deriv/candles';
import {
  closeDerivContract,
  executeDerivTrade,
  getAuthorizedAccountForTrading,
  registerDerivSettlementHandler,
  syncOpenDerivOrdersForUser
} from '../integrations/deriv/trade-execution';
import { ensureLiveTickSubscription } from './market-data-service';
import { createNotification } from './notification-service';

export interface BotEntryCondition {
  enabled?: boolean;
  lookback?: number;
  comparator?: '>=' | '<=' | '==' | '!=' | '>' | '<';
  digit?: number;
  tradeEachTick?: boolean;
}

export interface StartBotOptions {
  userId: string;
  symbol: string;
  botName: string;
  stake: number;
  tpPct?: number;
  slPct?: number;
  tpUsd?: number | null;
  slUsd?: number | null;
  stopLossUsd?: number | null;
  maxWins?: number | null;
  connectedAccountId?: string | null;
  contractType?: string;
  barrier?: string | number;
  recoveryPrediction?: string | number;
  duration?: number;
  durationUnit?: 't' | 's' | 'm' | 'h' | 'd';
  multiplier?: number;
  martingale?: number;
  useMartingale?: boolean;
  allowBulkPurchase?: boolean;
  bulkTradesCount?: number;
  fastExecution?: boolean;
  entryCondition?: BotEntryCondition;
}

interface ActiveBotSession {
  userId: string;
  symbol: string;
  botName: string;
  baseStake: number;
  currentStake: number;
  tpPct: number;
  slPct: number;
  tpUsd: number | null;
  slUsd: number | null;
  stopLossUsd: number | null;
  maxWins: number | null;
  connectedAccountId: string | null;
  contractType?: string;
  barrier?: string | number;
  initialPrediction?: string | number;
  recoveryPrediction?: string | number;
  duration: number;
  durationUnit: 't' | 's' | 'm' | 'h' | 'd';
  multiplier: number;
  martingale: number;
  useMartingale: boolean;
  allowBulkPurchase: boolean;
  bulkTradesCount: number;
  fastExecution: boolean;
  entryCondition: BotEntryCondition;
  entrySignalTriggered: boolean;
  lastPrices: number[];
  pipSize: number;
  isRunning: boolean;
  startedAt: string;
  tradesCount: number;
  wins: number;
  losses: number;
  sessionPnl: number;
  lastAction: string;
  lastQuote: number | null;
}

const activeBots = new Map<string, ActiveBotSession>();
const closingOrderLocks = new Set<string>();
const botTradeLocks = new Set<string>();
const virtualTickCounters = new Map<string, number>();
let listenerAttached = false;
let broadcastFn: ((userId: string, event: unknown) => void) | null = null;

function applyBotOrderSettlement(
  userId: string,
  source: string,
  symbol: string,
  pnl: number
): ActiveBotSession | undefined {
  const botSession = activeBots.get(userId);
  if (!botSession || source !== 'bot') return botSession;

  botSession.sessionPnl += pnl;
  if (pnl >= 0) {
    botSession.wins += 1;
    botSession.currentStake = botSession.baseStake;
    botSession.barrier = botSession.initialPrediction;
  } else {
    botSession.losses += 1;
    if (botSession.useMartingale && botSession.martingale > 1) {
      botSession.currentStake = Number((botSession.currentStake * botSession.martingale).toFixed(2));
    }
    if (botSession.recoveryPrediction !== undefined) {
      botSession.barrier = botSession.recoveryPrediction;
    }
  }
  botSession.lastAction = `Closed ${symbol} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD)`;

  if (botSession.maxWins !== null && botSession.wins >= botSession.maxWins) {
    botSession.isRunning = false;
    botSession.lastAction = `Target reached: ${botSession.wins} win(s) completed (+$${botSession.sessionPnl.toFixed(2)})`;
    activeBots.delete(userId);
    broadcastFn?.(userId, {
      type: 'bot_stopped',
      reason: botSession.lastAction,
      botStatus: formatBotStatus(botSession)
    });
  } else if (
    botSession.stopLossUsd !== null &&
    botSession.sessionPnl <= -Math.abs(botSession.stopLossUsd)
  ) {
    botSession.isRunning = false;
    botSession.lastAction = `Stop Loss reached ($${botSession.sessionPnl.toFixed(2)})`;
    activeBots.delete(userId);
    broadcastFn?.(userId, {
      type: 'bot_stopped',
      reason: botSession.lastAction,
      botStatus: formatBotStatus(botSession)
    });
  }

  return botSession;
}

function extractLastDigit(quote: number, pipSize = 2): number {
  const formatted = quote.toFixed(Math.max(0, Math.min(8, pipSize)));
  const ch = formatted.charAt(formatted.length - 1);
  const d = Number(ch);
  return Number.isNaN(d) ? 0 : d;
}

function checkDigitCondition(session: ActiveBotSession): boolean {
  const cond = session.entryCondition;
  if (!cond || !cond.enabled || session.entrySignalTriggered || cond.tradeEachTick) {
    return true;
  }
  const lookback = Math.max(1, Math.min(10, Number(cond.lookback ?? 1)));
  const target = Math.max(0, Math.min(9, Number(cond.digit ?? 8)));
  const cmp = cond.comparator ?? '>=';
  const recent = session.lastPrices.slice(-lookback);
  if (recent.length === 0) return true;

  const digits = recent.map((p) => extractLastDigit(p, session.pipSize));
  const matched = digits.every((d) => {
    if (cmp === '>=') return d >= target;
    if (cmp === '<=') return d <= target;
    if (cmp === '==') return d === target;
    if (cmp === '!=') return d !== target;
    if (cmp === '>') return d > target;
    if (cmp === '<') return d < target;
    return true;
  });

  if (matched) {
    session.entrySignalTriggered = true;
  }
  return matched;
}

function resolveBotSignal(session: ActiveBotSession, quote: number): {
  side: 'BUY' | 'SELL';
  contractType: string;
  barrier?: string | number;
  reason: string;
} {
  const prices = session.lastPrices;
  const recentWindow = prices.slice(-6, -1);
  const avg =
    recentWindow.length > 0 ? recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length : quote;
  const momentumUp = quote >= avg;
  const digit = extractLastDigit(quote, session.pipSize);
  const requested = session.contractType?.toUpperCase();

  if (requested === 'DIGITOVER') {
    const barrier = session.barrier !== undefined ? String(session.barrier) : '4';
    return {
      side: 'BUY',
      contractType: 'DIGITOVER',
      barrier,
      reason: `Over ${barrier} (last digit ${digit})`
    };
  }
  if (requested === 'DIGITUNDER') {
    const barrier = session.barrier !== undefined ? String(session.barrier) : '5';
    return {
      side: 'SELL',
      contractType: 'DIGITUNDER',
      barrier,
      reason: `Under ${barrier} (last digit ${digit})`
    };
  }
  if (requested === 'DIGITEVEN' || requested === 'DIGITODD') {
    return {
      side: requested === 'DIGITEVEN' ? 'BUY' : 'SELL',
      contractType: requested,
      reason: `${requested === 'DIGITEVEN' ? 'Even' : 'Odd'} parity signal (last digit ${digit})`
    };
  }
  if (requested === 'DIGITDIFF' || requested === 'DIGITMATCH') {
    const barrier = session.barrier !== undefined ? String(session.barrier) : String(digit);
    return {
      side: 'BUY',
      contractType: requested,
      barrier,
      reason: `${requested} digit ${barrier}`
    };
  }
  if (requested === 'CALL' || requested === 'PUT') {
    const contractType = momentumUp ? 'CALL' : 'PUT';
    return {
      side: contractType === 'CALL' ? 'BUY' : 'SELL',
      contractType,
      reason: `Rise/Fall ${contractType} (${quote.toFixed(session.pipSize)} vs avg ${avg.toFixed(session.pipSize)})`
    };
  }

  const side: 'BUY' | 'SELL' = momentumUp ? 'BUY' : 'SELL';
  const contractType = requested === 'MULTUP' || requested === 'MULTDOWN'
    ? requested
    : side === 'BUY'
      ? 'MULTUP'
      : 'MULTDOWN';

  return {
    side,
    contractType,
    reason: `Momentum ${side} (${quote.toFixed(session.pipSize)} vs avg ${avg.toFixed(session.pipSize)})`
  };
}

async function evaluateAndExecuteBotTick(session: ActiveBotSession, quote: number, isInitialBurst = false) {
  if (!session.isRunning || !isStorageReady) return;
  if (botTradeLocks.has(session.userId)) return;

  // Enforce Number of Wins target & Stop Loss USD hard stop
  if (session.maxWins !== null && session.wins >= session.maxWins) {
    session.isRunning = false;
    session.lastAction = `Target reached: ${session.wins} win(s) completed (+$${session.sessionPnl.toFixed(2)})`;
    activeBots.delete(session.userId);
    broadcastFn?.(session.userId, { type: 'bot_stopped', reason: session.lastAction, botStatus: formatBotStatus(session) });
    return;
  }
  if (session.stopLossUsd !== null && session.sessionPnl <= -Math.abs(session.stopLossUsd)) {
    session.isRunning = false;
    session.lastAction = `Stop Loss reached ($${session.sessionPnl.toFixed(2)})`;
    activeBots.delete(session.userId);
    broadcastFn?.(session.userId, { type: 'bot_stopped', reason: session.lastAction, botStatus: formatBotStatus(session) });
    return;
  }

  session.lastQuote = quote;
  session.lastPrices.push(quote);
  if (session.lastPrices.length > 25) session.lastPrices.shift();

  if (!isInitialBurst && !checkDigitCondition(session)) {
    const digit = extractLastDigit(quote, session.pipSize);
    session.lastAction = `Scanning digit ${digit} against entry rule (${session.entryCondition.comparator ?? '>='} ${session.entryCondition.digit ?? 8})`;
    return;
  }

  const existingOpen = await pool.query(
    `SELECT id FROM virtual_orders WHERE user_id = $1 AND source = 'bot' AND status = 'OPEN' LIMIT 1`,
    [session.userId]
  );
  if (existingOpen.rows.length > 0) return;

  botTradeLocks.add(session.userId);
  try {
    const signal = resolveBotSignal(session, quote);
    const tp = signal.side === 'BUY' ? quote * (1 + session.tpPct / 100) : quote * (1 - session.tpPct / 100);
    const sl = signal.side === 'BUY' ? quote * (1 - session.slPct / 100) : quote * (1 + session.slPct / 100);
    const tradesToOpen = session.allowBulkPurchase
      ? Math.max(1, Math.min(10, Number(session.bulkTradesCount || 1)))
      : 1;

    const account = await getAuthorizedAccountForTrading(session.userId, session.connectedAccountId);
    if (account && account.grantedScopes.includes('trade')) {
      try {
        for (let i = 0; i < tradesToOpen; i++) {
          const exec = await executeDerivTrade({
            userId: session.userId,
            connectedAccountId: account.id,
            symbol: session.symbol,
            side: signal.side,
            stake: session.currentStake,
            entryPrice: quote,
            stopLoss: sl,
            takeProfit: tp,
            stopLossUsd: session.slUsd,
            takeProfitUsd: session.tpUsd,
            contractType: signal.contractType,
            duration: session.duration,
            durationUnit: session.durationUnit,
            barrier: signal.barrier,
            multiplier: session.multiplier
          });

          const resolvedEntry = exec.spotPrice > 0 ? exec.spotPrice : quote;
          const inserted = await pool.query(
            `INSERT INTO virtual_orders
               (user_id, connected_account_id, deriv_contract_id, execution_mode, contract_type, payout,
                source, bot_name, symbol, side, stake, entry_price, stop_loss, take_profit)
             VALUES ($1, $2, $3, $4, $5, $6, 'bot', $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
            [
              session.userId,
              exec.connectedAccountId,
              exec.contractId,
              exec.executionMode,
              exec.contractType,
              exec.payout,
              session.botName,
              session.symbol,
              signal.side,
              exec.buyPrice,
              resolvedEntry,
              sl,
              tp
            ]
          );
          session.tradesCount += 1;
          session.lastAction = `Placed ${tradesToOpen > 1 ? `${i + 1}/${tradesToOpen} ` : ''}${exec.contractType} #${exec.contractId} ($${exec.buyPrice.toFixed(2)}) — ${signal.reason}`;
          broadcastFn?.(session.userId, {
            type: 'bot_order_opened',
            order: inserted.rows[0],
            botStatus: formatBotStatus(session)
          });
        }
        return;
      } catch (derivErr) {
        session.isRunning = false;
        session.lastAction = `Stopped: ${(derivErr as Error).message}`;
        activeBots.delete(session.userId);
        await createNotification(
          session.userId,
          'system',
          `Bot Stopped (${session.botName})`,
          (derivErr as Error).message
        );
        broadcastFn?.(session.userId, { type: 'bot_stopped', reason: (derivErr as Error).message });
        return;
      }
    }

    const isShortTermContract =
      signal.contractType.startsWith('DIGIT') ||
      signal.contractType === 'CALL' ||
      signal.contractType === 'PUT';
    const contractMeta = isShortTermContract
      ? {
          barrier: signal.barrier !== undefined && signal.barrier !== '' ? String(signal.barrier) : null,
          durationTicks: Math.max(1, Number(session.duration || 1)),
          ticksElapsed: 0
        }
      : null;

    for (let i = 0; i < tradesToOpen; i++) {
      const inserted = await pool.query(
        `INSERT INTO virtual_orders
           (user_id, execution_mode, contract_type, source, bot_name, symbol, side, stake, entry_price, stop_loss, take_profit, contract_meta)
         VALUES ($1, 'virtual', $2, 'bot', $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING *`,
        [
          session.userId,
          signal.contractType,
          session.botName,
          session.symbol,
          signal.side,
          session.currentStake,
          quote,
          sl,
          tp,
          contractMeta ? JSON.stringify(contractMeta) : null
        ]
      );
      session.tradesCount += 1;
      session.lastAction = `Placed ${tradesToOpen > 1 ? `${i + 1}/${tradesToOpen} ` : ''}${signal.contractType} ($${session.currentStake.toFixed(2)}) — ${signal.reason}`;
      broadcastFn?.(session.userId, {
        type: 'bot_order_opened',
        order: inserted.rows[0],
        botStatus: formatBotStatus(session)
      });
    }
  } finally {
    botTradeLocks.delete(session.userId);
  }
}

function formatBotStatus(s: ActiveBotSession) {
  return {
    running: s.isRunning,
    symbol: s.symbol,
    botName: s.botName,
    stake: s.baseStake,
    currentStake: s.currentStake,
    contractType: s.contractType ?? null,
    barrier: s.barrier ?? null,
    recoveryPrediction: s.recoveryPrediction ?? null,
    duration: s.duration,
    durationUnit: s.durationUnit,
    multiplier: s.multiplier,
    martingale: s.martingale,
    useMartingale: s.useMartingale,
    tpPct: s.tpPct,
    slPct: s.slPct,
    tpUsd: s.tpUsd,
    slUsd: s.slUsd,
    stopLossUsd: s.stopLossUsd,
    maxWins: s.maxWins,
    allowBulkPurchase: s.allowBulkPurchase,
    bulkTradesCount: s.bulkTradesCount,
    fastExecution: s.fastExecution,
    tradesCount: s.tradesCount,
    wins: s.wins,
    losses: s.losses,
    sessionPnl: Number(s.sessionPnl.toFixed(2)),
    lastAction: s.lastAction,
    lastQuote: s.lastQuote,
    startedAt: s.startedAt
  };
}

export function attachTickEvaluator(broadcastToUser: (userId: string, event: unknown) => void) {
  broadcastFn = broadcastToUser;
  if (listenerAttached) return;
  listenerAttached = true;

  registerDerivSettlementHandler(async (info) => {
    applyBotOrderSettlement(info.userId, info.source, info.symbol, info.pnl);
  });

  // Poll live open Deriv contracts (including 1-tick / N-tick Digit & Rise/Fall trades) every 5s
  let derivPollBusy = false;
  setInterval(async () => {
    if (derivPollBusy || !isStorageReady) return;
    derivPollBusy = true;
    try {
      const q = await pool.query(
        `SELECT DISTINCT user_id FROM virtual_orders WHERE status = 'OPEN' AND deriv_contract_id IS NOT NULL`
      );
      for (const row of q.rows) {
        await syncOpenDerivOrdersForUser(row.user_id).catch(() => {});
      }
    } catch {
      // Ignore transient polling errors
    } finally {
      derivPollBusy = false;
    }
  }, 5000);

  const client = derivConnectionManager.getMarketClient();
  client.socket.on('tick', async (msg: { tick?: { symbol: string; quote: number; epoch: number; pip_size?: number } }) => {
    if (!msg.tick || !isStorageReady) return;
    const { symbol, quote } = msg.tick;

    try {
      // 1. Evaluate all OPEN MT5/Bot/Virtual orders on live Deriv ticks
      const openOrders = await pool.query(
        `SELECT * FROM virtual_orders WHERE status = 'OPEN' AND symbol = $1`,
        [symbol]
      );

      for (const order of openOrders.rows) {
        if (closingOrderLocks.has(order.id)) continue;

        const entry = Number(order.entry_price);
        const stake = Number(order.stake);
        const cType = String(order.contract_type || '').toUpperCase();
        const meta = (order.contract_meta && typeof order.contract_meta === 'object'
          ? order.contract_meta
          : null) as { barrier?: string | number | null; durationTicks?: number; ticksElapsed?: number } | null;

        const isShortTermVirtual =
          !order.deriv_contract_id &&
          (Boolean(meta?.durationTicks) ||
            cType.startsWith('DIGIT') ||
            cType === 'CALL' ||
            cType === 'PUT');

        if (isShortTermVirtual) {
          const targetTicks = Math.max(1, Number(meta?.durationTicks ?? 1));
          const nextTicks = (virtualTickCounters.get(order.id) ?? Number(meta?.ticksElapsed ?? 0)) + 1;
          if (nextTicks < targetTicks) {
            virtualTickCounters.set(order.id, nextTicks);
            continue;
          }

          closingOrderLocks.add(order.id);
          try {
            const pipSize = msg.tick.pip_size ?? 2;
            const lastDigit = extractLastDigit(quote, pipSize);
            const barrierNum = Number(meta?.barrier ?? 4);
            let won = false;
            let winRate = 0.95;

            if (cType === 'DIGITOVER') {
              won = lastDigit > barrierNum;
              winRate = 0.85;
            } else if (cType === 'DIGITUNDER') {
              won = lastDigit < barrierNum;
              winRate = 0.85;
            } else if (cType === 'DIGITEVEN') {
              won = lastDigit % 2 === 0;
              winRate = 0.95;
            } else if (cType === 'DIGITODD') {
              won = lastDigit % 2 === 1;
              winRate = 0.95;
            } else if (cType === 'DIGITMATCH') {
              won = lastDigit === barrierNum;
              winRate = 8.0;
            } else if (cType === 'DIGITDIFF') {
              won = lastDigit !== barrierNum;
              winRate = 0.09;
            } else if (cType === 'CALL') {
              won = quote > entry;
              winRate = 0.95;
            } else if (cType === 'PUT') {
              won = quote < entry;
              winRate = 0.95;
            }

            const pnl = won ? Number((stake * winRate).toFixed(2)) : Number((-stake).toFixed(2));
            const finalStatus: 'CLOSED_TP' | 'CLOSED_SL' = won ? 'CLOSED_TP' : 'CLOSED_SL';
            virtualTickCounters.delete(order.id);

            const upd = await pool.query(
              `UPDATE virtual_orders SET status = $1, exit_price = $2, pnl = $3, closed_at = NOW() WHERE id = $4 AND status = 'OPEN' RETURNING id`,
              [finalStatus, quote, pnl, order.id]
            );

            if (upd.rows.length > 0) {
              await pool.query(
                `UPDATE users SET virtual_workspace_balance = GREATEST(0, virtual_workspace_balance + $1) WHERE id = $2`,
                [pnl, order.user_id]
              );
              const botSession = applyBotOrderSettlement(
                order.user_id,
                String(order.source || 'manual'),
                symbol,
                pnl
              );
              await createNotification(
                order.user_id,
                'trade_sim',
                `${cType} ${won ? 'Won' : 'Lost'} (${symbol})`,
                `Virtual ${cType} settled at ${quote} (digit ${lastDigit}) | P/L: ${pnl >= 0 ? '+' : ''}${pnl} USD`
              );
              broadcastToUser(order.user_id, { type: 'account_updated' });
              broadcastToUser(order.user_id, {
                type: 'order_closed',
                orderId: order.id,
                symbol,
                status: finalStatus,
                exitPrice: quote,
                pnl,
                botStatus: botSession ? formatBotStatus(botSession) : undefined
              });
            }
          } finally {
            closingOrderLocks.delete(order.id);
          }
          continue;
        }

        const tp = order.take_profit ? Number(order.take_profit) : null;
        const sl = order.stop_loss ? Number(order.stop_loss) : null;

        let closeStatus: 'CLOSED_TP' | 'CLOSED_SL' | null = null;
        if (order.side === 'BUY') {
          if (tp !== null && quote >= tp) closeStatus = 'CLOSED_TP';
          else if (sl !== null && quote <= sl) closeStatus = 'CLOSED_SL';
        } else {
          if (tp !== null && quote <= tp) closeStatus = 'CLOSED_TP';
          else if (sl !== null && quote >= sl) closeStatus = 'CLOSED_SL';
        }

        if (closeStatus) {
          closingOrderLocks.add(order.id);
          try {
            let pnl: number;
            let finalExitPrice = quote;
            let finalStatus: 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL' = closeStatus;

            if (order.deriv_contract_id && order.connected_account_id) {
              const closed = await closeDerivContract({
                userId: order.user_id,
                connectedAccountId: order.connected_account_id,
                contractId: Number(order.deriv_contract_id),
                fallbackExitPrice: quote
              });
              pnl = closed.pnl;
              finalExitPrice = closed.exitPrice;
              finalStatus = closed.status === 'CLOSED_MANUAL' ? closeStatus : closed.status;
            } else {
              const pctMove = order.side === 'BUY' ? (quote - entry) / entry : (entry - quote) / entry;
              pnl = Number((stake * pctMove * 100).toFixed(2));
            }

            const upd = await pool.query(
              `UPDATE virtual_orders SET status = $1, exit_price = $2, pnl = $3, closed_at = NOW() WHERE id = $4 AND status = 'OPEN' RETURNING id`,
              [finalStatus, finalExitPrice, pnl, order.id]
            );

            if (upd.rows.length > 0) {
              if (!order.deriv_contract_id || !order.connected_account_id) {
                await pool.query(
                  `UPDATE users SET virtual_workspace_balance = GREATEST(0, virtual_workspace_balance + $1) WHERE id = $2`,
                  [pnl, order.user_id]
                );
                broadcastToUser(order.user_id, { type: 'account_updated' });
              }

              const botSession = applyBotOrderSettlement(
                order.user_id,
                String(order.source || 'manual'),
                String(order.symbol || symbol),
                pnl
              );

              await createNotification(
                order.user_id,
                'trade_sim',
                `${finalStatus === 'CLOSED_TP' ? 'Take Profit Hit' : 'Stop Loss Hit'} (${symbol})`,
                `${order.deriv_contract_id ? 'Deriv' : 'Virtual'} ${order.side} closed at ${finalExitPrice} | P/L: ${pnl >= 0 ? '+' : ''}${pnl} USD`
              );
              broadcastToUser(order.user_id, {
                type: 'order_closed',
                orderId: order.id,
                symbol,
                status: finalStatus,
                exitPrice: finalExitPrice,
                pnl,
                botStatus: botSession ? formatBotStatus(botSession) : undefined
              });
            }
          } finally {
            closingOrderLocks.delete(order.id);
          }
        }
      }

      // 2. Evaluate active Automated Bots on live Deriv market momentum (zero startup delay)
      for (const session of activeBots.values()) {
        if (!session.isRunning || session.symbol !== symbol) continue;
        if (msg.tick.pip_size !== undefined) {
          session.pipSize = Number(msg.tick.pip_size);
        }
        await evaluateAndExecuteBotTick(session, quote);
      }
    } catch {
      // Keep tick evaluator resilient on transient DB errors
    }
  });
}

export async function startBotSession(
  input: StartBotOptions | string,
  symbolArg?: string,
  botNameArg?: string,
  stakeArg?: number,
  tpPctArg = 0.08,
  slPctArg = 0.05,
  connectedAccountIdArg: string | null = null,
  contractTypeArg?: string
) {
  const opts: StartBotOptions =
    typeof input === 'string'
      ? {
          userId: input,
          symbol: symbolArg ?? 'R_100',
          botName: botNameArg ?? 'Pipflow Bot',
          stake: stakeArg ?? 10,
          tpPct: tpPctArg,
          slPct: slPctArg,
          connectedAccountId: connectedAccountIdArg,
          contractType: contractTypeArg
        }
      : input;

  await ensureLiveTickSubscription(opts.symbol);

  // Seed recent tick history immediately so bot places its first trade with zero delay
  let seededPrices: number[] = [];
  let pipSize = 2;
  try {
    const client = derivConnectionManager.getMarketClient();
    const hist = await fetchTickHistory(client, opts.symbol, 25);
    seededPrices = hist.prices.slice(-20);
    pipSize = hist.pipSize ?? 2;
  } catch {
    seededPrices = [];
  }

  const session: ActiveBotSession = {
    userId: opts.userId,
    symbol: opts.symbol,
    botName: opts.botName,
    baseStake: Math.max(0.35, Number(opts.stake || 10)),
    currentStake: Math.max(0.35, Number(opts.stake || 10)),
    tpPct: Number(opts.tpPct ?? 0.08),
    slPct: Number(opts.slPct ?? 0.05),
    tpUsd: opts.tpUsd ?? null,
    slUsd: opts.slUsd ?? null,
    stopLossUsd: opts.stopLossUsd !== undefined && opts.stopLossUsd !== null ? Number(opts.stopLossUsd) : null,
    maxWins: opts.maxWins !== undefined && opts.maxWins !== null ? Number(opts.maxWins) : null,
    connectedAccountId: opts.connectedAccountId ?? null,
    contractType: opts.contractType,
    barrier: opts.barrier,
    initialPrediction: opts.barrier,
    recoveryPrediction: opts.recoveryPrediction,
    duration: Math.max(1, Number(opts.duration ?? 5)),
    durationUnit: opts.durationUnit ?? 't',
    multiplier: Math.max(10, Number(opts.multiplier ?? 100)),
    martingale: Math.max(1, Number(opts.martingale ?? 1.5)),
    useMartingale: Boolean(opts.useMartingale),
    allowBulkPurchase: Boolean(opts.allowBulkPurchase),
    bulkTradesCount: Math.max(1, Math.min(10, Number(opts.bulkTradesCount ?? 1))),
    fastExecution: opts.fastExecution !== false,
    entryCondition: opts.entryCondition ?? { enabled: false },
    entrySignalTriggered: false,
    lastPrices: seededPrices,
    pipSize,
    isRunning: true,
    startedAt: new Date().toISOString(),
    tradesCount: 0,
    wins: 0,
    losses: 0,
    sessionPnl: 0,
    lastAction: 'Initialized — placing instant first order',
    lastQuote: seededPrices[seededPrices.length - 1] ?? null
  };

  activeBots.set(opts.userId, session);

  // Place the initial trade immediately without waiting for additional ticks
  const initialQuote = seededPrices[seededPrices.length - 1];
  if (initialQuote && initialQuote > 0) {
    evaluateAndExecuteBotTick(session, initialQuote, true).catch(() => {});
  }

  return formatBotStatus(session);
}

export function stopBotSession(userId: string) {
  const existing = activeBots.get(userId);
  if (existing) existing.isRunning = false;
  activeBots.delete(userId);
  return { running: false };
}

export async function closeAllBotOrders(userId: string, fallbackPriceMap?: Record<string, number>) {
  stopBotSession(userId);
  const openRes = await pool.query(
    `SELECT * FROM virtual_orders WHERE user_id = $1 AND source = 'bot' AND status = 'OPEN'`,
    [userId]
  );

  const closedOrders = [];
  let totalPnl = 0;

  for (const order of openRes.rows) {
    const fallbackPrice = fallbackPriceMap?.[order.symbol] ?? Number(order.entry_price);
    let exitPrice = fallbackPrice;
    let pnl = 0;
    let closeStatus: 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL' = 'CLOSED_MANUAL';

    if (order.deriv_contract_id && order.connected_account_id) {
      try {
        const closed = await closeDerivContract({
          userId,
          connectedAccountId: order.connected_account_id,
          contractId: Number(order.deriv_contract_id),
          fallbackExitPrice: fallbackPrice
        });
        exitPrice = closed.exitPrice;
        pnl = closed.pnl;
        closeStatus = closed.status;
      } catch {
        // Fallback to manual mark-to-market if contract already settled
        const entry = Number(order.entry_price);
        const pct = order.side === 'BUY' ? (fallbackPrice - entry) / entry : (entry - fallbackPrice) / entry;
        pnl = Number((Number(order.stake) * pct * 100).toFixed(2));
      }
    } else {
      const entry = Number(order.entry_price);
      const pct = order.side === 'BUY' ? (fallbackPrice - entry) / entry : (entry - fallbackPrice) / entry;
      pnl = Number((Number(order.stake) * pct * 100).toFixed(2));
      await pool.query(
        `UPDATE users SET virtual_workspace_balance = GREATEST(0, virtual_workspace_balance + $1) WHERE id = $2`,
        [pnl, userId]
      );
    }

    const updated = await pool.query(
      `UPDATE virtual_orders SET status = $1, exit_price = $2, pnl = $3, closed_at = NOW() WHERE id = $4 AND status = 'OPEN' RETURNING *`,
      [closeStatus, exitPrice, pnl, order.id]
    );
    if (updated.rows[0]) closedOrders.push(updated.rows[0]);
    totalPnl += pnl;
  }

  if (closedOrders.length > 0) {
    broadcastFn?.(userId, { type: 'account_updated' });
    broadcastFn?.(userId, { type: 'order_closed', pnl: Number(totalPnl.toFixed(2)) });
  }

  return {
    running: false,
    closedCount: closedOrders.length,
    totalPnl: Number(totalPnl.toFixed(2)),
    orders: closedOrders
  };
}

export function getBotStatus(userId: string) {
  const s = activeBots.get(userId);
  return s ? formatBotStatus(s) : { running: false };
}
