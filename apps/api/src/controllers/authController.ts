import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../database/pool';
import { env } from '../config/env';
import { sendBrevoEmail } from '../emails/brevo-service';
import { logSecurityEvent } from '../services/notification-service';
import { clearAuthCookies, ensureCsrfCookie, setAuthCookies } from '../utils/cookies';
import { getUserAccountsList, syncUserDerivAccountsFromStoredTokens } from './derivController';

export async function register(req: Request, res: Response) {
  const { email, password, fullName } = req.body as {
    email?: string;
    password?: string;
    fullName?: string;
  };
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Valid email and password (min 8 chars) required' });
  }

  const settingsRes = await pool.query(
    `SELECT setting_value FROM application_settings WHERE setting_key = 'global_settings'`
  );
  const globalCfg = (settingsRes.rows[0]?.setting_value || {}) as {
    allowRegistration?: boolean;
    defaultVirtualBalance?: number;
  };
  if (globalCfg.allowRegistration === false) {
    return res.status(403).json({ error: 'New registrations are currently disabled by the site administrator.' });
  }
  const initialBalance = Number(globalCfg.defaultVirtualBalance ?? 10000);

  await pool.query(
    `INSERT INTO roles (id, name, description) VALUES (4, 'user', 'Standard registered Pipflowtrade user') ON CONFLICT (name) DO NOTHING`
  );
  const roleRes = await pool.query(`SELECT id FROM roles WHERE name = 'user' LIMIT 1`);
  const userRoleId = Number(roleRes.rows[0]?.id ?? 4);

  const hash = await bcrypt.hash(password, 12);
  const verifyToken = crypto.randomBytes(24).toString('hex');

  try {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role_id, virtual_workspace_balance, email_verification_token)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, full_name, is_email_verified, virtual_workspace_balance, preferred_currency, local_currency, COALESCE(token_version, 1) AS token_version`,
      [email.trim().toLowerCase(), hash, fullName?.trim() || 'Trader', userRoleId, initialBalance, verifyToken]
    );
    const user = result.rows[0];

    await sendBrevoEmail({
      userId: user.id,
      to: user.email,
      toName: user.full_name,
      templateType: 'welcome_verification',
      subject: 'Welcome to Pipflowtrade — Verify Your Email',
      htmlContent: `<p>Welcome to Pipflowtrade, ${user.full_name}.</p><p>Verify your email address: <a href="${env.frontendUrl}/#/verify-email?token=${verifyToken}">Verify Account</a></p>`
    });

    await logSecurityEvent(user.id, 'USER_REGISTERED', 'info', { email: user.email, role: 'user' }, req.ip);

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: 'user', tv: Number(user.token_version ?? 1) },
      env.jwtSecret,
      { expiresIn: '7d' }
    );
    setAuthCookies(req, res, token);
    res.status(201).json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: 'user',
        is_email_verified: Boolean(user.is_email_verified),
        virtual_workspace_balance: Number(user.virtual_workspace_balance),
        preferred_currency: user.preferred_currency,
        local_currency: user.local_currency
      }
    });
  } catch {
    res.status(409).json({ error: 'Email already registered' });
  }
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const q = await pool.query(
    `SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.email = $1`,
    [email.trim().toLowerCase()]
  );
  let user = q.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    await logSecurityEvent(user?.id ?? null, 'LOGIN_FAILED', 'warning', { email }, req.ip);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'Account suspended by administrator' });
  }

  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

  let accounts: Array<Record<string, unknown>> = [];
  try {
    const syncResult = await Promise.race([
      syncUserDerivAccountsFromStoredTokens(user.id),
      new Promise<{ synced: false; accounts: Array<Record<string, unknown>> }>((resolve) =>
        setTimeout(() => resolve({ synced: false, accounts: [] }), 6500)
      )
    ]);
    accounts = syncResult.accounts;
    if (accounts.length === 0) {
      accounts = await getUserAccountsList(user.id);
    }
    const refreshed = await pool.query(
      `SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
      [user.id]
    );
    if (refreshed.rows[0]) {
      user = refreshed.rows[0];
    }
  } catch {
    accounts = await getUserAccountsList(user.id).catch(() => []);
  }

  await logSecurityEvent(user.id, 'LOGIN_SUCCESS', 'info', { role: user.role_name }, req.ip);

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
    },
    accounts
  });
}

export async function logout(req: Request, res: Response) {
  if (req.user?.userId) {
    await logSecurityEvent(req.user.userId, 'USER_LOGOUT', 'info', {}, req.ip).catch(() => {});
  }
  clearAuthCookies(req, res);
  res.json({ loggedOut: true });
}

export async function revokeAllSessions(req: Request, res: Response) {
  const updated = await pool.query(
    `UPDATE users
     SET token_version = COALESCE(token_version, 1) + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING id, email, COALESCE(token_version, 1) AS token_version`,
    [req.user!.userId]
  );
  if (!updated.rows[0]) {
    return res.status(404).json({ error: 'User not found' });
  }
  await logSecurityEvent(
    req.user!.userId,
    'ALL_SESSIONS_REVOKED',
    'info',
    { tokenVersion: Number(updated.rows[0].token_version) },
    req.ip
  );
  clearAuthCookies(req, res);
  res.json({ revoked: true });
}

