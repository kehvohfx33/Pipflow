import crypto from 'crypto';
import { pool } from '../../database/pool';
import { decryptToken } from '../../utils/crypto';
import { broadcastToUser } from '../../services/realtime-hub';
import { DerivClient, OtpDerivClient } from './deriv-client';
import { DerivMessage } from './websocket';
import {
  getApiDerivAccountOtpUrl,
  isOAuth2AccessToken
} from './account-data';

export interface AuthorizedTradeAccount {
  id: string;
  derivLoginId: string;
  accountType: 'demo' | 'real';
  currency: string;
  lastKnownBalance: number;
  balanceLockedByAdmin: boolean;
  grantedScopes: string[];
  rawToken: string;
}

export interface SettledDerivOrderInfo {
  orderId: string;
  userId: string;
  connectedAccountId: string;
  contractId: number;
  symbol: string;
  source: string;
  status: 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL';
  exitPrice: number;
  pnl: number;
  balanceAfter: number | null;
}

type SettlementHandler = (info: SettledDerivOrderInfo) => void | Promise<void>;
let derivSettlementHandler: SettlementHandler | null = null;

export function registerDerivSettlementHandler(handler: SettlementHandler) {
  derivSettlementHandler = handler;
}

export interface ExecuteDerivTradeInput {
  userId: string;
  connectedAccountId?: string | null;
  symbol: string;
  side: 'BUY' | 'SELL';
  stake: number;
  entryPrice?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  stopLossUsd?: number | null;
  takeProfitUsd?: number | null;
  contractType?: string;
  duration?: number;
  durationUnit?: 't' | 's' | 'm' | 'h' | 'd';
  barrier?: string | number;
  multiplier?: number;
}

export interface ExecuteDerivTradeResult {
  connectedAccountId: string;
  derivLoginId: string;
  accountType: 'demo' | 'real';
  executionMode: 'deriv_real' | 'deriv_demo';
  contractId: number;
  transactionId: number;
  contractType: string;
  buyPrice: number;
  payout: number | null;
  spotPrice: number;
  balanceAfter: number;
}

interface AuthorizeTradeRes extends DerivMessage {
  authorize?: {
    loginid: string;
    currency: string;
    balance: number;
    is_virtual: number;
    scopes?: string[];
  };
}

interface ContractsForRes extends DerivMessage {
  contracts_for?: {
    available?: Array<{
      contract_type: string;
      multiplier_range?: number[];
      min_stake?: string | number;
      max_stake?: string | number;
    }>;
  };
}

interface ProposalRes extends DerivMessage {
  proposal?: {
    id: string;
    ask_price: number;
    payout?: number;
    spot?: number;
  };
}

interface BuyRes extends DerivMessage {
  buy?: {
    contract_id: number;
    balance_after: number;
    buy_price: number;
    payout?: number;
    transaction_id: number;
    start_time?: number;
  };
}

interface OpenContractRes extends DerivMessage {
  proposal_open_contract?: {
    contract_id: number;
    status?: string;
    is_sold?: number;
    is_expired?: number;
    buy_price?: number;
    sell_price?: number;
    bid_price?: number;
    profit?: number;
    entry_spot?: number;
    exit_tick?: number;
    current_spot?: number;
  };
}

interface SellRes extends DerivMessage {
  sell?: {
    contract_id: number;
    balance_after: number;
    sold_for: number;
    transaction_id: number;
  };
}

interface BalanceRes extends DerivMessage {
  balance?: {
    balance: number;
    currency: string;
  };
}

interface TradingSocketHandle {
  isOtpGateway: boolean;
  symbolField: 'underlying_symbol' | 'symbol';
  isOpen: () => boolean;
  request: <T extends DerivMessage = DerivMessage>(payload: Record<string, unknown>) => Promise<T>;
  close: () => void;
  scopes: string[];
  currency: string;
  actualDerivBalance: number | null;
}

interface PooledSocketEntry {
  key: string;
  tokenHash: string;
  handle: TradingSocketHandle;
  lastUsedAt: number;
}

const SOCKET_IDLE_TTL_MS = 5 * 60 * 1000;
const OTP_COOLDOWN_MS = 20 * 1000;
const ORDER_SYNC_TTL_MS = 5 * 1000;

