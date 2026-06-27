import { and, eq } from "drizzle-orm";
import { db, schema } from "../../../infra/db/client";
import type { KnowledgeScope, MemoryPolicy, SkillPolicy } from "@agentik/workflow-schema";
import { listMemory } from "./repo";
import { listSkills } from "../skills/repo";

const { agents, agentVersions, skillVersions } = schema;

export type InjectionContext = {
  memories: { content: string; confidence: number; scope: KnowledgeScope }[];
  skills: { name: string; bodyMd: string; triggerConditions: string[] }[];
  systemPrompt?: string;
  model?: string;
};

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
