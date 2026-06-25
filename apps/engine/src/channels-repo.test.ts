/**
 * Integration tests for Telegram channel control. They run against a REAL
 * Postgres and use an injected sender, so no Telegram network call is made.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { resolveTeam } from "./repo";
import {
  handleTelegramWebhookSecret,
  listChannelConnections,
  notifyRunTelegram,
  parseTelegramCommand,
} from "./channels-repo";
import { encryptJson } from "./crypto";
import { createProject } from "./projects-repo";
import { createAgent, requestAgentTaskApproval } from "./agents-repo";
import { genId } from "./db/ids";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp)
  console.warn("[channels-repo] no DB reachable - skipping integration tests");
const d = dbUp ? describe : describe.skip;

d("telegram channel control", () => {
  let teamId: string;
  let teamSlug: string;
  let projectId: string;
  let agentId: string;
  let webhookSecret: string;
  let pairingCode: string;
  const sent: string[] = [];

  beforeAll(async () => {
    teamSlug = `itest-channels-${Date.now()}`;
    teamId = await resolveTeam(teamSlug);
    // Insert the connection directly so the suite stays offline: createTelegramConnection
    // now verifies the token against Telegram (getMe), which we don't want to hit in tests.
    webhookSecret = `whsec_${genId("chan")}`;
    pairingCode = "PAIR1234";
    await db.insert(schema.channelConnections).values({
      id: genId("chan"),
      teamId,
      provider: "telegram",
      label: "Ops Telegram",
      status: "active",
      botTokenEncrypted: encryptJson({ token: "123:test" }),
      botUsername: "ops_test_bot",
      transport: "polling",
      webhookSecret,
      pairingCode,
      createdBy: "usr_test",
    });
    const project = await createProject(teamId, "usr_test", {
      name: "Telegram Ops",
      type: "ops",
      description: "Remote control test project.",
    });
    projectId = project.project!.id;
    const agent = await createAgent(teamId, { name: "Telegram Controller" });
    agentId = agent.id;
  });

  afterAll(async () => {
    await db
      .delete(schema.agentTasks)
      .where(eq(schema.agentTasks.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db
      .delete(schema.memoryEntries)
      .where(eq(schema.memoryEntries.teamId, teamId));
    await db
      .delete(schema.channelMessages)
      .where(eq(schema.channelMessages.teamId, teamId));
    await db
      .delete(schema.channelIdentities)
      .where(eq(schema.channelIdentities.teamId, teamId));
    await db
      .delete(schema.channelConnections)
      .where(eq(schema.channelConnections.teamId, teamId));
    await db.delete(schema.projects).where(eq(schema.projects.teamId, teamId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  test("parses operator commands", () => {
    expect(parseTelegramCommand("/projects")).toEqual({ kind: "projects" });
    expect(parseTelegramCommand("/agents")).toEqual({ kind: "agents" });
    expect(parseTelegramCommand("/run")).toEqual({ kind: "runHelp" });
    expect(parseTelegramCommand('/run task:ptask_1 "ship it"')).toEqual({
      kind: "runTask",
      taskId: "ptask_1",
      instruction: "ship it",
    });
    expect(parseTelegramCommand('/run agent:agt_1 "Inspect leads"')).toEqual({
      kind: "runAgent",
      agentId: "agt_1",
      input: "Inspect leads",
    });
    expect(parseTelegramCommand('/run @telegram_controller "Inspect leads"')).toEqual({
      kind: "runAgentHandle",
      handle: "telegram_controller",
      input: "Inspect leads",
    });
    expect(parseTelegramCommand("@telegram_controller Inspect leads")).toEqual({
      kind: "runAgentHandle",
      handle: "telegram_controller",
      input: "Inspect leads",
    });
    expect(
      parseTelegramCommand('/run project:proj_1 agent:agt_1 "Fix checkout"'),
    ).toEqual({
      kind: "run",
      projectId: "proj_1",
      agentId: "agt_1",
      title: "Fix checkout",
    });
    expect(
      parseTelegramCommand('/learn project:proj_1 "use bun only"'),
    ).toEqual({
      kind: "learn",
      projectId: "proj_1",
      content: "use bun only",
    });
    expect(parseTelegramCommand('/pause atask_1 "operator review"')).toEqual({
      kind: "pause",
      runId: "atask_1",
      reason: "operator review",
    });
    expect(parseTelegramCommand("/approve atask_1 ok")).toEqual({
      kind: "approve",
      runId: "atask_1",
      reason: "ok",
    });
  });

  test("pairs a chat and answers /projects with compact project summaries", async () => {
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    const pair = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 1,
          text: `/start ${pairingCode}`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(pair.ok).toBe(true);

    const res = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 2,
          text: "/projects",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(res.reply).toContain("Telegram Ops");
    expect(sent.at(-1)).toContain("Telegram Ops");

    const connections = await listChannelConnections(teamId);
    expect(connections[0]?.identityCount).toBe(1);
  });

  test("guides natural run requests instead of returning unknown command", async () => {
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 20,
          text: `/start ${pairingCode}`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );

    const res = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 21,
          text: "tu peux me lancer un agent existant ?",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );

    expect(res.ok).toBe(true);
    expect(res.reply).not.toContain("Unknown command");
    expect(res.reply).toContain("/run @agent_handle");
    expect(res.reply).toContain("Telegram Controller");
  });

  test("lists agents from Telegram", async () => {
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    const res = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 22,
          text: "/agents",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );

    expect(res.ok).toBe(true);
    expect(res.reply).toContain("Telegram Controller");
    expect(res.reply).toContain("@telegram_controller");
    expect(res.reply).toContain(agentId);
  });

  test("saves confirmed project memory from /learn", async () => {
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    const res = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 3,
          text: `/learn project:${projectId} "Use bun only for this project."`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(res.ok).toBe(true);
    const rows = await db
      .select()
      .from(schema.memoryEntries)
      .where(eq(schema.memoryEntries.targetId, projectId));
    expect(rows[0]).toMatchObject({
      scope: "project",
      content: "Use bun only for this project.",
      confidence: 1,
      createdBy: "user",
    });
  });

  test("sends compact run notifications with canonical web links", async () => {
    const delivered: string[] = [];
    const count = await notifyRunTelegram(
      teamId,
      "atask_notify",
      "Approval requested\nAllow deploy?",
      async ({ text }) => {
        delivered.push(text);
      },
    );
    expect(count).toBe(1);
    expect(delivered[0]).toContain("Approval requested");
    expect(delivered[0]).toContain(`/${teamSlug}/runs/atask_notify`);
  });

  test("checks status, pauses, resumes, approves, rejects, and kills runs from Telegram", async () => {
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 4,
          text: `/start ${pairingCode}`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );

    const runId = genId("atask");
    await db.insert(schema.agentTasks).values({
      id: runId,
      teamId,
      agentId,
      status: "queued",
      kind: "direct",
      input: { prompt: "remote controlled" },
    });

    const status = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 5,
          text: `/status ${runId}`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(status.ok).toBe(true);
    expect(status.reply).toContain(`/${teamSlug}/runs/${runId}`);

    const pause = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 6,
          text: `/pause ${runId} "operator hold"`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(pause.ok).toBe(true);
    expect(pause.reply).toContain(`/${teamSlug}/runs/${runId}`);

    const resume = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 7,
          text: `/resume ${runId}`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(resume.ok).toBe(true);

    expect(
      await requestAgentTaskApproval(teamId, runId, "Allow this run?"),
    ).toBe(true);
    const approve = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 8,
          text: `/approve ${runId} ok`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(approve.ok).toBe(true);

    expect(
      await requestAgentTaskApproval(teamId, runId, "Allow second attempt?"),
    ).toBe(true);
    const reject = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 9,
          text: `/reject ${runId} later`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(reject.ok).toBe(true);

    const [task] = await db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, runId))
      .limit(1);
    expect(task?.status).toBe("cancelled");

    const killRunId = genId("atask");
    await db.insert(schema.agentTasks).values({
      id: killRunId,
      teamId,
      agentId,
      status: "queued",
      kind: "direct",
      input: { prompt: "cancel me" },
    });
    const kill = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 10,
          text: `/kill ${killRunId}`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(kill.ok).toBe(true);
    expect(kill.reply).toContain(`/${teamSlug}/runs/${killRunId}`);
  });
});
