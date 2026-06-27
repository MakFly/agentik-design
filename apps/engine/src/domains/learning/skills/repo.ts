import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../../infra/db/client";
import { genId } from "../../../infra/db/ids";
import { nextVersion } from "../shared";
import type { CreatedBy, KnowledgeScope, ProposedSkillChange } from "@agentik/workflow-schema";

const { skills, skillVersions } = schema;

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
