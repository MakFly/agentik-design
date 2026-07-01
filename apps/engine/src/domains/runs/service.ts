import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "../../infra/db/client";
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
import { ensureDefaultAgent } from "../agents/repo";
import { hasLiveDaemonForAgent } from "../../infra/daemon-liveness";
import { monthlyCostCents, teamSpendLimitCents } from "./repo";
import { runMessagesToSteps } from "./mappers";

const { agents, daemons, runtimes, runs } = schema;

/**
 * Guard a team's monthly spend ceiling before enqueuing a new run. Returns ok when
 * uncapped or under the limit; otherwise the spent/limit figures (cents) so callers
 * can surface a precise 402. Enforced at dispatch so a runaway agent can't keep
 * burning budget past the cap.
 */
export async function assertWithinSpendLimit(
  teamId: string,
): Promise<{ ok: true } | { ok: false; spentCents: number; limitCents: number }> {
  const limit = await teamSpendLimitCents(teamId);
  if (limit == null) return { ok: true };
  const spent = await monthlyCostCents(teamId);
  if (spent >= limit) return { ok: false, spentCents: spent, limitCents: limit };
  return { ok: true };
}

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
    runtimeKind: rk.success ? rk.data : "claude",
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
  executor: DbOrTx = db,
) {
  if (!daemonId) return { ok: true as const };
  const [daemon] = await executor
    .select({ id: daemons.id })
    .from(daemons)
    .where(and(eq(daemons.teamId, teamId), eq(daemons.id, daemonId)))
    .limit(1);
  if (!daemon) return { ok: false as const, error: "daemon_not_found" as const };
  const [runtime] = await executor
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

export type PublishAgentResult =
  | null
  | { error: "daemon_not_found" | "daemon_missing_runtime" }
  | { versionId: string; version: number; status: "published" };

/**
 * Publish core, runnable inside a caller's transaction so create+publish (or
 * republish) commit atomically — the immutable version insert and the agents
 * repoint can never half-apply. Pass the open `tx`; {@link publishAgent} opens its own.
 */
export async function publishAgentInTx(
  executor: DbOrTx,
  teamId: string,
  agentId: string,
  config: unknown,
  changelog?: string,
): Promise<PublishAgentResult> {
  const [agent] = await executor
    .select({ runtimeKind: agents.runtimeKind })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent) return null;
  const versionInput = configToVersionInput(config, agent.runtimeKind);
  const preferredDaemonId = preferredDaemonIdFromConfig(config);
  const binding = await validateDaemonBinding(teamId, preferredDaemonId, versionInput.runtimeKind, executor);
  if (!binding.ok) return { error: binding.error };
  const created = await createAgentVersion(
    teamId,
    agentId,
    { ...versionInput, changelog },
    executor,
  );
  if (!created) return null;
  // Point liveVersionId at the immutable version AND sync the agent's runtime_kind to the
  // published version — claimTask matches tasks to runtimes on agents.runtime_kind, so the
  // published version must set the agent's runtime or the wrong runtime would claim its runs.
  await executor
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

/** Identity fields that may be patched atomically alongside a publish. */
export interface AgentIdentityPatch {
  name?: string;
  role?: string;
  goal?: string;
  description?: string;
  tags?: string[];
  emoji?: string | null;
  color?: string | null;
  avatarUrl?: string | null;
  isOrchestrator?: boolean;
}

async function applyIdentityPatch(
  executor: DbOrTx,
  teamId: string,
  agentId: string,
  identity: AgentIdentityPatch,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  for (const key of [
    "name",
    "role",
    "goal",
    "description",
    "tags",
    "emoji",
    "color",
    "avatarUrl",
    "isOrchestrator",
  ] as const) {
    if (identity[key] !== undefined) set[key] = identity[key];
  }
  if (Object.keys(set).length === 1) return; // only updatedAt → nothing to patch
  await executor
    .update(agents)
    .set(set)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agentId)));
}

