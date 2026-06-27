import { Hono } from "hono";
import {
  requirePermission,
  type AuthVars,
} from "../../app/middleware/auth";
import { jsonValidationError, parseJsonBody } from "../../infra/validation";
import {
  createMcpServerBody,
  invokeToolBody,
  updateMcpServerBody,
} from "./schemas";
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
} from "./repo";

export const mcpRoutes = new Hono<{ Variables: AuthVars }>();

mcpRoutes.get("/mcp-servers", requirePermission("settings:read"), async (c) => {
  const items = await listMcpServers(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

mcpRoutes.post("/mcp-servers", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(createMcpServerBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const server = await createMcpServer(c.get("teamId"), parsed.data);
  return c.json(server, 201);
});

mcpRoutes.get("/mcp-servers/:id", requirePermission("settings:read"), async (c) => {
  const server = await getMcpServer(c.get("teamId"), c.req.param("id"));
  if (!server) return c.json({ error: "not_found" }, 404);
  return c.json(server);
});

mcpRoutes.patch("/mcp-servers/:id", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(updateMcpServerBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const server = await updateMcpServer(c.get("teamId"), c.req.param("id"), parsed.data);
  if (!server) return c.json({ error: "not_found" }, 404);
  return c.json(server);
});

mcpRoutes.delete("/mcp-servers/:id", requirePermission("settings:update"), async (c) => {
  const ok = await deleteMcpServer(c.get("teamId"), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

mcpRoutes.post("/mcp-servers/:id/test", requirePermission("settings:update"), async (c) => {
  const result = await testMcpServer(c.get("teamId"), c.req.param("id"));
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

mcpRoutes.post("/mcp-servers/:id/sync", requirePermission("settings:update"), async (c) => {
  const result = await syncMcpServer(c.get("teamId"), c.req.param("id"));
  if (!result) return c.json({ error: "not_found" }, 404);
  if ("error" in result) return c.json(result, 409);
  return c.json(result);
});

mcpRoutes.get("/tools/catalog", requirePermission("agent:read"), async (c) => {
  const items = await listToolCatalog(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

mcpRoutes.post("/tools/invoke", requirePermission("run:run"), async (c) => {
  const parsed = parseJsonBody(invokeToolBody, await c.req.json().catch(() => null));
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
