import { Pool } from 'pg';
import { env } from '../config/env';
import { createMemoryPool } from './memory-pool';

export const isDatabaseConfigured = Boolean(env.databaseUrl && !env.databaseUrl.includes('ep-example'));
export const isStorageReady = true;

let resolvedPool: Pool;
if (isDatabaseConfigured) {
  resolvedPool = new Pool({
    connectionString: env.databaseUrl,
    ssl:
      env.databaseUrl.includes('localhost') || env.databaseUrl.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  resolvedPool.on('error', (err) => {
    console.error('[PostgreSQL Pool Error]', err.message);
  });
} else {
  resolvedPool = createMemoryPool() as unknown as Pool;
}

export const pool = resolvedPool;

export async function checkDatabaseHealth(): Promise<{
  configured: boolean;
  connected: boolean;
  mode?: string;
  error?: string;
}> {
  if (!isDatabaseConfigured) {
    return { configured: false, connected: false, mode: 'in-memory' };
  }
  try {
    await pool.query('SELECT 1');
    return { configured: true, connected: true, mode: 'postgresql' };
  } catch (err) {
    return { configured: true, connected: false, mode: 'postgresql', error: (err as Error).message };
  }
}
