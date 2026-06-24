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
  agentTaskMessageToEvents,
  cancelAgentTask,
  createAgent,
  createTestTask,
  getAgentTaskName,
  getAgentTaskStatus,
  getAgentTaskSnapshot,
  getRunUnified,
  getSystemInfo,
  listAgentRows,
  listRunsUnion,
  listTaskMessagesAfter,
  publishAgent,
  runAgent,
  workflowDetailToWeb,
  type LiveRunEvent,
} from "./agents-repo";
import type { SSEStreamingApi } from "hono/streaming";
import { daemon } from "./daemon-routes";
import { listProviderKeys, setProviderKey, deleteProviderKey, isSupportedProvider } from "./providers-repo";
import { auth } from "./auth-routes";
import { withAuth, requirePermission, type AuthVars } from "./auth";
import { createAgentVersionInput } from "@agentik/workflow-schema";
import {
  applyRunReview,
  createAgentVersion,
  generateRunReview,
  getRunReview,
  getRunReviewByRunId,
  listAgentVersions,
  listMemory,
  listRunReviews,
  listSkills,
  listSkillVersions,
  reviewChangeIds,
  setRunReviewStatus,
} from "./learning-repo";
import type { RunReviewStatus } from "@agentik/workflow-schema";

type Vars = AuthVars;

const app = new Hono<{ Variables: Vars }>();

app.use("*", cors());

app.get("/api/v1/health", (c) => c.json({ ok: true, service: "engine" }));

const api = new Hono<{ Variables: Vars }>();

/** Annotate a run review's proposals with stable changeIds for per-change approval. */
function withChangeIds(review: {
  proposedMemories: unknown[];
  proposedSkillChanges: unknown[];
} & Record<string, unknown>) {
  return {
    ...review,
    proposedMemories: review.proposedMemories.map((m, i) => ({ changeId: `m${i}`, ...(m as object) })),
    proposedSkillChanges: review.proposedSkillChanges.map((s, i) => ({ changeId: `s${i}`, ...(s as object) })),
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
  const parsed = createWorkflowInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const wf = await createWorkflow(c.get("teamId"), parsed.data);
  return c.json(wf, 201);
});

api.get("/workflows/:id", async (c) => {
  const wf = await getWorkflow(c.get("teamId"), c.req.param("id"));
  if (!wf) return c.json({ error: "not_found" }, 404);
  return c.json(wf);
});

api.put("/workflows/:id/versions", async (c) => {
  const parsed = saveVersionInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const wf = await saveVersion(c.get("teamId"), c.req.param("id"), parsed.data);
  if (!wf) return c.json({ error: "not_found" }, 404);
  return c.json(wf);
});

api.post("/workflows/:id/run", async (c) => {
  const parsed = runWorkflowInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const result = await createRun(c.get("teamId"), c.req.param("id"), "manual", parsed.data.payload);
  if ("error" in result) {
    return c.json({ error: result.error }, result.error === "not_found" ? 404 : 409);
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
  const parsed = createCredentialInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
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
  if (cred.row.type !== "googleOAuth2") return c.json({ error: "not_oauth_credential" }, 400);
  const clientId = cred.data.clientId || env.GOOGLE_CLIENT_ID || "";
  if (!clientId) return c.html(oauthResultHtml(false, "No Google client id (set GOOGLE_CLIENT_ID)."));
  const state = encryptJson({ id: cred.row.id });
  return c.redirect(buildGoogleAuthUrl({ clientId, scope: cred.data.scope ?? "", state }));
});

/** OAuth redirect target — exchange the code and store tokens on the credential. */
api.get("/oauth/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.html(oauthResultHtml(false, "Missing code or state."));

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
    return c.html(oauthResultHtml(false, e instanceof Error ? e.message : "Token exchange failed."));
  }
});

/* ─────────────────────────── Agents (harness) ────────────────────────── */

api.get("/agents", async (c) => {
  const items = await listAgentRows(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

api.get("/agent-task-snapshot", async (c) => {
  return c.json(await getAgentTaskSnapshot(c.get("teamId")));
});

/** System view: daemons, runtimes, detected CLIs, provider key presence. */
api.get("/system", async (c) => {
  const info = await getSystemInfo(c.get("teamId"));
  return c.json({
    daemonEnabled: env.DAEMON_ENABLED,
    providers: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(env.OPENAI_API_KEY),
      google: Boolean(env.GOOGLE_CLIENT_ID),
    },
    ...info,
  });
});

api.post("/agents", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { name?: string; role?: string; goal?: string; tags?: string[] } | null;
  if (!body?.name) return c.json({ error: "invalid_body" }, 400);
  const res = await createAgent(c.get("teamId"), { name: body.name, role: body.role, goal: body.goal, tags: body.tags });
  return c.json(res, 201);
});

api.post("/agents/:id/publish", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { config?: unknown; changelog?: string };
  const res = await publishAgent(c.get("teamId"), c.req.param("id"), body.config, body.changelog);
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json(res);
});

