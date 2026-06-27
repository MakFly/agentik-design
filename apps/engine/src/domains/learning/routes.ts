import { Hono } from "hono";
import { createAgentVersionInput } from "@agentik/workflow-schema";
import type { KnowledgeScope, RunReviewStatus } from "@agentik/workflow-schema";
import { requirePermission, type AuthVars } from "../../app/middleware/auth";
import {
  applyRunReview,
  archiveMemory,
  createAgentVersion,
  createMemory,
  generateRunReview,
  getRunReviewByRunId,
  listAgentVersions,
  listMemory,
  listMemoryEvents,
  listRunReviews,
  listSkills,
  listSkillVersions,
  resolveMemoryInjectionPreview,
  restoreMemory,
  reviewChangeIds,
  searchChatMemory,
  setRunReviewStatus,
  updateMemory,
} from "./index";

function withChangeIds(
  review: {
    proposedMemories: unknown[];
    proposedSkillChanges: unknown[];
  } & Record<string, unknown>,
) {
  return {
    ...review,
    proposedMemories: review.proposedMemories.map((m, i) => ({
      changeId: `m${i}`,
      ...(m as object),
    })),
    proposedSkillChanges: review.proposedSkillChanges.map((s, i) => ({
      changeId: `s${i}`,
      ...(s as object),
    })),
    changeIds: reviewChangeIds(review as never),
  };
}

export const learningRoutes = new Hono<{ Variables: AuthVars }>();

learningRoutes.get("/agents/:id/versions", requirePermission("agent:read"), async (c) => {
  const items = await listAgentVersions(c.get("teamId"), c.req.param("id"));
  return c.json({ items, total: items.length });
});

learningRoutes.post(
  "/agents/:id/versions",
  requirePermission("agent:create"),
  async (c) => {
    const parsed = createAgentVersionInput.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success)
      return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
    const res = await createAgentVersion(
      c.get("teamId"),
      c.req.param("id"),
      parsed.data,
    );
    if (!res) return c.json({ error: "not_found" }, 404);
    return c.json(res, 201);
  },
);

learningRoutes.post("/runs/:id/review", requirePermission("run:run"), async (c) => {
  const existing = await getRunReviewByRunId(c.get("teamId"), c.req.param("id"));
  if (existing) return c.json(withChangeIds(existing));
  const review = await generateRunReview(c.get("teamId"), c.req.param("id"));
  if (!review) return c.json({ error: "not_found" }, 404);
  return c.json(withChangeIds(review), 201);
});

learningRoutes.get("/runs/:id/review", requirePermission("review:read"), async (c) => {
  const review = await getRunReviewByRunId(c.get("teamId"), c.req.param("id"));
  if (!review) return c.json({ error: "not_found" }, 404);
  return c.json(withChangeIds(review));
});

learningRoutes.get("/run-reviews", requirePermission("review:read"), async (c) => {
  const status = c.req.query("status") as RunReviewStatus | undefined;
  const rows = await listRunReviews(c.get("teamId"), status);
  return c.json({ items: rows.map(withChangeIds), total: rows.length });
});

learningRoutes.post(
  "/run-reviews/:id/approve",
  requirePermission("review:approve"),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { changeIds?: string[] };
    const res = await applyRunReview(c.get("teamId"), c.req.param("id"), body.changeIds);
    if (!res) return c.json({ error: "not_found" }, 404);
    return c.json({ status: "applied", ...res });
  },
);

learningRoutes.post(
  "/run-reviews/:id/reject",
  requirePermission("review:approve"),
  async (c) => {
    const ok = await setRunReviewStatus(c.get("teamId"), c.req.param("id"), "rejected");
    return c.json({ status: "rejected", ok }, ok ? 200 : 404);
  },
);

learningRoutes.get("/memory", requirePermission("memory:read"), async (c) => {
  const items = await listMemory(c.get("teamId"), {
    scope: (c.req.query("scope") as KnowledgeScope) || undefined,
    targetId: c.req.query("targetId") ?? undefined,
    createdBy: (c.req.query("createdBy") as never) || undefined,
    q: c.req.query("q") ?? undefined,
    includeArchived: c.req.query("includeArchived") === "true",
    limit: Number(c.req.query("limit") ?? 200),
  });
  return c.json({ items, total: items.length });
});

learningRoutes.post("/memory", requirePermission("memory:create"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    scope?: KnowledgeScope;
    targetId?: string | null;
    content?: string;
    confidence?: number;
  };
  const res = await createMemory({
    teamId: c.get("teamId"),
    scope: body.scope ?? "team",
    targetId: body.targetId ?? null,
    content: body.content ?? "",
    confidence: body.confidence,
    actorId: c.get("auth").userId,
    createdBy: "user",
  });
  if ("error" in res) return c.json(res, res.error === "target_not_found" ? 404 : 400);
  return c.json(res.memory, 201);
});

learningRoutes.patch("/memory/:id", requirePermission("memory:update"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    scope?: KnowledgeScope;
    targetId?: string | null;
    content?: string;
    confidence?: number;
  };
  const res = await updateMemory({
    teamId: c.get("teamId"),
    memoryId: c.req.param("id"),
    actorId: c.get("auth").userId,
    scope: body.scope,
    targetId: body.targetId,
    content: body.content,
    confidence: body.confidence,
  });
  if ("error" in res)
    return c.json(res, res.error === "not_found" || res.error === "target_not_found" ? 404 : 400);
  return c.json(res.memory);
});

learningRoutes.delete("/memory/:id", requirePermission("memory:delete"), async (c) => {
  const res = await archiveMemory(c.get("teamId"), c.req.param("id"), c.get("auth").userId);
  if ("error" in res) return c.json(res, 404);
  return c.json(res.memory);
});

learningRoutes.post("/memory/:id/restore", requirePermission("memory:update"), async (c) => {
  const res = await restoreMemory(c.get("teamId"), c.req.param("id"), c.get("auth").userId);
  if ("error" in res) return c.json(res, 404);
  return c.json(res.memory);
});

learningRoutes.get("/memory/events", requirePermission("memory:read"), async (c) => {
  const items = await listMemoryEvents(c.get("teamId"), c.req.query("memoryId") ?? undefined);
  return c.json({ items, total: items.length });
});

learningRoutes.get("/memory/injection-preview", requirePermission("memory:read"), async (c) => {
  const agentId = c.req.query("agentId");
  if (!agentId) return c.json({ error: "agent_required" }, 400);
  const preview = await resolveMemoryInjectionPreview(c.get("teamId"), agentId);
  if (!preview) return c.json({ error: "not_found" }, 404);
  return c.json(preview);
});

learningRoutes.get("/memory/session-search", requirePermission("memory:read"), async (c) => {
  const items = await searchChatMemory(
    c.get("teamId"),
    c.req.query("q") ?? "",
    Number(c.req.query("limit") ?? 30),
  );
  return c.json({ items, total: items.length });
});

learningRoutes.get("/skills", requirePermission("skill:read"), async (c) => {
  const items = await listSkills(c.get("teamId"), {
    scope: (c.req.query("scope") as KnowledgeScope) || undefined,
    targetId: c.req.query("targetId") ?? undefined,
  });
  return c.json({ items, total: items.length });
});

learningRoutes.get("/skills/:id/versions", requirePermission("skill:read"), async (c) => {
  const items = await listSkillVersions(c.get("teamId"), c.req.param("id"));
  return c.json({ items, total: items.length });
});
