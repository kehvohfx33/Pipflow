import { Request, Response, NextFunction } from 'express';

interface BucketEntry {
  hits: number[];
}

function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  scope: string;
  message: string;
}) {
  const buckets = new Map<string, BucketEntry>();
  let lastCleanup = Date.now();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const cutoff = now - options.windowMs;

    if (now - lastCleanup > options.windowMs || buckets.size > 2000) {
      for (const [key, entry] of buckets.entries()) {
        const recent = entry.hits.filter((ts) => ts > cutoff);
        if (recent.length === 0) {
          buckets.delete(key);
        } else {
          entry.hits = recent;
        }
      }
      lastCleanup = now;
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.scope}:${ip}`;
    const existing = buckets.get(key);
    const recentHits = existing ? existing.hits.filter((ts) => ts > cutoff) : [];

    if (recentHits.length >= options.maxRequests) {
      const oldest = recentHits[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: options.message });
    }

    recentHits.push(now);
    buckets.set(key, { hits: recentHits });
    next();
  };
}

export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  scope: 'auth',
  message: 'Too many authentication attempts. Please wait a few minutes and try again.'
});

export const adminAuthRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 8,
  scope: 'admin_auth',
  message: 'Too many administrator login attempts. Please wait 15 minutes before retrying.'
});