/**
 * Publish → write an IMMUTABLE agent_versions row (monotonic), repoint liveVersionId.
 * When `identity` is provided, the identity patch and the version publish happen in
 * ONE transaction (the edit-mode path), so a failure can never leave identity mutated
 * without a matching new version.
 */
export async function publishAgent(
  teamId: string,
  agentId: string,
  config: unknown,
  changelog?: string,
  identity?: AgentIdentityPatch,
): Promise<PublishAgentResult> {
  return db.transaction(async (tx) => {
    if (identity) await applyIdentityPatch(tx, teamId, agentId, identity);
    return publishAgentInTx(tx, teamId, agentId, config, changelog);
  });
}

/**
 * Enqueue a real run of a PUBLISHED agent (Golden Path step 3). A daemon advertising the
 * agent's runtime claims it and the engine injects the agent's approved memory/skills into
 * the task at claim time. Returns {error} if the agent isn't published yet.
 */
export async function runAgent(teamId: string, agentId: string, input: string) {
  const [agent] = await db
    .select({
      id: agents.id,
      liveVersionId: agents.liveVersionId,
      runtimeKind: agents.runtimeKind,
      preferredDaemonId: agents.preferredDaemonId,
    })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent) return null;
  if (!agent.liveVersionId) return { error: "not_published" as const };
  // Fail fast: with no live daemon to claim it, the run would sit `queued` forever.
  if (!(await hasLiveDaemonForAgent(teamId, agent)))
    return { error: "no_live_daemon" as const };
  const guard = await assertWithinSpendLimit(teamId);
  if (!guard.ok) {
    return {
      error: "spend_limit_exceeded" as const,
      spentCents: guard.spentCents,
      limitCents: guard.limitCents,
    };
  }
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
 * (claude|codex|…) selects which daemon runtime picks it up. */
export async function createTestTask(
  teamId: string,
  config: unknown,
  input: string,
  runtime = "claude",
) {
  await ensureDefaultAgent(teamId);
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

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = (result as Record<string, unknown>).result;
    if (typeof r === "string") return r;
  }
  return result == null ? "" : JSON.stringify(result);
}

/** Side effects after a daemon run succeeds — hub, channels, chat, learning. */
export async function onRunCompleted(
  teamId: string,
  runId: string,
  result: unknown,
  ctx: { chatSessionId?: string | null; projectTaskId?: string | null },
): Promise<void> {
  const { appendAssistantTurn } = await import("../chat/repo");
  const { ensureRunReview } = await import("../learning/index");
  const { notifyRunTelegram } = await import("../channels/service");
  const { formatRunCompletionForTelegram } = await import("./telegram-presenter");

  hub.publish(teamId, { kind: "run", action: "succeeded", runId });
  if (ctx.projectTaskId) {
    const { markProjectTaskReview } = await import("../projects/index");
    await markProjectTaskReview(teamId, ctx.projectTaskId);
  }
  if (ctx.chatSessionId) {
    await appendAssistantTurn(
      teamId,
      ctx.chatSessionId,
      runId,
      resultText(result),
    ).catch(() => undefined);
  }
  const { handleOrchestrationChildCompleted } = await import("../chat/repo");
  await handleOrchestrationChildCompleted(teamId, runId, resultText(result)).catch(() => undefined);
  const telegram = formatRunCompletionForTelegram(result);
  await notifyRunTelegram(teamId, runId, telegram.text, undefined, undefined, {
    includeLink: telegram.includeLink,
  }).catch(() => undefined);
  await ensureRunReview(teamId, runId).catch(() => undefined);
}

/** Side effects after a daemon run fails — hub, channels, learning. */
export async function onRunFailed(
  teamId: string,
  runId: string,
  error: string,
  ctx: { projectTaskId?: string | null },
): Promise<void> {
  const { ensureRunReview } = await import("../learning/index");
  const { notifyRunTelegram } = await import("../channels/service");
  const { formatRunFailureForTelegram } = await import("./telegram-presenter");

  hub.publish(teamId, { kind: "run", action: "failed", runId });
  if (ctx.projectTaskId) {
    const { markProjectTaskBlocked } = await import("../projects/index");
    await markProjectTaskBlocked(teamId, ctx.projectTaskId);
  }
  const { handleOrchestrationChildFailed } = await import("../chat/repo");
  await handleOrchestrationChildFailed(teamId, runId, error).catch(() => undefined);
  const telegram = formatRunFailureForTelegram(error);
  await notifyRunTelegram(teamId, runId, telegram.text, undefined, undefined, {
    includeLink: telegram.includeLink,
  }).catch(() => undefined);
  await ensureRunReview(teamId, runId).catch(() => undefined);
}

