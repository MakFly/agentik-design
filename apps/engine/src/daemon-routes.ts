import { Hono } from "hono";
import { env } from "./env";
import {
  appendMessages,
  claimTask,
  completeTask,
  failTask,
  getDaemonTeamId,
  getProjectWorkspaceTeamId,
  getRuntimeTeamId,
  getTaskTeamId,
  heartbeat,
  registerDaemon,
  requestDaemonTaskApproval,
  reportProjectWorkspaceStatus,
  startTask,
  updateDaemonMeta,
  type IncomingMessage,
} from "./daemon-repo";
import {
  listUserDaemonOrgs,
  resolveTeamByDaemonToken,
  resolveUserByDaemonToken,
  resolveUserDaemonTeamBySlug,
  userCanRunDaemonForTeam,
} from "./auth-repo";
import {
  claimNextBundleCommand,
  getBundleCommandTeamId,
  reportBundleStatus,
} from "./bundle-repo";

type DaemonAuth =
  | { kind: "org"; teamId: string }
  | { kind: "personal"; userId: string }
  | { kind: "legacy" };
type DaemonVars = { daemonAuth?: DaemonAuth };

/**
 * Daemon protocol. Mounted at /daemon, OUTSIDE the x-team middleware: daemons
 * are not browser tenants. A daemon authenticates with EITHER an org-scoped token
 * (issued at org creation → the engine derives the team server-side, never trusting
 * the request body) OR the shared DAEMON_AUTH_TOKEN (legacy/dev, team from body).
 */
export const daemon = new Hono<{ Variables: DaemonVars }>();

function auth(c: {
  get: (key: "daemonAuth") => DaemonAuth | undefined;
}): DaemonAuth {
  return c.get("daemonAuth") ?? { kind: "legacy" };
}

async function canAccessTeam(a: DaemonAuth, teamId: string): Promise<boolean> {
  if (a.kind === "legacy") return true;
  if (a.kind === "org") return a.teamId === teamId;
  return userCanRunDaemonForTeam(a.userId, teamId);
}

async function resolveRegisterTeam(
  a: DaemonAuth,
  teamSlug?: string,
): Promise<string | null> {
  if (a.kind === "org") return a.teamId;
  if (!teamSlug) return null;
  if (a.kind === "personal")
    return resolveUserDaemonTeamBySlug(a.userId, teamSlug);
  return null;
}

daemon.use("*", async (c, next) => {
  if (!env.DAEMON_ENABLED) return c.json({ error: "daemon_disabled" }, 503);
  const token = (c.req.header("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const orgTeamId = await resolveTeamByDaemonToken(token);
  if (orgTeamId) {
    c.set("daemonAuth", { kind: "org", teamId: orgTeamId });
  } else {
    const userId = await resolveUserByDaemonToken(token);
    if (userId) {
      c.set("daemonAuth", { kind: "personal", userId });
    } else if (!env.DAEMON_AUTH_TOKEN || token !== env.DAEMON_AUTH_TOKEN) {
      return c.json({ error: "unauthorized" }, 401);
    } else {
      c.set("daemonAuth", { kind: "legacy" });
    }
  }
  await next();
});

/** Personal daemon: discover the orgs this user's machine may serve. */
daemon.get("/orgs", async (c) => {
  const a = auth(c);
  if (a.kind !== "personal")
    return c.json({ error: "user_token_required" }, 403);
  const orgs = await listUserDaemonOrgs(a.userId);
  return c.json({ orgs });
});

daemon.post("/register", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    team?: string;
    name?: string;
    meta?: Record<string, unknown>;
    runtimes?: Array<{
      kind: string;
      capabilities?: { maxConcurrent?: number; agentKinds?: string[] };
    }>;
  } | null;
  const a = auth(c);
  if (
    !body?.name ||
    !Array.isArray(body.runtimes) ||
    body.runtimes.length === 0
  ) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const teamId = await resolveRegisterTeam(a, body.team);
  if (!teamId && a.kind !== "legacy")
    return c.json({ error: "forbidden" }, 403);
  if (!teamId && !body.team) return c.json({ error: "invalid_body" }, 400);
  const meta = {
    ...(body.meta ?? {}),
    mode: a.kind,
    ...(a.kind === "personal" ? { userId: a.userId } : {}),
  };
  const res = await registerDaemon({
    teamId: teamId ?? undefined,
    team: body.team,
    name:
      a.kind === "personal" && body.team
        ? `${body.name} · ${body.team}`
        : body.name,
    meta,
    runtimes: body.runtimes,
  });
  return c.json(res, 201);
});

