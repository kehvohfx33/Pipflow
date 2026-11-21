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
let sharedWs: WebSocket | null = null;
let sharedConnectPromise: Promise<WebSocket> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reqSeq = 1;

const pendingRequests = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
const tickListeners = new Map<string, Set<(tick: DirectTick) => void>>();
const subscribedOnSocket = new Set<string>();
const latestTickCache = new Map<string, DirectTick>();
const candleCache = new Map<string, { at: number; bars: DirectCandleBar[] }>();
const CANDLE_CACHE_TTL_MS = 15_000;

function stopKeepalive() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function startKeepalive(ws: WebSocket) {
  stopKeepalive();
  pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ ping: 1 }));
      } catch {
        // ignore
      }
    }
  }, 25_000);
}

function scheduleReconnect() {
  if (reconnectTimer || tickListeners.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (tickListeners.size > 0) {
      ensureSharedPublicSocket().catch(() => {
        scheduleReconnect();
      });
    }
  }, 1500);
}

function resubscribeActiveSymbols(ws: WebSocket) {
  const symbols = Array.from(tickListeners.keys()).slice(0, 40);
  symbols.forEach((sym, idx) => {
    if (subscribedOnSocket.has(sym)) return;
    setTimeout(() => {
      if (sharedWs === ws && ws.readyState === WebSocket.OPEN && tickListeners.has(sym) && !subscribedOnSocket.has(sym)) {
        try {
          subscribedOnSocket.add(sym);
          ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
        } catch {
          subscribedOnSocket.delete(sym);
        }
      }
    }, idx * 20);
  });
}

function attachSharedSocket(ws: WebSocket, url: string) {
  if (sharedWs && sharedWs !== ws) {
    try {
      sharedWs.close();
    } catch {
      // ignore
    }
  }
  sharedWs = ws;
  workingBrowserUrl = url;
  subscribedOnSocket.clear();
  startKeepalive(ws);

  ws.onmessage = (ev) => {
    if (sharedWs !== ws) return;
    try {
      const msg = JSON.parse(ev.data) as {
        req_id?: number;
        error?: { message: string };
        tick?: { symbol: string; quote: number; epoch: number; pip_size?: number };
      };

      if (msg.req_id && pendingRequests.has(msg.req_id)) {
        const entry = pendingRequests.get(msg.req_id)!;
        clearTimeout(entry.timer);
        pendingRequests.delete(msg.req_id);
        if (msg.error) entry.reject(new Error(msg.error.message));
        else entry.resolve(msg);
      }

      if (msg.tick?.symbol) {
        const tick: DirectTick = {
          symbol: msg.tick.symbol,
          quote: Number(msg.tick.quote),
          epoch: Number(msg.tick.epoch),
          pipSize: msg.tick.pip_size
        };
        latestTickCache.set(tick.symbol, tick);
        const listeners = tickListeners.get(tick.symbol);
        if (listeners) {
          listeners.forEach((fn) => fn(tick));
        }
      }
    } catch {
      // ignore malformed frames
    }
  };

  ws.onclose = () => {
    if (sharedWs === ws) {
      sharedWs = null;
      subscribedOnSocket.clear();
      stopKeepalive();
      for (const [id, entry] of pendingRequests.entries()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Deriv public WebSocket disconnected'));
        pendingRequests.delete(id);
      }
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      // ignore
    }
  };

  resubscribeActiveSymbols(ws);
}

function openCandidateBrowserSocket(url: string, timeoutMs = 4000): Promise<{ ws: WebSocket; url: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error('Deriv public WebSocket timeout'));
      }
    }, timeoutMs);

    ws.onopen = () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ ws, url });
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error('Browser Deriv WebSocket connection failed'));
      }
    };
  });
}

async function ensureSharedPublicSocket(): Promise<WebSocket> {
  if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
    return sharedWs;
  }
  if (sharedConnectPromise) {
    return sharedConnectPromise;
  }

  sharedConnectPromise = (async () => {
    if (workingBrowserUrl) {
      try {
        const res = await openCandidateBrowserSocket(workingBrowserUrl, 3000);
        attachSharedSocket(res.ws, res.url);
        return res.ws;
      } catch {
        workingBrowserUrl = null;
      }
    }

    const attempts = CANDIDATE_URLS.map((u) => openCandidateBrowserSocket(u, 4200));
    try {
      const winner = await Promise.any(attempts);
      attachSharedSocket(winner.ws, winner.url);
      attempts.forEach((p) => {
        p.then((other) => {
          if (other.ws !== winner.ws) {
            try {
              other.ws.close();
            } catch {
              // ignore
            }
          }
        }).catch(() => {});
      });
      return winner.ws;
    } catch (aggErr) {
      const errors = (aggErr as AggregateError)?.errors;
      const first = Array.isArray(errors) && errors.length > 0 ? errors[0] : null;
      throw first instanceof Error ? first : new Error('Deriv public WebSocket unavailable');
    }
  })().finally(() => {
    sharedConnectPromise = null;
  });

  return sharedConnectPromise;
}

async function sendPublicDerivRequest<T>(payload: Record<string, unknown>, timeoutMs = 4500): Promise<T> {
  const ws = await ensureSharedPublicSocket();
  if (ws.readyState !== WebSocket.OPEN) {
    throw new Error('Deriv public WebSocket not open');
  }
  const reqId = reqSeq++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(reqId);
      reject(new Error('Deriv public WebSocket request timeout'));
    }, timeoutMs);
    pendingRequests.set(reqId, {
      resolve: resolve as (v: unknown) => void,
      reject,
      timer
    });
    try {
      ws.send(JSON.stringify({ ...payload, req_id: reqId }));
    } catch (err) {
      clearTimeout(timer);
      pendingRequests.delete(reqId);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function fetchDerivCandlesDirect(
  symbol: string,
  granularity = 60,
  count = 300
): Promise<DirectCandleBar[]> {
  const cacheKey = `${symbol}:${granularity}:${count}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CANDLE_CACHE_TTL_MS) {
    return cached.bars;
  }

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

  const bars = (res.candles ?? []).map((c) => ({
    time: Number(c.epoch),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close)
  }));

  if (bars.length > 0) {
    candleCache.set(cacheKey, { at: Date.now(), bars });
  }
  return bars;
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
 * Persistent multi-symbol real Deriv tick streamer using a single auto-reconnecting multiplexed WebSocket.
 * Immediately delivers cached ticks and diffs active subscriptions cleanly without tearing down sockets.
 */
export function subscribeDerivMultiTicksDirect(
  symbols: string[],
  onTick: (tick: DirectTick) => void
): () => void {
  const uniqueSymbols = Array.from(new Set(symbols.map((s) => s.trim()).filter(Boolean))).slice(0, 40);
  if (uniqueSymbols.length === 0) return () => {};

  for (const sym of uniqueSymbols) {
    let set = tickListeners.get(sym);
    if (!set) {
      set = new Set();
      tickListeners.set(sym, set);
    }
    set.add(onTick);

    const cached = latestTickCache.get(sym);
    if (cached) {
      queueMicrotask(() => {
        if (tickListeners.get(sym)?.has(onTick)) {
          onTick(cached);
        }
      });
    }
  }

  ensureSharedPublicSocket()
    .then((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        resubscribeActiveSymbols(ws);
      }
    })
    .catch(() => {
      scheduleReconnect();
    });

  return () => {
    for (const sym of uniqueSymbols) {
      const set = tickListeners.get(sym);
      if (set) {
        set.delete(onTick);
        if (set.size === 0) {
          tickListeners.delete(sym);
          subscribedOnSocket.delete(sym);
        }
      }
    }
  };
}
