import { Request, Response } from 'express';
import { getInstrumentsFromDbOrDeriv, ensureLiveTickSubscription } from '../services/market-data-service';
import { getCandles, getTickDigitAnalysis } from '../services/chart-data-service';

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
