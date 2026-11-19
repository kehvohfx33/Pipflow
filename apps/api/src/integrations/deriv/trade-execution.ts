import { pool } from '../../database/pool';
import { decryptToken } from '../../utils/crypto';
import { broadcastToUser } from '../../services/realtime-hub';
import { DerivClient, OtpDerivClient } from './deriv-client';
import { DerivMessage } from './websocket';
import {
  fetchNewDerivAccounts,
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
  request: <T extends DerivMessage = DerivMessage>(payload: Record<string, unknown>) => Promise<T>;
  close: () => void;
  scopes: string[];
  currency: string;
  actualDerivBalance: number | null;
}

async function openAuthenticatedTradingSocket(account: AuthorizedTradeAccount): Promise<TradingSocketHandle> {
  const cleanToken = account.rawToken.trim();

  // 1. OAuth2 Bearer `ory_at_...` uses the REST OTP endpoint + `api.derivws.com` gateway
  if (isOAuth2AccessToken(cleanToken)) {
    const [otpUrl, liveList] = await Promise.all([
      getApiDerivAccountOtpUrl(cleanToken, account.derivLoginId, false),
      fetchNewDerivAccounts(cleanToken, { isPat: false }).catch(() => [])
    ]);
    const matchedLive = liveList.find((a) => a.loginid === account.derivLoginId);
    const otpClient = new OtpDerivClient(otpUrl);
    await otpClient.connect();
    let actualBal: number | null = matchedLive ? Number(matchedLive.balance) : null;
    if (actualBal === null) {
      const balRes = await otpClient.request<BalanceRes>({ balance: 1 }).catch(() => null);
      if (balRes?.balance?.balance !== undefined) {
        actualBal = Number(balRes.balance.balance);
      }
    }
    return {
      isOtpGateway: true,
      symbolField: 'underlying_symbol',
      request: <T extends DerivMessage = DerivMessage>(payload: Record<string, unknown>) =>
        otpClient.request<T>(payload),
      close: () => otpClient.close(),
      scopes: account.grantedScopes.length > 0 ? account.grantedScopes : ['read', 'trade'],
      currency: matchedLive?.currency || account.currency || 'USD',
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
      const [otpUrl, liveList] = await Promise.all([
        getApiDerivAccountOtpUrl(cleanToken, account.derivLoginId, true),
        fetchNewDerivAccounts(cleanToken, { isPat: true }).catch(() => [])
      ]);
      const matchedLive = liveList.find((a) => a.loginid === account.derivLoginId);
      const otpClient = new OtpDerivClient(otpUrl);
      await otpClient.connect();
      let actualBal: number | null = matchedLive ? Number(matchedLive.balance) : null;
      if (actualBal === null) {
        const balRes = await otpClient.request<BalanceRes>({ balance: 1 }).catch(() => null);
        if (balRes?.balance?.balance !== undefined) {
          actualBal = Number(balRes.balance.balance);
        }
      }
      return {
        isOtpGateway: true,
        symbolField: 'underlying_symbol',
        request: <T extends DerivMessage = DerivMessage>(payload: Record<string, unknown>) =>
          otpClient.request<T>(payload),
        close: () => otpClient.close(),
        scopes: account.grantedScopes.length > 0 ? account.grantedScopes : ['read', 'trade'],
        currency: matchedLive?.currency || account.currency || 'USD',
        actualDerivBalance: actualBal
      };
    } catch {
      throw legacyErr;
    }
  }
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

  const sock = await openAuthenticatedTradingSocket(account);
  try {
    if (!sock.scopes.includes('trade')) {
      throw new Error(
        `Trading account does not have "trade" permission (${sock.scopes.join(', ')}). Re-authorize via Deriv login.`
      );
    }

    // Strict Real-Account Guard:
    // Admin-altered real balances sync visually across all views, but live real orders
    // require actual real funds on Deriv to place orders.
    if (
      account.accountType === 'real' &&
      sock.actualDerivBalance !== null &&
      sock.actualDerivBalance < Number(input.stake)
    ) {
      throw new Error(
        `Insufficient actual live Deriv balance ($${sock.actualDerivBalance.toFixed(2)} ${sock.currency}) on Real account to place a $${Number(input.stake).toFixed(2)} order on Deriv.`
      );
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
  } finally {
    sock.close();
  }
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

  const sock = await openAuthenticatedTradingSocket(account);
  try {
    const pocRes = await sock.request<OpenContractRes>({
      proposal_open_contract: 1,
      contract_id: params.contractId
    });
    const poc = pocRes.proposal_open_contract;

    let pnl = Number(poc?.profit ?? 0);
    const buyPrice = Number(poc?.buy_price ?? 0);
    let payoutCredit = Number(poc?.sell_price ?? Math.max(0, buyPrice + pnl));
    const exitPrice = Number(poc?.exit_tick ?? poc?.current_spot ?? params.fallbackExitPrice);
    let status: 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL' = 'CLOSED_MANUAL';
    let balanceAfter: number | null = null;

    if (poc && (poc.is_sold === 1 || poc.status === 'won' || poc.status === 'lost' || poc.status === 'sold')) {
      status = pnl >= 0 ? 'CLOSED_TP' : 'CLOSED_SL';
    } else {
      try {
        const sellRes = await sock.request<SellRes>({
          sell: params.contractId,
          price: 0
        });
        if (sellRes.sell) {
          balanceAfter = Number(sellRes.sell.balance_after);
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
        if (
          rePoc &&
          (rePoc.is_sold === 1 || rePoc.status === 'won' || rePoc.status === 'lost' || rePoc.status === 'sold')
        ) {
          pnl = Number(rePoc.profit ?? pnl);
          const reBuy = Number(rePoc.buy_price ?? buyPrice);
          payoutCredit = Number(rePoc.sell_price ?? Math.max(0, reBuy + pnl));
          status = pnl >= 0 ? 'CLOSED_TP' : 'CLOSED_SL';
        } else {
          throw sellErr;
        }
      }
    }

    if (balanceAfter === null) {
      if (isOAuth2AccessToken(account.rawToken)) {
        const list = await fetchNewDerivAccounts(account.rawToken, { isPat: false }).catch(() => []);
        const match = list.find((a) => a.loginid === account.derivLoginId);
        if (match) balanceAfter = match.balance;
      } else {
        const balRes = await sock.request<BalanceRes>({ balance: 1 }).catch(() => null);
        if (balRes?.balance?.balance !== undefined) {
          balanceAfter = Number(balRes.balance.balance);
        }
      }
    }

    const syncedBal = await syncPostTradeBalance(params.userId, account.id, balanceAfter, payoutCredit);
    return { exitPrice, pnl, status, balanceAfter: syncedBal };
  } finally {
    sock.close();
  }
}

export interface LiveDerivContractSnapshot {
  currentSpot: number;
  profit: number;
  bidPrice: number;
}

export async function syncOpenDerivOrdersForUser(
  userId: string
): Promise<Record<string, LiveDerivContractSnapshot>> {
  const snapshots: Record<string, LiveDerivContractSnapshot> = {};
  const openRes = await pool.query(
    `SELECT id, connected_account_id, deriv_contract_id, entry_price, stake, symbol, source
     FROM virtual_orders
     WHERE user_id = $1 AND status = 'OPEN' AND deriv_contract_id IS NOT NULL AND connected_account_id IS NOT NULL`,
    [userId]
  );

  if (openRes.rows.length === 0) return snapshots;

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
    const account = await getAuthorizedAccountForTrading(userId, accountId).catch(() => null);
    if (!account) continue;

    let sock: TradingSocketHandle | null = null;
    try {
      sock = await openAuthenticatedTradingSocket(account);
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

          if (poc.is_sold === 1 || poc.status === 'won' || poc.status === 'lost' || poc.status === 'sold') {
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
        } catch {
          // Skip transient per-contract lookup failures
        }
      }

      if (closedItems.length > 0) {
        let newBal: number | null = null;
        if (isOAuth2AccessToken(account.rawToken)) {
          const list = await fetchNewDerivAccounts(account.rawToken, { isPat: false }).catch(() => []);
          const match = list.find((a) => a.loginid === account.derivLoginId);
          if (match) newBal = match.balance;
        } else {
          const balRes = await sock.request<BalanceRes>({ balance: 1 }).catch(() => null);
          if (balRes?.balance?.balance !== undefined) {
            newBal = Number(balRes.balance.balance);
          }
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
    } finally {
      sock?.close();
    }
  }

  return snapshots;
}
