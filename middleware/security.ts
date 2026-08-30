import type { RequestHandler } from "express";

type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  message?: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

/**
 * Lightweight per-process rate limiter for sensitive endpoints.
 * For multi-instance deployments, replace this store with Redis or another
 * shared store so limits apply across every server process.
 */
export function createRateLimiter({
  windowMs,
  maxRequests,
  message = "Too many requests. Please try again later.",
}: RateLimitOptions): RequestHandler {
  const requests = new Map<string, RateLimitEntry>();
  let callsSinceCleanup = 0;

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const existing = requests.get(key);

    callsSinceCleanup += 1;
    if (callsSinceCleanup >= 250) {
      callsSinceCleanup = 0;
      for (const [entryKey, entry] of requests) {
        if (entry.resetAt <= now) {
          requests.delete(entryKey);
        }
      }
    }

    if (!existing || existing.resetAt <= now) {
      requests.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      next();
      return;
    }

    if (existing.count >= maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      );

      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ message });
      return;
    }

    existing.count += 1;
    next();
  };
}