export async function onRunRunning(teamId: string, runId: string): Promise<void> {
  const { startRunTelegramTypingHeartbeat } = await import("../channels/service");
  hub.publish(teamId, { kind: "run", action: "running", runId });
  startRunTelegramTypingHeartbeat(teamId, runId);
}

export function onRunDispatched(teamId: string, runId: string): void {
  hub.publish(teamId, { kind: "run", action: "dispatched", runId });
}

export function onRunProgress(
  teamId: string,
  runId: string,
  completedSteps: number,
  stepCount: number,
): void {
  hub.publish(teamId, {
    kind: "run.progress",
    runId,
    completedSteps,
    stepCount,
  });
  void notifyTelegramProgress(teamId, runId, completedSteps, stepCount).catch(() => undefined);
}

async function notifyTelegramProgress(
  teamId: string,
  runId: string,
  completedSteps: number,
  stepCount: number,
) {
  const { notifyRunProgressTelegram } = await import("../channels/service");
  const { formatRunProgressForTelegram } = await import("./telegram-presenter");
  const latest = await latestRunMessageSummary(runId);
  const text = formatRunProgressForTelegram({ completedSteps, stepCount, latest });
  await notifyRunProgressTelegram(teamId, runId, {
    completedSteps,
    stepCount,
    latest,
    text,
  });
}

async function latestRunMessageSummary(runId: string) {
  const messages = await db
    .select({
      id: schema.runMessages.id,
      runId: schema.runMessages.runId,
      seq: schema.runMessages.seq,
      type: schema.runMessages.type,
      tool: schema.runMessages.tool,
      content: schema.runMessages.content,
      input: schema.runMessages.input,
      output: schema.runMessages.output,
      createdAt: schema.runMessages.createdAt,
    })
    .from(schema.runMessages)
    .where(eq(schema.runMessages.runId, runId))
    .orderBy(desc(schema.runMessages.seq))
    .limit(20);
  if (!messages.length) return null;
  const steps = runMessagesToSteps(messages.reverse());
  const [step] = steps.slice(-1);
  if (!step) return null;
  if (step.actor.kind === "tool") {
    const [call] = step.toolCalls;
    const verb = step.status === "running" ? "Running" : "Completed";
    return `${verb} ${step.actor.name}${toolRequestLabel(call?.request)}`;
  }
  if ("error" in step && step.error) return compactProgressText(step.error.message);
  if ("reasoning" in step && step.reasoning) return compactProgressText(step.reasoning);
  return compactProgressText(step.summary);
}

function compactProgressText(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= 180) return clean;
  return `${clean.slice(0, 179).trimEnd()}…`;
}

function toolRequestLabel(input: unknown) {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const label =
    typeof record.query === "string"
      ? record.query
      : typeof record.url === "string"
        ? record.url
        : null;
  return label ? ` · ${compactProgressText(label)}` : "";
}

export async function onRunWaitingApproval(
  teamId: string,
  runId: string,
  message: string,
): Promise<void> {
  const { notifyRunTelegram } = await import("../channels/service");
  const { formatRunApprovalForTelegram, runApprovalTelegramActions } = await import("./telegram-presenter");
  hub.publish(teamId, { kind: "run", action: "waiting_approval", runId });
  const telegram = formatRunApprovalForTelegram(runId, message);
  await notifyRunTelegram(teamId, runId, telegram.text, undefined, undefined, {
    includeLink: telegram.includeLink,
    replyMarkup: runApprovalTelegramActions(runId),
  }).catch(() => undefined);
}
