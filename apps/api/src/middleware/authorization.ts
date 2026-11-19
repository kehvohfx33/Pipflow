import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { isDatabaseConfigured, pool } from '../database/pool';
import { ensureDatabaseSchema } from '../database/init';

export async function requireDb(_req: Request, res: Response, next: NextFunction) {
  if (!isDatabaseConfigured) {
    return res.status(503).json({
      error: 'Neon PostgreSQL DATABASE_URL is not configured. Configure DATABASE_URL to enable account and persistence features.'
    });
  }
  await ensureDatabaseSchema();
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator privileges required' });
  }
  if (!isDatabaseConfigured) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  // Verify role directly against database
  const q = await pool.query(
    `SELECT r.name as role_name, u.is_active FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
    [req.user.userId]
  );
  if (!q.rows[0] || !q.rows[0].is_active || q.rows[0].role_name !== 'admin') {
    return res.status(403).json({ error: 'Server-side administrator verification failed' });
  }
  next();
}

export function requireBotAnalyserGate(req: Request, res: Response, next: NextFunction) {
  const gateToken = req.headers['x-bot-gate-token'];
  if (typeof gateToken !== 'string') {
    return res.status(403).json({
      error: 'Market Analyser & Trading Bot password unlock required',
      code: 'BOT_GATE_LOCKED'
    });
  }
  try {
    const payload = jwt.verify(gateToken, env.botGateJwtSecret) as { userId: string; scope: string };
    if (payload.userId !== req.user?.userId || payload.scope !== 'bot_analyser') {
      return res.status(403).json({ error: 'Invalid unlock token', code: 'BOT_GATE_LOCKED' });
    }
    next();
  } catch {
    return res.status(403).json({ error: 'Bot & Analyser unlock expired', code: 'BOT_GATE_LOCKED' });
  }
}