const tradingSocketPool = new Map<string, PooledSocketEntry>();
const inFlightSocketOpens = new Map<string, Promise<TradingSocketHandle>>();
const otpCooldownByUser = new Map<string, number>();
const inFlightOrderSyncs = new Map<string, Promise<Record<string, LiveDerivContractSnapshot>>>();
const lastOrderSyncCache = new Map<string, { at: number; snapshots: Record<string, LiveDerivContractSnapshot> }>();

const socketReaper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of tradingSocketPool.entries()) {
    if (!entry.handle.isOpen() || now - entry.lastUsedAt > SOCKET_IDLE_TTL_MS) {
      try {
        entry.handle.close();
      } catch {
        // ignore
      }
      tradingSocketPool.delete(key);
    }
  }
}, 60 * 1000);
socketReaper.unref?.();

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex').slice(0, 16);
}

function isRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('(429)') || msg.includes('rate limit') || msg.includes('ratelimit');
}

function isSocketTransportError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('websocket closed') ||
    msg.includes('websocket not open') ||
    msg.includes('not connected') ||
    msg.includes('disconnected')
  );
}

function markOtpCooldown(userId: string) {
  otpCooldownByUser.set(userId, Date.now() + OTP_COOLDOWN_MS);
}

function isOtpInCooldown(userId: string): boolean {
  const until = otpCooldownByUser.get(userId);
  if (!until) return false;
  if (Date.now() >= until) {
    otpCooldownByUser.delete(userId);
    return false;
  }
  return true;
}

function evictTradingSocket(userId: string, accountId: string) {
  const key = `${userId}:${accountId}`;
  const entry = tradingSocketPool.get(key);
  if (entry) {
    try {
      entry.handle.close();
    } catch {
      // ignore
    }
    tradingSocketPool.delete(key);
  }
}

async function createAuthenticatedTradingSocket(account: AuthorizedTradeAccount): Promise<TradingSocketHandle> {
  const cleanToken = account.rawToken.trim();

  // 1. OAuth2 Bearer `ory_at_...` uses ONE REST OTP request + persistent `api.derivws.com` gateway WebSocket
  if (isOAuth2AccessToken(cleanToken)) {
    const otpUrl = await getApiDerivAccountOtpUrl(cleanToken, account.derivLoginId, false);
    const otpClient = new OtpDerivClient(otpUrl);
    await otpClient.connect();
    let actualBal: number | null = null;
    const balRes = await otpClient.request<BalanceRes>({ balance: 1 }).catch(() => null);
    if (balRes?.balance?.balance !== undefined) {
      actualBal = Number(balRes.balance.balance);
    }
    return {
      isOtpGateway: true,
      symbolField: 'underlying_symbol',
      isOpen: () => otpClient.isOpen(),
      request: <T extends DerivMessage = DerivMessage>(payload: Record<string, unknown>) =>
        otpClient.request<T>(payload),
      close: () => otpClient.close(),
      scopes: account.grantedScopes.length > 0 ? account.grantedScopes : ['read', 'trade'],
      currency: balRes?.balance?.currency || account.currency || 'USD',
      actualDerivBalance: actualBal
    };
  }

  // 2. Classic tokens try legacy WebSocket `authorize`; if rejected, try PAT OTP gateway
  const legacyClient = new DerivClient();
  try {
    const authRes = await legacyClient.request<AuthorizeTradeRes>({ authorize: cleanToken });
    return {
      isOtpGateway: false,
      symbolField: 'symbol',
      isOpen: () => legacyClient.socket.isOpen(),
      request: <T extends DerivMessage = DerivMessage>(payload: Record<string, unknown>) =>
        legacyClient.request<T>(payload),
      close: () => legacyClient.socket.close(),
      scopes: authRes.authorize?.scopes ?? account.grantedScopes,
      currency: authRes.authorize?.currency || account.currency || 'USD',
      actualDerivBalance:
        authRes.authorize?.balance !== undefined ? Number(authRes.authorize.balance) : null
    };
  } catch (legacyErr) {
    legacyClient.socket.close();
    try {
      const otpUrl = await getApiDerivAccountOtpUrl(cleanToken, account.derivLoginId, true);
      const otpClient = new OtpDerivClient(otpUrl);
      await otpClient.connect();
      let actualBal: number | null = null;
      const balRes = await otpClient.request<BalanceRes>({ balance: 1 }).catch(() => null);
      if (balRes?.balance?.balance !== undefined) {
        actualBal = Number(balRes.balance.balance);
      }
      return {
        isOtpGateway: true,
        symbolField: 'underlying_symbol',
        isOpen: () => otpClient.isOpen(),
        request: <T extends DerivMessage = DerivMessage>(payload: Record<string, unknown>) =>
          otpClient.request<T>(payload),
        close: () => otpClient.close(),
        scopes: account.grantedScopes.length > 0 ? account.grantedScopes : ['read', 'trade'],
        currency: balRes?.balance?.currency || account.currency || 'USD',
        actualDerivBalance: actualBal
      };
    } catch {
      throw legacyErr;
    }
  }
}

