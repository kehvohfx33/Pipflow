import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../database/pool';
import { env, validateEnvironmentConfig } from '../config/env';
import { derivConnectionManager } from '../integrations/deriv/connection-manager';
import {
  authorizeReadOnlyAccount,
  fetchNewDerivAccounts,
  isOAuth2AccessToken,
  ReadOnlyDerivAccount
} from '../integrations/deriv/account-data';
import { encryptToken, decryptToken } from '../utils/crypto';
import { upsertSetting } from '../services/settings-service';
import { createNotification, logSecurityEvent } from '../services/notification-service';
import { sendBrevoEmail } from '../emails/brevo-service';
import { broadcastToAll, broadcastToUser } from '../services/realtime-hub';
import { fetchDerivAppMarkupReport } from '../integrations/deriv/commission';
import { closeDerivContract } from '../integrations/deriv/trade-execution';
import { setAuthCookies } from '../utils/cookies';
import { buildDerivOAuthUrl, refreshCommissionOAuth2Token, resolveOAuthRedirectUri, usesNewDerivOAuth2 } from './derivController';

const ROLE_ID_MAP: Record<string, number> = {
  trader: 1,
  admin: 2,
  owner: 3,
  user: 4
};

const DISPLAYED_BALANCE_SQL = `CASE
  WHEN ca.account_type = 'real' AND COALESCE(ca.exact_broker_balance_only, TRUE) = TRUE
    THEN ca.last_known_balance
  ELSE (ca.last_known_balance + COALESCE(ca.platform_adjustment_balance, 0))
END AS displayed_balance`;

export async function getAdminBootstrapStatus(_req: Request, res: Response) {
  const q = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'owner'`
  );
  const count = q.rows[0]?.cnt ?? 0;
  res.json({ initialized: count > 0 });
}

export async function bootstrapAdmin(req: Request, res: Response) {
  const { email, password, fullName } = req.body as {
    email?: string;
    password?: string;
    fullName?: string;
  };
  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail || !password || password.length < 8) {
    return res.status(400).json({ error: 'Valid platform owner email and password (min 8 chars) required' });
  }

  await pool.query(
    `INSERT INTO roles (id, name, description) VALUES (3, 'owner', 'Platform owner with exclusive settings and financial adjustment privileges') ON CONFLICT (name) DO NOTHING`
  );
  const roleRes = await pool.query(`SELECT id FROM roles WHERE name = 'owner' LIMIT 1`);
  const ownerRoleId = Number(roleRes.rows[0]?.id ?? 3);

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'owner'`
  );
  if ((countRes.rows[0]?.cnt ?? 0) > 0) {
    return res.status(409).json({
      error: 'Platform Owner is already configured in the database. Sign in with your owner credentials.'
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [cleanEmail]);
  let ownerUser;

  if (existing.rows[0]) {
    const updated = await pool.query(
      `UPDATE users
       SET password_hash = $1,
           full_name = COALESCE(NULLIF($2, ''), full_name, 'Platform Owner'),
           role_id = $3,
           is_email_verified = TRUE,
           is_active = TRUE,
           token_version = COALESCE(token_version, 1) + 1,
           last_login_at = NOW(),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, email, full_name, is_email_verified, virtual_workspace_balance, preferred_currency, local_currency, COALESCE(token_version, 1) AS token_version`,
      [passwordHash, fullName?.trim() || '', ownerRoleId, existing.rows[0].id]
    );
    ownerUser = updated.rows[0];
  } else {
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role_id, is_email_verified, is_active, last_login_at)
       VALUES ($1, $2, $3, $4, TRUE, TRUE, NOW())
       RETURNING id, email, full_name, is_email_verified, virtual_workspace_balance, preferred_currency, local_currency, COALESCE(token_version, 1) AS token_version`,
      [cleanEmail, passwordHash, fullName?.trim() || 'Platform Owner', ownerRoleId]
    );
    ownerUser = inserted.rows[0];
  }

  await upsertSetting('admin_credentials', { email: cleanEmail, passwordHash }, true, ownerUser.id);
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'OWNER_BOOTSTRAPPED', 'user', $1, $2::jsonb, $3)`,
    [ownerUser.id, JSON.stringify({ email: cleanEmail }), req.ip]
  );
  await logSecurityEvent(ownerUser.id, 'OWNER_BOOTSTRAPPED', 'info', { email: cleanEmail }, req.ip);

  const token = jwt.sign(
    { userId: ownerUser.id, email: ownerUser.email, role: 'owner', tv: Number(ownerUser.token_version ?? 1) },
    env.jwtSecret,
    { expiresIn: '7d' }
  );
  setAuthCookies(req, res, token);

  res.status(201).json({
    authenticated: true,
    user: {
      id: ownerUser.id,
      email: ownerUser.email,
      full_name: ownerUser.full_name,
      role: 'owner',
      is_email_verified: Boolean(ownerUser.is_email_verified),
      virtual_workspace_balance: Number(ownerUser.virtual_workspace_balance),
      preferred_currency: ownerUser.preferred_currency,
      local_currency: ownerUser.local_currency
    }
  });
}

export async function adminLogin(req: Request, res: Response) {
  const { email, password } = req.body as { email?: string; password?: string };
  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail || !password) {
    return res.status(400).json({ error: 'Console email and password required' });
  }

  const q = await pool.query(
    `SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.email = $1`,
    [cleanEmail]
  );
  const user = q.rows[0];

  if (!user || (user.role_name !== 'owner' && user.role_name !== 'admin')) {
    await logSecurityEvent(user?.id ?? null, 'ADMIN_LOGIN_DENIED', 'warning', { email: cleanEmail }, req.ip);
    return res.status(401).json({ error: 'Invalid console email or password' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'Console account is suspended' });
  }

  const matchesUserHash = await bcrypt.compare(password, user.password_hash);
  let matchesOwnerSetting = false;
  if (user.role_name === 'owner') {
    const settingRes = await pool.query(
      `SELECT setting_value FROM application_settings WHERE setting_key = 'admin_credentials'`
    );
    const storedCred = settingRes.rows[0]?.setting_value as { email?: string; passwordHash?: string } | undefined;
    if (storedCred?.email === cleanEmail && storedCred?.passwordHash) {
      matchesOwnerSetting = await bcrypt.compare(password, storedCred.passwordHash);
    }
  }

  if (!matchesUserHash && !matchesOwnerSetting) {
    await logSecurityEvent(user.id, 'ADMIN_LOGIN_FAILED', 'warning', { email: cleanEmail }, req.ip);
    return res.status(401).json({ error: 'Invalid console email or password' });
  }

  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
  await logSecurityEvent(user.id, 'CONSOLE_LOGIN_SUCCESS', 'info', { email: cleanEmail, role: user.role_name }, req.ip);

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role_name, tv: Number(user.token_version ?? 1) },
    env.jwtSecret,
    { expiresIn: '7d' }
  );
  setAuthCookies(req, res, token);

  res.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role_name,
      is_email_verified: user.is_email_verified,
      virtual_workspace_balance: Number(user.virtual_workspace_balance),
      preferred_currency: user.preferred_currency,
      local_currency: user.local_currency
    }
  });
}

