import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { hub } from "./hub";

const { chatSessions, chatMessages, agents, agentTasks } = schema;

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

  await db.insert(chatMessages).values({ id: genId("cmsg"), chatSessionId: sessionId, role: "user", content });

  const taskId = genId("atask");
  await db.insert(agentTasks).values({
    id: taskId,
    teamId,
    agentId: session.agentId,
    status: "queued",
    kind: "chat",
    chatSessionId: sessionId,
    input: { prompt: content },
  });
  await db.update(chatSessions).set({ updatedAt: sql`now()` }).where(eq(chatSessions.id, sessionId));
  hub.publish(teamId, { kind: "run", action: "created", runId: taskId });
  return { taskId };
}

/**
 * Append an assistant turn from a finished chat task. Called by completeTask. Best-effort:
 * a missing/foreign session is a no-op. Publishes a chat.message event for live UIs.
 */
export async function appendAssistantTurn(teamId: string, sessionId: string, taskId: string, content: string): Promise<void> {
  await db.insert(chatMessages).values({ id: genId("cmsg"), chatSessionId: sessionId, role: "assistant", content, taskId });
  await db.update(chatSessions).set({ updatedAt: sql`now()` }).where(eq(chatSessions.id, sessionId));
  hub.publish(teamId, { kind: "chat.message", sessionId, runId: taskId, role: "assistant" });
}

function toSummary(r: typeof chatSessions.$inferSelect): ChatSessionSummary {
  return { id: r.id, agentId: r.agentId, title: r.title, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt };
}