async function getPooledTradingSocket(
  userId: string,
  account: AuthorizedTradeAccount,
  options?: { bypassPool?: boolean }
): Promise<TradingSocketHandle> {
  const key = `${userId}:${account.id}`;
  const tHash = hashToken(account.rawToken.trim());

  if (!options?.bypassPool) {
    const existing = tradingSocketPool.get(key);
    if (existing && existing.tokenHash === tHash && existing.handle.isOpen()) {
      existing.lastUsedAt = Date.now();
      return existing.handle;
    }
    if (existing) {
      evictTradingSocket(userId, account.id);
    }
  } else {
    evictTradingSocket(userId, account.id);
  }

  const inflight = inFlightSocketOpens.get(key);
  if (inflight) {
    return inflight;
  }

  const openPromise = createAuthenticatedTradingSocket(account)
    .then((handle) => {
      tradingSocketPool.set(key, {
        key,
        tokenHash: tHash,
        handle,
        lastUsedAt: Date.now()
      });
      return handle;
    })
    .catch((err) => {
      if (isRateLimitError(err)) {
        markOtpCooldown(userId);
      }
      throw err;
    })
    .finally(() => {
      inFlightSocketOpens.delete(key);
    });

  inFlightSocketOpens.set(key, openPromise);
  return openPromise;
}

function parseAcceptedMultipliers(errMsg: string): number[] {
  const m = errMsg.match(/accepts?\s+([\d,\s]+)/i);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function isFatalOrderError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('insufficient') ||
    lower.includes('balance') ||
    lower.includes('market is closed') ||
    lower.includes('marketisclosed') ||
    lower.includes('authorization') ||
    lower.includes('permission') ||
    lower.includes('invalid token') ||
    lower.includes('invalidtoken') ||
    lower.includes('suspended') ||
    lower.includes('rate limit')
  );
}

async function requestProposalWithSymbolFallback(
  sock: TradingSocketHandle,
  symbol: string,
  basePayload: Record<string, unknown>
): Promise<ProposalRes> {
  try {
    return await sock.request<ProposalRes>({
      ...basePayload,
      [sock.symbolField]: symbol
    });
  } catch (err) {
    const msg = ((err as Error).message || '').toLowerCase();
    const altField = sock.symbolField === 'underlying_symbol' ? 'symbol' : 'underlying_symbol';
    if (
      msg.includes('underlying_symbol') ||
      msg.includes('missing required') ||
      msg.includes('unexpected property') ||
      msg.includes('inputvalidationfailed')
    ) {
      return sock.request<ProposalRes>({
        ...basePayload,
        [altField]: symbol
      });
    }
    throw err;
  }
}