export async function getAdminOverview(req: Request, res: Response) {
  const isOwner = req.user!.role === 'owner';

  const [
    adminAcc,
    users,
    accounts,
    auditLogs,
    securityLogs,
    emailLogs,
    settings,
    strategies,
    recentOrders,
    announcements,
    commissionSecret
  ] = await Promise.all([
    pool.query(`SELECT id, email, full_name, last_login_at FROM users WHERE id = $1`, [req.user!.userId]),
    pool.query(
      `SELECT u.id, u.email, u.full_name, u.virtual_workspace_balance, u.is_active, u.is_email_verified, u.last_login_at, u.created_at, r.name as role
       FROM users u JOIN roles r ON u.role_id = r.id ORDER BY u.created_at DESC LIMIT 200`
    ),
    pool.query(
      `SELECT ca.id, ca.user_id, u.email as user_email, ca.deriv_login_id, ca.account_type, ca.currency,
              ca.last_known_balance,
              COALESCE(ca.platform_adjustment_balance, 0) AS platform_adjustment_balance,
              COALESCE(ca.exact_broker_balance_only, TRUE) AS exact_broker_balance_only,
              ${DISPLAYED_BALANCE_SQL},
              ca.landing_company, ca.connection_status, ca.is_primary, ca.last_synced_at,
              COALESCE(aa.granted_scopes, ARRAY['read']) AS granted_scopes
       FROM connected_accounts ca
       JOIN users u ON ca.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT granted_scopes FROM account_authorizations
         WHERE connected_account_id = ca.id AND user_id = ca.user_id AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 1
       ) aa ON TRUE
       ORDER BY ca.updated_at DESC`
    ),
    pool.query(`SELECT * FROM administrator_audit_logs ORDER BY created_at DESC LIMIT 100`),
    pool.query(`SELECT * FROM security_logs ORDER BY created_at DESC LIMIT 100`),
    pool.query(`SELECT * FROM email_logs ORDER BY sent_at DESC LIMIT 80`),
    pool.query(`SELECT setting_key, setting_value FROM application_settings WHERE is_secret = FALSE`),
    pool.query(`SELECT * FROM bot_strategies ORDER BY created_at DESC`),
    pool.query(
      `SELECT o.*, u.email as user_email
       FROM virtual_orders o
       JOIN users u ON o.user_id = u.id
       ORDER BY o.opened_at DESC LIMIT 120`
    ),
    pool.query(
      `SELECT * FROM notifications WHERE category = 'announcement' ORDER BY created_at DESC LIMIT 40`
    ),
    isOwner
      ? pool.query(`SELECT setting_value FROM application_settings WHERE setting_key = 'deriv_commission_config'`)
      : Promise.resolve({ rows: [] })
  ]);

  const rawComm = (commissionSecret.rows[0]?.setting_value || {}) as {
    appId?: string;
    appName?: string;
    domain?: string;
    targetMarkupPct?: number;
    affiliateUrl?: string;
    sidcCode?: string;
    payoutAccount?: string;
    encryptedToken?: string;
  };

  const adminRow = adminAcc.rows[0];
  res.json({
    adminAccount: adminRow
      ? {
          id: adminRow.id,
          email: adminRow.email,
          full_name: adminRow.full_name,
          last_login_at: adminRow.last_login_at,
          role: req.user!.role
        }
      : null,
    users: users.rows,
    connectedAccounts: accounts.rows,
    derivDiagnostics: derivConnectionManager.getDiagnostics(),
    configStatus: isOwner ? validateEnvironmentConfig() : null,
    auditLogs: auditLogs.rows,
    securityLogs: securityLogs.rows,
    emailLogs: emailLogs.rows,
    settings: settings.rows,
    strategies: strategies.rows,
    recentOrders: recentOrders.rows,
    announcements: announcements.rows,
    commissionConfig: isOwner
      ? {
          appId: rawComm.appId || (env.derivAppId !== '1089' ? env.derivAppId : ''),
          appName:
            rawComm.appName && !rawComm.appName.toLowerCase().includes('tradederiv')
              ? rawComm.appName
              : 'Pipflowtrades',
          domain:
            rawComm.domain &&
            !rawComm.domain.toLowerCase().includes('.onrender.com') &&
            !rawComm.domain.toLowerCase().includes('tradederiv') &&
            rawComm.domain.trim() !== 'https://pipflow.site'
              ? rawComm.domain
              : 'https://pipflowtrade.site',
          targetMarkupPct: Number(rawComm.targetMarkupPct ?? 2.0),
          affiliateUrl: rawComm.affiliateUrl || '',
          sidcCode: rawComm.sidcCode || '',
          payoutAccount: rawComm.payoutAccount || '',
          hasAdminToken: Boolean(rawComm.encryptedToken || process.env.DERIV_ADMIN_TOKEN)
        }
      : null
  });
}

