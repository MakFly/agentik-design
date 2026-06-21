import { Hono } from "hono";
import { env } from "./env";
import {
  appendMessages,
  claimTask,
  completeTask,
  failTask,
  heartbeat,
  registerDaemon,
  startTask,
  type IncomingMessage,
} from "./daemon-repo";

/**
 * Daemon protocol. Mounted at /daemon, OUTSIDE the x-team middleware: daemons
 * are not browser tenants — they send their team in the register body and
 * authenticate with a shared Bearer token. Never expose this publicly without
 * DAEMON_AUTH_TOKEN set.
 */
export const daemon = new Hono();

daemon.use("*", async (c, next) => {
  if (!env.DAEMON_ENABLED) return c.json({ error: "daemon_disabled" }, 503);
  const token = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!env.DAEMON_AUTH_TOKEN || token !== env.DAEMON_AUTH_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

daemon.post("/register", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    team?: string;
    name?: string;
    meta?: Record<string, unknown>;
    runtimes?: Array<{ kind: string; capabilities?: { maxConcurrent?: number; agentKinds?: string[] } }>;
  } | null;
  if (!body?.team || !body.name || !Array.isArray(body.runtimes) || body.runtimes.length === 0) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const res = await registerDaemon({ team: body.team, name: body.name, meta: body.meta, runtimes: body.runtimes });
  return c.json(res, 201);
});

daemon.post("/heartbeat", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { daemonId?: string } | null;
  if (!body?.daemonId) return c.json({ error: "invalid_body" }, 400);
  const ok = await heartbeat(body.daemonId);
  return c.json({ ok }, ok ? 200 : 404);
});

daemon.post("/runtimes/:id/tasks/claim", async (c) => {
  const task = await claimTask(c.req.param("id"));
  if (!task) return c.body(null, 204);
  return c.json(task);
});

daemon.post("/tasks/:id/start", async (c) => {
  const ok = await startTask(c.req.param("id"));
  return c.json({ ok }, ok ? 200 : 409);
});

daemon.post("/tasks/:id/messages", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { messages?: IncomingMessage[] } | null;
  if (!body || !Array.isArray(body.messages)) return c.json({ error: "invalid_body" }, 400);
  const res = await appendMessages(c.req.param("id"), body.messages);
  return c.json(res);
});

daemon.post("/tasks/:id/complete", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { result?: unknown };
  const ok = await completeTask(c.req.param("id"), body.result);
  return c.json({ ok }, ok ? 200 : 409);
});

daemon.post("/tasks/:id/fail", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { error?: string };
  const ok = await failTask(c.req.param("id"), body.error ?? "unknown error");
  return c.json({ ok }, ok ? 200 : 409);
});
