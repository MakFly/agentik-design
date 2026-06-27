import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { decryptJson, encryptJson } from "../../infra/crypto";
import { genId } from "../../infra/db/ids";
import {
  approveRun,
  cancelRun,
  getAgentPlacementLabel,
  getRunDetail,
  listAgentRows,
  pauseRun,
  rejectRun,
  resumeRun,
} from "../runs";
import { sendAgentChatTurn } from "../chat/repo";
import { sendOrchestratedTurn } from "../chat/orchestrator";
import {
  createProjectTask,
  getProject,
  listProjects,
  runProjectTask,
} from "../projects/repo";
import { insertConfirmedMemory } from "../learning/repo";
import { env } from "../../infra/env";

const { channelConnections, channelIdentities, channelMessages } = schema;
const TELEGRAM_TYPING_TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
const telegramTypingHeartbeats = new Set<string>();

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
  | { kind: "agentMode"; handle?: string; agentId?: string; off?: boolean }
  | { kind: "run"; projectId: string; agentId?: string; title: string }
  | { kind: "runAgent"; agentId: string; input: string }
  | { kind: "runAgentHandle"; handle: string; input: string }
  | { kind: "freeChat"; input: string }
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
  parseMode?: "HTML";
}) => Promise<void>;

export type TelegramActionSender = (input: {
  connection: ChannelConnectionRow;
  chatId: string;
  action: "typing";
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
  if (clean === "/agent") return { kind: "agentMode" };
  if (/^\/agent\s+(off|stop|none)$/i.test(clean)) return { kind: "agentMode", off: true };
  const agentModeHandle = clean.match(/^\/agent\s+@([a-zA-Z0-9_]+)$/);
  if (agentModeHandle?.[1]) {
    return { kind: "agentMode", handle: normalizeAgentHandle(agentModeHandle[1]) };
  }
  const agentModeId = clean.match(/^\/agent\s+agent:([^\s]+)$/);
  if (agentModeId?.[1]) return { kind: "agentMode", agentId: agentModeId[1] };
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
  if (!clean.startsWith("/")) {
    return { kind: "freeChat", input: clean };
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
    "/agent @agent_handle",
    "/agent off",
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
    intro ?? "I can start an existing project task, route a free-form message, or run a published agent.",
    "",
    "Fast paths:",
    '/run task:<taskId> "optional extra instruction"',
    '/run @agent_handle "what should the agent do?"',
    "/agent @agent_handle",
    "/agent off",
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

async function setActiveAgent(identityId: string, agentId: string | null) {
  await db
    .update(channelIdentities)
    .set({ activeAgentId: agentId, updatedAt: sql`now()` })
    .where(eq(channelIdentities.id, identityId));
}

async function activeAgentRow(teamId: string, identity: ChannelIdentityRow) {
  if (!identity.activeAgentId) return null;
  const agents = await listAgentRows(teamId);
  return agents.find((agent) => agent.id === identity.activeAgentId) ?? null;
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

async function sendTelegramAgentTurn(
  connection: ChannelConnectionRow,
  identity: ChannelIdentityRow,
  agent: Pick<AgentListRow, "id" | "name">,
  input: string,
) {
  return sendAgentChatTurn(connection.teamId, {
    agentId: agent.id,
    content: input,
    creatorId: `telegram:${identity.id}:agent:${agent.id}`,
    title: `Telegram · ${identity.displayName || identity.externalUserId} · ${agent.name}`,
  });
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
    case "agentMode": {
      if (command.off) {
        await setActiveAgent(identity.id, null);
        return {
          ok: true,
          reply: "Agent mode disabled. Use /agent @agent_handle to pick one again.",
        };
      }
      if (!command.handle && !command.agentId) {
        const current = await activeAgentRow(connection.teamId, identity);
        return {
          ok: true,
          reply: await runHelpText(
            connection.teamId,
            current
              ? `Current agent: @${agentHandle(current)} (${current.name}).`
              : "No active agent for this chat yet.",
          ),
        };
      }
      let resolved: { agent: AgentListRow } | { error: "ambiguous" | "not_found"; agents: AgentListRow[] };
      if (command.agentId) {
        const agents = await listAgentRows(connection.teamId);
        const agent = agents.find((item) => item.id === command.agentId);
        resolved = agent ? { agent } : { error: "not_found", agents };
      } else {
        resolved = await resolveAgentHandle(connection.teamId, command.handle!);
      }
      if ("error" in resolved) {
        return {
          ok: false,
          reply:
            resolved.error === "ambiguous"
              ? [
                  "Several agents match. Use one id explicitly:",
                  ...resolved.agents.map((agent) => `${agent.name} · ${agent.id}`),
                ].join("\n")
              : "Agent not found. Use /agents to list available handles.",
        };
      }
      if (!resolved.agent.liveVersionId) {
        return {
          ok: false,
          reply: `${resolved.agent.name} is not published yet. Publish it before using it from Telegram.`,
        };
      }
      await setActiveAgent(identity.id, resolved.agent.id);
      return {
        ok: true,
        reply: `Agent mode enabled: @${agentHandle(resolved.agent)} (${resolved.agent.name}).\nNow send messages directly, without /run.`,
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
      const agents = await listAgentRows(connection.teamId);
      const agent = agents.find((item) => item.id === command.agentId);
      if (!agent) return { ok: false, reply: "Agent not found." };
      const run = await sendTelegramAgentTurn(connection, identity, agent, command.input);
      if ("error" in run)
        return {
          ok: false,
          reply:
            run.error === "not_published"
              ? "This agent is not published yet."
              : run.error === "empty_input"
                ? 'Usage: /run agent:<agentId> "what should the agent do?"'
              : `Could not start agent: ${run.error}`,
        };
      await setActiveAgent(identity.id, command.agentId);
      const placement = await getAgentPlacementLabel(connection.teamId, command.agentId);
      return {
        ok: true,
        reply: startRunReply(agent?.name ?? command.agentId, placement, await webRunUrl(connection.teamId, run.runId)),
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
      const run = await sendTelegramAgentTurn(connection, identity, resolved.agent, command.input);
      if ("error" in run)
        return {
          ok: false,
          reply:
            run.error === "not_published"
              ? "This agent is not published yet."
              : run.error === "empty_input"
                ? 'Usage: /run @agent_handle "what should the agent do?"'
              : `Could not start agent: ${run.error}`,
        };
      await setActiveAgent(identity.id, resolved.agent.id);
      const placement = await getAgentPlacementLabel(connection.teamId, resolved.agent.id);
      return {
        ok: true,
        reply: startRunReply(resolved.agent.name, placement, await webRunUrl(connection.teamId, run.runId)),
        runId: run.runId,
      };
    }
    case "freeChat": {
      const routed = await sendOrchestratedTurn({
        teamId: connection.teamId,
        surface: "telegram",
        actorId: identity.externalUserId,
        threadKey: `${connection.id}:${identity.externalChatId}:${identity.externalUserId}`,
        text: command.input,
        agentHintId: identity.activeAgentId,
      });
      if (routed.kind === "run") {
        await setActiveAgent(identity.id, routed.agent.id);
        const placement = await getAgentPlacementLabel(connection.teamId, routed.agent.id);
        return {
          ok: true,
          reply: startRunReply(routed.agent.name, placement, await webRunUrl(connection.teamId, routed.runId)),
          runId: routed.runId,
        };
      }
      if (routed.kind === "clarify") {
        return { ok: true, reply: clarifyAgentReply(routed.question, routed.choices) };
      }
      return {
        ok: false,
        reply:
          routed.error === "no_published_agents"
            ? "No published agent is available yet."
            : "Could not start an agent for this message.",
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
      const detail = await getRunDetail(connection.teamId, command.runId);
      if (!detail)
        return { ok: false, reply: "Run not found.", runId: command.runId };
      const placement = "placement" in detail && detail.placement
        ? [
            detail.placement.runtimeKind,
            detail.placement.daemonName ?? detail.placement.daemonId ?? "any compatible computer",
            detail.placement.pinned ? "pinned" : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : null;
      return {
        ok: true,
        reply: `Run ${detail.run.id}\nStatus: ${detail.run.status}${placement ? `\nTarget: ${placement}` : ""}\nSteps: ${detail.run.completedSteps}/${detail.run.stepCount}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`,
        runId: command.runId,
      };
    }
    case "kill": {
      const ok = await cancelRun(connection.teamId, command.runId);
      return {
        ok,
        reply: ok
          ? `Run cancelled: ${command.runId}\nOpen: ${await webRunUrl(connection.teamId, command.runId)}`
          : "Run not found or not cancellable.",
        runId: command.runId,
      };
    }
    case "pause": {
      const ok = await pauseRun(
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
      const ok = await resumeRun(
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
      const ok = await approveRun(
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
      const ok = await rejectRun(
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

function startRunReply(agentName: string, placement: string | null, url: string) {
  return [
    `🧠 ${agentName} is on it.`,
    "I will send the result here.",
    placement ? `Using ${placement}` : null,
    `Track: ${url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function clarifyAgentReply(
  question: string,
  choices: Array<{ handle: string; label: string }>,
) {
  return [
    question,
    ...choices.map((choice) => `/run @${choice.handle} "your request" · ${choice.label}`),
    "",
    "Tip: send /agent @agent_handle to keep one as the default hint.",
  ].join("\n");
}

export async function sendTelegramMessage(input: {
  connection: ChannelConnectionRow;
  chatId: string;
  text: string;
  parseMode?: "HTML";
}) {
  const token = connectionToken(input.connection);
  if (!token) return;
  await telegramCall(token, "sendMessage", {
    chat_id: input.chatId,
    text: input.text,
    ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
    disable_web_page_preview: true,
  });
}

export async function sendTelegramChatAction(input: {
  connection: ChannelConnectionRow;
  chatId: string;
  action: "typing";
}) {
  const token = connectionToken(input.connection);
  if (!token) return;
  await telegramCall(token, "sendChatAction", {
    chat_id: input.chatId,
    action: input.action,
  });
}

async function activeTelegramRecipients(teamId: string) {
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
  if (!connections.length) return [];
  const identities = await db
    .select()
    .from(channelIdentities)
    .where(eq(channelIdentities.teamId, teamId));
  return connections.flatMap((connection) =>
    identities
      .filter((identity) => identity.connectionId === connection.id)
      .map((identity) => ({ connection, identity })),
  );
}

export async function sendRunTelegramAction(
  teamId: string,
  action: "typing",
  actionSender: TelegramActionSender = sendTelegramChatAction,
) {
  const recipients = await activeTelegramRecipients(teamId);
  let sent = 0;
  for (const { connection, identity } of recipients) {
    await actionSender({
      connection,
      chatId: identity.externalChatId,
      action,
    }).catch(() => undefined);
    sent += 1;
  }
  return sent;
}

export function startRunTelegramTypingHeartbeat(
  teamId: string,
  runId: string,
  options: { intervalMs?: number; maxMs?: number } = {},
) {
  const key = `${teamId}:${runId}`;
  if (telegramTypingHeartbeats.has(key)) return;
  telegramTypingHeartbeats.add(key);
  const intervalMs = options.intervalMs ?? 4_000;
  const maxMs = options.maxMs ?? 15 * 60_000;
  let interval: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (interval) clearInterval(interval);
    if (timeout) clearTimeout(timeout);
    telegramTypingHeartbeats.delete(key);
  };
  const tick = async () => {
    const [task] = await db
      .select({ status: schema.runs.status })
      .from(schema.runs)
      .where(and(eq(schema.runs.teamId, teamId), eq(schema.runs.id, runId)))
      .limit(1);
    if (!task || TELEGRAM_TYPING_TERMINAL_STATUSES.has(task.status)) {
      stop();
      return;
    }
    await sendRunTelegramAction(teamId, "typing");
  };

  void tick().catch(() => undefined);
  interval = setInterval(() => {
    void tick().catch(() => undefined);
  }, intervalMs);
  timeout = setTimeout(stop, maxMs);
  if (typeof interval === "object" && "unref" in interval) interval.unref();
  if (typeof timeout === "object" && "unref" in timeout) timeout.unref();
}

export async function notifyRunTelegram(
  teamId: string,
  runId: string,
  text: string,
  sender: TelegramSender = sendTelegramMessage,
  actionSender: TelegramActionSender = sendTelegramChatAction,
  options: { includeLink?: boolean } = {},
) {
  const recipients = await activeTelegramRecipients(teamId);
  if (!recipients.length) return 0;
  const includeLink = options.includeLink ?? true;
  const body = includeLink
    ? `${text}\n\nOpen run: ${await webRunUrl(teamId, runId)}`
    : text;
  const parts = formatTelegramHtmlMessages(body);
  let sent = 0;

  for (const { connection, identity } of recipients) {
    await recordMessage({
      connection,
      identity,
      direction: "outbound",
      text: parts.join("\n\n"),
      payload: { kind: "run.notification", parts: parts.length },
      runId,
    });
    await actionSender({
      connection,
      chatId: identity.externalChatId,
      action: "typing",
    }).catch(() => undefined);
    for (const part of parts) {
      await sender({
        connection,
        chatId: identity.externalChatId,
        text: part,
        parseMode: "HTML",
      });
    }
    sent += 1;
  }

  return sent;
}

const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_SAFE_CHUNK = 3600;

export function formatTelegramHtmlMessages(input: string) {
  const formatted = formatTelegramText(input, Number.POSITIVE_INFINITY);
  const parts: string[] = [];
  for (const chunk of splitTelegramSource(formatted, TELEGRAM_SAFE_CHUNK)) {
    const html = markdownToTelegramHtml(chunk);
    if (html.length <= TELEGRAM_MESSAGE_LIMIT) {
      parts.push(html);
      continue;
    }
    for (const smaller of splitTelegramSource(chunk, 900)) {
      parts.push(markdownToTelegramHtml(smaller));
    }
  }
  return parts.filter(Boolean);
}

export function formatTelegramText(input: string, maxChars = 1800) {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    if (isMarkdownTableRow(line) && isMarkdownTableDivider(next)) {
      const headers = splitMarkdownTableRow(line);
      i += 2;
      while (i < lines.length && isMarkdownTableRow(lines[i] ?? "")) {
        const values = splitMarkdownTableRow(lines[i] ?? "");
        const pairs = headers
          .map((header, index) => [header, values[index] ?? ""] as const)
          .filter(([, value]) => value.trim() !== "");
        out.push(
          `- ${pairs
            .map(([header, value]) => `${header}: ${value}`)
            .join(" ; ")}`,
        );
        i += 1;
      }
      i -= 1;
      continue;
    }
    out.push(line);
  }
  const compact = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

function splitTelegramSource(input: string, maxChars: number) {
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };
  for (const line of input.split("\n")) {
    if (line.length > maxChars) {
      push();
      for (let i = 0; i < line.length; i += maxChars) {
        chunks.push(line.slice(i, i + maxChars));
      }
      continue;
    }
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxChars) {
      push();
      current = line;
    } else {
      current = next;
    }
  }
  push();
  return chunks.length ? chunks : [""];
}

function markdownToTelegramHtml(input: string) {
  const lines = input.split("\n");
  const out: string[] = [];
  let inFence = false;
  let codeLines: string[] = [];

  const flushCode = () => {
    if (!codeLines.length) return;
    out.push(`<pre><code>${escapeTelegramHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      if (inFence) {
        flushCode();
        inFence = false;
      } else {
        inFence = true;
        codeLines = [];
      }
      continue;
    }
    if (inFence) {
      codeLines.push(raw);
      continue;
    }

    const heading = raw.match(/^\s{0,3}#{1,6}\s+(.+)$/);
    if (heading?.[1]) {
      out.push(`<b>${inlineTelegramHtml(heading[1])}</b>`);
      continue;
    }

    const bullet = raw.match(/^\s*[-*]\s+(.+)$/);
    if (bullet?.[1]) {
      out.push(`• ${inlineTelegramHtml(bullet[1])}`);
      continue;
    }

    out.push(inlineTelegramHtml(raw));
  }
  if (inFence) flushCode();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function inlineTelegramHtml(input: string) {
  let text = escapeTelegramHtml(input);
  text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => {
    return `<a href="${escapeTelegramAttr(url)}">${label}</a>`;
  });
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  text = text.replace(/\*([^*\n]+)\*/g, "<i>$1</i>");
  return text;
}

function escapeTelegramHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeTelegramAttr(input: string) {
  return escapeTelegramHtml(input).replace(/"/g, "&quot;");
}

function isMarkdownTableRow(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.split("|").length >= 4;
}

function isMarkdownTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
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
