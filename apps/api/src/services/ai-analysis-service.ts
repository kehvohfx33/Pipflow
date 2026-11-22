import { GoogleGenAI } from '@google/genai';
import { getCandles } from './chart-data-service';
import { getExternalMarketFeed } from './external-feed-service';

export interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TechnicalAnalysisReport {
  symbol: string;
  assetClass: 'synthetics' | 'forex' | 'commodities' | 'crypto';
  dataSource: string;
  granularity: number;
  timestamp: string;
  status: 'ready' | 'insufficient_data' | 'unavailable';
  currentPrice: number | null;
  priceChangePct: number | null;
  indicators: {
    rsi14: number | null;
    macd: { macdLine: number; signalLine: number; histogram: number } | null;
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    atr14: number | null;
    volatilityPct: number | null;
  };
  structure: {
    trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
    regime: 'BREAKOUT' | 'PULLBACK' | 'TRENDING' | 'CONSOLIDATION';
    supportLevels: number[];
    resistanceLevels: number[];
  };
  tradeSetup: {
    direction: 'BUY' | 'SELL' | 'WAIT';
    confidence: number;
    entryZone: { low: number; high: number } | null;
    stopLoss: number | null;
    takeProfit: number | null;
    riskReward: string | null;
    invalidationCondition: string;
    rationale: string[];
    aiSummary?: string;
  };
}

function computeEmaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const out = new Array<number>(values.length).fill(NaN);
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function computeRsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= 14; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }
  let avgGain = gainSum / 14;
  let avgLoss = lossSum / 14;
  for (let i = 15; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * 13 + g) / 14;
    avgLoss = (avgLoss * 13 + l) / 14;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

function computeMacd(closes: number[]) {
  if (closes.length < 35) return null;
  const ema12 = computeEmaSeries(closes, 12);
  const ema26 = computeEmaSeries(closes, 26);
  const macdSeries: number[] = [];
  for (let i = 25; i < closes.length; i++) {
    if (Number.isFinite(ema12[i]) && Number.isFinite(ema26[i])) {
      macdSeries.push(ema12[i] - ema26[i]);
    }
  }
  if (macdSeries.length < 9) return null;
  const sigSeries = computeEmaSeries(macdSeries, 9);
  const lastMacd = macdSeries[macdSeries.length - 1];
  const lastSig = sigSeries[sigSeries.length - 1];
  if (!Number.isFinite(lastSig)) return null;
  return {
    macdLine: Number(lastMacd.toFixed(5)),
    signalLine: Number(lastSig.toFixed(5)),
    histogram: Number((lastMacd - lastSig).toFixed(5))
  };
}

function computeAtr14(candles: CandleBar[]): number | null {
  if (candles.length < 15) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose));
    trs.push(tr);
  }
  let atr = trs.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
  for (let i = 14; i < trs.length; i++) {
    atr = (atr * 13 + trs[i]) / 14;
  }
  return Number(atr.toFixed(5));
}

function detectSupportResistance(candles: CandleBar[]): { supportLevels: number[]; resistanceLevels: number[] } {
  const window = candles.slice(-90);
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < window.length - 2; i++) {
    const c = window[i];
    if (c.high > window[i - 1].high && c.high > window[i - 2].high && c.high >= window[i + 1].high && c.high >= window[i + 2].high) {
      highs.push(c.high);
    }
    if (c.low < window[i - 1].low && c.low < window[i - 2].low && c.low <= window[i + 1].low && c.low <= window[i + 2].low) {
      lows.push(c.low);
    }
  }
  const latestClose = window[window.length - 1]?.close ?? 0;
  const supports = lows
    .filter((l) => l < latestClose)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .map((n) => Number(n.toFixed(4)));
  const resistances = highs
    .filter((h) => h > latestClose)
    .sort((a, b) => a - b)
    .slice(0, 3)
    .map((n) => Number(n.toFixed(4)));

  if (supports.length === 0 && window.length > 0) {
    supports.push(Number(Math.min(...window.slice(-20).map((c) => c.low)).toFixed(4)));
  }
  if (resistances.length === 0 && window.length > 0) {
    resistances.push(Number(Math.max(...window.slice(-20).map((c) => c.high)).toFixed(4)));
  }
  return { supportLevels: supports, resistanceLevels: resistances };
}

