import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { hub } from "../../infra/hub";
import { hasLiveDaemonForAgent } from "../../infra/daemon-liveness";

const { chatSessions, chatMessages, agents, runs } = schema;

/**
 * Chat-spawns-task: a chat is a conversation with an agent where each user turn
 * enqueues a `kind='chat'` agent task. The task's result is written back as the
 * assistant turn on completion (see daemon-repo.completeTask). All tenancy-scoped.
 */

export interface ChatSessionSummary {
  id: string;
  agentId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** Start a chat session against an agent. Verifies the agent belongs to the team. */
export async function createChatSession(
  teamId: string,
  input: { agentId: string; title?: string },
  creatorId = "",
): Promise<ChatSessionSummary | null> {
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, input.agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent) return null;
  const id = genId("chat");
  const [row] = await db
    .insert(chatSessions)
    .values({ id, teamId, agentId: input.agentId, creatorId, title: input.title ?? "" })
    .returning();
  return toSummary(row!);
}

export async function listChatSessions(teamId: string): Promise<ChatSessionSummary[]> {
  const rows = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.teamId, teamId))
    .orderBy(desc(chatSessions.updatedAt));
  return rows.map(toSummary);
}

export interface ChatMessageView {
  id: string;
  role: string;
  content: string;
  taskId: string | null;
  createdAt: string;
}

/** A session with its full message history (chronological). Null if not in this team. */
export async function getChatSession(
  teamId: string,
  id: string,
): Promise<{ session: ChatSessionSummary; messages: ChatMessageView[] } | null> {
  const [row] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.teamId, teamId)))
    .limit(1);
  if (!row) return null;
  const messages = await db
    .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content, taskId: chatMessages.taskId, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(eq(chatMessages.chatSessionId, id))
    .orderBy(asc(chatMessages.createdAt));
  return { session: toSummary(row), messages };
}

/**
 * Send a user turn: records the user message and enqueues a chat task for the
 * session's agent. Returns the new task id (the "run" the UI streams). Null if the
 * session isn't in this team.
 */
export async function sendChatMessage(
  teamId: string,
  sessionId: string,
  content: string,
  opts: { parentRunId?: string | null; inputMeta?: Record<string, unknown> } = {},
): Promise<{ taskId: string } | null> {
  const [session] = await db
    .select({ agentId: chatSessions.agentId })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.teamId, teamId)))
    .limit(1);
  if (!session) return null;

  const userMessageId = genId("cmsg");
  await db.insert(chatMessages).values({ id: userMessageId, chatSessionId: sessionId, role: "user", content });
  const prompt = await buildChatPrompt(sessionId, userMessageId, content);

  const runId = genId("run");
  await db.insert(runs).values({
    id: runId,
    teamId,
    executor: "daemon",
    agentId: session.agentId,
    status: "queued",
    kind: "chat",
    chatSessionId: sessionId,
    parentRunId: opts.parentRunId ?? null,
    input: { prompt, rawPrompt: content, ...(opts.inputMeta ?? {}) },
  });
  await db.update(chatSessions).set({ updatedAt: sql`now()` }).where(eq(chatSessions.id, sessionId));
  hub.publish(teamId, { kind: "run", action: "created", runId: runId });
  return { taskId: runId };
}

async function buildChatPrompt(
  sessionId: string,
  currentMessageId: string,
  currentContent: string,
) {
  const prior = (
    await db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
      })
      .from(chatMessages)
      .where(eq(chatMessages.chatSessionId, sessionId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(14)
  )
    .filter((message) => message.id !== currentMessageId)
    .reverse();

  if (!prior.length) return currentContent;

  const lines = [
    "# Conversation context",
    "Use this recent session history to resolve follow-ups, pronouns, locations, user preferences, and prior constraints. Do not repeat the history unless it is useful.",
    "",
  ];
  for (const message of prior) {
    const role = message.role === "assistant" ? "Assistant" : "User";
    lines.push(`${role}: ${compactPromptText(message.content, 1_500)}`);
  }
  lines.push("", "---", "", "# Current request", currentContent);
  return lines.join("\n");
}

