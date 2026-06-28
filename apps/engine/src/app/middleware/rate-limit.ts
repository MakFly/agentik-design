import type { Context, MiddlewareHandler } from "hono";
import type IORedis from "ioredis";
import { connection } from "../../infra/queue";
import type { AuthVars } from "./auth";

/**
 * Fixed-window rate limiting for the authenticated API. Redis-backed so the limit
 * holds across engine replicas; falls back to an in-process window when Redis is
 * unreachable so a Redis blip degrades to local limiting instead of failing open.
 *
 * Keyed per team (post-auth) so one tenant can't saturate the shared control plane
 * for the others. The daemon endpoints (/daemon: heartbeat/claim) and /health are
 * mounted outside this group and intentionally NOT limited.
 */
export interface HitResult {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<HitResult>;
}

/** In-process fixed-window counter. Used as the Redis fallback and in tests. */
export class MemoryStore implements RateLimitStore {
  private windows = new Map<string, HitResult>();
  async hit(key: string, windowMs: number): Promise<HitResult> {
    const now = Date.now();
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, entry);
    }
    entry.count += 1;
    return entry;
  }
}

/** Redis fixed-window counter (INCR + PEXPIRE on the window bucket), with a
 *  local-memory fallback if the Redis round-trip throws. */
class ResilientStore implements RateLimitStore {
  private memory = new MemoryStore();
  constructor(private redis: IORedis) {}
  async hit(key: string, windowMs: number): Promise<HitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetAt = windowStart + windowMs;
    try {
      const redisKey = `rl:${windowStart}:${key}`;
      const count = await this.redis.incr(redisKey);
      if (count === 1) await this.redis.pexpire(redisKey, windowMs);
      return { count, resetAt };
    } catch {
      return this.memory.hit(key, windowMs);
    }
  }
}

let sharedStore: RateLimitStore | null = null;
function defaultStore(): RateLimitStore {
  // Reuse the BullMQ Redis connection (typed as ConnectionOptions there for the
  // dual-ioredis clash); it is an IORedis instance at runtime.
  if (!sharedStore) sharedStore = new ResilientStore(connection as unknown as IORedis);
  return sharedStore;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Throttle key extractor; defaults to teamId, then forwarded IP, then "anon". */
  key?: (c: Context<{ Variables: AuthVars }>) => string;
  /** Override the backing store (tests inject a MemoryStore). */
  store?: RateLimitStore;
}

export function rateLimit(
  opts: RateLimitOptions,
): MiddlewareHandler<{ Variables: AuthVars }> {
  const store = opts.store ?? defaultStore();
  const keyOf =
    opts.key ??
    ((c: Context<{ Variables: AuthVars }>) =>
      c.get("teamId") || c.req.header("x-forwarded-for") || "anon");
  return async (c, next) => {
    const { count, resetAt } = await store.hit(keyOf(c), opts.windowMs);
    if (count > opts.max) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "rate_limited", retryAfter }, 429);
    }
    await next();
  };
}
