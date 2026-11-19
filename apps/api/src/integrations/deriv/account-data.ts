import { env } from '../../config/env';
import { DerivClient, OtpDerivClient } from './deriv-client';
import { DerivMessage } from './websocket';

export const DERIV_API_BASE = 'https://api.derivws.com';

export interface ReadOnlyDerivAccount {
  loginid: string;
  email?: string;
  fullname?: string;
  currency: string;
  balance: number;
  is_virtual: boolean;
  landing_company_name?: string;
  scopes: string[];
  account_list: Array<{
    loginid: string;
    currency: string;
    is_virtual: boolean;
    balance?: number;
    landing_company_name?: string;
  }>;
}

interface AuthorizeResponse extends DerivMessage {
  authorize?: {
    loginid: string;
    email?: string;
    fullname?: string;
    currency: string;
    balance: number;
    is_virtual: number;
    landing_company_name?: string;
    scopes?: string[];
    account_list?: Array<{
      loginid: string;
      currency: string;
      is_virtual: number;
      landing_company_name?: string;
    }>;
  };
}

interface StatementResponse extends DerivMessage {
  statement?: { transactions?: unknown[] };
}

interface GetSettingsResponse extends DerivMessage {
  get_settings?: {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
}

interface AllBalancesResponse extends DerivMessage {
  balance?: {
    balance?: number;
    currency?: string;
    accounts?: Record<string, { balance?: number; currency?: string; type?: string }>;
  };
}

interface NewDerivAccountRow {
  account_id: string;
  balance: number;
  currency: string;
  group?: string;
  status?: string;
  account_type: 'demo' | 'real';
}

export function isOAuth2AccessToken(token: string): boolean {
  return token.trim().startsWith('ory_at_');
}

function buildApiDerivHeaders(token: string, includeAppIdForPat: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.trim()}`,
    'Content-Type': 'application/json'
  };
  if (includeAppIdForPat && env.derivAppId.trim()) {
    headers['Deriv-App-ID'] = env.derivAppId.trim();
  }
  return headers;
}

/**
 * Fetches Options trading accounts & balances via Official Deriv REST API (`GET /trading/v1/options/accounts`)
 * and enriches with real profile name, email, and live balances via Deriv OTP WS (`get_settings`, `balance`).
 */
export async function fetchNewDerivAccounts(
  token: string,
  options?: { isPat?: boolean; grantedScopes?: string[] }
): Promise<ReadOnlyDerivAccount[]> {
  const isPat = options?.isPat ?? !isOAuth2AccessToken(token);
  const res = await fetch(`${DERIV_API_BASE}/trading/v1/options/accounts`, {
    method: 'GET',
    headers: buildApiDerivHeaders(token, isPat)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let parsedMsg = errText;
    try {
      const parsed = JSON.parse(errText) as { errors?: Array<{ message?: string }>; message?: string };
      parsedMsg = parsed.errors?.[0]?.message || parsed.message || errText;
    } catch {
      // use raw text
    }
    throw new Error(`Deriv API (${res.status}): ${parsedMsg || 'Failed to load Deriv accounts'}`);
  }

  const body = (await res.json()) as { data?: NewDerivAccountRow[] };
  const rows = Array.isArray(body.data) ? body.data : [];
  if (rows.length === 0) {
    throw new Error('No Deriv trading accounts returned for this authorization');
  }

  // Optionally resolve user nickname / external reference ID if account_manage scope is present
  let nickname: string | undefined;
  let externalRef: string | undefined;
  try {
    const nickRes = await fetch(`${DERIV_API_BASE}/account/v1/nickname`, {
      method: 'GET',
      headers: buildApiDerivHeaders(token, isPat)
    });
    if (nickRes.ok) {
      const nickBody = (await nickRes.json()) as { data?: { nickname?: string; external_reference_id?: string } };
      nickname = nickBody.data?.nickname;
      externalRef = nickBody.data?.external_reference_id;
    }
  } catch {
    // account_manage scope may not be granted; proceed cleanly
  }

  // Resolve real Deriv full name, email, and reconciled live balances via primary account OTP WebSocket
  let realFullName: string | undefined;
  let realEmail: string | undefined;
  const liveBalancesByLogin = new Map<string, number>();

  try {
    const probeRow = rows.find((r) => r.account_type === 'real') ?? rows[0];
    const otpUrl = await Promise.race([
      getApiDerivAccountOtpUrl(token, probeRow.account_id, isPat),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('otp_timeout')), 4000))
    ]);
    const otpClient = new OtpDerivClient(otpUrl);
    try {
      await otpClient.connect(4000);
      const [settingsRes, balRes] = await Promise.all([
        otpClient.request<GetSettingsResponse>({ get_settings: 1 }, 3500).catch(() => null),
        otpClient.request<AllBalancesResponse>({ balance: 1, account: 'all' }, 3500).catch(() => null)
      ]);
      const gs = settingsRes?.get_settings;
      if (gs) {
        const joined = [gs.first_name, gs.last_name]
          .map((s) => (s || '').trim())
          .filter(Boolean)
          .join(' ')
          .trim();
        if (joined) realFullName = joined;
        if (gs.email?.trim()) realEmail = gs.email.trim().toLowerCase();
      }
      const allAccounts = balRes?.balance?.accounts;
      if (allAccounts && typeof allAccounts === 'object') {
        for (const [loginId, info] of Object.entries(allAccounts)) {
          if (info && info.balance !== undefined && Number.isFinite(Number(info.balance))) {
            liveBalancesByLogin.set(loginId, Number(info.balance));
          }
        }
      }
    } finally {
      otpClient.close();
    }
  } catch {
    // Graceful fallback to REST rows & nickname
  }

  const scopes = options?.grantedScopes ?? ['read', 'trade'];
  const accountList = rows.map((r) => {
    const bal = liveBalancesByLogin.has(r.account_id)
      ? liveBalancesByLogin.get(r.account_id)!
      : Number(r.balance ?? 0);
    return {
      loginid: r.account_id,
      currency: r.currency || 'USD',
      is_virtual: r.account_type === 'demo',
      balance: bal,
      landing_company_name: r.group
    };
  });

  return rows.map((r) => {
    const bal = liveBalancesByLogin.has(r.account_id)
      ? liveBalancesByLogin.get(r.account_id)!
      : Number(r.balance ?? 0);
    return {
      loginid: r.account_id,
      email: realEmail || (externalRef ? `${externalRef.toLowerCase()}@deriv-oauth.local` : undefined),
      fullname: realFullName || nickname || r.account_id,
      currency: r.currency || 'USD',
      balance: bal,
      is_virtual: r.account_type === 'demo',
      landing_company_name: r.group,
      scopes,
      account_list: accountList
    };
  });
}

export async function getApiDerivAccountOtpUrl(
  token: string,
  accountId: string,
  isPat = !isOAuth2AccessToken(token)
): Promise<string> {
  const res = await fetch(
    `${DERIV_API_BASE}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
    {
      method: 'POST',
      headers: buildApiDerivHeaders(token, isPat)
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let parsedMsg = errText;
    try {
      const parsed = JSON.parse(errText) as { errors?: Array<{ message?: string }>; message?: string };
      parsedMsg = parsed.errors?.[0]?.message || parsed.message || errText;
    } catch {
      // ignore
    }
    throw new Error(`Deriv OTP authorization failed (${res.status}): ${parsedMsg}`);
  }