function compactPromptText(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

export async function sendAgentChatTurn(
  teamId: string,
  input: {
    agentId: string;
    content: string;
    creatorId: string;
    title?: string;
    parentRunId?: string | null;
    inputMeta?: Record<string, unknown>;
  },
): Promise<
  | { runId: string; chatSessionId: string }
  | { error: "not_found" | "not_published" | "empty_input" | "no_live_daemon" }
> {
  const content = input.content.trim();
  if (!content) return { error: "empty_input" };
  const [agent] = await db
    .select({
      id: agents.id,
      liveVersionId: agents.liveVersionId,
      runtimeKind: agents.runtimeKind,
      preferredDaemonId: agents.preferredDaemonId,
    })
    .from(agents)
    .where(and(eq(agents.id, input.agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent) return { error: "not_found" };
  if (!agent.liveVersionId) return { error: "not_published" };
  // Fail fast: with no live daemon to claim it, the run would sit `queued` forever.
  if (!(await hasLiveDaemonForAgent(teamId, agent))) return { error: "no_live_daemon" };

  const creatorId = input.creatorId.trim();
  const [existing] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.teamId, teamId),
        eq(chatSessions.agentId, input.agentId),
        eq(chatSessions.creatorId, creatorId),
        eq(chatSessions.status, "active"),
      ),
    )
    .orderBy(desc(chatSessions.updatedAt))
    .limit(1);
  let chatSessionId = existing?.id;
  if (!chatSessionId) {
    const [created] = await db
      .insert(chatSessions)
      .values({
        id: genId("chat"),
        teamId,
        agentId: input.agentId,
        creatorId,
        title: input.title?.trim() || content.slice(0, 80),
      })
      .returning({ id: chatSessions.id });
    chatSessionId = created!.id;
  }

  const sent = await sendChatMessage(teamId, chatSessionId, content, {
    parentRunId: input.parentRunId,
    inputMeta: input.inputMeta,
  });
  if (!sent) return { error: "not_found" };
  return { runId: sent.taskId, chatSessionId };
}

export type OrchestrationStepRecord = {
  index: number;
  agentId: string;
  agentName: string;
  prompt: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  childRunId?: string;
  result?: string;
  error?: string;
};

export type OrchestrationPlanRecord = {
  goal: string;
  source: string;
  actorId: string;
  threadKey: string;
  currentIndex: number;
  steps: OrchestrationStepRecord[];
};

export async function createOrchestrationRun(
  teamId: string,
  plan: OrchestrationPlanRecord,
) {
  const runId = genId("run");
  await db.insert(runs).values({
    id: runId,
    teamId,
    executor: "orchestrator",
    status: "running",
    trigger: "manual",
    kind: "orchestration",
    input: { orchestration: plan },
    stepCount: plan.steps.length,
    completedSteps: 0,
  });
  await appendOrchestrationMessage(teamId, runId, `Orchestration started: ${plan.goal}`);
  hub.publish(teamId, { kind: "run", action: "created", runId });
  return { runId };
}

export async function startNextOrchestrationStep(teamId: string, parentRunId: string) {
  const [parent] = await db
    .select({ input: runs.input, status: runs.status })
    .from(runs)
    .where(and(eq(runs.id, parentRunId), eq(runs.teamId, teamId)))
    .limit(1);
  if (!parent || !["queued", "running"].includes(parent.status)) return null;
  const plan = orchestrationPlanFromInput(parent.input);
  if (!plan) return null;
  const next = plan.steps.find((step) => step.status === "pending");
  if (!next) {
    await db
      .update(runs)
      .set({ status: "succeeded", completedSteps: plan.steps.length, endedAt: sql`now()` })
      .where(and(eq(runs.id, parentRunId), eq(runs.teamId, teamId)));
    await appendOrchestrationMessage(teamId, parentRunId, "Orchestration completed.");
    hub.publish(teamId, { kind: "run", action: "succeeded", runId: parentRunId });
    return { done: true as const };
  }

  const turn = await sendAgentChatTurn(teamId, {
    agentId: next.agentId,
    content: next.prompt,
    creatorId: `orchestration:${parentRunId}:agent:${next.agentId}`,
    title: `Orchestration · ${next.agentName}`,
    parentRunId,
    inputMeta: { orchestration: { parentRunId, stepIndex: next.index, goal: plan.goal } },
  });
  if ("error" in turn) {
    next.status = "failed";
    next.error = turn.error;
    await persistOrchestrationPlan(teamId, parentRunId, plan, "failed");
    return { error: turn.error as string };
  }

  next.status = "running";
  next.childRunId = turn.runId;
  plan.currentIndex = next.index;
  await persistOrchestrationPlan(teamId, parentRunId, plan, "running");
  await appendOrchestrationMessage(
    teamId,
    parentRunId,
    `Step ${next.index + 1}/${plan.steps.length} started: ${next.agentName}`,
    { childRunId: turn.runId, agentId: next.agentId },
  );
  return { done: false as const, childRunId: turn.runId, step: next };
}

