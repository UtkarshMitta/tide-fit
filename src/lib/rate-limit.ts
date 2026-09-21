/**
 * Minimal per-IP fixed-window rate limiting for the endpoints that cost money.
 *
 * `POST /api/trips` fans out to Open-Meteo, Tavily, Stay22 and an LLM on every
 * call, and `POST /api/voice` bills ElevenLabs per character. Both are
 * unauthenticated by design — a trip is shareable by link and the demo has to
 * work with no sign-in — so without a limiter anyone can drain the host's API
 * budget with a loop.
 *
 * Deliberately in-process: it needs no infrastructure and is the right shape
 * for a single host or a small Vercel deployment. It is NOT a distributed
 * limiter — each serverless instance keeps its own counters, so the effective
 * ceiling is `limit x instances`. For a real production deployment this should
 * move behind a shared store (Upstash, Vercel KV) or the platform's own WAF.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

/** Keeps the map from growing without bound under a spray of distinct IPs. */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
}

export const TRIP_RATE_LIMIT: RateLimitRule = { limit: 10, windowMs: 60_000 };
export const VOICE_RATE_LIMIT: RateLimitRule = { limit: 20, windowMs: 60_000 };

/**
 * Best-effort client identity. Behind Vercel or any sane proxy the leftmost
 * `x-forwarded-for` entry is the real client; it is spoofable when the app is
 * exposed directly, which is another reason this is a budget guard rather than
 * a security control.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets, for the Retry-After header. */
  retryAfter: number;
}

export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      for (const [candidate, window] of buckets) {
        if (window.resetAt <= now) buckets.delete(candidate);
      }
      // Still full of live windows: drop the oldest rather than grow.
      if (buckets.size >= MAX_TRACKED_KEYS) {
        const oldest = buckets.keys().next().value;
        if (oldest) buckets.delete(oldest);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > rule.limit) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/** Shared 429 shape for the routes that use this. */
export function tooManyRequests(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests — give it a minute and try again." }),
    {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(retryAfter) },
    },
  );
}
