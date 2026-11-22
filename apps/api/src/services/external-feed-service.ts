export interface ExternalCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ExternalFeedResult {
  symbol: string;
  displayName: string;
  provider: string;
  status: 'live' | 'delayed' | 'unavailable';
  lastUpdated: string;
  quote: number | null;
  previousClose: number | null;
  changePct: number | null;
  candles: ExternalCandle[];
  error?: string;
}

const FEED_CACHE = new Map<string, { fetchedAt: number; payload: ExternalFeedResult }>();
const CACHE_TTL_MS = 15_000;

function mapGranularityToYahoo(granularity: number): { interval: string; range: string } {
  if (granularity <= 60) return { interval: '1m', range: '1d' };
  if (granularity <= 300) return { interval: '5m', range: '5d' };
  if (granularity <= 900) return { interval: '15m', range: '5d' };
  if (granularity <= 3600) return { interval: '1h', range: '1mo' };
  if (granularity <= 14400) return { interval: '1h', range: '3mo' };
  return { interval: '1d', range: '1y' };
}

async function fetchYahooGoldFeed(granularity: number): Promise<ExternalFeedResult | null> {
  const { interval, range } = mapGranularityToYahoo(granularity);
  const ticker = 'GC=F';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'PipFlowTrade-MarketFeed/1.0',
        Accept: 'application/json'
      }
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number; chartPreviousClose?: number; regularMarketTime?: number };
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
            }>;
          };
        }>;
      };
    };
    const r = json.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const q = r?.indicators?.quote?.[0];
    if (!r || !q || ts.length === 0) return null;

    const candles: ExternalCandle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      if (o != null && h != null && l != null && c != null && Number.isFinite(c)) {
        candles.push({
          time: ts[i],
          open: Number(o.toFixed(2)),
          high: Number(h.toFixed(2)),
          low: Number(l.toFixed(2)),
          close: Number(c.toFixed(2))
        });
      }
    }
    if (candles.length === 0) return null;

    const quote = Number(r.meta?.regularMarketPrice ?? candles[candles.length - 1].close);
    const prevClose = Number(r.meta?.chartPreviousClose ?? candles[0].open);
    const changePct = prevClose > 0 ? Number((((quote - prevClose) / prevClose) * 100).toFixed(2)) : 0;
    const marketEpoch = r.meta?.regularMarketTime ? r.meta.regularMarketTime * 1000 : Date.now();
    const ageMs = Math.abs(Date.now() - marketEpoch);

    return {
      symbol: 'XAUUSD',
      displayName: 'Gold / US Dollar (XAU/USD)',
      provider: 'Yahoo Finance Spot/COMEX Futures (GC=F)',
      status: ageMs > 900_000 ? 'delayed' : 'live',
      lastUpdated: new Date(marketEpoch).toISOString(),
      quote: Number(quote.toFixed(2)),
      previousClose: Number(prevClose.toFixed(2)),
      changePct,
      candles: candles.slice(-240)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGoldPriceSpotFallback(): Promise<ExternalFeedResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch('https://data-asg.goldprice.org/dbXRates/USD', {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      ts?: number;
      items?: Array<{ xauPrice?: number; pcXau?: number; chgXau?: number }>;
    };
    const item = json.items?.[0];
    if (!item?.xauPrice || !Number.isFinite(item.xauPrice)) return null;
    const price = Number(item.xauPrice.toFixed(2));
    const prev = item.chgXau !== undefined ? Number((price - item.chgXau).toFixed(2)) : price;
    return {
      symbol: 'XAUUSD',
      displayName: 'Gold / US Dollar (XAU/USD)',
      provider: 'GoldPrice Spot Feed (USD/oz)',
      status: 'live',
      lastUpdated: json.ts ? new Date(json.ts).toISOString() : new Date().toISOString(),
      quote: price,
      previousClose: prev,
      changePct: item.pcXau !== undefined ? Number(item.pcXau.toFixed(2)) : 0,
      candles: []
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getExternalMarketFeed(symbol = 'XAUUSD', granularity = 900): Promise<ExternalFeedResult> {
  const cleanSym = symbol.trim().toUpperCase() || 'XAUUSD';
  const cacheKey = `${cleanSym}:${granularity}`;
  const cached = FEED_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.payload;
  }

  if (cleanSym === 'XAUUSD') {
    const primary = await fetchYahooGoldFeed(granularity);
    if (primary) {
      FEED_CACHE.set(cacheKey, { fetchedAt: Date.now(), payload: primary });
      return primary;
    }
    const secondary = await fetchGoldPriceSpotFallback();
    if (secondary) {
      FEED_CACHE.set(cacheKey, { fetchedAt: Date.now(), payload: secondary });
      return secondary;
    }
  }

  return {
    symbol: cleanSym,
    displayName: cleanSym === 'XAUUSD' ? 'Gold / US Dollar (XAU/USD)' : cleanSym,
    provider: 'External Market Feed',
    status: 'unavailable',
    lastUpdated: new Date().toISOString(),
    quote: null,
    previousClose: null,
    changePct: null,
    candles: [],
    error: `Live external feed for ${cleanSym} is temporarily unreachable. No cached or fabricated quotes shown.`
  };
}
