import { Hono } from "hono";
import {
  requirePermission,
  type AuthVars,
} from "../../app/middleware/auth";
import { env } from "../../infra/env";
import { jsonValidationError, parseJsonBody } from "../../infra/validation";
import {
  createBinding,
  createTelegramConnection,
  deleteBinding,
  deleteChannelConnection,
  listBindings,
  listChannelConnections,
  registerTelegramWebhook,
  updateBinding,
  useTelegramPolling,
} from "./repo";
import { createBindingBody, updateBindingBody } from "./schemas";

export const channelsRoutes = new Hono<{ Variables: AuthVars }>();

channelsRoutes.get("/channels", requirePermission("settings:read"), async (c) => {
  const items = await listChannelConnections(c.get("teamId"));
  return c.json({ items, total: items.length });
});

channelsRoutes.post("/channels/telegram", requirePermission("settings:update"), async (c) => {
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
});

channelsRoutes.delete("/channels/:id", requirePermission("settings:update"), async (c) => {
  const ok = await deleteChannelConnection(c.get("teamId"), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

channelsRoutes.post("/channels/:id/webhook", requirePermission("settings:update"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { baseUrl?: string };
  const baseUrl = body.baseUrl?.trim() || env.ENGINE_PUBLIC_URL;
  const result = await registerTelegramWebhook(
    c.get("teamId"),
    c.req.param("id"),
    baseUrl,
  );
  if (!result.ok)
    return c.json(result, result.error === "connection_not_found" ? 404 : 422);
  return c.json(result);
});

channelsRoutes.post("/channels/:id/polling", requirePermission("settings:update"), async (c) => {
  const result = await useTelegramPolling(c.get("teamId"), c.req.param("id"));
  if (!result.ok)
    return c.json(result, result.error === "connection_not_found" ? 404 : 422);
  return c.json(result);
});

channelsRoutes.get("/channels/:id/bindings", requirePermission("settings:read"), async (c) => {
  const bindings = await listBindings(c.get("teamId"), c.req.param("id"));
  return c.json({ bindings });
});

channelsRoutes.post("/channels/:id/bindings", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(createBindingBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const result = await createBinding(c.get("teamId"), c.req.param("id"), parsed.data);
  if ("error" in result) {
    return c.json({ error: result.error }, result.error === "connection_not_found" ? 404 : 422);
  }
  return c.json(result.binding, 201);
});

channelsRoutes.patch("/channels/bindings/:bindingId", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(updateBindingBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const result = await updateBinding(c.get("teamId"), c.req.param("bindingId"), parsed.data);
  if (!result) return c.json({ error: "not_found" }, 404);
  if ("error" in result) return c.json({ error: result.error }, 422);
  return c.json(result.binding);
});

channelsRoutes.delete("/channels/bindings/:bindingId", requirePermission("settings:update"), async (c) => {
  const ok = await deleteBinding(c.get("teamId"), c.req.param("bindingId"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
