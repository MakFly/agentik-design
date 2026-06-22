import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
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
} from "@agentik/workflow-schema";

const { agents, agentVersions, memoryEntries, skills, skillVersions, runReviews } = schema;

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

export async function listMemory(teamId: string, filter: { scope?: KnowledgeScope; targetId?: string } = {}) {
  const wheres = [eq(memoryEntries.teamId, teamId)];
  if (filter.scope) wheres.push(eq(memoryEntries.scope, filter.scope));
  if (filter.targetId) wheres.push(eq(memoryEntries.targetId, filter.targetId));
  return db.select().from(memoryEntries).where(and(...wheres)).orderBy(desc(memoryEntries.createdAt));
}

export async function insertMemoryFromProposal(
  teamId: string,
  change: ProposedMemoryChange,
  sourceRunId: string | undefined,
  createdBy: CreatedBy = "review_agent",
) {
  const id = genId("mem");
  await db.insert(memoryEntries).values({
    id,
    teamId,
    scope: change.scope,
    targetId: change.targetId,
    content: change.content,
    sourceRunId,
    confidence: change.confidence,
    createdBy,
  });
  return { id };
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
  const newBody = baseBody.includes(patch.oldText) ? baseBody.replace(patch.oldText, patch.newText) : patch.newText;
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
