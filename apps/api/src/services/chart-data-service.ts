import { isDatabaseConfigured, pool } from '../database/pool';
import { derivConnectionManager } from '../integrations/deriv/connection-manager';
import { fetchHistoricalCandles, fetchTickHistory } from '../integrations/deriv/candles';

export async function getCandles(symbol: string, granularity: number, count = 300) {
  const client = derivConnectionManager.getMarketClient();
  const { candles } = await fetchHistoricalCandles(client, symbol, granularity, count, false);

  if (isDatabaseConfigured && candles.length > 0) {
    const recent = candles.slice(-60);
    const symbols = recent.map(() => symbol);
    const granularities = recent.map(() => granularity);
    const epochs = recent.map((c) => c.time);
    const opens = recent.map((c) => c.open);
    const highs = recent.map((c) => c.high);
    const lows = recent.map((c) => c.low);
    const closes = recent.map((c) => c.close);

    // Non-blocking batch cache write to Neon PostgreSQL
    pool
      .query(
        `INSERT INTO market_data_cache (symbol, granularity, epoch, open_price, high_price, low_price, close_price)
         SELECT * FROM UNNEST($1::varchar[], $2::int[], $3::bigint[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[])
         ON CONFLICT (symbol, granularity, epoch) DO UPDATE SET
           high_price = GREATEST(market_data_cache.high_price, EXCLUDED.high_price),
           low_price = LEAST(market_data_cache.low_price, EXCLUDED.low_price),
           close_price = EXCLUDED.close_price,
           cached_at = NOW()`,
        [symbols, granularities, epochs, opens, highs, lows, closes]
      )
      .catch(() => {});
  }

  return candles;
}

export async function getTickDigitAnalysis(symbol: string, count = 1000) {
  const client = derivConnectionManager.getMarketClient();
  const { prices, times, pipSize } = await fetchTickHistory(client, symbol, count);

  const digitCounts = Array(10).fill(0);
  const recentParity: Array<'E' | 'O'> = [];
  let even = 0;
  let odd = 0;

  for (let i = 0; i < prices.length; i++) {
    const formatted = prices[i].toFixed(pipSize);
    const lastDigit = Number(formatted.charAt(formatted.length - 1));
    if (!Number.isNaN(lastDigit)) {
      digitCounts[lastDigit]++;
      const isEven = lastDigit % 2 === 0;
      if (isEven) even++;
      else odd++;
      if (i >= prices.length - 12) {
        recentParity.push(isEven ? 'E' : 'O');
      }
    }
  }

  const total = prices.length || 1;
  const distribution = digitCounts.map((c, digit) => ({
    digit,
    count: c,
    percentage: Number(((c / total) * 100).toFixed(1))
  }));

  const latestPrice = prices[prices.length - 1] ?? 0;
  const latestFormatted = latestPrice.toFixed(pipSize);
  const latestDigit = Number(latestFormatted.charAt(latestFormatted.length - 1)) || 0;

  return {
    symbol,
    count: prices.length,
    latestPrice,
    latestEpoch: times[times.length - 1] ?? 0,
    latestDigit,
    pipSize,
    distribution,
    even: { count: even, percentage: Number(((even / total) * 100).toFixed(1)) },
    odd: { count: odd, percentage: Number(((odd / total) * 100).toFixed(1)) },
    recentParity
  };
}
