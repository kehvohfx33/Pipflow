import WebSocket from 'ws';
import { DerivWebSocket, DerivMessage } from './websocket';

export class DerivClient {
  public readonly socket: DerivWebSocket;

  constructor() {
    this.socket = new DerivWebSocket();
  }

  async ensureConnected(): Promise<void> {
    if (!this.socket.isOpen()) {
      await this.socket.connect();
    }
  }

  async request<T extends DerivMessage = DerivMessage>(payload: Record<string, unknown>): Promise<T> {
    await this.ensureConnected();
    return this.socket.send<T>(payload);
  }
}

export class OtpDerivClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reqSeq = 1;
  private pending = new Map<
    number,
    { resolve: (v: DerivMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly otpUrl: string) {}

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startKeepalive() {
    this.stopKeepalive();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ ping: 1 }));
        } catch {
          // ignore
        }
      }
    }, 25000);
    this.pingTimer.unref?.();
  }

  private stopKeepalive() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  async connect(timeoutMs = 10000): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.otpUrl, {
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
            ws.terminate();
          } catch {
            // ignore
          }
          reject(new Error('Timeout connecting to Deriv OTP trading WebSocket'));
        }
      }, timeoutMs);

      ws.once('open', () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          this.ws = ws;
          this.startKeepalive();
          resolve();
        }
      });

      ws.once('error', (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      ws.on('error', () => {
        // Prevent unhandled error crashes after socket is open
      });

      ws.on('message', (raw) => {
        try {
          const data: DerivMessage = JSON.parse(raw.toString());
          if (data.req_id && this.pending.has(data.req_id)) {
            const p = this.pending.get(data.req_id)!;
            clearTimeout(p.timer);
            this.pending.delete(data.req_id);
            if (data.error) p.reject(new Error(`${data.error.code}: ${data.error.message}`));
            else p.resolve(data);
          }
        } catch {
          // ignore
        }
      });

      ws.on('close', () => {
        this.stopKeepalive();
        for (const [id, p] of this.pending.entries()) {
          clearTimeout(p.timer);
          p.reject(new Error('Deriv OTP WebSocket closed'));
          this.pending.delete(id);
        }
        if (this.ws === ws) {
          this.ws = null;
        }
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  async request<T extends DerivMessage = DerivMessage>(payload: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Deriv OTP WebSocket not open');
    }
    const reqId = this.reqSeq++;
    return new Promise<T>((resolve, reject) => {
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

  close() {
    this.stopKeepalive();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}
