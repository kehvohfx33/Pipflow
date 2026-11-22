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

export interface EnvValidationReport {
  valid: boolean;
  warnings: string[];
  configured: Record<string, boolean>;
}

export function validateEnvironmentConfig(): EnvValidationReport {
  const warnings: string[] = [];
  const configured: Record<string, boolean> = {
    FRONTEND_URL: Boolean(process.env.FRONTEND_URL?.trim()),
    DATABASE_URL: Boolean(process.env.DATABASE_URL?.trim() && !process.env.DATABASE_URL.includes('ep-example')),
    JWT_SECRET: Boolean(process.env.JWT_SECRET?.trim()),
    BOT_GATE_JWT_SECRET: Boolean(process.env.BOT_GATE_JWT_SECRET?.trim()),
    TOKEN_ENCRYPTION_KEY: Boolean(process.env.TOKEN_ENCRYPTION_KEY?.trim()),
    DERIV_APP_ID: Boolean(process.env.DERIV_APP_ID?.trim()),
    DERIV_CLIENT_SECRET: Boolean(process.env.DERIV_CLIENT_SECRET?.trim()),
    DERIV_OAUTH_REDIRECT_URI: Boolean(process.env.DERIV_OAUTH_REDIRECT_URI?.trim()),
    DERIV_OAUTH_SCOPES: Boolean(process.env.DERIV_OAUTH_SCOPES?.trim()),
    DERIV_WS_URL: Boolean(process.env.DERIV_WS_URL?.trim()),
    BREVO_API_KEY: Boolean(process.env.BREVO_API_KEY?.trim()),
    ADMIN_PRIVATE_SLUG: Boolean(process.env.ADMIN_PRIVATE_SLUG?.trim())
  };

  if (env.nodeEnv === 'production') {
    for (const key of ['DATABASE_URL', 'JWT_SECRET', 'BOT_GATE_JWT_SECRET', 'TOKEN_ENCRYPTION_KEY', 'DERIV_APP_ID']) {
      if (!configured[key]) {
        warnings.push(`Missing required production environment variable: ${key}`);
      }
    }
  } else {
    if (!configured.DATABASE_URL) {
      warnings.push('DATABASE_URL is not configured — running with in-memory fallback store');
    }
    if (!configured.JWT_SECRET || !configured.TOKEN_ENCRYPTION_KEY) {
      warnings.push('Using ephemeral development session/encryption keys (set JWT_SECRET and TOKEN_ENCRYPTION_KEY for persistence)');
    }
  }

  return {
    valid: env.nodeEnv !== 'production' || warnings.length === 0,
    warnings,
    configured
  };
}

