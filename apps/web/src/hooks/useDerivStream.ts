import { useEffect, useMemo, useRef, useState } from 'react';
import { getWebSocketUrl } from '../services/api';
import { subscribeDerivMultiTicksDirect } from '../services/derivBrowserWs';

export interface LiveTick {
  symbol: string;
  quote: number;
  epoch: number;
  pipSize?: number;
}

export interface BotOrderEvent {
  type: 'order_closed' | 'bot_order_opened';
  symbol?: string;
  status?: string;
  pnl?: number;
  exitPrice?: number;
}

const CORE_WATCH_SYMBOLS = [
  'R_25',
  'R_50',
  'R_75',
  'R_100',
  'R_10',
  '1HZ90V',
  '1HZ100V',
  '1HZ10V',
  '1HZ25V',
  '1HZ50V',
  '1HZ75V',
  'JD10',
  'JD25',
  'BOOM500',
  'CRASH500',
  'frxEURUSD',
  'frxGBPUSD',
  'frxUSDJPY',
  'frxXAUUSD',
  'cryBTCUSD',
  'cryETHUSD'
];

export function useDerivStream(
  authenticated: boolean,
  activeSymbol?: string,
  watchSymbols: string[] = []
) {
  const [ticksBySymbol, setTicksBySymbol] = useState<Record<string, LiveTick>>({});
  const [connected, setConnected] = useState(false);
  const [lastOrderEvent, setLastOrderEvent] = useState<BotOrderEvent | null>(null);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [accountVersion, setAccountVersion] = useState(0);
  const [notificationVersion, setNotificationVersion] = useState(0);
  const [suspendedCount, setSuspendedCount] = useState(0);
  const [botStoppedCount, setBotStoppedCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  const mergedWatchList = useMemo(() => {
    const set = new Set<string>();
    if (activeSymbol) set.add(activeSymbol);
    watchSymbols.forEach((s) => {
      if (s) set.add(s);
    });
    CORE_WATCH_SYMBOLS.forEach((s) => set.add(s));
    return Array.from(set).slice(0, 40);
  }, [activeSymbol, watchSymbols.join(',')]);

  const watchListKey = mergedWatchList.join(',');
  const mergedWatchRef = useRef<string[]>(mergedWatchList);
  mergedWatchRef.current = mergedWatchList;

  useEffect(() => {
    if (!authenticated) {
      setConnected(false);
      return;
    }
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (typeof WebSocket === 'undefined') return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(getWebSocketUrl());
      } catch {
        if (!closed) reconnectTimer = setTimeout(connect, 2500);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (mergedWatchRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'subscribe_many', symbols: mergedWatchRef.current }));
          } catch {
            // ignore
          }
        }
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as
            | {
                type: 'tick';
                data?: { tick?: { symbol: string; quote: number; epoch: number; pip_size?: number } };
              }
            | BotOrderEvent
            | {
                type:
                  | 'settings_updated'
                  | 'account_updated'
                  | 'account_suspended'
                  | 'notification_created'
                  | 'bot_stopped';
              };

          if (msg.type === 'tick' && 'data' in msg && msg.data?.tick) {
            const t = msg.data.tick;
            setTicksBySymbol((prev) => ({
              ...prev,
              [t.symbol]: {
                symbol: t.symbol,
                quote: Number(t.quote),
                epoch: Number(t.epoch),
                pipSize: t.pip_size
              }
            }));
          } else if (msg.type === 'order_closed' || msg.type === 'bot_order_opened') {
            setLastOrderEvent(msg);
          } else if (msg.type === 'settings_updated') {
            setSettingsVersion((v) => v + 1);
          } else if (msg.type === 'account_updated') {
            setAccountVersion((v) => v + 1);
          } else if (msg.type === 'account_suspended') {
            setSuspendedCount((v) => v + 1);
          } else if (msg.type === 'bot_stopped') {
            setBotStoppedCount((v) => v + 1);
          } else if (msg.type === 'notification_created') {
            setNotificationVersion((v) => v + 1);
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!closed) {
          reconnectTimer = setTimeout(connect, 2500);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [authenticated]);

  useEffect(() => {
    if (
      mergedWatchList.length > 0 &&
      wsRef.current &&
      typeof WebSocket !== 'undefined' &&
      wsRef.current.readyState === WebSocket.OPEN
    ) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'subscribe_many', symbols: mergedWatchList }));
      } catch {
        // ignore
      }
    }
  }, [watchListKey]);

  // Direct multiplexed Deriv browser stream guarantees live Bid/Ask for all Market Watch rows & open orders
  useEffect(() => {
    const unsub = subscribeDerivMultiTicksDirect(mergedWatchList, (tick) => {
      setTicksBySymbol((prev) => ({ ...prev, [tick.symbol]: tick }));
    });
    return () => {
      unsub();
    };
  }, [watchListKey]);

  return {
    ticksBySymbol,
    connected,
    lastOrderEvent,
    settingsVersion,
    accountVersion,
    notificationVersion,
    suspendedCount,
    botStoppedCount
  };
}
