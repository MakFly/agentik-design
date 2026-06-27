import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { hub } from "../../infra/hub";

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
    input: { prompt, rawPrompt: content },
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
  input: { agentId: string; content: string; creatorId: string; title?: string },
): Promise<
  | { runId: string; chatSessionId: string }
  | { error: "not_found" | "not_published" | "empty_input" }
> {
  const content = input.content.trim();
  if (!content) return { error: "empty_input" };
  const [agent] = await db
    .select({ id: agents.id, liveVersionId: agents.liveVersionId })
    .from(agents)
    .where(and(eq(agents.id, input.agentId), eq(agents.teamId, teamId)))
    .limit(1);
  if (!agent) return { error: "not_found" };
  if (!agent.liveVersionId) return { error: "not_published" };

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

  const sent = await sendChatMessage(teamId, chatSessionId, content);
  if (!sent) return { error: "not_found" };
  return { runId: sent.taskId, chatSessionId };
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