daemon.post("/meta", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    daemonId?: string;
    meta?: Record<string, unknown>;
  } | null;
  if (!body?.daemonId || !body.meta)
    return c.json({ error: "invalid_body" }, 400);
  const teamId = await getDaemonTeamId(body.daemonId);
  if (!teamId) return c.json({ error: "not_found" }, 404);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const ok = await updateDaemonMeta(body.daemonId, body.meta);
  return c.json({ ok }, ok ? 200 : 404);
});

daemon.post("/heartbeat", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    daemonId?: string;
  } | null;
  if (!body?.daemonId) return c.json({ error: "invalid_body" }, 400);
  const teamId = await getDaemonTeamId(body.daemonId);
  if (!teamId) return c.json({ error: "not_found" }, 404);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const ok = await heartbeat(body.daemonId);
  return c.json({ ok }, ok ? 200 : 404);
});

daemon.post("/runtimes/:id/tasks/claim", async (c) => {
  const runtimeId = c.req.param("id");
  const teamId = await getRuntimeTeamId(runtimeId);
  if (!teamId) return c.body(null, 204);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const task = await claimTask(runtimeId);
  if (!task) return c.body(null, 204);
  return c.json(task);
});

daemon.post("/tasks/:id/start", async (c) => {
  const taskId = c.req.param("id");
  const teamId = await getTaskTeamId(taskId);
  if (!teamId) return c.json({ error: "not_found" }, 404);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const ok = await startTask(taskId);
  return c.json({ ok }, ok ? 200 : 409);
});

daemon.post("/tasks/:id/approval/request", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    message?: string;
    context?: Record<string, unknown>;
  };
  const taskId = c.req.param("id");
  const teamId = await getTaskTeamId(taskId);
  if (!teamId) return c.json({ error: "not_found" }, 404);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const ok = await requestDaemonTaskApproval(taskId, {
    message: body.message,
    context: body.context,
  });
  return c.json({ ok }, ok ? 202 : 409);
});

daemon.post("/tasks/:id/messages", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    messages?: IncomingMessage[];
  } | null;
  if (!body || !Array.isArray(body.messages))
    return c.json({ error: "invalid_body" }, 400);
  const taskId = c.req.param("id");
  const teamId = await getTaskTeamId(taskId);
  if (!teamId) return c.json({ error: "not_found" }, 404);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const res = await appendMessages(taskId, body.messages);
  return c.json(res);
});

daemon.post("/tasks/:id/complete", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { result?: unknown };
  const taskId = c.req.param("id");
  const teamId = await getTaskTeamId(taskId);
  if (!teamId) return c.json({ error: "not_found" }, 404);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const ok = await completeTask(taskId, body.result);
  return c.json({ ok }, ok ? 200 : 409);
});

daemon.post("/tasks/:id/fail", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { error?: string };
  const taskId = c.req.param("id");
  const teamId = await getTaskTeamId(taskId);
  if (!teamId) return c.json({ error: "not_found" }, 404);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const ok = await failTask(taskId, body.error ?? "unknown error");
  return c.json({ ok }, ok ? 200 : 409);
});

daemon.post("/project-workspaces/:id/status", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    status?: "pending" | "ready" | "syncing" | "error";
    path?: string;
    error?: string;
    meta?: Record<string, unknown>;
  } | null;
  if (!body || !body.status || !["pending", "ready", "syncing", "error"].includes(body.status)) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const workspaceId = c.req.param("id");
  const teamId = await getProjectWorkspaceTeamId(workspaceId);
  if (!teamId) return c.json({ error: "not_found" }, 404);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const ok = await reportProjectWorkspaceStatus(workspaceId, {
    status: body.status,
    path: body.path,
    error: body.error,
    meta: body.meta,
  });
  return c.json({ ok }, ok ? 200 : 409);
});

/* ── Bundle manager: the daemon polls for and reports install/upgrade commands ── */

daemon.post("/bundles/claim", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    daemonId?: string;
  } | null;
  if (!body?.daemonId) return c.json({ error: "invalid_body" }, 400);
  const teamId = await getDaemonTeamId(body.daemonId);
  if (!teamId) return c.json({ error: "not_found" }, 404);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const cmd = await claimNextBundleCommand(body.daemonId);
  if (!cmd) return c.body(null, 204);
  return c.json(cmd);
});

daemon.post("/bundles/:id/status", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    status?: "done" | "failed";
    result?: string;
    error?: string;
  } | null;
  if (!body || (body.status !== "done" && body.status !== "failed")) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const commandId = c.req.param("id");
  const teamId = await getBundleCommandTeamId(commandId);
  if (!teamId) return c.json({ error: "not_found" }, 404);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const ok = await reportBundleStatus(commandId, {
    status: body.status,
    result: body.result,
    error: body.error,
  });
  return c.json({ ok }, ok ? 200 : 409);
});
