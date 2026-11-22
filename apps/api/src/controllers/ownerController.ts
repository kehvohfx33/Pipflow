import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../database/pool';
import { env } from '../config/env';
import { decryptToken } from '../utils/crypto';
import {
  authorizeReadOnlyAccount,
  fetchNewDerivAccounts,
  isOAuth2AccessToken,
  ReadOnlyDerivAccount
} from '../integrations/deriv/account-data';
import { createNotification, logSecurityEvent } from '../services/notification-service';
import { broadcastToUser } from '../services/realtime-hub';

interface SyncProofPayload {
  purpose: 'owner_balance_sync';
  ownerId: string;
  userId: string;
  accountId: string;
  loginId: string;
  accountType: 'demo' | 'real';
  brokerBalance: number;
  currency: string;
  syncTimestamp: string;
}

function computeDisplayedBalance(
  brokerBalance: number,
  adjustmentTotal: number,
  accountType: 'demo' | 'real',
  exactBrokerBalanceOnly: boolean
): number {
  if (accountType === 'real' && exactBrokerBalanceOnly) {
    return Number(brokerBalance);
  }
  return Number((Number(brokerBalance) + Number(adjustmentTotal)).toFixed(4));
}

/**
 * Steps 1-7 of Synchronized Balance Management:
 * 1. Owner authenticated via requireAuth + requireOwner
 * 2. Target user verified
 * 3. Connected Deriv account + active authorization identified
 * 4. Actual balance retrieved live from Deriv
 * 5. Synchronization timestamp recorded
 * 6. Account currency verified
 * 7. Broker-reported balance, adjustment overlay, and signed syncProofToken returned
 */
