import { decryptJson } from "../../../infra/crypto";
import { db, schema } from "../../../infra/db/client";
import { genId } from "../../../infra/db/ids";
import { env } from "../../../infra/env";
import type { ChannelConnectionRow, TelegramInlineKeyboardMarkup } from "./types";

/**
 * Dev/sim capture: with no real bot token we can't reach Telegram, so record the
 * would-be outbound to channel_deliveries (status "simulated"). The Telegram
 * simulation script reads these back, making the bot's replies observable without
 * a live bot. No-op in production (gated on AUTH_DEV_HEADERS).
 */
async function captureSimulatedSend(
  connection: Pick<ChannelConnectionRow, "id" | "teamId">,
  chatId: string,
  text: string,
  parseMode?: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<void> {
  await db.insert(schema.channelDeliveries).values({
    id: genId("chdel"),
    teamId: connection.teamId,
    connectionId: connection.id,
    provider: "telegram",
    kind: "reply",
    status: "simulated",
    parseMode: parseMode ?? null,
    payload: { chatId, text, replyMarkup },
  });
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export type TelegramCaller = <T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
) => Promise<TelegramApiResponse<T> | null>;

export interface TelegramFileInfo {
  file_id?: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
}

export type TelegramBotCommand = {
  command: string;
  description: string;
};

const TELEGRAM_BOT_COMMANDS: TelegramBotCommand[] = [
  { command: "start", description: "Connecter ce chat a Agentik" },
  { command: "help", description: "Afficher les commandes disponibles" },
  { command: "projects", description: "Lister les projets actifs" },
  { command: "project", description: "Choisir le projet actif du chat" },
  { command: "context", description: "Voir le contexte projet utilise" },
  { command: "tasks", description: "Lister les taches ouvertes" },
  { command: "agents", description: "Lister les agents publies" },
  { command: "skills", description: "Voir les capacites d'un agent" },
  { command: "agent", description: "Choisir l'agent actif du chat" },
  { command: "run", description: "Creer ou lancer un travail" },
  { command: "orchestrate", description: "Lancer plusieurs agents" },
  { command: "next", description: "Avancer les runs en queue" },
  { command: "status", description: "Suivre le run actif" },
  { command: "pause", description: "Mettre le run actif en pause" },
  { command: "resume", description: "Reprendre le run actif" },
  { command: "approve", description: "Approuver une action bloquee" },
  { command: "reject", description: "Refuser une action bloquee" },
  { command: "kill", description: "Arreter le run actif" },
  { command: "learn", description: "Enregistrer une memoire projet" },
];

export function telegramBotCommands(): TelegramBotCommand[] {
  return TELEGRAM_BOT_COMMANDS.slice(0, 100);
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

export async function syncTelegramBotCommands(
  token: string,
  call: TelegramCaller = telegramCall,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await call(token, "setMyCommands", {
    commands: telegramBotCommands(),
  });
  if (res?.ok) return { ok: true };
  return { ok: false, error: res?.description ?? "Telegram setMyCommands failed." };
}

export async function getTelegramFile(
  token: string,
  fileId: string,
): Promise<TelegramFileInfo | null> {
  const res = await telegramCall<TelegramFileInfo>(token, "getFile", {
    file_id: fileId,
  });
  return res?.ok ? (res.result ?? null) : null;
}

export async function downloadTelegramFileText(
  token: string,
  filePath: string,
  maxBytes = 128 * 1024,
): Promise<string | null> {
  const safePath = filePath.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${safePath}`)
    .catch(() => null);
  if (!res?.ok) return null;
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > maxBytes) return null;
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > maxBytes) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer).trim() || null;
}

export function connectionToken(
  connection: Pick<ChannelConnectionRow, "botTokenEncrypted">,
): string | null {
  if (!connection.botTokenEncrypted) return null;
  return decryptJson<{ token: string }>(connection.botTokenEncrypted).token;
}

export async function sendTelegramMessage(input: {
  connection: ChannelConnectionRow;
  chatId: string;
  text: string;
  parseMode?: "HTML";
  replyMarkup?: TelegramInlineKeyboardMarkup;
}) {
  const token = connectionToken(input.connection);
  if (!token) {
    if (env.AUTH_DEV_HEADERS) {
      await captureSimulatedSend(
        input.connection,
        input.chatId,
        input.text,
        input.parseMode,
        input.replyMarkup,
      );
      return { messageId: undefined };
    }
    return;
  }
  const res = await telegramCall<{ message_id?: number }>(token, "sendMessage", {
    chat_id: input.chatId,
    text: input.text,
    ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
    ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
    disable_web_page_preview: true,
  });
  if (!res?.ok) {
    throw new Error(res?.description ?? "telegram_send_failed");
  }
  return { messageId: res.result?.message_id };
}

export async function answerTelegramCallbackQuery(
  connection: Pick<ChannelConnectionRow, "botTokenEncrypted">,
  callbackQueryId: string,
  text?: string,
) {
  const token = connectionToken(connection);
  if (!token) return;
  await telegramCall(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

export async function editTelegramMessage(input: {
  connection: ChannelConnectionRow;
  chatId: string;
  messageId: number | string;
  text: string;
  parseMode?: "HTML";
}) {
  const token = connectionToken(input.connection);
  if (!token) return;
  const res = await telegramCall(token, "editMessageText", {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text,
    ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
    disable_web_page_preview: true,
  });
  if (!res?.ok) {
    throw new Error(res?.description ?? "telegram_edit_failed");
  }
}

export async function sendTelegramChatAction(input: {
  connection: ChannelConnectionRow;
  chatId: string;
  action: "typing";
}) {
  const token = connectionToken(input.connection);
  if (!token) return;
  const res = await telegramCall(token, "sendChatAction", {
    chat_id: input.chatId,
    action: input.action,
  });
  if (!res?.ok) {
    throw new Error(res?.description ?? "telegram_action_failed");
  }
}
