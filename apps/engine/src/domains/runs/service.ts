import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { hub } from "../../infra/hub";
import {
  createAgentVersion,
  type CreateAgentVersionInput,
} from "../learning/index";
import {
  DEFAULT_MEMORY_POLICY,
  DEFAULT_SKILL_POLICY,
  runtimeKindSchema,
} from "@agentik/workflow-schema";
import type { RuntimeKind, ToolGrant } from "@agentik/workflow-schema";
import { ensureDevAgents } from "./repo";

const { agents, daemons, runtimes, runs } = schema;

/** Map the web's free-form config jsonb onto an immutable version's typed fields. */
function configToVersionInput(
  config: unknown,
  fallbackRuntime: string,
): CreateAgentVersionInput {
  const cfg = (config && typeof config === "object" ? config : {}) as Record<
    string,
    unknown
  >;
  const m = cfg.model;
  const model =
    typeof m === "string"
      ? m
      : m &&
          typeof m === "object" &&
          typeof (m as { model?: unknown }).model === "string"
        ? (m as { model: string }).model
        : undefined;
  const rk = runtimeKindSchema.safeParse(cfg.runtimeKind ?? fallbackRuntime);
  const rawTools = Array.isArray(cfg.tools) ? cfg.tools : [];
  const toolGrants: ToolGrant[] = rawTools.flatMap((tool) => {
    if (typeof tool === "string") return [{ toolId: tool, scopes: ["read"] }];
    if (!tool || typeof tool !== "object") return [];
    const grant = tool as Record<string, unknown>;
    if (typeof grant.toolId !== "string" || !grant.toolId.trim()) return [];
    const scopes = Array.isArray(grant.scopes)
      ? grant.scopes.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0)
      : ["read"];
    return [
      {
        toolId: grant.toolId,
        scopes: scopes.length ? scopes : ["read"],
        ...(typeof grant.rateCapPerMin === "number" ? { rateCapPerMin: grant.rateCapPerMin } : {}),
        ...(typeof grant.requireApproval === "boolean" ? { requireApproval: grant.requireApproval } : {}),
      },
    ];
  });
  return {
    model,
    // The web builder stores the agent's system prompt as `systemPrompt`; older/direct
    // callers may send `instructions`. Accept either so the persona actually reaches the
    // published version (and thus the runtime via claimTask) — without it, the agent's
    // "skill" is silently dropped at publish.
    instructions:
      typeof cfg.systemPrompt === "string"
        ? cfg.systemPrompt
        : typeof cfg.instructions === "string"
          ? cfg.instructions
          : "",
    tools: toolGrants.map((grant) => grant.toolId),
    toolGrants,
    runtimeKind: rk.success ? rk.data : "echo",
    memoryPolicy: DEFAULT_MEMORY_POLICY,
    skillPolicy: DEFAULT_SKILL_POLICY,
    createdBy: "user",
  };
}

function preferredDaemonIdFromConfig(config: unknown): string | null {
  const cfg = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const binding = cfg.runtimeBinding;
  if (!binding || typeof binding !== "object") return null;
  const daemonId = (binding as Record<string, unknown>).daemonId;
  return typeof daemonId === "string" && daemonId.trim() ? daemonId.trim() : null;
}

async function validateDaemonBinding(
  teamId: string,
  daemonId: string | null,
  runtimeKind: RuntimeKind,
) {
  if (!daemonId) return { ok: true as const };
  const [daemon] = await db
    .select({ id: daemons.id })
    .from(daemons)
    .where(and(eq(daemons.teamId, teamId), eq(daemons.id, daemonId)))
    .limit(1);
  if (!daemon) return { ok: false as const, error: "daemon_not_found" as const };
  const [runtime] = await db
    .select({ id: runtimes.id })
    .from(runtimes)
    .where(
      and(
        eq(runtimes.teamId, teamId),
        eq(runtimes.daemonId, daemonId),
        eq(runtimes.kind, runtimeKind),
      ),
    )
    .limit(1);
  if (!runtime) return { ok: false as const, error: "daemon_missing_runtime" as const };
  return { ok: true as const };
}

/** Publish → write an IMMUTABLE agent_versions row (monotonic), repoint liveVersionId. */
export async function publishAgent(
  teamId: string,
  agentId: string,
  config: unknown,
  changelog?: string,
) {
  const [agent] = await db
    .select({ runtimeKind: agents.runtimeKind })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent) return null;
  const versionInput = configToVersionInput(config, agent.runtimeKind);
  const preferredDaemonId = preferredDaemonIdFromConfig(config);
  const binding = await validateDaemonBinding(teamId, preferredDaemonId, versionInput.runtimeKind);
  if (!binding.ok) return { error: binding.error };
  const created = await createAgentVersion(teamId, agentId, {
    ...versionInput,
    changelog,
  });
  if (!created) return null;
  // Point liveVersionId at the immutable version AND sync the agent's runtime_kind to the
  // published version — claimTask matches tasks to runtimes on agents.runtime_kind, so a
  // claude version must flip the agent off "echo" or the wrong runtime would claim its runs.
  await db
    .update(agents)
    .set({
      liveVersionId: created.id,
      runtimeKind: versionInput.runtimeKind,
      preferredDaemonId,
      config: (config ?? {}) as Record<string, unknown>,
      health: "healthy",
      updatedAt: sql`now()`,
    })
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)));
  return {
    versionId: created.id,
    version: created.version,
    status: "published" as const,
  };
}

/**
 * Enqueue a real run of a PUBLISHED agent (Golden Path step 3). A daemon advertising the
 * agent's runtime claims it and the engine injects the agent's approved memory/skills into
 * the task at claim time. Returns {error} if the agent isn't published yet.
 */
export async function runAgent(teamId: string, agentId: string, input: string) {
  const [agent] = await db
    .select({ id: agents.id, liveVersionId: agents.liveVersionId })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent) return null;
  if (!agent.liveVersionId) return { error: "not_published" as const };
  const runId = genId("run");
  await db.insert(runs).values({
    id: runId,
    teamId,
    executor: "daemon",
    agentId,
    status: "queued",
    kind: "chat",
    input: { prompt: input },
  });
  hub.publish(teamId, { kind: "run", action: "created", runId: runId });
  return { runId: runId };
}

/** Create a queued sandbox task and return its id as a runId. The runtime
 * (echo|claude) selects which daemon runtime picks it up. */
export async function createTestTask(
  teamId: string,
  config: unknown,
  input: string,
  runtime = "echo",
) {
  await ensureDevAgents(teamId);
  // Per-team, per-runtime sandbox agent so the task is claimable by that runtime.
  const name = `Sandbox (${runtime})`;
  let [sandbox] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.name, name)))
    .limit(1);
  if (!sandbox) {
    const id = genId("agt");
    [sandbox] = await db
      .insert(agents)
      .values({
        id,
        teamId,
        name,
        role: "Test",
        goal: "Sandbox test runs",
        runtimeKind: runtime,
        health: "idle",
      })
      .returning();
  }
  const runId = genId("run");
  await db.insert(runs).values({
    id: runId,
    teamId,
    executor: "daemon",
    agentId: sandbox!.id,
    status: "queued",
    kind: "direct",
    input: { prompt: input, config },
  });
  hub.publish(teamId, { kind: "run", action: "created", runId: runId });
  return { runId: runId };
}
