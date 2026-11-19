import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../database/pool';
import { env } from '../config/env';
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
import { buildDerivOAuthUrl, resolveOAuthRedirectUri, usesNewDerivOAuth2 } from './derivController';

export async function getAdminBootstrapStatus(_req: Request, res: Response) {
  const q = await pool.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE role_id = 2`);
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
    return res.status(400).json({ error: 'Valid administrator email and password (min 8 chars) required' });
  }

  const countRes = await pool.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE role_id = 2`);
  if ((countRes.rows[0]?.cnt ?? 0) > 0) {
    return res.status(409).json({
      error: 'Administrator is already configured in the database. Sign in with your database admin email and password.'
    });
  }

  const existing = await pool.query(`SELECT * FROM users WHERE email = $1`, [cleanEmail]);
  let adminUser = existing.rows[0];
  let passwordHash = '';

  if (adminUser) {
    const validExisting = await bcrypt.compare(password, adminUser.password_hash);
    if (!validExisting) {
      return res.status(401).json({
        error: 'An account with this email already exists. Enter its current password to promote it to administrator.'
      });
    }
    passwordHash = adminUser.password_hash;
    const updated = await pool.query(
      `UPDATE users SET role_id = 2, is_email_verified = TRUE, is_active = TRUE, last_login_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, full_name, is_email_verified, virtual_workspace_balance, preferred_currency, local_currency`,
      [adminUser.id]
    );
    adminUser = updated.rows[0];
  } else {
    passwordHash = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role_id, is_email_verified, last_login_at)
       VALUES ($1, $2, $3, 2, TRUE, NOW())
       RETURNING id, email, full_name, is_email_verified, virtual_workspace_balance, preferred_currency, local_currency`,
      [cleanEmail, passwordHash, fullName?.trim() || 'Platform Administrator']
    );
    adminUser = inserted.rows[0];
  }

  await upsertSetting('admin_credentials', { email: cleanEmail, passwordHash }, true, adminUser.id);
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'ADMIN_BOOTSTRAPPED', 'user', $1, $2::jsonb, $3)`,
    [adminUser.id, JSON.stringify({ email: cleanEmail }), req.ip]
  );
  await logSecurityEvent(adminUser.id, 'ADMIN_BOOTSTRAPPED', 'info', { email: cleanEmail }, req.ip);

  const token = jwt.sign(
    { userId: adminUser.id, email: adminUser.email, role: 'admin' },
    env.jwtSecret,
    { expiresIn: '7d' }
  );

  res.status(201).json({
    token,
    user: {
      ...adminUser,
      role: 'admin',
      virtual_workspace_balance: Number(adminUser.virtual_workspace_balance)
    }
  });
}

export async function adminLogin(req: Request, res: Response) {
  const { email, password } = req.body as { email?: string; password?: string };
  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail || !password) {
    return res.status(400).json({ error: 'Administrator email and password required' });
  }

  const q = await pool.query(
    `SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.email = $1`,
    [cleanEmail]
  );
  const user = q.rows[0];

  if (!user || user.role_name !== 'admin') {
    await logSecurityEvent(user?.id ?? null, 'ADMIN_LOGIN_DENIED', 'warning', { email: cleanEmail }, req.ip);
    return res.status(403).json({ error: 'Administrator account not found in database for this email' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'Administrator account is suspended' });
  }

  const settingRes = await pool.query(
    `SELECT setting_value FROM application_settings WHERE setting_key = 'admin_credentials'`
  );
  const storedCred = settingRes.rows[0]?.setting_value as { email?: string; passwordHash?: string } | undefined;

  const matchesUserHash = await bcrypt.compare(password, user.password_hash);
  const matchesAdminSetting =
    storedCred?.email === cleanEmail && storedCred?.passwordHash
      ? await bcrypt.compare(password, storedCred.passwordHash)
      : false;

  if (!matchesUserHash && !matchesAdminSetting) {
    await logSecurityEvent(user.id, 'ADMIN_LOGIN_FAILED', 'warning', { email: cleanEmail }, req.ip);
    return res.status(401).json({ error: 'Invalid administrator email or password' });
  }

  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
  await logSecurityEvent(user.id, 'ADMIN_LOGIN_SUCCESS', 'info', { email: cleanEmail }, req.ip);

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: 'admin' },
    env.jwtSecret,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: 'admin',
      is_email_verified: user.is_email_verified,
      virtual_workspace_balance: Number(user.virtual_workspace_balance),
      preferred_currency: user.preferred_currency,
      local_currency: user.local_currency
    }
  });
}

