import { and, eq } from "drizzle-orm";
import { db, schema } from "../../../infra/db/client";
import { sendTelegramChatAction, sendTelegramMessage } from "./client";
import { formatTelegramHtmlMessages } from "./formatting";
import { webRunUrl } from "./helpers";
import { activeTelegramRecipients, recordMessage } from "../repo";
import type { TelegramActionSender, TelegramSender } from "./types";

const TELEGRAM_TYPING_TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
const telegramTypingHeartbeats = new Set<string>();

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
