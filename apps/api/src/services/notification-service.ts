import { isDatabaseConfigured, pool } from '../database/pool';

export async function createNotification(
  userId: string | null,
  category: 'security' | 'connection' | 'system' | 'announcement' | 'trade_sim',
  title: string,
  message: string
) {
  if (!isDatabaseConfigured) return null;
  const res = await pool.query(
    `INSERT INTO notifications (user_id, category, title, message)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, category, title, message]
  );
  return res.rows[0];
}

export async function logSecurityEvent(
  userId: string | null,
  eventType: string,
  severity: 'info' | 'warning' | 'critical',
  details: Record<string, unknown>,
  ipAddress?: string
) {
  if (!isDatabaseConfigured) return;
  await pool.query(
    `INSERT INTO security_logs (user_id, event_type, severity, details, ip_address)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [userId, eventType, severity, JSON.stringify(details), ipAddress ?? null]
  );
}