export async function getAdminOverview(req: Request, res: Response) {
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
              ca.last_known_balance, COALESCE(ca.balance_locked_by_admin, FALSE) AS balance_locked_by_admin,
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
    pool.query(`SELECT setting_value FROM application_settings WHERE setting_key = 'deriv_commission_config'`)
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

  res.json({
    adminAccount: adminAcc.rows[0] ?? null,
    users: users.rows,
    connectedAccounts: accounts.rows,
    derivDiagnostics: derivConnectionManager.getDiagnostics(),
    auditLogs: auditLogs.rows,
    securityLogs: securityLogs.rows,
    emailLogs: emailLogs.rows,
    settings: settings.rows,
    strategies: strategies.rows,
    recentOrders: recentOrders.rows,
    announcements: announcements.rows,
    commissionConfig: {
      appId: rawComm.appId || (env.derivAppId !== '1089' ? env.derivAppId : ''),
      appName: rawComm.appName || 'D74FX / Pipflowtrades',
      domain: rawComm.domain || 'https://pipflow.site',
      targetMarkupPct: Number(rawComm.targetMarkupPct ?? 2.0),
      affiliateUrl: rawComm.affiliateUrl || '',
      sidcCode: rawComm.sidcCode || '',
      payoutAccount: rawComm.payoutAccount || '',
      hasAdminToken: Boolean(rawComm.encryptedToken || process.env.DERIV_ADMIN_TOKEN)
    }
  });
}

export async function updateAdminCredentials(req: Request, res: Response) {
  const { newEmail, newPassword } = req.body as { newEmail?: string; newPassword?: string };
  const cleanEmail = newEmail?.trim().toLowerCase();

  if (!cleanEmail && !newPassword) {
    return res.status(400).json({ error: 'Provide a new admin email and/or password to update' });
  }
  if (newPassword && newPassword.length < 8) {
    return res.status(400).json({ error: 'Admin password must be at least 8 characters' });
  }

  const currentRes = await pool.query(
    `SELECT id, email, password_hash, full_name, is_email_verified, virtual_workspace_balance, preferred_currency, local_currency
     FROM users WHERE id = $1`,
    [req.user!.userId]
  );
  const current = currentRes.rows[0];
  if (!current) return res.status(404).json({ error: 'Admin user not found' });

  const targetEmail = cleanEmail || current.email;
  const targetHash = newPassword ? await bcrypt.hash(newPassword, 10) : current.password_hash;

  try {
    const updated = await pool.query(
      `UPDATE users SET email = $1, password_hash = $2, updated_at = NOW() WHERE id = $3
       RETURNING id, email, full_name, is_email_verified, virtual_workspace_balance, preferred_currency, local_currency`,
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
      { userId: updated.rows[0].id, email: updated.rows[0].email, role: 'admin' },
      env.jwtSecret,
      { expiresIn: '7d' }
    );

    res.json({
      updated: true,
      token,
      user: {
        ...updated.rows[0],
        role: 'admin',
        virtual_workspace_balance: Number(updated.rows[0].virtual_workspace_balance)
      }
    });
  } catch {
    res.status(409).json({ error: 'That email address is already used by another user' });
  }
}

export async function updateUserRole(req: Request, res: Response) {
  const targetId = String(req.params.id);
  const { role } = req.body as { role?: 'trader' | 'admin' };
  if (role !== 'trader' && role !== 'admin') {
    return res.status(400).json({ error: 'Role must be trader or admin' });
  }
  if (targetId === req.user!.userId && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot remove your own admin role while signed in' });
  }
  const roleId = role === 'admin' ? 2 : 1;
  await pool.query(`UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2`, [roleId, targetId]);
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'UPDATE_USER_ROLE', 'user', $2, $3::jsonb, $4)`,
    [req.user!.userId, targetId, JSON.stringify({ role }), req.ip]
  );
  broadcastToUser(targetId, { type: 'account_updated', reason: 'role_changed' });
  res.json({ updated: true });
}

export async function updateUserVirtualBalance(req: Request, res: Response) {
  const targetId = String(req.params.id);
  const { balance } = req.body as { balance?: number };
  if (balance === undefined || Number.isNaN(Number(balance))) {
    return res.status(400).json({ error: 'Valid numeric balance required' });
  }
  const numericBalance = Number(balance);
  await pool.query(`UPDATE users SET virtual_workspace_balance = $1, updated_at = NOW() WHERE id = $2`, [
    numericBalance,
    targetId
  ]);
  // Also reflect the adjustment on the user's primary connected account row in DB and lock it from Deriv overwrites
  await pool.query(
    `UPDATE connected_accounts
     SET last_known_balance = $1, balance_locked_by_admin = TRUE, updated_at = NOW()
     WHERE id = (
       SELECT id FROM connected_accounts
       WHERE user_id = $2
       ORDER BY CASE WHEN account_type = 'real' THEN 0 ELSE 1 END, is_primary DESC, updated_at DESC
       LIMIT 1
     )`,
    [numericBalance, targetId]
  );
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'EDIT_USER_BALANCE', 'user', $2, $3::jsonb, $4)`,
    [req.user!.userId, targetId, JSON.stringify({ newBalance: numericBalance }), req.ip]
  );
  broadcastToUser(targetId, { type: 'account_updated', reason: 'balance_updated', balance: numericBalance });
  res.json({ updated: true });
}

