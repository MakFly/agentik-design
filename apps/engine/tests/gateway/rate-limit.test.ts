/**
 * Unit tests for the API rate-limit middleware. Uses an in-memory store so they
 * run without Redis or Postgres (no auto-skip needed).
 */
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { MemoryStore, rateLimit } from "../../src/app/middleware/rate-limit";
import type { AuthVars } from "../../src/app/middleware/auth";

function appWithLimit(max: number, windowMs = 60_000) {
  const app = new Hono<{ Variables: AuthVars }>();
  // Pin every request to the same key so the window is shared across calls.
  app.use(
    "*",
    rateLimit({ max, windowMs, store: new MemoryStore(), key: () => "team_x" }),
  );
  app.get("/ping", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit middleware", () => {
  test("allows up to `max` requests then returns 429 with Retry-After", async () => {
    const app = appWithLimit(3);
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/ping");
      expect(res.status).toBe(200);
    }
    const blocked = await app.request("/ping");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    const body = (await blocked.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  test("a fresh window (new store) starts the count over", async () => {
    const app = appWithLimit(1);
    expect((await app.request("/ping")).status).toBe(200);
    expect((await app.request("/ping")).status).toBe(429);
  });
});
