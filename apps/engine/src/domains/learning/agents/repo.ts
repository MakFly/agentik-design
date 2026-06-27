import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../../../infra/db/client";
import { genId } from "../../../infra/db/ids";
import { nextVersion } from "../shared";
import type { CreatedBy, MemoryPolicy, RuntimeKind, SkillPolicy, ToolGrant } from "@agentik/workflow-schema";

const { agents, agentVersions } = schema;

async function agentBelongsToTeam(teamId: string, agentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  return Boolean(row);
}

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