function classifyAsset(symbol: string): 'synthetics' | 'forex' | 'commodities' | 'crypto' {
  const u = symbol.toUpperCase();
  if (u.includes('XAU') || u.includes('XAG') || u.startsWith('WLD')) return 'commodities';
  if (u.startsWith('FRX')) return 'forex';
  if (u.startsWith('CRY')) return 'crypto';
  return 'synthetics';
}

function formatPrice(val: number, assetClass: string, symbol: string): number {
  const u = symbol.toUpperCase();
  const digits = assetClass === 'commodities' || u === 'XAUUSD' ? 2 : u.includes('JPY') ? 3 : assetClass === 'forex' ? 5 : 4;
  return Number(val.toFixed(digits));
}

async function generateOptionalGeminiSummary(report: Omit<TechnicalAnalysisReport, 'tradeSetup'> & { tradeSetup: TechnicalAnalysisReport['tradeSetup'] }): Promise<string | undefined> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return undefined;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Summarize this live technical setup concisely in 2 sentences for an active trader (plain text, no disclaimers):
Symbol: ${report.symbol} (${report.dataSource})
Price: ${report.currentPrice}, Trend: ${report.structure.trend}, Regime: ${report.structure.regime}
RSI(14): ${report.indicators.rsi14}, MACD Hist: ${report.indicators.macd?.histogram}, EMA20: ${report.indicators.ema20}, EMA50: ${report.indicators.ema50}
Setup: ${report.tradeSetup.direction}, Entry Zone: ${report.tradeSetup.entryZone?.low}-${report.tradeSetup.entryZone?.high}, SL: ${report.tradeSetup.stopLoss}, TP: ${report.tradeSetup.takeProfit}, R:R ${report.tradeSetup.riskReward}.`;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });
    return response.text?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function analyzeMarketSymbol(
  rawSymbol: string,
  granularity = 900,
  includeAiSummary = false
): Promise<TechnicalAnalysisReport> {
  const symbol = rawSymbol.trim() || 'R_100';
  const assetClass = classifyAsset(symbol);
  let candles: CandleBar[] = [];
  let dataSource = 'Deriv Official WebSocket Candles';
  let currentPrice: number | null = null;
  let timestamp = new Date().toISOString();

  if (symbol.toUpperCase() === 'XAUUSD') {
    const ext = await getExternalMarketFeed('XAUUSD', granularity);
    dataSource = ext.provider;
    timestamp = ext.lastUpdated;
    candles = ext.candles;
    currentPrice = ext.quote;
  } else {
    try {
      candles = await getCandles(symbol, granularity, 240);
      if (candles.length > 0) {
        currentPrice = candles[candles.length - 1].close;
        timestamp = new Date(candles[candles.length - 1].time * 1000).toISOString();
      }
    } catch {
      candles = [];
    }
  }

  if (candles.length < 35 || currentPrice === null) {
    return {
      symbol,
      assetClass,
      dataSource,
      granularity,
      timestamp,
      status: candles.length === 0 ? 'unavailable' : 'insufficient_data',
      currentPrice,
      priceChangePct: null,
      indicators: {
        rsi14: null,
        macd: null,
        ema20: null,
        ema50: null,
        ema200: null,
        atr14: null,
        volatilityPct: null
      },
      structure: {
        trend: 'SIDEWAYS',
        regime: 'CONSOLIDATION',
        supportLevels: [],
        resistanceLevels: []
      },
      tradeSetup: {
        direction: 'WAIT',
        confidence: 0,
        entryZone: null,
        stopLoss: null,
        takeProfit: null,
        riskReward: null,
        invalidationCondition: `Insufficient candle history (${candles.length} bars) to issue a validated trade setup.`,
        rationale: [`Data source (${dataSource}) returned ${candles.length} bars; minimum 35 required.`]
      }
    };
  }

  const closes = candles.map((c) => c.close);
  const prevClose = closes[closes.length - 2] ?? currentPrice;
  const priceChangePct = prevClose > 0 ? Number((((currentPrice - prevClose) / prevClose) * 100).toFixed(3)) : 0;
  const ema20Arr = computeEmaSeries(closes, 20);
  const ema50Arr = computeEmaSeries(closes, 50);
  const ema200Arr = computeEmaSeries(closes, 200);
  const ema20 = Number.isFinite(ema20Arr[ema20Arr.length - 1]) ? formatPrice(ema20Arr[ema20Arr.length - 1], assetClass, symbol) : null;
  const ema50 = Number.isFinite(ema50Arr[ema50Arr.length - 1]) ? formatPrice(ema50Arr[ema50Arr.length - 1], assetClass, symbol) : null;
  const ema200 = Number.isFinite(ema200Arr[ema200Arr.length - 1]) ? formatPrice(ema200Arr[ema200Arr.length - 1], assetClass, symbol) : null;
  const rsi14 = computeRsi14(closes);
  const macd = computeMacd(closes);
  const atr14 = computeAtr14(candles);
  const volatilityPct = atr14 && currentPrice > 0 ? Number(((atr14 / currentPrice) * 100).toFixed(3)) : null;
  const { supportLevels, resistanceLevels } = detectSupportResistance(candles);

  // Scoring Engine
  let bullScore = 0;
  let bearScore = 0;
  const rationale: string[] = [];

  if (ema20 !== null && ema50 !== null) {
    if (currentPrice > ema20 && ema20 > ema50) {
      bullScore += 30;
      rationale.push(`Bullish EMA alignment: Price (${currentPrice}) > EMA20 (${ema20}) > EMA50 (${ema50})`);
    } else if (currentPrice < ema20 && ema20 < ema50) {
      bearScore += 30;
      rationale.push(`Bearish EMA alignment: Price (${currentPrice}) < EMA20 (${ema20}) < EMA50 (${ema50})`);
    } else {
      rationale.push(`Mixed moving average structure around EMA20 (${ema20}) and EMA50 (${ema50})`);
    }
  }
  if (ema200 !== null) {
    if (currentPrice > ema200) bullScore += 15;
    else bearScore += 15;
  }
  if (rsi14 !== null) {
    if (rsi14 > 54 && rsi14 < 72) {
      bullScore += 20;
      rationale.push(`RSI(14) at ${rsi14} shows sustained upward momentum without extreme exhaustion`);
    } else if (rsi14 < 46 && rsi14 > 28) {
      bearScore += 20;
      rationale.push(`RSI(14) at ${rsi14} confirms downward pressure with room before oversold`);
    } else if (rsi14 >= 74) {
      bearScore += 10;
      rationale.push(`RSI(14) overbought (${rsi14}); watch for pullback rejection`);
    } else if (rsi14 <= 26) {
      bullScore += 10;
      rationale.push(`RSI(14) oversold (${rsi14}); watch for bullish bounce`);
    }
  }
  if (macd) {
    if (macd.macdLine > macd.signalLine && macd.histogram > 0) {
      bullScore += 25;
      rationale.push(`MACD bullish crossover (+${macd.histogram} histogram)`);
    } else if (macd.macdLine < macd.signalLine && macd.histogram < 0) {
      bearScore += 25;
      rationale.push(`MACD bearish crossover (${macd.histogram} histogram)`);
    }
  }

  const last15 = candles.slice(-15);
  const recentHigh = Math.max(...last15.slice(0, -1).map((c) => c.high));
  const recentLow = Math.min(...last15.slice(0, -1).map((c) => c.low));
  let regime: 'BREAKOUT' | 'PULLBACK' | 'TRENDING' | 'CONSOLIDATION' = 'CONSOLIDATION';
  if (currentPrice > recentHigh || currentPrice < recentLow) {
    regime = 'BREAKOUT';
    if (currentPrice > recentHigh) bullScore += 15;
    else bearScore += 15;
    rationale.push(`Fresh ${currentPrice > recentHigh ? 'upside' : 'downside'} range breakout detected`);
  } else if (ema20 && Math.abs(currentPrice - ema20) <= (atr14 ?? currentPrice * 0.002)) {
    regime = 'PULLBACK';
    rationale.push(`Price pulling back into dynamic EMA20 (${ema20}) value zone`);
  } else if (Math.abs(bullScore - bearScore) >= 35) {
    regime = 'TRENDING';
  }

  const trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' =
    bullScore >= bearScore + 20 ? 'BULLISH' : bearScore >= bullScore + 20 ? 'BEARISH' : 'SIDEWAYS';

  let direction: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
  let confidence = Math.min(92, Math.max(35, 50 + Math.abs(bullScore - bearScore) * 0.5));
  if (bullScore >= bearScore + 22 && bullScore >= 50) direction = 'BUY';
  else if (bearScore >= bullScore + 22 && bearScore >= 50) direction = 'SELL';
  else confidence = Math.min(48, confidence);

  const unitAtr = atr14 && atr14 > 0 ? atr14 : currentPrice * 0.0025;
  let entryZone: { low: number; high: number } | null = null;
  let stopLoss: number | null = null;
  let takeProfit: number | null = null;
  let riskReward: string | null = null;
  let invalidationCondition = 'No clear directional edge; wait for breakout above resistance or below support.';

  if (direction === 'BUY') {
    const low = formatPrice(currentPrice - unitAtr * 0.35, assetClass, symbol);
    const high = formatPrice(currentPrice + unitAtr * 0.15, assetClass, symbol);
    const nearestSupport = supportLevels[0];
    const rawSl = nearestSupport && currentPrice - nearestSupport < unitAtr * 2.5 ? nearestSupport - unitAtr * 0.4 : currentPrice - unitAtr * 1.5;
    stopLoss = formatPrice(rawSl, assetClass, symbol);
    const risk = Math.max(currentPrice - stopLoss, unitAtr * 0.8);
    takeProfit = formatPrice(currentPrice + risk * 2.1, assetClass, symbol);
    entryZone = { low, high };
    riskReward = `1:${((takeProfit - currentPrice) / risk).toFixed(1)}`;
    invalidationCondition = `Invalidate bullish setup on candle close below ${stopLoss} (key support breach).`;
  } else if (direction === 'SELL') {
    const low = formatPrice(currentPrice - unitAtr * 0.15, assetClass, symbol);
    const high = formatPrice(currentPrice + unitAtr * 0.35, assetClass, symbol);
    const nearestRes = resistanceLevels[0];
    const rawSl = nearestRes && nearestRes - currentPrice < unitAtr * 2.5 ? nearestRes + unitAtr * 0.4 : currentPrice + unitAtr * 1.5;
    stopLoss = formatPrice(rawSl, assetClass, symbol);
    const risk = Math.max(stopLoss - currentPrice, unitAtr * 0.8);
    takeProfit = formatPrice(currentPrice - risk * 2.1, assetClass, symbol);
    entryZone = { low, high };
    riskReward = `1:${((currentPrice - takeProfit) / risk).toFixed(1)}`;
    invalidationCondition = `Invalidate bearish setup on candle close above ${stopLoss} (key resistance break).`;
  } else {
    entryZone = {
      low: formatPrice(supportLevels[0] ?? currentPrice - unitAtr, assetClass, symbol),
      high: formatPrice(resistanceLevels[0] ?? currentPrice + unitAtr, assetClass, symbol)
    };
  }

  const report: TechnicalAnalysisReport = {
    symbol,
    assetClass,
    dataSource,
    granularity,
    timestamp,
    status: 'ready',
    currentPrice: formatPrice(currentPrice, assetClass, symbol),
    priceChangePct,
    indicators: {
      rsi14,
      macd,
      ema20,
      ema50,
      ema200,
      atr14,
      volatilityPct
    },
    structure: {
      trend,
      regime,
      supportLevels,
      resistanceLevels
    },
    tradeSetup: {
      direction,
      confidence: Math.round(confidence),
      entryZone,
      stopLoss,
      takeProfit,
      riskReward,
      invalidationCondition,
      rationale
    }
  };

  if (includeAiSummary) {
    report.tradeSetup.aiSummary = await generateOptionalGeminiSummary(report);
  }

  return report;
}

export const DEFAULT_SIGNAL_UNIVERSE = [
  'XAUUSD',
  'R_100',
  'R_75',
  'R_50',
  'R_25',
  '1HZ100V',
  '1HZ90V',
  'BOOM1000',
  'CRASH1000',
  'frxEURUSD',
  'frxGBPUSD',
  'cryBTCUSD'
];

export async function scanMarketSignals(symbols = DEFAULT_SIGNAL_UNIVERSE, granularity = 900) {
  const results = await Promise.allSettled(
    symbols.slice(0, 14).map((sym) => analyzeMarketSymbol(sym, granularity, false))
  );
  return results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter((v): v is TechnicalAnalysisReport => Boolean(v))
    .sort((a, b) => {
      if (a.tradeSetup.direction !== 'WAIT' && b.tradeSetup.direction === 'WAIT') return -1;
      if (a.tradeSetup.direction === 'WAIT' && b.tradeSetup.direction !== 'WAIT') return 1;
      return b.tradeSetup.confidence - a.tradeSetup.confidence;
    });
}
