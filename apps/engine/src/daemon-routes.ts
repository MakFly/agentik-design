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
  updateDaemonMeta,
  type IncomingMessage,
} from "./daemon-repo";
import { resolveTeamByDaemonToken } from "./auth-repo";
import { claimNextBundleCommand, reportBundleStatus } from "./bundle-repo";

type DaemonVars = { daemonTeamId?: string };

/**
 * Daemon protocol. Mounted at /daemon, OUTSIDE the x-team middleware: daemons
 * are not browser tenants. A daemon authenticates with EITHER an org-scoped token
 * (issued at org creation → the engine derives the team server-side, never trusting
 * the request body) OR the shared DAEMON_AUTH_TOKEN (legacy/dev, team from body).
 */
export const daemon = new Hono<{ Variables: DaemonVars }>();

daemon.use("*", async (c, next) => {
  if (!env.DAEMON_ENABLED) return c.json({ error: "daemon_disabled" }, 503);
  const token = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const orgTeamId = await resolveTeamByDaemonToken(token);
  if (orgTeamId) {
    c.set("daemonTeamId", orgTeamId); // tenancy derived server-side from the org token
  } else if (!env.DAEMON_AUTH_TOKEN || token !== env.DAEMON_AUTH_TOKEN) {
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
  const daemonTeamId = c.get("daemonTeamId");
  if (!body?.name || !Array.isArray(body.runtimes) || body.runtimes.length === 0) {
    return c.json({ error: "invalid_body" }, 400);
  }
  // Org-token path derives the team server-side; legacy shared-token path uses the body slug.
  if (!daemonTeamId && !body.team) return c.json({ error: "invalid_body" }, 400);
  const res = await registerDaemon({
    teamId: daemonTeamId,
    team: body.team,
    name: body.name,
    meta: body.meta,
    runtimes: body.runtimes,
  });
  return c.json(res, 201);
});

daemon.post("/meta", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { daemonId?: string; meta?: Record<string, unknown> } | null;
  if (!body?.daemonId || !body.meta) return c.json({ error: "invalid_body" }, 400);
  const ok = await updateDaemonMeta(body.daemonId, body.meta);
  return c.json({ ok }, ok ? 200 : 404);
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

/* ── Bundle manager: the daemon polls for and reports install/upgrade commands ── */

daemon.post("/bundles/claim", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { daemonId?: string } | null;
  if (!body?.daemonId) return c.json({ error: "invalid_body" }, 400);
  const cmd = await claimNextBundleCommand(body.daemonId);
  if (!cmd) return c.body(null, 204);
  return c.json(cmd);
});

daemon.post("/bundles/:id/status", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { status?: "done" | "failed"; result?: string; error?: string }
    | null;
  if (!body || (body.status !== "done" && body.status !== "failed")) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const ok = await reportBundleStatus(c.req.param("id"), { status: body.status, result: body.result, error: body.error });
  return c.json({ ok }, ok ? 200 : 409);
});
