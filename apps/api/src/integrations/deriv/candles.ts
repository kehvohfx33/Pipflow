import { DerivClient } from './deriv-client';
import { DerivMessage } from './websocket';

export interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface CandlesResponse extends DerivMessage {
  candles?: Array<{ epoch: number; open: number; high: number; low: number; close: number }>;
  subscription?: { id: string };
}

interface TicksHistoryResponse extends DerivMessage {
  history?: { prices: Array<number | string>; times: number[] };
  pip_size?: number;
}

export async function fetchHistoricalCandles(
  client: DerivClient,
  symbol: string,
  granularity = 60,
  count = 300,
  subscribe = false
): Promise<{ candles: CandleBar[]; subscriptionId?: string }> {
  const res = await client.request<CandlesResponse>({
    ticks_history: symbol,
    adjust_start_time: 1,
    count,
    end: 'latest',
    granularity,
    style: 'candles',
    ...(subscribe ? { subscribe: 1 } : {})
  });

  const candles = (res.candles ?? []).map((c) => ({
    time: Number(c.epoch),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close)
  }));

  return { candles, subscriptionId: res.subscription?.id };
}

export async function fetchTickHistory(
  client: DerivClient,
  symbol: string,
  count = 1000
): Promise<{ prices: number[]; times: number[]; pipSize: number }> {
  const res = await client.request<TicksHistoryResponse>({
    ticks_history: symbol,
    adjust_start_time: 1,
    count,
    end: 'latest',
    style: 'ticks'
  });

  return {
    prices: (res.history?.prices ?? []).map(Number),
    times: (res.history?.times ?? []).map(Number),
    pipSize: Number(res.pip_size ?? 2)
  };
}
