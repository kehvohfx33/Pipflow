import http from 'http';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import { env } from './apps/api/src/config/env';
import { createApiApp, attachWebSocketRelay } from './apps/api/src/app';
import { logInfo } from './apps/api/src/utils/logger';

async function startServer() {
  const app = createApiApp();
  const server = http.createServer(app);
  attachWebSocketRelay(server);

  if (env.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Canonicalize hosting-provider domain browser visits -> official domain (keep /api/health & /api/* intact)
    app.use((req: Request, res: Response, next: NextFunction) => {
      const host = (req.get('x-forwarded-host') || req.get('host') || '').toLowerCase();
      if (
        host.includes('.onrender.com') &&
        req.method === 'GET' &&
        !req.path.startsWith('/api/')
      ) {
        const target = `${env.publicSiteUrl.replace(/\/$/, '')}${req.originalUrl}`;
        return res.redirect(301, target);
      }
      next();
    });

    const distPath = path.resolve(process.cwd(), 'dist');
    const publicAssetsPath = path.resolve(process.cwd(), 'public');
    app.use('/api', (_req, res) => {
      res.status(404).json({ error: 'API route not found' });
    });
    app.use(express.static(distPath, { maxAge: '1d' }));
    app.use(express.static(publicAssetsPath, { maxAge: '1d' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    logInfo('server', `Pipflowtrades full-stack server running on http://0.0.0.0:${port}`);
  });
}

startServer();
