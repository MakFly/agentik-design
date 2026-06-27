import { Hono } from "hono";
import {
  requirePermission,
  type AuthVars,
} from "../../app/middleware/auth";
import {
  createAgent,
  createTestTask,
  deleteAgent,
  getAgentRow,
  getAgentTaskSnapshot,
  listAgentRows,
  publishAgent,
  runAgent,
} from "./repo";

export const agentsRoutes = new Hono<{ Variables: AuthVars }>();

agentsRoutes.get("/agents", async (c) => {
  const items = await listAgentRows(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

agentsRoutes.get("/agents/:id", async (c) => {
  const agent = await getAgentRow(c.get("teamId"), c.req.param("id"));
  if (!agent) return c.json({ error: "not_found" }, 404);
  return c.json(agent);
});

agentsRoutes.delete("/agents/:id", requirePermission("agent:delete"), async (c) => {
  const ok = await deleteAgent(c.get("teamId"), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

agentsRoutes.get("/agent-task-snapshot", async (c) => {
  return c.json(await getAgentTaskSnapshot(c.get("teamId")));
});

agentsRoutes.post("/agents", async (c) => {
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

agentsRoutes.post("/agents/:id/publish", async (c) => {
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
  if ("error" in res) return c.json(res, 409);
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
