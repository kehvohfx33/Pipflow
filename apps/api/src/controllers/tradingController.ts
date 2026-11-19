import { Request, Response } from 'express';
import { pool } from '../database/pool';
import { ensureLiveTickSubscription } from '../services/market-data-service';
import { closeAllBotOrders, startBotSession, stopBotSession, getBotStatus } from '../services/bot-engine-service';
import { createNotification } from '../services/notification-service';
import { derivConnectionManager } from '../integrations/deriv/connection-manager';
import { fetchTickHistory } from '../integrations/deriv/candles';
import {
  closeDerivContract,
  executeDerivTrade,
  getAuthorizedAccountForTrading,
  LiveDerivContractSnapshot,
  syncOpenDerivOrdersForUser
} from '../integrations/deriv/trade-execution';

async function resolveFallbackSpotPrice(symbol: string, clientEntryPrice?: number): Promise<number> {
  const num = Number(clientEntryPrice ?? 0);
  if (Number.isFinite(num) && num > 0) return num;
  try {
    const client = derivConnectionManager.getMarketClient();
    const hist = await fetchTickHistory(client, symbol, 5);
    const last = hist.prices[hist.prices.length - 1];
    if (Number.isFinite(last) && last > 0) return last;
  } catch {
    // ignore
  }
  return 0;
}

export async function listStrategies(_req: Request, res: Response) {
  const q = await pool.query(`SELECT * FROM bot_strategies ORDER BY created_at ASC`);
  res.json({ strategies: q.rows });
}

