import http from 'http';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import { env } from './config/env';
import { router } from './routes';
import { handleDerivOAuthCallback } from './controllers/derivController';
import { requireDb } from './middleware/authorization';
import { ensureDatabaseSchema } from './database/init';
import { derivConnectionManager } from './integrations/deriv/connection-manager';
import { ensureLiveTickSubscription } from './services/market-data-service';
import { attachTickEvaluator } from './services/bot-engine-service';
import { registerWsClient, unregisterWsClient, broadcastToUser } from './services/realtime-hub';
import { logInfo, logError } from './utils/logger';

export function createApiApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: env.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false
    })
  );
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', router);
  app.get(['/callback', '/callback/'], requireDb, (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handleDerivOAuthCallback(req, res)).catch(next);
  });

  if (env.nodeEnv === 'production' && (!process.env.JWT_SECRET || !process.env.TOKEN_ENCRYPTION_KEY)) {
    logError(
      'security',
      'JWT_SECRET or TOKEN_ENCRYPTION_KEY is unset in production; ephemeral fallback keys invalidate sessions on restart'
    );
  }

  // Global Express JSON error handler so unhandled DB/API errors never crash the process
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logError('express', 'Unhandled API error', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  });

  ensureDatabaseSchema().catch(() => {});

  return app;
}

export function attachWebSocketRelay(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');
    let userId: string | null = null;

    if (token) {
      try {
        const payload = jwt.verify(token, env.jwtSecret) as { userId: string };
        userId = payload.userId;
      } catch {
        // Unauthenticated clients still receive public live market ticks and global branding updates
      }
    }

    registerWsClient(ws, userId);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; symbol?: string; symbols?: string[] };
        if (msg.type === 'subscribe' && msg.symbol) {
          await ensureLiveTickSubscription(msg.symbol).catch(() => {});
        } else if (msg.type === 'subscribe_many' && Array.isArray(msg.symbols)) {
          await Promise.allSettled(
            msg.symbols
              .slice(0, 40)
              .map((s) => ensureLiveTickSubscription(String(s)).catch(() => {}))
          );
        }
      } catch {
        // Ignore malformed client WS messages
      }
    });

    ws.on('close', () => {
      unregisterWsClient(ws, userId);
    });
  });

  const marketClient = derivConnectionManager.getMarketClient();
  marketClient.socket.on('tick', (msg: unknown) => {
    const payload = JSON.stringify({ type: 'tick', data: msg });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  });

  attachTickEvaluator((userId, event) => {
    broadcastToUser(userId, event);
  });

  marketClient
    .ensureConnected()
    .then(() => {
      logInfo('deriv-ws', 'Connected to Official Deriv WebSocket API');
      return Promise.allSettled([
        ensureLiveTickSubscription('R_100'),
        ensureLiveTickSubscription('R_25'),
        ensureLiveTickSubscription('1HZ90V'),
        ensureLiveTickSubscription('1HZ100V')
      ]);
    })
    .catch((err) => {
      logError('deriv-ws', 'Initial Deriv WebSocket connection failed (will auto-retry)', err);
    });

  return wss;
}
