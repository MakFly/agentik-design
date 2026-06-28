import { Hono } from "hono";
import {
  requirePermission,
  type AuthVars,
} from "../../app/middleware/auth";
import { jsonValidationError, parseJsonBody } from "../../infra/validation";
import {
  createRule,
  createSignal,
  deleteRule,
  deleteSignal,
  dispatchSignal,
  listDeliveries,
  listRules,
  listSignals,
  updateRule,
  updateSignal,
} from "./repo";
import {
  createRuleBody,
  createSignalBody,
  dispatchSignalBody,
  updateRuleBody,
  updateSignalBody,
} from "./schemas";

export const signalsRoutes = new Hono<{ Variables: AuthVars }>();

signalsRoutes.get("/signals", requirePermission("run:read"), async (c) => {
  const items = await listSignals(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

signalsRoutes.post("/signals", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(createSignalBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  return c.json(await createSignal(c.get("teamId"), parsed.data), 201);
});

signalsRoutes.patch("/signals/:id", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(updateSignalBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const signal = await updateSignal(c.get("teamId"), c.req.param("id"), parsed.data);
  if (!signal) return c.json({ error: "not_found" }, 404);
  return c.json(signal);
});

signalsRoutes.delete("/signals/:id", requirePermission("settings:update"), async (c) => {
  const ok = await deleteSignal(c.get("teamId"), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

signalsRoutes.post("/signals/:id/dispatch", requirePermission("run:run"), async (c) => {
  const parsed = parseJsonBody(dispatchSignalBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const result = await dispatchSignal(c.get("teamId"), c.req.param("id"), parsed.data);
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json(result, 202);
});

signalsRoutes.get("/deliveries", requirePermission("run:read"), async (c) => {
  return c.json(await listDeliveries(c.get("teamId")));
});

signalsRoutes.get("/rules", requirePermission("run:read"), async (c) => {
  const items = await listRules(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

signalsRoutes.post("/rules", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(createRuleBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  return c.json(await createRule(c.get("teamId"), parsed.data), 201);
});

signalsRoutes.patch("/rules/:id", requirePermission("settings:update"), async (c) => {
  const parsed = parseJsonBody(updateRuleBody, await c.req.json().catch(() => null));
  if (!parsed.success) return jsonValidationError(c, parsed.error);
  const rule = await updateRule(c.get("teamId"), c.req.param("id"), parsed.data);
  if (!rule) return c.json({ error: "not_found" }, 404);
  return c.json(rule);
});

signalsRoutes.delete("/rules/:id", requirePermission("settings:update"), async (c) => {
  const ok = await deleteRule(c.get("teamId"), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