async function syncPostTradeBalance(
  userId: string,
  accountId: string,
  derivBalanceAfter: number | null,
  lockedDelta?: number
): Promise<number> {
  const hasDelta = typeof lockedDelta === 'number' && Number.isFinite(lockedDelta);
  const deltaVal = hasDelta ? Number(lockedDelta) : 0;
  const hasDerivBal = typeof derivBalanceAfter === 'number' && Number.isFinite(derivBalanceAfter);

  const updated = await pool.query(
    `UPDATE connected_accounts
     SET last_known_balance = CASE
           WHEN COALESCE(balance_locked_by_admin, FALSE) = TRUE THEN
             CASE WHEN $4 = TRUE THEN GREATEST(0, last_known_balance + $5) ELSE last_known_balance END
           WHEN $6 = TRUE THEN $1
           WHEN $4 = TRUE THEN GREATEST(0, last_known_balance + $5)
           ELSE last_known_balance
         END,
         last_synced_at = NOW(),
         updated_at = NOW()
     WHERE id = $2 AND user_id = $3
     RETURNING last_known_balance, COALESCE(balance_locked_by_admin, FALSE) AS balance_locked_by_admin`,
    [hasDerivBal ? derivBalanceAfter : 0, accountId, userId, hasDelta, deltaVal, hasDerivBal]
  );

  const locked = Boolean(updated.rows[0]?.balance_locked_by_admin);
  const displayBalance = Number(updated.rows[0]?.last_known_balance ?? derivBalanceAfter ?? 0);

  if (!locked) {
    await pool
      .query(
        `UPDATE users SET virtual_workspace_balance = $1, updated_at = NOW()
         WHERE id = $2 AND EXISTS (
           SELECT 1 FROM connected_accounts WHERE id = $3 AND (is_primary = TRUE OR account_type = 'real')
         )`,
        [displayBalance, userId, accountId]
      )
      .catch(() => {});
  }

  broadcastToUser(userId, {
    type: 'account_updated',
    accountId,
    balance: displayBalance
  });

  return displayBalance;
}

export async function getAuthorizedAccountForTrading(
  userId: string,
  connectedAccountId?: string | null
): Promise<AuthorizedTradeAccount | null> {
  const params: unknown[] = [userId];
  let accountFilter = '';
  if (connectedAccountId) {
    params.push(connectedAccountId);
    accountFilter = `AND ca.id = $2`;
  }

  const q = await pool.query(
    `SELECT ca.id, ca.deriv_login_id, ca.account_type, ca.currency, ca.last_known_balance,
            COALESCE(ca.balance_locked_by_admin, FALSE) AS balance_locked_by_admin,
            aa.encrypted_token, aa.token_iv, aa.token_auth_tag, aa.granted_scopes
     FROM connected_accounts ca
     JOIN LATERAL (
       SELECT encrypted_token, token_iv, token_auth_tag, granted_scopes
       FROM account_authorizations
       WHERE connected_account_id = ca.id AND user_id = ca.user_id AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1
     ) aa ON TRUE
     WHERE ca.user_id = $1 AND ca.connection_status = 'connected' ${accountFilter}
     ORDER BY CASE WHEN ca.account_type = 'real' THEN 0 ELSE 1 END, ca.is_primary DESC, ca.updated_at DESC
     LIMIT 1`,
    params
  );

  const row = q.rows[0];
  if (!row) return null;

  const rawToken = decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag);
  return {
    id: row.id,
    derivLoginId: row.deriv_login_id,
    accountType: row.account_type,
    currency: row.currency || 'USD',
    lastKnownBalance: Number(row.last_known_balance ?? 0),
    balanceLockedByAdmin: Boolean(row.balance_locked_by_admin),
    grantedScopes: Array.isArray(row.granted_scopes) ? row.granted_scopes : ['read'],
    rawToken
  };
}

