import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../database/pool';
import { env } from '../config/env';
import { encryptToken, decryptToken } from '../utils/crypto';
import {
  authorizeReadOnlyAccount,
  fetchNewDerivAccounts,
  fetchReadOnlyStatement,
  isOAuth2AccessToken,
  ReadOnlyDerivAccount
} from '../integrations/deriv/account-data';
import {
  fetchContractsForSymbol,
  fetchOpenContractSnapshot,
  requestDerivProposal
} from '../integrations/deriv/trade-execution';
import { createNotification, logSecurityEvent } from '../services/notification-service';
import { sendBrevoEmail } from '../emails/brevo-service';
import { parseCookies, SESSION_COOKIE_NAME, setAuthCookies } from '../utils/cookies';

const DISPLAYED_BALANCE_SQL = `CASE
  WHEN ca.account_type = 'real' AND COALESCE(ca.exact_broker_balance_only, TRUE) = TRUE
    THEN ca.last_known_balance
  ELSE (ca.last_known_balance + COALESCE(ca.platform_adjustment_balance, 0))
END AS displayed_balance`;

const DERIV_NEW_AUTH_URL = 'https://auth.deriv.com/oauth2/auth';
const DERIV_NEW_TOKEN_URL = 'https://auth.deriv.com/oauth2/token';

// Replay protection for one-time OAuth2 authorization state JTIs
const usedPkceJtis = new Map<string, number>();

function markJtiUsed(jti: string) {
  const now = Date.now();
  if (usedPkceJtis.size > 500) {
    for (const [key, exp] of usedPkceJtis.entries()) {
      if (exp < now) usedPkceJtis.delete(key);
    }
  }
  usedPkceJtis.set(jti, now + 20 * 60 * 1000);
}

function derivePkceKey(): Buffer {
  return crypto.createHash('sha256').update(env.jwtSecret).digest();
}

function encryptPkceData(payload: { codeVerifier: string; redirectUri: string }): string {
  const key = derivePkceKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function decryptPkceData(blob: string): { codeVerifier: string; redirectUri: string } {
  const buf = Buffer.from(blob, 'base64url');
  if (buf.length <= 28) {
    throw new Error('Invalid PKCE state payload');
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', derivePkceKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as { codeVerifier: string; redirectUri: string };
}

export function resolvePublicSiteBase(req: Request): string {
  const rawHost = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  const lowerHost = rawHost.toLowerCase();
  const isLocalReq = lowerHost.startsWith('localhost') || lowerHost.startsWith('127.0.0.1');
  const protoHeader = req.get('x-forwarded-proto');
  const proto = (protoHeader ? protoHeader.split(',')[0].trim() : req.protocol) || 'https';

  if (isLocalReq) {
    return `${proto}://${rawHost}`;
  }

  // Never expose internal hosting provider domains (*.onrender.com, *.run.app) in OAuth redirects or links
  if (
    rawHost &&
    !lowerHost.includes('.onrender.com') &&
    !lowerHost.includes('.run.app') &&
    !lowerHost.includes('tradederiv')
  ) {
    return `https://${rawHost}`;
  }

  return env.publicSiteUrl.replace(/\/$/, '');
}

export function resolveOAuthRedirectUri(req: Request): string {
  const configured = env.derivOAuthRedirectUri.trim();
  const rawHost = (req.get('x-forwarded-host') || req.get('host') || '').toLowerCase();
  const isLocalReq = rawHost.includes('localhost') || rawHost.includes('127.0.0.1');
  if (
    configured &&
    !configured.includes('localhost') &&
    !configured.includes('.onrender.com') &&
    !configured.includes('.run.app') &&
    !isLocalReq
  ) {
    return configured;
  }
  return `${resolvePublicSiteBase(req)}/api/deriv/oauth/callback`;
}

function isNewDerivAuthUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl.trim()).hostname.toLowerCase() === 'auth.deriv.com';
  } catch {
    return false;
  }
}

export function usesNewDerivOAuth2(): boolean {
  const appId = env.derivAppId.trim();
  if (isNewDerivAuthUrl(env.derivOAuthUrl)) return true;
  // New Deriv Developer Portal client_ids are alphanumeric strings (e.g. 34YwLwPkR0v7HAylZe0pO);
  // legacy OAuth app_ids are strictly numeric (e.g. 1089, 68942).
  return appId.length > 0 && !/^\d+$/.test(appId);
}

export function buildDerivOAuthUrl(
  req: Request,
  opts: { userId?: string; email?: string; purpose: string; mode?: 'login' | 'signup'; scopes?: string }
): { url: string; appId: string; redirectUri: string } {
  const trimmedAppId = env.derivAppId.trim();
  const redirectUri = resolveOAuthRedirectUri(req);

  if (usesNewDerivOAuth2()) {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const jti = crypto.randomUUID();
    const vEnc = encryptPkceData({ codeVerifier, redirectUri });

    const state = jwt.sign(
      {
        jti,
        purpose: opts.purpose,
        userId: opts.userId,
        email: opts.email,
        vEnc
      },
      env.jwtSecret,
      { expiresIn: '15m' }
    );

    const authBase = isNewDerivAuthUrl(env.derivOAuthUrl)
      ? env.derivOAuthUrl.trim()
      : DERIV_NEW_AUTH_URL;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: trimmedAppId,
      redirect_uri: redirectUri,
      scope: opts.scopes?.trim() || env.derivOAuthScopes.trim() || 'trade account_manage',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    if (opts.mode === 'signup') {
      params.set('prompt', 'registration');
    }

    return {
      url: `${authBase}?${params.toString()}`,
      appId: trimmedAppId,
      redirectUri
    };
  }

  const effectiveAppId = /^\d+$/.test(trimmedAppId) ? trimmedAppId : '1089';
  const state = jwt.sign(
    { purpose: opts.purpose, userId: opts.userId, email: opts.email },
    env.jwtSecret,
    { expiresIn: '15m' }
  );
  const url = `${env.derivOAuthUrl}?app_id=${encodeURIComponent(effectiveAppId)}&l=EN&brand=deriv&state=${encodeURIComponent(state)}`;
  return { url, appId: effectiveAppId, redirectUri };
}

