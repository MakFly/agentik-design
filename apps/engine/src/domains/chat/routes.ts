import { Hono } from "hono";
import {
  requirePermission,
  type AuthVars,
} from "../../app/middleware/auth";
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  sendChatMessage,
} from "./repo";

export const chatRoutes = new Hono<{ Variables: AuthVars }>();

chatRoutes.get("/chat/sessions", requirePermission("run:read"), async (c) => {
  return c.json({ items: await listChatSessions(c.get("teamId")) });
});

chatRoutes.post("/chat/sessions", requirePermission("run:run"), async (c) => {
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

chatRoutes.get("/chat/sessions/:id", requirePermission("run:read"), async (c) => {
  const res = await getChatSession(c.get("teamId"), c.req.param("id"));
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json(res);
});

chatRoutes.post("/chat/sessions/:id/messages", requirePermission("run:run"), async (c) => {
  const body = await c.req
    .json<{ content?: string }>()
    .catch(() => ({}) as { content?: string });
  const content = (body.content ?? "").trim();
  if (!content) return c.json({ error: "content_required" }, 400);
  const res = await sendChatMessage(c.get("teamId"), c.req.param("id"), content);
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json(res, 202);
});
