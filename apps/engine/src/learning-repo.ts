import { and, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { deterministicReview } from "./review-agent";
import type {
  CreatedBy,
  KnowledgeScope,
  MemoryPolicy,
  ProposedMemoryChange,
  ProposedSkillChange,
  ReviewAgentOutput,
  RunReviewStatus,
  RuntimeKind,
  SkillPolicy,
  ToolGrant,
} from "@agentik/workflow-schema";

const {
  agents,
  agentVersions,
  memoryEntries,
  memoryEvents,
  skills,
  skillVersions,
  runReviews,
  agentTasks,
  taskMessages,
  projects,
  chatMessages,
  chatSessions,
} =
  schema;

/* ── Pure helpers (offline-testable — no DB/network) ─────────────────── */

/** Next monotonic version given existing version numbers. Starts at 1. */
export function nextVersion(existing: number[]): number {
  return existing.reduce((max, v) => (v > max ? v : max), 0) + 1;
}

/** Bound memory injection by policy: allowed scope, confidence ≥ min, highest-confidence first, capped. */
export function selectMemoriesForInjection<T extends { scope: KnowledgeScope; confidence: number }>(
  entries: T[],
  policy: MemoryPolicy,
): T[] {
  if (!policy.inject) return [];
  const allowed = new Set<string>(policy.scopes);
  return entries
    .filter((e) => allowed.has(e.scope) && e.confidence >= policy.minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(0, policy.maxEntries));
}

/** Bound skill injection by policy: allowed scope, capped. */
export function selectSkillsForInjection<T extends { scope: KnowledgeScope }>(
  list: T[],
  policy: SkillPolicy,
): T[] {
  if (!policy.inject) return [];
  const allowed = new Set<string>(policy.scopes);
  return list.filter((s) => allowed.has(s.scope)).slice(0, Math.max(0, policy.maxSkills));
}

/* ── Tenancy guard ───────────────────────────────────────────────────── */

async function agentBelongsToTeam(teamId: string, agentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  return Boolean(row);
}

/* ── Agent versions (immutable, monotonic per agent) ─────────────────── */

export type CreateAgentVersionInput = {
  model?: string;
  instructions: string;
  tools: string[];
  toolGrants?: ToolGrant[];
  runtimeKind: RuntimeKind;
  memoryPolicy: MemoryPolicy;
  skillPolicy: SkillPolicy;
  createdBy?: CreatedBy;
  changelog?: string;
};

export async function createAgentVersion(teamId: string, agentId: string, input: CreateAgentVersionInput) {
  if (!(await agentBelongsToTeam(teamId, agentId))) return null;
  const existing = await db
    .select({ version: agentVersions.version })
    .from(agentVersions)
    .where(eq(agentVersions.agentId, agentId));
  const version = nextVersion(existing.map((r) => r.version));
  const id = genId("aver");
  await db.insert(agentVersions).values({
    id,
    agentId,
    version,
    model: input.model,
    instructions: input.instructions,
    tools: input.tools,
    toolGrants: input.toolGrants ?? input.tools.map((toolId) => ({ toolId, scopes: ["read"] })),
    runtimeKind: input.runtimeKind,
    memoryPolicy: input.memoryPolicy,
    skillPolicy: input.skillPolicy,
    createdBy: input.createdBy ?? "user",
    changelog: input.changelog,
  });
  return { id, version };
}

export async function listAgentVersions(teamId: string, agentId: string) {
  if (!(await agentBelongsToTeam(teamId, agentId))) return [];
  return db.select().from(agentVersions).where(eq(agentVersions.agentId, agentId)).orderBy(desc(agentVersions.version));
}

/* ── Memory entries ──────────────────────────────────────────────────── */

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

function proposedMemorySnapshot(change: ProposedMemoryChange, sourceRunId: string | undefined) {
  return {
    scope: change.scope,
    targetId: change.targetId,
    content: change.content,
    sourceRunId,
    confidence: change.confidence,
    createdBy: "review_agent",
  };
}

async function insertMemoryFromReviewTx(
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

export async function insertConfirmedMemory(input: {
  teamId: string;
  scope: KnowledgeScope;
  targetId?: string;
  content: string;
  confidence?: number;
  sourceRunId?: string;
  createdBy?: CreatedBy;
}) {
  const created = await createMemory({
    teamId: input.teamId,
    scope: input.scope,
    targetId: input.targetId,
    content: input.content,
    confidence: input.confidence ?? 1,
    sourceRunId: input.sourceRunId,
    actorId: input.createdBy ?? "user",
    createdBy: input.createdBy ?? "user",
  });
  if ("error" in created) return { error: created.error };
  return { id: created.memory.id };
}

/* ── Skills + skill versions ─────────────────────────────────────────── */

export async function listSkills(teamId: string, filter: { scope?: KnowledgeScope; targetId?: string } = {}) {
  const wheres = [eq(skills.teamId, teamId)];
  if (filter.scope) wheres.push(eq(skills.scope, filter.scope));
  if (filter.targetId) wheres.push(eq(skills.targetId, filter.targetId));
  return db.select().from(skills).where(and(...wheres)).orderBy(desc(skills.updatedAt));
}

export async function listSkillVersions(teamId: string, skillId: string) {
  const [head] = await db
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.teamId, teamId)))
    .limit(1);
  if (!head) return [];
  return db.select().from(skillVersions).where(eq(skillVersions.skillId, skillId)).orderBy(desc(skillVersions.version));
}

