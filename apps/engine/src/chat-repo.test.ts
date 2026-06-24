/**
 * Integration tests for chat-spawns-task. Run against a REAL Postgres; SKIP when
 * none is reachable so `bun test` stays green offline.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { resolveTeam } from "./repo";
import { createChatSession, getChatSession, listChatSessions, sendChatMessage } from "./chat-repo";
import { startTask, completeTask } from "./daemon-repo";

const { agents, agentTasks, chatSessions, chatMessages, teams } = schema;

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[chat-repo] no DB reachable — skipping integration tests");
const d = dbUp ? describe : describe.skip;

d("chat-spawns-task", () => {
  let teamId: string;
  let agentId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-chat-${Date.now()}`);
    agentId = genId("agt");
    await db.insert(agents).values({ id: agentId, teamId, name: "Chat Agent" });
  });

  afterAll(async () => {
    await db.delete(chatSessions).where(eq(chatSessions.teamId, teamId)); // cascade → chat_messages
    await db.delete(agentTasks).where(eq(agentTasks.teamId, teamId));
    await db.delete(agents).where(eq(agents.teamId, teamId));
    await db.delete(teams).where(eq(teams.id, teamId));
  });

  test("createChatSession requires an agent in the same team", async () => {
    expect(await createChatSession(teamId, { agentId: "agt_does_not_exist" })).toBeNull();
    const s = await createChatSession(teamId, { agentId, title: "Hello" }, "usr_x");
    expect(s).not.toBeNull();
    expect(s!.title).toBe("Hello");
    expect(s!.status).toBe("active");
    expect(await listChatSessions(teamId)).toHaveLength(1);
  });

  test("a user message records the turn and enqueues a chat task bound to the session", async () => {
    const s = (await createChatSession(teamId, { agentId }))!;
    const res = await sendChatMessage(teamId, s.id, "What is 2+2?");
    expect(res).not.toBeNull();
    expect(res!.taskId.startsWith("atask_")).toBe(true);

    const [task] = await db
      .select({ status: agentTasks.status, kind: agentTasks.kind, chatSessionId: agentTasks.chatSessionId, input: agentTasks.input })
      .from(agentTasks)
      .where(eq(agentTasks.id, res!.taskId))
      .limit(1);
    expect(task?.status).toBe("queued");
    expect(task?.kind).toBe("chat");
    expect(task?.chatSessionId).toBe(s.id);
    expect((task?.input as { prompt: string }).prompt).toBe("What is 2+2?");

    const view = await getChatSession(teamId, s.id);
    expect(view?.messages).toHaveLength(1);
    expect(view?.messages[0]).toMatchObject({ role: "user", content: "What is 2+2?" });
  });

  test("completing the task writes the assistant turn back into the session", async () => {
    const s = (await createChatSession(teamId, { agentId }))!;
    const { taskId } = (await sendChatMessage(teamId, s.id, "ping"))!;

    expect(await startTask(taskId)).toBe(true); // queued → running
    expect(await completeTask(taskId, { result: "pong" })).toBe(true);

    const view = await getChatSession(teamId, s.id);
    expect(view?.messages).toHaveLength(2);
    expect(view?.messages[1]).toMatchObject({ role: "assistant", content: "pong", taskId });
  });

  test("sending to a session outside the team is rejected", async () => {
    const other = await resolveTeam(`itest-chat-other-${Date.now()}`);
    const foreignAgent = genId("agt");
    await db.insert(agents).values({ id: foreignAgent, teamId: other, name: "Other" });
    const s = (await createChatSession(other, { agentId: foreignAgent }))!;
    expect(await sendChatMessage(teamId, s.id, "hi")).toBeNull(); // wrong team

    await db.delete(chatSessions).where(eq(chatSessions.teamId, other));
    await db.delete(agents).where(eq(agents.teamId, other));
    await db.delete(teams).where(eq(teams.id, other));
  });
});
