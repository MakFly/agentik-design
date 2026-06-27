import { and, desc, eq, ilike } from "drizzle-orm";
import { db, schema } from "../../../infra/db/client";
import type { CreatedBy, KnowledgeScope } from "@agentik/workflow-schema";
import { createMemory } from "./repo";

const { agents, chatMessages, chatSessions } = schema;

export async function insertConfirmedMemory(input: {
  teamId: string;
  scope: KnowledgeScope;
  targetId?: string;
  content: string;
  confidence?: number;
  sourceRunId?: string;
  createdBy?: CreatedBy;
}) {
  const created = await createMemory({
    teamId: input.teamId,
    scope: input.scope,
    targetId: input.targetId,
    content: input.content,
    confidence: input.confidence ?? 1,
    sourceRunId: input.sourceRunId,
    actorId: input.createdBy ?? "user",
    createdBy: input.createdBy ?? "user",
  });
  if ("error" in created) return { error: created.error };
  return { id: created.memory.id };
}

export async function searchChatMemory(teamId: string, q: string, limit = 30) {
  const query = q.trim();
  if (!query) return [];
  return db
    .select({
      messageId: chatMessages.id,
      sessionId: chatMessages.chatSessionId,
      role: chatMessages.role,
      content: chatMessages.content,
      taskId: chatMessages.taskId,
      createdAt: chatMessages.createdAt,
      agentId: chatSessions.agentId,
      agentName: agents.name,
      sessionTitle: chatSessions.title,
    })
    .from(chatMessages)
    .innerJoin(chatSessions, eq(chatMessages.chatSessionId, chatSessions.id))
    .leftJoin(agents, eq(chatSessions.agentId, agents.id))
    .where(
      and(
        eq(chatSessions.teamId, teamId),
        ilike(chatMessages.content, `%${query}%`),
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}
