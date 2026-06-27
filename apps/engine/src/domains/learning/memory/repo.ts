import { and, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { db, schema } from "../../../infra/db/client";
import { genId } from "../../../infra/db/ids";
import type { CreatedBy, KnowledgeScope, ProposedMemoryChange } from "@agentik/workflow-schema";

const { agents, memoryEntries, memoryEvents, projects } = schema;

export type ListMemoryFilter = {
  scope?: KnowledgeScope;
  targetId?: string;
  createdBy?: CreatedBy;
  q?: string;
  includeArchived?: boolean;
  limit?: number;
};

export async function listMemory(teamId: string, filter: ListMemoryFilter = {}) {
  const wheres = [eq(memoryEntries.teamId, teamId)];
  if (filter.scope) wheres.push(eq(memoryEntries.scope, filter.scope));
  if (filter.targetId) wheres.push(eq(memoryEntries.targetId, filter.targetId));
  if (filter.createdBy) wheres.push(eq(memoryEntries.createdBy, filter.createdBy));
  if (!filter.includeArchived) wheres.push(isNull(memoryEntries.archivedAt));
  const q = filter.q?.trim();
  if (q) wheres.push(ilike(memoryEntries.content, `%${q}%`));
  return db
    .select()
    .from(memoryEntries)
    .where(and(...wheres))
    .orderBy(desc(memoryEntries.createdAt))
    .limit(Math.min(Math.max(filter.limit ?? 200, 1), 500));
}

async function assertMemoryTarget(teamId: string, scope: KnowledgeScope, targetId?: string | null) {
  if (scope === "team") return targetId ? "team_target_forbidden" : null;
  if (scope === "project") {
    if (!targetId) return "target_required";
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, targetId), eq(projects.teamId, teamId)))
      .limit(1);
    return project ? null : "target_not_found";
  }
  if (scope === "agent") {
    if (!targetId) return "target_required";
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, targetId), eq(agents.teamId, teamId)))
      .limit(1);
    return agent ? null : "target_not_found";
  }
  return "unsupported_scope";
}

function clampConfidence(value: unknown, fallback = 1) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, n));
}

function memorySnapshot(row: typeof memoryEntries.$inferSelect | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    scope: row.scope,
    targetId: row.targetId,
    content: row.content,
    sourceRunId: row.sourceRunId,
    confidence: row.confidence,
    createdBy: row.createdBy,
    lastEditedBy: row.lastEditedBy,
    archivedAt: row.archivedAt,
    archivedBy: row.archivedBy,
  };
}

async function recordMemoryEvent(input: {
  teamId: string;
  memoryId: string;
  action: typeof memoryEvents.$inferInsert.action;
  actorId: string;
  before?: typeof memoryEntries.$inferSelect | null;
  after?: typeof memoryEntries.$inferSelect | null;
}) {
  await db.insert(memoryEvents).values({
    id: genId("mevt"),
    teamId: input.teamId,
    memoryId: input.memoryId,
    action: input.action,
    actorId: input.actorId,
    before: memorySnapshot(input.before),
    after: memorySnapshot(input.after),
  });
}

export type MemoryMutationResult =
  | { memory: typeof memoryEntries.$inferSelect }
  | { error: "content_required" | "content_too_long" | "target_required" | "target_not_found" | "team_target_forbidden" | "unsupported_scope" | "not_found" };

export async function createMemory(input: {
  teamId: string;
  scope: KnowledgeScope;
  targetId?: string | null;
  content: string;
  confidence?: number;
  sourceRunId?: string | null;
  actorId: string;
  createdBy?: CreatedBy;
}): Promise<MemoryMutationResult> {
  const content = input.content.trim();
  if (!content) return { error: "content_required" };
  if (content.length > 4_000) return { error: "content_too_long" };
  const targetError = await assertMemoryTarget(input.teamId, input.scope, input.targetId);
  if (targetError) return { error: targetError };
  const [memory] = await db
    .insert(memoryEntries)
    .values({
      id: genId("mem"),
      teamId: input.teamId,
      scope: input.scope,
      targetId: input.scope === "team" ? null : input.targetId ?? null,
      content,
      sourceRunId: input.sourceRunId ?? null,
      confidence: clampConfidence(input.confidence),
      createdBy: input.createdBy ?? "user",
      lastEditedBy: input.actorId,
    })
    .returning();
  await recordMemoryEvent({
    teamId: input.teamId,
    memoryId: memory!.id,
    action: "create",
    actorId: input.actorId,
    after: memory,
  });
  return { memory: memory! };
}