export async function handleOrchestrationChildCompleted(
  teamId: string,
  childRunId: string,
  result: string,
) {
  const parent = await parentRunForChild(teamId, childRunId);
  if (!parent) return null;
  const plan = orchestrationPlanFromInput(parent.input);
  if (!plan) return null;
  const step = plan.steps.find((item) => item.childRunId === childRunId);
  if (!step) return null;
  step.status = "succeeded";
  step.result = result;
  await persistOrchestrationPlan(teamId, parent.id, plan, "running", completedCount(plan));
  await appendOrchestrationMessage(
    teamId,
    parent.id,
    `Step ${step.index + 1}/${plan.steps.length} completed: ${step.agentName}`,
    { childRunId },
  );
  return startNextOrchestrationStep(teamId, parent.id);
}

export async function handleOrchestrationChildFailed(
  teamId: string,
  childRunId: string,
  error: string,
) {
  const parent = await parentRunForChild(teamId, childRunId);
  if (!parent) return null;
  const plan = orchestrationPlanFromInput(parent.input);
  if (!plan) return null;
  const step = plan.steps.find((item) => item.childRunId === childRunId);
  if (step) {
    step.status = "failed";
    step.error = error;
  }
  await persistOrchestrationPlan(teamId, parent.id, plan, "failed", completedCount(plan), error);
  await appendOrchestrationMessage(teamId, parent.id, `Orchestration failed: ${error}`, {
    childRunId,
  });
  hub.publish(teamId, { kind: "run", action: "failed", runId: parent.id });
  return { parentRunId: parent.id };
}

async function parentRunForChild(teamId: string, childRunId: string) {
  const [child] = await db
    .select({ parentRunId: runs.parentRunId })
    .from(runs)
    .where(and(eq(runs.id, childRunId), eq(runs.teamId, teamId)))
    .limit(1);
  if (!child?.parentRunId) return null;
  const [parent] = await db
    .select({ id: runs.id, input: runs.input })
    .from(runs)
    .where(and(eq(runs.id, child.parentRunId), eq(runs.teamId, teamId)))
    .limit(1);
  return parent ?? null;
}

async function persistOrchestrationPlan(
  teamId: string,
  runId: string,
  plan: OrchestrationPlanRecord,
  status: typeof runs.$inferInsert.status,
  completedSteps = completedCount(plan),
  error?: string,
) {
  await db
    .update(runs)
    .set({
      status,
      input: { orchestration: plan },
      completedSteps,
      ...(error ? { error } : {}),
      ...(status === "succeeded" || status === "failed" ? { endedAt: sql`now()` } : {}),
    })
    .where(and(eq(runs.id, runId), eq(runs.teamId, teamId)));
  hub.publish(teamId, { kind: "run.progress", runId, completedSteps, stepCount: plan.steps.length });
}

async function appendOrchestrationMessage(
  teamId: string,
  runId: string,
  content: string,
  input?: Record<string, unknown>,
) {
  const rows = (await db.execute(sql`
    SELECT coalesce(max(seq) + 1, 0)::int AS "nextSeq"
    FROM ${schema.runMessages}
    WHERE run_id = ${runId}
  `)) as unknown as Array<{ nextSeq: number }>;
  const seq = rows[0]?.nextSeq ?? 0;
  await db.insert(schema.runMessages).values({
    id: genId("amsg"),
    runId,
    seq,
    type: "text",
    tool: "orchestrator",
    content,
    input: input ?? null,
  });
}

function orchestrationPlanFromInput(input: unknown): OrchestrationPlanRecord | null {
  const root = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const plan = root.orchestration;
  if (!plan || typeof plan !== "object") return null;
  const record = plan as OrchestrationPlanRecord;
  return Array.isArray(record.steps) ? record : null;
}

function completedCount(plan: OrchestrationPlanRecord) {
  return plan.steps.filter((step) => step.status === "succeeded").length;
}

/**
 * Append an assistant turn from a finished chat task. Called by completeTask. Best-effort:
 * a missing/foreign session is a no-op. Publishes a chat.message event for live UIs.
 */
export async function appendAssistantTurn(teamId: string, sessionId: string, runId: string, content: string): Promise<void> {
  await db.insert(chatMessages).values({ id: genId("cmsg"), chatSessionId: sessionId, role: "assistant", content, taskId: runId });
  await db.update(chatSessions).set({ updatedAt: sql`now()` }).where(eq(chatSessions.id, sessionId));
  hub.publish(teamId, { kind: "chat.message", sessionId, runId: runId, role: "assistant" });
}

function toSummary(r: typeof chatSessions.$inferSelect): ChatSessionSummary {
  return { id: r.id, agentId: r.agentId, title: r.title, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt };
}
