import { Request, Response } from 'express';
import { getInstrumentsFromDbOrDeriv, ensureLiveTickSubscription } from '../services/market-data-service';
import { getCandles, getTickDigitAnalysis } from '../services/chart-data-service';
import { getExternalMarketFeed } from '../services/external-feed-service';
import { analyzeMarketSymbol, scanMarketSignals } from '../services/ai-analysis-service';

const ALLOWED_GRANULARITIES = new Set([60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400]);

function sanitizeSymbol(raw: unknown, fallback: string): string | null {
  const sym = String(raw ?? fallback).trim();
  return /^[A-Za-z0-9_.-]{1,32}$/.test(sym) ? sym : null;
}

export async function listInstruments(_req: Request, res: Response) {
  try {
    const instruments = await getInstrumentsFromDbOrDeriv();
    res.json({ instruments });
  } catch (err) {
    res.status(502).json({ error: `Market data error: ${(err as Error).message}` });
  }
}

export async function getSymbolCandles(req: Request, res: Response) {
  const symbol = sanitizeSymbol(req.query.symbol, 'R_25');
  if (!symbol) {
    return res.status(400).json({ error: 'Invalid market symbol' });
  }
  const parsedGranularity = Number(req.query.granularity ?? 60);
  if (!Number.isInteger(parsedGranularity) || !ALLOWED_GRANULARITIES.has(parsedGranularity)) {
    return res.status(400).json({ error: 'Invalid candle granularity' });
  }
  const parsedCount = Number(req.query.count ?? 300);
  const count = Number.isFinite(parsedCount) ? Math.min(1000, Math.max(20, Math.floor(parsedCount))) : 300;
  try {
    if (symbol.toUpperCase() === 'XAUUSD') {
      const ext = await getExternalMarketFeed('XAUUSD', parsedGranularity);
      return res.json({
        symbol: 'XAUUSD',
        granularity: parsedGranularity,
        candles: ext.candles,
        provider: ext.provider,
        status: ext.status,
        lastUpdated: ext.lastUpdated
      });
    }
    const candles = await getCandles(symbol, parsedGranularity, count);
    await ensureLiveTickSubscription(symbol).catch(() => {});
    res.json({ symbol, granularity: parsedGranularity, candles });
  } catch (err) {
    res.status(502).json({ error: `Candle data error: ${(err as Error).message}` });
  }
}

export async function getDigitAnalysis(req: Request, res: Response) {
  const symbol = sanitizeSymbol(req.query.symbol, 'R_100');
  if (!symbol) {
    return res.status(400).json({ error: 'Invalid market symbol' });
  }
  const parsedCount = Number(req.query.count ?? 1000);
  const count = Number.isFinite(parsedCount) ? Math.min(5000, Math.max(50, Math.floor(parsedCount))) : 1000;
  try {
    const analysis = await getTickDigitAnalysis(symbol, count);
    await ensureLiveTickSubscription(symbol).catch(() => {});
    res.json(analysis);
  } catch (err) {
    res.status(502).json({ error: `Tick history error: ${(err as Error).message}` });
  }
}

export async function getExternalFeed(req: Request, res: Response) {
  const symbol = sanitizeSymbol(req.query.symbol, 'XAUUSD');
  if (!symbol) {
    return res.status(400).json({ error: 'Invalid external symbol' });
  }
  const parsedGranularity = Number(req.query.granularity ?? 900);
  const granularity = ALLOWED_GRANULARITIES.has(parsedGranularity) ? parsedGranularity : 900;
  try {
    const feed = await getExternalMarketFeed(symbol, granularity);
    res.json(feed);
  } catch (err) {
    res.status(502).json({ error: `External feed error: ${(err as Error).message}` });
  }
}

export async function getAiMarketAnalysis(req: Request, res: Response) {
  const symbol = sanitizeSymbol(req.query.symbol, 'R_100');
  if (!symbol) {
    return res.status(400).json({ error: 'Invalid market symbol' });
  }
  const parsedGranularity = Number(req.query.granularity ?? 900);
  const granularity = ALLOWED_GRANULARITIES.has(parsedGranularity) ? parsedGranularity : 900;
  const includeAiSummary = String(req.query.ai ?? '1') !== '0';
  try {
    const report = await analyzeMarketSymbol(symbol, granularity, includeAiSummary);
    res.json(report);
  } catch (err) {
    res.status(502).json({ error: `Analysis error: ${(err as Error).message}` });
  }
}

export async function getMarketSignals(req: Request, res: Response) {
  const parsedGranularity = Number(req.query.granularity ?? 900);
  const granularity = ALLOWED_GRANULARITIES.has(parsedGranularity) ? parsedGranularity : 900;
  const rawSymbols = typeof req.query.symbols === 'string' && req.query.symbols.trim()
    ? req.query.symbols.split(',').map((s) => sanitizeSymbol(s, '')).filter((s): s is string => Boolean(s))
    : undefined;
  try {
    const signals = await scanMarketSignals(rawSymbols, granularity);
    res.json({
      generatedAt: new Date().toISOString(),
      granularity,
      signals
    });
  } catch (err) {
    res.status(502).json({ error: `Signals scan error: ${(err as Error).message}` });
  }
}
