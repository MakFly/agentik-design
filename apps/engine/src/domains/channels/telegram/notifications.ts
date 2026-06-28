import { and, eq } from "drizzle-orm";
import { db, schema } from "../../../infra/db/client";
import { editTelegramMessage, sendTelegramChatAction, sendTelegramMessage } from "./client";
import { formatTelegramHtmlMessages, formatTelegramText } from "./formatting";
import { webRunUrl } from "./helpers";
import { activeTelegramRecipients, recordMessage } from "../repo";
import type { TelegramActionSender, TelegramEditSender, TelegramSender } from "./types";

const TELEGRAM_TYPING_TERMINAL_STATUSES = new Set([
  "completed",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);
const telegramTypingHeartbeats = new Set<string>();
const telegramProgressNotifications = new Map<
  string,
  { sentAt: number; completedSteps: number; text: string }
>();
const telegramProgressPreviews = new Map<string, number | string>();
const TELEGRAM_PROGRESS_MIN_INTERVAL_MS = 30_000;
const TELEGRAM_PROGRESS_MIN_STEP_DELTA = 3;

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
      try {
        await sender({
          connection,
          chatId: identity.externalChatId,
          text: part,
          parseMode: "HTML",
        });
      } catch {
        await sender({
          connection,
          chatId: identity.externalChatId,
          text: formatTelegramText(htmlToPlainText(part), 3900),
        });
      }
    }
    sent += 1;
  }

  return sent;
}

export async function notifyRunProgressTelegram(
  teamId: string,
  runId: string,
  progress: { completedSteps: number; stepCount: number; latest?: string | null },
  sender: TelegramSender = sendTelegramMessage,
  actionSender: TelegramActionSender = sendTelegramChatAction,
  editSender: TelegramEditSender = editTelegramMessage,
) {
  if (progress.completedSteps <= 0 || progress.stepCount <= 0) return 0;
  if (progress.completedSteps >= progress.stepCount) return 0;

  const key = `${teamId}:${runId}`;
  const now = Date.now();
  const latest = progress.latest?.trim();
  if (!latest) return 0;
  const text = [
    "⏳ Run progress",
    `${progress.completedSteps}/${progress.stepCount} steps completed`,
    latest,
  ]
    .filter(Boolean)
    .join("\n");
  const prev = telegramProgressNotifications.get(key);
  if (prev) {
    const stepDelta = progress.completedSteps - prev.completedSteps;
    const tooSoon = now - prev.sentAt < TELEGRAM_PROGRESS_MIN_INTERVAL_MS;
    const tooSmall = stepDelta < TELEGRAM_PROGRESS_MIN_STEP_DELTA;
    if (prev.text === text || (tooSoon && tooSmall)) return 0;
  }

  const recipients = await activeTelegramRecipients(teamId);
  if (!recipients.length) return 0;
  let sent = 0;
  for (const { connection, identity } of recipients) {
    const previewKey = `${key}:${connection.id}:${identity.id}`;
    const previousMessageId = telegramProgressPreviews.get(previewKey);
    await recordMessage({
      connection,
      identity,
      direction: "outbound",
      text,
      payload: {
        kind: previousMessageId ? "run.progress.edit" : "run.progress",
        completedSteps: progress.completedSteps,
        stepCount: progress.stepCount,
      },
      runId,
    });
    await actionSender({
      connection,
      chatId: identity.externalChatId,
      action: "typing",
    }).catch(() => undefined);
    if (previousMessageId) {
      await editSender({
        connection,
        chatId: identity.externalChatId,
        messageId: previousMessageId,
        text,
      }).catch(async () => {
        const result = await sender({
          connection,
          chatId: identity.externalChatId,
          text,
        });
        const messageId = result && "messageId" in result ? result.messageId : undefined;
        if (messageId != null) telegramProgressPreviews.set(previewKey, messageId);
      });
    } else {
      const result = await sender({
        connection,
        chatId: identity.externalChatId,
        text,
      });
      const messageId = result && "messageId" in result ? result.messageId : undefined;
      if (messageId != null) telegramProgressPreviews.set(previewKey, messageId);
    }
    sent += 1;
  }
  telegramProgressNotifications.set(key, {
    sentAt: now,
    completedSteps: progress.completedSteps,
    text,
  });
  return sent;
}

function htmlToPlainText(input: string) {
  return input
    .replace(/<\/(?:p|div|pre|blockquote|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}
