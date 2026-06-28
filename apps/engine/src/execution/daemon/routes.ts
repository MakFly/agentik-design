import { Hono } from "hono";
import { env } from "../../infra/env";
import {
  appendMessages,
  claimTask,
  completeTask,
  failTask,
  requestDaemonTaskApproval,
  startTask,
  type IncomingMessage,
} from "./service";
import {
  getDaemonTeamId,
  getProjectWorkspaceTeamId,
  getRuntimeTeamId,
  getTaskTeamId,
  heartbeat,
  registerDaemon,
  reportProjectWorkspaceStatus,
  updateDaemonMeta,
} from "./repo";
import {
  listUserDaemonOrgs,
  resolveTeamByDaemonToken,
  resolveUserByDaemonToken,
  resolveUserDaemonTeamBySlug,
  userCanRunDaemonForTeam,
} from "../../gateway/auth-repo";
import {
  claimNextBundleCommand,
  getBundleCommandTeamId,
  reportBundleStatus,
} from "../bundle/repo";
import { invokeMcpTool } from "../../domains/mcp/repo";
import {
  buildCodexAuthorizeUrl,
  generateOauthState,
  generatePkce,
} from "../../infra/oauth";
import { connectCodexFromCode } from "../../domains/settings/providers-repo";
import { getRunDetail, listAgentRows } from "../../domains/runs";
import { sendAgentChatTurn } from "../../domains/chat/repo";
import { sendOrchestratedTurn } from "../../domains/chat/orchestrator";

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

/**
 * Server-authoritative identity fields stamped onto a daemon's meta. Applied at BOTH
 * register and meta-refresh so the periodic `/daemon/meta` (which carries only
 * client-probed fields) can never wipe the `userId`/`mode` that personal-daemon
 * offline-marking relies on.
 */
function withDaemonIdentity(
  meta: Record<string, unknown> | undefined,
  a: DaemonAuth,
): Record<string, unknown> {
  return {
    ...(meta ?? {}),
    mode: a.kind,
    ...(a.kind === "personal" ? { userId: a.userId } : {}),
  };
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

async function resolveDaemonTeam(
  a: DaemonAuth,
  teamId?: string,
): Promise<string | null> {
  if (a.kind === "org") return a.teamId;
  if (!teamId) return null;
  if (a.kind === "personal") {
    return (await userCanRunDaemonForTeam(a.userId, teamId)) ? teamId : null;
  }
  return teamId;
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

daemon.post("/agents/list", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { teamId?: string };
  const teamId = await resolveDaemonTeam(auth(c), body.teamId);
  if (!teamId) return c.json({ error: "forbidden" }, 403);
  const agents = await listAgentRows(teamId);
  return c.json({
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      goal: agent.goal,
      health: agent.health,
      runtimeKind: agent.runtimeKind ?? "echo",
      model: agent.model,
      published: Boolean(agent.liveVersionId),
    })),
  });
});

daemon.post("/agents/:id/run", async (c) => {
  const a = auth(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    teamId?: string;
    input?: string;
  };
  const teamId = await resolveDaemonTeam(a, body.teamId);
  if (!teamId) return c.json({ error: "forbidden" }, 403);
  const agentId = c.req.param("id");
  const creatorId =
    a.kind === "personal"
      ? `daemon:user:${a.userId}:team:${teamId}:agent:${agentId}`
      : a.kind === "org"
        ? `daemon:org:${teamId}:agent:${agentId}`
        : `daemon:legacy:${teamId}:agent:${agentId}`;
  const res = await sendAgentChatTurn(teamId, {
    agentId,
    content: body.input ?? "",
    creatorId,
    title: "Agentik TUI",
  });
  if ("error" in res) return c.json(res, res.error === "no_live_daemon" ? 503 : 409);
  return c.json(res, 202);
});

