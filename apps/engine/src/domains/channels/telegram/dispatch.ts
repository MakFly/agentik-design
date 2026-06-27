import { parseTelegramCommand } from "./commands";
import { connectionToken, sendTelegramMessage, telegramCall } from "./client";
import { executeCommand } from "./execute-command";
import {
  advancePollOffset,
  findIdentity,
  getConnectionByWebhookSecret,
  pairIdentity,
  recordMessage,
  touchConnectionUpdatedAt,
} from "../repo";
import type {
  ChannelConnectionRow,
  TelegramDispatchResult,
  TelegramSender,
  TelegramUpdate,
} from "./types";

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
  await touchConnectionUpdatedAt(connection.id);
  return result;
}

export async function handleTelegramWebhookSecret(
  webhookSecret: string,
  update: TelegramUpdate,
  sender: TelegramSender = sendTelegramMessage,
): Promise<TelegramDispatchResult> {
  const connection = await getConnectionByWebhookSecret(webhookSecret);
  if (!connection || connection.status === "disabled")
    return { ok: false, reply: "connection_not_found" };
  return processTelegramUpdate(connection, update, sender);
}

export async function pollTelegramConnection(connection: ChannelConnectionRow): Promise<number> {
  const token = connectionToken(connection);
  if (!token) return -1;

  const res = await telegramCall<Array<TelegramUpdate & { update_id: number }>>(token, "getUpdates", {
    offset: connection.pollOffset,
    timeout: 0,
    allowed_updates: ["message"],
  });

  if (!res?.ok) {
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
  await advancePollOffset(connection.id, nextOffset);
  return updates.length;
}