export async function getMe(req: Request, res: Response) {
  const q = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.is_email_verified, u.virtual_workspace_balance, u.preferred_currency, u.local_currency, r.name as role
     FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
    [req.user!.userId]
  );
  if (!q.rows[0]) return res.status(404).json({ error: 'User not found' });
  ensureCsrfCookie(req, res);
  res.json({
    user: {
      ...q.rows[0],
      virtual_workspace_balance: Number(q.rows[0].virtual_workspace_balance)
    }
  });
}

export function checkConsoleEntry(req: Request, res: Response) {
  const submitted = String(req.query.slug ?? '').trim();
  const expected = env.adminPrivateSlug.trim();
  if (!submitted || !expected) {
    return res.status(404).json({ authorizedEntry: false });
  }
  const bufSub = Buffer.from(submitted, 'utf8');
  const bufExp = Buffer.from(expected, 'utf8');
  if (bufSub.length !== bufExp.length || !crypto.timingSafeEqual(bufSub, bufExp)) {
    return res.status(404).json({ authorizedEntry: false });
  }
  res.json({ authorizedEntry: true });
}

export async function verifyEmail(req: Request, res: Response) {
  const token = String(req.query.token ?? '');
  if (!token) return res.status(400).json({ error: 'Verification token required' });
  const updated = await pool.query(
    `UPDATE users SET is_email_verified = TRUE, email_verification_token = NULL WHERE email_verification_token = $1 RETURNING id, email`,
    [token]
  );
  if (updated.rowCount === 0) return res.status(400).json({ error: 'Invalid or expired verification token' });
  await logSecurityEvent(updated.rows[0].id, 'EMAIL_VERIFIED', 'info', {}, req.ip);
  res.json({ verified: true });
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: 'Email required' });

  const resetToken = crypto.randomBytes(24).toString('hex');
  const q = await pool.query(
    `UPDATE users SET password_reset_token = $1, password_reset_expires_at = NOW() + INTERVAL '1 hour'
     WHERE email = $2 RETURNING id, email, full_name`,
    [resetToken, email.trim().toLowerCase()]
  );

  if (q.rows[0]) {
    await sendBrevoEmail({
      userId: q.rows[0].id,
      to: q.rows[0].email,
      toName: q.rows[0].full_name,
      templateType: 'password_recovery',
      subject: 'Pipflowtrade Password Recovery',
      htmlContent: `<p>Reset your Pipflowtrade password:</p><p><a href="${env.frontendUrl}/#/reset-password?token=${resetToken}">Reset Password</a></p>`
    });
    await logSecurityEvent(q.rows[0].id, 'PASSWORD_RESET_REQUESTED', 'info', {}, req.ip);
  }
  res.json({ message: 'If the account exists, a password recovery email has been sent.' });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Valid reset token and password (min 8 chars) required' });
  }
  const hash = await bcrypt.hash(newPassword, 12);
  const q = await pool.query(
    `UPDATE users
     SET password_hash = $1,
         password_reset_token = NULL,
         password_reset_expires_at = NULL,
         token_version = COALESCE(token_version, 1) + 1,
         updated_at = NOW()
     WHERE password_reset_token = $2 AND password_reset_expires_at > NOW() RETURNING id, email`,
    [hash, token]
  );
  if (!q.rows[0]) return res.status(400).json({ error: 'Invalid or expired reset token' });

  await logSecurityEvent(q.rows[0].id, 'PASSWORD_RESET_COMPLETED', 'info', {}, req.ip);
  await sendBrevoEmail({
    userId: q.rows[0].id,
    to: q.rows[0].email,
    templateType: 'security_alert',
    subject: 'Pipflowtrade Security Alert: Password Changed',
    htmlContent: `<p>Your Pipflowtrade account password was recently changed. If this wasn't you, contact support immediately.</p>`
  });
  res.json({ reset: true });
}

export async function unlockBotAnalyserGate(req: Request, res: Response) {
  const { password } = req.body as { password?: string };
  if (!password) return res.status(400).json({ error: 'Password required' });

  const q = await pool.query(
    `SELECT setting_value FROM application_settings WHERE setting_key = 'bot_analyser_password_hash'`
  );
  const storedHash = q.rows[0]?.setting_value?.hash as string | undefined;
  if (!storedHash || !(await bcrypt.compare(password, storedHash))) {
    await logSecurityEvent(req.user!.userId, 'BOT_GATE_FAILED_ATTEMPT', 'warning', {}, req.ip);
    return res.status(403).json({ error: 'Incorrect Market Analyser / Trading Bot password' });
  }

  const gateToken = jwt.sign({ userId: req.user!.userId, scope: 'bot_analyser' }, env.botGateJwtSecret, {
    expiresIn: '4h'
  });
  res.json({ gateToken });
}
