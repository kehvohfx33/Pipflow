import { Request, Response } from 'express';
import { getInstrumentsFromDbOrDeriv, ensureLiveTickSubscription } from '../services/market-data-service';
import { getCandles, getTickDigitAnalysis } from '../services/chart-data-service';

export async function listInstruments(_req: Request, res: Response) {
  try {
    const instruments = await getInstrumentsFromDbOrDeriv();
    res.json({ instruments });
  } catch (err) {
    res.status(502).json({ error: `Deriv Market Data error: ${(err as Error).message}` });
  }
}

export async function getSymbolCandles(req: Request, res: Response) {
  const symbol = String(req.query.symbol ?? 'R_25');
  const granularity = Number(req.query.granularity ?? 60);
  const count = Math.min(1000, Math.max(20, Number(req.query.count ?? 300)));
  try {
    const candles = await getCandles(symbol, granularity, count);
    await ensureLiveTickSubscription(symbol).catch(() => {});
    res.json({ symbol, granularity, candles });
  } catch (err) {
    res.status(502).json({ error: `Deriv Candle Data error: ${(err as Error).message}` });
  }
}

export async function getDigitAnalysis(req: Request, res: Response) {
  const symbol = String(req.query.symbol ?? 'R_100');
  const count = Math.min(5000, Math.max(50, Number(req.query.count ?? 1000)));
  try {
    const analysis = await getTickDigitAnalysis(symbol, count);
    await ensureLiveTickSubscription(symbol).catch(() => {});
    res.json(analysis);
  } catch (err) {
    res.status(502).json({ error: `Deriv Tick History error: ${(err as Error).message}` });
  }
}