export async function syncAccountForAdjustment(req: Request, res: Response) {
  const accountId = String(req.params.id || '').trim();
  if (!accountId) {
    return res.status(400).json({ error: 'Connected account ID is required' });
  }

  // Step 2 & 3: Verify account + owner user + active authorization
  const accQuery = await pool.query(
    `SELECT ca.id, ca.user_id, ca.deriv_login_id, ca.account_type, ca.currency,
            ca.last_known_balance,
            COALESCE(ca.platform_adjustment_balance, 0) AS platform_adjustment_balance,
            COALESCE(ca.exact_broker_balance_only, TRUE) AS exact_broker_balance_only,
            ca.connection_status, ca.last_synced_at,
            u.email AS user_email, u.full_name AS user_full_name, u.is_active AS user_is_active
     FROM connected_accounts ca
     JOIN users u ON ca.user_id = u.id
     WHERE ca.id = $1`,
    [accountId]
  );

  const accRow = accQuery.rows[0];
  if (!accRow) {
    return res.status(404).json({ error: 'Target Deriv connected account not found' });
  }
  if (!accRow.user_id || accRow.user_is_active === false) {
    return res.status(400).json({ error: 'Target user account is inactive or missing' });
  }

  const authQuery = await pool.query(
    `SELECT aa.encrypted_token, aa.token_iv, aa.token_auth_tag
     FROM account_authorizations aa
     JOIN connected_accounts ca ON ca.id = aa.connected_account_id
     WHERE aa.connected_account_id = $1 AND aa.revoked_at IS NULL
     ORDER BY aa.created_at DESC LIMIT 1`,
    [accountId]
  );
  const authRow = authQuery.rows[0];
  if (!authRow) {
    return res.status(400).json({
      error: 'No active non-revoked Deriv authorization token exists for this connected account. Sync from Deriv cannot proceed.'
    });
  }

  try {
    // Step 4: Retrieve live balance directly from Deriv
    const rawToken = decryptToken(authRow.encrypted_token, authRow.token_iv, authRow.token_auth_tag);
    let liveInfo: ReadOnlyDerivAccount;
    if (isOAuth2AccessToken(rawToken)) {
      const list = await fetchNewDerivAccounts(rawToken, { isPat: false });
      liveInfo = list.find((a) => a.loginid === accRow.deriv_login_id) ?? list[0];
    } else {
      liveInfo = await authorizeReadOnlyAccount(rawToken);
    }

    if (!liveInfo || !Number.isFinite(Number(liveInfo.balance)) || !liveInfo.currency) {
      throw new Error('Deriv did not return a valid balance and currency payload');
    }

    // Step 5 & 6: Record synchronization timestamp & verified currency while preserving platform_adjustment_balance
    const updatedRes = await pool.query(
      `UPDATE connected_accounts
       SET last_known_balance = $1,
           currency = $2,
           connection_status = 'connected',
           last_synced_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, user_id, deriv_login_id, account_type, currency, last_known_balance,
                 COALESCE(platform_adjustment_balance, 0) AS platform_adjustment_balance,
                 COALESCE(exact_broker_balance_only, TRUE) AS exact_broker_balance_only,
                 last_synced_at`,
      [Number(liveInfo.balance), String(liveInfo.currency), accountId]
    );
    const updated = updatedRes.rows[0];
    const brokerBalance = Number(updated.last_known_balance);
    const adjustmentTotal = Number(updated.platform_adjustment_balance ?? 0);
    const exactOnly = Boolean(updated.exact_broker_balance_only ?? true);
    const syncTimestamp = updated.last_synced_at
      ? new Date(updated.last_synced_at).toISOString()
      : new Date().toISOString();
    const displayedBalance = computeDisplayedBalance(
      brokerBalance,
      adjustmentTotal,
      updated.account_type,
      exactOnly
    );

    const proofPayload: SyncProofPayload = {
      purpose: 'owner_balance_sync',
      ownerId: req.user!.userId,
      userId: String(updated.user_id),
      accountId,
      loginId: String(updated.deriv_login_id),
      accountType: updated.account_type,
      brokerBalance,
      currency: String(updated.currency),
      syncTimestamp
    };

    const syncProofToken = jwt.sign(proofPayload, env.jwtSecret, { expiresIn: '5m' });

    await pool.query(
      `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, 'OWNER_PRE_ADJUSTMENT_DERIV_SYNC', 'connected_account', $2, $3::jsonb, $4)`,
      [
        req.user!.userId,
        accountId,
        JSON.stringify({
          userId: updated.user_id,
          loginId: updated.deriv_login_id,
          accountType: updated.account_type,
          brokerBalance,
          currency: updated.currency,
          syncTimestamp
        }),
        req.ip
      ]
    );

    broadcastToUser(String(updated.user_id), {
      type: 'account_updated',
      reason: 'owner_deriv_sync',
      accountId,
      balance: displayedBalance,
      brokerBalance
    });

    // Step 7: Display verified broker-reported balance & adjustment state to owner
    res.json({
      synchronized: true,
      account: {
        id: accountId,
        userId: String(updated.user_id),
        userEmail: accRow.user_email,
        userFullName: accRow.user_full_name,
        derivLoginId: String(updated.deriv_login_id),
        accountType: updated.account_type,
        currency: String(updated.currency),
        brokerBalance,
        platformAdjustmentBalance: adjustmentTotal,
        exactBrokerBalanceOnly: exactOnly,
        displayedBalance,
        syncTimestamp
      },
      syncProofToken
    });
  } catch (err) {
    res.status(400).json({
      error: `Deriv synchronization failed before adjustment: ${(err as Error).message}`
    });
  }
}

/**
 * Step 8: Permit authorized platform-side adjustment only after successful synchronization.
 * Executed inside an atomic SQL transaction with idempotency_key + immutable ledger insert.
 * NEVER alters last_known_balance (broker balance) and NEVER fabricates a Deriv transaction.
 */