/** Create a skill head + its v1 from a "create" proposal. */
export async function createSkillFromProposal(
  teamId: string,
  change: Extract<ProposedSkillChange, { action: "create" }>,
  sourceRunId: string | undefined,
  createdBy: CreatedBy = "review_agent",
) {
  const skillId = genId("skill");
  const versionId = genId("sver");
  await db.insert(skills).values({
    id: skillId,
    teamId,
    name: change.skillName,
    description: change.description,
    scope: change.scope,
    targetId: change.targetId,
    currentVersionId: versionId,
    createdBy,
  });
  await db.insert(skillVersions).values({
    id: versionId,
    skillId,
    version: 1,
    bodyMd: change.bodyMd,
    triggerConditions: change.triggerConditions,
    pitfalls: change.pitfalls,
    verificationSteps: change.verificationSteps,
    sourceRunId,
    createdBy,
  });
  return { skillId, versionId, version: 1 };
}

/** Patch an existing skill → new monotonic version, repoint currentVersionId. */
export async function patchSkillFromProposal(
  teamId: string,
  skillId: string,
  patch: Extract<ProposedSkillChange, { action: "patch" }>,
  sourceRunId: string | undefined,
  createdBy: CreatedBy = "review_agent",
) {
  const [head] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.teamId, teamId)))
    .limit(1);
  if (!head) return null;
  const [current] = head.currentVersionId
    ? await db.select().from(skillVersions).where(eq(skillVersions.id, head.currentVersionId)).limit(1)
    : [];
  const existing = await db
    .select({ version: skillVersions.version })
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skillId));
  const version = nextVersion(existing.map((r) => r.version));
  const versionId = genId("sver");
  const baseBody = current?.bodyMd ?? "";
  const newBody = baseBody.includes(patch.oldText) ? baseBody.replaceAll(patch.oldText, patch.newText) : patch.newText;
  await db.insert(skillVersions).values({
    id: versionId,
    skillId,
    version,
    bodyMd: newBody,
    triggerConditions: current?.triggerConditions ?? [],
    pitfalls: current?.pitfalls ?? [],
    verificationSteps: current?.verificationSteps ?? [],
    sourceRunId,
    changelog: patch.reason,
    createdBy,
  });
  await db.update(skills).set({ currentVersionId: versionId, updatedAt: sql`now()` }).where(eq(skills.id, skillId));
  return { skillId, versionId, version };
}

/* ── Run reviews (propose-only persistence) ──────────────────────────── */

