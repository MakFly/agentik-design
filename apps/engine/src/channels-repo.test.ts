/**
 * Integration tests for Telegram channel control. They run against a REAL
 * Postgres and use an injected sender, so no Telegram network call is made.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "./infra/db/client";
import { resolveTeam } from "./domains/workflows/repo";
import {
  formatTelegramHtmlMessages,
  formatTelegramText,
  handleTelegramWebhookSecret,
  listChannelConnections,
  notifyRunTelegram,
  parseTelegramCommand,
  sendRunTelegramAction,
} from "./domains/channels/repo";
import { encryptJson } from "./infra/crypto";
import { createProject } from "./domains/projects/repo";
import { createAgent, publishAgent, requestRunApproval } from "./domains/runs";
import { genId } from "./infra/db/ids";

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
    await publishAgent(teamId, agentId, {
      instructions: "Handle Telegram operator requests.",
      runtimeKind: "echo",
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.runs)
      .where(eq(schema.runs.teamId, teamId));
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
    expect(parseTelegramCommand("/agent @telegram_controller")).toEqual({
      kind: "agentMode",
      handle: "telegram_controller",
    });
    expect(parseTelegramCommand("/agent off")).toEqual({
      kind: "agentMode",
      off: true,
    });
    expect(parseTelegramCommand("hello")).toEqual({
      kind: "freeChat",
      input: "hello",
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
    expect(parseTelegramCommand('/pause run_1 "operator review"')).toEqual({
      kind: "pause",
      runId: "run_1",
      reason: "operator review",
    });
    expect(parseTelegramCommand("/approve run_1 ok")).toEqual({
      kind: "approve",
      runId: "run_1",
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

  test("routes a free-form message to the single published agent", async () => {
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    const res = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 23,
          text: "hello",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );

    expect(res.ok).toBe(true);
    expect(res.reply).toContain("🧠 Telegram Controller is on it.");
    expect(res.reply).toContain("I will send the result here.");
    expect(res.reply).toContain("Track:");
    expect(res.reply).toContain("Telegram Controller");
    expect(res.reply).toContain(`/${teamSlug}/runs/`);
  });

  test("keeps an active Telegram agent so later messages do not need /run", async () => {
    const second = await createAgent(teamId, { name: "Deep Researcher" });
    await publishAgent(teamId, second.id, {
      instructions: "Research deeply.",
      runtimeKind: "echo",
    });
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 27,
          text: `/start ${pairingCode}`,
          chat: { id: 789 },
          from: { id: 789, first_name: "Grace" },
        },
      },
      sender,
    );

    const selected = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 24,
          text: "/agent @deep_researcher",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(selected.ok).toBe(true);
    expect(selected.reply).toContain("Agent mode enabled");
    expect(selected.reply).toContain("@deep_researcher");

    const res = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 25,
          text: "cherche les dernières infos IA",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(res.ok).toBe(true);
    expect(res.reply).toContain("🧠 Deep Researcher is on it.");
    expect(res.reply).toContain("Track:");
    expect(res.reply).toContain(`/${teamSlug}/runs/`);
    expect(res.runId).toBeTruthy();

    const followUp = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 27,
          text: "continue avec les sources importantes",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(followUp.ok).toBe(true);
    expect(followUp.reply).toContain("🧠 Deep Researcher is on it.");
    expect(followUp.runId).toBeTruthy();

    const chatTasks = await db
      .select({
        id: schema.runs.id,
        kind: schema.runs.kind,
        chatSessionId: schema.runs.chatSessionId,
      })
      .from(schema.runs)
      .where(eq(schema.runs.teamId, teamId));
    const firstTask = chatTasks.find((task) => task.id === res.runId);
    const secondTask = chatTasks.find((task) => task.id === followUp.runId);
    expect(firstTask?.kind).toBe("chat");
    expect(secondTask?.kind).toBe("chat");
    expect(firstTask?.chatSessionId).toBeTruthy();
    expect(secondTask?.chatSessionId).toBe(firstTask?.chatSessionId);

    const cleared = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 26,
          text: "/agent off",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(cleared.ok).toBe(true);
    expect(cleared.reply).toContain("Agent mode disabled");
  });

  test("routes natural web questions through the orchestrator instead of a pinned hint", async () => {
    const coder = await createAgent(teamId, { name: "Backend Coder" });
    await publishAgent(teamId, coder.id, {
      instructions: "Fix code, tests, TypeScript, Go, and backend bugs.",
      runtimeKind: "echo",
    });
    const web = await createAgent(teamId, { name: "Web Weather Researcher" });
    await publishAgent(teamId, web.id, {
      instructions: "Use web search, browser research, internet sources, weather and news.",
      runtimeKind: "echo",
    });
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };

    const selected = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 28,
          text: "/agent @backend_coder",
          chat: { id: 789 },
          from: { id: 789, first_name: "Grace" },
        },
      },
      sender,
    );
    expect(selected.ok).toBe(true);
    expect(selected.reply).toContain("@backend_coder");

    const routed = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 29,
          text: "Donne moi la météo au Havre",
          chat: { id: 789 },
          from: { id: 789, first_name: "Grace" },
        },
      },
      sender,
    );

    expect(routed.ok).toBe(true);
    expect(routed.reply).toContain("🧠 Web Weather Researcher is on it.");
    expect(routed.reply).not.toContain("Backend Coder is on it.");
    expect(routed.runId).toBeTruthy();
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
    const [connection] = await db
      .select({ id: schema.channelConnections.id })
      .from(schema.channelConnections)
      .where(eq(schema.channelConnections.teamId, teamId))
      .limit(1);
    expect(connection).toBeTruthy();
    const existingRecipients = await db
      .select({ id: schema.channelIdentities.id })
      .from(schema.channelIdentities)
      .where(eq(schema.channelIdentities.teamId, teamId));
    if (existingRecipients.length === 0) {
      await db
        .insert(schema.channelIdentities)
        .values([
          {
            id: genId("chident"),
            teamId,
            connectionId: connection!.id,
            externalUserId: "notify-user-1",
            externalChatId: "notify-chat-1",
            displayName: "Notify One",
            role: "operator",
          },
          {
            id: genId("chident"),
            teamId,
            connectionId: connection!.id,
            externalUserId: "notify-user-2",
            externalChatId: "notify-chat-2",
            displayName: "Notify Two",
            role: "operator",
          },
        ])
        .onConflictDoNothing();
    }
    const delivered: Array<{ text: string; parseMode?: string }> = [];
    const actions: string[] = [];
    const count = await notifyRunTelegram(
      teamId,
      "run_notify",
      "Approval requested\nAllow deploy?",
      async ({ text, parseMode }) => {
        delivered.push({ text, parseMode });
      },
      async ({ action }) => {
        actions.push(action);
      },
    );
    expect(count).toBeGreaterThanOrEqual(2);
    expect(actions).toHaveLength(count);
    expect(actions.every((action) => action === "typing")).toBe(true);
    expect(delivered[0]?.text).toContain("Approval requested");
    expect(delivered[0]?.text).toContain(`/${teamSlug}/runs/run_notify`);
    expect(delivered[0]?.parseMode).toBe("HTML");
  });

  test("formats markdown tables into Telegram-friendly compact text", () => {
    const formatted = formatTelegramText(
      [
        "✅ Run completed",
        "",
        "| Donnée | Valeur |",
        "|---|---|",
        "| Température | 20 °C |",
        "| Vent | 12 km/h |",
      ].join("\n"),
    );
    expect(formatted).toContain("- Donnée: Température ; Valeur: 20 °C");
    expect(formatted).toContain("- Donnée: Vent ; Valeur: 12 km/h");
    expect(formatted).not.toContain("|---|");
  });

  test("formats long markdown notifications as Telegram HTML chunks", () => {
    const parts = formatTelegramHtmlMessages(
      [
        "✅ Run completed",
        "",
        "## Result",
        "",
        "**Important**: keep `tokens` server-side.",
        "",
        "| Pattern | Verdict |",
        "|---|---|",
        "| BFF | Recommended |",
        "",
        "x".repeat(7_500),
      ].join("\n"),
    );
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 4096)).toBe(true);
    expect(parts[0]).toContain("<b>Result</b>");
    expect(parts[0]).toContain("<b>Important</b>");
    expect(parts[0]).toContain("<code>tokens</code>");
    expect(parts[0]).toContain("• Pattern: BFF ; Verdict: Recommended");
  });

  test("sends Telegram typing actions to paired chats without a message", async () => {
    const actions: string[] = [];
    const count = await sendRunTelegramAction(
      teamId,
      "typing",
      async ({ action }) => {
        actions.push(action);
      },
    );
    expect(count).toBe(2);
    expect(actions).toEqual(["typing", "typing"]);
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

    const runId = genId("run");
    await db.insert(schema.runs).values({
      id: runId,
      teamId,
      executor: "daemon",
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
      await requestRunApproval(teamId, runId, "Allow this run?"),
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
      await requestRunApproval(teamId, runId, "Allow second attempt?"),
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
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .limit(1);
    expect(task?.status).toBe("cancelled");

    const killRunId = genId("run");
    await db.insert(schema.runs).values({
      id: killRunId,
      teamId,
      executor: "daemon",
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
