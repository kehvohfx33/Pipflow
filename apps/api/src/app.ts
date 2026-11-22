import fs from 'fs';
import path from 'path';
import http from 'http';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import { env, validateEnvironmentConfig } from './config/env';
import { router } from './routes';
import { handleDerivOAuthCallback } from './controllers/derivController';
import { requireDb } from './middleware/authorization';
import { requireCsrf } from './middleware/authentication';
import { ensureDatabaseSchema } from './database/init';
import { pool, isStorageReady } from './database/pool';
import { derivConnectionManager } from './integrations/deriv/connection-manager';
import { ensureLiveTickSubscription, getLatestTicksForSymbols } from './services/market-data-service';
import { attachTickEvaluator } from './services/bot-engine-service';
import { registerWsClient, unregisterWsClient, broadcastToUser } from './services/realtime-hub';
import { parseCookies, SESSION_COOKIE_NAME } from './utils/cookies';
import { logInfo, logError } from './utils/logger';

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://pipflowtrade.site/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://pipflowtrade.site/charts</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://pipflowtrade.site/trading-view</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://pipflowtrade.site/bots</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://pipflowtrade.site/analysis</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://pipflowtrade.site/learning</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>
`;

const ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /_console
Disallow: /callback

Sitemap: https://pipflowtrade.site/sitemap.xml
`;

function isAllowedCorsOrigin(origin?: string): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    if (host === 'pipflowtrade.site' || host === 'www.pipflowtrade.site') return true;
    const configuredHost = new URL(env.publicSiteUrl).hostname.toLowerCase();
    if (host === configuredHost) return true;
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.aistudio.dev') ||
      host.endsWith('.run.app')
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function createApiApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false,
      crossOriginOpenerPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: env.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false
    })
  );
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedCorsOrigin(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: '256kb' }));

  app.get('/sitemap.xml', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(SITEMAP_XML);
  });

  app.get('/robots.txt', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(ROBOTS_TXT);
  });

  app.get('/favicon.ico', (_req: Request, res: Response) => {
    const candidates = [
      path.resolve(process.cwd(), 'public/assets/aistudio/IMG-20261115-WA0009_aca2a037.jpg'),
      path.resolve(process.cwd(), 'dist/assets/aistudio/IMG-20261115-WA0009_aca2a037.jpg')
    ];
    const match = candidates.find((p) => fs.existsSync(p));
    if (match) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.sendFile(match);
    }
    res.status(204).end();
  });

  app.use(
    '/api',
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      next();
    },
    requireCsrf,
    router
  );

  app.get(['/callback', '/callback/'], requireDb, (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handleDerivOAuthCallback(req, res)).catch(next);
  });

  const envReport = validateEnvironmentConfig();
  for (const w of envReport.warnings) {
    logError('config', w);
  }

  // Global Express JSON error handler so unhandled DB/API errors never leak stack traces or infra details
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logError('express', 'Unhandled API error', err);
    const safeMessage =
      env.nodeEnv === 'production'
        ? 'Internal server error'
        : err instanceof Error
          ? err.message
          : 'Internal server error';
    res.status(500).json({ error: safeMessage });
  });

  ensureDatabaseSchema().catch(() => {});

  return app;
}

export function attachWebSocketRelay(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host || 'localhost'}`);
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[SESSION_COOKIE_NAME];
    const queryToken = url.searchParams.get('token');
    const rawToken = (cookieToken && cookieToken.trim()) || (queryToken && queryToken.trim()) || null;
    let verifiedUserId: string | null = null;
    let registered = false;

    const flushCachedTicks = (symbols: string[]) => {
      const cached = getLatestTicksForSymbols(symbols);
      for (const tick of cached) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'tick', data: { tick } }));
        }
      }
    };

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; symbol?: string; symbols?: string[] };
        if (msg.type === 'subscribe' && msg.symbol) {
          flushCachedTicks([msg.symbol]);
          await ensureLiveTickSubscription(msg.symbol).catch(() => {});
        } else if (msg.type === 'subscribe_many' && Array.isArray(msg.symbols)) {
          const list = msg.symbols.slice(0, 40).map((s) => String(s));
          flushCachedTicks(list);
          await Promise.allSettled(
            list.map((s) => ensureLiveTickSubscription(s).catch(() => {}))
          );
        }
      } catch {
        // Ignore malformed client WS messages
      }
    });

    ws.on('close', () => {
      if (registered) {
        unregisterWsClient(ws, verifiedUserId);
      }
    });

    void (async () => {
      if (rawToken) {
        try {
          const payload = jwt.verify(rawToken, env.jwtSecret) as { userId?: string; tv?: number };
          if (payload.userId) {
            if (isStorageReady) {
              const q = await pool.query(
                `SELECT is_active, COALESCE(token_version, 1) AS token_version FROM users WHERE id = $1`,
                [payload.userId]
              );
              const row = q.rows[0];
              if (row && row.is_active && Number(payload.tv ?? 1) === Number(row.token_version)) {
                verifiedUserId = payload.userId;
              }
            } else {
              verifiedUserId = payload.userId;
            }
          }
        } catch {
          verifiedUserId = null;
        }
      }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        registerWsClient(ws, verifiedUserId);
        registered = true;
      }
    })();
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