export async function createRunReview(teamId: string, runId: string, output: ReviewAgentOutput) {
  const id = genId("rev");
  await db.insert(runReviews).values({
    id,
    teamId,
    runId,
    status: "pending",
    summary: output.summary,
    riskLevel: output.riskLevel,
    proposedMemories: output.memories,
    proposedSkillChanges: output.skillChanges,
  });
  return { id };
}

/**
 * Generate a review for a finished agent task using the deterministic reviewer, and
 * persist it as a pending run_reviews row. Returns null if the task isn't this team's.
 * Idempotent-friendly: callers may skip if a review already exists for the run.
 */
export async function generateRunReview(teamId: string, taskId: string) {
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.teamId, teamId)))
    .limit(1);
  if (!task) return null;
  const msgs = await db
    .select({ type: taskMessages.type, tool: taskMessages.tool, content: taskMessages.content })
    .from(taskMessages)
    .where(eq(taskMessages.taskId, taskId))
    .orderBy(taskMessages.seq);
  const output = deterministicReview({
    taskId: task.id,
    agentId: task.agentId,
    status: task.status,
    error: task.error,
    messages: msgs,
  });
  const { id } = await createRunReview(teamId, taskId, output);
  return getRunReview(teamId, id);
}

/**
 * Auto-generate the pending review for a finished run exactly once. Called on task
 * completion/failure so the moat loop starts without a manual API call; idempotent
 * (skips if a review already exists for the run). Returns the existing or new review.
 */
export async function ensureRunReview(teamId: string, taskId: string) {
  const existing = await getRunReviewByRunId(teamId, taskId);
  if (existing) return existing;
  return generateRunReview(teamId, taskId);
}

/** List reviews for the org, newest first, optionally filtered by status (for the Review Inbox). */
export async function listRunReviews(teamId: string, status?: RunReviewStatus) {
  const wheres = [eq(runReviews.teamId, teamId)];
  if (status) wheres.push(eq(runReviews.status, status));
  return db.select().from(runReviews).where(and(...wheres)).orderBy(desc(runReviews.createdAt)).limit(200);
}