export async function updateMemory(input: {
  teamId: string;
  memoryId: string;
  actorId: string;
  scope?: KnowledgeScope;
  targetId?: string | null;
  content?: string;
  confidence?: number;
}): Promise<MemoryMutationResult> {
  const [before] = await db
    .select()
    .from(memoryEntries)
    .where(and(eq(memoryEntries.teamId, input.teamId), eq(memoryEntries.id, input.memoryId)))
    .limit(1);
  if (!before) return { error: "not_found" };
  const nextScope = input.scope ?? before.scope;
  const nextTargetId =
    input.scope === "team" ? null : input.targetId !== undefined ? input.targetId : before.targetId;
  const targetError = await assertMemoryTarget(input.teamId, nextScope, nextTargetId);
  if (targetError) return { error: targetError };
  const nextContent = input.content !== undefined ? input.content.trim() : before.content;
  if (!nextContent) return { error: "content_required" };
  if (nextContent.length > 4_000) return { error: "content_too_long" };
  const [memory] = await db
    .update(memoryEntries)
    .set({
      scope: nextScope,
      targetId: nextScope === "team" ? null : nextTargetId ?? null,
      content: nextContent,
      confidence: input.confidence !== undefined ? clampConfidence(input.confidence, before.confidence) : before.confidence,
      lastEditedBy: input.actorId,
      updatedAt: sql`now()`,
    })
    .where(and(eq(memoryEntries.teamId, input.teamId), eq(memoryEntries.id, input.memoryId)))
    .returning();
  await recordMemoryEvent({
    teamId: input.teamId,
    memoryId: input.memoryId,
    action: "update",
    actorId: input.actorId,
    before,
    after: memory,
  });
  return { memory: memory! };
}

export async function archiveMemory(teamId: string, memoryId: string, actorId: string) {
  const [before] = await db
    .select()
    .from(memoryEntries)
    .where(and(eq(memoryEntries.teamId, teamId), eq(memoryEntries.id, memoryId)))
    .limit(1);
  if (!before) return { error: "not_found" as const };
  const [memory] = await db
    .update(memoryEntries)
    .set({ archivedAt: sql`now()`, archivedBy: actorId, updatedAt: sql`now()` })
    .where(and(eq(memoryEntries.teamId, teamId), eq(memoryEntries.id, memoryId)))
    .returning();
  await recordMemoryEvent({ teamId, memoryId, action: "archive", actorId, before, after: memory });
  return { memory: memory! };
}

export async function restoreMemory(teamId: string, memoryId: string, actorId: string) {
  const [before] = await db
    .select()
    .from(memoryEntries)
    .where(and(eq(memoryEntries.teamId, teamId), eq(memoryEntries.id, memoryId)))
    .limit(1);
  if (!before) return { error: "not_found" as const };
  const [memory] = await db
    .update(memoryEntries)
    .set({ archivedAt: null, archivedBy: null, updatedAt: sql`now()` })
    .where(and(eq(memoryEntries.teamId, teamId), eq(memoryEntries.id, memoryId)))
    .returning();
  await recordMemoryEvent({ teamId, memoryId, action: "restore", actorId, before, after: memory });
  return { memory: memory! };
}

export async function listMemoryEvents(teamId: string, memoryId?: string) {
  const wheres = [eq(memoryEvents.teamId, teamId)];
  if (memoryId) wheres.push(eq(memoryEvents.memoryId, memoryId));
  return db.select().from(memoryEvents).where(and(...wheres)).orderBy(desc(memoryEvents.createdAt)).limit(200);
}

export async function insertMemoryFromProposal(
  teamId: string,
  change: ProposedMemoryChange,
  sourceRunId: string | undefined,
  createdBy: CreatedBy = "review_agent",
) {
  const [memory] = await db.insert(memoryEntries).values({
    id: genId("mem"),
    teamId,
    scope: change.scope,
    targetId: change.targetId,
    content: change.content,
    sourceRunId,
    confidence: change.confidence,
    createdBy,
    lastEditedBy: createdBy,
  }).returning();
  await recordMemoryEvent({
    teamId,
    memoryId: memory!.id,
    action: "create",
    actorId: createdBy,
    after: memory,
  });
  return { id: memory!.id };
}

export function proposedMemorySnapshot(change: ProposedMemoryChange, sourceRunId: string | undefined) {
  return {
    scope: change.scope,
    targetId: change.targetId,
    content: change.content,
    sourceRunId,
    confidence: change.confidence,
    createdBy: "review_agent",
  };
}

export async function insertMemoryFromReviewTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  teamId: string,
  change: ProposedMemoryChange,
  sourceRunId: string | undefined,
) {
  const id = genId("mem");
  await tx.insert(memoryEntries).values({
    id,
    teamId,
    scope: change.scope,
    targetId: change.targetId,
    content: change.content,
    sourceRunId,
    confidence: change.confidence,
    createdBy: "review_agent",
    lastEditedBy: "review_agent",
  });
  await tx.insert(memoryEvents).values({
    id: genId("mevt"),
    teamId,
    memoryId: id,
    action: "create",
    actorId: "review_agent",
    after: proposedMemorySnapshot(change, sourceRunId),
  });
}
