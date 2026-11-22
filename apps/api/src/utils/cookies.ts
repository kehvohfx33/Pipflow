import crypto from 'crypto';
import { Request, Response } from 'express';
import { env } from '../config/env';

export const SESSION_COOKIE_NAME = 'pf_session';
export const CSRF_COOKIE_NAME = 'pf_csrf';
const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  }
  return out;
}

export function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const fwdProto = (req.get('x-forwarded-proto') || '').toLowerCase();
  if (fwdProto.includes('https')) return true;
  const origin = (req.get('origin') || '').toLowerCase();
  if (origin.startsWith('https://')) return true;
  const referer = (req.get('referer') || '').toLowerCase();
  if (referer.startsWith('https://')) return true;
  const host = (req.get('x-forwarded-host') || req.get('host') || '').toLowerCase();
  if (env.nodeEnv === 'production' && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    return true;
  }
  return false;
}

function serializeCookie(
  name: string,
  value: string,
  opts: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'None' | 'Lax';
    partitioned?: boolean;
    maxAge: number;
  }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`,
    `SameSite=${opts.sameSite}`
  ];
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.partitioned && opts.secure) parts.push('Partitioned');
  return parts.join('; ');
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function setAuthCookies(req: Request, res: Response, jwtToken: string): string {
  const secure = isHttpsRequest(req);
  const sameSite: 'None' | 'Lax' = secure ? 'None' : 'Lax';
  const csrfToken = generateCsrfToken();

  res.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE_NAME, jwtToken, {
      httpOnly: true,
      secure,
      sameSite,
      partitioned: secure,
      maxAge: SESSION_MAX_AGE_SEC
    })
  );
  res.append(
    'Set-Cookie',
    serializeCookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      secure,
      sameSite,
      partitioned: secure,
      maxAge: SESSION_MAX_AGE_SEC
    })
  );
  return csrfToken;
}

export function ensureCsrfCookie(req: Request, res: Response): string {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[CSRF_COOKIE_NAME];
  if (existing && /^[a-f0-9]{32,128}$/i.test(existing)) {
    return existing;
  }
  const secure = isHttpsRequest(req);
  const sameSite: 'None' | 'Lax' = secure ? 'None' : 'Lax';
  const csrfToken = generateCsrfToken();
  res.append(
    'Set-Cookie',
    serializeCookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      secure,
      sameSite,
      partitioned: secure,
      maxAge: SESSION_MAX_AGE_SEC
    })
  );
  return csrfToken;
}

export function clearAuthCookies(req: Request, res: Response): void {
  const secure = isHttpsRequest(req);
  const sameSite: 'None' | 'Lax' = secure ? 'None' : 'Lax';

  res.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure,
      sameSite,
      partitioned: secure,
      maxAge: 0
    })
  );
  res.append(
    'Set-Cookie',
    serializeCookie(CSRF_COOKIE_NAME, '', {
      httpOnly: false,
      secure,
      sameSite,
      partitioned: secure,
      maxAge: 0
    })
  );
}