async function exchangeOAuth2Code(code: string, codeVerifier: string, redirectUri: string) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.derivAppId.trim(),
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });
  if (env.derivClientSecret.trim()) {
    params.set('client_secret', env.derivClientSecret.trim());
  }

  const tokenBase = isNewDerivAuthUrl(env.derivOAuthUrl)
    ? env.derivOAuthUrl.trim().replace(/\/oauth2\/auth.*$/, '/oauth2/token')
    : DERIV_NEW_TOKEN_URL;

  const res = await fetch(tokenBase, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: params.toString()
  });

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Deriv OAuth2 token exchange failed (${res.status})`);
  }

  const rawScopes = (data.scope || '').split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const grantedScopes =
    rawScopes.length > 0
      ? Array.from(new Set([...rawScopes, ...(rawScopes.includes('trade') ? ['read'] : [])]))
      : ['read', 'trade'];

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    grantedScopes
  };
}

export async function refreshCommissionOAuth2Token(refreshToken: string) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.derivAppId.trim(),
    refresh_token: refreshToken.trim()
  });
  if (env.derivClientSecret.trim()) {
    params.set('client_secret', env.derivClientSecret.trim());
  }

  const tokenBase = isNewDerivAuthUrl(env.derivOAuthUrl)
    ? env.derivOAuthUrl.trim().replace(/\/oauth2\/auth.*$/, '/oauth2/token')
    : DERIV_NEW_TOKEN_URL;

  const res = await fetch(tokenBase, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: params.toString()
  });

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Deriv OAuth2 refresh failed (${res.status})`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    grantedScopes: (data.scope || '').split(/\s+/).map((s) => s.trim()).filter(Boolean)
  };
}

function extractOAuthTokensFromQuery(query: Request['query']): string[] {
  const tokens: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const val = query[`token${i}`];
    if (typeof val === 'string' && val.trim()) {
      tokens.push(val.trim());
    }
  }
  return Array.from(new Set(tokens));
}

function isDerivLoginIdLike(val?: string | null): boolean {
  if (!val) return true;
  return /^(CR|VRTC|MLT|MF|MX|CRW|MFW|MLTW)\d+$/i.test(val.trim());
}

export async function getUserAccountsList(userId: string) {
  const ordered = await pool.query(
    `SELECT ca.id, ca.deriv_login_id, ca.account_type, ca.currency, ca.last_known_balance,
            COALESCE(ca.platform_adjustment_balance, 0) AS platform_adjustment_balance,
            COALESCE(ca.exact_broker_balance_only, TRUE) AS exact_broker_balance_only,
            ${DISPLAYED_BALANCE_SQL},
            ca.landing_company, ca.connection_status, ca.is_primary, ca.last_synced_at,
            COALESCE(aa.granted_scopes, ARRAY['read']) AS granted_scopes
     FROM connected_accounts ca
     LEFT JOIN LATERAL (
       SELECT granted_scopes FROM account_authorizations
       WHERE connected_account_id = ca.id AND user_id = ca.user_id AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1
     ) aa ON TRUE
     WHERE ca.user_id = $1
     ORDER BY CASE WHEN ca.account_type = 'real' THEN 0 ELSE 1 END, ca.is_primary DESC, ca.updated_at DESC`,
    [userId]
  );
  return ordered.rows;
}

