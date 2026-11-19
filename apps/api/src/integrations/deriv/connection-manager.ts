import { DerivClient } from './deriv-client';

class DerivConnectionManager {
  private sharedMarketClient: DerivClient | null = null;
  private lastConnectedAt: Date | null = null;
  private lastError: string | null = null;
  private reconnectCount = 0;

  public getMarketClient(): DerivClient {
    if (!this.sharedMarketClient) {
      this.sharedMarketClient = new DerivClient();
      this.sharedMarketClient.socket.on('open', () => {
        if (this.lastConnectedAt !== null) {
          this.reconnectCount++;
        }
        this.lastConnectedAt = new Date();
        this.lastError = null;
      });
      this.sharedMarketClient.socket.on('ws_error', (err: Error) => {
        this.lastError = err.message;
      });
    }
    return this.sharedMarketClient;
  }

  public getDiagnostics() {
    return {
      connected: this.sharedMarketClient?.socket.isOpen() ?? false,
      lastConnectedAt: this.lastConnectedAt ? this.lastConnectedAt.toISOString() : null,
      reconnectCount: this.reconnectCount,
      lastError: this.lastError
    };
  }
}

export const derivConnectionManager = new DerivConnectionManager();