export async function updateAdminCredentials(req: Request, res: Response) {
  const { newEmail, newPassword } = req.body as { newEmail?: string; newPassword?: string };
  const cleanEmail = newEmail?.trim().toLowerCase();

  if (!cleanEmail && !newPassword) {
    return res.status(400).json({ error: 'Provide a new owner email and/or password to update' });
  }
  if (newPassword && newPassword.length < 8) {
    return res.status(400).json({ error: 'Owner password must be at least 8 characters' });
  }

  const currentRes = await pool.query(
    `SELECT id, email, password_hash, full_name, is_email_verified, virtual_workspace_balance, preferred_currency, local_currency
     FROM users WHERE id = $1`,
    [req.user!.userId]
  );
  const current = currentRes.rows[0];
  if (!current) return res.status(404).json({ error: 'Admin user not found' });

  const targetEmail = cleanEmail || current.email;
  const targetHash = newPassword ? await bcrypt.hash(newPassword, 12) : current.password_hash;

  try {
    const updated = await pool.query(
      `UPDATE users
       SET email = $1,
           password_hash = $2,
           token_version = COALESCE(token_version, 1) + 1,
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, email, full_name, is_email_verified, virtual_workspace_balance, preferred_currency, local_currency, COALESCE(token_version, 1) AS token_version`,
      [targetEmail, targetHash, req.user!.userId]
    );
    await upsertSetting('admin_credentials', { email: targetEmail, passwordHash: targetHash }, true, req.user!.userId);
    await pool.query(
      `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, 'UPDATE_ADMIN_CREDENTIALS', 'user', $1, $2::jsonb, $3)`,
      [req.user!.userId, JSON.stringify({ email: targetEmail, passwordChanged: Boolean(newPassword) }), req.ip]
    );
    await logSecurityEvent(req.user!.userId, 'ADMIN_CREDENTIALS_UPDATED', 'info', { email: targetEmail }, req.ip);

    const token = jwt.sign(
      { userId: updated.rows[0].id, email: updated.rows[0].email, role: req.user!.role, tv: Number(updated.rows[0].token_version ?? 1) },
      env.jwtSecret,
      { expiresIn: '7d' }
    );
    setAuthCookies(req, res, token);

    const updatedOwner = updated.rows[0];
    res.json({
      updated: true,
      user: {
        id: updatedOwner.id,
        email: updatedOwner.email,
        full_name: updatedOwner.full_name,
        role: req.user!.role,
        is_email_verified: Boolean(updatedOwner.is_email_verified),
        virtual_workspace_balance: Number(updatedOwner.virtual_workspace_balance),
        preferred_currency: updatedOwner.preferred_currency,
        local_currency: updatedOwner.local_currency
      }
    });
  } catch {
    res.status(409).json({ error: 'That email address is already used by another user' });
  }
}

export async function updateUserRole(req: Request, res: Response) {
  const targetId = String(req.params.id);
  const { role } = req.body as { role?: 'user' | 'trader' | 'admin' | 'owner' };
  if (!role || !(role in ROLE_ID_MAP)) {
    return res.status(400).json({ error: 'Role must be user, trader, admin, or owner' });
  }
  if (targetId === req.user!.userId && role !== 'owner') {
    return res.status(400).json({ error: 'Cannot remove your own Platform Owner role while signed in' });
  }
  const roleId = ROLE_ID_MAP[role];
  await pool.query(
    `UPDATE users SET role_id = $1, token_version = COALESCE(token_version, 1) + 1, updated_at = NOW() WHERE id = $2`,
    [roleId, targetId]
  );
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'UPDATE_USER_ROLE', 'user', $2, $3::jsonb, $4)`,
    [req.user!.userId, targetId, JSON.stringify({ role }), req.ip]
  );
  broadcastToUser(targetId, { type: 'account_updated', reason: 'role_changed' });
  res.json({ updated: true, role });
}

export async function revokeUserSessions(req: Request, res: Response) {
  const targetId = String(req.params.id);
  const targetRes = await pool.query(
    `SELECT u.id, u.email, r.name AS role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
    [targetId]
  );
  const target = targetRes.rows[0];
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (target.role_name === 'owner' && req.user!.role !== 'owner') {
    return res.status(403).json({ error: 'Only the Platform Owner may revoke an Owner session' });
  }
  await pool.query(
    `UPDATE users SET token_version = COALESCE(token_version, 1) + 1, updated_at = NOW() WHERE id = $1`,
    [targetId]
  );
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'REVOKE_USER_SESSIONS', 'user', $2, $3::jsonb, $4)`,
    [req.user!.userId, targetId, JSON.stringify({ targetEmail: target.email }), req.ip]
  );
  await logSecurityEvent(req.user!.userId, 'ADMIN_REVOKE_USER_SESSIONS', 'info', { targetId, targetEmail: target.email }, req.ip);
  broadcastToUser(targetId, { type: 'account_suspended', reason: 'session_revoked' });
  res.json({ revoked: true });
}

export async function adminSyncConnectedAccount(req: Request, res: Response) {
  const accountId = String(req.params.id);
  const authRow = await pool.query(
    `SELECT ca.user_id, ca.deriv_login_id, aa.encrypted_token, aa.token_iv, aa.token_auth_tag
     FROM account_authorizations aa
     JOIN connected_accounts ca ON ca.id = aa.connected_account_id
     WHERE aa.connected_account_id = $1 AND aa.revoked_at IS NULL
     ORDER BY aa.created_at DESC LIMIT 1`,
    [accountId]
  );
  if (!authRow.rows[0]) {
    return res.status(404).json({ error: 'Active authorization not found for this Deriv account' });
  }

  const ownerId = String(authRow.rows[0].user_id);
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

    const upd = await pool.query(
      `UPDATE connected_accounts
       SET last_known_balance = $1, currency = $2, connection_status = 'connected', last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $3
       RETURNING id, account_type, last_known_balance, COALESCE(platform_adjustment_balance, 0) AS platform_adjustment_balance,
                 COALESCE(exact_broker_balance_only, TRUE) AS exact_broker_balance_only`,
      [info.balance, info.currency, accountId]
    );
    const updatedRow = upd.rows[0];
    const displayedBalance =
      updatedRow && updatedRow.account_type === 'real' && Boolean(updatedRow.exact_broker_balance_only ?? true)
        ? Number(info.balance)
        : Number((Number(info.balance) + Number(updatedRow?.platform_adjustment_balance ?? 0)).toFixed(4));

    await pool.query(
      `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, 'ADMIN_SYNC_DERIV_ACCOUNT', 'connected_account', $2, $3::jsonb, $4)`,
      [req.user!.userId, accountId, JSON.stringify({ loginid: info.loginid, brokerBalance: info.balance, displayedBalance }), req.ip]
    );
    broadcastToUser(ownerId, { type: 'account_updated', reason: 'admin_synced', balance: displayedBalance, brokerBalance: info.balance });
    res.json({ synced: true, balance: info.balance, displayedBalance, currency: info.currency });
  } catch (err) {
    await pool.query(
      `UPDATE connected_accounts SET connection_status = 'error', updated_at = NOW() WHERE id = $1`,
      [accountId]
    );
    res.status(400).json({ error: (err as Error).message });
  }
}

export async function adminDisconnectConnectedAccount(req: Request, res: Response) {
  const accountId = String(req.params.id);
  const updated = await pool.query(
    `UPDATE connected_accounts SET connection_status = 'disconnected', updated_at = NOW()
     WHERE id = $1 RETURNING user_id, deriv_login_id`,
    [accountId]
  );
  if (!updated.rows[0]) {
    return res.status(404).json({ error: 'Connected account not found' });
  }
  const ownerId = String(updated.rows[0].user_id);
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'ADMIN_DISCONNECT_DERIV_ACCOUNT', 'connected_account', $2, $3::jsonb, $4)`,
    [req.user!.userId, accountId, JSON.stringify({ loginid: updated.rows[0].deriv_login_id }), req.ip]
  );
  broadcastToUser(ownerId, { type: 'account_updated', reason: 'admin_disconnected' });
  res.json({ disconnected: true });
}

