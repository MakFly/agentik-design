/**
 * Integration tests for Telegram channel control. They run against a REAL
 * Postgres and use an injected sender, so no Telegram network call is made.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { resolveTeam } from "../../../src/infra/tenancy";
import {
  formatTelegramHtmlMessages,
  formatTelegramText,
  handleTelegramWebhookSecret,
  notifyRunProgressTelegram,
  notifyRunTelegram,
  parseTelegramCommand,
  sendRunTelegramAction,
} from "../../../src/domains/channels/service";
import { createBinding, listChannelConnections } from "../../../src/domains/channels/repo";
import { encryptJson } from "../../../src/infra/crypto";
import { addProjectResource, createProject, createProjectTask } from "../../../src/domains/projects/repo";
import { createAgent, publishAgent, requestRunApproval } from "../../../src/domains/runs";
import { insertConfirmedMemory } from "../../../src/domains/learning/memory/service";
import { genId } from "../../../src/infra/db/ids";
import {
  syncTelegramBotCommands,
  telegramBotCommands,
  type TelegramBotCommand,
  type TelegramCaller,
} from "../../../src/domains/channels/telegram/client";

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
  let taskId: string;
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
    // Free-chat / /run routing enqueues a run, which now requires a live daemon for the
    // claude runtime — seed one with a fresh heartbeat so routing isn't rejected as offline.
    const daemonId = genId("daemon");
    await db.insert(schema.daemons).values({
      id: daemonId,
      teamId,
      name: "Telegram Test Daemon",
      status: "online",
      lastHeartbeatAt: sql`now()`,
    });
    await db
      .insert(schema.runtimes)
      .values({ id: genId("runtime"), daemonId, teamId, kind: "claude" });
    const project = await createProject(teamId, "usr_test", {
      name: "Telegram Ops",
      type: "ops",
      description: "Remote control test project.",
    });
    projectId = project.project!.id;
    const task = await createProjectTask(teamId, projectId, "usr_test", {
      title: "Répondre aux emails clients",
      description: "Traiter les messages entrants depuis Telegram.",
      priority: "P1",
      status: "ready",
    });
    taskId = task.task!.id;
    const agent = await createAgent(teamId, {
      name: "Telegram Controller",
      role: "Operator gateway",
      goal: "Handle Telegram operator requests with project context.",
    });
    agentId = agent.id;
    await publishAgent(teamId, agentId, {
      instructions: "Handle Telegram operator requests.",
      runtimeKind: "claude",
      tools: [
        { toolId: "gmail.read", scopes: ["read"] },
        { toolId: "gmail.send", scopes: ["send"], requireApproval: true },
      ],
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.runs)
      .where(eq(schema.runs.teamId, teamId));
    await db
      .delete(schema.channelBindings)
      .where(eq(schema.channelBindings.teamId, teamId));
    await db.delete(schema.agents).where(eq(schema.agents.teamId, teamId));
    await db.delete(schema.daemons).where(eq(schema.daemons.teamId, teamId));
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
    expect(parseTelegramCommand("/skills")).toEqual({
      kind: "skills",
    });
    expect(parseTelegramCommand("/skills @telegram_controller")).toEqual({
      kind: "skills",
      handle: "telegram_controller",
    });
    expect(parseTelegramCommand("/skills agent:agt_1")).toEqual({
      kind: "skills",
      agentId: "agt_1",
    });
    expect(parseTelegramCommand("/project")).toEqual({ kind: "projectMode" });
    expect(parseTelegramCommand("/project off")).toEqual({
      kind: "projectMode",
      off: true,
    });
    expect(parseTelegramCommand("/project proj_1")).toEqual({
      kind: "projectMode",
      projectId: "proj_1",
    });
    expect(parseTelegramCommand("/project project:proj_1")).toEqual({
      kind: "projectMode",
      projectId: "proj_1",
    });
    expect(parseTelegramCommand("/context")).toEqual({
      kind: "context",
      projectId: undefined,
    });
    expect(parseTelegramCommand("/context project:proj_1")).toEqual({
      kind: "context",
      projectId: "proj_1",
    });
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
    expect(parseTelegramCommand('/orchestrate "Research puis implement"')).toEqual({
      kind: "orchestrate",
      input: "Research puis implement",
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
    // Free-form NL containing run-like words must still route to the orchestrator,
    // not be intercepted as a run-help nudge.
    expect(parseTelegramCommand("lance un audit SEO du site")).toEqual({
      kind: "freeChat",
      input: "lance un audit SEO du site",
    });
    // After /project, a short /run creates a task in the active project.
    expect(parseTelegramCommand("/run wat")).toEqual({
      kind: "run",
      title: "wat",
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
    expect(parseTelegramCommand("/status")).toEqual({
      kind: "status",
      runId: undefined,
    });
    expect(parseTelegramCommand("/next")).toEqual({
      kind: "next",
      runId: undefined,
    });
    expect(parseTelegramCommand("/next run_1")).toEqual({
      kind: "next",
      runId: "run_1",
    });
    expect(parseTelegramCommand("/approve ok")).toEqual({
      kind: "approve",
      reason: "ok",
    });
  });

  test("exposes a Telegram-native command menu", async () => {
    const commands = telegramBotCommands();
    expect(commands.length).toBeGreaterThan(10);
    expect(commands.length).toBeLessThanOrEqual(100);
    expect(commands).toContainEqual({
      command: "context",
      description: "Voir le contexte projet utilise",
    });
    expect(commands).toContainEqual({
      command: "approve",
      description: "Approuver une action bloquee",
    });
    expect(commands).toContainEqual({
      command: "next",
      description: "Avancer les runs en queue",
    });
    expect(commands).toContainEqual({
      command: "skills",
      description: "Voir les capacites d'un agent",
    });
    for (const command of commands) {
      expect(command.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.description.length).toBeLessThanOrEqual(256);
    }

    const calls: Array<{ token: string; method: string; body?: Record<string, unknown> }> = [];
    const fakeCall: TelegramCaller = async (token, method, body) => {
      calls.push({ token, method, body });
      return { ok: true };
    };
    const result = await syncTelegramBotCommands(
      "123:test",
      fakeCall,
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      token: "123:test",
      method: "setMyCommands",
      body: { commands },
    });

    const sent = calls[0]!.body!.commands as TelegramBotCommand[];
    expect(sent.map((command) => command.command)).toEqual(
      commands.map((command) => command.command),
    );
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
    expect(pair.reply).toContain("Ce chat est connecté à Agentik.");
    expect(pair.reply).toContain("/projects");

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
    expect(res.reply).toContain("Projets actifs :");
    expect(res.reply).toContain("Telegram Ops");
    expect(res.reply).toContain("1 ouvertes");
    expect(res.reply).not.toContain("No projects");
    expect(res.reply).not.toContain("Aucun projet");
    expect(sent.at(-1)).toContain("Telegram Ops");

    const connections = await listChannelConnections(teamId);
    expect(connections[0]?.identityCount).toBe(1);
  });

  test("answers help, invalid pairing, and unpaired chats with operator guidance", async () => {
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };

    const invalid = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 211,
          text: "/start WRONG",
          chat: { id: 654 },
          from: { id: 654, first_name: "Lin" },
        },
      },
      sender,
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.reply).toContain("Code de pairing invalide.");
    expect(invalid.reply).toContain(`/start ${pairingCode}`);

    const unpaired = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 212,
          text: "/projects",
          chat: { id: 655 },
          from: { id: 655, first_name: "Sam" },
        },
      },
      sender,
    );
    expect(unpaired.ok).toBe(false);
    expect(unpaired.reply).toContain("Ce chat n'est pas encore connecté.");
    expect(unpaired.reply).toContain(`/start ${pairingCode}`);

    const help = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 213,
          text: "/help",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(help.ok).toBe(true);
    expect(help.reply).toContain("Agentik est prêt sur Telegram.");
    expect(help.reply).toContain("Commandes utiles :");
    expect(help.reply).toContain("/projects");
    expect(help.reply).not.toContain("Unknown command");

    const unknown = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 214,
          text: "/wat",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.reply).toContain("Je ne peux pas exécuter cette commande.");
    expect(unknown.reply).toContain("Commande inconnue : /wat");
    expect(unknown.reply).not.toContain("Unknown command");
  });

  test("routes a run-like natural request to the orchestrator instead of pinned help", async () => {
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
    // The run-like wording ("lancer un agent") used to be intercepted as a /run
    // help nudge; it must now route to the orchestrator and start the agent.
    expect(res.reply).not.toContain("/run @agent_handle");
    expect(res.reply).toContain("Telegram Controller est dessus.");
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
    expect(res.reply).toContain("Agents prêts à travailler :");
    expect(res.reply).toContain("Telegram Controller");
    expect(res.reply).toContain("@telegram_controller");
    expect(res.reply).toContain(agentId);
    expect(res.reply).not.toContain("No agents");
  });

  test("shows agent skills and tool grants from Telegram", async () => {
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    const explicit = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 2201,
          text: "/skills @telegram_controller",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(explicit.ok).toBe(true);
    expect(explicit.reply).toContain("Capacités : Telegram Controller");
    expect(explicit.reply).toContain("@telegram_controller");
    expect(explicit.reply).toContain("Rôle : Operator gateway");
    expect(explicit.reply).toContain("Objectif : Handle Telegram operator requests");
    expect(explicit.reply).toContain("Runtime : claude");
    expect(explicit.reply).toContain("État : publié v1");
    expect(explicit.reply).toContain("gmail.read · scopes: read");
    expect(explicit.reply).toContain("gmail.send · scopes: send · approval");
    expect(explicit.reply).toContain("Instruction : Handle Telegram operator requests.");
    expect(explicit.reply).toContain('/run @telegram_controller "demande"');
    expect(explicit.runId).toBeUndefined();

    await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 2202,
          text: "/agent @telegram_controller",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    const active = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 2203,
          text: "/skills",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(active.ok).toBe(true);
    expect(active.reply).toContain("Capacités : Telegram Controller");
    expect(active.reply).toContain("gmail.send");
  });

  test("lists open tasks with launch commands", async () => {
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    const res = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 221,
          text: "/tasks",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );

    expect(res.ok).toBe(true);
    expect(res.reply).toContain("Tâches ouvertes :");
    expect(res.reply).toContain("P1 Répondre aux emails clients");
    expect(res.reply).toContain("Projet : Telegram Ops");
    expect(res.reply).toContain("Statut : ready");
    expect(res.reply).toContain(`Lancer : /run task:${taskId}`);
    expect(res.reply).not.toContain("No open tasks");
    expect(res.reply).not.toContain("Aucune tâche");
  });

  test("keeps an active Telegram project for tasks and learning", async () => {
    const otherProject = await createProject(teamId, "usr_test", {
      name: "Backoffice Ops",
      type: "ops",
      description: "A second project used to prove chat-scoped filtering.",
    });
    const otherTask = await createProjectTask(teamId, otherProject.project!.id, "usr_test", {
      title: "Auditer backoffice",
      priority: "P2",
      status: "ready",
    });
    expect(otherTask.task?.id).toBeTruthy();
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };

    const selected = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 222,
          text: `/project ${projectId}`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(selected.ok).toBe(true);
    expect(selected.reply).toContain("Je garde Telegram Ops comme projet actif.");
    expect(selected.reply).toContain("/tasks et /learn utiliseront ce projet");
    expect(selected.projectId).toBe(projectId);

    const tasks = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 223,
          text: "/tasks",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(tasks.ok).toBe(true);
    expect(tasks.reply).toContain("P1 Répondre aux emails clients");
    expect(tasks.reply).toContain("Projet : Telegram Ops");
    expect(tasks.reply).not.toContain("Auditer backoffice");
    expect(tasks.projectId).toBe(projectId);

    const learned = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 224,
          text: '/learn "Use the active Telegram project context."',
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(learned.ok).toBe(true);
    expect(learned.reply).toContain("Mémoire projet enregistrée.");
    expect(learned.reply).toContain(`Projet : ${projectId}`);
    expect(learned.projectId).toBe(projectId);

    const rows = await db
      .select()
      .from(schema.memoryEntries)
      .where(eq(schema.memoryEntries.targetId, projectId));
    expect(rows.some((row) => row.content === "Use the active Telegram project context.")).toBe(true);

    const agentSelected = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 225,
          text: "/agent @telegram_controller",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(agentSelected.ok).toBe(true);
    expect(agentSelected.reply).toContain("@telegram_controller");

    const contextualRun = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 226,
          text: '/run "Préparer la réponse client"',
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(contextualRun.ok).toBe(true);
    expect(contextualRun.reply).toContain("C'est lancé.");
    expect(contextualRun.reply).toContain("Tâche : Préparer la réponse client");
    expect(contextualRun.projectId).toBe(projectId);
    expect(contextualRun.projectTaskId).toBeTruthy();
    expect(contextualRun.runId).toBeTruthy();

    const [createdTask] = await db
      .select()
      .from(schema.projectTasks)
      .where(eq(schema.projectTasks.id, contextualRun.projectTaskId!))
      .limit(1);
    expect(createdTask).toMatchObject({
      projectId,
      assignedAgentId: agentId,
      title: "Préparer la réponse client",
      status: "running",
    });

    const [createdRun] = await db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, contextualRun.runId!))
      .limit(1);
    expect(createdRun).toMatchObject({
      projectId,
      projectTaskId: contextualRun.projectTaskId,
      agentId,
      status: "queued",
    });

    const cleared = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 227,
          text: "/project off",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(cleared.ok).toBe(true);
    expect(cleared.reply).toContain("Projet actif désactivé");
  });

  test("shows the active project context before launching work", async () => {
    const contextProject = await createProject(teamId, "usr_test", {
      name: "Context Room",
      type: "hybrid",
      description: "Client support and engineering context used from Telegram.",
    });
    const project = contextProject.project!;
    const task = await createProjectTask(teamId, project.id, "usr_test", {
      title: "Préparer la synthèse contexte",
      priority: "P1",
      status: "ready",
    });
    expect(task.task?.id).toBeTruthy();
    const resource = await addProjectResource(teamId, project.id, {
      type: "url",
      label: "Runbook client",
      ref: "https://example.com/runbook",
    });
    expect("resource" in resource).toBe(true);
    await insertConfirmedMemory({
      teamId,
      scope: "project",
      targetId: project.id,
      content: "Toujours vérifier le runbook client avant d'envoyer une réponse externe.",
      confidence: 1,
      createdBy: "user",
    });

    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    const selected = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 228,
          text: `/project ${project.id}`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(selected.ok).toBe(true);

    const context = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 229,
          text: "/context",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(context.ok).toBe(true);
    expect(context.projectId).toBe(project.id);
    expect(context.reply).toContain("Contexte actif : Context Room");
    expect(context.reply).toContain("Projet :");
    expect(context.reply).toContain("Résumé : Client support and engineering context");
    expect(context.reply).toContain("Tâches ouvertes :");
    expect(context.reply).toContain("P1 Préparer la synthèse contexte");
    expect(context.reply).toContain("Ressources :");
    expect(context.reply).toContain("url · Runbook client");
    expect(context.reply).toContain("Mémoires confirmées :");
    expect(context.reply).toContain("Toujours vérifier le runbook client");
    expect(context.reply).toContain('/run "titre de tâche"');
    expect(context.runId).toBeUndefined();
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
    expect(res.reply).toContain("Telegram Controller est dessus.");
    expect(res.reply).toContain("Je te renvoie le résultat ici");
    expect(res.reply).toContain("Détail :");
    expect(res.reply).toContain("Telegram Controller");
    expect(res.reply).toContain(`/${teamSlug}/runs/`);
  });

  test("routes Telegram captions and attachments instead of ignoring them", async () => {
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    const res = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 231,
          caption: "analyse cette capture",
          photo: [
            { file_id: "photo_small", width: 320, height: 240, file_size: 32_000 },
            { file_id: "photo_large", width: 1024, height: 768, file_size: 256_000 },
          ],
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );

    expect(res.ok).toBe(true);
    expect(res.reply).toContain("Telegram Controller est dessus.");
    expect(res.runId).toBeTruthy();

    const [run] = await db
      .select({ input: schema.runs.input })
      .from(schema.runs)
      .where(eq(schema.runs.id, res.runId!))
      .limit(1);
    const input = JSON.stringify(run?.input);
    expect(input).toContain("analyse cette capture");
    expect(input).toContain("Pièces jointes Telegram");
    expect(input).toContain("photo 1024x768");
    expect(input).not.toContain("ignored");
  });

  test("gates group chat routing to real bot mentions and replies", async () => {
    const groupSecret = `whsec_${genId("chan")}`;
    const groupPairingCode = "PAIRGROUP";
    const [groupConnection] = await db
      .insert(schema.channelConnections)
      .values({
        id: genId("chan"),
        teamId,
        provider: "telegram",
        label: "Group Telegram",
        status: "active",
        botTokenEncrypted: encryptJson({ token: "123:group" }),
        botUsername: "ops_group_bot",
        transport: "polling",
        webhookSecret: groupSecret,
        pairingCode: groupPairingCode,
        createdBy: "usr_test",
      })
      .returning();
    expect(groupConnection).toBeTruthy();
    const binding = await createBinding(teamId, groupConnection!.id, {
      agentId,
      groupPolicy: "open",
      requireMention: true,
    });
    expect("binding" in binding).toBe(true);

    const delivered: string[] = [];
    const sender = async ({ text }: { text: string }) => {
      delivered.push(text);
    };
    const pair = await handleTelegramWebhookSecret(
      groupSecret,
      {
        message: {
          message_id: 401,
          text: `/start@ops_group_bot ${groupPairingCode}`,
          chat: { id: -100456, type: "supergroup", title: "Ops Room" },
          from: { id: 901, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(pair.ok).toBe(true);
    expect(pair.reply).toContain("Ce chat est connecté à Agentik.");

    const beforeIgnored = delivered.length;
    const ignored = await handleTelegramWebhookSecret(
      groupSecret,
      {
        message: {
          message_id: 402,
          text: "hello team, no bot needed",
          chat: { id: -100456, type: "supergroup", title: "Ops Room" },
          from: { id: 901, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(ignored).toEqual({ ok: true, reply: "ignored" });
    expect(delivered).toHaveLength(beforeIgnored);

    const otherBotCommand = await handleTelegramWebhookSecret(
      groupSecret,
      {
        message: {
          message_id: 403,
          text: "/projects@other_ops_bot",
          chat: { id: -100456, type: "supergroup", title: "Ops Room" },
          from: { id: 901, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(otherBotCommand).toEqual({ ok: true, reply: "ignored" });
    expect(delivered).toHaveLength(beforeIgnored);

    const mentionedText = "hello @ops_group_bot, résume les priorités";
    const mentioned = await handleTelegramWebhookSecret(
      groupSecret,
      {
        message: {
          message_id: 404,
          text: mentionedText,
          entities: [
            {
              type: "mention",
              offset: "hello ".length,
              length: "@ops_group_bot".length,
            },
          ],
          chat: { id: -100456, type: "supergroup", title: "Ops Room" },
          from: { id: 901, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(mentioned.ok).toBe(true);
    expect(mentioned.reply).toContain("Telegram Controller est dessus.");
    expect(mentioned.runId).toBeTruthy();

    const replied = await handleTelegramWebhookSecret(
      groupSecret,
      {
        message: {
          message_id: 405,
          text: "continue avec les risques",
          chat: { id: -100456, type: "supergroup", title: "Ops Room" },
          from: { id: 901, first_name: "Ada" },
          reply_to_message: {
            message_id: 399,
            text: "Synthèse précédente : priorité API, tests et déploiement.",
            chat: { id: -100456, type: "supergroup", title: "Ops Room" },
            from: { id: 42, is_bot: true, username: "ops_group_bot", first_name: "Agentik" },
          },
        },
      },
      sender,
    );
    expect(replied.ok).toBe(true);
    expect(replied.reply).toContain("Telegram Controller est dessus.");
    expect(replied.runId).toBeTruthy();

    const [repliedRun] = await db
      .select({ input: schema.runs.input })
      .from(schema.runs)
      .where(eq(schema.runs.id, replied.runId!))
      .limit(1);
    const repliedInput = JSON.stringify(repliedRun?.input);
    expect(repliedInput).toContain("continue avec les risques");
    expect(repliedInput).toContain("Message Telegram auquel l'opérateur répond");
    expect(repliedInput).toContain("Synthèse précédente");
    expect(repliedInput).toContain("priorité API");
  });

  test("keeps Telegram topic sessions isolated inside the same group chat", async () => {
    const topicAProject = await createProject(teamId, "usr_test", {
      name: "Topic A Ops",
      type: "ops",
      description: "First Telegram topic project.",
    });
    const topicBProject = await createProject(teamId, "usr_test", {
      name: "Topic B Ops",
      type: "ops",
      description: "Second Telegram topic project.",
    });
    const topicATask = await createProjectTask(teamId, topicAProject.project!.id, "usr_test", {
      title: "Traiter le sujet A",
      priority: "P1",
      status: "ready",
    });
    const topicBTask = await createProjectTask(teamId, topicBProject.project!.id, "usr_test", {
      title: "Traiter le sujet B",
      priority: "P2",
      status: "ready",
    });
    expect(topicATask.task?.id).toBeTruthy();
    expect(topicBTask.task?.id).toBeTruthy();

    const topicSecret = `whsec_${genId("chan")}`;
    const topicPairingCode = "PAIRTOPIC";
    const [topicConnection] = await db
      .insert(schema.channelConnections)
      .values({
        id: genId("chan"),
        teamId,
        provider: "telegram",
        label: "Topic Telegram",
        status: "active",
        botTokenEncrypted: encryptJson({ token: "123:topic" }),
        botUsername: "ops_topic_bot",
        transport: "polling",
        webhookSecret: topicSecret,
        pairingCode: topicPairingCode,
        createdBy: "usr_test",
      })
      .returning();
    expect(topicConnection).toBeTruthy();
    const binding = await createBinding(teamId, topicConnection!.id, {
      agentId,
      groupPolicy: "open",
      requireMention: true,
    });
    expect("binding" in binding).toBe(true);

    const sender = async () => {};
    const baseMessage = {
      chat: { id: -100789, type: "supergroup", title: "Topic Room" },
      from: { id: 902, first_name: "Ada" },
    };

    const pair = await handleTelegramWebhookSecret(
      topicSecret,
      {
        message: {
          ...baseMessage,
          message_id: 501,
          message_thread_id: 10,
          text: `/start@ops_topic_bot ${topicPairingCode}`,
        },
      },
      sender,
    );
    expect(pair.ok).toBe(true);

    const selectA = await handleTelegramWebhookSecret(
      topicSecret,
      {
        message: {
          ...baseMessage,
          message_id: 502,
          message_thread_id: 10,
          text: `/project@ops_topic_bot ${topicAProject.project!.id}`,
        },
      },
      sender,
    );
    expect(selectA.ok).toBe(true);
    expect(selectA.reply).toContain("Topic A Ops");

    const selectB = await handleTelegramWebhookSecret(
      topicSecret,
      {
        message: {
          ...baseMessage,
          message_id: 503,
          message_thread_id: 20,
          text: `/project@ops_topic_bot ${topicBProject.project!.id}`,
        },
      },
      sender,
    );
    expect(selectB.ok).toBe(true);
    expect(selectB.reply).toContain("Topic B Ops");

    const tasksA = await handleTelegramWebhookSecret(
      topicSecret,
      {
        message: {
          ...baseMessage,
          message_id: 504,
          message_thread_id: 10,
          text: "/tasks@ops_topic_bot",
        },
      },
      sender,
    );
    expect(tasksA.ok).toBe(true);
    expect(tasksA.reply).toContain("Traiter le sujet A");
    expect(tasksA.reply).not.toContain("Traiter le sujet B");
    expect(tasksA.projectId).toBe(topicAProject.project!.id);

    const tasksB = await handleTelegramWebhookSecret(
      topicSecret,
      {
        message: {
          ...baseMessage,
          message_id: 505,
          message_thread_id: 20,
          text: "/tasks@ops_topic_bot",
        },
      },
      sender,
    );
    expect(tasksB.ok).toBe(true);
    expect(tasksB.reply).toContain("Traiter le sujet B");
    expect(tasksB.reply).not.toContain("Traiter le sujet A");
    expect(tasksB.projectId).toBe(topicBProject.project!.id);

    const sessions = await db
      .select()
      .from(schema.channelSessions)
      .where(eq(schema.channelSessions.connectionId, topicConnection!.id));
    expect(sessions).toContainEqual(
      expect.objectContaining({
        externalChatId: "-100789:thread:10",
        activeProjectId: topicAProject.project!.id,
      }),
    );
    expect(sessions).toContainEqual(
      expect.objectContaining({
        externalChatId: "-100789:thread:20",
        activeProjectId: topicBProject.project!.id,
      }),
    );
  });

  test("adds downloaded Telegram text document context to the routed run", async () => {
    const sender = async ({ text }: { text: string }) => {
      sent.push(text);
    };
    const res = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 232,
          caption: "résume ce fichier",
          document: {
            file_id: "doc_notes",
            file_name: "notes.md",
            mime_type: "text/markdown",
            file_size: 128,
          },
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
      async ({ attachments }) => [
        `Fichier Telegram disponible : ${attachments[0]!.kind} "${attachments[0]!.fileName}".`,
        'Aperçu du fichier "notes.md" :\n# Brief client\n- Répondre avant vendredi',
      ],
    );

    expect(res.ok).toBe(true);
    expect(res.reply).toContain("Telegram Controller est dessus.");
    expect(res.runId).toBeTruthy();

    const [run] = await db
      .select({ input: schema.runs.input })
      .from(schema.runs)
      .where(eq(schema.runs.id, res.runId!))
      .limit(1);
    const input = JSON.stringify(run?.input);
    expect(input).toContain("résume ce fichier");
    expect(input).toContain("document \\\"notes.md\\\" text/markdown 128o");
    expect(input).toContain("Aperçu du fichier");
    expect(input).toContain("Répondre avant vendredi");
  });

  test("keeps an active Telegram agent so later messages do not need /run", async () => {
    const second = await createAgent(teamId, { name: "Deep Researcher" });
    await publishAgent(teamId, second.id, {
      instructions: "Research deeply.",
      runtimeKind: "claude",
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
    expect(selected.reply).toContain("agent actif");
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
    expect(res.reply).toContain("Deep Researcher est dessus.");
    expect(res.reply).toContain("Détail :");
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
    expect(followUp.reply).toContain("Deep Researcher est dessus.");
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
    expect(cleared.reply).toContain("Mode agent désactivé");
  });

  test("routes natural web questions through the orchestrator instead of a pinned hint", async () => {
    const coder = await createAgent(teamId, { name: "Backend Coder" });
    await publishAgent(teamId, coder.id, {
      instructions: "Fix code, tests, TypeScript, Go, and backend bugs.",
      runtimeKind: "claude",
    });
    const web = await createAgent(teamId, { name: "Web Weather Researcher" });
    await publishAgent(teamId, web.id, {
      instructions: "Use web search, browser research, internet sources, weather and news.",
      runtimeKind: "claude",
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
    expect(routed.reply).toContain("Web Weather Researcher est dessus.");
    expect(routed.reply).not.toContain("Backend Coder est dessus.");
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
    expect(res.reply).toContain("Mémoire projet enregistrée.");
    expect(res.reply).toContain("Contenu : Use bun only for this project.");
    expect(res.reply).not.toContain("Project memory saved");
    const rows = await db
      .select()
      .from(schema.memoryEntries)
      .where(eq(schema.memoryEntries.targetId, projectId));
    expect(rows).toContainEqual(expect.objectContaining({
      scope: "project",
      content: "Use bun only for this project.",
      confidence: 1,
      createdBy: "user",
    }));
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
    const delivered: Array<{ text: string; parseMode?: string; replyMarkup?: unknown }> = [];
    const actions: string[] = [];
    const count = await notifyRunTelegram(
      teamId,
      "run_notify",
      "Approval requested\nAllow deploy?",
      async ({ text, parseMode, replyMarkup }) => {
        delivered.push({ text, parseMode, replyMarkup });
      },
      async ({ action }) => {
        actions.push(action);
      },
      {
        replyMarkup: {
          inline_keyboard: [[{ text: "Approuver", callback_data: "run:approve:run_notify" }]],
        },
      },
    );
    expect(count).toBeGreaterThanOrEqual(2);
    expect(actions).toHaveLength(count);
    expect(actions.every((action) => action === "typing")).toBe(true);
    expect(delivered[0]?.text).toContain("Approval requested");
    expect(delivered[0]?.text).toContain(`/${teamSlug}/runs/run_notify`);
    expect(delivered[0]?.parseMode).toBe("HTML");
    expect(delivered.at(-1)?.replyMarkup).toEqual({
      inline_keyboard: [[{ text: "Approuver", callback_data: "run:approve:run_notify" }]],
    });
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
    expect(count).toBeGreaterThanOrEqual(2);
    expect(actions).toHaveLength(count);
    expect(actions.every((action) => action === "typing")).toBe(true);
  });

  test("sends progress updates as compact agent summaries", async () => {
    const delivered: string[] = [];
    const count = await notifyRunProgressTelegram(
      teamId,
      `run_progress_${Date.now()}`,
      {
        completedSteps: 2,
        stepCount: 5,
        latest: "Completed gmail.read",
        text: "Je suis dessus.\n2/5 étapes terminées.\nDernière action : Completed gmail.read",
      },
      async ({ text }) => {
        delivered.push(text);
      },
    );

    expect(count).toBeGreaterThanOrEqual(2);
    expect(delivered[0]).toContain("Je suis dessus.");
    expect(delivered[0]).toContain("2/5 étapes terminées.");
    expect(delivered[0]).not.toContain("Run progress");
    expect(delivered[0]).not.toContain("steps completed");
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
    expect(status.reply).toContain("Voici l'état actuel.");
    expect(status.reply).toContain("Statut : queued");
    expect(status.reply).toContain("Progression :");
    expect(status.reply).toContain(`/${teamSlug}/runs/${runId}`);
    expect(status.reply).not.toContain("Status:");

    const nextRunId = genId("run");
    await db.insert(schema.runs).values({
      id: nextRunId,
      teamId,
      executor: "daemon",
      agentId,
      status: "queued",
      kind: "chat",
      input: {
        prompt: "advance from telegram",
        simulate: {
          requireApproval: true,
          steps: ["Prepared draft."],
        },
      },
    });
    const next = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 55,
          text: `/next ${nextRunId}`,
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(next.ok).toBe(true);
    expect(next.reply).toContain("J'avance la file d'exécution.");
    expect(next.reply).toContain(`${nextRunId} -> waiting_approval`);
    expect(next.reply).toContain("Accord requis");

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
    expect(pause.reply).toContain("J'ai mis ce run en pause.");
    expect(pause.reply).toContain(`/${teamSlug}/runs/${runId}`);
    expect(pause.reply).not.toContain("Run paused");

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
    expect(resume.reply).toContain("Je relance ce run.");

    expect(
      await requestRunApproval(teamId, runId, "Allow this run?"),
    ).toBe(true);
    const approve = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 8,
          text: "/approve ok",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(approve.ok).toBe(true);
    expect(approve.reply).toContain("Accord reçu.");
    expect(approve.reply).not.toContain("Run approved");

    expect(
      await requestRunApproval(teamId, runId, "Allow second attempt?"),
    ).toBe(true);
    const reject = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        message: {
          message_id: 9,
          text: "/reject later",
          chat: { id: 456 },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(reject.ok).toBe(true);
    expect(reject.reply).toContain("Refus enregistré.");
    expect(reject.reply).not.toContain("Run rejected");

    const [task] = await db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .limit(1);
    expect(task?.status).toBe("cancelled");

    const buttonRunId = genId("run");
    await db.insert(schema.runs).values({
      id: buttonRunId,
      teamId,
      executor: "daemon",
      agentId,
      status: "queued",
      kind: "direct",
      input: { prompt: "approve from button" },
    });
    expect(
      await requestRunApproval(teamId, buttonRunId, "Allow button approval?"),
    ).toBe(true);
    const callbackApprove = await handleTelegramWebhookSecret(
      webhookSecret,
      {
        callback_query: {
          id: "cb_approve_1",
          data: `run:approve:${buttonRunId}`,
          message: {
            message_id: 11,
            chat: { id: 456 },
          },
          from: { id: 123, first_name: "Ada" },
        },
      },
      sender,
    );
    expect(callbackApprove.ok).toBe(true);
    expect(callbackApprove.reply).toContain("Accord reçu.");
    const [buttonTask] = await db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, buttonRunId))
      .limit(1);
    expect(buttonTask?.status).toBe("queued");
    expect(buttonTask?.input).toMatchObject({
      approval: { approved: true, reason: "telegram_button" },
    });

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
    expect(kill.reply).toContain("J'ai arrêté ce run.");
    expect(kill.reply).toContain(`/${teamSlug}/runs/${killRunId}`);
    expect(kill.reply).not.toContain("Run cancelled");
  });
});
