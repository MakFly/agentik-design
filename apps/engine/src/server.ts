import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  createCredentialInput,
  createWorkflowInput,
  runWorkflowInput,
  saveVersionInput,
} from "@agentik/workflow-schema";
import {
  createCredential,
  createRun,
  createWorkflow,
  deleteCredential,
  getCredentialDecrypted,
  getRun,
  getWorkflow,
  listCredentials,
  listWorkflows,
  saveVersion,
  setCredentialData,
} from "./repo";
import { encryptJson, decryptJson } from "./crypto";
import { buildGoogleAuthUrl, exchangeGoogleCode } from "./oauth";
import { env } from "./env";
import { enqueueRun } from "./queue";
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  sendChatMessage,
} from "./chat-repo";
import {
  agentTaskMessageToEvents,
  contractEventForStatus,
  contractEventForTaskMessage,
  approveAgentTask,
  cancelAgentTask,
  pauseAgentTask,
  rejectAgentTask,
  retryAgentTask,
  createAgent,
  createTestTask,
  getAgentTaskName,
  getAgentTaskStatus,
  deleteAgent,
  getAgentTaskSnapshot,
  getAgentRow,
  getRunUnified,
  getSystemInfo,
  listAgentRows,
  listRunsUnion,
  listTaskMessagesAfter,
  publishAgent,
  requestAgentTaskApproval,
  resumeAgentTask,
  runAgent,
  workflowDetailToWeb,
  type LiveRunEvent,
  type OrchestratorRunEvent,
} from "./agents-repo";
import type { SSEStreamingApi } from "hono/streaming";
import { daemon } from "./daemon-routes";
import { deleteDaemon } from "./daemon-repo";
import {
  listProviderKeys,
  setProviderKey,
  deleteProviderKey,
  isSupportedProvider,
} from "./providers-repo";
import {
  enqueueBundleCommand,
  getNetworkInstallEnabled,
  listBundleCommands,
  setNetworkInstallEnabled,
} from "./bundle-repo";
import {
  addProjectResource,
  addProjectTaskComment,
  createProject,
  createProjectTask,
  getProject,
  listProjectTaskComments,
  listProjects,
  runProjectTask,
  updateProjectTask,
} from "./projects-repo";
import {
  createTelegramConnection,
  deleteChannelConnection,
  handleTelegramWebhookSecret,
  listChannelConnections,
  registerTelegramWebhook,
  useTelegramPolling,
} from "./channels-repo";
import {
  getUserDaemonTokenStatus,
  listUserDaemonOrgs,
  markUserPersonalDaemonsOffline,
  revokeUserDaemonToken,
  rotateUserDaemonToken,
} from "./auth-repo";
import type { BundleAction } from "./db/schema";
import { auth } from "./auth-routes";
import { withAuth, requirePermission, type AuthVars } from "./auth";
import { createAgentVersionInput } from "@agentik/workflow-schema";
import {
  applyRunReview,
  archiveMemory,
  createMemory,
  createAgentVersion,
  generateRunReview,
  getRunReview,
  getRunReviewByRunId,
  listAgentVersions,
  listMemoryEvents,
  listMemory,
  listRunReviews,
  listSkills,
  listSkillVersions,
  resolveMemoryInjectionPreview,
  reviewChangeIds,
  restoreMemory,
  searchChatMemory,
  setRunReviewStatus,
  updateMemory,
} from "./learning-repo";
import type { KnowledgeScope, RunReviewStatus } from "@agentik/workflow-schema";
import { listTraces, getTrace } from "./observability-repo";
import {
  getEnvironmentSettings,
  getProvidersSettings,
  getWorkspaceSettings,
  inviteTeamMember,
  listTeamInvitations,
  listTeamMembers,
  removeTeamMember,
  revokeTeamInvitation,
  testProviderConnection,
  updateEnvironmentSettings,
  updateProviderConfig,
  updateProvidersPolicy,
  updateTeamMemberRole,
  updateWorkspaceSettings,
} from "./settings-repo";
import {
  environmentBody,
  inviteMemberBody,
  memberRoleBody,
  providerKeyBody,
  providerPatchBody,
  providersPolicyBody,
  workspaceBody,
} from "./settings-schemas";
import {
  createMcpServerBody,
  invokeToolBody,
  updateMcpServerBody,
} from "./mcp-schemas";
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  invokeMcpTool,
  listMcpServers,
  listToolCatalog,
  syncMcpServer,
  testMcpServer,
  updateMcpServer,
} from "./mcp-repo";
import { jsonValidationError, parseJsonBody } from "./validation";

type Vars = AuthVars;

const app = new Hono<{ Variables: Vars }>();

app.use("*", cors());

app.get("/api/v1/health", (c) => c.json({ ok: true, service: "engine" }));

const api = new Hono<{ Variables: Vars }>();

/** Annotate a run review's proposals with stable changeIds for per-change approval. */
function withChangeIds(
  review: {
    proposedMemories: unknown[];
    proposedSkillChanges: unknown[];
  } & Record<string, unknown>,
) {
  return {
    ...review,
    proposedMemories: review.proposedMemories.map((m, i) => ({
      changeId: `m${i}`,
      ...(m as object),
    })),
    proposedSkillChanges: review.proposedSkillChanges.map((s, i) => ({
      changeId: `s${i}`,
      ...(s as object),
    })),
    changeIds: reviewChangeIds(review as never),
  };
}