export async function adminRevokeConnectedAccount(req: Request, res: Response) {
  const accountId = String(req.params.id);
  const updated = await pool.query(
    `UPDATE connected_accounts SET connection_status = 'revoked', updated_at = NOW()
     WHERE id = $1 RETURNING user_id, deriv_login_id`,
    [accountId]
  );
  if (!updated.rows[0]) {
    return res.status(404).json({ error: 'Connected account not found' });
  }
  const ownerId = String(updated.rows[0].user_id);
  await pool.query(
    `UPDATE account_authorizations SET revoked_at = NOW()
     WHERE connected_account_id = $1 AND revoked_at IS NULL`,
    [accountId]
  );
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'ADMIN_REVOKE_DERIV_ACCOUNT', 'connected_account', $2, $3::jsonb, $4)`,
    [req.user!.userId, accountId, JSON.stringify({ loginid: updated.rows[0].deriv_login_id }), req.ip]
  );
  broadcastToUser(ownerId, { type: 'account_updated', reason: 'admin_revoked' });
  res.json({ revoked: true });
}

export async function adminConnectDerivToken(req: Request, res: Response) {
  const { userId, apiToken } = req.body as { userId?: string; apiToken?: string };
  if (!apiToken?.trim()) {
    return res.status(400).json({ error: 'A valid Deriv API or OAuth token is required' });
  }
  const targetUserId = userId?.trim() || req.user!.userId;
  const cleanToken = apiToken.trim();

  const accounts: ReadOnlyDerivAccount[] = isOAuth2AccessToken(cleanToken)
    ? await fetchNewDerivAccounts(cleanToken, { isPat: false })
    : [await authorizeReadOnlyAccount(cleanToken)];

  const preferred = accounts.find((a) => !a.is_virtual) ?? accounts[0];
  await pool.query(`UPDATE connected_accounts SET is_primary = FALSE WHERE user_id = $1`, [targetUserId]);

  for (const info of accounts) {
    const accountType = info.is_virtual ? 'demo' : 'real';
    const isPrimary = info.loginid === preferred.loginid;
    const accRes = await pool.query(
      `INSERT INTO connected_accounts (user_id, deriv_login_id, account_type, currency, last_known_balance, landing_company, connection_status, is_primary, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'connected', $7, NOW())
       ON CONFLICT (user_id, deriv_login_id) DO UPDATE SET
         currency = EXCLUDED.currency,
         last_known_balance = EXCLUDED.last_known_balance,
         landing_company = EXCLUDED.landing_company,
         connection_status = 'connected',
         is_primary = EXCLUDED.is_primary,
         last_synced_at = NOW(),
         updated_at = NOW()
       RETURNING id`,
      [targetUserId, info.loginid, accountType, info.currency, info.balance, info.landing_company_name ?? null, isPrimary]
    );
    const enc = encryptToken(cleanToken);
    await pool.query(
      `INSERT INTO account_authorizations (connected_account_id, user_id, encrypted_token, token_iv, token_auth_tag, granted_scopes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [accRes.rows[0].id, targetUserId, enc.encrypted, enc.iv, enc.authTag, info.scopes]
    );
  }

  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'ADMIN_CONNECT_DERIV_ACCOUNT', 'user', $2, $3::jsonb, $4)`,
    [req.user!.userId, targetUserId, JSON.stringify({ primaryLoginId: preferred.loginid, count: accounts.length }), req.ip]
  );
  broadcastToUser(targetUserId, { type: 'account_updated', reason: 'admin_connected' });
  res.json({ connected: true, count: accounts.length, primaryLoginId: preferred.loginid });
}

export async function toggleUserStatus(req: Request, res: Response) {
  const targetId = String(req.params.id);
  const { isActive } = req.body as { isActive: boolean };
  const targetRes = await pool.query(
    `SELECT r.name AS role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
    [targetId]
  );
  if (targetRes.rows[0]?.role_name === 'owner' && req.user!.role !== 'owner') {
    return res.status(403).json({ error: 'Only the Platform Owner may modify an Owner account status' });
  }
  const nextActive = Boolean(isActive);
  await pool.query(
    `UPDATE users
     SET is_active = $1,
         token_version = CASE WHEN $1 = FALSE THEN COALESCE(token_version, 1) + 1 ELSE token_version END,
         updated_at = NOW()
     WHERE id = $2`,
    [nextActive, targetId]
  );
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'UPDATE_USER_STATUS', 'user', $2, $3::jsonb, $4)`,
    [req.user!.userId, targetId, JSON.stringify({ isActive: Boolean(isActive) }), req.ip]
  );
  broadcastToUser(targetId, { type: isActive ? 'account_updated' : 'account_suspended' });
  res.json({ updated: true });
}

export async function updateBotGatePassword(req: Request, res: Response) {
  const { newPassword } = req.body as { newPassword?: string };
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await upsertSetting('bot_analyser_password_hash', { hash }, true, req.user!.userId);
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, ip_address)
     VALUES ($1, 'UPDATE_BOT_GATE_PASSWORD', 'setting', 'bot_analyser_password_hash', $2)`,
    [req.user!.userId, req.ip]
  );
  res.json({ updated: true });
}

