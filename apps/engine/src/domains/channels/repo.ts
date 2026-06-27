import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { encryptJson } from "../../infra/crypto";
import { genId } from "../../infra/db/ids";
import { connectionToken, telegramCall } from "./telegram/client";
import type { ChannelConnectionRow, ChannelIdentityRow, TelegramMessage } from "./telegram/types";

const { channelConnections, channelIdentities, channelMessages } = schema;

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

  if (botToken) {
    const me = await telegramCall<{ username?: string }>(botToken, "getMe");
    if (!me?.ok) return { error: me?.description ?? "Invalid bot token (getMe failed)." };
    botUsername = me.result?.username ?? null;
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
