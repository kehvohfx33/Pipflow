import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const fallbackSessionSecret = crypto.randomBytes(32).toString('hex');

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: process.env.JWT_SECRET || fallbackSessionSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  botGateJwtSecret: process.env.BOT_GATE_JWT_SECRET || process.env.JWT_SECRET || fallbackSessionSecret,
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? '',
  derivAppId: process.env.DERIV_APP_ID || '1089',
  derivClientSecret: process.env.DERIV_CLIENT_SECRET ?? '',
  derivOAuthScopes: process.env.DERIV_OAUTH_SCOPES || 'trade account_manage',
  derivWsUrl: process.env.DERIV_WS_URL || 'wss://ws.derivws.com/websockets/v3',
  derivOAuthUrl: process.env.DERIV_OAUTH_URL || 'https://auth.deriv.com/oauth2/auth',
  derivOAuthRedirectUri:
    process.env.DERIV_OAUTH_REDIRECT_URI ||
    (process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/api/deriv/oauth/callback`
      : 'http://localhost:3000/api/deriv/oauth/callback'),
  brevoApiKey: process.env.BREVO_API_KEY ?? '',
  brevoSenderEmail: process.env.BREVO_SENDER_EMAIL || 'noreply@tradederiv.app',
  brevoSenderName: process.env.BREVO_SENDER_NAME || 'TradeDeriv',
  frontendUrl:
    process.env.FRONTEND_URL ||
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    'http://localhost:3000',
  adminPrivateSlug: process.env.ADMIN_PRIVATE_SLUG || 'pf-ops-9482'
};