export async function updateBrandingSettings(req: Request, res: Response) {
  await upsertSetting('branding', req.body, false, req.user!.userId);
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'UPDATE_BRANDING', 'setting', 'branding', $2::jsonb, $3)`,
    [req.user!.userId, JSON.stringify(req.body), req.ip]
  );
  broadcastToAll({ type: 'settings_updated', branding: req.body });
  res.json({ updated: true });
}

export async function updateGlobalSettings(req: Request, res: Response) {
  await upsertSetting('global_settings', req.body, false, req.user!.userId);
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'UPDATE_GLOBAL_SETTINGS', 'setting', 'global_settings', $2::jsonb, $3)`,
    [req.user!.userId, JSON.stringify(req.body), req.ip]
  );
  broadcastToAll({ type: 'settings_updated', globalSettings: req.body });
  res.json({ updated: true });
}

export async function updateSiteControls(req: Request, res: Response) {
  await upsertSetting('site_controls', req.body, false, req.user!.userId);
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'UPDATE_SITE_CONTROLS', 'setting', 'site_controls', $2::jsonb, $3)`,
    [req.user!.userId, JSON.stringify(req.body), req.ip]
  );
  broadcastToAll({ type: 'settings_updated', siteControls: req.body });
  res.json({ updated: true });
}

export async function broadcastAnnouncement(req: Request, res: Response) {
  const { title, message, sendEmail } = req.body as {
    title?: string;
    message?: string;
    sendEmail?: boolean;
  };
  if (!title || !message) return res.status(400).json({ error: 'Title and message required' });

  await createNotification(null, 'announcement', title, message);
  if (sendEmail) {
    const users = await pool.query(`SELECT id, email, full_name FROM users WHERE is_active = TRUE`);
    for (const u of users.rows) {
      await sendBrevoEmail({
        userId: u.id,
        to: u.email,
        toName: u.full_name,
        templateType: 'admin_announcement',
        subject: `Pipflowtrade Announcement: ${title}`,
        htmlContent: `<h2>${title}</h2><p>${message}</p>`
      });
    }
  }
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, metadata, ip_address)
     VALUES ($1, 'BROADCAST_ANNOUNCEMENT', 'notification', $2::jsonb, $3)`,
    [req.user!.userId, JSON.stringify({ title, sendEmail: Boolean(sendEmail) }), req.ip]
  );
  broadcastToAll({ type: 'notification_created', title });
  res.json({ sent: true });
}

export async function deleteAnnouncement(req: Request, res: Response) {
  await pool.query(`DELETE FROM notifications WHERE id = $1`, [req.params.id]);
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, ip_address)
     VALUES ($1, 'DELETE_ANNOUNCEMENT', 'notification', $2, $3)`,
    [req.user!.userId, String(req.params.id), req.ip]
  );
  res.json({ deleted: true });
}

// ==========================================
// FULL CRUD: USERS, CONNECTED ACCOUNTS, STRATEGIES, ORDERS
// ==========================================

export async function createUser(req: Request, res: Response) {
  const { email, password, fullName, role = 'user', virtualBalance = 10000 } = req.body as {
    email?: string;
    password?: string;
    fullName?: string;
    role?: 'user' | 'trader' | 'admin' | 'owner';
    virtualBalance?: number;
  };
  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail || !password || password.length < 8) {
    return res.status(400).json({ error: 'Valid email and password (min 8 chars) are required' });
  }
  const requestedRole = role in ROLE_ID_MAP ? role : 'user';
  if ((requestedRole === 'admin' || requestedRole === 'owner') && req.user!.role !== 'owner') {
    return res.status(403).json({ error: 'Only the Platform Owner may provision admin or owner accounts' });
  }
  const roleId = ROLE_ID_MAP[requestedRole] ?? 4;
  const hash = await bcrypt.hash(password, 12);
  try {
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role_id, is_email_verified, virtual_workspace_balance)
       VALUES ($1, $2, $3, $4, TRUE, $5)
       RETURNING id, email, full_name, virtual_workspace_balance, is_active, is_email_verified, created_at`,
      [cleanEmail, hash, fullName?.trim() || cleanEmail.split('@')[0], roleId, Number(virtualBalance || 10000)]
    );
    await pool.query(
      `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, 'CREATE_USER', 'user', $2, $3::jsonb, $4)`,
      [req.user!.userId, inserted.rows[0].id, JSON.stringify({ email: cleanEmail, role: requestedRole }), req.ip]
    );
    const createdRow = inserted.rows[0];
    res.status(201).json({
      user: {
        id: createdRow.id,
        email: createdRow.email,
        full_name: createdRow.full_name,
        role: requestedRole,
        virtual_workspace_balance: Number(createdRow.virtual_workspace_balance),
        is_active: Boolean(createdRow.is_active),
        is_email_verified: Boolean(createdRow.is_email_verified),
        created_at: createdRow.created_at
      }
    });
  } catch {
    res.status(409).json({ error: 'A user with that email address already exists' });
  }
}

