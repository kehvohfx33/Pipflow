import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const fallbackSessionSecret = crypto.randomBytes(32).toString('hex');
const OFFICIAL_SITE_URL = 'https://pipflowtrade.site';

function isHostedInternalDomain(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('.onrender.com') ||
    lower.includes('.run.app') ||
    lower.includes('.aistudio.dev') ||
    lower.includes('tradederiv')
  );
}

function resolveOfficialPublicSiteUrl(): string {
  const candidates = [process.env.PUBLIC_SITE_URL, process.env.FRONTEND_URL];
  for (const cand of candidates) {
    const clean = cand?.trim().replace(/\/$/, '');
    if (clean && !isHostedInternalDomain(clean)) {
      return clean;
    }
  }
  return OFFICIAL_SITE_URL;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const publicSiteUrl = resolveOfficialPublicSiteUrl();
const configuredRedirect = process.env.DERIV_OAUTH_REDIRECT_URI?.trim() || '';
const safeRedirectUri =
  configuredRedirect && !isHostedInternalDomain(configuredRedirect)
    ? configuredRedirect
    : nodeEnv === 'production'
      ? `${publicSiteUrl}/api/deriv/oauth/callback`
      : 'http://localhost:3000/api/deriv/oauth/callback';

export const env = {
  nodeEnv,
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
  derivOAuthRedirectUri: safeRedirectUri,
  brevoApiKey: process.env.BREVO_API_KEY ?? '',
  brevoSenderEmail: process.env.BREVO_SENDER_EMAIL || 'noreply@pipflowtrade.site',
  brevoSenderName: process.env.BREVO_SENDER_NAME || 'Pipflowtrades',
  publicSiteUrl,
  frontendUrl: nodeEnv === 'production' ? publicSiteUrl : resolveOfficialPublicSiteUrl(),
  adminPrivateSlug: process.env.ADMIN_PRIVATE_SLUG || 'pf-ops-9482'
};
