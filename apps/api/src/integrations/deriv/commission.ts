import WebSocket from 'ws';
import { DerivMessage } from './websocket';
import { env } from '../../config/env';

export interface DerivPartnerBreakdownRow {
  app_id: number | string;
  app_markup_usd: number;
  volume_usd: number;
  payout_usd: number;
  contract_count: number;
  client_count: number;
  transactions_count?: number;
  dev_currencypayout_currency?: string;
}

export interface DerivAppMarkupStats {
  totalAppMarkupUsd: number;
  totalVolumeUsd: number;
  totalPayoutUsd: number;
  totalTransactionsCount: number;
  totalClientCount: number;
  breakdownByAppId: DerivPartnerBreakdownRow[];
  transactions: Array<{
    app_id: number;
    app_markup_usd: number;
    app_markup_value: number;
    client_loginid: string;
    transaction_id: number;
    transaction_time: string;
    dev_currencypayout_currency?: string;
  }>;
  registeredApps: Array<{
    app_id: number;
    name: string;
    app_markup_percentage?: number;
    redirect_uri?: string;
    verification_uri?: string;
    scopes?: string[];
  }>;
  authorizedAccount?: {
    loginid: string;
    email?: string;
    currency?: string;
    scopes?: string[];
  };
  tokenType: 'oauth2' | 'pat' | 'legacy' | 'none';
  restHttpStatus: number | null;
  meta?: {
    endpoint?: string;
    request_id?: string;
    response_time_ms?: number;
    timestamp?: string;
  };
  error?: string;
}

interface PartnerMarkupRestResponse {
  data?: {
    total_app_markup_usd?: number | string;
    total_volume_usd?: number | string;
    total_payout_usd?: number | string;
    total_contract_count?: number | string;
    total_client_count?: number | string;
    breakdown?: Array<{
      app_id?: number | string;
      app_markup_usd?: number | string;
      volume_usd?: number | string;
      payout_usd?: number | string;
      contract_count?: number | string;
      client_count?: number | string;
    }>;
  };
  meta?: {
    endpoint?: string;
    request_id?: string;
    response_time_ms?: number;
    timestamp?: string;
  };
  errors?: Array<{ code?: string; message?: string; status?: number }>;
  message?: string;
  error?: string;
}

function detectTokenType(token: string): 'oauth2' | 'pat' | 'legacy' | 'none' {
  const t = token.trim();
  if (!t) return 'none';
  if (t.startsWith('ory_at_')) return 'oauth2';
  // Classic Deriv legacy tokens are ~15 chars alphanumeric; modern PATs are 30+ chars or prefixed
  if (t.length > 24 || t.includes('.') || t.startsWith('pat_') || t.startsWith('deriv_')) {
    return 'pat';
  }
  return 'legacy';
}