api.post("/agents/:id/run", requirePermission("run:run"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { input?: string };
  const res = await runAgent(c.get("teamId"), c.req.param("id"), body.input ?? "");
  if (!res) return c.json({ error: "not_found" }, 404);
  if ("error" in res) return c.json(res, 409);
  return c.json(res, 202);
});

api.post("/agents/test", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { config?: unknown; input?: string; runtime?: string };
  const res = await createTestTask(c.get("teamId"), body.config, body.input ?? "", body.runtime ?? "echo");
  return c.json(res, 202);
});

/* ── Agent versions (formalize publish) ──────────────────────────────── */

api.post("/agents/:id/versions", requirePermission("agent:create"), async (c) => {
  const parsed = createAgentVersionInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const res = await createAgentVersion(c.get("teamId"), c.req.param("id"), parsed.data);
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json(res, 201);
});

api.get("/agents/:id/versions", requirePermission("agent:read"), async (c) => {
  const items = await listAgentVersions(c.get("teamId"), c.req.param("id"));
  return c.json({ items, total: items.length });
});

/* ── Run reviews (runId = agent_tasks.id) — the learning loop ─────────── */

api.post("/runs/:id/review", requirePermission("run:run"), async (c) => {
  const existing = await getRunReviewByRunId(c.get("teamId"), c.req.param("id"));
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

api.post("/run-reviews/:id/approve", requirePermission("review:approve"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { changeIds?: string[] };
  const res = await applyRunReview(c.get("teamId"), c.req.param("id"), body.changeIds);
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json({ status: "applied", ...res });
});

api.post("/run-reviews/:id/reject", requirePermission("review:approve"), async (c) => {
  const ok = await setRunReviewStatus(c.get("teamId"), c.req.param("id"), "rejected");
  return c.json({ status: "rejected", ok }, ok ? 200 : 404);
});

/* ── Memory & skills (read for UI + injection; writes only via approval) ─ */

api.get("/memory", requirePermission("memory:read"), async (c) => {
  const items = await listMemory(c.get("teamId"), {
    scope: (c.req.query("scope") as never) || undefined,
    targetId: c.req.query("targetId") ?? undefined,
  });
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

/* ── Runtime provider keys (managed from the web UI, injected into the daemon) ── */
api.get("/settings/provider-keys", requirePermission("settings:read"), async (c) => {
  return c.json({ items: await listProviderKeys(c.get("teamId")) });
});

api.put("/settings/provider-keys/:provider", requirePermission("settings:update"), async (c) => {
  const provider = c.req.param("provider");
  if (!isSupportedProvider(provider)) return c.json({ error: "unsupported_provider" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (key.length < 8) return c.json({ error: "invalid_key" }, 400);
  await setProviderKey(c.get("teamId"), provider, key);
  return c.json({ ok: true });
});

api.delete("/settings/provider-keys/:provider", requirePermission("settings:delete"), async (c) => {
  await deleteProviderKey(c.get("teamId"), c.req.param("provider"));
  return c.json({ ok: true });
});

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

api.post("/runs/:id/cancel", async (c) => {
  const ok = await cancelAgentTask(c.get("teamId"), c.req.param("id"));
  return c.json({ ok }, ok ? 200 : 404);
});

api.post("/runs/:id/approve", async (c) => {
  // P1 stub — approval gate wired in Phase 4.
  return c.json({ ok: true }, 202);
});

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
async function streamAgentTaskLive(stream: SSEStreamingApi, id: string, teamId: string, resumeAfter: number) {
  let lastSeq = resumeAfter;
  let lastStatus: WebRunStatusOrNull = null;
  let envSeq = 0;
  const name = await getAgentTaskName(teamId, id);

  const emit = async (ev: LiveRunEvent, idSeq: number) => {
    envSeq += 1;
    const envelope = { id: String(idSeq), seq: envSeq, ts: new Date().toISOString(), runId: id, event: ev.type, data: ev };
    await stream.writeSSE({ id: String(idSeq), event: ev.type, data: JSON.stringify(envelope) });
  };

  for (let i = 0; i < 1500; i++) {
    const status = await getAgentTaskStatus(teamId, id);
    if (!status) {
      await emit({ type: "stream.error", kind: "unknown", message: "not_found", fatal: true }, lastSeq);
      return;
    }
    if (status !== lastStatus) {
      lastStatus = status;
      await emit({ type: "run.status.changed", status }, lastSeq);
    }
    const msgs = await listTaskMessagesAfter(id, lastSeq);
    for (const m of msgs) {
      for (const ev of agentTaskMessageToEvents(m, name)) await emit(ev, m.seq);
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
    const resumeAfter = lastId && Number.isFinite(Number(lastId)) ? Number(lastId) : -1;
    return streamSSE(c, (stream) => streamAgentTaskLive(stream, id, teamId, resumeAfter));
  }
  return streamSSE(c, async (stream) => {
    for (let i = 0; i < 1500; i++) {
      const run = await getRun(id, teamId);
      if (!run) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "not_found" }) });
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
app.route("/api/v1", api);
app.route("/daemon", daemon);

export default app;
