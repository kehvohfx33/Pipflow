import http from 'http';
import { env } from './config/env';
import { createApiApp, attachWebSocketRelay } from './app';
import { logInfo } from './utils/logger';

const app = createApiApp();
const server = http.createServer(app);
attachWebSocketRelay(server);

server.listen(env.port, '0.0.0.0', () => {
  logInfo('server', `PIPFLOW standalone API listening on port ${env.port}`);
});