export async function updateUser(req: Request, res: Response) {
  const targetId = String(req.params.id);
  const { email, fullName, role, isActive, newPassword } = req.body as {
    email?: string;
    fullName?: string;
    role?: 'user' | 'trader' | 'admin' | 'owner';
    isActive?: boolean;
    newPassword?: string;
  };

  const existing = await pool.query(
    `SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
    [targetId]
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'User not found' });

  const cur = existing.rows[0];
  if (cur.role_name === 'owner' && req.user!.role !== 'owner') {
    return res.status(403).json({ error: 'Only the Platform Owner can modify an Owner account' });
  }
  if (role !== undefined && req.user!.role !== 'owner') {
    return res.status(403).json({ error: 'Only the Platform Owner can change account roles' });
  }
  if (targetId === req.user!.userId && role && role !== 'owner') {
    return res.status(400).json({ error: 'Cannot downgrade your own active Platform Owner account' });
  }

  const nextEmail = email ? email.trim().toLowerCase() : cur.email;
  const nextName = fullName !== undefined ? fullName.trim() : cur.full_name;
  const nextRoleName = role && role in ROLE_ID_MAP ? role : (cur.role_name as string);
  const nextRoleId = ROLE_ID_MAP[nextRoleName] ?? cur.role_id;
  const nextActive = isActive !== undefined ? Boolean(isActive) : cur.is_active;
  const passwordChanged = Boolean(newPassword && newPassword.length >= 8);
  const nextHash = passwordChanged ? await bcrypt.hash(newPassword!, 12) : cur.password_hash;
  const shouldRotateTokens = passwordChanged || nextRoleId !== cur.role_id || !nextActive;

  try {
    const updated = await pool.query(
      `UPDATE users
       SET email = $1,
           full_name = $2,
           role_id = $3,
           is_active = $4,
           password_hash = $5,
           token_version = CASE WHEN $6 = TRUE THEN COALESCE(token_version, 1) + 1 ELSE token_version END,
           updated_at = NOW()
       WHERE id = $7
       RETURNING id, email, full_name, virtual_workspace_balance, is_active, is_email_verified, last_login_at, created_at`,
      [nextEmail, nextName, nextRoleId, nextActive, nextHash, shouldRotateTokens, targetId]
    );
    await pool.query(
      `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, 'UPDATE_USER', 'user', $2, $3::jsonb, $4)`,
      [req.user!.userId, targetId, JSON.stringify({ email: nextEmail, role: nextRoleName, isActive: nextActive }), req.ip]
    );
    broadcastToUser(targetId, { type: 'account_updated', reason: 'admin_edited_profile' });
    const updatedRow = updated.rows[0];
    res.json({
      user: {
        id: updatedRow.id,
        email: updatedRow.email,
        full_name: updatedRow.full_name,
        role: nextRoleName,
        virtual_workspace_balance: Number(updatedRow.virtual_workspace_balance),
        is_active: Boolean(updatedRow.is_active),
        is_email_verified: Boolean(updatedRow.is_email_verified),
        last_login_at: updatedRow.last_login_at,
        created_at: updatedRow.created_at
      }
    });
  } catch {
    res.status(409).json({ error: 'Email address is already assigned to another account' });
  }
}

export async function deleteUser(req: Request, res: Response) {
  const targetId = String(req.params.id);
  if (targetId === req.user!.userId) {
    return res.status(400).json({ error: 'Cannot delete the currently signed-in administrator' });
  }
  const deleted = await pool.query(`DELETE FROM users WHERE id = $1 RETURNING email`, [targetId]);
  if (!deleted.rows[0]) return res.status(404).json({ error: 'User not found' });
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'DELETE_USER', 'user', $2, $3::jsonb, $4)`,
    [req.user!.userId, targetId, JSON.stringify({ email: deleted.rows[0].email }), req.ip]
  );
  res.json({ deleted: true });
}

export async function deleteConnectedAccount(req: Request, res: Response) {
  const accountId = String(req.params.id);
  const deleted = await pool.query(
    `DELETE FROM connected_accounts WHERE id = $1 RETURNING user_id, deriv_login_id`,
    [accountId]
  );
  if (!deleted.rows[0]) return res.status(404).json({ error: 'Connected account not found' });
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'DELETE_CONNECTED_ACCOUNT', 'connected_account', $2, $3::jsonb, $4)`,
    [req.user!.userId, accountId, JSON.stringify({ loginid: deleted.rows[0].deriv_login_id }), req.ip]
  );
  broadcastToUser(String(deleted.rows[0].user_id), { type: 'account_updated', reason: 'admin_deleted_account' });
  res.json({ deleted: true });
}

export async function createStrategy(req: Request, res: Response) {
  const { name, slug, category = 'Free Bots', symbol = 'R_100', strategyConfig = {}, isPremium = false } =
    req.body as {
      name?: string;
      slug?: string;
      category?: string;
      symbol?: string;
      strategyConfig?: Record<string, unknown>;
      isPremium?: boolean;
    };
  if (!name?.trim()) return res.status(400).json({ error: 'Strategy name is required' });

  const cleanSlug =
    (slug?.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) +
    `-${Math.floor(Math.random() * 900 + 100)}`;

  const inserted = await pool.query(
    `INSERT INTO bot_strategies (slug, name, category, symbol, strategy_config, is_premium)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
    [cleanSlug, name.trim(), category, symbol, JSON.stringify(strategyConfig), Boolean(isPremium)]
  );
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'CREATE_STRATEGY', 'bot_strategy', $2, $3::jsonb, $4)`,
    [req.user!.userId, inserted.rows[0].id, JSON.stringify({ name: name.trim(), symbol }), req.ip]
  );
  res.status(201).json({ strategy: inserted.rows[0] });
}

export async function updateStrategy(req: Request, res: Response) {
  const { name, category, symbol, strategyConfig, isPremium } = req.body as {
    name?: string;
    category?: string;
    symbol?: string;
    strategyConfig?: Record<string, unknown>;
    isPremium?: boolean;
  };
  const existing = await pool.query(`SELECT * FROM bot_strategies WHERE id = $1`, [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: 'Strategy not found' });

  const cur = existing.rows[0];
  const updated = await pool.query(
    `UPDATE bot_strategies
     SET name = $1, category = $2, symbol = $3, strategy_config = $4::jsonb, is_premium = $5
     WHERE id = $6 RETURNING *`,
    [
      name?.trim() || cur.name,
      category || cur.category,
      symbol || cur.symbol,
      JSON.stringify(strategyConfig ?? cur.strategy_config ?? {}),
      isPremium !== undefined ? Boolean(isPremium) : cur.is_premium,
      req.params.id
    ]
  );
  res.json({ strategy: updated.rows[0] });
}

export async function deleteStrategy(req: Request, res: Response) {
  const deleted = await pool.query(`DELETE FROM bot_strategies WHERE id = $1 RETURNING id, name`, [req.params.id]);
  if (!deleted.rows[0]) return res.status(404).json({ error: 'Strategy not found' });
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'DELETE_STRATEGY', 'bot_strategy', $2, $3::jsonb, $4)`,
    [req.user!.userId, String(req.params.id), JSON.stringify({ name: deleted.rows[0].name }), req.ip]
  );
  res.json({ deleted: true });
}

export async function closeAdminOrder(req: Request, res: Response) {
  const q = await pool.query(`SELECT * FROM virtual_orders WHERE id = $1 AND status = 'OPEN'`, [req.params.id]);
  const order = q.rows[0];
  if (!order) return res.status(404).json({ error: 'Open order not found' });

  let exitPrice = Number(order.entry_price);
  let pnl = Number(order.pnl ?? 0);
  let status: 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL' = 'CLOSED_MANUAL';

  if (order.deriv_contract_id && order.connected_account_id) {
    try {
      const closed = await closeDerivContract({
        userId: order.user_id,
        connectedAccountId: order.connected_account_id,
        contractId: Number(order.deriv_contract_id),
        fallbackExitPrice: exitPrice
      });
      exitPrice = closed.exitPrice;
      pnl = closed.pnl;
      status = closed.status;
    } catch {
      // Fallback to manual mark close
    }
  }

  const updated = await pool.query(
    `UPDATE virtual_orders SET status = $1, exit_price = $2, pnl = $3, closed_at = NOW() WHERE id = $4 RETURNING *`,
    [status, exitPrice, pnl, order.id]
  );
  broadcastToUser(String(order.user_id), { type: 'order_closed', orderId: order.id, pnl, status });
  res.json({ order: updated.rows[0] });
}

