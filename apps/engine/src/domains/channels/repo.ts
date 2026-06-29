import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { encryptJson } from "../../infra/crypto";
import { genId } from "../../infra/db/ids";
import { connectionToken, syncTelegramBotCommands, telegramCall } from "./telegram/client";
import type { ChannelConnectionRow, ChannelIdentityRow, TelegramMessage } from "./telegram/types";

const { agents, channelBindings, channelConnections, channelIdentities, channelMessages, channelSessions } =
  schema;

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
  const deleted = await db
    .delete(channelConnections)
    .where(and(eq(channelConnections.id, id), eq(channelConnections.teamId, teamId)))
    .returning({ id: channelConnections.id });
  return deleted.length > 0;
}

export async function registerTelegramWebhook(
  teamId: string,
  id: string,
  baseUrl: string,
): Promise<{ ok: boolean; url?: string; botUsername?: string; error?: string; commandSyncError?: string }> {
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

  const me = await telegramCall<{ username?: string }>(token, "getMe");
  if (!me?.ok) {
    await db.update(channelConnections).set({ status: "error", updatedAt: sql`now()` }).where(eq(channelConnections.id, connection.id));
    return { ok: false, error: me?.description ?? "Invalid bot token (getMe failed)." };
  }

  const set = await telegramCall(token, "setWebhook", { url, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  if (!set?.ok) {
    await db.update(channelConnections).set({ status: "error", updatedAt: sql`now()` }).where(eq(channelConnections.id, connection.id));
    return { ok: false, url, botUsername: me.result?.username, error: set?.description ?? "Telegram setWebhook failed." };
  }
  const commands = await syncTelegramBotCommands(token);

  await db
    .update(channelConnections)
    .set({
      status: "active",
      transport: "webhook",
      botUsername: me.result?.username ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(channelConnections.id, connection.id));
  return {
    ok: true,
    url,
    botUsername: me.result?.username,
    commandSyncError: commands.ok ? undefined : commands.error,
  };
}

export async function useTelegramPolling(
  teamId: string,
  id: string,
): Promise<{ ok: boolean; botUsername?: string; error?: string; commandSyncError?: string }> {
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
  const commands = await syncTelegramBotCommands(token);
  await db
    .update(channelConnections)
    .set({
      status: "active",
      transport: "polling",
      botUsername: me.result?.username ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(channelConnections.id, connection.id));
  return {
    ok: true,
    botUsername: me.result?.username,
    commandSyncError: commands.ok ? undefined : commands.error,
  };
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

  if (botToken) {
    const me = await telegramCall<{ username?: string }>(botToken, "getMe");
    if (!me?.ok) return { error: me?.description ?? "Invalid bot token (getMe failed)." };
    botUsername = me.result?.username ?? null;
    await telegramCall(botToken, "deleteWebhook", { drop_pending_updates: false });
    await syncTelegramBotCommands(botToken);
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

export async function findIdentity(
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

export async function pairIdentity(
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

export async function recordMessage(input: {
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

export async function setActiveAgent(identityId: string, agentId: string | null) {
  await db
    .update(channelIdentities)
    .set({ activeAgentId: agentId, updatedAt: sql`now()` })
    .where(eq(channelIdentities.id, identityId));
}

async function latestChannelSession(
  connection: ChannelConnectionRow,
  identity: ChannelIdentityRow,
) {
  const [session] = await db
    .select()
    .from(channelSessions)
    .where(
      and(
        eq(channelSessions.teamId, connection.teamId),
        eq(channelSessions.connectionId, connection.id),
        eq(channelSessions.identityId, identity.id),
        eq(channelSessions.externalChatId, identity.externalChatId),
        eq(channelSessions.status, "active"),
      ),
    )
    .orderBy(desc(channelSessions.updatedAt))
    .limit(1);
  return session ?? null;
}

export async function getActiveRunId(
  connection: ChannelConnectionRow,
  identity: ChannelIdentityRow,
) {
  const session = await latestChannelSession(connection, identity);
  return session?.activeRunId ?? null;
}

export async function getActiveProjectId(
  connection: ChannelConnectionRow,
  identity: ChannelIdentityRow,
) {
  const session = await latestChannelSession(connection, identity);
  return session?.activeProjectId ?? null;
}

export async function setActiveRun(
  connection: ChannelConnectionRow,
  identity: ChannelIdentityRow,
  runId: string | null,
) {
  const existing = await latestChannelSession(connection, identity);
  if (existing) {
    await db
      .update(channelSessions)
      .set({ activeRunId: runId, updatedAt: sql`now()` })
      .where(eq(channelSessions.id, existing.id));
    return;
  }
  await db.insert(channelSessions).values({
    id: genId("chsess"),
    teamId: connection.teamId,
    connectionId: connection.id,
    identityId: identity.id,
    externalChatId: identity.externalChatId,
    activeAgentId: identity.activeAgentId,
    activeRunId: runId,
  });
}

export async function setActiveProject(
  connection: ChannelConnectionRow,
  identity: ChannelIdentityRow,
  projectId: string | null,
) {
  const existing = await latestChannelSession(connection, identity);
  if (existing) {
    await db
      .update(channelSessions)
      .set({ activeProjectId: projectId, updatedAt: sql`now()` })
      .where(eq(channelSessions.id, existing.id));
    return;
  }
  await db.insert(channelSessions).values({
    id: genId("chsess"),
    teamId: connection.teamId,
    connectionId: connection.id,
    identityId: identity.id,
    externalChatId: identity.externalChatId,
    activeAgentId: identity.activeAgentId,
    activeProjectId: projectId,
  });
}

/* ── Channel bindings: per-connection agent + group-chat routing policy ──────── */

type ChannelBindingRowDb = typeof channelBindings.$inferSelect;
type ChannelGroupPolicy = ChannelBindingRowDb["groupPolicy"];

type ChannelBindingView = {
  id: string;
  connectionId: string;
  agentId: string | null;
  agentName: string | undefined;
  groupPolicy: ChannelGroupPolicy;
  requireMention: boolean;
  config: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function toBindingRow(row: ChannelBindingRowDb, agentName?: string | null): ChannelBindingView {
  return {
    id: row.id,
    connectionId: row.connectionId,
    agentId: row.agentId,
    agentName: agentName ?? undefined,
    groupPolicy: row.groupPolicy,
    requireMention: row.requireMention,
    config: row.config,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function agentNameFor(teamId: string, agentId: string | null) {
  if (!agentId) return undefined;
  const [row] = await db
    .select({ name: agents.name })
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.id, agentId)))
    .limit(1);
  return row?.name;
}

export async function listBindings(teamId: string, connectionId: string) {
  const rows = await db
    .select({ binding: channelBindings, agentName: agents.name })
    .from(channelBindings)
    .leftJoin(agents, eq(agents.id, channelBindings.agentId))
    .where(
      and(
        eq(channelBindings.teamId, teamId),
        eq(channelBindings.connectionId, connectionId),
      ),
    )
    .orderBy(desc(channelBindings.createdAt));
  return rows.map((r) => toBindingRow(r.binding, r.agentName));
}

export async function createBinding(
  teamId: string,
  connectionId: string,
  input: {
    agentId?: string | null;
    groupPolicy: ChannelGroupPolicy;
    requireMention: boolean;
    config?: Record<string, unknown>;
  },
): Promise<
  | { error: "connection_not_found" | "agent_not_found" | "binding_exists" }
  | { binding: ChannelBindingView }
> {
  const [conn] = await db
    .select({ id: channelConnections.id })
    .from(channelConnections)
    .where(and(eq(channelConnections.teamId, teamId), eq(channelConnections.id, connectionId)))
    .limit(1);
  if (!conn) return { error: "connection_not_found" as const };
  if (input.agentId) {
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.teamId, teamId), eq(agents.id, input.agentId)))
      .limit(1);
    if (!agent) return { error: "agent_not_found" as const };
    const [dupe] = await db
      .select({ id: channelBindings.id })
      .from(channelBindings)
      .where(
        and(
          eq(channelBindings.connectionId, connectionId),
          eq(channelBindings.agentId, input.agentId),
        ),
      )
      .limit(1);
    if (dupe) return { error: "binding_exists" as const };
  }
  const [row] = await db
    .insert(channelBindings)
    .values({
      id: genId("chbind"),
      teamId,
      connectionId,
      agentId: input.agentId ?? null,
      groupPolicy: input.groupPolicy,
      requireMention: input.requireMention,
      config: input.config ?? {},
    })
    .returning();
  return { binding: toBindingRow(row!, await agentNameFor(teamId, row!.agentId)) };
}

export async function updateBinding(
  teamId: string,
  bindingId: string,
  patch: {
    agentId?: string | null;
    groupPolicy?: ChannelGroupPolicy;
    requireMention?: boolean;
    config?: Record<string, unknown>;
    status?: string;
  },
): Promise<null | { error: "agent_not_found" } | { binding: ChannelBindingView }> {
  if (patch.agentId) {
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.teamId, teamId), eq(agents.id, patch.agentId)))
      .limit(1);
    if (!agent) return { error: "agent_not_found" as const };
  }
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (patch.agentId !== undefined) set.agentId = patch.agentId;
  if (patch.groupPolicy !== undefined) set.groupPolicy = patch.groupPolicy;
  if (patch.requireMention !== undefined) set.requireMention = patch.requireMention;
  if (patch.config !== undefined) set.config = patch.config;
  if (patch.status !== undefined) set.status = patch.status;
  const [row] = await db
    .update(channelBindings)
    .set(set)
    .where(and(eq(channelBindings.teamId, teamId), eq(channelBindings.id, bindingId)))
    .returning();
  if (!row) return null;
  return { binding: toBindingRow(row, await agentNameFor(teamId, row.agentId)) };
}

export async function deleteBinding(teamId: string, bindingId: string) {
  const deleted = await db
    .delete(channelBindings)
    .where(and(eq(channelBindings.teamId, teamId), eq(channelBindings.id, bindingId)))
    .returning({ id: channelBindings.id });
  return deleted.length > 0;
}

/**
 * The effective binding driving a Telegram connection's listen/act policy. A
 * connection can hold several agent bindings; the most recently updated active one
 * wins. Returns null when none exists — callers must then keep legacy behavior.
 */
export async function getConnectionBinding(connectionId: string) {
  const [row] = await db
    .select()
    .from(channelBindings)
    .where(
      and(
        eq(channelBindings.connectionId, connectionId),
        eq(channelBindings.status, "active"),
      ),
    )
    .orderBy(desc(channelBindings.updatedAt))
    .limit(1);
  return row ?? null;
}

export async function activeTelegramRecipients(teamId: string) {
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

export async function getConnectionByWebhookSecret(webhookSecret: string) {
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
  return connection ?? null;
}

export async function touchConnectionUpdatedAt(connectionId: string) {
  await db
    .update(channelConnections)
    .set({ updatedAt: sql`now()` })
    .where(eq(channelConnections.id, connectionId));
}

export async function advancePollOffset(connectionId: string, nextOffset: number) {
  await db
    .update(channelConnections)
    .set({ pollOffset: nextOffset })
    .where(eq(channelConnections.id, connectionId));
}

export {
  processTelegramUpdate,
  handleTelegramWebhookSecret,
  pollTelegramConnection,
  notifyRunTelegram,
  sendRunTelegramAction,
  startRunTelegramTypingHeartbeat,
  formatTelegramHtmlMessages,
  formatTelegramText,
  parseTelegramCommand,
} from "./service";
export type { TelegramCommand } from "./service";
