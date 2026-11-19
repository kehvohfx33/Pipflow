import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { isDatabaseConfigured, pool } from '../database/pool';

export interface AuthUser {
  userId: string;
  email: string;
  role: 'trader' | 'admin';
  tv?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, env.jwtSecret) as AuthUser;

    if (isDatabaseConfigured) {
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
        role: dbUser.role_name,
        tv: Number(dbUser.token_version)
      };
    } else {
      req.user = payload;
    }

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
}