export async function deleteAdminOrder(req: Request, res: Response) {
  const deleted = await pool.query(`DELETE FROM virtual_orders WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!deleted.rows[0]) return res.status(404).json({ error: 'Order not found' });
  res.json({ deleted: true });
}

export async function closeAllAdminOrders(req: Request, res: Response) {
  const openRes = await pool.query(`SELECT * FROM virtual_orders WHERE status = 'OPEN' ORDER BY opened_at DESC`);
  let closedCount = 0;

  for (const order of openRes.rows) {
    let exitPrice = Number(order.entry_price);
    let pnl = Number(order.pnl ?? 0);
    let status: 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL' = 'CLOSED_MANUAL';

    if (order.deriv_contract_id && order.connected_account_id) {
      try {
        const closed = await closeDerivContract({
          userId: order.user_id,
          connectedAccountId: order.connected_account_id,
          contractId: Number(order.deriv_contract_id),
          fallbackExitPrice: exitPrice
        });
        exitPrice = closed.exitPrice;
        pnl = closed.pnl;
        status = closed.status;
      } catch {
        // Fallback if already closed remotely
      }
    }

    await pool.query(
      `UPDATE virtual_orders SET status = $1, exit_price = $2, pnl = $3, closed_at = NOW() WHERE id = $4`,
      [status, exitPrice, pnl, order.id]
    );
    broadcastToUser(String(order.user_id), { type: 'order_closed', orderId: order.id, pnl, status });
    closedCount += 1;
  }

  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, metadata, ip_address)
     VALUES ($1, 'ADMIN_CLOSE_ALL_ORDERS', 'order', $2::jsonb, $3)`,
    [req.user!.userId, JSON.stringify({ closedCount }), req.ip]
  );

  res.json({ closedCount });
}

// ==========================================
// DERIV APP MARKUP & AFFILIATE COMMISSIONS
// ==========================================

export async function getDerivCommissions(req: Request, res: Response) {
  const now = new Date();
  const defaultTo = now.toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const dateFrom = String(req.query.dateFrom || thirtyDaysAgo);
  const dateTo = String(req.query.dateTo || defaultTo);

  const [settingRes, volumeStats] = await Promise.all([
    pool.query(`SELECT setting_value FROM application_settings WHERE setting_key = 'deriv_commission_config'`),
    pool.query(`
      SELECT
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE execution_mode = 'deriv_real')::int AS real_orders,
        COUNT(*) FILTER (WHERE execution_mode = 'deriv_demo')::int AS demo_orders,
        COALESCE(SUM(stake) FILTER (WHERE execution_mode = 'deriv_real'), 0)::numeric(18,2) AS real_volume_usd,
        COALESCE(SUM(stake), 0)::numeric(18,2) AS total_volume_usd,
        COALESCE(SUM(pnl) FILTER (WHERE execution_mode = 'deriv_real'), 0)::numeric(18,2) AS real_client_pnl
      FROM virtual_orders
    `)
  ]);

  const cfg = (settingRes.rows[0]?.setting_value || {}) as {
    appId?: string;
    appName?: string;
    domain?: string;
    targetMarkupPct?: number;
    affiliateUrl?: string;
    sidcCode?: string;
    payoutAccount?: string;
    encryptedToken?: string;
    tokenIv?: string;
    tokenAuthTag?: string;
    encryptedRefreshToken?: string;
    refreshTokenIv?: string;
    refreshTokenAuthTag?: string;
    tokenScopes?: string[];
    tokenExpiresAt?: string | null;
    tokenConnectedViaOAuth?: boolean;
    tokenConnectedAt?: string;
  };

  let rawToken = process.env.DERIV_ADMIN_TOKEN || '';
  if (cfg.encryptedToken && cfg.tokenIv && cfg.tokenAuthTag) {
    try {
      rawToken = decryptToken(cfg.encryptedToken, cfg.tokenIv, cfg.tokenAuthTag);
    } catch {
      rawToken = '';
    }
  }

  let refreshToken = '';
  if (cfg.encryptedRefreshToken && cfg.refreshTokenIv && cfg.refreshTokenAuthTag) {
    try {
      refreshToken = decryptToken(cfg.encryptedRefreshToken, cfg.refreshTokenIv, cfg.refreshTokenAuthTag);
    } catch {
      refreshToken = '';
    }
  }

  const configuredAppId = (cfg.appId?.trim() || env.derivAppId.trim() || '').trim();
  const tokenExpMs = cfg.tokenExpiresAt ? Date.parse(cfg.tokenExpiresAt) : NaN;
  if (
    refreshToken &&
    (!rawToken || (Number.isFinite(tokenExpMs) && tokenExpMs - Date.now() < 60000))
  ) {
    try {
      const refreshed = await refreshCommissionOAuth2Token(refreshToken);
      rawToken = refreshed.accessToken;
      const enc = encryptToken(refreshed.accessToken);
      const encRefresh = refreshed.refreshToken ? encryptToken(refreshed.refreshToken) : null;
      const updatedCfg = {
        ...cfg,
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
        ...(refreshed.grantedScopes.length > 0 ? { tokenScopes: refreshed.grantedScopes } : {}),
        tokenExpiresAt:
          typeof refreshed.expiresIn === 'number' && refreshed.expiresIn > 0
            ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
            : cfg.tokenExpiresAt || null
      };
      await upsertSetting('deriv_commission_config', updatedCfg, true, req.user!.userId);
    } catch {
      // Keep existing token and let fetchDerivAppMarkupReport report the exact API status
    }
  }

  let report = await fetchDerivAppMarkupReport({
    token: rawToken,
    appId: configuredAppId,
    dateFrom,
    dateTo
  });

  if (report.restHttpStatus === 401 && refreshToken) {
    try {
      const refreshed = await refreshCommissionOAuth2Token(refreshToken);
      rawToken = refreshed.accessToken;
      const enc = encryptToken(refreshed.accessToken);
      const encRefresh = refreshed.refreshToken ? encryptToken(refreshed.refreshToken) : null;
      const updatedCfg = {
        ...cfg,
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
        ...(refreshed.grantedScopes.length > 0 ? { tokenScopes: refreshed.grantedScopes } : {}),
        tokenExpiresAt:
          typeof refreshed.expiresIn === 'number' && refreshed.expiresIn > 0
            ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
            : null
      };
      await upsertSetting('deriv_commission_config', updatedCfg, true, req.user!.userId);
      report = await fetchDerivAppMarkupReport({
        token: rawToken,
        appId: configuredAppId,
        dateFrom,
        dateTo
      });
    } catch {
      // Keep existing 401 report
    }
  }

  const statsRow = volumeStats.rows[0] || {};
  const targetPct = Number(cfg.targetMarkupPct ?? 2.0);
  const realVol = Number(statsRow.real_volume_usd ?? 0);
  const redirectUri = resolveOAuthRedirectUri(req);

  res.json({
    dateFrom,
    dateTo,
    config: {
      appId: configuredAppId && configuredAppId !== '1089' ? configuredAppId : '',
      appName:
        cfg.appName && !cfg.appName.toLowerCase().includes('tradederiv') ? cfg.appName : 'Pipflowtrades',
      domain:
        cfg.domain &&
        !cfg.domain.toLowerCase().includes('.onrender.com') &&
        !cfg.domain.toLowerCase().includes('tradederiv') &&
        cfg.domain.trim() !== 'https://pipflow.site'
          ? cfg.domain
          : 'https://pipflowtrade.site',
      targetMarkupPct: targetPct,
      affiliateUrl: cfg.affiliateUrl || '',
      sidcCode: cfg.sidcCode || '',
      payoutAccount: cfg.payoutAccount || '',
      hasAdminToken: Boolean(rawToken),
      tokenConnectedViaOAuth: Boolean(cfg.tokenConnectedViaOAuth),
      tokenConnectedAt: cfg.tokenConnectedAt || null
    },
    diagnostics: {
      redirectUri,
      configuredAppId: configuredAppId || '1089',
      isDefaultPublicAppId: !configuredAppId || configuredAppId === '1089',
      usesNewOAuth2: usesNewDerivOAuth2(),
      hasOwnerToken: Boolean(rawToken),
      tokenType: report.tokenType,
      tokenScopes: Array.isArray(cfg.tokenScopes) ? cfg.tokenScopes : [],
      restHttpStatus: report.restHttpStatus,
      requiredScope: 'application_read',
      restEndpoint: 'GET https://api.derivws.com/applications/v1/markup-statistics',
      payoutSchedule:
        'Deriv automatically settles App Markup payouts monthly (around the 15th) directly to your linked Deriv CR payout trading account configured in the Deriv Developer Portal.'
    },
    derivReport: report,
    platformVolume: {
      totalOrders: Number(statsRow.total_orders ?? 0),
      realOrders: Number(statsRow.real_orders ?? 0),
      demoOrders: Number(statsRow.demo_orders ?? 0),
      realVolumeUsd: realVol,
      totalVolumeUsd: Number(statsRow.total_volume_usd ?? 0),
      realClientPnl: Number(statsRow.real_client_pnl ?? 0)
    }
  });
}

