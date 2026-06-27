import { Hono } from "hono";
import {
  requirePermission,
  type AuthVars,
} from "../../app/middleware/auth";
import { env } from "../../infra/env";
import {
  createTelegramConnection,
  deleteChannelConnection,
  listChannelConnections,
  registerTelegramWebhook,
  useTelegramPolling,
} from "./repo";

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