export async function getRunReviewByRunId(teamId: string, runId: string) {
  const [row] = await db
    .select()
    .from(runReviews)
    .where(and(eq(runReviews.teamId, teamId), eq(runReviews.runId, runId)))
    .orderBy(desc(runReviews.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getRunReview(teamId: string, id: string) {
  const [row] = await db
    .select()
    .from(runReviews)
    .where(and(eq(runReviews.teamId, teamId), eq(runReviews.id, id)))
    .limit(1);
  return row ?? null;
}

export async function setRunReviewStatus(teamId: string, id: string, status: RunReviewStatus) {
  const updated = await db
    .update(runReviews)
    .set({ status, updatedAt: sql`now()` })
    .where(and(eq(runReviews.id, id), eq(runReviews.teamId, teamId)))
    .returning({ id: runReviews.id });
  return Boolean(updated[0]);
}

type RunReviewRow = typeof runReviews.$inferSelect;

/** Stable per-change ids so the UI can approve a subset: memories m0.., skills s0.. */
export function reviewChangeIds(review: Pick<RunReviewRow, "proposedMemories" | "proposedSkillChanges">) {
  return [
    ...review.proposedMemories.map((_, i) => `m${i}`),
    ...review.proposedSkillChanges.map((_, i) => `s${i}`),
  ];
}

/**
 * Apply approved proposals from a pending review, transactionally, then mark it `applied`.
 * This is the ONLY path that mutates production memory/skills (human-approved). When
 * `changeIds` is omitted, all proposals apply; otherwise only the selected ones.
 */
export async function applyRunReview(teamId: string, reviewId: string, changeIds?: string[]) {
  const review = await getRunReview(teamId, reviewId);
  if (!review) return null;
  // Only a still-pending review may be applied (never re-apply, never apply a rejected one).
  if (review.status !== "pending") return { applied: 0, alreadyApplied: true as const };

  const wantMem = (i: number) => !changeIds || changeIds.includes(`m${i}`);
  const wantSkill = (i: number) => !changeIds || changeIds.includes(`s${i}`);
  let applied = 0;
  let claimed = true;

  await db.transaction(async (tx) => {
    // Atomic claim: flip pending→applied only if still pending. If a concurrent approve
    // already claimed it, bail (0 rows) so we never double-write. Rolls back on any error below.
    const got = await tx
      .update(runReviews)
      .set({ status: "applied", updatedAt: sql`now()` })
      .where(and(eq(runReviews.id, reviewId), eq(runReviews.teamId, teamId), eq(runReviews.status, "pending")))
      .returning({ id: runReviews.id });
    if (!got[0]) {
      claimed = false;
      return;
    }
    for (let i = 0; i < review.proposedMemories.length; i++) {
      if (!wantMem(i)) continue;
      const c = review.proposedMemories[i]!;
      await insertMemoryFromReviewTx(tx, teamId, c, review.runId);
      applied++;
    }

    for (let i = 0; i < review.proposedSkillChanges.length; i++) {
      if (!wantSkill(i)) continue;
      const c = review.proposedSkillChanges[i]!;
      if (c.action === "create") {
        const skillId = genId("skill");
        const versionId = genId("sver");
        await tx.insert(skills).values({
          id: skillId,
          teamId,
          name: c.skillName,
          description: c.description,
          scope: c.scope,
          targetId: c.targetId,
          currentVersionId: versionId,
          createdBy: "review_agent",
        });
        await tx.insert(skillVersions).values({
          id: versionId,
          skillId,
          version: 1,
          bodyMd: c.bodyMd,
          triggerConditions: c.triggerConditions,
          pitfalls: c.pitfalls,
          verificationSteps: c.verificationSteps,
          sourceRunId: review.runId,
          createdBy: "review_agent",
        });
        applied++;
      } else if (c.skillId) {
        // patch → append a new version to the named skill (team-scoped)
        const [head] = await tx
          .select()
          .from(skills)
          .where(and(eq(skills.id, c.skillId), eq(skills.teamId, teamId)))
          .limit(1);
        if (!head) continue;
        const [current] = head.currentVersionId
          ? await tx.select().from(skillVersions).where(eq(skillVersions.id, head.currentVersionId)).limit(1)
          : [];
        const existing = await tx
          .select({ version: skillVersions.version })
          .from(skillVersions)
          .where(eq(skillVersions.skillId, c.skillId));
        const version = nextVersion(existing.map((r) => r.version));
        const versionId = genId("sver");
        const baseBody = current?.bodyMd ?? "";
        const newBody = baseBody.includes(c.oldText) ? baseBody.replaceAll(c.oldText, c.newText) : c.newText;
        await tx.insert(skillVersions).values({
          id: versionId,
          skillId: c.skillId,
          version,
          bodyMd: newBody,
          triggerConditions: current?.triggerConditions ?? [],
          pitfalls: current?.pitfalls ?? [],
          verificationSteps: current?.verificationSteps ?? [],
          sourceRunId: review.runId,
          changelog: c.reason,
          createdBy: "review_agent",
        });
        await tx.update(skills).set({ currentVersionId: versionId, updatedAt: sql`now()` }).where(eq(skills.id, c.skillId));
        applied++;
      }
    }
    // status was already flipped to "applied" by the atomic claim above.
  });

  if (!claimed) return { applied: 0, alreadyApplied: true as const };
  return { applied, alreadyApplied: false as const };
}

/* ── Injection (Phase E) — bounded memory/skills for a run's RuntimeContext ──── */

export type InjectionContext = {
  memories: { content: string; confidence: number; scope: KnowledgeScope }[];
  skills: { name: string; bodyMd: string; triggerConditions: string[] }[];
  /** The agent live version's base config, threaded to the runtime (not "learned" context). */
  systemPrompt?: string;
  model?: string;
};

/**
 * Resolve the bounded knowledge to inject into the agent's next run, per its live
 * version's memory/skill policies. Agent-scoped knowledge only matches THIS agent.
 * Bounded by maxEntries/maxSkills/minConfidence — no unbounded context growth.
 */
export async function resolveInjectionContext(teamId: string, agentId: string): Promise<InjectionContext> {
  const [agent] = await db
    .select({ liveVersionId: agents.liveVersionId })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent?.liveVersionId) return { memories: [], skills: [] };
  const [ver] = await db.select().from(agentVersions).where(eq(agentVersions.id, agent.liveVersionId)).limit(1);
  if (!ver) return { memories: [], skills: [] };

  const memRows = await listMemory(teamId, {});
  const memCandidates = memRows.filter((m) => m.scope !== "agent" || m.targetId === agentId);
  const mems = selectMemoriesForInjection(
    memCandidates.map((m) => ({ scope: m.scope, confidence: m.confidence, content: m.content })),
    ver.memoryPolicy,
  );

  const skillRows = await listSkills(teamId, {});
  const skillCandidates = skillRows.filter((s) => s.scope !== "agent" || s.targetId === agentId);
  const chosen = selectSkillsForInjection(skillCandidates, ver.skillPolicy);
  const outSkills: InjectionContext["skills"] = [];
  for (const s of chosen) {
    if (!s.currentVersionId) continue;
    const [sv] = await db.select().from(skillVersions).where(eq(skillVersions.id, s.currentVersionId)).limit(1);
    if (sv) outSkills.push({ name: s.name, bodyMd: sv.bodyMd, triggerConditions: sv.triggerConditions });
  }

  return {
    memories: mems.map((m) => ({ content: m.content, confidence: m.confidence, scope: m.scope })),
    skills: outSkills,
    systemPrompt: ver.instructions || undefined,
    model: ver.model ?? undefined,
  };
}

export async function resolveMemoryInjectionPreview(teamId: string, agentId: string) {
  const [agent] = await db
    .select({
      id: agents.id,
      name: agents.name,
      liveVersionId: agents.liveVersionId,
    })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent?.liveVersionId) return null;
  const [ver] = await db
    .select()
    .from(agentVersions)
    .where(eq(agentVersions.id, agent.liveVersionId))
    .limit(1);
  if (!ver) return null;
  const ctx = await resolveInjectionContext(teamId, agentId);
  return {
    agent: { id: agent.id, name: agent.name },
    memoryPolicy: ver.memoryPolicy,
    skillPolicy: ver.skillPolicy,
    memories: ctx.memories,
    skills: ctx.skills,
  };
}

export async function searchChatMemory(teamId: string, q: string, limit = 30) {
  const query = q.trim();
  if (!query) return [];
  return db
    .select({
      messageId: chatMessages.id,
      sessionId: chatMessages.chatSessionId,
      role: chatMessages.role,
      content: chatMessages.content,
      taskId: chatMessages.taskId,
      createdAt: chatMessages.createdAt,
      agentId: chatSessions.agentId,
      agentName: agents.name,
      sessionTitle: chatSessions.title,
    })
    .from(chatMessages)
    .innerJoin(chatSessions, eq(chatMessages.chatSessionId, chatSessions.id))
    .leftJoin(agents, eq(chatSessions.agentId, agents.id))
    .where(
      and(
        eq(chatSessions.teamId, teamId),
        ilike(chatMessages.content, `%${query}%`),
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

/** Format injected context as a compact prompt preamble. Empty when nothing to inject. */
export function buildInjectionPreamble(ctx: InjectionContext): string {
  if (ctx.memories.length === 0 && ctx.skills.length === 0) return "";
  const lines: string[] = ["# Learned context (from past runs, human-approved)"];
  if (ctx.memories.length) {
    lines.push("", "## Memory");
    for (const m of ctx.memories) lines.push(`- ${m.content}`);
  }
  if (ctx.skills.length) {
    lines.push("", "## Skills");
    for (const s of ctx.skills) {
      lines.push(`### ${s.name}`);
      if (s.triggerConditions.length) lines.push(`When: ${s.triggerConditions.join("; ")}`);
      lines.push(s.bodyMd);
    }
  }
  return `${lines.join("\n")}\n\n---\n\n`;
}
