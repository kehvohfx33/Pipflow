import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { env } from '../../config/env';

export interface DerivMessage {
  msg_type?: string;
  req_id?: number;
  error?: { code: string; message: string };
  [key: string]: unknown;
}

const DEFAULT_DERIV_WS_ENDPOINTS = [
  'wss://red.derivws.com/websockets/v3',
  'wss://ws.derivws.com/websockets/v3',
  'wss://green.derivws.com/websockets/v3',
  'wss://blue.derivws.com/websockets/v3',
  'wss://ws.binaryws.com/websockets/v3'
];

let lastWorkingEndpoint: string | null = null;

function getCandidateEndpoints(): string[] {
  const raw = [
    lastWorkingEndpoint,
    env.derivWsUrl,
    ...DEFAULT_DERIV_WS_ENDPOINTS
  ].filter((v): v is string => Boolean(v && v.trim()));
  return Array.from(new Set(raw.map((u) => u.replace(/\/$/, ''))));
}

export class DerivWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private isClosing = false;
  private connectPromise: Promise<void> | null = null;
  private reqSeq = 1;
  private pending = new Map<
    number,
    { resolve: (v: DerivMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  public connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.isClosing = false;
    this.connectPromise = this.connectWithRace().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private async connectWithRace(): Promise<void> {
    const endpoints = getCandidateEndpoints();

    // Fast path: try the last known healthy endpoint first (max 3.5s)
    if (lastWorkingEndpoint) {
      try {
        const socket = await this.openCandidateSocket(lastWorkingEndpoint, 3500);
        this.attachWinningSocket(socket, lastWorkingEndpoint);
        return;
      } catch {
        lastWorkingEndpoint = null;
      }
    }

    // Concurrent race across all official Deriv WS clusters so Cloudflare 520 or slow nodes never stall
    const attempts = endpoints.map(async (baseUrl) => {
      const socket = await this.openCandidateSocket(baseUrl, 4500);
      return { baseUrl, socket };
    });

    try {
      const winner = await Promise.any(attempts);
      lastWorkingEndpoint = winner.baseUrl;
      this.attachWinningSocket(winner.socket, winner.baseUrl);
      // Cleanly close any other sockets that resolve later
      attempts.forEach((p) => {
        p.then((res) => {
          if (res.socket !== winner.socket) {
            try {
              res.socket.close();
            } catch {
              // ignore
            }
          }
        }).catch(() => {});
      });
    } catch (aggErr) {
      const firstErr =
        aggErr instanceof AggregateError && aggErr.errors.length > 0
          ? aggErr.errors[0]
          : new Error('Unable to connect to any official Deriv WebSocket endpoint');
      throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
    }
  }

  private openCandidateSocket(baseUrl: string, timeoutMs: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      if (this.isClosing) {
        reject(new Error('Deriv WebSocket closing'));
        return;
      }
      const wsAppId = /^\d+$/.test(env.derivAppId.trim()) ? env.derivAppId.trim() : '1089';
      const url = `${baseUrl}?app_id=${encodeURIComponent(wsAppId)}&l=EN&brand=deriv`;
      const socket = new WebSocket(url, {
        headers: {
          Origin: 'https://app.deriv.com',
          'User-Agent': 'Mozilla/5.0 (compatible; Pipflowtrades/1.0)'
        },
        handshakeTimeout: timeoutMs
      });

      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            socket.terminate();
          } catch {
            // ignore
          }
          reject(new Error(`Timeout connecting to ${baseUrl}`));
        }
      }, timeoutMs);

      socket.once('open', () => {
        clearTimeout(timer);
        if (this.isClosing) {
          socket.close();
          if (!settled) {
            settled = true;
            reject(new Error('Deriv WebSocket closed during connect'));
          }
          return;
        }
        if (!settled) {
          settled = true;
          resolve(socket);
        }
      });

      socket.once('error', (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          try {
            socket.terminate();
          } catch {
            // ignore
          }
          reject(err);
        }
      });
    });
  }

  private attachWinningSocket(socket: WebSocket, _baseUrl: string) {
    if (this.ws && this.ws !== socket) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = socket;
    this.reconnectAttempt = 0;
    this.startKeepalive();
    this.emit('open');

    socket.on('message', (raw) => {
      try {
        const data: DerivMessage = JSON.parse(raw.toString());
        if (data.req_id && this.pending.has(data.req_id)) {
          const p = this.pending.get(data.req_id)!;
          clearTimeout(p.timer);
          this.pending.delete(data.req_id);
          if (data.error) p.reject(new Error(`${data.error.code}: ${data.error.message}`));
          else p.resolve(data);
        }
        if (data.msg_type) {
          this.emit(data.msg_type, data);
        }
        this.emit('message', data);
      } catch (err) {
        this.emit('parse_error', err);
      }
    });

    socket.on('close', () => {
      if (this.ws === socket) {
        this.stopKeepalive();
        this.rejectAllPending('Deriv WebSocket disconnected');
        this.ws = null;
        this.emit('close');
        if (!this.isClosing) this.scheduleReconnect();
      }
    });

    socket.on('error', (err) => {
      this.emit('ws_error', err);
    });
  }

  public send<T extends DerivMessage = DerivMessage>(payload: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Deriv WebSocket is not connected'));
    }
    const reqId = this.reqSeq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`Deriv API request timeout (req_id=${reqId})`));
      }, timeoutMs);
      this.pending.set(reqId, {
        resolve: resolve as (v: DerivMessage) => void,
        reject,
        timer
      });
      this.ws!.send(JSON.stringify({ ...payload, req_id: reqId }));
    });
  }

  private startKeepalive() {
    this.stopKeepalive();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 30000);
  }

  private stopKeepalive() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempt++));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }

  private rejectAllPending(reason: string) {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  public close() {
    this.isClosing = true;
    this.stopKeepalive();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  public isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