export function getAdminCommissionOAuthUrl(req: Request, res: Response) {
  const built = buildDerivOAuthUrl(req, {
    userId: req.user!.userId,
    email: req.user!.email,
    purpose: 'admin_commission_token',
    mode: 'login',
    scopes: 'application_read trade account_manage'
  });

  res.json({
    url: built.url,
    appId: built.appId,
    redirectUri: built.redirectUri
  });
}

export async function updateDerivCommissionConfig(req: Request, res: Response) {
  const { appId, appName, domain, targetMarkupPct, affiliateUrl, sidcCode, payoutAccount, adminToken } =
    req.body as {
      appId?: string;
      appName?: string;
      domain?: string;
      targetMarkupPct?: number;
      affiliateUrl?: string;
      sidcCode?: string;
      payoutAccount?: string;
      adminToken?: string;
    };

  const prevRes = await pool.query(
    `SELECT setting_value FROM application_settings WHERE setting_key = 'deriv_commission_config'`
  );
  const prev = (prevRes.rows[0]?.setting_value || {}) as Record<string, unknown>;

  const nextValue: Record<string, unknown> = {
    ...prev,
    appId: appId !== undefined ? appId.trim() : prev.appId || '',
    appName: appName !== undefined ? appName.trim() : prev.appName || 'Pipflowtrades',
    domain: domain !== undefined ? domain.trim() : prev.domain || 'https://pipflowtrade.site',
    targetMarkupPct:
      targetMarkupPct !== undefined && !Number.isNaN(Number(targetMarkupPct))
        ? Math.min(3, Math.max(0, Number(targetMarkupPct)))
        : Number(prev.targetMarkupPct ?? 2.0),
    affiliateUrl: affiliateUrl !== undefined ? affiliateUrl.trim() : prev.affiliateUrl || '',
    sidcCode: sidcCode !== undefined ? sidcCode.trim() : prev.sidcCode || '',
    payoutAccount: payoutAccount !== undefined ? payoutAccount.trim() : prev.payoutAccount || ''
  };

  const cleanAdminToken = adminToken ? adminToken.trim().replace(/^Bearer\s+/i, '').trim() : '';
  if (cleanAdminToken) {
    const enc = encryptToken(cleanAdminToken);
    nextValue.encryptedToken = enc.encrypted;
    nextValue.tokenIv = enc.iv;
    nextValue.tokenAuthTag = enc.authTag;
    nextValue.tokenConnectedViaOAuth = false;
    nextValue.tokenScopes = [];
    nextValue.tokenExpiresAt = null;
    delete nextValue.encryptedRefreshToken;
    delete nextValue.refreshTokenIv;
    delete nextValue.refreshTokenAuthTag;
  }

  await upsertSetting('deriv_commission_config', nextValue, true, req.user!.userId);
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'UPDATE_DERIV_COMMISSION_CONFIG', 'setting', 'deriv_commission_config', $2::jsonb, $3)`,
    [
      req.user!.userId,
      JSON.stringify({
        appId: nextValue.appId,
        domain: nextValue.domain,
        targetMarkupPct: nextValue.targetMarkupPct,
        tokenUpdated: Boolean(adminToken?.trim())
      }),
      req.ip
    ]
  );

  res.json({
    saved: true,
    hasAdminToken: Boolean(nextValue.encryptedToken || process.env.DERIV_ADMIN_TOKEN)
  });
}