export async function createPlatformAdjustment(req: Request, res: Response) {
  const accountId = String(req.params.id || '').trim();
  const { idempotencyKey, syncProofToken, adjustmentDelta, reason, note, allowRealOverlay } = req.body as {
    idempotencyKey?: string;
    syncProofToken?: string;
    adjustmentDelta?: number;
    reason?: string;
    note?: string;
    allowRealOverlay?: boolean;
  };

  const cleanKey = idempotencyKey?.trim() || '';
  if (!cleanKey || cleanKey.length > 128) {
    return res.status(400).json({ error: 'Valid idempotencyKey (1–128 characters) is required' });
  }
  if (!syncProofToken?.trim()) {
    return res.status(400).json({ error: 'Fresh Deriv synchronization proof (syncProofToken) is required before adjusting' });
  }

  const delta = Number(adjustmentDelta);
  if (!Number.isFinite(delta) || delta === 0) {
    return res.status(400).json({ error: 'Non-zero finite adjustmentDelta is required' });
  }

  const cleanReason = reason?.trim() || '';
  if (cleanReason.length < 3) {
    return res.status(400).json({ error: 'Audit reason (min 3 characters) is required' });
  }

  let proof: SyncProofPayload;
  try {
    proof = jwt.verify(syncProofToken.trim(), env.jwtSecret) as SyncProofPayload;
  } catch {
    return res.status(400).json({
      error: 'Deriv synchronization proof has expired or is invalid. Re-run Step 1–7 Deriv Sync before applying adjustment.'
    });
  }

  if (
    proof.purpose !== 'owner_balance_sync' ||
    proof.ownerId !== req.user!.userId ||
    proof.accountId !== accountId
  ) {
    return res.status(403).json({ error: 'Synchronization proof does not match the authenticated owner or target account' });
  }

  const client = await pool.connect();
  let ledgerRow: Record<string, unknown> | null = null;
  let updatedAccount: Record<string, unknown> | null = null;

  try {
    await client.query('BEGIN');

    const dup = await client.query(
      `SELECT * FROM balance_adjustments WHERE idempotency_key = $1`,
      [cleanKey]
    );
    if (dup.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Duplicate platform adjustment blocked by idempotency key',
        existingAdjustment: dup.rows[0]
      });
    }

    const lockedAccRes = await client.query(
      `SELECT ca.id, ca.user_id, ca.deriv_login_id, ca.account_type, ca.currency,
              ca.last_known_balance,
              COALESCE(ca.platform_adjustment_balance, 0) AS platform_adjustment_balance,
              COALESCE(ca.exact_broker_balance_only, TRUE) AS exact_broker_balance_only,
              ca.last_synced_at,
              u.email AS user_email
       FROM connected_accounts ca
       JOIN users u ON ca.user_id = u.id
       WHERE ca.id = $1
       FOR UPDATE`,
      [accountId]
    );

    const acc = lockedAccRes.rows[0];
    if (!acc) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Connected account not found' });
    }

    if (String(acc.currency) !== proof.currency) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Account currency changed since sync (${proof.currency} -> ${acc.currency}). Re-sync with Deriv before adjusting.`
      });
    }

    if (acc.account_type === 'real' && !allowRealOverlay) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'REAL accounts default to exact broker-reported balance equality. Explicitly confirm allowRealOverlay=true to apply a platform-side adjustment overlay.'
      });
    }

    const brokerBalance = Number(acc.last_known_balance);
    const prevAdjTotal = Number(acc.platform_adjustment_balance ?? 0);
    const newAdjTotal = Number((prevAdjTotal + delta).toFixed(4));
    const resultingDisplayed = Number((brokerBalance + newAdjTotal).toFixed(4));

    if (resultingDisplayed < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Resulting platform displayed balance ($${resultingDisplayed.toFixed(2)}) cannot be negative.`
      });
    }

    const nextExactMode = acc.account_type === 'real' ? !allowRealOverlay : false;

    const updRes = await client.query(
      `UPDATE connected_accounts
       SET platform_adjustment_balance = $1,
           exact_broker_balance_only = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, user_id, deriv_login_id, account_type, currency, last_known_balance,
                 platform_adjustment_balance, exact_broker_balance_only, last_synced_at`,
      [newAdjTotal, nextExactMode, accountId]
    );
    updatedAccount = updRes.rows[0];

    const insRes = await client.query(
      `INSERT INTO balance_adjustments (
         idempotency_key, user_id, connected_account_id, account_scope, owner_user_id,
         broker_balance_at_sync, currency, sync_timestamp, adjustment_delta,
         previous_adjustment_total, new_adjustment_total, resulting_displayed_balance, reason, note
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        cleanKey,
        String(acc.user_id),
        accountId,
        acc.account_type,
        req.user!.userId,
        brokerBalance,
        String(acc.currency),
        proof.syncTimestamp,
        delta,
        prevAdjTotal,
        newAdjTotal,
        resultingDisplayed,
        cleanReason,
        note?.trim() || null
      ]
    );
    const insertedLedger = insRes.rows[0] as Record<string, unknown> | undefined;
    ledgerRow = insertedLedger ?? null;

    await client.query(
      `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, 'OWNER_PLATFORM_BALANCE_ADJUSTMENT', 'connected_account', $2, $3::jsonb, $4)`,
      [
        req.user!.userId,
        accountId,
        JSON.stringify({
          ledgerId: insertedLedger?.id ?? null,
          idempotencyKey: cleanKey,
          userId: acc.user_id,
          loginId: acc.deriv_login_id,
          accountType: acc.account_type,
          brokerBalanceAtSync: brokerBalance,
          currency: acc.currency,
          adjustmentDelta: delta,
          previousAdjustmentTotal: prevAdjTotal,
          newAdjustmentTotal: newAdjTotal,
          resultingDisplayedBalance: resultingDisplayed,
          reason: cleanReason
        }),
        req.ip
      ]
    );

    await client.query('COMMIT');

    await logSecurityEvent(
      req.user!.userId,
      'OWNER_BALANCE_ADJUSTMENT_RECORDED',
      'info',
      {
        targetUserId: acc.user_id,
        accountId,
        loginId: acc.deriv_login_id,
        delta,
        resultingDisplayed
      },
      req.ip
    );

    await createNotification(
      String(acc.user_id),
      'system',
      'Platform-Side Workspace Adjustment (Non-Deriv)',
      `A platform-side workspace adjustment of ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} ${acc.currency} was recorded on ${acc.deriv_login_id} (${cleanReason}). Actual Deriv broker balance remains ${brokerBalance.toFixed(2)} ${acc.currency}. This is not a Deriv deposit or withdrawal.`
    );

    broadcastToUser(String(acc.user_id), {
      type: 'account_updated',
      reason: 'owner_platform_adjustment',
      accountId,
      balance: resultingDisplayed,
      brokerBalance,
      platformAdjustmentBalance: newAdjTotal
    });

    res.status(201).json({
      adjusted: true,
      adjustment: ledgerRow,
      account: {
        ...updatedAccount,
        displayed_balance: resultingDisplayed
      }
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = (err as Error).message || 'Adjustment failed';
    if (msg.toLowerCase().includes('idempotency_key')) {
      return res.status(409).json({ error: 'Duplicate platform adjustment blocked by idempotency key' });
    }
    res.status(500).json({ error: msg });
  } finally {
    client.release();
  }
}

export async function toggleRealExactMode(req: Request, res: Response) {
  const accountId = String(req.params.id || '').trim();
  const { exactBrokerBalanceOnly } = req.body as { exactBrokerBalanceOnly?: boolean };
  if (typeof exactBrokerBalanceOnly !== 'boolean') {
    return res.status(400).json({ error: 'exactBrokerBalanceOnly boolean is required' });
  }

  const updated = await pool.query(
    `UPDATE connected_accounts
     SET exact_broker_balance_only = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, user_id, deriv_login_id, account_type, currency, last_known_balance,
               COALESCE(platform_adjustment_balance, 0) AS platform_adjustment_balance,
               COALESCE(exact_broker_balance_only, TRUE) AS exact_broker_balance_only,
               last_synced_at`,
    [exactBrokerBalanceOnly, accountId]
  );

  const row = updated.rows[0];
  if (!row) {
    return res.status(404).json({ error: 'Connected account not found' });
  }

  const displayedBalance = computeDisplayedBalance(
    Number(row.last_known_balance),
    Number(row.platform_adjustment_balance ?? 0),
    row.account_type,
    Boolean(row.exact_broker_balance_only)
  );

  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'OWNER_TOGGLE_EXACT_BROKER_MODE', 'connected_account', $2, $3::jsonb, $4)`,
    [
      req.user!.userId,
      accountId,
      JSON.stringify({
        loginId: row.deriv_login_id,
        exactBrokerBalanceOnly,
        brokerBalance: Number(row.last_known_balance),
        displayedBalance
      }),
      req.ip
    ]
  );

  broadcastToUser(String(row.user_id), {
    type: 'account_updated',
    reason: 'exact_mode_updated',
    accountId,
    balance: displayedBalance,
    brokerBalance: Number(row.last_known_balance)
  });

  res.json({
    updated: true,
    account: {
      ...row,
      displayed_balance: displayedBalance
    }
  });
}