/**
 * Tenancy + auth: derive org/role server-side (Phase 0 seam — swap `resolveAuth` for a
 * better-auth session later without touching routes). Keeps `teamId` for existing routes.
 */
api.use("*", withAuth);

api.get("/workflows", async (c) => {
  const items = await listWorkflows(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

api.post("/workflows", async (c) => {
  const parsed = createWorkflowInput.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const wf = await createWorkflow(c.get("teamId"), parsed.data);
  return c.json(wf, 201);
});

api.get("/workflows/:id", async (c) => {
  const wf = await getWorkflow(c.get("teamId"), c.req.param("id"));
  if (!wf) return c.json({ error: "not_found" }, 404);
  return c.json(wf);
});

api.put("/workflows/:id/versions", async (c) => {
  const parsed = saveVersionInput.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const wf = await saveVersion(c.get("teamId"), c.req.param("id"), parsed.data);
  if (!wf) return c.json({ error: "not_found" }, 404);
  return c.json(wf);
});

api.post("/workflows/:id/run", async (c) => {
  const parsed = runWorkflowInput.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!parsed.success)
    return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const result = await createRun(
    c.get("teamId"),
    c.req.param("id"),
    "manual",
    parsed.data.payload,
  );
  if ("error" in result) {
    return c.json(
      { error: result.error },
      result.error === "not_found" ? 404 : 409,
    );
  }
  await enqueueRun(result.runId);
  const run = await getRun(result.runId);
  return c.json(run, 202);
});

api.get("/credentials", async (c) => {
  const items = await listCredentials(c.get("teamId"));
  return c.json({ items, total: items.length });
});

api.post("/credentials", async (c) => {
  const parsed = createCredentialInput.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const cred = await createCredential(c.get("teamId"), parsed.data);
  return c.json(cred, 201);
});

api.delete("/credentials/:id", async (c) => {
  const ok = await deleteCredential(c.get("teamId"), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/* ─────────────────────────── OAuth2 (Google) ─────────────────────────── */

function oauthResultHtml(ok: boolean, message?: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${ok ? "Connected" : "Failed"}</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100dvh;margin:0;background:#0b0f17;color:#e5e7eb">
<div style="text-align:center">
  <h1 style="font-size:1.2rem">${ok ? "✅ Google connected" : "❌ Connection failed"}</h1>
  <p style="color:#9ca3af">${ok ? "You can close this window." : (message ?? "Unknown error")}</p>
</div>
<script>try{window.opener&&window.opener.postMessage({type:"oauth",ok:${ok}},"*")}catch(e){}; setTimeout(()=>window.close(),1200);</script>
</body>`;
}

/** Start the Google consent flow for a googleOAuth2 credential. */
api.get("/credentials/:id/authorize", async (c) => {
  const cred = await getCredentialDecrypted(c.get("teamId"), c.req.param("id"));
  if (!cred) return c.json({ error: "not_found" }, 404);
  if (cred.row.type !== "googleOAuth2")
    return c.json({ error: "not_oauth_credential" }, 400);
  const clientId = cred.data.clientId || env.GOOGLE_CLIENT_ID || "";
  if (!clientId)
    return c.html(
      oauthResultHtml(false, "No Google client id (set GOOGLE_CLIENT_ID)."),
    );
  const state = encryptJson({ id: cred.row.id });
  return c.redirect(
    buildGoogleAuthUrl({ clientId, scope: cred.data.scope ?? "", state }),
  );
});

/** OAuth redirect target — exchange the code and store tokens on the credential. */
api.get("/oauth/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state)
    return c.html(oauthResultHtml(false, "Missing code or state."));

  let id: string;
  try {
    id = decryptJson<{ id: string }>(state).id;
  } catch {
    return c.html(oauthResultHtml(false, "Invalid state."));
  }

  const cred = await getCredentialDecrypted(c.get("teamId"), id);
  if (!cred) return c.html(oauthResultHtml(false, "Credential not found."));

  try {
    const tokens = await exchangeGoogleCode({
      code,
      clientId: cred.data.clientId || env.GOOGLE_CLIENT_ID || "",
      clientSecret: cred.data.clientSecret || env.GOOGLE_CLIENT_SECRET || "",
    });
    const data: Record<string, string> = {
      ...cred.data,
      access_token: tokens.access_token,
      expires_at: String(Date.now() + tokens.expires_in * 1000),
      token_type: tokens.token_type ?? "Bearer",
      scope: tokens.scope ?? cred.data.scope ?? "",
    };
    if (tokens.refresh_token) data.refresh_token = tokens.refresh_token;
    await setCredentialData(c.get("teamId"), id, data);
    return c.html(oauthResultHtml(true));
  } catch (e) {
    return c.html(
      oauthResultHtml(
        false,
        e instanceof Error ? e.message : "Token exchange failed.",
      ),
    );
  }
});

/* ─────────────────────────── Agents (harness) ────────────────────────── */

api.get("/agents", async (c) => {
  const items = await listAgentRows(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

api.get("/agents/:id", async (c) => {
  const agent = await getAgentRow(c.get("teamId"), c.req.param("id"));
  if (!agent) return c.json({ error: "not_found" }, 404);
  return c.json(agent);
});

api.delete("/agents/:id", requirePermission("agent:delete"), async (c) => {
  const ok = await deleteAgent(c.get("teamId"), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

api.get("/agent-task-snapshot", async (c) => {
  return c.json(await getAgentTaskSnapshot(c.get("teamId")));
});

/* ── Project/task cockpit ───────────────────────────────────────────── */

api.get("/projects", requirePermission("run:read"), async (c) => {
  const items = await listProjects(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

api.post("/projects", requirePermission("run:run"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    type?: unknown;
    description?: string;
    leadAgentId?: string | null;
  };
  const res = await createProject(c.get("teamId"), c.get("auth").userId, body);
  if ("error" in res) return c.json({ error: res.error }, 400);
  return c.json(res.project, 201);
});

api.get("/projects/:id", requirePermission("run:read"), async (c) => {
  const res = await getProject(c.get("teamId"), c.req.param("id"));
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json(res);
});

api.post("/projects/:id/resources", requirePermission("run:run"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    type?: unknown;
    ref?: string;
    label?: string;
    meta?: Record<string, unknown>;
  };
  const res = await addProjectResource(
    c.get("teamId"),
    c.req.param("id"),
    body,
  );
  if ("error" in res)
    return c.json(
      { error: res.error },
      res.error === "project_not_found" ? 404 : 400,
    );
  return c.json(res.resource, 201);
});

api.post("/projects/:id/tasks", requirePermission("run:run"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    priority?: unknown;
    assignedAgentId?: string | null;
    status?: unknown;
  };
  const res = await createProjectTask(
    c.get("teamId"),
    c.req.param("id"),
    c.get("auth").userId,
    body,
  );
  if ("error" in res)
    return c.json(
      { error: res.error },
      res.error === "project_not_found" ? 404 : 400,
    );
  return c.json(res.task, 201);
});

api.patch("/project-tasks/:id", requirePermission("run:control"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    status?: unknown;
    assignedAgentId?: string | null;
    title?: string;
    description?: string;
    priority?: unknown;
  };
  const task = await updateProjectTask(
    c.get("teamId"),
    c.req.param("id"),
    body,
  );
  if (!task) return c.json({ error: "not_found" }, 404);
  return c.json(task);
});

api.get(
  "/project-tasks/:id/comments",
  requirePermission("run:read"),
  async (c) => {
    const items = await listProjectTaskComments(
      c.get("teamId"),
      c.req.param("id"),
    );
    return c.json({ items, total: items.length });
  },
);

api.post(
  "/project-tasks/:id/comments",
  requirePermission("run:run"),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { content?: string };
    const res = await addProjectTaskComment(
      c.get("teamId"),
      c.req.param("id"),
      c.get("auth").userId,
      body.content ?? "",
    );
    if ("error" in res)
      return c.json(
        { error: res.error },
        res.error === "task_not_found" ? 404 : 400,
      );
    return c.json(res.comment, 201);
  },
);

api.post("/project-tasks/:id/run", requirePermission("run:run"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    instruction?: string;
  };
  const res = await runProjectTask(
    c.get("teamId"),
    c.req.param("id"),
    body.instruction,
  );
  if ("error" in res) {
    const error = res.error ?? "unknown_error";
    const status =
      error.endsWith("_not_found") || error === "task_not_found" ? 404 : 409;
    return c.json({ error }, status);
  }
  return c.json(res, 202);
});

/* ── Channels (OpenClaw-style remote control) ───────────────────────── */

api.get("/channels", requirePermission("settings:read"), async (c) => {
  const items = await listChannelConnections(c.get("teamId"));
  return c.json({ items, total: items.length });
});

api.post(
  "/channels/telegram",
  requirePermission("settings:update"),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      label?: string;
      botToken?: string;
    };
    const result = await createTelegramConnection(
      c.get("teamId"),
      c.get("auth").userId,
      body,
    );
    if ("error" in result) return c.json(result, 422);
    return c.json(result.connection, 201);
  },
);

api.delete("/channels/:id", requirePermission("settings:update"), async (c) => {
  const ok = await deleteChannelConnection(c.get("teamId"), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

api.post(
  "/channels/:id/webhook",
  requirePermission("settings:update"),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { baseUrl?: string };
    const baseUrl = body.baseUrl?.trim() || env.ENGINE_PUBLIC_URL;
    const result = await registerTelegramWebhook(
      c.get("teamId"),
      c.req.param("id"),
      baseUrl,
    );
    if (!result.ok)
      return c.json(
        result,
        result.error === "connection_not_found" ? 404 : 422,
      );
    return c.json(result);
  },
);

api.post(
  "/channels/:id/polling",
  requirePermission("settings:update"),
  async (c) => {
    const result = await useTelegramPolling(c.get("teamId"), c.req.param("id"));
    if (!result.ok)
      return c.json(
        result,
        result.error === "connection_not_found" ? 404 : 422,
      );
    return c.json(result);
  },
);

/** System view: daemons, runtimes, detected CLIs, provider key presence. */
api.get("/system", async (c) => {
  const info = await getSystemInfo(c.get("teamId"));
  return c.json({
    daemonEnabled: env.DAEMON_ENABLED,
    providers: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(env.OPENAI_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      google: Boolean(env.GOOGLE_CLIENT_ID),
    },
    ...info,
  });
});

/** Forget a daemon from this workspace (e.g. a stale or duplicate machine). */
api.delete("/daemons/:id", requirePermission("settings:update"), async (c) => {
  const res = await deleteDaemon(c.get("teamId"), c.req.param("id"));
  if (res.ok) return c.json({ ok: true });
  const status = res.reason === "not_found" ? 404 : 409;
  return c.json({ ok: false, reason: res.reason }, status);
});

/** A user's personal daemon token status. The token itself is never returned here. */
api.get("/me/daemon-token", async (c) => {
  const [status, orgs] = await Promise.all([
    getUserDaemonTokenStatus(c.get("auth").userId),
    listUserDaemonOrgs(c.get("auth").userId),
  ]);
  if (!status) return c.json({ error: "not_found" }, 404);
  return c.json({ ...status, eligibleOrgs: orgs });
});

/** Rotate and reveal a personal daemon token once, for copy/paste into the daemon. */
api.post("/me/daemon-token/rotate", async (c) => {
  const [rotated, orgs] = await Promise.all([
    rotateUserDaemonToken(c.get("auth").userId),
    listUserDaemonOrgs(c.get("auth").userId),
  ]);
  if (!rotated) return c.json({ error: "not_found" }, 404);
  return c.json({ ...rotated, eligibleOrgs: orgs }, 201);
});

api.delete("/me/daemon-token", async (c) => {
  await revokeUserDaemonToken(c.get("auth").userId);
  return c.json({ ok: true });
});

api.post("/me/daemon-token/offline", async (c) => {
  const count = await markUserPersonalDaemonsOffline(c.get("auth").userId);
  return c.json({ ok: true, count });
});

/* ── Bundle manager: install/upgrade agent CLIs on a daemon host (owner-gated) ── */

const BUNDLE_ACTIONS: BundleAction[] = ["install", "upgrade", "uninstall"];

api.get("/bundles", requirePermission("settings:read"), async (c) => {
  const teamId = c.get("teamId");
  const [networkInstall, items] = await Promise.all([
    getNetworkInstallEnabled(teamId),
    listBundleCommands(teamId),
  ]);
  return c.json({ policy: { networkInstall }, items });
});

api.put("/bundles/policy", requirePermission("settings:update"), async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    networkInstall?: unknown;
  } | null;
  if (typeof body?.networkInstall !== "boolean")
    return c.json({ error: "invalid_body" }, 400);
  await setNetworkInstallEnabled(c.get("teamId"), body.networkInstall);
  return c.json({ networkInstall: body.networkInstall });
});

api.post("/bundles", requirePermission("settings:update"), async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    daemonId?: string;
    kind?: string;
    action?: BundleAction;
  } | null;
  if (
    !body?.daemonId ||
    !body.kind ||
    !body.action ||
    !BUNDLE_ACTIONS.includes(body.action)
  ) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const res = await enqueueBundleCommand(c.get("teamId"), {
    daemonId: body.daemonId,
    kind: body.kind,
    action: body.action,
    requestedBy: c.get("auth").userId,
  });
  if (!res.ok) {
    const status =
      res.error === "daemon_not_found"
        ? 404
        : res.error === "network_install_disabled"
          ? 403
          : 409;
    return c.json({ error: res.error }, status);
  }
  return c.json(res.command, 202);
});

api.get("/mcp-servers", requirePermission("settings:read"), async (c) => {
  const items = await listMcpServers(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

api.post("/mcp-servers", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(
    createMcpServerBody,
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const server = await createMcpServer(c.get("teamId"), parsed.data);
  return c.json(server, 201);
});

api.get("/mcp-servers/:id", requirePermission("settings:read"), async (c) => {
  const server = await getMcpServer(c.get("teamId"), c.req.param("id"));
  if (!server) return c.json({ error: "not_found" }, 404);
  return c.json(server);
});

api.patch(
  "/mcp-servers/:id",
  requirePermission("settings:update"),
  async (c) => {
    const parsed = parseJsonBody(
      updateMcpServerBody,
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    const server = await updateMcpServer(
      c.get("teamId"),
      c.req.param("id"),
      parsed.data,
    );
    if (!server) return c.json({ error: "not_found" }, 404);
    return c.json(server);
  },
);

api.delete(
  "/mcp-servers/:id",
  requirePermission("settings:update"),
  async (c) => {
    const ok = await deleteMcpServer(c.get("teamId"), c.req.param("id"));
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  },
);

api.post(
  "/mcp-servers/:id/test",
  requirePermission("settings:update"),
  async (c) => {
    const result = await testMcpServer(c.get("teamId"), c.req.param("id"));
    if (!result) return c.json({ error: "not_found" }, 404);
    return c.json(result, result.ok ? 200 : 409);
  },
);

api.post(
  "/mcp-servers/:id/sync",
  requirePermission("settings:update"),
  async (c) => {
    const result = await syncMcpServer(c.get("teamId"), c.req.param("id"));
    if (!result) return c.json({ error: "not_found" }, 404);
    if ("error" in result) return c.json(result, 409);
    return c.json(result);
  },
);

api.get("/tools/catalog", requirePermission("agent:read"), async (c) => {
  const items = await listToolCatalog(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

api.post("/tools/invoke", requirePermission("run:run"), async (c) => {
  const parsed = parseJsonBody(
    invokeToolBody,
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const result = await invokeMcpTool(c.get("teamId"), parsed.data);
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

api.post("/agents", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    name?: string;
    role?: string;
    goal?: string;
    tags?: string[];
  } | null;
  if (!body?.name) return c.json({ error: "invalid_body" }, 400);
  const res = await createAgent(c.get("teamId"), {
    name: body.name,
    role: body.role,
    goal: body.goal,
    tags: body.tags,
  });
  return c.json(res, 201);
});

api.post("/agents/:id/publish", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    config?: unknown;
    changelog?: string;
  };
  const res = await publishAgent(
    c.get("teamId"),
    c.req.param("id"),
    body.config,
    body.changelog,
  );
  if (!res) return c.json({ error: "not_found" }, 404);
  if ("error" in res) {
    return c.json({ error: res.error }, res.error === "daemon_not_found" ? 404 : 409);
  }
  return c.json(res);
});

api.post("/agents/:id/run", requirePermission("run:run"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { input?: string };
  const res = await runAgent(
    c.get("teamId"),
    c.req.param("id"),
    body.input ?? "",
  );
  if (!res) return c.json({ error: "not_found" }, 404);
  if ("error" in res) return c.json(res, 409);
  return c.json(res, 202);
});

api.post("/agents/test", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    config?: unknown;
    input?: string;
    runtime?: string;
  };
  const res = await createTestTask(
    c.get("teamId"),
    body.config,
    body.input ?? "",
    body.runtime ?? "echo",
  );
  return c.json(res, 202);
});

/* ── Agent versions (formalize publish) ──────────────────────────────── */

api.post(
  "/agents/:id/versions",
  requirePermission("agent:create"),
  async (c) => {
    const parsed = createAgentVersionInput.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success)
      return c.json(
        { error: "invalid_body", detail: parsed.error.issues },
        400,
      );
    const res = await createAgentVersion(
      c.get("teamId"),
      c.req.param("id"),
      parsed.data,
    );
    if (!res) return c.json({ error: "not_found" }, 404);
    return c.json(res, 201);
  },
);

api.get("/agents/:id/versions", requirePermission("agent:read"), async (c) => {
  const items = await listAgentVersions(c.get("teamId"), c.req.param("id"));
  return c.json({ items, total: items.length });
});

/* ── Run reviews (runId = agent_tasks.id) — the learning loop ─────────── */

api.post("/runs/:id/review", requirePermission("run:run"), async (c) => {
  const existing = await getRunReviewByRunId(
    c.get("teamId"),
    c.req.param("id"),
  );
  if (existing) return c.json(withChangeIds(existing));
  const review = await generateRunReview(c.get("teamId"), c.req.param("id"));
  if (!review) return c.json({ error: "not_found" }, 404);
  return c.json(withChangeIds(review), 201);
});

api.get("/runs/:id/review", requirePermission("review:read"), async (c) => {
  const review = await getRunReviewByRunId(c.get("teamId"), c.req.param("id"));
  if (!review) return c.json({ error: "not_found" }, 404);
  return c.json(withChangeIds(review));
});

api.get("/run-reviews", requirePermission("review:read"), async (c) => {
  const status = c.req.query("status") as RunReviewStatus | undefined;
  const rows = await listRunReviews(c.get("teamId"), status);
  return c.json({ items: rows.map(withChangeIds), total: rows.length });
});

api.post(
  "/run-reviews/:id/approve",
  requirePermission("review:approve"),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      changeIds?: string[];
    };
    const res = await applyRunReview(
      c.get("teamId"),
      c.req.param("id"),
      body.changeIds,
    );
    if (!res) return c.json({ error: "not_found" }, 404);
    return c.json({ status: "applied", ...res });
  },
);

api.post(
  "/run-reviews/:id/reject",
  requirePermission("review:approve"),
  async (c) => {
    const ok = await setRunReviewStatus(
      c.get("teamId"),
      c.req.param("id"),
      "rejected",
    );
    return c.json({ status: "rejected", ok }, ok ? 200 : 404);
  },
);

/* ── Memory & skills (read for UI + injection; writes only via approval) ─ */

api.get("/memory", requirePermission("memory:read"), async (c) => {
  const items = await listMemory(c.get("teamId"), {
    scope: (c.req.query("scope") as never) || undefined,
    targetId: c.req.query("targetId") ?? undefined,
    createdBy: (c.req.query("createdBy") as never) || undefined,
    q: c.req.query("q") ?? undefined,
    includeArchived: c.req.query("includeArchived") === "true",
    limit: Number(c.req.query("limit") ?? 200),
  });
  return c.json({ items, total: items.length });
});

api.post("/memory", requirePermission("memory:create"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    scope?: KnowledgeScope;
    targetId?: string | null;
    content?: string;
    confidence?: number;
  };
  const res = await createMemory({
    teamId: c.get("teamId"),
    scope: body.scope ?? "team",
    targetId: body.targetId ?? null,
    content: body.content ?? "",
    confidence: body.confidence,
    actorId: c.get("auth").userId,
    createdBy: "user",
  });
  if ("error" in res) return c.json(res, res.error === "target_not_found" ? 404 : 400);
  return c.json(res.memory, 201);
});

api.patch("/memory/:id", requirePermission("memory:update"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    scope?: KnowledgeScope;
    targetId?: string | null;
    content?: string;
    confidence?: number;
  };
  const res = await updateMemory({
    teamId: c.get("teamId"),
    memoryId: c.req.param("id"),
    actorId: c.get("auth").userId,
    scope: body.scope,
    targetId: body.targetId,
    content: body.content,
    confidence: body.confidence,
  });
  if ("error" in res) return c.json(res, res.error === "not_found" || res.error === "target_not_found" ? 404 : 400);
  return c.json(res.memory);
});

api.delete("/memory/:id", requirePermission("memory:delete"), async (c) => {
  const res = await archiveMemory(c.get("teamId"), c.req.param("id"), c.get("auth").userId);
  if ("error" in res) return c.json(res, 404);
  return c.json(res.memory);
});

api.post("/memory/:id/restore", requirePermission("memory:update"), async (c) => {
  const res = await restoreMemory(c.get("teamId"), c.req.param("id"), c.get("auth").userId);
  if ("error" in res) return c.json(res, 404);
  return c.json(res.memory);
});

api.get("/memory/events", requirePermission("memory:read"), async (c) => {
  const items = await listMemoryEvents(c.get("teamId"), c.req.query("memoryId") ?? undefined);
  return c.json({ items, total: items.length });
});

api.get("/memory/injection-preview", requirePermission("memory:read"), async (c) => {
  const agentId = c.req.query("agentId");
  if (!agentId) return c.json({ error: "agent_required" }, 400);
  const preview = await resolveMemoryInjectionPreview(c.get("teamId"), agentId);
  if (!preview) return c.json({ error: "not_found" }, 404);
  return c.json(preview);
});

api.get("/memory/session-search", requirePermission("memory:read"), async (c) => {
  const items = await searchChatMemory(
    c.get("teamId"),
    c.req.query("q") ?? "",
    Number(c.req.query("limit") ?? 30),
  );
  return c.json({ items, total: items.length });
});

api.get("/skills", requirePermission("skill:read"), async (c) => {
  const items = await listSkills(c.get("teamId"), {
    scope: (c.req.query("scope") as never) || undefined,
    targetId: c.req.query("targetId") ?? undefined,
  });
  return c.json({ items, total: items.length });
});

api.get("/skills/:id/versions", requirePermission("skill:read"), async (c) => {
  const items = await listSkillVersions(c.get("teamId"), c.req.param("id"));
  return c.json({ items, total: items.length });
});

/* ── Workspace & team settings ───────────────────────────────────────── */

api.get(
  "/settings/workspace",
  requirePermission("settings:read"),
  async (c) => {
    const ws = await getWorkspaceSettings(c.get("teamId"));
    if (!ws) return c.json({ error: "not_found" }, 404);
    return c.json(ws);
  },
);

api.patch(
  "/settings/workspace",
  requirePermission("settings:update"),
  async (c) => {
    const parsed = parseJsonBody(
      workspaceBody,
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    const res = await updateWorkspaceSettings(
      c.get("teamId"),
      c.get("auth").userId,
      parsed.data,
    );
    if ("error" in res) {
      const status =
        res.error === "forbidden"
          ? 403
          : res.error === "slug_taken"
            ? 409
            : 400;
      return c.json({ error: res.error }, status);
    }
    return c.json(res);
  },
);

api.get(
  "/settings/environments",
  requirePermission("settings:read"),
  async (c) => {
    return c.json(await getEnvironmentSettings(c.get("teamId")));
  },
);

api.patch(
  "/settings/environments",
  requirePermission("settings:update"),
  async (c) => {
    const parsed = parseJsonBody(
      environmentBody,
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    const res = await updateEnvironmentSettings(c.get("teamId"), parsed.data);
    if ("error" in res) {
      return c.json({ error: res.error }, 400);
    }
    return c.json(res);
  },
);

api.get("/settings/members", requirePermission("settings:read"), async (c) => {
  const items = await listTeamMembers(c.get("teamId"));
  return c.json({ items });
});

api.patch(
  "/settings/members/:userId",
  requirePermission("settings:update"),
  async (c) => {
    const parsed = parseJsonBody(
      memberRoleBody,
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    const res = await updateTeamMemberRole(
      c.get("teamId"),
      c.get("auth").userId,
      c.req.param("userId"),
      parsed.data.role,
    );
    if ("error" in res) {
      const status =
        res.error === "forbidden"
          ? 403
          : res.error === "last_owner"
            ? 409
            : 404;
      return c.json({ error: res.error }, status);
    }
    return c.json(res);
  },
);

api.delete(
  "/settings/members/:userId",
  requirePermission("settings:update"),
  async (c) => {
    const res = await removeTeamMember(
      c.get("teamId"),
      c.get("auth").userId,
      c.req.param("userId"),
    );
    if ("error" in res) {
      const status =
        res.error === "forbidden"
          ? 403
          : res.error === "last_owner"
            ? 409
            : 404;
      return c.json({ error: res.error }, status);
    }
    return c.json(res);
  },
);

api.get(
  "/settings/invitations",
  requirePermission("settings:read"),
  async (c) => {
    const items = await listTeamInvitations(c.get("teamId"));
    return c.json({ items });
  },
);

api.post(
  "/settings/invitations",
  requirePermission("settings:update"),
  async (c) => {
    const parsed = parseJsonBody(
      inviteMemberBody,
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    const res = await inviteTeamMember(
      c.get("teamId"),
      c.get("auth").userId,
      parsed.data.email,
      parsed.data.role,
    );
    if ("error" in res) return c.json({ error: res.error }, 403);
    const acceptUrl = `${env.WEB_PUBLIC_URL}/invite?token=${res.token}`;
    return c.json({ id: res.id, expiresAt: res.expiresAt, acceptUrl }, 201);
  },
);

api.delete(
  "/settings/invitations/:id",
  requirePermission("settings:update"),
  async (c) => {
    const res = await revokeTeamInvitation(
      c.get("teamId"),
      c.get("auth").userId,
      c.req.param("id"),
    );
    if ("error" in res) return c.json({ error: res.error }, 404);
    return c.json(res);
  },
);

api.get(
  "/settings/providers",
  requirePermission("settings:read"),
  async (c) => {
    return c.json(await getProvidersSettings(c.get("teamId")));
  },
);

api.patch(
  "/settings/providers/:id",
  requirePermission("settings:update"),
  async (c) => {
    const parsed = parseJsonBody(
      providerPatchBody,
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    const res = await updateProviderConfig(
      c.get("teamId"),
      c.get("auth").userId,
      c.req.param("id"),
      parsed.data,
    );
    if ("error" in res) return c.json({ error: res.error }, 403);
    return c.json(res);
  },
);

api.patch(
  "/settings/providers-policy",
  requirePermission("settings:update"),
  async (c) => {
    const parsed = parseJsonBody(
      providersPolicyBody,
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    const res = await updateProvidersPolicy(
      c.get("teamId"),
      c.get("auth").userId,
      parsed.data,
    );
    if ("error" in res) return c.json({ error: res.error }, 403);
    return c.json(res);
  },
);

api.post(
  "/settings/providers/:id/test",
  requirePermission("settings:update"),
  async (c) => {
    const res = await testProviderConnection(
      c.get("teamId"),
      c.req.param("id"),
    );
    return c.json(res);
  },
);

/* ── Runtime provider keys (managed from the web UI, injected into the daemon) ── */
api.get(
  "/settings/provider-keys",
  requirePermission("settings:read"),
  async (c) => {
    return c.json({ items: await listProviderKeys(c.get("teamId")) });
  },
);

api.put(
  "/settings/provider-keys/:provider",
  requirePermission("settings:update"),
  async (c) => {
    const provider = c.req.param("provider");
    if (!isSupportedProvider(provider))
      return c.json({ error: "unsupported_provider" }, 400);
    const parsed = parseJsonBody(
      providerKeyBody,
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return jsonValidationError(c, parsed.error);
    await setProviderKey(c.get("teamId"), provider, parsed.data.key);
    return c.json({ ok: true });
  },
);

api.delete(
  "/settings/provider-keys/:provider",
  requirePermission("settings:delete"),
  async (c) => {
    await deleteProviderKey(c.get("teamId"), c.req.param("provider"));
    return c.json({ ok: true });
  },
);

/* ───────────────────────────── Runs (union) ──────────────────────────── */

api.get("/runs", async (c) => {
  const items = await listRunsUnion(c.get("teamId"), {
    status: c.req.query("status") ?? undefined,
    agentId: c.req.query("agentId") ?? undefined,
  });
  return c.json({ items, nextCursor: null, total: items.length });
});

api.get("/runs/:id", async (c) => {
  const id = c.req.param("id");
  const teamId = c.get("teamId");
  if (id.startsWith("atask_")) {
    const detail = await getRunUnified(teamId, id);
    if (!detail) return c.json({ error: "not_found" }, 404);
    return c.json(detail);
  }
  const detail = await getRun(id, teamId);
  if (!detail) return c.json({ error: "not_found" }, 404);
  // Re-shape the flat workflow detail into the web's { run, steps } contract.
  return c.json(workflowDetailToWeb(detail as never));
});

api.post("/runs/:id/cancel", requirePermission("run:control"), async (c) => {
  const ok = await cancelAgentTask(c.get("teamId"), c.req.param("id"));
  return c.json({ ok }, ok ? 200 : 404);
});

api.post("/runs/:id/pause", requirePermission("run:control"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const ok = await pauseAgentTask(
    c.get("teamId"),
    c.req.param("id"),
    body.reason,
  );
  return c.json({ ok }, ok ? 200 : 409);
});

api.post("/runs/:id/resume", requirePermission("run:control"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const ok = await resumeAgentTask(
    c.get("teamId"),
    c.req.param("id"),
    body.reason,
  );
  return c.json({ ok }, ok ? 200 : 409);
});

api.post(
  "/runs/:id/approval/request",
  requirePermission("run:control"),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      message?: string;
      context?: Record<string, unknown>;
    };
    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : "Operator approval required.";
    const ok = await requestAgentTaskApproval(
      c.get("teamId"),
      c.req.param("id"),
      message,
      body.context,
    );
    return c.json({ ok }, ok ? 202 : 409);
  },
);

api.post("/runs/:id/approve", requirePermission("run:approve"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const ok = await approveAgentTask(
    c.get("teamId"),
    c.req.param("id"),
    body.reason,
  );
  return c.json({ ok }, ok ? 202 : 409);
});

api.post("/runs/:id/reject", requirePermission("run:approve"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const ok = await rejectAgentTask(
    c.get("teamId"),
    c.req.param("id"),
    body.reason,
  );
  return c.json({ ok }, ok ? 202 : 409);
});

// Manual re-run: enqueues a fresh task (attempt=1) cloning the original. Distinct from
// the scanner's auto-retry (which reuses the row for transient failures). agent-tasks only.
api.post("/runs/:id/retry", requirePermission("run:run"), async (c) => {
  const res = await retryAgentTask(c.get("teamId"), c.req.param("id"));
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json(res, 202);
});

/* ── Observability (real traces projected from runs) ──────────────────── */

api.get("/observability/traces", async (c) => {
  const body = await listTraces(c.get("teamId"), {
    env: c.req.query("env") ?? undefined,
    status: c.req.query("status") ?? undefined,
    q: c.req.query("q") ?? undefined,
  });
  return c.json(body);
});

api.get("/observability/traces/:id", async (c) => {
  const detail = await getTrace(c.get("teamId"), c.req.param("id"));
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

/* ── Chat-spawns-task ─────────────────────────────────────────────────── */

api.get("/chat/sessions", requirePermission("run:read"), async (c) => {
  return c.json({ items: await listChatSessions(c.get("teamId")) });
});

api.post("/chat/sessions", requirePermission("run:run"), async (c) => {
  const body = await c.req
    .json<{ agentId?: string; title?: string }>()
    .catch(() => ({}) as { agentId?: string; title?: string });
  if (!body.agentId) return c.json({ error: "agentId_required" }, 400);
  const session = await createChatSession(
    c.get("teamId"),
    { agentId: body.agentId, title: body.title },
    c.get("auth").userId,
  );
  if (!session) return c.json({ error: "agent_not_found" }, 404);
  return c.json(session, 201);
});

api.get("/chat/sessions/:id", requirePermission("run:read"), async (c) => {
  const res = await getChatSession(c.get("teamId"), c.req.param("id"));
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json(res);
});

api.post(
  "/chat/sessions/:id/messages",
  requirePermission("run:run"),
  async (c) => {
    const body = await c.req
      .json<{ content?: string }>()
      .catch(() => ({}) as { content?: string });
    const content = (body.content ?? "").trim();
    if (!content) return c.json({ error: "content_required" }, 400);
    const res = await sendChatMessage(
      c.get("teamId"),
      c.req.param("id"),
      content,
    );
    if (!res) return c.json({ error: "not_found" }, 404);
    return c.json(res, 202);
  },
);

/**
 * Live run status via SSE — polls the run until it reaches a terminal state.
 * Path is `/runs/:id/live` (not `/stream`) on purpose: apps/web already ships a
 * mock `/runs/:id/stream` route handler for the run-view demo, which would
 * shadow this through the Next rewrite. `/live` has no FS route and no MSW
 * handler, so it bypasses straight to the engine.
 */
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

/**
 * Agent-task live stream: emits typed RunEvents (apps/web/types/events.ts) built
 * from task_messages, so the web event-reducer drives the timeline exactly like
 * the REST snapshot. Resumable via `?lastEventId=<seq>`. Each SSE `id` is the
 * source message seq, so reconnect replays only messages after the last cursor.
 */
async function streamAgentTaskLive(
  stream: SSEStreamingApi,
  id: string,
  teamId: string,
  resumeAfter: number,
) {
  let lastSeq = resumeAfter;
  let lastStatus: WebRunStatusOrNull = null;
  let envSeq = 0;
  const name = await getAgentTaskName(teamId, id);

  const emit = async (
    ev: LiveRunEvent,
    idSeq: number,
    contractEvent?: OrchestratorRunEvent,
  ) => {
    envSeq += 1;
    const envelope = {
      id: String(idSeq),
      seq: envSeq,
      ts: new Date().toISOString(),
      runId: id,
      event: ev.type,
      ...(contractEvent ? { contractEvent } : {}),
      data: ev,
    };
    await stream.writeSSE({
      id: String(idSeq),
      event: ev.type,
      data: JSON.stringify(envelope),
    });
  };

  for (let i = 0; i < 1500; i++) {
    const status = await getAgentTaskStatus(teamId, id);
    if (!status) {
      await emit(
        {
          type: "stream.error",
          kind: "unknown",
          message: "not_found",
          fatal: true,
        },
        lastSeq,
      );
      return;
    }
    if (status !== lastStatus) {
      lastStatus = status;
      await emit(
        { type: "run.status.changed", status },
        lastSeq,
        contractEventForStatus(status),
      );
    }
    const msgs = await listTaskMessagesAfter(id, lastSeq);
    for (const m of msgs) {
      for (const ev of agentTaskMessageToEvents(m, name))
        await emit(ev, m.seq, contractEventForTaskMessage(m, ev));
      lastSeq = m.seq;
    }
    if (TERMINAL.has(status)) return;
    await stream.sleep(300);
  }
}

type WebRunStatusOrNull = Awaited<ReturnType<typeof getAgentTaskStatus>>;

api.get("/runs/:id/live", (c) => {
  const id = c.req.param("id");
  const teamId = c.get("teamId");
  if (id.startsWith("atask_")) {
    // -1 = "nothing seen yet" so the first message (seq 0) is included; a real
    // lastEventId resumes strictly after the last seq the client acknowledged.
    const lastId = c.req.query("lastEventId");
    const resumeAfter =
      lastId && Number.isFinite(Number(lastId)) ? Number(lastId) : -1;
    return streamSSE(c, (stream) =>
      streamAgentTaskLive(stream, id, teamId, resumeAfter),
    );
  }
  return streamSSE(c, async (stream) => {
    for (let i = 0; i < 1500; i++) {
      const run = await getRun(id, teamId);
      if (!run) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ error: "not_found" }),
        });
        return;
      }
      await stream.writeSSE({ event: "run", data: JSON.stringify(run) });
      if (TERMINAL.has(run.status)) return;
      // Tight poll so the canvas loader tracks node-by-node progress live.
      await stream.sleep(200);
    }
  });
});

// Auth routes are NOT org-scoped — mount before the org middleware app.
app.route("/api/v1/auth", auth);

// Telegram cannot send Agentik org cookies/headers. The unguessable webhook
// secret resolves the org-scoped channel connection before command dispatch.
app.post("/api/v1/channels/telegram/:secret/webhook", async (c) => {
  const update = await c.req.json().catch(() => null);
  if (!update || typeof update !== "object")
    return c.json({ ok: false, error: "invalid_update" }, 400);
  const result = await handleTelegramWebhookSecret(
    c.req.param("secret"),
    update as never,
  );
  if (result.reply === "connection_not_found")
    return c.json({ ok: false, error: "not_found" }, 404);
  return c.json({ ok: result.ok });
});

app.route("/api/v1", api);
app.route("/daemon", daemon);

export default app;
