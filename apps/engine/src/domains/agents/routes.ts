import { Hono } from "hono";
import {
  requirePermission,
  type AuthVars,
} from "../../app/middleware/auth";
import { jsonValidationError, parseJsonBody } from "../../infra/validation";
import {
  AgentPublishError,
  createAgent,
  createTestTask,
  deleteAgent,
  getAgentGraph,
  getAgentRow,
  getAgentTaskSnapshot,
  getRoster,
  listAgentRows,
  publishAgent,
  runAgent,
  setRoster,
  updateAgent,
} from "./repo";
import { createAgentBody, rosterBody, updateAgentBody } from "./schemas";

export const agentsRoutes = new Hono<{ Variables: AuthVars }>();

agentsRoutes.get("/agents", async (c) => {
  const items = await listAgentRows(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

// Static path — must precede "/agents/:id" so it is not captured as an id.
agentsRoutes.get("/agents/graph", async (c) => {
  return c.json(await getAgentGraph(c.get("teamId")));
});

agentsRoutes.get("/agent-task-snapshot", async (c) => {
  return c.json(await getAgentTaskSnapshot(c.get("teamId")));
});

agentsRoutes.post("/agents", requirePermission("agent:create"), async (c) => {
  const parsed = parseJsonBody(createAgentBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  try {
    const res = await createAgent(c.get("teamId"), parsed.data);
    return c.json(res, 201);
  } catch (err) {
    if (err instanceof AgentPublishError) {
      return c.json({ error: err.reason }, err.reason === "daemon_not_found" ? 404 : 409);
    }
    throw err;
  }
});

agentsRoutes.get("/agents/:id", async (c) => {
  const agent = await getAgentRow(c.get("teamId"), c.req.param("id"));
  if (!agent) return c.json({ error: "not_found" }, 404);
  return c.json(agent);
});

agentsRoutes.patch("/agents/:id", requirePermission("agent:update"), async (c) => {
  const parsed = parseJsonBody(updateAgentBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const agent = await updateAgent(c.get("teamId"), c.req.param("id"), parsed.data);
  if (!agent) return c.json({ error: "not_found" }, 404);
  return c.json(agent);
});

agentsRoutes.delete("/agents/:id", requirePermission("agent:delete"), async (c) => {
  const res = await deleteAgent(c.get("teamId"), c.req.param("id"));
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true, ...res });
});

agentsRoutes.get("/agents/:id/subagents", async (c) => {
  const subagents = await getRoster(c.get("teamId"), c.req.param("id"));
  return c.json({ subagents });
});

agentsRoutes.put("/agents/:id/subagents", requirePermission("agent:update"), async (c) => {
  const parsed = parseJsonBody(rosterBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const res = await setRoster(c.get("teamId"), c.req.param("id"), parsed.data.subagents);
  if ("error" in res) {
    return c.json({ error: res.error }, res.error === "parent_not_found" ? 404 : 400);
  }
  return c.json({ subagents: res.roster });
});

agentsRoutes.post("/agents/:id/publish", requirePermission("agent:update"), async (c) => {
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

agentsRoutes.post("/agents/:id/run", requirePermission("run:run"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { input?: string };
  const res = await runAgent(c.get("teamId"), c.req.param("id"), body.input ?? "");
  if (!res) return c.json({ error: "not_found" }, 404);
  if ("error" in res) {
    return c.json(
      res,
      res.error === "spend_limit_exceeded" ? 402 : res.error === "no_live_daemon" ? 503 : 409,
    );
  }
  return c.json(res, 202);
});

agentsRoutes.post("/agents/test", async (c) => {
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