export async function adjustVirtualWorkspaceBalance(req: Request, res: Response) {
  const targetUserId = String(req.params.id || '').trim();
  const { idempotencyKey, adjustmentDelta, targetBalance, reason, note } = req.body as {
    idempotencyKey?: string;
    adjustmentDelta?: number;
    targetBalance?: number;
    reason?: string;
    note?: string;
  };

  const cleanKey = idempotencyKey?.trim() || '';
  if (!cleanKey || cleanKey.length > 128) {
    return res.status(400).json({ error: 'Valid idempotencyKey (1–128 characters) is required' });
  }
  const cleanReason = reason?.trim() || '';
  if (cleanReason.length < 3) {
    return res.status(400).json({ error: 'Audit reason (min 3 characters) is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dup = await client.query(
      `SELECT * FROM balance_adjustments WHERE idempotency_key = $1`,
      [cleanKey]
    );
    if (dup.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Duplicate virtual workspace adjustment blocked by idempotency key',
        existingAdjustment: dup.rows[0]
      });
    }

    const userRes = await client.query(
      `SELECT id, email, full_name, virtual_workspace_balance, preferred_currency
       FROM users WHERE id = $1 FOR UPDATE`,
      [targetUserId]
    );
    const userRow = userRes.rows[0];
    if (!userRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Target user not found' });
    }

    const currentVirtual = Number(userRow.virtual_workspace_balance ?? 10000);
    let delta: number;
    if (typeof adjustmentDelta === 'number' && Number.isFinite(adjustmentDelta) && adjustmentDelta !== 0) {
      delta = Number(adjustmentDelta);
    } else if (typeof targetBalance === 'number' && Number.isFinite(targetBalance) && targetBalance >= 0) {
      delta = Number((targetBalance - currentVirtual).toFixed(2));
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Provide a valid adjustmentDelta or non-negative targetBalance' });
    }

    if (delta === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Resulting virtual adjustment delta cannot be zero' });
    }

    const nextVirtual = Number((currentVirtual + delta).toFixed(2));
    if (nextVirtual < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Virtual workspace balance cannot become negative' });
    }

    await client.query(
      `UPDATE users SET virtual_workspace_balance = $1, updated_at = NOW() WHERE id = $2`,
      [nextVirtual, targetUserId]
    );

    const insRes = await client.query(
      `INSERT INTO balance_adjustments (
         idempotency_key, user_id, connected_account_id, account_scope, owner_user_id,
         broker_balance_at_sync, currency, sync_timestamp, adjustment_delta,
         previous_adjustment_total, new_adjustment_total, resulting_displayed_balance, reason, note
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        cleanKey,
        targetUserId,
        null,
        'virtual',
        req.user!.userId,
        currentVirtual,
        String(userRow.preferred_currency || 'USD'),
        new Date().toISOString(),
        delta,
        0,
        delta,
        nextVirtual,
        cleanReason,
        note?.trim() || null
      ]
    );

    await client.query(
      `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, 'OWNER_VIRTUAL_BALANCE_ADJUSTMENT', 'user', $2, $3::jsonb, $4)`,
      [
        req.user!.userId,
        targetUserId,
        JSON.stringify({
          ledgerId: insRes.rows[0].id,
          idempotencyKey: cleanKey,
          previousVirtual: currentVirtual,
          delta,
          nextVirtual,
          reason: cleanReason
        }),
        req.ip
      ]
    );

    await client.query('COMMIT');

    await createNotification(
      targetUserId,
      'system',
      'Virtual Practice Balance Adjusted (Non-Deriv)',
      `Your Pipflowtrade virtual practice balance was adjusted by ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} ${userRow.preferred_currency || 'USD'} (${cleanReason}). New virtual practice balance: ${nextVirtual.toFixed(2)}. This does not affect any Deriv broker account.`
    );

    broadcastToUser(targetUserId, {
      type: 'account_updated',
      reason: 'owner_virtual_adjustment',
      virtualBalance: nextVirtual
    });

    res.status(201).json({
      adjusted: true,
      virtual_workspace_balance: nextVirtual,
      adjustment: insRes.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = (err as Error).message || 'Virtual balance adjustment failed';
    if (msg.toLowerCase().includes('idempotency_key')) {
      return res.status(409).json({ error: 'Duplicate virtual adjustment blocked by idempotency key' });
    }
    res.status(500).json({ error: msg });
  } finally {
    client.release();
  }
}

export async function listOwnerBalanceAdjustments(_req: Request, res: Response) {
  const q = await pool.query(
    `SELECT ba.*,
            tu.email AS user_email,
            ou.email AS owner_email,
            ca.deriv_login_id
     FROM balance_adjustments ba
     JOIN users tu ON ba.user_id = tu.id
     JOIN users ou ON ba.owner_user_id = ou.id
     LEFT JOIN connected_accounts ca ON ba.connected_account_id = ca.id
     ORDER BY ba.created_at DESC
     LIMIT 150`
  );
  res.json({ adjustments: q.rows });
}
