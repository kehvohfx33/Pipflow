import { Pool } from 'pg';
import { env } from '../config/env';

export const isDatabaseConfigured = Boolean(env.databaseUrl && !env.databaseUrl.includes('ep-example'));

export const pool = new Pool({
  connectionString: env.databaseUrl || undefined,
  ssl:
    env.databaseUrl.includes('localhost') || env.databaseUrl.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error]', err.message);
});

export async function checkDatabaseHealth(): Promise<{ configured: boolean; connected: boolean; error?: string }> {
  if (!isDatabaseConfigured) {
    return { configured: false, connected: false };
  }
  try {
    await pool.query('SELECT 1');
    return { configured: true, connected: true };
  } catch (err) {
    return { configured: true, connected: false, error: (err as Error).message };
  }
}