async function saveDerivAccountInfos(
  userId: string,
  entries: Array<{ token: string; info: ReadOnlyDerivAccount }>,
  options?: { preserveExistingBalances?: boolean; markMissingDisconnected?: boolean }
): Promise<{
  primary: ReadOnlyDerivAccount;
  saved: Array<Record<string, unknown>>;
}> {
  if (entries.length === 0) {
    throw new Error('No valid Deriv authorization tokens found');
  }

  const preserveExisting = Boolean(options?.preserveExistingBalances);
  const markMissingDisconnected = Boolean(options?.markMissingDisconnected);

  const dedupedMap = new Map<string, { token: string; info: ReadOnlyDerivAccount }>();
  for (const item of entries) {
    dedupedMap.set(item.info.loginid, item);
  }
  const uniqueEntries = Array.from(dedupedMap.values());

  const preferred = uniqueEntries.find((a) => !a.info.is_virtual) ?? uniqueEntries[0];

  await pool.query(`UPDATE connected_accounts SET is_primary = FALSE WHERE user_id = $1`, [userId]);

  for (const { token: rawToken, info } of uniqueEntries) {
    const accountType = info.is_virtual ? 'demo' : 'real';
    const isPrimary = info.loginid === preferred.info.loginid;

    const accRes = await pool.query(
      `INSERT INTO connected_accounts (user_id, deriv_login_id, account_type, currency, last_known_balance, platform_adjustment_balance, exact_broker_balance_only, landing_company, connection_status, is_primary, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, 0, TRUE, $6, 'connected', $7, NOW())
       ON CONFLICT (user_id, deriv_login_id) DO UPDATE SET
         account_type = EXCLUDED.account_type,
         currency = EXCLUDED.currency,
         last_known_balance = CASE
           WHEN $8 = TRUE THEN connected_accounts.last_known_balance
           ELSE EXCLUDED.last_known_balance
         END,
         landing_company = COALESCE(EXCLUDED.landing_company, connected_accounts.landing_company),
         connection_status = 'connected',
         is_primary = EXCLUDED.is_primary,
         last_synced_at = CASE
           WHEN $8 = TRUE THEN connected_accounts.last_synced_at
           ELSE NOW()
         END,
         updated_at = NOW()
       RETURNING id, deriv_login_id, account_type, currency, last_known_balance, platform_adjustment_balance, exact_broker_balance_only, landing_company, connection_status, is_primary, last_synced_at`,
      [
        userId,
        info.loginid,
        accountType,
        info.currency,
        info.balance,
        info.landing_company_name ?? null,
        isPrimary,
        preserveExisting
      ]
    );

    const enc = encryptToken(rawToken);
    await pool.query(
      `INSERT INTO account_authorizations (connected_account_id, user_id, encrypted_token, token_iv, token_auth_tag, granted_scopes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [accRes.rows[0].id, userId, enc.encrypted, enc.iv, enc.authTag, info.scopes]
    );
  }

  if (markMissingDisconnected && uniqueEntries.length > 0) {
    const activeLoginIds = uniqueEntries.map((e) => e.info.loginid);
    await pool.query(
      `UPDATE connected_accounts
       SET connection_status = 'disconnected', is_primary = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND NOT (deriv_login_id = ANY($2::text[])) AND connection_status = 'connected'`,
      [userId, activeLoginIds]
    );
  }

  const orderedRows = await getUserAccountsList(userId);
  return { primary: preferred.info, saved: orderedRows };
}

async function persistAuthorizedAccounts(
  userId: string,
  tokens: string[],
  options?: { preserveExistingBalances?: boolean; markMissingDisconnected?: boolean }
) {
  const authorizedInfos: Array<{ token: string; info: ReadOnlyDerivAccount }> = [];
  for (const rawToken of tokens) {
    if (isOAuth2AccessToken(rawToken)) {
      const accounts = await fetchNewDerivAccounts(rawToken, { isPat: false });
      for (const acc of accounts) {
        authorizedInfos.push({ token: rawToken, info: acc });
      }
    } else {
      const info = await authorizeReadOnlyAccount(rawToken);
      authorizedInfos.push({ token: rawToken, info });
    }
  }
  return saveDerivAccountInfos(userId, authorizedInfos, options);
}

async function persistOAuth2Accounts(
  userId: string,
  accessToken: string,
  accounts: ReadOnlyDerivAccount[],
  options?: { preserveExistingBalances?: boolean; markMissingDisconnected?: boolean }
) {
  return saveDerivAccountInfos(
    userId,
    accounts.map((info) => ({ token: accessToken, info })),
    options
  );
}

export async function syncUserDerivAccountsFromStoredTokens(
  userId: string
): Promise<{ synced: boolean; accounts: Array<Record<string, unknown>>; resolvedFullName?: string }> {
  const activeAuths = await pool.query(
    `SELECT ca.id, ca.deriv_login_id, aa.encrypted_token, aa.token_iv, aa.token_auth_tag, aa.granted_scopes
     FROM connected_accounts ca
     JOIN LATERAL (
       SELECT encrypted_token, token_iv, token_auth_tag, granted_scopes
       FROM account_authorizations
       WHERE connected_account_id = ca.id AND user_id = ca.user_id AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1
     ) aa ON TRUE
     WHERE ca.user_id = $1 AND ca.connection_status IN ('connected', 'disconnected')`,
    [userId]
  );

  if (activeAuths.rows.length === 0) {
    const accounts = await getUserAccountsList(userId);
    return { synced: false, accounts };
  }

  const uniqueTokens = new Map<string, string[]>();
  for (const row of activeAuths.rows) {
    try {
      const rawToken = decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag);
      if (!uniqueTokens.has(rawToken)) {
        uniqueTokens.set(rawToken, Array.isArray(row.granted_scopes) ? row.granted_scopes : ['read', 'trade']);
      }
    } catch {
      // Skip malformed/unreadable encrypted rows
    }
  }

  const entries: Array<{ token: string; info: ReadOnlyDerivAccount }> = [];
  await Promise.allSettled(
    Array.from(uniqueTokens.entries()).map(async ([rawToken, grantedScopes]) => {
      if (isOAuth2AccessToken(rawToken)) {
        const list = await fetchNewDerivAccounts(rawToken, { isPat: false, grantedScopes });
        for (const acc of list) {
          entries.push({ token: rawToken, info: acc });
        }
      } else {
        const info = await authorizeReadOnlyAccount(rawToken);
        entries.push({ token: rawToken, info });
      }
    })
  );

  if (entries.length === 0) {
    const accounts = await getUserAccountsList(userId);
    return { synced: false, accounts };
  }

  const { primary, saved } = await saveDerivAccountInfos(userId, entries, {
    preserveExistingBalances: false,
    markMissingDisconnected: false
  });

  const bestNameCandidate =
    entries.map((e) => e.info.fullname?.trim()).find((n) => n && !isDerivLoginIdLike(n)) ||
    primary.fullname?.trim();

  if (bestNameCandidate && !isDerivLoginIdLike(bestNameCandidate)) {
    await pool.query(
      `UPDATE users SET full_name = $2, updated_at = NOW() WHERE id = $1`,
      [userId, bestNameCandidate]
    );
  }

  return { synced: true, accounts: saved, resolvedFullName: bestNameCandidate };
}

async function findOrCreateOAuthUser(
  info: ReadOnlyDerivAccount,
  ip?: string,
  allAccounts?: ReadOnlyDerivAccount[]
) {
  const candidates = allAccounts && allAccounts.length > 0 ? allAccounts : [info];
  const bestEmail =
    candidates.map((c) => c.email?.trim().toLowerCase()).find((e) => e && !e.endsWith('@deriv-oauth.local')) ||
    candidates.map((c) => c.email?.trim().toLowerCase()).find(Boolean) ||
    `${info.loginid.toLowerCase()}@deriv-oauth.local`;

  const bestHumanName =
    candidates.map((c) => c.fullname?.trim()).find((n) => n && !isDerivLoginIdLike(n)) || '';
  const bestFallbackName =
    bestHumanName || candidates.map((c) => c.fullname?.trim()).find(Boolean) || info.loginid;

  const loginIds = candidates.map((c) => c.loginid);

  const existing = await pool.query(
    `SELECT u.*, r.name as role_name
     FROM users u
     JOIN roles r ON u.role_id = r.id
     WHERE u.email = $1
        OR EXISTS (
          SELECT 1 FROM connected_accounts ca
          WHERE ca.user_id = u.id AND ca.deriv_login_id = ANY($2::text[])
        )
     ORDER BY CASE WHEN u.email = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [bestEmail, loginIds]
  );

  let userRow = existing.rows[0];
  let isNew = false;

  if (!userRow) {
    isNew = true;
    await pool.query(
      `INSERT INTO roles (id, name, description) VALUES (4, 'user', 'Standard registered Pipflowtrade user') ON CONFLICT (name) DO NOTHING`
    );
    const roleRes = await pool.query(`SELECT id FROM roles WHERE name = 'user' LIMIT 1`);
    const userRoleId = Number(roleRes.rows[0]?.id ?? 4);
    const randomPwd = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role_id, is_email_verified, virtual_workspace_balance, preferred_currency, last_login_at)
       VALUES ($1, $2, $3, $4, TRUE, 10000.00, $5, NOW())
       RETURNING id, email, full_name, is_email_verified, virtual_workspace_balance, preferred_currency, local_currency, is_active, COALESCE(token_version, 1) AS token_version`,
      [bestEmail, randomPwd, bestFallbackName, userRoleId, info.currency || 'USD']
    );
    userRow = { ...inserted.rows[0], role_name: 'user' };

    if (!bestEmail.endsWith('@deriv-oauth.local')) {
      await sendBrevoEmail({
        userId: userRow.id,
        to: userRow.email,
        toName: userRow.full_name,
        templateType: 'welcome_verification',
        subject: 'Welcome to Pipflowtrade — Deriv Account Connected',
        htmlContent: `<p>Welcome to Pipflowtrade, ${userRow.full_name}. Your Deriv account (${info.loginid}) is connected and synchronized.</p>`
      });
    }
    await logSecurityEvent(userRow.id, 'DERIV_OAUTH_SIGNUP', 'info', { loginid: info.loginid, email: bestEmail }, ip);
  } else {
    if (!userRow.is_active) {
      throw new Error('Account suspended by administrator');
    }

    const canUpgradeName =
      bestHumanName.length > 0 ||
      !userRow.full_name ||
      userRow.full_name === 'Trader' ||
      isDerivLoginIdLike(userRow.full_name);

    const nextFullName = canUpgradeName ? bestFallbackName : userRow.full_name;
    const canUpgradeEmail =
      String(userRow.email || '').endsWith('@deriv-oauth.local') &&
      !bestEmail.endsWith('@deriv-oauth.local');

    const updatedUserRes = await pool.query(
      `UPDATE users
       SET last_login_at = NOW(),
           is_email_verified = TRUE,
           full_name = COALESCE(NULLIF($2, ''), full_name),
           email = CASE
             WHEN $4 = TRUE AND NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.email = $5 AND u2.id <> $1)
               THEN $5
             ELSE email
           END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, full_name, is_email_verified, virtual_workspace_balance, preferred_currency, local_currency, is_active, COALESCE(token_version, 1) AS token_version`,
      [
        userRow.id,
        nextFullName,
        null,
        canUpgradeEmail,
        bestEmail
      ]
    );

    if (updatedUserRes.rows[0]) {
      userRow = { ...updatedUserRes.rows[0], role_name: userRow.role_name };
    }
    await logSecurityEvent(
      userRow.id,
      'DERIV_OAUTH_LOGIN',
      'info',
      { loginid: info.loginid, email: userRow.email },
      ip
    );
  }

  const jwtToken = jwt.sign(
    { userId: userRow.id, email: userRow.email, role: userRow.role_name, tv: Number(userRow.token_version ?? 1) },
    env.jwtSecret,
    { expiresIn: '7d' }
  );

  return {
    isNew,
    token: jwtToken,
    user: {
      id: userRow.id,
      email: userRow.email,
      full_name: userRow.full_name,
      role: userRow.role_name,
      is_email_verified: Boolean(userRow.is_email_verified),
      virtual_workspace_balance: Number(userRow.virtual_workspace_balance),
      preferred_currency: userRow.preferred_currency,
      local_currency: userRow.local_currency
    }
  };
}

export function getPublicDerivOAuthUrl(req: Request, res: Response) {
  const mode = req.query.mode === 'signup' ? 'signup' : 'login';
  const primary = buildDerivOAuthUrl(req, { purpose: 'signup_login', mode });
  const signup =
    mode === 'signup' ? primary : buildDerivOAuthUrl(req, { purpose: 'signup_login', mode: 'signup' });

  res.json({
    url: primary.url,
    signupUrl: signup.url,
    appId: primary.appId
  });
}

export function getDerivOAuthUrl(req: Request, res: Response) {
  const built = buildDerivOAuthUrl(req, {
    userId: req.user!.userId,
    email: req.user!.email,
    purpose: 'link_account',
    mode: 'login'
  });

  res.json({
    url: built.url,
    appId: built.appId
  });
}

export async function handleDerivOAuthCallback(req: Request, res: Response) {
  const siteBase = resolvePublicSiteBase(req);

  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
  let statePurpose = '';
  if (state) {
    try {
      const parsedState = jwt.verify(state, env.jwtSecret) as { purpose?: string };
      statePurpose = parsedState.purpose || '';
    } catch {
      statePurpose = '';
    }
  }

  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
  const oauthErrorDesc =
    typeof req.query.error_description === 'string' ? req.query.error_description : '';
  if (oauthError) {
    const errMsg = encodeURIComponent(oauthErrorDesc || oauthError);
    if (statePurpose === 'admin_commission_token') {
      return res.redirect(`${siteBase}/#/_console?commission_error=${errMsg}`);
    }
    return res.redirect(`${siteBase}/#/?deriv_error=${errMsg}`);
  }

  // 1. Official Deriv OAuth 2.0 Authorization Code + PKCE callback (?code=ory_ac_...&state=...)
  if (code) {
    let decoded: {
      jti?: string;
      userId?: string;
      email?: string;
      purpose?: string;
      vEnc?: string;
    } = {};
    try {
      if (!state) {
        throw new Error('Missing OAuth2 state parameter. Please try signing in again.');
      }

      try {
        decoded = jwt.verify(state, env.jwtSecret) as typeof decoded;
      } catch {
        throw new Error('Invalid or expired Deriv OAuth2 session. Please try signing in again.');
      }

      if (decoded.jti && usedPkceJtis.has(decoded.jti)) {
        throw new Error('This Deriv login link has already been used. Please sign in again.');
      }
      if (decoded.jti) {
        markJtiUsed(decoded.jti);
      }

      if (!decoded.vEnc) {
        throw new Error('Missing PKCE verification state. Please try signing in again.');
      }

      const { codeVerifier, redirectUri } = decryptPkceData(decoded.vEnc);
      const tokenData = await exchangeOAuth2Code(code, codeVerifier, redirectUri);

      // Owner Partners / Commissions OAuth2 authorization (`application_read` scope)
      if (decoded.purpose === 'admin_commission_token' && decoded.userId) {
        const roleCheck = await pool.query(
          `SELECT r.name AS role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
          [decoded.userId]
        );
        if (roleCheck.rows[0]?.role_name !== 'owner') {
          throw new Error('Platform Owner privileges required to store partner commission token');
        }
        const prevRes = await pool.query(
          `SELECT setting_value FROM application_settings WHERE setting_key = 'deriv_commission_config'`
        );
        const prev = (prevRes.rows[0]?.setting_value || {}) as Record<string, unknown>;
        const enc = encryptToken(tokenData.accessToken);
        const encRefresh = tokenData.refreshToken ? encryptToken(tokenData.refreshToken) : null;
        const nextConfig = {
          ...prev,
          appId: (prev.appId as string) || env.derivAppId.trim(),
          encryptedToken: enc.encrypted,
          tokenIv: enc.iv,
          tokenAuthTag: enc.authTag,
          ...(encRefresh
            ? {
                encryptedRefreshToken: encRefresh.encrypted,
                refreshTokenIv: encRefresh.iv,
                refreshTokenAuthTag: encRefresh.authTag
              }
            : {}),
          tokenScopes: tokenData.grantedScopes,
          tokenExpiresAt:
            typeof tokenData.expiresIn === 'number' && tokenData.expiresIn > 0
              ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
              : null,
          tokenConnectedViaOAuth: true,
          tokenConnectedAt: new Date().toISOString()
        };
        await pool.query(
          `INSERT INTO application_settings (setting_key, setting_value, is_secret, updated_by)
           VALUES ('deriv_commission_config', $1::jsonb, TRUE, $2)
           ON CONFLICT (setting_key) DO UPDATE SET
             setting_value = EXCLUDED.setting_value,
             is_secret = TRUE,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
          [JSON.stringify(nextConfig), decoded.userId]
        );
        await pool.query(
          `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
           VALUES ($1, 'OWNER_OAUTH_COMMISSION_TOKEN', 'setting', 'deriv_commission_config', $2::jsonb, $3)`,
          [decoded.userId, JSON.stringify({ scopes: tokenData.grantedScopes }), req.ip]
        );
        return res.redirect(`${siteBase}/#/_console?commission_connected=1`);
      }

      const accounts = await fetchNewDerivAccounts(tokenData.accessToken, {
        isPat: false,
        grantedScopes: tokenData.grantedScopes
      });

      const primaryInfo = accounts.find((a) => !a.is_virtual) ?? accounts[0];

      if (decoded.userId) {
        const { primary } = await persistOAuth2Accounts(decoded.userId, tokenData.accessToken, accounts, {
          preserveExistingBalances: false
        });
        const bestName =
          accounts.map((c) => c.fullname?.trim()).find((n) => n && !isDerivLoginIdLike(n)) || '';
        if (bestName) {
          await pool.query(`UPDATE users SET full_name = $2, updated_at = NOW() WHERE id = $1`, [
            decoded.userId,
            bestName
          ]);
        }
        await createNotification(
          decoded.userId,
          'connection',
          'Deriv OAuth Accounts Synced',
          `Synced ${accounts.length} live Deriv account(s) (Primary: ${primary.loginid}).`
        );
        return res.redirect(
          `${siteBase}/#/?deriv_connected=${encodeURIComponent(primary.loginid)}&tab=dashboard`
        );
      }

      const session = await findOrCreateOAuthUser(primaryInfo, req.ip, accounts);
      const { saved } = await persistOAuth2Accounts(session.user.id, tokenData.accessToken, accounts, {
        preserveExistingBalances: false,
        markMissingDisconnected: true
      });
      const dbPrimary = saved[0] as
        | { deriv_login_id?: string; last_known_balance?: number; currency?: string }
        | undefined;
      const displayLogin = dbPrimary?.deriv_login_id || primaryInfo.loginid;
      const displayBal = Number(dbPrimary?.last_known_balance ?? primaryInfo.balance);
      const displayCurr = dbPrimary?.currency || primaryInfo.currency;
      await createNotification(
        session.user.id,
        'connection',
        session.isNew ? 'Signed In via Official Deriv OAuth2' : 'Signed In — Live Deriv Accounts Synced',
        `${accounts.length} Deriv account(s) synced. Primary ${displayLogin}: ${displayBal} ${displayCurr}.`
      );

      setAuthCookies(req, res, session.token);
      return res.redirect(`${siteBase}/#/?oauth_connected=1&tab=dashboard`);
    } catch (err) {
      const errMsg = encodeURIComponent((err as Error).message);
      if (decoded?.purpose === 'admin_commission_token' || statePurpose === 'admin_commission_token') {
        return res.redirect(`${siteBase}/#/_console?commission_error=${errMsg}`);
      }
      return res.redirect(`${siteBase}/#/?deriv_error=${errMsg}`);
    }
  }

  // 2. Legacy Deriv OAuth callback (?acct1=...&token1=...&state=...)
  const tokens = extractOAuthTokensFromQuery(req.query);
  if (tokens.length === 0) {
    return res.redirect(`${siteBase}/#/?deriv_error=missing_oauth_tokens`);
  }

  try {
    let decoded: { userId?: string; email?: string; purpose?: string } | null = null;
    if (state) {
      try {
        decoded = jwt.verify(state, env.jwtSecret) as { userId?: string; email?: string; purpose?: string };
      } catch {
        decoded = null;
      }
    }

    if (decoded?.purpose === 'admin_commission_token' && decoded.userId) {
      const roleCheck = await pool.query(
        `SELECT r.name AS role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
        [decoded.userId]
      );
      if (roleCheck.rows[0]?.role_name === 'owner') {
        const prevRes = await pool.query(
          `SELECT setting_value FROM application_settings WHERE setting_key = 'deriv_commission_config'`
        );
        const prev = (prevRes.rows[0]?.setting_value || {}) as Record<string, unknown>;
        const enc = encryptToken(tokens[0]);
        const nextConfig = {
          ...prev,
          appId: (prev.appId as string) || env.derivAppId.trim(),
          encryptedToken: enc.encrypted,
          tokenIv: enc.iv,
          tokenAuthTag: enc.authTag,
          tokenConnectedViaOAuth: true,
          tokenConnectedAt: new Date().toISOString()
        };
        await pool.query(
          `INSERT INTO application_settings (setting_key, setting_value, is_secret, updated_by)
           VALUES ('deriv_commission_config', $1::jsonb, TRUE, $2)
           ON CONFLICT (setting_key) DO UPDATE SET
             setting_value = EXCLUDED.setting_value,
             is_secret = TRUE,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
          [JSON.stringify(nextConfig), decoded.userId]
        );
        return res.redirect(`${siteBase}/#/_console?commission_connected=1`);
      }
    }

    if (decoded?.userId) {
      const { primary } = await persistAuthorizedAccounts(decoded.userId, tokens, {
        preserveExistingBalances: false
      });
      await createNotification(
        decoded.userId,
        'connection',
        'Deriv OAuth Accounts Synced',
        `Synced ${tokens.length} live Deriv account(s) (Primary: ${primary.loginid}).`
      );
      return res.redirect(`${siteBase}/#/?deriv_connected=${encodeURIComponent(primary.loginid)}&tab=dashboard`);
    }

    const firstInfo = await authorizeReadOnlyAccount(tokens[0]);
    const session = await findOrCreateOAuthUser(firstInfo, req.ip);
    const { saved } = await persistAuthorizedAccounts(session.user.id, tokens, {
      preserveExistingBalances: false,
      markMissingDisconnected: true
    });
    const dbPrimary = saved[0] as
      | { deriv_login_id?: string; last_known_balance?: number; currency?: string }
      | undefined;
    const displayLogin = dbPrimary?.deriv_login_id || firstInfo.loginid;
    const displayBal = Number(dbPrimary?.last_known_balance ?? firstInfo.balance);
    const displayCurr = dbPrimary?.currency || firstInfo.currency;
    await createNotification(
      session.user.id,
      'connection',
      session.isNew ? 'Signed In via Official Deriv OAuth2' : 'Signed In — Live Deriv Accounts Synced',
      `${tokens.length} Deriv account(s) synced. Primary ${displayLogin}: ${displayBal} ${displayCurr}.`
    );

    setAuthCookies(req, res, session.token);
    return res.redirect(`${siteBase}/#/?oauth_connected=1&tab=dashboard`);
  } catch (err) {
    return res.redirect(`${siteBase}/#/?deriv_error=${encodeURIComponent((err as Error).message)}`);
  }
}

