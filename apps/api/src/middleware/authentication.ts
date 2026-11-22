import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { isStorageReady, pool } from '../database/pool';
import { CSRF_COOKIE_NAME, parseCookies, SESSION_COOKIE_NAME } from '../utils/cookies';

export type PlatformRole = 'owner' | 'admin' | 'user' | 'trader';

export interface AuthUser {
  userId: string;
  email: string;
  role: PlatformRole;
  tv?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      authViaCookie?: boolean;
    }
  }
}

export function extractSessionToken(req: Request): { token: string | null; viaCookie: boolean } {
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken && cookieToken.trim()) {
    return { token: cookieToken.trim(), viaCookie: true };
  }
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const bearer = header.slice(7).trim();
    if (bearer && bearer !== 'cookie-session') {
      return { token: bearer, viaCookie: false };
    }
  }
  return { token: null, viaCookie: false };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { token, viaCookie } = extractSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthUser;

    if (isStorageReady) {
      const q = await pool.query(
        `SELECT u.email, u.is_active, COALESCE(u.token_version, 1) AS token_version, r.name as role_name
         FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
        [payload.userId]
      );
      const dbUser = q.rows[0];
      if (!dbUser) {
        return res.status(401).json({ error: 'Account no longer exists' });
      }
      if (!dbUser.is_active) {
        return res.status(403).json({ error: 'Account suspended by administrator' });
      }
      if (Number(payload.tv ?? 1) !== Number(dbUser.token_version)) {
        return res.status(401).json({ error: 'Session invalidated. Please sign in again.' });
      }
      req.user = {
        userId: payload.userId,
        email: dbUser.email,
        role: dbUser.role_name as PlatformRole,
        tv: Number(dbUser.token_version)
      };
    } else {
      req.user = payload;
    }
    req.authViaCookie = viaCookie;

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

const CSRF_EXEMPT_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/admin/login',
  '/admin/bootstrap',
  '/deriv/proposal',
  '/deriv/oauth/exchange'
]);

function constantTimeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const normalizedPath = req.path.replace(/\/+$/, '') || '/';
  if (CSRF_EXEMPT_PATHS.has(normalizedPath)) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  const hasSessionCookie = Boolean(cookies[SESSION_COOKIE_NAME]);
  if (!hasSessionCookie) {
    return next();
  }

  const csrfCookie = cookies[CSRF_COOKIE_NAME] || '';
  const csrfHeader = String(req.get('x-csrf-token') || '');
  if (!csrfCookie || !csrfHeader || !constantTimeMatch(csrfCookie, csrfHeader)) {
    return res.status(403).json({ error: 'CSRF token validation failed' });
  }

  const origin = req.get('origin');
  const reqHost = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
  if (origin && reqHost) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (originHost !== reqHost && !originHost.endsWith('.aistudio.dev')) {
        return res.status(403).json({ error: 'Cross-site request origin mismatch' });
      }
    } catch {
      return res.status(403).json({ error: 'Invalid request origin' });
    }
  }

  next();
}