function sendOnSocket<T extends DerivMessage>(
  ws: WebSocket,
  payload: Record<string, unknown>,
  reqId: number,
  timeoutMs = 10000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Deriv WS timeout on ${Object.keys(payload)[0]}`));
    }, timeoutMs);

    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const msg: DerivMessage = JSON.parse(raw.toString());
        if (msg.req_id === reqId) {
          cleanup();
          if (msg.error) {
            reject(new Error(`${msg.error.code}: ${msg.error.message}`));
          } else {
            resolve(msg as T);
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    const onClose = () => {
      cleanup();
      reject(new Error('Deriv commission WebSocket closed unexpectedly'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('close', onClose);
    };

    ws.on('message', onMessage);
    ws.on('close', onClose);
    ws.send(JSON.stringify({ ...payload, req_id: reqId }));
  });
}

async function fetchLegacyWsSupplementary(params: {
  token: string;
  appId: string;
  dateFrom: string;
  dateTo: string;
}) {
  const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(params.appId)}&l=EN&brand=deriv`;
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const candidate = new WebSocket(wsUrl, {
      headers: {
        Origin: 'https://app.deriv.com',
        'User-Agent': 'Mozilla/5.0 (compatible; Pipflowtrades/1.0)'
      },
      handshakeTimeout: 5000
    });
    const t = setTimeout(() => {
      try {
        candidate.terminate();
      } catch {
        // ignore
      }
      reject(new Error('Legacy WS timeout'));
    }, 5000);
    candidate.once('open', () => {
      clearTimeout(t);
      resolve(candidate);
    });
    candidate.once('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });

  try {
    const authRes = await sendOnSocket<
      DerivMessage & {
        authorize?: {
          loginid: string;
          email?: string;
          currency?: string;
          scopes?: string[];
        };
      }
    >(ws, { authorize: params.token }, 1);

    const dateFromFull = params.dateFrom.includes(' ') ? params.dateFrom : `${params.dateFrom} 00:00:00`;
    const dateToFull = params.dateTo.includes(' ') ? params.dateTo : `${params.dateTo} 23:59:59`;

    const [statsRes, detailsRes, appsRes] = await Promise.allSettled([
      sendOnSocket<
        DerivMessage & {
          app_markup_statistics?: {
            total_app_markup_usd?: number;
            total_transactions_count?: number;
            breakdown_by_app_id?: Array<{
              app_id: number;
              app_markup_usd: number;
              transactions_count: number;
              dev_currencypayout_currency?: string;
            }>;
          };
        }
      >(ws, { app_markup_statistics: 1, date_from: dateFromFull, date_to: dateToFull }, 2),
      sendOnSocket<
        DerivMessage & {
          app_markup_details?: {
            transactions?: DerivAppMarkupStats['transactions'];
          };
        }
      >(
        ws,
        {
          app_markup_details: 1,
          date_from: dateFromFull,
          date_to: dateToFull,
          limit: 100,
          sort: 'DESC'
        },
        3
      ),
      sendOnSocket<
        DerivMessage & {
          app_list?: DerivAppMarkupStats['registeredApps'];
        }
      >(ws, { app_list: 1 }, 4)
    ]);

    return {
      authorizedAccount: authRes.authorize
        ? {
            loginid: authRes.authorize.loginid,
            email: authRes.authorize.email,
            currency: authRes.authorize.currency,
            scopes: authRes.authorize.scopes ?? []
          }
        : undefined,
      wsStats: statsRes.status === 'fulfilled' ? statsRes.value.app_markup_statistics : undefined,
      transactions:
        detailsRes.status === 'fulfilled' && Array.isArray(detailsRes.value.app_markup_details?.transactions)
          ? detailsRes.value.app_markup_details!.transactions
          : [],
      registeredApps:
        appsRes.status === 'fulfilled' && Array.isArray(appsRes.value.app_list)
          ? appsRes.value.app_list
          : []
    };
  } finally {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
}

function extractDerivRestError(rawText: string, status: number): {
  message?: string;
  meta?: PartnerMarkupRestResponse['meta'];
  data?: PartnerMarkupRestResponse['data'];
} {
  if (!rawText) return {};
  try {
    const body = JSON.parse(rawText) as Omit<PartnerMarkupRestResponse, 'error' | 'errors'> & {
      error_description?: string;
      error?: string | { message?: string; code?: string };
      errors?: Array<{ code?: string; message?: string; detail?: string; status?: number }>;
    };
    const errItem = body.errors?.[0];
    const nestedErr =
      body.error && typeof body.error === 'object'
        ? body.error.message || body.error.code
        : typeof body.error === 'string'
          ? body.error
          : undefined;
    const message =
      errItem?.message ||
      errItem?.detail ||
      body.error_description ||
      body.message ||
      nestedErr ||
      (errItem?.code ? `${errItem.code} (HTTP ${status})` : undefined);
    return { message, meta: body.meta, data: body.data };
  } catch {
    const clean = rawText.replace(/<[^>]+>/g, ' ').trim();
    return { message: clean ? clean.slice(0, 220) : undefined };
  }
}

export async function fetchDerivAppMarkupReport(params: {
  token: string;
  appId?: string;
  dateFrom: string;
  dateTo: string;
}): Promise<DerivAppMarkupStats> {
  const cleanToken = params.token.trim().replace(/^Bearer\s+/i, '').trim();
  const configuredAppId = (params.appId?.trim() || env.derivAppId.trim() || '').trim();
  const numericWsAppId = /^\d+$/.test(configuredAppId) ? configuredAppId : '1089';
  const tokenType = detectTokenType(cleanToken);

  const empty: DerivAppMarkupStats = {
    totalAppMarkupUsd: 0,
    totalVolumeUsd: 0,
    totalPayoutUsd: 0,
    totalTransactionsCount: 0,
    totalClientCount: 0,
    breakdownByAppId: [],
    transactions: [],
    registeredApps: [],
    tokenType,
    restHttpStatus: null
  };

  if (!cleanToken) {
    return {
      ...empty,
      error:
        'No Owner token configured yet. Authorize via Deriv Owner OAuth2 (application_read scope) or save a Personal Access Token with application_read scope below.'
    };
  }

  // Primary: Official Deriv Partners REST API (`GET https://api.derivws.com/applications/v1/markup-statistics`)
  const qs = new URLSearchParams({
    date_from: params.dateFrom.slice(0, 10),
    date_to: params.dateTo.slice(0, 10)
  });
  const restUrl = `https://api.derivws.com/applications/v1/markup-statistics?${qs.toString()}`;
  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${cleanToken}`,
    Accept: 'application/json'
  };
  const headers: Record<string, string> = { ...baseHeaders };
  if (tokenType !== 'oauth2' && configuredAppId) {
    headers['Deriv-App-ID'] = configuredAppId;
  }

  let restHttpStatus: number | null = null;
  let restError: string | undefined;
  let restData: PartnerMarkupRestResponse['data'] | undefined;
  let restMeta: PartnerMarkupRestResponse['meta'] | undefined;

  try {
    let restRes = await fetch(restUrl, { method: 'GET', headers });
    // If a non-prefixed OAuth2 JWT/Bearer token was classified as 'pat' and failed with Deriv-App-ID, retry once without it
    if (restRes.status === 401 && tokenType === 'pat' && headers['Deriv-App-ID']) {
      const retryRes = await fetch(restUrl, { method: 'GET', headers: baseHeaders });
      if (retryRes.ok || retryRes.status !== 401) {
        restRes = retryRes;
      }
    }

    restHttpStatus = restRes.status;
    const rawText = await restRes.text().catch(() => '');
    const parsed = extractDerivRestError(rawText, restRes.status);
    restMeta = parsed.meta;

    if (restRes.ok && parsed.data) {
      restData = parsed.data;
    } else if (restRes.status === 401) {
      const upstreamDetail = parsed.message ? ` (${parsed.message})` : '';
      if (tokenType === 'legacy') {
        restError = `Deriv Partners API returned HTTP 401${upstreamDetail}. Your saved token (${cleanToken.length} chars) looks like a classic Deriv WebSocket API token rather than a developers.deriv.com token. Click "Connect Owner Token via Deriv (application_read)" above or paste a Personal Access Token (PAT) from developers.deriv.com.`;
      } else if (tokenType === 'oauth2') {
        restError = `Deriv Partners API returned HTTP 401${upstreamDetail}. Your Owner OAuth2 token may be expired or missing the "application_read" scope. Click "Reconnect Owner Token via Deriv OAuth2" above with the Deriv account that owns this app.`;
      } else {
        restError = `Deriv Partners API returned HTTP 401${upstreamDetail}. Verify that you pasted a valid developers.deriv.com Personal Access Token (PAT) with "application_read" scope (not a Client Secret or legacy app.deriv.com token) and that Deriv App ID / Client ID matches your registered app.`;
      }
    } else {
      restError = parsed.message || `Deriv Partners API returned HTTP ${restRes.status}`;
    }
  } catch (err) {
    restError = `Deriv Partners REST request failed: ${(err as Error).message}`;
  }

  // If token is a classic legacy token, optionally query WS for breakdown/transaction details & fallback
  let wsExtra: Awaited<ReturnType<typeof fetchLegacyWsSupplementary>> | null = null;
  if (tokenType === 'legacy') {
    wsExtra = await fetchLegacyWsSupplementary({
      token: cleanToken,
      appId: numericWsAppId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo
    }).catch(() => null);
  }

  if (restData) {
    const breakdown: DerivPartnerBreakdownRow[] = Array.isArray(restData.breakdown)
      ? restData.breakdown.map((b) => ({
          app_id: b.app_id ?? configuredAppId,
          app_markup_usd: Number(b.app_markup_usd ?? 0),
          volume_usd: Number(b.volume_usd ?? 0),
          payout_usd: Number(b.payout_usd ?? 0),
          contract_count: Number(b.contract_count ?? 0),
          client_count: Number(b.client_count ?? 0),
          transactions_count: Number(b.contract_count ?? 0)
        }))
      : [];

    return {
      totalAppMarkupUsd: Number(restData.total_app_markup_usd ?? 0),
      totalVolumeUsd: Number(restData.total_volume_usd ?? 0),
      totalPayoutUsd: Number(restData.total_payout_usd ?? 0),
      totalTransactionsCount: Number(restData.total_contract_count ?? 0),
      totalClientCount: Number(restData.total_client_count ?? 0),
      breakdownByAppId: breakdown,
      transactions: wsExtra?.transactions ?? [],
      registeredApps: wsExtra?.registeredApps ?? [],
      authorizedAccount: wsExtra?.authorizedAccount,
      tokenType,
      restHttpStatus,
      meta: restMeta
    };
  }

  if (wsExtra?.wsStats) {
    return {
      totalAppMarkupUsd: Number(wsExtra.wsStats.total_app_markup_usd ?? 0),
      totalVolumeUsd: 0,
      totalPayoutUsd: 0,
      totalTransactionsCount: Number(wsExtra.wsStats.total_transactions_count ?? 0),
      totalClientCount: 0,
      breakdownByAppId: Array.isArray(wsExtra.wsStats.breakdown_by_app_id)
        ? wsExtra.wsStats.breakdown_by_app_id.map((b) => ({
            app_id: b.app_id,
            app_markup_usd: Number(b.app_markup_usd ?? 0),
            volume_usd: 0,
            payout_usd: 0,
            contract_count: Number(b.transactions_count ?? 0),
            client_count: 0,
            transactions_count: Number(b.transactions_count ?? 0),
            dev_currencypayout_currency: b.dev_currencypayout_currency
          }))
        : [],
      transactions: wsExtra.transactions,
      registeredApps: wsExtra.registeredApps,
      authorizedAccount: wsExtra.authorizedAccount,
      tokenType,
      restHttpStatus,
      meta: restMeta
    };
  }

  return {
    ...empty,
    registeredApps: wsExtra?.registeredApps ?? [],
    authorizedAccount: wsExtra?.authorizedAccount,
    restHttpStatus,
    meta: restMeta,
    error:
      restError ||
      'Unable to fetch Deriv Partners markup statistics. Ensure your token has the `application_read` scope and Deriv-App-ID matches your registered app.'
  };
}