export async function updateConnectedAccountBalance(req: Request, res: Response) {
  const accountId = String(req.params.id);
  const { balance } = req.body as { balance?: number };
  if (balance === undefined || Number.isNaN(Number(balance))) {
    return res.status(400).json({ error: 'Valid numeric balance required' });
  }
  const numericBalance = Number(balance);
  const updated = await pool.query(
    `UPDATE connected_accounts
     SET last_known_balance = $1, balance_locked_by_admin = TRUE, updated_at = NOW()
     WHERE id = $2
     RETURNING user_id, deriv_login_id, account_type, is_primary`,
    [numericBalance, accountId]
  );
  if (!updated.rows[0]) {
    return res.status(404).json({ error: 'Connected account not found' });
  }
  const ownerId = String(updated.rows[0].user_id);
  if (updated.rows[0].is_primary || updated.rows[0].account_type === 'real') {
    await pool.query(
      `UPDATE users SET virtual_workspace_balance = $1, updated_at = NOW() WHERE id = $2`,
      [numericBalance, ownerId]
    );
  }
  await pool.query(
    `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, 'EDIT_CONNECTED_ACCOUNT_BALANCE', 'connected_account', $2, $3::jsonb, $4)`,
    [req.user!.userId, accountId, JSON.stringify({ newBalance: numericBalance, loginid: updated.rows[0].deriv_login_id }), req.ip]
  );
  broadcastToUser(ownerId, {
    type: 'account_updated',
    reason: 'connected_balance_updated',
    accountId,
    balance: numericBalance
  });
  res.json({ updated: true });
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

    await pool.query(
      `UPDATE connected_accounts
       SET last_known_balance = $1, balance_locked_by_admin = FALSE, currency = $2, connection_status = 'connected', last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [info.balance, info.currency, accountId]
    );

    await pool.query(
      `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, 'ADMIN_SYNC_DERIV_ACCOUNT', 'connected_account', $2, $3::jsonb, $4)`,
      [req.user!.userId, accountId, JSON.stringify({ loginid: info.loginid, balance: info.balance }), req.ip]
    );
    broadcastToUser(ownerId, { type: 'account_updated', reason: 'admin_synced', balance: info.balance });
    res.json({ synced: true, balance: info.balance, currency: info.currency });
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
  await pool.query(`UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2`, [
    Boolean(isActive),
    targetId
  ]);
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
        subject: `Pipflowtrades Announcement: ${title}`,
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
  const { email, password, fullName, role = 'trader', virtualBalance = 10000 } = req.body as {
    email?: string;
    password?: string;
    fullName?: string;
    role?: 'trader' | 'admin';
    virtualBalance?: number;
  };
  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail || !password || password.length < 6) {
    return res.status(400).json({ error: 'Valid email and password (min 6 chars) are required' });
  }
  const roleId = role === 'admin' ? 2 : 1;
  const hash = await bcrypt.hash(password, 10);
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
      [req.user!.userId, inserted.rows[0].id, JSON.stringify({ email: cleanEmail, role }), req.ip]
    );
    res.status(201).json({ user: { ...inserted.rows[0], role } });
  } catch {
    res.status(409).json({ error: 'A user with that email address already exists' });
  }
}

export async function updateUser(req: Request, res: Response) {
  const targetId = String(req.params.id);
  const { email, fullName, role, virtualBalance, isActive, newPassword } = req.body as {
    email?: string;
    fullName?: string;
    role?: 'trader' | 'admin';
    virtualBalance?: number;
    isActive?: boolean;
    newPassword?: string;
  };

  const existing = await pool.query(`SELECT * FROM users WHERE id = $1`, [targetId]);
  if (!existing.rows[0]) return res.status(404).json({ error: 'User not found' });

  const cur = existing.rows[0];
  if (targetId === req.user!.userId && role === 'trader') {
    return res.status(400).json({ error: 'Cannot downgrade your own active administrator account' });
  }

  const nextEmail = email ? email.trim().toLowerCase() : cur.email;
  const nextName = fullName !== undefined ? fullName.trim() : cur.full_name;
  const nextRoleId = role ? (role === 'admin' ? 2 : 1) : cur.role_id;
  const nextBalance =
    virtualBalance !== undefined && !Number.isNaN(Number(virtualBalance))
      ? Number(virtualBalance)
      : Number(cur.virtual_workspace_balance);
  const nextActive = isActive !== undefined ? Boolean(isActive) : cur.is_active;
  const nextHash = newPassword && newPassword.length >= 6 ? await bcrypt.hash(newPassword, 10) : cur.password_hash;

  try {
    const updated = await pool.query(
      `UPDATE users
       SET email = $1, full_name = $2, role_id = $3, virtual_workspace_balance = $4, is_active = $5, password_hash = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING id, email, full_name, virtual_workspace_balance, is_active, is_email_verified, last_login_at, created_at`,
      [nextEmail, nextName, nextRoleId, nextBalance, nextActive, nextHash, targetId]
    );
    if (virtualBalance !== undefined && !Number.isNaN(Number(virtualBalance))) {
      await pool.query(
        `UPDATE connected_accounts
         SET last_known_balance = $1, balance_locked_by_admin = TRUE, updated_at = NOW()
         WHERE id = (
           SELECT id FROM connected_accounts
           WHERE user_id = $2
           ORDER BY CASE WHEN account_type = 'real' THEN 0 ELSE 1 END, is_primary DESC, updated_at DESC
           LIMIT 1
         )`,
        [nextBalance, targetId]
      );
    }
    await pool.query(
      `INSERT INTO administrator_audit_logs (admin_user_id, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, 'UPDATE_USER', 'user', $2, $3::jsonb, $4)`,
      [req.user!.userId, targetId, JSON.stringify({ email: nextEmail, role: nextRoleId === 2 ? 'admin' : 'trader', isActive: nextActive, balance: nextBalance }), req.ip]
    );
    broadcastToUser(targetId, { type: 'account_updated', reason: 'admin_edited_profile', balance: nextBalance });
    res.json({ user: { ...updated.rows[0], role: nextRoleId === 2 ? 'admin' : 'trader' } });
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

  const configuredAppId = (cfg.appId?.trim() || env.derivAppId.trim() || '').trim();
  const report = await fetchDerivAppMarkupReport({
    token: rawToken,
    appId: configuredAppId,
    dateFrom,
    dateTo
  });

  const statsRow = volumeStats.rows[0] || {};
  const targetPct = Number(cfg.targetMarkupPct ?? 2.0);
  const realVol = Number(statsRow.real_volume_usd ?? 0);
  const redirectUri = resolveOAuthRedirectUri(req);

  res.json({
    dateFrom,
    dateTo,
    config: {
      appId: configuredAppId && configuredAppId !== '1089' ? configuredAppId : '',
      appName: cfg.appName || 'TradeDeriv',
      domain: cfg.domain || 'https://tradederiv-eiiy.onrender.com',
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
    appName: appName !== undefined ? appName.trim() : prev.appName || 'D74FX / Pipflowtrades',
    domain: domain !== undefined ? domain.trim() : prev.domain || 'https://pipflow.site',
    targetMarkupPct:
      targetMarkupPct !== undefined && !Number.isNaN(Number(targetMarkupPct))
        ? Math.min(3, Math.max(0, Number(targetMarkupPct)))
        : Number(prev.targetMarkupPct ?? 2.0),
    affiliateUrl: affiliateUrl !== undefined ? affiliateUrl.trim() : prev.affiliateUrl || '',
    sidcCode: sidcCode !== undefined ? sidcCode.trim() : prev.sidcCode || '',
    payoutAccount: payoutAccount !== undefined ? payoutAccount.trim() : prev.payoutAccount || ''
  };

  if (adminToken && adminToken.trim()) {
    const enc = encryptToken(adminToken.trim());
    nextValue.encryptedToken = enc.encrypted;
    nextValue.tokenIv = enc.iv;
    nextValue.tokenAuthTag = enc.authTag;
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