daemon.post("/orchestrator/turn", async (c) => {
  const a = auth(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    teamId?: string;
    input?: string;
    agentHintId?: string | null;
    threadKey?: string;
  };
  const teamId = await resolveDaemonTeam(a, body.teamId);
  if (!teamId) return c.json({ error: "forbidden" }, 403);
  const actorId =
    a.kind === "personal"
      ? `user:${a.userId}`
      : a.kind === "org"
        ? `org:${teamId}`
        : `legacy:${teamId}`;
  const routed = await sendOrchestratedTurn({
    teamId,
    surface: "tui",
    actorId,
    threadKey: body.threadKey || actorId,
    text: body.input ?? "",
    agentHintId: body.agentHintId ?? null,
  });
  if (routed.kind === "error")
    return c.json(routed, routed.error === "no_live_daemon" ? 503 : 409);
  return c.json(routed, routed.kind === "run" ? 202 : 200);
});

/* ── Codex (ChatGPT) subscription OAuth — loopback flow run by the daemon ──
 * The daemon binds a loopback port on a machine with a browser, captures the
 * authorization code, and relays it here. Anthropic/OpenAI only allow loopback
 * redirect URIs for these CLI client ids, so the engine cannot host the callback. */
daemon.post("/oauth/codex/start", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    teamId?: string;
    redirectUri?: string;
  };
  const teamId = await resolveDaemonTeam(auth(c), body.teamId);
  if (!teamId) return c.json({ error: "forbidden" }, 403);
  if (!body.redirectUri) return c.json({ error: "invalid_body" }, 400);
  const pkce = generatePkce();
  const state = generateOauthState();
  const authorizeUrl = buildCodexAuthorizeUrl({
    redirectUri: body.redirectUri,
    pkce,
    state,
  });
  // The daemon holds state + verifier locally and checks state on the callback.
  return c.json({ authorizeUrl, state, codeVerifier: pkce.codeVerifier });
});

daemon.post("/oauth/codex/exchange", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    teamId?: string;
    code?: string;
    redirectUri?: string;
    codeVerifier?: string;
  };
  const teamId = await resolveDaemonTeam(auth(c), body.teamId);
  if (!teamId) return c.json({ error: "forbidden" }, 403);
  if (!body.code || !body.redirectUri || !body.codeVerifier) {
    return c.json({ error: "invalid_body" }, 400);
  }
  try {
    const res = await connectCodexFromCode({
      teamId,
      code: body.code,
      redirectUri: body.redirectUri,
      codeVerifier: body.codeVerifier,
    });
    return c.json(res);
  } catch (err) {
    return c.json({ error: "exchange_failed", detail: String(err) }, 502);
  }
});

daemon.post("/runs/:id/detail", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { teamId?: string };
  const teamId = await resolveDaemonTeam(auth(c), body.teamId);
  if (!teamId) return c.json({ error: "forbidden" }, 403);
  const detail = await getRunDetail(teamId, c.req.param("id"));
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

daemon.post("/register", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    team?: string;
    name?: string;
    legacyIds?: string[];
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
  const meta = withDaemonIdentity(body.meta, a);
  // Personal daemons display as `<id> · <team>`; apply the same suffix to any
  // legacy ids so the engine can adopt a row this machine registered under an
  // older identity (hostname) instead of creating a duplicate.
  const displayName = (raw: string) =>
    a.kind === "personal" && body.team ? `${raw} · ${body.team}` : raw;
  const legacyNames = (
    Array.isArray(body.legacyIds) ? body.legacyIds : []
  )
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .map(displayName);
  const res = await registerDaemon({
    teamId: teamId ?? undefined,
    team: body.team,
    name: displayName(body.name),
    legacyNames,
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
  const ok = await updateDaemonMeta(
    body.daemonId,
    withDaemonIdentity(body.meta, auth(c)),
  );
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

daemon.post("/tasks/:id/tools/invoke", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    toolId?: string;
    arguments?: Record<string, unknown>;
  } | null;
  if (!body?.toolId) return c.json({ error: "invalid_body" }, 400);
  const taskId = c.req.param("id");
  const teamId = await getTaskTeamId(taskId);
  if (!teamId) return c.json({ error: "not_found" }, 404);
  if (!(await canAccessTeam(auth(c), teamId)))
    return c.json({ error: "forbidden" }, 403);
  const result = await invokeMcpTool(teamId, {
    toolId: body.toolId,
    arguments: body.arguments ?? {},
    runId: taskId,
  });
  if ("error" in result) {
    const status =
      result.error === "tool_not_granted"
        ? 403
        : result.error === "tool_not_found"
          ? 404
          : 502;
    return c.json(result, status);
  }
  return c.json(result);
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
