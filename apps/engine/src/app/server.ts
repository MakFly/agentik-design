import { Hono } from "hono";
import { cors } from "hono/cors";
import { agentsRoutes } from "../domains/agents/routes";
import { channelsRoutes } from "../domains/channels/routes";
import { chatRoutes } from "../domains/chat/routes";
import { learningRoutes } from "../domains/learning/routes";
import { mcpRoutes } from "../domains/mcp/routes";
import { projectsRoutes } from "../domains/projects/routes";
import { runsRoutes } from "../domains/runs/routes";
import { settingsRoutes } from "../domains/settings/routes";
import { signalsRoutes } from "../domains/signals/routes";
import { workflowsRoutes } from "../domains/workflows/routes";
import { daemon } from "../execution/daemon/routes";
import { auth } from "../gateway/routes/auth";
import { handleTelegramWebhookSecret } from "../domains/channels/service";
import { ingestSignalWebhook } from "../domains/signals/service";
import { observationRoutes } from "../observation/routes";
import { withAuth, type AuthVars } from "./middleware/auth";
import { rateLimit } from "./middleware/rate-limit";
import { devRoutes } from "./dev-routes";
import { env } from "../infra/env";

const app = new Hono();

app.use("*", cors());

app.get("/api/v1/health", (c) => c.json({ ok: true, service: "engine" }));

const api = new Hono<{ Variables: AuthVars }>();
api.use("*", withAuth);
// Per-team throttle on the authenticated API (after auth so we key by tenant).
// /daemon and /health are mounted elsewhere and stay unthrottled.
api.use("*", rateLimit({ windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX }));

api.route("/", workflowsRoutes);
api.route("/", agentsRoutes);
api.route("/", projectsRoutes);
api.route("/", channelsRoutes);
api.route("/", observationRoutes);
api.route("/", mcpRoutes);
api.route("/", learningRoutes);
api.route("/", settingsRoutes);
api.route("/", runsRoutes);
api.route("/", chatRoutes);
api.route("/", signalsRoutes);

// Dev/test surface (seed + run simulator). Never mounted in production.
if (env.AUTH_DEV_HEADERS) api.route("/", devRoutes);

app.route("/api/v1/auth", auth);

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

// Unauthenticated external signal ingestion (Gmail push / CRM / Stripe …). The
// per-signal token authorizes; no session. Mounted on app so it bypasses withAuth.
app.post("/api/v1/signals/ingest/:token", async (c) => {
  const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await ingestSignalWebhook(c.req.param("token"), payload);
  if (!result) return c.json({ ok: false, error: "unknown_token" }, 404);
  return c.json({ ok: true, ...result });
});

app.route("/api/v1", api);
app.route("/daemon", daemon);

export default app;
