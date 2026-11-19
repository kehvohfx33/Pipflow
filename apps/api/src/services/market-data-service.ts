import { isDatabaseConfigured, pool } from '../database/pool';
import { derivConnectionManager } from '../integrations/deriv/connection-manager';
import {
  fetchActiveSymbols,
  NormalizedSymbol,
  OFFICIAL_DERIV_SYMBOLS_CATALOG,
  subscribeTicks
} from '../integrations/deriv/market-data';

const subscribedSymbols = new Set<string>();
let cachedSymbols: NormalizedSymbol[] = [];
let lastSyncAt = 0;

function persistInstrumentsToDb(symbols: NormalizedSymbol[]) {
  if (!isDatabaseConfigured || symbols.length === 0) return;
  const symArr = symbols.map((s) => s.symbol);
  const nameArr = symbols.map((s) => s.display_name);
  const mktArr = symbols.map((s) => s.market);
  const subArr = symbols.map((s) => s.submarket ?? '');
  const pipArr = symbols.map((s) => s.pip_size);
  const suspArr = symbols.map((s) => s.is_trading_suspended);
  const openArr = symbols.map((s) => s.exchange_is_open);

  pool
    .query(
      `INSERT INTO market_instruments (symbol, display_name, market, submarket, pip_size, is_trading_suspended, exchange_is_open, updated_at)
       SELECT s, n, m, NULLIF(sub, ''), p, susp, open, NOW()
       FROM UNNEST($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[], $5::numeric[], $6::boolean[], $7::boolean[])
         AS t(s, n, m, sub, p, susp, open)
       ON CONFLICT (symbol) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         market = EXCLUDED.market,
         submarket = EXCLUDED.submarket,
         pip_size = EXCLUDED.pip_size,
         is_trading_suspended = EXCLUDED.is_trading_suspended,
         exchange_is_open = EXCLUDED.exchange_is_open,
         updated_at = NOW()`,
      [symArr, nameArr, mktArr, subArr, pipArr, suspArr, openArr]
    )
    .catch(() => {});
}

export async function syncMarketInstruments(): Promise<NormalizedSymbol[]> {
  try {
    const client = derivConnectionManager.getMarketClient();
    const symbols = await fetchActiveSymbols(client);
    if (symbols.length > 0) {
      cachedSymbols = symbols;
      lastSyncAt = Date.now();
      persistInstrumentsToDb(symbols);
      return symbols;
    }
  } catch {
    // Fall back to cached or official Deriv catalog if active_symbols cluster is unresponsive
  }

  if (cachedSymbols.length > 0) return cachedSymbols;
  cachedSymbols = OFFICIAL_DERIV_SYMBOLS_CATALOG;
  lastSyncAt = Date.now();
  persistInstrumentsToDb(OFFICIAL_DERIV_SYMBOLS_CATALOG);
  return OFFICIAL_DERIV_SYMBOLS_CATALOG;
}

export async function getInstrumentsFromDbOrDeriv() {
  if (cachedSymbols.length >= 40 && Date.now() - lastSyncAt < 300_000) {
    return cachedSymbols;
  }

  if (isDatabaseConfigured) {
    try {
      const existing = await pool.query(
        `SELECT * FROM market_instruments ORDER BY market ASC, display_name ASC`
      );
      if (existing.rows.length >= 40) {
        cachedSymbols = existing.rows as NormalizedSymbol[];
        lastSyncAt = Date.now();
        return existing.rows;
      }
    } catch {
      // Fall back to Deriv active_symbols fetch
    }
  }
  return syncMarketInstruments();
}

export async function ensureLiveTickSubscription(symbol: string) {
  const clean = symbol.trim();
  if (!clean) return;
  const client = derivConnectionManager.getMarketClient();
  if (!client.socket.isOpen()) {
    subscribedSymbols.clear();
  }
  if (subscribedSymbols.has(clean)) return;
  try {
    await subscribeTicks(client, clean);
    subscribedSymbols.add(clean);
  } catch (err) {
    const msg = (err as Error)?.message || '';
    if (msg.toLowerCase().includes('already subscribed')) {
      subscribedSymbols.add(clean);
    }
  }
}