  const body = (await res.json()) as { data?: { url?: string } };
  if (!body.data?.url) {
    throw new Error('Deriv OTP endpoint did not return a WebSocket URL');
  }
  return body.data.url;
}

/**
 * Verifies an owner-authorized Deriv token (OAuth2 Bearer `ory_at_...`, PAT, or legacy API token).
 * Enriches with real full name, email, and live balances. Never logs or persists raw credentials in plaintext.
 */
export async function authorizeReadOnlyAccount(token: string): Promise<ReadOnlyDerivAccount> {
  const cleanToken = token.trim();

  if (isOAuth2AccessToken(cleanToken)) {
    const accounts = await fetchNewDerivAccounts(cleanToken, { isPat: false });
    return accounts.find((a) => !a.is_virtual) ?? accounts[0];
  }

  // Try legacy WebSocket authorize first for classic API tokens; fallback to new REST PAT API if rejected
  const client = new DerivClient();
  try {
    const res = await client.request<AuthorizeResponse>({ authorize: cleanToken });
    if (!res.authorize) {
      throw new Error('Deriv authorization returned empty account payload');
    }

    const a = res.authorize;
    let fullname = a.fullname?.trim() || undefined;
    let email = a.email?.trim() || undefined;

    if (!fullname || !email) {
      try {
        const gsRes = await Promise.race([
          client.request<GetSettingsResponse>({ get_settings: 1 }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500))
        ]);
        const gs = gsRes?.get_settings;
        if (gs) {
          if (!fullname) {
            const joined = [gs.first_name, gs.last_name]
              .map((s) => (s || '').trim())
              .filter(Boolean)
              .join(' ')
              .trim();
            if (joined) fullname = joined;
          }
          if (!email && gs.email?.trim()) {
            email = gs.email.trim().toLowerCase();
          }
        }
      } catch {
        // Proceed with authorize payload
      }
    }

    const siblingBalances = new Map<string, number>();
    try {
      const balRes = await Promise.race([
        client.request<AllBalancesResponse>({ balance: 1, account: 'all' }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500))
      ]);
      const allAccounts = balRes?.balance?.accounts;
      if (allAccounts && typeof allAccounts === 'object') {
        for (const [loginId, info] of Object.entries(allAccounts)) {
          if (info && info.balance !== undefined && Number.isFinite(Number(info.balance))) {
            siblingBalances.set(loginId, Number(info.balance));
          }
        }
      }
    } catch {
      // Proceed cleanly
    }

    return {
      loginid: a.loginid,
      email,
      fullname,
      currency: a.currency,
      balance: siblingBalances.has(a.loginid) ? siblingBalances.get(a.loginid)! : Number(a.balance ?? 0),
      is_virtual: Boolean(a.is_virtual),
      landing_company_name: a.landing_company_name,
      scopes: a.scopes ?? ['read'],
      account_list: (a.account_list ?? []).map((item) => ({
        loginid: item.loginid,
        currency: item.currency,
        is_virtual: Boolean(item.is_virtual),
        balance: siblingBalances.get(item.loginid),
        landing_company_name: item.landing_company_name
      }))
    };
  } catch (legacyErr) {
    try {
      const accounts = await fetchNewDerivAccounts(cleanToken, { isPat: true });
      return accounts.find((a) => !a.is_virtual) ?? accounts[0];
    } catch {
      throw legacyErr;
    }
  } finally {
    client.socket.close();
  }
}

export async function fetchReadOnlyStatement(token: string, limit = 50, accountId?: string) {
  const cleanToken = token.trim();
  if ((isOAuth2AccessToken(cleanToken) || cleanToken.length > 24) && accountId) {
    try {
      const otpUrl = await getApiDerivAccountOtpUrl(cleanToken, accountId);
      const otpClient = new OtpDerivClient(otpUrl);
      try {
        const res = await otpClient.request<StatementResponse>({
          statement: 1,
          description: 1,
          limit
        });
        return res.statement?.transactions ?? [];
      } finally {
        otpClient.close();
      }
    } catch (otpErr) {
      if (isOAuth2AccessToken(cleanToken)) {
        throw otpErr;
      }
      // Fall through to legacy WS if it was a classic token
    }
  }

  const client = new DerivClient();
  try {
    await client.request({ authorize: cleanToken });
    const res = await client.request<StatementResponse>({
      statement: 1,
      description: 1,
      limit
    });
    return res.statement?.transactions ?? [];
  } finally {
    client.socket.close();
  }
}