export async function executeDerivTrade(input: ExecuteDerivTradeInput): Promise<ExecuteDerivTradeResult> {
  const account = await getAuthorizedAccountForTrading(input.userId, input.connectedAccountId);
  if (!account) {
    throw new Error('No active trading account found. Please log in via Deriv OAuth2.');
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const sock = await getPooledTradingSocket(input.userId, account, { bypassPool: attempt > 0 });
    try {
      if (!sock.scopes.includes('trade')) {
        throw new Error(
          `Trading account does not have "trade" permission (${sock.scopes.join(', ')}). Re-authorize via Deriv login.`
        );
      }

      // Strict Real-Account Guard:
      // Admin-altered real balances sync visually across all views, but live real orders
      // require actual real funds on Deriv to place orders.
      if (account.accountType === 'real') {
        const balRes = await sock.request<BalanceRes>({ balance: 1 }).catch(() => null);
        if (balRes?.balance?.balance !== undefined) {
          sock.actualDerivBalance = Number(balRes.balance.balance);
        }
        if (sock.actualDerivBalance !== null && sock.actualDerivBalance < Number(input.stake)) {
          throw new Error(
            `Insufficient actual live Deriv balance ($${sock.actualDerivBalance.toFixed(2)} ${sock.currency}) on Real account to place a $${Number(input.stake).toFixed(2)} order on Deriv.`
          );
        }
      }

    const currency = sock.currency || account.currency || 'USD';
    let requestedType = input.contractType?.toUpperCase();
    if (!requestedType) {
      requestedType = input.side === 'BUY' ? 'MULTUP' : 'MULTDOWN';
    }

    let proposal: ProposalRes['proposal'] | undefined;
    let finalContractType = requestedType;

    if (requestedType === 'MULTUP' || requestedType === 'MULTDOWN') {
      let selectedMultiplier = input.multiplier ?? 100;
      let supportsMultiplier = true;
      let lastMultError: Error | null = null;

      try {
        const cfReq = sock.isOtpGateway
          ? { contracts_for: input.symbol }
          : { contracts_for: input.symbol, currency };
        const cf = await sock.request<ContractsForRes>(cfReq);
        const multSpec = cf.contracts_for?.available?.find((c) => c.contract_type === requestedType);
        if (cf.contracts_for?.available && cf.contracts_for.available.length > 0 && !multSpec) {
          supportsMultiplier = false;
        } else if (multSpec?.multiplier_range && multSpec.multiplier_range.length > 0) {
          const range = multSpec.multiplier_range;
          if (!range.includes(selectedMultiplier)) {
            selectedMultiplier = range.includes(100)
              ? 100
              : range.includes(50)
                ? 50
                : range.includes(160)
                  ? 160
                  : range[0];
          }
        }
      } catch {
        supportsMultiplier = true;
      }

      const sendMultiplierProposal = async (mult: number, includeLimits: boolean) => {
        const refPrice = input.entryPrice && input.entryPrice > 0 ? input.entryPrice : 0;
        const limitOrder: { take_profit?: number; stop_loss?: number } = {};
        if (includeLimits) {
          let tpUsd =
            typeof input.takeProfitUsd === 'number' && input.takeProfitUsd > 0
              ? Math.abs(input.takeProfitUsd)
              : 0;
          if (!tpUsd && refPrice > 0 && input.takeProfit) {
            const tpDiffPct = Math.abs(input.takeProfit - refPrice) / refPrice;
            tpUsd = input.stake * tpDiffPct * mult;
          }
          tpUsd = Number(tpUsd.toFixed(2));
          if (tpUsd >= 0.5) {
            limitOrder.take_profit = tpUsd;
          }

          let slUsd =
            typeof input.stopLossUsd === 'number' && input.stopLossUsd > 0
              ? Math.abs(input.stopLossUsd)
              : 0;
          if (!slUsd && refPrice > 0 && input.stopLoss) {
            const slDiffPct = Math.abs(refPrice - input.stopLoss) / refPrice;
            slUsd = input.stake * slDiffPct * mult;
          }
          if (slUsd >= input.stake && input.stake > 0.55) {
            slUsd = input.stake - 0.05;
          }
          slUsd = Number(slUsd.toFixed(2));
          if (slUsd >= 0.5 && slUsd < input.stake) {
            limitOrder.stop_loss = slUsd;
          }
        }

        const propRes = await requestProposalWithSymbolFallback(sock, input.symbol, {
          proposal: 1,
          amount: Number(input.stake),
          basis: 'stake',
          contract_type: requestedType,
          currency,
          multiplier: mult,
          ...(Object.keys(limitOrder).length > 0 ? { limit_order: limitOrder } : {})
        });
        return propRes.proposal;
      };

      if (supportsMultiplier) {
        try {
          proposal = await sendMultiplierProposal(selectedMultiplier, true);
        } catch (err) {
          lastMultError = err as Error;
          if (isFatalOrderError(lastMultError.message)) {
            throw lastMultError;
          }
          const accepted = parseAcceptedMultipliers(lastMultError.message);
          if (accepted.length > 0) {
            selectedMultiplier = accepted[0];
            try {
              proposal = await sendMultiplierProposal(selectedMultiplier, true);
            } catch (err2) {
              lastMultError = err2 as Error;
              if (isFatalOrderError(lastMultError.message)) {
                throw lastMultError;
              }
              try {
                proposal = await sendMultiplierProposal(selectedMultiplier, false);
              } catch (err3) {
                lastMultError = err3 as Error;
                if (isFatalOrderError(lastMultError.message)) {
                  throw lastMultError;
                }
                proposal = undefined;
              }
            }
          } else {
            try {
              proposal = await sendMultiplierProposal(selectedMultiplier, false);
            } catch (err2) {
              lastMultError = err2 as Error;
              if (isFatalOrderError(lastMultError.message)) {
                throw lastMultError;
              }
              proposal = undefined;
            }
          }
        }
      }

      // Fallback to Rise/Fall (CALL / PUT 5 ticks) only if multipliers aren't offered on this symbol
      if (!proposal) {
        try {
          finalContractType = input.side === 'BUY' ? 'CALL' : 'PUT';
          const propRes = await requestProposalWithSymbolFallback(sock, input.symbol, {
            proposal: 1,
            amount: Number(input.stake),
            basis: 'stake',
            contract_type: finalContractType,
            currency,
            duration: input.duration ?? 5,
            duration_unit: input.durationUnit ?? 't'
          });
          proposal = propRes.proposal;
        } catch (fallbackErr) {
          throw lastMultError ?? (fallbackErr as Error);
        }
      }
    } else {
      const payload: Record<string, unknown> = {
        proposal: 1,
        amount: Number(input.stake),
        basis: 'stake',
        contract_type: finalContractType,
        currency,
        duration: input.duration ?? 1,
        duration_unit: input.durationUnit ?? 't'
      };
      if (input.barrier !== undefined && input.barrier !== '') {
        payload.barrier = String(input.barrier);
      }
      const propRes = await requestProposalWithSymbolFallback(sock, input.symbol, payload);
      proposal = propRes.proposal;
    }

    if (!proposal?.id) {
      throw new Error('Deriv did not return a valid contract proposal');
    }

    const buyPrice = Number(proposal.ask_price ?? input.stake);
    const buyRes = await sock.request<BuyRes>({
      buy: proposal.id,
      price: buyPrice
    });

    if (!buyRes.buy?.contract_id) {
      throw new Error('Deriv buy execution did not return a contract_id');
    }

    const actualBuyPrice = Number(buyRes.buy.buy_price ?? buyPrice);
    const rawDerivBalanceAfter = Number(buyRes.buy.balance_after ?? account.lastKnownBalance - actualBuyPrice);
    const displayBalanceAfter = await syncPostTradeBalance(
      input.userId,
      account.id,
      rawDerivBalanceAfter,
      -actualBuyPrice
    );

      if (buyRes.buy.balance_after !== undefined) {
        sock.actualDerivBalance = Number(buyRes.buy.balance_after);
      }

      return {
        connectedAccountId: account.id,
        derivLoginId: account.derivLoginId,
        accountType: account.accountType,
        executionMode: account.accountType === 'real' ? 'deriv_real' : 'deriv_demo',
        contractId: Number(buyRes.buy.contract_id),
        transactionId: Number(buyRes.buy.transaction_id ?? 0),
        contractType: finalContractType,
        buyPrice: actualBuyPrice,
        payout: buyRes.buy.payout !== undefined ? Number(buyRes.buy.payout) : null,
        spotPrice: Number(proposal.spot ?? input.entryPrice ?? 0),
        balanceAfter: displayBalanceAfter
      };
    } catch (err) {
      if (attempt === 0 && isSocketTransportError(err)) {
        evictTradingSocket(input.userId, account.id);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Deriv trade execution failed after socket reconnect');
}

function isContractSettled(poc?: OpenContractRes['proposal_open_contract']): boolean {
  if (!poc) return false;
  return (
    poc.is_sold === 1 ||
    poc.is_expired === 1 ||
    poc.status === 'won' ||
    poc.status === 'lost' ||
    poc.status === 'sold'
  );
}

export async function closeDerivContract(params: {
  userId: string;
  connectedAccountId: string;
  contractId: number;
  fallbackExitPrice: number;
}): Promise<{ exitPrice: number; pnl: number; status: 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL'; balanceAfter: number | null }> {
  const account = await getAuthorizedAccountForTrading(params.userId, params.connectedAccountId);
  if (!account) {
    throw new Error('Active Deriv account authorization not found to close contract');
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const sock = await getPooledTradingSocket(params.userId, account, { bypassPool: attempt > 0 });
    try {
      const pocRes = await sock.request<OpenContractRes>({
        proposal_open_contract: 1,
        contract_id: params.contractId
      });
      const poc = pocRes.proposal_open_contract;

      let pnl = Number(poc?.profit ?? 0);
      const buyPrice = Number(poc?.buy_price ?? 0);
      let payoutCredit = Number(poc?.sell_price ?? Math.max(0, buyPrice + pnl));
      let exitPrice = Number(poc?.exit_tick ?? poc?.current_spot ?? params.fallbackExitPrice);
      let status: 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL' = 'CLOSED_MANUAL';
      let balanceAfter: number | null = null;

      if (isContractSettled(poc)) {
        status = pnl >= 0 ? 'CLOSED_TP' : 'CLOSED_SL';
      } else {
        try {
          const sellRes = await sock.request<SellRes>({
            sell: params.contractId,
            price: 0
          });
          if (sellRes.sell) {
            balanceAfter = Number(sellRes.sell.balance_after);
            sock.actualDerivBalance = balanceAfter;
            payoutCredit = Number(sellRes.sell.sold_for ?? payoutCredit);
            if (buyPrice > 0) {
              pnl = Number((Number(sellRes.sell.sold_for) - buyPrice).toFixed(2));
            }
          }
        } catch (sellErr) {
          const recheck = await sock
            .request<OpenContractRes>({
              proposal_open_contract: 1,
              contract_id: params.contractId
            })
            .catch(() => null);
          const rePoc = recheck?.proposal_open_contract;
          const sellErrLower = ((sellErr as Error).message || '').toLowerCase();
          const alreadySettledMsg =
            sellErrLower.includes('already sold') ||
            sellErrLower.includes('already settled') ||
            sellErrLower.includes('contract has expired');
          if (isContractSettled(rePoc) || alreadySettledMsg) {
            pnl = Number(rePoc?.profit ?? pnl);
            const reBuy = Number(rePoc?.buy_price ?? buyPrice);
            payoutCredit = Number(rePoc?.sell_price ?? Math.max(0, reBuy + pnl));
            exitPrice = Number(rePoc?.exit_tick ?? rePoc?.current_spot ?? exitPrice);
            status = pnl >= 0 ? 'CLOSED_TP' : 'CLOSED_SL';
          } else {
            throw sellErr;
          }
        }
      }

      if (balanceAfter === null) {
        const balRes = await sock.request<BalanceRes>({ balance: 1 }).catch(() => null);
        if (balRes?.balance?.balance !== undefined) {
          balanceAfter = Number(balRes.balance.balance);
          sock.actualDerivBalance = balanceAfter;
        }
      }

      const syncedBal = await syncPostTradeBalance(params.userId, account.id, balanceAfter, payoutCredit);
      lastOrderSyncCache.delete(params.userId);
      return { exitPrice, pnl, status, balanceAfter: syncedBal };
    } catch (err) {
      if (attempt === 0 && isSocketTransportError(err)) {
        evictTradingSocket(params.userId, account.id);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to close Deriv contract after socket reconnect');
}

export interface LiveDerivContractSnapshot {
  currentSpot: number;
  profit: number;
  bidPrice: number;
}

export async function syncOpenDerivOrdersForUser(
  userId: string
): Promise<Record<string, LiveDerivContractSnapshot>> {
  const cached = lastOrderSyncCache.get(userId);
  if (cached && Date.now() - cached.at < ORDER_SYNC_TTL_MS) {
    return cached.snapshots;
  }

  const inflight = inFlightOrderSyncs.get(userId);
  if (inflight) {
    return inflight;
  }

  const runSync = async (): Promise<Record<string, LiveDerivContractSnapshot>> => {
    const snapshots: Record<string, LiveDerivContractSnapshot> = {};
    const openRes = await pool.query(
      `SELECT id, connected_account_id, deriv_contract_id, entry_price, stake, symbol, source
       FROM virtual_orders
       WHERE user_id = $1 AND status = 'OPEN' AND deriv_contract_id IS NOT NULL AND connected_account_id IS NOT NULL`,
      [userId]
    );

    if (openRes.rows.length === 0) {
      lastOrderSyncCache.set(userId, { at: Date.now(), snapshots });
      return snapshots;
    }

    const byAccount = new Map<
      string,
      Array<{ id: string; contractId: number; entryPrice: number; stake: number; symbol: string; source: string }>
    >();
    for (const row of openRes.rows) {
      const list = byAccount.get(row.connected_account_id) ?? [];
      list.push({
        id: row.id,
        contractId: Number(row.deriv_contract_id),
        entryPrice: Number(row.entry_price),
        stake: Number(row.stake),
        symbol: String(row.symbol),
        source: String(row.source || 'manual')
      });
      byAccount.set(row.connected_account_id, list);
    }

    for (const [accountId, items] of byAccount.entries()) {
      const existingPoolEntry = tradingSocketPool.get(`${userId}:${accountId}`);
      if ((!existingPoolEntry || !existingPoolEntry.handle.isOpen()) && isOtpInCooldown(userId)) {
        // Avoid consuming OTP quota during rate-limit cooldown so manual opens/closes recover cleanly
        continue;
      }

      const account = await getAuthorizedAccountForTrading(userId, accountId).catch(() => null);
      if (!account) continue;

      try {
        const sock = await getPooledTradingSocket(userId, account);
        const closedItems: Array<{
          orderId: string;
          contractId: number;
          symbol: string;
          source: string;
          status: 'CLOSED_TP' | 'CLOSED_SL';
          exitPrice: number;
          pnl: number;
        }> = [];
        let totalLockedDelta = 0;

        for (const item of items) {
          try {
            const pocRes = await sock.request<OpenContractRes>({
              proposal_open_contract: 1,
              contract_id: item.contractId
            });
            const poc = pocRes.proposal_open_contract;
            if (!poc) continue;

            if (isContractSettled(poc)) {
              const pnl = Number(poc.profit ?? 0);
              const exitPrice = Number(poc.exit_tick ?? poc.current_spot ?? item.entryPrice);
              const closeStatus: 'CLOSED_TP' | 'CLOSED_SL' = pnl >= 0 ? 'CLOSED_TP' : 'CLOSED_SL';

              const upd = await pool.query(
                `UPDATE virtual_orders
                 SET status = $1, exit_price = $2, pnl = $3, closed_at = NOW()
                 WHERE id = $4 AND status = 'OPEN'
                 RETURNING id`,
                [closeStatus, exitPrice, pnl, item.id]
              );

              if (upd.rows.length > 0) {
                const buyPrice = Number(poc.buy_price ?? item.stake);
                const payoutCredit = Number(poc.sell_price ?? Math.max(0, buyPrice + pnl));
                totalLockedDelta += payoutCredit;
                closedItems.push({
                  orderId: item.id,
                  contractId: item.contractId,
                  symbol: item.symbol,
                  source: item.source,
                  status: closeStatus,
                  exitPrice,
                  pnl
                });
              }
            } else {
              snapshots[item.id] = {
                currentSpot: Number(poc.current_spot ?? item.entryPrice),
                profit: Number(poc.profit ?? 0),
                bidPrice: Number(poc.bid_price ?? 0)
              };
            }
          } catch (itemErr) {
            if (isSocketTransportError(itemErr)) {
              evictTradingSocket(userId, accountId);
              break;
            }
          }
        }

        if (closedItems.length > 0) {
          let newBal: number | null = null;
          const balRes = await sock.request<BalanceRes>({ balance: 1 }).catch(() => null);
          if (balRes?.balance?.balance !== undefined) {
            newBal = Number(balRes.balance.balance);
            sock.actualDerivBalance = newBal;
          }
          const finalBalance = await syncPostTradeBalance(userId, accountId, newBal, totalLockedDelta);

          for (const closed of closedItems) {
            if (derivSettlementHandler) {
              await Promise.resolve(
                derivSettlementHandler({
                  orderId: closed.orderId,
                  userId,
                  connectedAccountId: accountId,
                  contractId: closed.contractId,
                  symbol: closed.symbol,
                  source: closed.source,
                  status: closed.status,
                  exitPrice: closed.exitPrice,
                  pnl: closed.pnl,
                  balanceAfter: finalBalance
                })
              ).catch(() => {});
            }
            broadcastToUser(userId, {
              type: 'order_closed',
              orderId: closed.orderId,
              symbol: closed.symbol,
              status: closed.status,
              exitPrice: closed.exitPrice,
              pnl: closed.pnl
            });
          }
        }
      } catch {
        // Ignore transient errors during background sync
      }
    }

    lastOrderSyncCache.set(userId, { at: Date.now(), snapshots });
    return snapshots;
  };

  const syncPromise = runSync().finally(() => {
    inFlightOrderSyncs.delete(userId);
  });
  inFlightOrderSyncs.set(userId, syncPromise);
  return syncPromise;
}
