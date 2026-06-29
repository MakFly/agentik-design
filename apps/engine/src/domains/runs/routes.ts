import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  requirePermission,
  type AuthVars,
} from "../../app/middleware/auth";
import {
  approveRun,
  cancelRun,
  pauseRun,
  rejectRun,
  requestRunApproval,
  resumeRun,
  retryRun,
} from "./controls";
import { streamRunLive } from "./live-stream";
import { getRunDetail, listRunEvents, listRuns } from "./repo";

export const runsRoutes = new Hono<{ Variables: AuthVars }>();

runsRoutes.get("/runs", async (c) => {
  const items = await listRuns(c.get("teamId"), {
    status: c.req.query("status") ?? undefined,
    agentId: c.req.query("agentId") ?? undefined,
  });
  return c.json({ items, nextCursor: null, total: items.length });
});

runsRoutes.get("/runs/:id", async (c) => {
  const detail = await getRunDetail(c.get("teamId"), c.req.param("id"));
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

// V2 event ledger for a run — audit / replay / export. `?after=<seq>` for paging.
runsRoutes.get("/runs/:id/events", async (c) => {
  const after = Number(c.req.query("after") ?? 0);
  const events = await listRunEvents(
    c.get("teamId"),
    c.req.param("id"),
    Number.isFinite(after) ? after : 0,
  );
  if (events === null) return c.json({ error: "not_found" }, 404);
  return c.json({ items: events, total: events.length });
});

runsRoutes.post("/runs/:id/cancel", requirePermission("run:control"), async (c) => {
  const ok = await cancelRun(c.get("teamId"), c.req.param("id"));
  return c.json({ ok }, ok ? 200 : 404);
});

runsRoutes.post("/runs/:id/pause", requirePermission("run:control"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const ok = await pauseRun(c.get("teamId"), c.req.param("id"), body.reason);
  return c.json({ ok }, ok ? 200 : 409);
});

runsRoutes.post("/runs/:id/resume", requirePermission("run:control"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const ok = await resumeRun(c.get("teamId"), c.req.param("id"), body.reason);
  return c.json({ ok }, ok ? 200 : 409);
});

runsRoutes.post(
  "/runs/:id/approval/request",
  requirePermission("run:control"),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      message?: string;
      context?: Record<string, unknown>;
    };
    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : "Operator approval required.";
    const ok = await requestRunApproval(
      c.get("teamId"),
      c.req.param("id"),
      message,
      body.context,
    );
    return c.json({ ok }, ok ? 202 : 409);
  },
);

runsRoutes.post("/runs/:id/approve", requirePermission("run:approve"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const ok = await approveRun(c.get("teamId"), c.req.param("id"), body.reason);
  return c.json({ ok }, ok ? 202 : 409);
});

runsRoutes.post("/runs/:id/reject", requirePermission("run:approve"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const ok = await rejectRun(c.get("teamId"), c.req.param("id"), body.reason);
  return c.json({ ok }, ok ? 202 : 409);
});

runsRoutes.post("/runs/:id/retry", requirePermission("run:run"), async (c) => {
  const res = await retryRun(c.get("teamId"), c.req.param("id"));
  if (!res) return c.json({ error: "not_found" }, 404);
  if ("error" in res) return c.json(res, 402);
  return c.json(res, 202);
});

runsRoutes.get("/runs/:id/live", (c) => {
  const id = c.req.param("id");
  const teamId = c.get("teamId");
  const lastId = c.req.query("lastEventId");
  const resumeAfter =
    lastId && Number.isFinite(Number(lastId)) ? Number(lastId) : -1;
  return streamSSE(c, (stream) => streamRunLive(stream, id, teamId, resumeAfter));
});