export async function exchangeDerivOAuthTokens(req: Request, res: Response) {
  const { tokens } = req.body as { tokens?: string[] };
  const cleanTokens = Array.isArray(tokens)
    ? Array.from(new Set(tokens.map((t) => String(t).trim()).filter(Boolean)))
    : [];

  if (cleanTokens.length === 0) {
    return res.status(400).json({ error: 'No Deriv OAuth tokens provided' });
  }

  let existingUserId: string | null = tryExtractUserId(req);

  try {
    if (existingUserId) {
      const { primary, saved } = await persistAuthorizedAccounts(existingUserId, cleanTokens, {
        preserveExistingBalances: false
      });
      await createNotification(
        existingUserId,
        'connection',
        'Deriv OAuth Accounts Synced',
        `Synced ${saved.length} live Deriv account(s) (Primary: ${primary.loginid}).`
      );
      return res.json({ accounts: saved, primaryLoginId: primary.loginid });
    }

    const firstInfo = await authorizeReadOnlyAccount(cleanTokens[0]);
    const session = await findOrCreateOAuthUser(firstInfo, req.ip);
    const { primary, saved } = await persistAuthorizedAccounts(session.user.id, cleanTokens, {
      preserveExistingBalances: false,
      markMissingDisconnected: true
    });
    await createNotification(
      session.user.id,
      'connection',
      session.isNew ? 'Signed In via Official Deriv OAuth2' : 'Signed In — Live Deriv Accounts Synced',
      `Synced ${saved.length} Deriv account(s) (Primary: ${primary.loginid}).`
    );

    setAuthCookies(req, res, session.token);
    return res.json({ authenticated: true, user: session.user, accounts: saved });
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
}

export async function connectDerivToken(req: Request, res: Response) {
  const { apiToken, ownerConsent } = req.body as { apiToken?: string; ownerConsent?: boolean };
  if (!ownerConsent || !apiToken?.trim()) {
    return res.status(400).json({
      error: 'Explicit account owner authorization and a valid Deriv read-only API token are required.'
    });
  }

  try {
    const { primary, saved } = await persistAuthorizedAccounts(req.user!.userId, [apiToken.trim()]);
    const accountType = primary.is_virtual ? 'demo' : 'real';
    const hasTrade = primary.scopes.includes('trade');
    const scopeLabel = hasTrade ? 'Read & Trade' : 'Read-Only';

    await createNotification(
      req.user!.userId,
      'connection',
      'Deriv Account Connected',
      `${scopeLabel} connection established for ${primary.loginid} (${accountType.toUpperCase()} · ${primary.balance} ${primary.currency}).`
    );
    await logSecurityEvent(
      req.user!.userId,
      'DERIV_ACCOUNT_CONNECTED',
      'info',
      { loginid: primary.loginid, accountType, scopes: primary.scopes },
      req.ip
    );
    await sendBrevoEmail({
      userId: req.user!.userId,
      to: req.user!.email,
      templateType: 'connection_status',
      subject: `Pipflowtrades: Deriv Account Connected (${scopeLabel})`,
      htmlContent: `<p>Your Deriv account <b>${primary.loginid}</b> (${accountType.toUpperCase()}) was connected in ${scopeLabel} mode with balance ${primary.balance} ${primary.currency}.</p>`
    });

    res.json({ account: saved[0], accounts: saved, siblingAccounts: primary.account_list });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

export async function listConnectedAccounts(req: Request, res: Response) {
  const shouldSync = req.query.sync === '1' || req.query.sync === 'true';

  if (shouldSync) {
    const activeAuths = await pool.query(
      `SELECT ca.id, ca.deriv_login_id, aa.encrypted_token, aa.token_iv, aa.token_auth_tag
       FROM connected_accounts ca
       JOIN LATERAL (
         SELECT encrypted_token, token_iv, token_auth_tag
         FROM account_authorizations
         WHERE connected_account_id = ca.id AND user_id = ca.user_id AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 1
       ) aa ON TRUE
       WHERE ca.user_id = $1
         AND ca.connection_status = 'connected'`,
      [req.user!.userId]
    );

    const oauth2AccountsCache = new Map<string, Promise<ReadOnlyDerivAccount[]>>();

    await Promise.allSettled(
      activeAuths.rows.map(async (row) => {
        const rawToken = decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag);
        let matched: ReadOnlyDerivAccount;

        if (isOAuth2AccessToken(rawToken)) {
          let promise = oauth2AccountsCache.get(rawToken);
          if (!promise) {
            promise = fetchNewDerivAccounts(rawToken, { isPat: false });
            oauth2AccountsCache.set(rawToken, promise);
          }
          const list = await promise;
          matched = list.find((a) => a.loginid === row.deriv_login_id) ?? list[0];
        } else {
          matched = await authorizeReadOnlyAccount(rawToken);
        }

        await pool.query(
          `UPDATE connected_accounts
           SET last_known_balance = $1,
               currency = $2,
               last_synced_at = NOW(),
               updated_at = NOW()
           WHERE id = $3 AND user_id = $4`,
          [matched.balance, matched.currency, row.id, req.user!.userId]
        );
      })
    );
  }

  const accounts = await getUserAccountsList(req.user!.userId);
  res.json({ accounts });
}

export async function syncConnectedAccount(req: Request, res: Response) {
  const authRow = await pool.query(
    `SELECT ca.deriv_login_id, ca.account_type, ca.currency, ca.last_known_balance,
            COALESCE(ca.platform_adjustment_balance, 0) AS platform_adjustment_balance,
            COALESCE(ca.exact_broker_balance_only, TRUE) AS exact_broker_balance_only,
            ca.landing_company, ca.connection_status, ca.is_primary, ca.last_synced_at,
            aa.encrypted_token, aa.token_iv, aa.token_auth_tag
     FROM account_authorizations aa
     JOIN connected_accounts ca ON ca.id = aa.connected_account_id
     WHERE aa.connected_account_id = $1 AND aa.user_id = $2 AND aa.revoked_at IS NULL
     ORDER BY aa.created_at DESC LIMIT 1`,
    [req.params.id, req.user!.userId]
  );
  if (!authRow.rows[0]) {
    return res.status(404).json({ error: 'Active authorization not found for this account' });
  }
  try {
    const rawToken = decryptToken(
      authRow.rows[0].encrypted_token,
      authRow.rows[0].token_iv,
      authRow.rows[0].token_auth_tag
    );

    let info: ReadOnlyDerivAccount;
    if (isOAuth2AccessToken(rawToken)) {
      const list = await fetchNewDerivAccounts(rawToken, { isPat: false });
      info = list.find((a) => a.loginid === authRow.rows[0].deriv_login_id) ?? list[0];
    } else {
      info = await authorizeReadOnlyAccount(rawToken);
    }

    const updated = await pool.query(
      `UPDATE connected_accounts
       SET last_known_balance = $1, currency = $2, connection_status = 'connected', last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING id, deriv_login_id, account_type, currency, last_known_balance,
                 COALESCE(platform_adjustment_balance, 0) AS platform_adjustment_balance,
                 COALESCE(exact_broker_balance_only, TRUE) AS exact_broker_balance_only,
                 landing_company, connection_status, is_primary, last_synced_at`,
      [info.balance, info.currency, req.params.id, req.user!.userId]
    );
    const row = updated.rows[0];
    const displayedBalance =
      row.account_type === 'real' && Boolean(row.exact_broker_balance_only ?? true)
        ? Number(row.last_known_balance)
        : Number((Number(row.last_known_balance) + Number(row.platform_adjustment_balance ?? 0)).toFixed(4));
    res.json({ account: { ...row, displayed_balance: displayedBalance } });
  } catch (err) {
    await pool.query(
      `UPDATE connected_accounts SET connection_status = 'error', updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user!.userId]
    );
    res.status(400).json({ error: (err as Error).message });
  }
}

export async function disconnectAccount(req: Request, res: Response) {
  await pool.query(
    `UPDATE connected_accounts SET connection_status = 'disconnected', updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user!.userId]
  );
  await createNotification(req.user!.userId, 'connection', 'Deriv Account Disconnected', 'Account marked disconnected.');
  res.json({ disconnected: true });
}

export async function revokeAccountAuthorization(req: Request, res: Response) {
  await pool.query(
    `UPDATE connected_accounts SET connection_status = 'revoked', updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user!.userId]
  );
  await pool.query(
    `UPDATE account_authorizations SET revoked_at = NOW() WHERE connected_account_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [req.params.id, req.user!.userId]
  );
  await createNotification(req.user!.userId, 'security', 'Deriv Authorization Revoked', 'Read-only Deriv token revoked.');
  await logSecurityEvent(req.user!.userId, 'DERIV_AUTHORIZATION_REVOKED', 'info', { accountId: req.params.id }, req.ip);
  await sendBrevoEmail({
    userId: req.user!.userId,
    to: req.user!.email,
    templateType: 'connection_status',
    subject: 'Pipflowtrades: Deriv Authorization Revoked',
    htmlContent: `<p>You revoked Pipflowtrades read-only authorization for one of your Deriv accounts.</p>`
  });
  res.json({ revoked: true });
}

export async function getReadOnlyStatement(req: Request, res: Response) {
  const authRow = await pool.query(
    `SELECT ca.deriv_login_id, aa.encrypted_token, aa.token_iv, aa.token_auth_tag
     FROM account_authorizations aa
     JOIN connected_accounts ca ON ca.id = aa.connected_account_id
     WHERE aa.connected_account_id = $1 AND aa.user_id = $2 AND aa.revoked_at IS NULL
     ORDER BY aa.created_at DESC LIMIT 1`,
    [req.params.accountId, req.user!.userId]
  );
  if (!authRow.rows[0]) {
    return res.status(404).json({ error: 'Active authorization not found' });
  }
  const rawToken = decryptToken(
    authRow.rows[0].encrypted_token,
    authRow.rows[0].token_iv,
    authRow.rows[0].token_auth_tag
  );
  const transactions = await fetchReadOnlyStatement(rawToken, 30, authRow.rows[0].deriv_login_id);
  res.json({ transactions });
}

function tryExtractUserId(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME]?.trim();
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const rawToken = cookieToken || (bearerToken && bearerToken !== 'cookie-session' ? bearerToken : '');
  if (!rawToken) return null;
  try {
    const payload = jwt.verify(rawToken, env.jwtSecret) as { userId?: string };
    return payload.userId ?? null;
  } catch {
    return null;
  }
}

export async function getUserBalanceAdjustments(req: Request, res: Response) {
  const q = await pool.query(
    `SELECT ba.id, ba.account_scope, ba.broker_balance_at_sync, ba.currency, ba.sync_timestamp,
            ba.adjustment_delta, ba.previous_adjustment_total, ba.new_adjustment_total,
            ba.resulting_displayed_balance, ba.reason, ba.note, ba.created_at,
            ca.deriv_login_id
     FROM balance_adjustments ba
     LEFT JOIN connected_accounts ca ON ba.connected_account_id = ca.id
     WHERE ba.user_id = $1
     ORDER BY ba.created_at DESC
     LIMIT 100`,
    [req.user!.userId]
  );
  res.json({ adjustments: q.rows });
}

export async function getDerivProposal(req: Request, res: Response) {
  const body = (req.body || {}) as {
    symbol?: string;
    contractType?: string;
    stake?: number;
    currency?: string;
    duration?: number;
    durationUnit?: 't' | 's' | 'm' | 'h' | 'd';
    dateExpiry?: number;
    barrier?: string | number;
    multiplier?: number;
    growthRate?: number;
    allowEquals?: boolean;
    takeProfitUsd?: number | null;
    connectedAccountId?: string | null;
  };
  if (!body.symbol || !body.contractType) {
    return res.status(400).json({ error: 'symbol and contractType are required' });
  }
  const userId = tryExtractUserId(req);
  try {
    const quote = await requestDerivProposal({
      userId,
      connectedAccountId: body.connectedAccountId,
      symbol: body.symbol,
      contractType: body.contractType,
      stake: Number(body.stake ?? 1),
      currency: body.currency ?? 'USD',
      duration: body.duration !== undefined ? Number(body.duration) : undefined,
      durationUnit: body.durationUnit,
      dateExpiry: body.dateExpiry !== undefined ? Number(body.dateExpiry) : undefined,
      barrier: body.barrier,
      multiplier: body.multiplier !== undefined ? Number(body.multiplier) : undefined,
      growthRate: body.growthRate !== undefined ? Number(body.growthRate) : undefined,
      allowEquals: Boolean(body.allowEquals),
      takeProfitUsd: body.takeProfitUsd ?? null
    });
    res.json({ proposal: quote });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

export async function getContractsForSymbol(req: Request, res: Response) {
  const symbol = String(req.query.symbol ?? 'R_100').trim();
  const currency = String(req.query.currency ?? 'USD').trim();
  if (!/^[A-Za-z0-9_.-]{1,32}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  const userId = tryExtractUserId(req);
  try {
    const available = await fetchContractsForSymbol(symbol, currency, userId);
    res.json({ symbol, currency, available });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}

export async function getOpenContractSnapshot(req: Request, res: Response) {
  const contractId = Number(req.params.contractId);
  const connectedAccountId = String(req.query.connectedAccountId ?? '');
  if (!Number.isFinite(contractId) || contractId <= 0 || !connectedAccountId) {
    return res.status(400).json({ error: 'Valid contractId and connectedAccountId required' });
  }
  try {
    const snapshot = await fetchOpenContractSnapshot(req.user!.userId, connectedAccountId, contractId);
    res.json({ contract: snapshot });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}
