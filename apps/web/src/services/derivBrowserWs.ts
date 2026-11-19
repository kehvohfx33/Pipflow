export interface DirectCandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DirectInstrumentItem {
  symbol: string;
  display_name: string;
  market: string;
  pip_size?: number;
}

export interface DirectTick {
  symbol: string;
  quote: number;
  epoch: number;
  pipSize?: number;
}

const RAW_APP_ID = String(import.meta.env.VITE_DERIV_APP_ID || '1089').trim();
const APP_ID = /^\d+$/.test(RAW_APP_ID) ? RAW_APP_ID : '1089';
const CANDIDATE_URLS = [
  `wss://red.derivws.com/websockets/v3?app_id=${encodeURIComponent(APP_ID)}&l=EN&brand=deriv`,
  `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(APP_ID)}&l=EN&brand=deriv`,
  `wss://green.derivws.com/websockets/v3?app_id=${encodeURIComponent(APP_ID)}&l=EN&brand=deriv`,
  `wss://blue.derivws.com/websockets/v3?app_id=${encodeURIComponent(APP_ID)}&l=EN&brand=deriv`
];

let workingBrowserUrl: string | null = null;

function singleWsRequest<T>(url: string, payload: Record<string, unknown>, timeoutMs = 4500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      fn();
    };

    const timer = setTimeout(() => {
      done(() => reject(new Error('Deriv public WebSocket request timeout')));
    }, timeoutMs);

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        done(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as T & { error?: { message: string } };
        if (msg.error) {
          done(() => reject(new Error(msg.error!.message)));
        } else {
          workingBrowserUrl = url;
          done(() => resolve(msg));
        }
      } catch (err) {
        done(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    };

    ws.onerror = () => {
      done(() => reject(new Error('Browser Deriv WebSocket connection failed')));
    };
  });
}

async function sendPublicDerivRequest<T>(payload: Record<string, unknown>): Promise<T> {
  if (workingBrowserUrl) {
    try {
      return await singleWsRequest<T>(workingBrowserUrl, payload, 3500);
    } catch {
      workingBrowserUrl = null;
    }
  }

  try {
    return await Promise.any(CANDIDATE_URLS.map((url) => singleWsRequest<T>(url, payload, 4500)));
  } catch (aggErr) {
    const errors = (aggErr as AggregateError)?.errors;
    const first = Array.isArray(errors) && errors.length > 0 ? errors[0] : null;
    throw first instanceof Error ? first : new Error('Deriv public WebSocket unavailable');
  }
}

export async function fetchDerivCandlesDirect(
  symbol: string,
  granularity = 60,
  count = 300
): Promise<DirectCandleBar[]> {
  const res = await sendPublicDerivRequest<{
    candles?: Array<{ epoch: number; open: number; high: number; low: number; close: number }>;
  }>({
    ticks_history: symbol,
    adjust_start_time: 1,
    count,
    end: 'latest',
    granularity,
    style: 'candles'
  });

  return (res.candles ?? []).map((c) => ({
    time: Number(c.epoch),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close)
  }));
}

export async function fetchDerivInstrumentsDirect(): Promise<DirectInstrumentItem[]> {
  const res = await sendPublicDerivRequest<{
    active_symbols?: Array<{
      symbol?: string;
      underlying_symbol?: string;
      display_name?: string;
      underlying_symbol_name?: string;
      market?: string;
      pip_size?: number;
      pip?: number;
    }>;
  }>({
    active_symbols: 'brief'
  });

  return (res.active_symbols ?? [])
    .map((s) => ({
      symbol: String(s.underlying_symbol ?? s.symbol ?? ''),
      display_name: String(s.underlying_symbol_name ?? s.display_name ?? s.symbol ?? ''),
      market: String(s.market ?? 'synthetic_index'),
      pip_size: Number(s.pip_size ?? s.pip ?? 0.01)
    }))
    .filter((s) => s.symbol.length > 0);
}

export async function fetchDerivTickHistoryDirect(
  symbol: string,
  count = 200
): Promise<{ prices: number[]; times: number[]; pipSize: number }> {
  const res = await sendPublicDerivRequest<{
    history?: { prices?: number[]; times?: number[] };
    pip_size?: number;
  }>({
    ticks_history: symbol,
    adjust_start_time: 1,
    count,
    end: 'latest',
    style: 'ticks'
  });

  const prices = (res.history?.prices ?? []).map(Number);
  const times = (res.history?.times ?? []).map(Number);
  return {
    prices,
    times,
    pipSize: Number(res.pip_size ?? 2)
  };
}

export function subscribeDerivTicksDirect(symbol: string, onTick: (tick: DirectTick) => void): () => void {
  return subscribeDerivMultiTicksDirect([symbol], onTick);
}

/**
 * Persistent multi-symbol real Deriv tick streamer using a single multiplexed WebSocket.
 * Subscribes all requested symbols safely (skipping closed weekend markets without breaking others).
 */
export function subscribeDerivMultiTicksDirect(
  symbols: string[],
  onTick: (tick: DirectTick) => void
): () => void {
  const uniqueSymbols = Array.from(new Set(symbols.map((s) => s.trim()).filter(Boolean))).slice(0, 40);
  if (uniqueSymbols.length === 0) return () => {};

  let closed = false;
  let activeWs: WebSocket | null = null;
  const raceSockets: WebSocket[] = [];
  let chosen = false;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const candidates = workingBrowserUrl
    ? [workingBrowserUrl, ...CANDIDATE_URLS.filter((u) => u !== workingBrowserUrl)]
    : CANDIDATE_URLS;

  for (const url of candidates) {
    if (closed) break;
    try {
      const ws = new WebSocket(url);
      raceSockets.push(ws);

      ws.onopen = () => {
        if (closed || chosen) {
          try {
            ws.close();
          } catch {
            // ignore
          }
          return;
        }
        chosen = true;
        activeWs = ws;
        workingBrowserUrl = url;
        for (const other of raceSockets) {
          if (other !== ws) {
            try {
              other.close();
            } catch {
              // ignore
            }
          }
        }

        // Stagger tick subscriptions slightly so Deriv WS never throttles bursts
        uniqueSymbols.forEach((sym, idx) => {
          const t = setTimeout(() => {
            if (!closed && ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
              } catch {
                // ignore
              }
            }
          }, idx * 25);
          timers.push(t);
        });

        pingTimer = setInterval(() => {
          if (!closed && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ ping: 1 }));
            } catch {
              // ignore
            }
          }
        }, 25000);
      };

      ws.onmessage = (ev) => {
        if (closed || activeWs !== ws) return;
        try {
          const msg = JSON.parse(ev.data) as {
            tick?: { symbol: string; quote: number; epoch: number; pip_size?: number };
          };
          if (msg.tick) {
            onTick({
              symbol: msg.tick.symbol,
              quote: Number(msg.tick.quote),
              epoch: Number(msg.tick.epoch),
              pipSize: msg.tick.pip_size
            });
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore constructor error
    }
  }

  return () => {
    closed = true;
    if (pingTimer) clearInterval(pingTimer);
    timers.forEach((t) => clearTimeout(t));
    for (const sock of raceSockets) {
      try {
        if (sock.readyState === WebSocket.OPEN) {
          sock.send(JSON.stringify({ forget_all: 'ticks' }));
        }
        sock.close();
      } catch {
        // ignore
      }
    }
  };
}
