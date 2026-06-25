import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { decryptJson, encryptJson } from "./crypto";
import { genId } from "./db/ids";
import {
  approveAgentTask,
  cancelAgentTask,
  getRunUnified,
  listAgentRows,
  pauseAgentTask,
  rejectAgentTask,
  resumeAgentTask,
  runAgent,
} from "./agents-repo";
import {
  createProjectTask,
  getProject,
  listProjects,
  runProjectTask,
} from "./projects-repo";
import { insertConfirmedMemory } from "./learning-repo";
import { env } from "./env";

const { channelConnections, channelIdentities, channelMessages } = schema;

type ChannelConnectionRow = typeof channelConnections.$inferSelect;
type ChannelIdentityRow = typeof channelIdentities.$inferSelect;
type AgentListRow = Awaited<ReturnType<typeof listAgentRows>>[number];

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id?: number;
  text?: string;
  chat?: {
    id?: number | string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  from?: {
    id?: number | string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
}

export type TelegramCommand =
  | { kind: "help" }
  | { kind: "pair"; code: string }
  | { kind: "agents" }
  | { kind: "projects" }
  | { kind: "tasks"; projectId?: string }
  | { kind: "run"; projectId: string; agentId?: string; title: string }
  | { kind: "runAgent"; agentId: string; input: string }
  | { kind: "runAgentHandle"; handle: string; input: string }
  | { kind: "runTask"; taskId: string; instruction?: string }
  | { kind: "runHelp"; text?: string }
  | { kind: "status"; runId: string }
  | { kind: "kill"; runId: string }
  | { kind: "pause"; runId: string; reason?: string }
  | { kind: "resume"; runId: string; reason?: string }
  | { kind: "approve"; runId: string; reason?: string }
  | { kind: "reject"; runId: string; reason?: string }
  | { kind: "learn"; projectId?: string; content: string }
  | { kind: "unknown"; text: string };

export interface TelegramDispatchResult {
  ok: boolean;
  reply: string;
  runId?: string;
  projectId?: string;
  projectTaskId?: string;
}

export type TelegramSender = (input: {
  connection: ChannelConnectionRow;
  chatId: string;
  text: string;
}) => Promise<void>;

function randomToken(bytes = 18) {
  return randomBytes(bytes).toString("base64url");
}

function displayName(message: TelegramMessage) {
  const from = message.from ?? {};
  const parts = [from.first_name, from.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return parts || from.username || "Telegram user";
}

function cleanArg(value: string) {
  return value
    .trim()
    .replace(/^["“]|["”]$/g, "")
    .trim();
}

function normalizeAgentHandle(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function agentHandle(agent: { id: string; name: string }) {
  return normalizeAgentHandle(agent.name).slice(0, 40) || agent.id;
}

export function parseTelegramCommand(text: string): TelegramCommand {
  const clean = text.trim();
  if (!clean || clean === "/help") return { kind: "help" };
  const start = clean.match(/^\/start(?:\s+(.+))?$/);
  if (start) return { kind: "pair", code: (start[1] ?? "").trim() };
  if (clean === "/projects") return { kind: "projects" };
  if (clean === "/agents") return { kind: "agents" };
  const tasks = clean.match(/^\/tasks(?:\s+project:([^\s]+))?$/);
  if (tasks) return { kind: "tasks", projectId: tasks[1] };
  if (clean === "/run") return { kind: "runHelp" };
  const status = clean.match(/^\/status\s+([^\s]+)$/);
  if (status?.[1]) return { kind: "status", runId: status[1] };
  const kill = clean.match(/^\/kill\s+([^\s]+)$/);
  if (kill?.[1]) return { kind: "kill", runId: kill[1] };
  const pause = clean.match(/^\/pause\s+([^\s]+)(?:\s+([\s\S]+))?$/);
  if (pause?.[1])
    return {
      kind: "pause",
      runId: pause[1],
      reason: pause[2] ? cleanArg(pause[2]) : undefined,
    };
  const resume = clean.match(/^\/resume\s+([^\s]+)(?:\s+([\s\S]+))?$/);
  if (resume?.[1])
    return {
      kind: "resume",
      runId: resume[1],
      reason: resume[2] ? cleanArg(resume[2]) : undefined,
    };
  const approve = clean.match(/^\/approve\s+([^\s]+)(?:\s+([\s\S]+))?$/);
  if (approve?.[1])
    return {
      kind: "approve",
      runId: approve[1],
      reason: approve[2] ? cleanArg(approve[2]) : undefined,
    };
  const reject = clean.match(/^\/reject\s+([^\s]+)(?:\s+([\s\S]+))?$/);
  if (reject?.[1])
    return {
      kind: "reject",
      runId: reject[1],
      reason: reject[2] ? cleanArg(reject[2]) : undefined,
    };
  const learn = clean.match(/^\/learn(?:\s+project:([^\s]+))?\s+([\s\S]+)$/);
  if (learn)
    return {
      kind: "learn",
      projectId: learn[1],
      content: cleanArg(learn[2] ?? ""),
    };
  const runTask = clean.match(/^\/run\s+task:([^\s]+)(?:\s+([\s\S]+))?$/);
  if (runTask?.[1]) {
    return {
      kind: "runTask",
      taskId: runTask[1],
      instruction: runTask[2] ? cleanArg(runTask[2]) : undefined,
    };
  }
  const runAgentMatch = clean.match(/^\/run\s+agent:([^\s]+)\s+([\s\S]+)$/);
  if (runAgentMatch?.[1]) {
    return {
      kind: "runAgent",
      agentId: runAgentMatch[1],
      input: cleanArg(runAgentMatch[2] ?? ""),
    };
  }
  const runAgentHandleMatch = clean.match(/^\/run\s+@([a-zA-Z0-9_]+)\s+([\s\S]+)$/);
  if (runAgentHandleMatch?.[1]) {
    return {
      kind: "runAgentHandle",
      handle: normalizeAgentHandle(runAgentHandleMatch[1]),
      input: cleanArg(runAgentHandleMatch[2] ?? ""),
    };
  }
  const directAgentHandleMatch = clean.match(/^@([a-zA-Z0-9_]+)\s+([\s\S]+)$/);
  if (directAgentHandleMatch?.[1]) {
    return {
      kind: "runAgentHandle",
      handle: normalizeAgentHandle(directAgentHandleMatch[1]),
      input: cleanArg(directAgentHandleMatch[2] ?? ""),
    };
  }
  const run = clean.match(
    /^\/run\s+project:([^\s]+)(?:\s+agent:([^\s]+))?\s+([\s\S]+)$/,
  );
  if (run) {
    return {
      kind: "run",
      projectId: run[1]!,
      agentId: run[2],
      title: cleanArg(run[3] ?? ""),
    };
  }
  if (/\b(agent|agents|lance|lancer|lances|run|ex[eé]cute|start)\b/i.test(clean)) {
    return { kind: "runHelp", text: clean };
  }
  return { kind: "unknown", text: clean };
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/** Single entry point to the Telegram Bot API. Returns null on network failure. */
export async function telegramCall<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<TelegramApiResponse<T> | null> {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
    .then((r) => r.json() as Promise<TelegramApiResponse<T>>)
    .catch(() => null);
}

function connectionToken(connection: Pick<ChannelConnectionRow, "botTokenEncrypted">): string | null {
  if (!connection.botTokenEncrypted) return null;
  return decryptJson<{ token: string }>(connection.botTokenEncrypted).token;
}

export async function listChannelConnections(teamId: string) {
  const rows = await db
    .select()
    .from(channelConnections)
    .where(eq(channelConnections.teamId, teamId))
    .orderBy(desc(channelConnections.updatedAt));
  const identities = await db
    .select()
    .from(channelIdentities)
    .where(eq(channelIdentities.teamId, teamId));
  return rows.map((row) => ({
    id: row.id,
    teamId: row.teamId,
    provider: row.provider,
    label: row.label,
    status: row.status,
    transport: row.transport,
    webhookSecret: row.webhookSecret,
    webhookPath: `/api/v1/channels/telegram/${row.webhookSecret}/webhook`,
    pairingCode: row.pairingCode,
    botUsername: row.botUsername,
    botTokenConfigured: Boolean(row.botTokenEncrypted),
    identityCount: identities.filter(
      (identity) => identity.connectionId === row.id,
    ).length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function deleteChannelConnection(teamId: string, id: string): Promise<boolean> {
  // channel_identities and channel_messages cascade on connection delete (see schema).
  const deleted = await db
    .delete(channelConnections)
    .where(and(eq(channelConnections.id, id), eq(channelConnections.teamId, teamId)))
    .returning({ id: channelConnections.id });
  return deleted.length > 0;
}

/**
 * Registers the connection's webhook with Telegram so the bot actually receives
 * updates. Without this the stored token does nothing — Telegram never calls us.
 * `baseUrl` must be the engine's PUBLIC https origin (a tunnel in local dev).
 */
export async function registerTelegramWebhook(
  teamId: string,
  id: string,
  baseUrl: string,
): Promise<{ ok: boolean; url?: string; botUsername?: string; error?: string }> {
  const [connection] = await db
    .select()
    .from(channelConnections)
    .where(and(eq(channelConnections.id, id), eq(channelConnections.teamId, teamId)))
    .limit(1);
  if (!connection) return { ok: false, error: "connection_not_found" };
  if (!connection.botTokenEncrypted) return { ok: false, error: "bot_token_missing" };

  const token = connectionToken(connection)!;
  const origin = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(origin)) {
    return { ok: false, error: "Telegram requires a public https URL (use a tunnel like cloudflared/ngrok in local dev)." };
  }
  const url = `${origin}/api/v1/channels/telegram/${connection.webhookSecret}/webhook`;

  // Validate the token resolves to a real bot before wiring the webhook.
  const me = await telegramCall<{ username?: string }>(token, "getMe");
  if (!me?.ok) {
    await db.update(channelConnections).set({ status: "error", updatedAt: sql`now()` }).where(eq(channelConnections.id, connection.id));
    return { ok: false, error: me?.description ?? "Invalid bot token (getMe failed)." };
  }

  const set = await telegramCall(token, "setWebhook", { url, allowed_updates: ["message"], drop_pending_updates: true });
  if (!set?.ok) {
    await db.update(channelConnections).set({ status: "error", updatedAt: sql`now()` }).where(eq(channelConnections.id, connection.id));
    return { ok: false, url, botUsername: me.result?.username, error: set?.description ?? "Telegram setWebhook failed." };
  }

  await db
    .update(channelConnections)
    .set({
      status: "active",
      transport: "webhook",
      botUsername: me.result?.username ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(channelConnections.id, connection.id));
  return { ok: true, url, botUsername: me.result?.username };
}

/**
 * Switches a connection back to long polling: clears any Telegram webhook (otherwise
 * getUpdates returns 409) and resets transport. The poller then picks it up.
 */
export async function useTelegramPolling(
  teamId: string,
  id: string,
): Promise<{ ok: boolean; botUsername?: string; error?: string }> {
  const [connection] = await db
    .select()
    .from(channelConnections)
    .where(and(eq(channelConnections.id, id), eq(channelConnections.teamId, teamId)))
    .limit(1);
  if (!connection) return { ok: false, error: "connection_not_found" };
  const token = connectionToken(connection);
  if (!token) return { ok: false, error: "bot_token_missing" };

  const me = await telegramCall<{ username?: string }>(token, "getMe");
  if (!me?.ok) {
    await db.update(channelConnections).set({ status: "error", updatedAt: sql`now()` }).where(eq(channelConnections.id, connection.id));
    return { ok: false, error: me?.description ?? "Invalid bot token (getMe failed)." };
  }
  await telegramCall(token, "deleteWebhook", { drop_pending_updates: false });
  await db
    .update(channelConnections)
    .set({
      status: "active",
      transport: "polling",
      botUsername: me.result?.username ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(channelConnections.id, connection.id));
  return { ok: true, botUsername: me.result?.username };
}

export async function createTelegramConnection(
  teamId: string,
  createdBy: string,
  input: { label?: string; botToken?: string },
): Promise<
  | { connection: Awaited<ReturnType<typeof listChannelConnections>>[number] }
  | { error: string }
> {
  const botToken = input.botToken?.trim();
  let botUsername: string | null = null;

  // Fail fast on a bad token (Telegram's "Invalid bot passed." / "Unauthorized")
  // instead of storing a dead connection the user later can't make work.
  if (botToken) {
    const me = await telegramCall<{ username?: string }>(botToken, "getMe");
    if (!me?.ok) return { error: me?.description ?? "Invalid bot token (getMe failed)." };
    botUsername = me.result?.username ?? null;
    // Clear any stale webhook so the default polling transport can use getUpdates.
    await telegramCall(botToken, "deleteWebhook", { drop_pending_updates: false });
  }

  const [connection] = await db
    .insert(channelConnections)
    .values({
      id: genId("chan"),
      teamId,
      provider: "telegram",
      label: input.label?.trim() || "Telegram",
      status: botToken ? "active" : "setup",
      botTokenEncrypted: botToken ? encryptJson({ token: botToken }) : null,
      botUsername,
      transport: "polling",
      webhookSecret: randomToken(24),
      pairingCode: randomToken(6),
      createdBy,
    })
    .returning();
  const created = (await listChannelConnections(teamId)).find(
    (item) => item.id === connection!.id,
  )!;
  return { connection: created };
}

async function findIdentity(
  connection: ChannelConnectionRow,
  message: TelegramMessage,
) {
  const userId = String(message.from?.id ?? "");
  const chatId = String(message.chat?.id ?? "");
  if (!userId || !chatId) return null;
  const [identity] = await db
    .select()
    .from(channelIdentities)
    .where(
      and(
        eq(channelIdentities.connectionId, connection.id),
        eq(channelIdentities.externalUserId, userId),
        eq(channelIdentities.externalChatId, chatId),
      ),
    )
    .limit(1);
  return identity ?? null;
}

async function pairIdentity(
  connection: ChannelConnectionRow,
  message: TelegramMessage,
  code: string,
) {
  if (!code || code !== connection.pairingCode) return null;
  const userId = String(message.from?.id ?? "");
  const chatId = String(message.chat?.id ?? "");
  if (!userId || !chatId) return null;
  const existing = await findIdentity(connection, message);
  if (existing) return existing;
  const [identity] = await db
    .insert(channelIdentities)
    .values({
      id: genId("chident"),
      teamId: connection.teamId,
      connectionId: connection.id,
      externalUserId: userId,
      externalChatId: chatId,
      displayName: displayName(message),
      role: "operator",
    })
    .returning();
  return identity ?? null;
}

async function recordMessage(input: {
  connection: ChannelConnectionRow;
  identity?: ChannelIdentityRow | null;
  direction: "inbound" | "outbound";
  text: string;
  message?: TelegramMessage;
  payload?: Record<string, unknown>;
  runId?: string;
  projectId?: string;
  projectTaskId?: string;
}) {
  await db.insert(channelMessages).values({
    id: genId("chmsg"),
    teamId: input.connection.teamId,
    connectionId: input.connection.id,
    identityId: input.identity?.id ?? null,
    externalMessageId:
      input.message?.message_id != null
        ? String(input.message.message_id)
        : null,
    direction: input.direction,
    text: input.text,
    payload: input.payload ?? null,
    runId: input.runId,
    projectId: input.projectId,
    projectTaskId: input.projectTaskId,
  });
}

function helpText(connection: ChannelConnectionRow) {
  return [
    "Agentik Telegram control",
    `Pair: /start ${connection.pairingCode}`,
    "/projects",
    "/agents",
    "/tasks project:<projectId>",
    '/run task:<taskId> ["extra instruction"]',
    '/run @agent_handle "Prompt"',
    '/run agent:<agentId> "Prompt"',
    '/run project:<projectId> [agent:<agentId>] "Task title"',
    "/status <runId>",
    "/pause <runId>",
    "/resume <runId>",
    "/approve <runId> [reason]",
    "/reject <runId> [reason]",
    "/kill <runId>",
    '/learn project:<projectId> "confirmed project memory"',
  ].join("\n");
}

async function runHelpText(teamId: string, intro?: string) {
  const [agents, projects] = await Promise.all([
    listAgentRows(teamId),
    listProjects(teamId),
  ]);
  const lines = [
    intro ?? "I can start an existing project task or a published agent.",
    "",
    "Fast paths:",
    '/run task:<taskId> "optional extra instruction"',
    '/run @agent_handle "what should the agent do?"',
    '/run agent:<agentId> "what should the agent do?"',
    '/run project:<projectId> "new task title"',
  ];
  if (agents.length) {
    lines.push(
      "",
      "Agents:",
      ...agents
        .slice(0, 6)
        .map((agent) => `${agent.name} · @${agentHandle(agent)} · ${agent.id} · ${agent.health}`),
    );
  }
  if (projects.length) {
    lines.push(
      "",
      "Projects:",
      ...projects
        .slice(0, 6)
        .map((project) => `${project.name} · ${project.id} · ${project.openTaskCount} open`),
    );
  }
  lines.push("", "Use /tasks to list open task ids.");
  return lines.join("\n");
}

async function resolveAgentHandle(
  teamId: string,
  handle: string,
): Promise<
  | { agent: AgentListRow }
  | { error: "ambiguous" | "not_found"; agents: AgentListRow[] }
> {
  const normalized = normalizeAgentHandle(handle);
  const agents = await listAgentRows(teamId);
  const matches = agents.filter(
    (agent) =>
      normalizeAgentHandle(agent.id) === normalized ||
      agentHandle(agent) === normalized,
  );
  if (matches.length === 1) return { agent: matches[0]! };
  if (matches.length > 1) return { error: "ambiguous" as const, agents: matches };
  return { error: "not_found" as const, agents };
}

async function webRunUrl(teamId: string, runId: string) {
  const [team] = await db
    .select({ slug: schema.teams.slug })
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .limit(1);
  const teamSegment = encodeURIComponent(team?.slug ?? teamId);
  return `${env.WEB_PUBLIC_URL.replace(/\/$/, "")}/${teamSegment}/runs/${encodeURIComponent(runId)}`;
}

async function executeCommand(
  connection: ChannelConnectionRow,
  identity: ChannelIdentityRow,
  command: TelegramCommand,
): Promise<TelegramDispatchResult> {
  switch (command.kind) {
    case "help":
      return { ok: true, reply: helpText(connection) };
    case "pair":
      return { ok: true, reply: "This chat is already paired." };
    case "agents": {
      const agents = await listAgentRows(connection.teamId);
      if (!agents.length) return { ok: true, reply: "No agents yet." };
      return {
        ok: true,
        reply: agents
          .slice(0, 10)
          .map(
            (agent) =>
              `${agent.name}\n@${agentHandle(agent)} · ${agent.id} · ${agent.health} · ${agent.model}`,
          )
          .join("\n\n"),
      };
    }
    case "projects": {
      const projects = await listProjects(connection.teamId);
      if (!projects.length) return { ok: true, reply: "No projects yet." };
      return {
        ok: true,
        reply: projects
          .slice(0, 8)
          .map(
            (project) =>
              `${project.name}\n${project.id} · ${project.openTaskCount} open · ${project.type}`,
          )
          .join("\n\n"),
      };
    }
    case "tasks": {
      const projects = command.projectId
        ? [await getProject(connection.teamId, command.projectId)]
        : await Promise.all(
            (await listProjects(connection.teamId))
              .slice(0, 5)
              .map((project) => getProject(connection.teamId, project.id)),
          );
      const tasks = projects
        .filter(Boolean)
        .flatMap((project) =>
          project!.tasks.map((task) => ({ project: project!.project, task })),
        )
        .filter(({ task }) => !["done", "cancelled"].includes(task.status))
        .slice(0, 10);
      if (!tasks.length) return { ok: true, reply: "No open tasks." };
      return {
        ok: true,
        reply: tasks
          .map(
            ({ project, task }) =>
              `${task.priority} ${task.title}\n${project.name} · ${task.status} · ${task.id}`,
          )
          .join("\n\n"),
      };
    }
    case "run": {
      if (!command.title)
        return {
          ok: false,
          reply: 'Usage: /run project:<projectId> "Task title"',
        };
      const task = await createProjectTask(
        connection.teamId,
        command.projectId,
        `telegram:${identity.externalUserId}`,
        {
          title: command.title,
          assignedAgentId: command.agentId ?? null,
          status: "ready",
        },
      );
      if ("error" in task)
        return {
          ok: false,
          reply: `Could not create task: ${task.error}`,
          projectId: command.projectId,
        };
      const projectTask = task.task;
      if (!projectTask)
        return {
          ok: false,
          reply: "Could not create task.",
          projectId: command.projectId,
        };
      const run = await runProjectTask(
        connection.teamId,
        projectTask.id,
        "Started from Telegram.",
      );
      if ("error" in run) {
        return {
          ok: false,
          reply: `Task created, but run did not start: ${projectTask.id}\nReason: ${run.error}`,
          projectId: command.projectId,
          projectTaskId: projectTask.id,
        };
      }
      return {
        ok: true,
        reply: `Run started\nTask: ${projectTask.title}\nRun: ${run.runId}\nOpen: ${await webRunUrl(connection.teamId, run.runId)}`,
        runId: run.runId,
        projectId: command.projectId,
        projectTaskId: projectTask.id,
      };
    }
    case "runAgent": {
      if (!command.input)
        return {
          ok: false,
          reply: 'Usage: /run agent:<agentId> "what should the agent do?"',
        };
      const run = await runAgent(connection.teamId, command.agentId, command.input);
      if (!run) return { ok: false, reply: "Agent not found." };
      if ("error" in run)
        return {
          ok: false,
          reply:
            run.error === "not_published"
              ? "This agent is not published yet."
              : `Could not start agent: ${run.error}`,
        };
      return {
        ok: true,
        reply: `Agent run started\nRun: ${run.runId}\nOpen: ${await webRunUrl(connection.teamId, run.runId)}`,
        runId: run.runId,
      };
    }
    case "runAgentHandle": {
      if (!command.input)
        return {
          ok: false,
          reply: 'Usage: /run @agent_handle "what should the agent do?"',
        };
      const resolved = await resolveAgentHandle(connection.teamId, command.handle);
      if ("error" in resolved) {
        if (resolved.error === "ambiguous") {
          return {
            ok: false,
            reply: [
              `Several agents match @${command.handle}. Use one id explicitly:`,
              ...resolved.agents.map((agent) => `${agent.name} · ${agent.id}`),
            ].join("\n"),
          };
        }
        return {
          ok: false,
          reply: `No agent found for @${command.handle}.\nUse /agents to list available handles.`,
        };
      }
      const run = await runAgent(connection.teamId, resolved.agent.id, command.input);
      if (!run) return { ok: false, reply: "Agent not found." };
      if ("error" in run)
        return {
          ok: false,
          reply:
            run.error === "not_published"
              ? "This agent is not published yet."
              : `Could not start agent: ${run.error}`,
        };
      return {
        ok: true,
        reply: `Agent run started\nAgent: ${resolved.agent.name}\nRun: ${run.runId}\nOpen: ${await webRunUrl(connection.teamId, run.runId)}`,
        runId: run.runId,
      };
    }
    case "runTask": {
      const run = await runProjectTask(
        connection.teamId,
        command.taskId,
        command.instruction,
      );
      if ("error" in run) {
        return {
          ok: false,
          reply: `Could not start task: ${run.error}\nUse /tasks to list open task ids.`,
          projectTaskId: command.taskId,
        };
      }
      return {
        ok: true,
        reply: `Task run started\nTask: ${command.taskId}\nRun: ${run.runId}\nOpen: ${await webRunUrl(connection.teamId, run.runId)}`,
        runId: run.runId,
        projectTaskId: command.taskId,
      };
    }
    case "runHelp":
      return {
        ok: true,
        reply: await runHelpText(
          connection.teamId,
          command.text
            ? "I do not run free-form chat yet. Use one of these explicit commands."
            : undefined,
        ),
      };
    case "status": {
      const detail = await getRunUnified(connection.teamId, command.runId);
      if (!detail)
        return { ok: false, reply: "Run not found.", runId: command.runId };
      return {
        ok: true,
        reply: `Run ${detail.run.id}\nStatus: ${detail.run.status}\nSteps: ${detail.run.completedSteps}/${detail.run.stepCount}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`,
        runId: command.runId,
      };
    }
    case "kill": {
      const ok = await cancelAgentTask(connection.teamId, command.runId);
      return {
        ok,
        reply: ok
          ? `Run cancelled: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not cancellable.",
        runId: command.runId,
      };
    }
    case "pause": {
      const ok = await pauseAgentTask(
        connection.teamId,
        command.runId,
        command.reason,
      );
      return {
        ok,
        reply: ok
          ? `Run paused: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not pauseable.",
        runId: command.runId,
      };
    }
    case "resume": {
      const ok = await resumeAgentTask(
        connection.teamId,
        command.runId,
        command.reason,
      );
      return {
        ok,
        reply: ok
          ? `Run resumed: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not paused.",
        runId: command.runId,
      };
    }
    case "approve": {
      const ok = await approveAgentTask(
        connection.teamId,
        command.runId,
        command.reason,
      );
      return {
        ok,
        reply: ok
          ? `Run approved: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not waiting for approval.",
        runId: command.runId,
      };
    }
    case "reject": {
      const ok = await rejectAgentTask(
        connection.teamId,
        command.runId,
        command.reason,
      );
      return {
        ok,
        reply: ok
          ? `Run rejected: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not waiting for approval.",
        runId: command.runId,
      };
    }
    case "learn":
      if (!command.projectId)
        return {
          ok: false,
          reply: 'Usage: /learn project:<projectId> "confirmed project memory"',
        };
      if (!command.content)
        return {
          ok: false,
          reply: "Memory content is required.",
          projectId: command.projectId,
        };
      if (!(await getProject(connection.teamId, command.projectId))) {
        return {
          ok: false,
          reply: "Project not found.",
          projectId: command.projectId,
        };
      }
      await insertConfirmedMemory({
        teamId: connection.teamId,
        scope: "project",
        targetId: command.projectId,
        content: command.content,
        confidence: 1,
        createdBy: "user",
      });
      return {
        ok: true,
        reply: `Project memory saved\nProject: ${command.projectId}\n${command.content}`,
        projectId: command.projectId,
      };
    case "unknown":
      return {
        ok: false,
        reply: `Unknown command: ${command.text}\n\n${helpText(connection)}`,
      };
  }
}

export async function sendTelegramMessage(input: {
  connection: ChannelConnectionRow;
  chatId: string;
  text: string;
}) {
  const token = connectionToken(input.connection);
  if (!token) return;
  await telegramCall(token, "sendMessage", { chat_id: input.chatId, text: input.text });
}

export async function notifyRunTelegram(
  teamId: string,
  runId: string,
  text: string,
  sender: TelegramSender = sendTelegramMessage,
) {
  const connections = await db
    .select()
    .from(channelConnections)
    .where(
      and(
        eq(channelConnections.teamId, teamId),
        eq(channelConnections.provider, "telegram"),
        eq(channelConnections.status, "active"),
      ),
    );
  if (!connections.length) return 0;

  const identities = await db
    .select()
    .from(channelIdentities)
    .where(eq(channelIdentities.teamId, teamId));
  const body = `${text}\nOpen: ${await webRunUrl(teamId, runId)}`;
  let sent = 0;

  for (const connection of connections) {
    for (const identity of identities.filter(
      (item) => item.connectionId === connection.id,
    )) {
      await recordMessage({
        connection,
        identity,
        direction: "outbound",
        text: body,
        payload: { kind: "run.notification" },
        runId,
      });
      await sender({ connection, chatId: identity.externalChatId, text: body });
      sent += 1;
    }
  }

  return sent;
}

/**
 * Core dispatch for one Telegram update against a resolved connection. Shared by
 * the webhook route and the long-polling loop so both behave identically.
 */
export async function processTelegramUpdate(
  connection: ChannelConnectionRow,
  update: TelegramUpdate,
  sender: TelegramSender = sendTelegramMessage,
): Promise<TelegramDispatchResult> {
  const message = update.message;
  const text = message?.text?.trim();
  const chatId = message?.chat?.id != null ? String(message.chat.id) : "";
  if (!message || !text || !chatId) return { ok: true, reply: "ignored" };

  const command = parseTelegramCommand(text);
  let identity = await findIdentity(connection, message);
  await recordMessage({
    connection,
    identity,
    direction: "inbound",
    text,
    message,
    payload: update as Record<string, unknown>,
  });

  let result: TelegramDispatchResult;
  if (command.kind === "pair") {
    identity = await pairIdentity(connection, message, command.code);
    result = identity
      ? {
          ok: true,
          reply: "Telegram paired. You can now run /projects or /help.",
        }
      : {
          ok: false,
          reply:
            "Invalid pairing code. Open Agentik Channels and copy the current /start code.",
        };
  } else if (!identity) {
    result = {
      ok: false,
      reply: `This chat is not paired.\nUse: /start ${connection.pairingCode}`,
    };
  } else {
    result = await executeCommand(connection, identity, command);
  }

  await recordMessage({
    connection,
    identity,
    direction: "outbound",
    text: result.reply,
    payload: { ok: result.ok, command },
    runId: result.runId,
    projectId: result.projectId,
    projectTaskId: result.projectTaskId,
  });
  await sender({ connection, chatId, text: result.reply });
  await db
    .update(channelConnections)
    .set({ updatedAt: sql`now()` })
    .where(eq(channelConnections.id, connection.id));
  return result;
}

/** Webhook entry point: resolve the connection by its secret, then dispatch. */
export async function handleTelegramWebhookSecret(
  webhookSecret: string,
  update: TelegramUpdate,
  sender: TelegramSender = sendTelegramMessage,
): Promise<TelegramDispatchResult> {
  const [connection] = await db
    .select()
    .from(channelConnections)
    .where(
      and(
        eq(channelConnections.provider, "telegram"),
        eq(channelConnections.webhookSecret, webhookSecret),
      ),
    )
    .limit(1);
  if (!connection || connection.status === "disabled")
    return { ok: false, reply: "connection_not_found" };
  return processTelegramUpdate(connection, update, sender);
}

/* ── Long polling (default transport — no public URL required) ─────────── */

/** Active, polling-mode telegram connections that have a token. */
export function listPollableConnections() {
  return db
    .select()
    .from(channelConnections)
    .where(
      and(
        eq(channelConnections.provider, "telegram"),
        eq(channelConnections.transport, "polling"),
        eq(channelConnections.status, "active"),
      ),
    );
}

/**
 * Pull one batch of updates for a connection via getUpdates and dispatch each.
 * Advances poll_offset so updates are never reprocessed (survives restarts).
 * Returns the number of updates handled, or -1 on a transport error.
 */
export async function pollTelegramConnection(connection: ChannelConnectionRow): Promise<number> {
  const token = connectionToken(connection);
  if (!token) return -1;

  const res = await telegramCall<Array<TelegramUpdate & { update_id: number }>>(token, "getUpdates", {
    offset: connection.pollOffset,
    timeout: 0,
    allowed_updates: ["message"],
  });

  if (!res?.ok) {
    // 409 means a webhook is still set on this bot; clearing it lets getUpdates work.
    if (res?.error_code === 409) await telegramCall(token, "deleteWebhook", { drop_pending_updates: false });
    return -1;
  }

  const updates = res.result ?? [];
  if (!updates.length) return 0;

  for (const update of updates) {
    try {
      await processTelegramUpdate(connection, update);
    } catch (err) {
      console.error(`[telegram-poll] ${connection.id} update ${update.update_id} failed:`, err);
    }
  }

  const nextOffset = updates[updates.length - 1]!.update_id + 1;
  await db
    .update(channelConnections)
    .set({ pollOffset: nextOffset })
    .where(eq(channelConnections.id, connection.id));
  return updates.length;
}
