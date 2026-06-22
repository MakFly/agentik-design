import { and, desc, eq, sql } from "drizzle-orm";
import type {
  CreateCredentialInput,
  CreateWorkflowInput,
  CredentialSummary,
  RunDetail,
  SaveVersionInput,
  TriggerKind,
  WorkflowDetail,
  WorkflowSummary,
} from "@agentik/workflow-schema";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { decryptJson, encryptJson } from "./crypto";

const { teams, workflows, workflowVersions, runs, runSteps, credentials } = schema;

/** Dev tenancy: resolve a team by slug, creating it on first use. */
export async function resolveTeam(slug: string): Promise<string> {
  const existing = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  if (existing[0]) return existing[0].id;
  const id = genId("team");
  await db.insert(teams).values({ id, slug, name: slug });
  return id;
}

function toSummary(w: typeof workflows.$inferSelect, version: number | null): WorkflowSummary {
  return {
    id: w.id,
    teamId: w.teamId,
    name: w.name,
    description: w.description,
    active: w.active,
    currentVersion: version,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    lastRunAt: w.lastRunAt,
  };
}

async function currentVersionNumber(versionId: string | null): Promise<number | null> {
  if (!versionId) return null;
  const v = await db
    .select({ version: workflowVersions.version })
    .from(workflowVersions)
    .where(eq(workflowVersions.id, versionId))
    .limit(1);
  return v[0]?.version ?? null;
}

export async function createWorkflow(
  teamId: string,
  input: CreateWorkflowInput,
): Promise<WorkflowSummary> {
  const id = genId("wf");
  const [row] = await db
    .insert(workflows)
    .values({ id, teamId, name: input.name, description: input.description ?? null })
    .returning();
  return toSummary(row!, null);
}

export async function listWorkflows(teamId: string): Promise<WorkflowSummary[]> {
  const rows = await db
    .select()
    .from(workflows)
    .where(eq(workflows.teamId, teamId))
    .orderBy(desc(workflows.updatedAt));
  return Promise.all(rows.map(async (w) => toSummary(w, await currentVersionNumber(w.currentVersionId))));
}

export async function getWorkflow(teamId: string, id: string): Promise<WorkflowDetail | null> {
  const [w] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.teamId, teamId)))
    .limit(1);
  if (!w) return null;

  let graph = null;
  let version = null;
  if (w.currentVersionId) {
    const [v] = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, w.currentVersionId))
      .limit(1);
    if (v) {
      graph = v.graph;
      version = v.version;
    }
  }
  return { ...toSummary(w, version), graph };
}

/** Save a new immutable version, bump it to current, update name/active. */
export async function saveVersion(
  teamId: string,
  workflowId: string,
  input: SaveVersionInput,
): Promise<WorkflowDetail | null> {
  const [w] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.teamId, teamId)))
    .limit(1);
  if (!w) return null;

  const last = await db
    .select({ version: workflowVersions.version })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, workflowId))
    .orderBy(desc(workflowVersions.version))
    .limit(1);
  const nextVersion = (last[0]?.version ?? 0) + 1;

  const versionId = genId("ver");
  await db
    .insert(workflowVersions)
    .values({ id: versionId, workflowId, version: nextVersion, graph: input.graph });

  await db
    .update(workflows)
    .set({
      currentVersionId: versionId,
      name: input.name ?? w.name,
      active: input.active ?? w.active,
      updatedAt: sql`now()`,
    })
    .where(eq(workflows.id, workflowId));

  return getWorkflow(teamId, workflowId);
}

/** Create a queued run from the workflow's current version. */
export async function createRun(
  teamId: string,
  workflowId: string,
  trigger: TriggerKind,
  payload: unknown,
): Promise<{ runId: string } | { error: "not_found" | "no_version" }> {
  const [w] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.teamId, teamId)))
    .limit(1);
  if (!w) return { error: "not_found" };
  if (!w.currentVersionId) return { error: "no_version" };

  const runId = genId("run");
  await db.insert(runs).values({
    id: runId,
    teamId,
    workflowId,
    versionId: w.currentVersionId,
    status: "queued",
    trigger,
    payload: payload ?? null,
  });
  await db.update(workflows).set({ lastRunAt: sql`now()` }).where(eq(workflows.id, workflowId));
  return { runId };
}

/* ───────────────────────────── Credentials ───────────────────────────── */

function toCredentialSummary(c: typeof credentials.$inferSelect, connected = false): CredentialSummary {
  return {
    id: c.id,
    teamId: c.teamId,
    type: c.type as CredentialSummary["type"],
    name: c.name,
    connected,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** A credential is "connected" once an OAuth access token has been stored. */
function isConnected(row: typeof credentials.$inferSelect): boolean {
  try {
    return Boolean(decryptJson<Record<string, string>>(row.data).access_token);
  } catch {
    return false;
  }
}

export async function createCredential(
  teamId: string,
  input: CreateCredentialInput,
): Promise<CredentialSummary> {
  const id = genId("cred");
  const [row] = await db
    .insert(credentials)
    .values({ id, teamId, type: input.type, name: input.name, data: encryptJson(input.data) })
    .returning();
  return toCredentialSummary(row!, isConnected(row!));
}

export async function listCredentials(teamId: string): Promise<CredentialSummary[]> {
  const rows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.teamId, teamId))
    .orderBy(desc(credentials.createdAt));
  return rows.map((r) => toCredentialSummary(r, isConnected(r)));
}

/** Decrypt a credential by id (for OAuth routes / token refresh). */
export async function getCredentialDecrypted(
  teamId: string,
  id: string,
): Promise<{ row: typeof credentials.$inferSelect; data: Record<string, string> } | null> {
  const [row] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.teamId, teamId)))
    .limit(1);
  if (!row) return null;
  return { row, data: decryptJson<Record<string, string>>(row.data) };
}

/** Re-encrypt and persist a credential's secret payload. */
export async function setCredentialData(teamId: string, id: string, data: Record<string, string>): Promise<void> {
  await db
    .update(credentials)
    .set({ data: encryptJson(data), updatedAt: sql`now()` })
    .where(and(eq(credentials.id, id), eq(credentials.teamId, teamId)));
}

export async function deleteCredential(teamId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.teamId, teamId)))
    .returning({ id: credentials.id });
  return deleted.length > 0;
}

export async function getRun(runId: string, teamId?: string): Promise<RunDetail | null> {
  const [r] = await db
    .select()
    .from(runs)
    .where(teamId ? and(eq(runs.id, runId), eq(runs.teamId, teamId)) : eq(runs.id, runId))
    .limit(1);
  if (!r) return null;
  const steps = await db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(runSteps.index);
  return { ...r, steps } as RunDetail;
}
