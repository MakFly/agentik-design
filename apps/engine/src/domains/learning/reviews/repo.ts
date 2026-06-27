import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../../infra/db/client";
import { genId } from "../../../infra/db/ids";
import { deterministicReview } from "./agent";
import { insertMemoryFromReviewTx } from "../memory/repo";
import { nextVersion } from "../shared";
import type { ReviewAgentOutput, RunReviewStatus } from "@agentik/workflow-schema";

const { runReviews, runs, runMessages, skills, skillVersions } = schema;

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

export async function generateRunReview(teamId: string, runId: string) {
  const [task] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.teamId, teamId)))
    .limit(1);
  if (!task) return null;
  const msgs = await db
    .select({ type: runMessages.type, tool: runMessages.tool, content: runMessages.content })
    .from(runMessages)
    .where(eq(runMessages.runId, runId))
    .orderBy(runMessages.seq);
  const output = deterministicReview({
    taskId: task.id,
    agentId: task.agentId!,
    status: task.status,
    error: task.error,
    messages: msgs,
  });
  const { id } = await createRunReview(teamId, runId, output);
  return getRunReview(teamId, id);
}

export async function ensureRunReview(teamId: string, runId: string) {
  const existing = await getRunReviewByRunId(teamId, runId);
  if (existing) return existing;
  return generateRunReview(teamId, runId);
}

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

export function reviewChangeIds(review: Pick<RunReviewRow, "proposedMemories" | "proposedSkillChanges">) {
  return [
    ...review.proposedMemories.map((_, i) => `m${i}`),
    ...review.proposedSkillChanges.map((_, i) => `s${i}`),
  ];
}

export async function applyRunReview(teamId: string, reviewId: string, changeIds?: string[]) {
  const review = await getRunReview(teamId, reviewId);
  if (!review) return null;
  if (review.status !== "pending") return { applied: 0, alreadyApplied: true as const };

  const wantMem = (i: number) => !changeIds || changeIds.includes(`m${i}`);
  const wantSkill = (i: number) => !changeIds || changeIds.includes(`s${i}`);
  let applied = 0;
  let claimed = true;

  await db.transaction(async (tx) => {
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
  });

  if (!claimed) return { applied: 0, alreadyApplied: true as const };
  return { applied, alreadyApplied: false as const };
}
