import { decryptJson } from "../../../infra/crypto";
import type { ChannelConnectionRow } from "./types";

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
}) {
  const token = connectionToken(input.connection);
  if (!token) return;
  const res = await telegramCall<{ message_id?: number }>(token, "sendMessage", {
    chat_id: input.chatId,
    text: input.text,
    ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
    disable_web_page_preview: true,
  });
  if (!res?.ok) {
    throw new Error(res?.description ?? "telegram_send_failed");
  }
  return { messageId: res.result?.message_id };
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