export async function runBot(req: Request, res: Response) {
  const {
    symbol = 'R_100',
    botName = '07_Over_Hit_n_Run',
    stake = 10,
    tpPct = 0.08,
    slPct = 0.05,
    tpUsd = null,
    slUsd = null,
    stopLossUsd = null,
    maxWins = null,
    connectedAccountId = null,
    contractType,
    barrier,
    prediction,
    recoveryPrediction,
    duration,
    durationUnit,
    multiplier,
    martingale,
    useMartingale,
    allowBulkPurchase,
    bulkTradesCount,
    fastExecution,
    entryCondition
  } = req.body as {
    symbol?: string;
    botName?: string;
    stake?: number;
    tpPct?: number;
    slPct?: number;
    tpUsd?: number | null;
    slUsd?: number | null;
    stopLossUsd?: number | null;
    maxWins?: number | null;
    connectedAccountId?: string | null;
    contractType?: string;
    barrier?: string | number;
    prediction?: string | number;
    recoveryPrediction?: string | number;
    duration?: number;
    durationUnit?: 't' | 's' | 'm' | 'h' | 'd';
    multiplier?: number;
    martingale?: number;
    useMartingale?: boolean;
    allowBulkPurchase?: boolean;
    bulkTradesCount?: number;
    fastExecution?: boolean;
    entryCondition?: {
      enabled?: boolean;
      lookback?: number;
      comparator?: '>=' | '<=' | '==' | '!=' | '>' | '<';
      digit?: number;
      tradeEachTick?: boolean;
    };
  };
  try {
    const status = await startBotSession({
      userId: req.user!.userId,
      symbol,
      botName,
      stake: Number(stake),
      tpPct: Number(tpPct),
      slPct: Number(slPct),
      tpUsd: tpUsd !== null && tpUsd !== undefined ? Number(tpUsd) : null,
      slUsd: slUsd !== null && slUsd !== undefined ? Number(slUsd) : null,
      stopLossUsd: stopLossUsd !== null && stopLossUsd !== undefined ? Number(stopLossUsd) : null,
      maxWins: maxWins !== null && maxWins !== undefined ? Number(maxWins) : null,
      connectedAccountId,
      contractType,
      barrier: barrier ?? prediction,
      recoveryPrediction,
      duration: duration ? Number(duration) : undefined,
      durationUnit,
      multiplier: multiplier ? Number(multiplier) : undefined,
      martingale: martingale ? Number(martingale) : undefined,
      useMartingale,
      allowBulkPurchase,
      bulkTradesCount: bulkTradesCount ? Number(bulkTradesCount) : undefined,
      fastExecution,
      entryCondition
    });
    res.json(status);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}

export function stopBot(req: Request, res: Response) {
  res.json(stopBotSession(req.user!.userId));
}

export async function closeBotOrders(req: Request, res: Response) {
  const { prices } = (req.body || {}) as { prices?: Record<string, number> };
  try {
    const result = await closeAllBotOrders(req.user!.userId, prices);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export function botStatus(req: Request, res: Response) {
  res.json(getBotStatus(req.user!.userId));
}

export async function listOrders(req: Request, res: Response) {
  const liveContracts: Record<string, LiveDerivContractSnapshot> = await syncOpenDerivOrdersForUser(
    req.user!.userId
  ).catch(() => ({}));
  const q = await pool.query(
    `SELECT * FROM virtual_orders WHERE user_id = $1 ORDER BY opened_at DESC LIMIT 150`,
    [req.user!.userId]
  );
  res.json({ orders: q.rows, liveContracts });
}

export async function placeVirtualOrder(req: Request, res: Response) {
  const {
    symbol,
    side,
    stake,
    entryPrice,
    stopLoss,
    takeProfit,
    stopLossUsd,
    takeProfitUsd,
    connectedAccountId,
    executionMode,
    contractType,
    duration,
    durationUnit,
    barrier,
    multiplier
  } = req.body as {
    symbol?: string;
    side?: 'BUY' | 'SELL';
    stake?: number;
    entryPrice?: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
    stopLossUsd?: number | null;
    takeProfitUsd?: number | null;
    connectedAccountId?: string | null;
    executionMode?: 'virtual' | 'deriv' | 'auto';
    contractType?: string;
    duration?: number;
    durationUnit?: 't' | 's' | 'm' | 'h' | 'd';
    barrier?: string | number;
    multiplier?: number;
  };

  if (!symbol || !side || !stake || Number(stake) <= 0) {
    return res.status(400).json({ error: 'symbol, side, and stake > 0 are required' });
  }

  await ensureLiveTickSubscription(symbol).catch(() => {});
  const resolvedSpot = await resolveFallbackSpotPrice(symbol, entryPrice);

  // Check if user wants to execute on a connected Deriv account
  let targetAccount = null;
  if (executionMode !== 'virtual') {
    targetAccount = await getAuthorizedAccountForTrading(req.user!.userId, connectedAccountId);
  }

  if (targetAccount) {
    try {
      const exec = await executeDerivTrade({
        userId: req.user!.userId,
        connectedAccountId: targetAccount.id,
        symbol,
        side,
        stake: Number(stake),
        entryPrice: resolvedSpot,
        stopLoss: stopLoss ?? null,
        takeProfit: takeProfit ?? null,
        stopLossUsd: stopLossUsd ?? null,
        takeProfitUsd: takeProfitUsd ?? null,
        contractType,
        duration,
        durationUnit,
        barrier,
        multiplier
      });

      const resolvedEntry = exec.spotPrice > 0 ? exec.spotPrice : resolvedSpot;
      const q = await pool.query(
        `INSERT INTO virtual_orders
           (user_id, connected_account_id, deriv_contract_id, execution_mode, contract_type, payout,
            source, symbol, side, stake, entry_price, stop_loss, take_profit)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          req.user!.userId,
          exec.connectedAccountId,
          exec.contractId,
          exec.executionMode,
          exec.contractType,
          exec.payout,
          symbol,
          side,
          exec.buyPrice,
          resolvedEntry,
          stopLoss ?? null,
          takeProfit ?? null
        ]
      );

      await createNotification(
        req.user!.userId,
        'trade_sim',
        `${exec.accountType.toUpperCase()} Trade Executed (${symbol})`,
        `${side} ${exec.contractType} #${exec.contractId} · Stake ${exec.buyPrice} · Balance: ${exec.balanceAfter.toFixed(2)}`
      );

      return res.status(201).json({
        order: q.rows[0],
        derivExecution: exec
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }

  if (resolvedSpot <= 0) {
    return res.status(400).json({ error: `Waiting for live price feed on ${symbol}. Please retry in a moment.` });
  }

  // Fallback to Virtual Workspace Ledger when no Deriv account is connected or virtual mode is chosen
  const q = await pool.query(
    `INSERT INTO virtual_orders (user_id, execution_mode, contract_type, source, symbol, side, stake, entry_price, stop_loss, take_profit)
     VALUES ($1, 'virtual', $2, 'manual', $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      req.user!.userId,
      contractType || (side === 'BUY' ? 'MULTUP' : 'MULTDOWN'),
      symbol,
      side,
      Number(stake),
      resolvedSpot,
      stopLoss ?? null,
      takeProfit ?? null
    ]
  );
  res.status(201).json({ order: q.rows[0] });
}

export async function placeBulkOrders(req: Request, res: Response) {
  const {
    symbol,
    side,
    stake,
    entryPrice,
    count = 3,
    stopLoss,
    takeProfit,
    stopLossUsd,
    takeProfitUsd,
    connectedAccountId,
    executionMode,
    contractType,
    duration,
    durationUnit,
    barrier,
    multiplier
  } = req.body as {
    symbol?: string;
    side?: 'BUY' | 'SELL';
    stake?: number;
    entryPrice?: number;
    count?: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
    stopLossUsd?: number | null;
    takeProfitUsd?: number | null;
    connectedAccountId?: string | null;
    executionMode?: 'virtual' | 'deriv' | 'auto';
    contractType?: string;
    duration?: number;
    durationUnit?: 't' | 's' | 'm' | 'h' | 'd';
    barrier?: string | number;
    multiplier?: number;
  };

  if (!symbol || !side || !stake || Number(stake) <= 0) {
    return res.status(400).json({ error: 'symbol, side, and stake > 0 are required' });
  }

  const orderCount = Math.min(25, Math.max(1, Math.floor(Number(count))));
  await ensureLiveTickSubscription(symbol).catch(() => {});
  const resolvedSpot = await resolveFallbackSpotPrice(symbol, entryPrice);

  const targetAccount =
    executionMode !== 'virtual'
      ? await getAuthorizedAccountForTrading(req.user!.userId, connectedAccountId)
      : null;

  if (!targetAccount && resolvedSpot <= 0) {
    return res.status(400).json({ error: `Waiting for live price feed on ${symbol}. Please retry in a moment.` });
  }

  const placed: unknown[] = [];
  const errors: string[] = [];

  const tasks = Array.from({ length: orderCount }).map(async () => {
    if (targetAccount) {
      try {
        const exec = await executeDerivTrade({
          userId: req.user!.userId,
          connectedAccountId: targetAccount.id,
          symbol,
          side,
          stake: Number(stake),
          entryPrice: resolvedSpot,
          stopLoss: stopLoss ?? null,
          takeProfit: takeProfit ?? null,
          stopLossUsd: stopLossUsd ?? null,
          takeProfitUsd: takeProfitUsd ?? null,
          contractType,
          duration,
          durationUnit,
          barrier,
          multiplier
        });
        const resolvedEntry = exec.spotPrice > 0 ? exec.spotPrice : resolvedSpot;
        const q = await pool.query(
          `INSERT INTO virtual_orders
             (user_id, connected_account_id, deriv_contract_id, execution_mode, contract_type, payout,
              source, symbol, side, stake, entry_price, stop_loss, take_profit)
           VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            req.user!.userId,
            exec.connectedAccountId,
            exec.contractId,
            exec.executionMode,
            exec.contractType,
            exec.payout,
            symbol,
            side,
            exec.buyPrice,
            resolvedEntry,
            stopLoss ?? null,
            takeProfit ?? null
          ]
        );
        placed.push(q.rows[0]);
      } catch (err) {
        errors.push((err as Error).message);
      }
      return;
    }

    const q = await pool.query(
      `INSERT INTO virtual_orders (user_id, execution_mode, contract_type, source, symbol, side, stake, entry_price, stop_loss, take_profit)
       VALUES ($1, 'virtual', $2, 'manual', $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        req.user!.userId,
        contractType || (side === 'BUY' ? 'MULTUP' : 'MULTDOWN'),
        symbol,
        side,
        Number(stake),
        resolvedSpot,
        stopLoss ?? null,
        takeProfit ?? null
      ]
    );
    placed.push(q.rows[0]);
  });

  await Promise.all(tasks);

  if (placed.length === 0 && errors.length > 0) {
    return res.status(400).json({ error: errors[0], errors });
  }

  res.status(201).json({
    placedCount: placed.length,
    failedCount: errors.length,
    orders: placed,
    errors
  });
}

export async function bulkCloseOrders(req: Request, res: Response) {
  const { filter = 'all', prices = {} } = (req.body || {}) as {
    filter?: 'all' | 'profitable' | 'losing' | 'buy' | 'sell' | 'over' | 'under';
    prices?: Record<string, number>;
  };

  const liveContracts: Record<string, LiveDerivContractSnapshot> = await syncOpenDerivOrdersForUser(
    req.user!.userId
  ).catch(() => ({}));

  const q = await pool.query(
    `SELECT * FROM virtual_orders WHERE user_id = $1 AND status = 'OPEN' ORDER BY opened_at DESC`,
    [req.user!.userId]
  );

  const openOrders = q.rows;
  if (openOrders.length === 0) {
    return res.json({ closedCount: 0, failedCount: 0, totalPnl: 0, orders: [], errors: [] });
  }

  const estimateFloatingPnl = (o: Record<string, unknown>) => {
    const id = String(o.id);
    if (liveContracts && id in liveContracts) {
      return Number(liveContracts[id].profit);
    }
    const entry = Number(o.entry_price);
    const live = Number(prices[String(o.symbol)] ?? entry);
    const pct = String(o.side) === 'BUY' ? (live - entry) / entry : (entry - live) / entry;
    return Number((Number(o.stake) * pct * 100).toFixed(2));
  };

  const matching = openOrders.filter((o) => {
    const cType = String(o.contract_type || '').toUpperCase();
    const floating = estimateFloatingPnl(o);
    if (filter === 'profitable') return floating > 0;
    if (filter === 'losing') return floating < 0;
    if (filter === 'buy') return o.side === 'BUY';
    if (filter === 'sell') return o.side === 'SELL';
    if (filter === 'over') return cType === 'DIGITOVER';
    if (filter === 'under') return cType === 'DIGITUNDER';
    return true;
  });

  const closedOrders = [];
  const errors: string[] = [];
  let totalPnl = 0;

  for (const order of matching) {
    const fallbackExit = Number(
      liveContracts?.[String(order.id)]?.currentSpot ?? prices[order.symbol] ?? order.entry_price
    );
    let finalExit = fallbackExit;
    let pnl = estimateFloatingPnl(order);
    let closeStatus: 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL' = 'CLOSED_MANUAL';

    if (order.deriv_contract_id && order.connected_account_id) {
      try {
        const closed = await closeDerivContract({
          userId: req.user!.userId,
          connectedAccountId: order.connected_account_id,
          contractId: Number(order.deriv_contract_id),
          fallbackExitPrice: fallbackExit
        });
        finalExit = closed.exitPrice;
        pnl = closed.pnl;
        closeStatus = closed.status;
      } catch (err) {
        errors.push(`#${order.deriv_contract_id}: ${(err as Error).message}`);
        continue;
      }
    } else {
      await pool.query(
        `UPDATE users SET virtual_workspace_balance = virtual_workspace_balance + $1 WHERE id = $2`,
        [pnl, req.user!.userId]
      );
    }

    const updated = await pool.query(
      `UPDATE virtual_orders SET status = $1, exit_price = $2, pnl = $3, closed_at = NOW() WHERE id = $4 RETURNING *`,
      [closeStatus, finalExit, pnl, order.id]
    );
    if (updated.rows[0]) closedOrders.push(updated.rows[0]);
    totalPnl += pnl;
  }

  if (closedOrders.length === 0 && errors.length > 0) {
    return res.status(400).json({ error: errors[0], errors });
  }

  const userBal = await pool.query(`SELECT virtual_workspace_balance FROM users WHERE id = $1`, [req.user!.userId]);
  res.json({
    closedCount: closedOrders.length,
    failedCount: errors.length,
    totalPnl: Number(totalPnl.toFixed(2)),
    orders: closedOrders,
    errors,
    virtual_workspace_balance: Number(userBal.rows[0]?.virtual_workspace_balance ?? 10000)
  });
}

export async function closeVirtualOrder(req: Request, res: Response) {
  const { exitPrice } = req.body as { exitPrice: number };
  const q = await pool.query(
    `SELECT * FROM virtual_orders WHERE id = $1 AND user_id = $2 AND status = 'OPEN'`,
    [req.params.id, req.user!.userId]
  );
  const order = q.rows[0];
  if (!order) return res.status(404).json({ error: 'Open order not found' });

  if (order.deriv_contract_id && order.connected_account_id) {
    try {
      const closed = await closeDerivContract({
        userId: req.user!.userId,
        connectedAccountId: order.connected_account_id,
        contractId: Number(order.deriv_contract_id),
        fallbackExitPrice: Number(exitPrice || order.entry_price)
      });

      const updated = await pool.query(
        `UPDATE virtual_orders
         SET status = $1, exit_price = $2, pnl = $3, closed_at = NOW()
         WHERE id = $4 RETURNING *`,
        [closed.status, closed.exitPrice, closed.pnl, order.id]
      );

      return res.json({
        order: updated.rows[0],
        derivBalance: closed.balanceAfter
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }

  const entry = Number(order.entry_price);
  const pct = order.side === 'BUY' ? (exitPrice - entry) / entry : (entry - exitPrice) / entry;
  const pnl = Number((Number(order.stake) * pct * 100).toFixed(2));

  const updated = await pool.query(
    `UPDATE virtual_orders SET status = 'CLOSED_MANUAL', exit_price = $1, pnl = $2, closed_at = NOW() WHERE id = $3 RETURNING *`,
    [exitPrice, pnl, order.id]
  );
  const bal = await pool.query(
    `UPDATE users SET virtual_workspace_balance = virtual_workspace_balance + $1 WHERE id = $2 RETURNING virtual_workspace_balance`,
    [pnl, req.user!.userId]
  );
  res.json({
    order: updated.rows[0],
    virtual_workspace_balance: Number(bal.rows[0]?.virtual_workspace_balance ?? 0)
  });
}

export async function resetVirtualBalance(req: Request, res: Response) {
  const updated = await pool.query(
    `UPDATE users SET virtual_workspace_balance = 10000.00 WHERE id = $1 RETURNING virtual_workspace_balance`,
    [req.user!.userId]
  );
  res.json({ virtual_workspace_balance: Number(updated.rows[0]?.virtual_workspace_balance ?? 10000) });
}

export async function listWatchlists(req: Request, res: Response) {
  const q = await pool.query(
    `SELECT w.id, w.symbol, w.sort_order, m.display_name, m.market
     FROM watchlists w LEFT JOIN market_instruments m ON w.symbol = m.symbol
     WHERE w.user_id = $1 ORDER BY w.sort_order ASC, w.created_at ASC`,
    [req.user!.userId]
  );
  res.json({ watchlist: q.rows });
}

export async function addWatchlist(req: Request, res: Response) {
  const { symbol } = req.body as { symbol?: string };
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const q = await pool.query(
    `INSERT INTO watchlists (user_id, symbol) VALUES ($1, $2) ON CONFLICT (user_id, symbol) DO NOTHING RETURNING *`,
    [req.user!.userId, symbol]
  );
  res.status(201).json({ item: q.rows[0] ?? { symbol } });
}

export async function removeWatchlist(req: Request, res: Response) {
  await pool.query(`DELETE FROM watchlists WHERE user_id = $1 AND symbol = $2`, [
    req.user!.userId,
    req.params.symbol
  ]);
  res.json({ removed: true });
}

export async function listNotifications(req: Request, res: Response) {
  const q = await pool.query(
    `SELECT * FROM notifications WHERE user_id = $1 OR user_id IS NULL ORDER BY created_at DESC LIMIT 60`,
    [req.user!.userId]
  );
  res.json({ notifications: q.rows });
}

export async function markNotificationRead(req: Request, res: Response) {
  await pool.query(`UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`, [
    req.params.id,
    req.user!.userId
  ]);
  res.json({ read: true });
}
