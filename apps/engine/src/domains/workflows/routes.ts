import { Hono } from "hono";
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
import { encryptJson, decryptJson } from "../../infra/crypto";
import { buildGoogleAuthUrl, exchangeGoogleCode } from "../../infra/oauth";
import { env } from "../../infra/env";
import { enqueueRun } from "../../infra/queue";
import type { AuthVars } from "../../app/middleware/auth";

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

export const workflowsRoutes = new Hono<{ Variables: AuthVars }>();

workflowsRoutes.get("/workflows", async (c) => {
  const items = await listWorkflows(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

workflowsRoutes.post("/workflows", async (c) => {
  const parsed = createWorkflowInput.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const wf = await createWorkflow(c.get("teamId"), parsed.data);
  return c.json(wf, 201);
});

workflowsRoutes.get("/workflows/:id", async (c) => {
  const wf = await getWorkflow(c.get("teamId"), c.req.param("id"));
  if (!wf) return c.json({ error: "not_found" }, 404);
  return c.json(wf);
});

workflowsRoutes.put("/workflows/:id/versions", async (c) => {
  const parsed = saveVersionInput.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const wf = await saveVersion(c.get("teamId"), c.req.param("id"), parsed.data);
  if (!wf) return c.json({ error: "not_found" }, 404);
  return c.json(wf);
});

workflowsRoutes.post("/workflows/:id/run", async (c) => {
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

workflowsRoutes.get("/credentials", async (c) => {
  const items = await listCredentials(c.get("teamId"));
  return c.json({ items, total: items.length });
});

workflowsRoutes.post("/credentials", async (c) => {
  const parsed = createCredentialInput.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const cred = await createCredential(c.get("teamId"), parsed.data);
  return c.json(cred, 201);
});

workflowsRoutes.delete("/credentials/:id", async (c) => {
  const ok = await deleteCredential(c.get("teamId"), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

workflowsRoutes.get("/credentials/:id/authorize", async (c) => {
  const cred = await getCredentialDecrypted(c.get("teamId"), c.req.param("id"));
  if (!cred) return c.json({ error: "not_found" }, 404);
  if (cred.row.type !== "googleOAuth2")
    return c.json({ error: "not_oauth_credential" }, 400);
  const clientId = cred.data.clientId || env.GOOGLE_CLIENT_ID || "";
  if (!clientId)
    return c.html(
      oauthResultHtml(false, "No Google client id — add it to the connection in Settings → Connections."),
    );
  const state = encryptJson({ id: cred.row.id });
  return c.redirect(
    buildGoogleAuthUrl({ clientId, scope: cred.data.scope ?? "", state }),
  );
});

workflowsRoutes.get("/oauth/google/callback", async (c) => {
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
