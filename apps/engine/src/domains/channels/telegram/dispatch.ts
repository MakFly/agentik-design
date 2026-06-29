import { parseTelegramCommand } from "./commands";
import {
  answerTelegramCallbackQuery,
  connectionToken,
  downloadTelegramFileText,
  getTelegramFile,
  sendTelegramMessage,
  telegramCall,
} from "./client";
import { executeCommand } from "./execute-command";
import { formatPairingReply, formatUnpairedReply } from "./presenter";
import {
  advancePollOffset,
  findIdentity,
  getActiveRunId,
  getConnectionBinding,
  getConnectionByWebhookSecret,
  pairIdentity,
  recordMessage,
  setActiveRun,
  touchConnectionUpdatedAt,
} from "../repo";
import type {
  ChannelConnectionRow,
  TelegramDispatchResult,
  TelegramMessage,
  TelegramUpdate,
  TelegramSender,
} from "./types";
import type { TelegramCommand } from "./commands";

type ChannelBinding = NonNullable<Awaited<ReturnType<typeof getConnectionBinding>>>;

type TelegramAttachment = {
  kind: "photo" | "document" | "voice" | "audio" | "video";
  label: string;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
};

export type TelegramAttachmentContextLoader = (input: {
  connection: ChannelConnectionRow;
  message: TelegramMessage;
  attachments: TelegramAttachment[];
}) => Promise<string[]>;

function telegramBaseText(message: TelegramMessage): string {
  return message.text?.trim() || message.caption?.trim() || "";
}

function telegramConversationId(message: TelegramMessage): string {
  const chatId = String(message.chat?.id ?? "");
  const threadId = message.message_thread_id;
  return threadId != null && threadId !== "" ? `${chatId}:thread:${threadId}` : chatId;
}

function telegramBaseEntities(message: TelegramMessage) {
  return message.text != null ? (message.entities ?? []) : (message.caption_entities ?? []);
}

function sameTelegramUsername(value: string | undefined | null, botUsername: string | null) {
  if (!value || !botUsername) return false;
  return value.replace(/^@/, "").toLowerCase() === botUsername.replace(/^@/, "").toLowerCase();
}

function bareBotUsername(botUsername: string | null) {
  return botUsername?.replace(/^@/, "") ?? null;
}

function entityText(text: string, entity: NonNullable<TelegramMessage["entities"]>[number]) {
  if (entity.offset == null || entity.length == null) return "";
  return text.slice(entity.offset, entity.offset + entity.length);
}

function messageRepliesToBot(message: TelegramMessage, botUsername: string | null) {
  const from = message.reply_to_message?.from;
  return Boolean(from?.is_bot && sameTelegramUsername(from.username, botUsername));
}

function commandTargetsBot(message: TelegramMessage, botUsername: string | null) {
  if (!botUsername) return false;
  const match = telegramBaseText(message).match(/^\/[a-zA-Z0-9_]+@([a-zA-Z0-9_]+)(?=\s|$)/);
  return Boolean(match && sameTelegramUsername(match[1], botUsername));
}

function mentionsBot(message: TelegramMessage, botUsername: string | null): boolean {
  if (!botUsername) return false;
  if (commandTargetsBot(message, botUsername)) return true;
  const text = telegramBaseText(message);
  const entities = telegramBaseEntities(message);
  for (const entity of entities) {
    if (entity.type === "mention" && sameTelegramUsername(entityText(text, entity), botUsername)) {
      return true;
    }
    if (entity.type === "text_mention" && sameTelegramUsername(entity.user?.username, botUsername)) {
      return true;
    }
  }
  if (entities.length === 0) {
    const escaped = bareBotUsername(botUsername)!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[,.!?;:])`, "i").test(text)) return true;
  }
  return messageRepliesToBot(message, botUsername);
}

function commandTargetedToAnotherBot(message: TelegramMessage, botUsername: string | null) {
  if (!botUsername) return false;
  const text = telegramBaseText(message);
  const match = text.match(/^\/[a-zA-Z0-9_]+@([a-zA-Z0-9_]+)(?=\s|$)/);
  return Boolean(match && !sameTelegramUsername(match[1], botUsername));
}

function normalizeTelegramCommandText(text: string, botUsername: string | null) {
  if (!botUsername) return text;
  const escaped = bareBotUsername(botUsername)!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`^(/\\w+)@${escaped}(?=\\s|$)`, "i"), "$1");
}

function telegramSenderName(message: TelegramMessage) {
  const from = message.from;
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  return name || from?.username || (from?.is_bot ? "bot Telegram" : "utilisateur Telegram");
}

function telegramReplyContext(message: TelegramMessage): string | null {
  const reply = message.reply_to_message;
  if (!reply) return null;
  const text = telegramBaseText(reply).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return `Message Telegram auquel l'opérateur répond (${telegramSenderName(reply)}) : ${clipText(text, 700)}`;
}

function telegramMessageText(
  message: TelegramMessage,
  botUsername: string | null,
  attachmentContext: string[] = [],
): string {
  const text = normalizeTelegramCommandText(telegramBaseText(message), botUsername);
  if (text.startsWith("/")) return text;
  const replyContext = telegramReplyContext(message);
  const attachments = telegramAttachments(message).map((attachment) => attachment.label);
  if (!attachments.length && !replyContext) return text;
  return [
    text,
    replyContext,
    attachments.length ? `Pièces jointes Telegram : ${attachments.join(", ")}.` : null,
    ...attachmentContext,
    attachments.length && attachmentContext.length
      ? "Utilise le contenu extrait ci-dessus quand il est pertinent."
      : null,
    attachments.length && !attachmentContext.length
      ? "Le fichier brut n'est pas encore lisible par ce runtime ; réponds avec ce contexte ou demande-moi une action précise."
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function telegramAttachments(message: TelegramMessage): TelegramAttachment[] {
  const attachments: TelegramAttachment[] = [];
  const photo = message.photo?.at(-1);
  if (photo) {
    attachments.push(
      {
        kind: "photo",
        label: ["photo", dimensions(photo.width, photo.height), fileSize(photo.file_size)]
          .filter(Boolean)
          .join(" "),
        fileId: photo.file_id,
        size: photo.file_size,
      },
    );
  }
  if (message.document) {
    attachments.push(
      {
        kind: "document",
        label: [
          "document",
          message.document.file_name ? `"${message.document.file_name}"` : null,
          message.document.mime_type,
          fileSize(message.document.file_size),
        ]
          .filter(Boolean)
          .join(" "),
        fileId: message.document.file_id,
        fileName: message.document.file_name,
        mimeType: message.document.mime_type,
        size: message.document.file_size,
      },
    );
  }
  if (message.voice) {
    attachments.push(
      {
        kind: "voice",
        label: ["message vocal", duration(message.voice.duration), message.voice.mime_type, fileSize(message.voice.file_size)]
          .filter(Boolean)
          .join(" "),
        fileId: message.voice.file_id,
        mimeType: message.voice.mime_type,
        size: message.voice.file_size,
      },
    );
  }
  if (message.audio) {
    attachments.push(
      {
        kind: "audio",
        label: [
          "audio",
          message.audio.title ? `"${message.audio.title}"` : message.audio.file_name ? `"${message.audio.file_name}"` : null,
          message.audio.performer,
          duration(message.audio.duration),
          message.audio.mime_type,
          fileSize(message.audio.file_size),
        ]
          .filter(Boolean)
          .join(" "),
        fileId: message.audio.file_id,
        fileName: message.audio.file_name,
        mimeType: message.audio.mime_type,
        size: message.audio.file_size,
      },
    );
  }
  if (message.video) {
    attachments.push(
      {
        kind: "video",
        label: [
          "vidéo",
          message.video.file_name ? `"${message.video.file_name}"` : null,
          dimensions(message.video.width, message.video.height),
          duration(message.video.duration),
          message.video.mime_type,
          fileSize(message.video.file_size),
        ]
          .filter(Boolean)
          .join(" "),
        fileId: message.video.file_id,
        fileName: message.video.file_name,
        mimeType: message.video.mime_type,
        size: message.video.file_size,
      },
    );
  }
  return attachments;
}

async function defaultAttachmentContextLoader({
  connection,
  attachments,
}: Parameters<TelegramAttachmentContextLoader>[0]): Promise<string[]> {
  const token = connectionToken(connection);
  if (!token) return [];
  const lines: string[] = [];
  for (const attachment of attachments) {
    if (!attachment.fileId) continue;
    const file = await getTelegramFile(token, attachment.fileId);
    if (!file?.file_path) continue;
    const size = file.file_size ?? attachment.size;
    lines.push(
      `Fichier Telegram disponible : ${attachment.kind}${attachment.fileName ? ` "${attachment.fileName}"` : ""}${size ? ` (${fileSize(size)})` : ""}.`,
    );
    if (!isTextAttachment(attachment, file.file_path, size)) continue;
    const content = await downloadTelegramFileText(token, file.file_path);
    if (!content) continue;
    lines.push(`Aperçu du fichier "${attachment.fileName ?? file.file_path}" :\n${clipText(content, 4000)}`);
  }
  return lines;
}

function isTextAttachment(
  attachment: TelegramAttachment,
  filePath: string,
  size?: number,
) {
  if (size != null && size > 128 * 1024) return false;
  const name = `${attachment.fileName ?? ""} ${filePath}`.toLowerCase();
  const mime = attachment.mimeType?.toLowerCase() ?? "";
  return (
    mime.startsWith("text/") ||
    /\b(application\/(json|xml|csv|yaml|x-yaml|toml|javascript|typescript))\b/.test(mime) ||
    /\.(txt|md|markdown|json|csv|tsv|log|xml|yaml|yml|toml|js|ts|tsx|jsx|html|css)$/i.test(name)
  );
}

function clipText(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n…`;
}

function dimensions(width?: number, height?: number) {
  return width && height ? `${width}x${height}` : null;
}

function duration(seconds?: number) {
  return seconds != null ? `${seconds}s` : null;
}

function fileSize(bytes?: number) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes}o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}Mo`;
}

function commandFromCallbackData(data: string): TelegramCommand | null {
  const match = data.match(/^run:(approve|reject):([A-Za-z0-9_.:-]+)$/);
  if (!match) return null;
  return {
    kind: match[1] === "approve" ? "approve" : "reject",
    runId: match[2]!,
    reason: "telegram_button",
  };
}

function commandNeedsRunId(command: TelegramCommand): command is Extract<
  TelegramCommand,
  { kind: "status" | "kill" | "pause" | "resume" | "approve" | "reject" }
> {
  return ["status", "kill", "pause", "resume", "approve", "reject"].includes(command.kind);
}

async function withActiveRunId(
  connection: ChannelConnectionRow,
  identity: NonNullable<Awaited<ReturnType<typeof findIdentity>>>,
  command: TelegramCommand,
): Promise<TelegramCommand | { error: "active_run_missing"; command: TelegramCommand }> {
  if (!commandNeedsRunId(command) || command.runId) return command;
  const activeRunId = await getActiveRunId(connection, identity);
  if (!activeRunId) return { error: "active_run_missing", command };
  return { ...command, runId: activeRunId };
}

async function rememberActiveRun(
  connection: ChannelConnectionRow,
  identity: NonNullable<Awaited<ReturnType<typeof findIdentity>>> | null,
  runId?: string,
) {
  if (!identity || !runId) return;
  await setActiveRun(connection, identity, runId).catch(() => undefined);
}

async function processTelegramCallback(
  connection: ChannelConnectionRow,
  update: TelegramUpdate,
  sender: TelegramSender,
): Promise<TelegramDispatchResult | null> {
  const callback = update.callback_query;
  if (!callback?.data || !callback.message?.chat?.id) return null;
  const command = commandFromCallbackData(callback.data);
  if (!command) return { ok: true, reply: "ignored" };

  const message: TelegramMessage = {
    ...callback.message,
    from: callback.from,
    text: callback.data,
  };
  const chatId = String(callback.message.chat.id);
  let identity = await findIdentity(connection, message);
  const sessionIdentity = identity
    ? { ...identity, externalChatId: telegramConversationId(message) }
    : null;
  await recordMessage({
    connection,
    identity,
    direction: "inbound",
    text: callback.data,
    message,
    payload: update as Record<string, unknown>,
  });

  const hydrated = sessionIdentity
    ? await withActiveRunId(connection, sessionIdentity, command)
    : command;
  const result = !sessionIdentity
    ? { ok: false, reply: formatUnpairedReply(connection.pairingCode) }
    : "error" in hydrated
      ? {
          ok: false,
          reply: "Je n'ai pas de run actif pour ce chat. Relance avec un run explicite.",
        }
      : await executeCommand(connection, sessionIdentity, hydrated);

  if (callback.id) {
    await answerTelegramCallbackQuery(
      connection,
      callback.id,
      result.ok ? "Action enregistrée." : "Action impossible.",
    ).catch(() => undefined);
  }

  if (result.reply) {
    await recordMessage({
      connection,
      identity,
      direction: "outbound",
      text: result.reply,
      payload: { ok: result.ok, command, callback: callback.data },
      runId: result.runId,
      projectId: result.projectId,
      projectTaskId: result.projectTaskId,
    });
    await sender({ connection, chatId, text: result.reply });
  }
  await rememberActiveRun(connection, sessionIdentity, result.runId);
  await touchConnectionUpdatedAt(connection.id);
  return result;
}

/**
 * Decide whether to act on an inbound message and which agent should act, based on the
 * connection's binding. Private chats and connections without a binding keep legacy
 * behavior (always listen, no agent override). In group chats the binding gates listening
 * (`groupPolicy` / `requireMention`); the binding agent is only a fallback default.
 */
function decideBinding(
  binding: ChannelBinding | null,
  message: TelegramMessage,
  connection: ChannelConnectionRow,
): { listen: boolean; agentId: string | null } {
  const agentId = binding?.agentId ?? null;
  const chatType = message.chat?.type;
  const isGroup = chatType === "group" || chatType === "supergroup";
  if (!isGroup || !binding) return { listen: true, agentId };
  if (commandTargetedToAnotherBot(message, connection.botUsername)) return { listen: false, agentId };
  if (binding.groupPolicy === "off") return { listen: false, agentId };
  if (binding.requireMention && !mentionsBot(message, connection.botUsername)) {
    return { listen: false, agentId };
  }
  return { listen: true, agentId };
}

export async function processTelegramUpdate(
  connection: ChannelConnectionRow,
  update: TelegramUpdate,
  sender: TelegramSender = sendTelegramMessage,
  attachmentContextLoader: TelegramAttachmentContextLoader = defaultAttachmentContextLoader,
): Promise<TelegramDispatchResult> {
  const callbackResult = await processTelegramCallback(connection, update, sender);
  if (callbackResult) return callbackResult;

  const message = update.message;
  const baseText = message ? telegramBaseText(message) : "";
  const isCommand = baseText.startsWith("/");
  const attachments = message ? telegramAttachments(message) : [];
  const attachmentContext =
    message && attachments.length && !isCommand
      ? await attachmentContextLoader({ connection, message, attachments })
      : [];
  const text = message ? telegramMessageText(message, connection.botUsername, attachmentContext) : "";
  const chatId = message?.chat?.id != null ? String(message.chat.id) : "";
  if (!message || !text || !chatId) return { ok: true, reply: "ignored" };

  const command = parseTelegramCommand(text);
  let identity = await findIdentity(connection, message);
  const sessionIdentity = identity
    ? { ...identity, externalChatId: telegramConversationId(message) }
    : null;
  await recordMessage({
    connection,
    identity,
    direction: "inbound",
    text,
    message,
    payload: update as Record<string, unknown>,
  });

  // Binding-driven gate (no binding / private chat → unchanged legacy behavior).
  const binding = await getConnectionBinding(connection.id);
  const decision = decideBinding(binding, message, connection);
  if (!decision.listen) {
    await touchConnectionUpdatedAt(connection.id);
    return { ok: true, reply: "ignored" };
  }

  let result: TelegramDispatchResult;
  if (command.kind === "pair") {
    identity = await pairIdentity(connection, message, command.code);
    const pairedSessionIdentity = identity
      ? { ...identity, externalChatId: telegramConversationId(message) }
      : null;
    result = identity
      ? {
          ok: true,
          reply: formatPairingReply("paired"),
        }
      : {
          ok: false,
          reply: formatPairingReply("invalid", connection.pairingCode),
        };
    await rememberActiveRun(connection, pairedSessionIdentity, result.runId);
  } else if (!identity) {
    result = {
      ok: false,
      reply: formatUnpairedReply(connection.pairingCode),
    };
  } else {
    // The binding agent is only a default — an explicit /agent selection still wins.
    const actingIdentity =
      sessionIdentity!.activeAgentId == null && decision.agentId
        ? { ...sessionIdentity!, activeAgentId: decision.agentId }
        : sessionIdentity!;
    const hydrated = await withActiveRunId(connection, actingIdentity, command);
    result = "error" in hydrated
      ? {
          ok: false,
          reply: "Je n'ai pas de run actif pour ce chat. Relance avec un run explicite.",
        }
      : await executeCommand(connection, actingIdentity, hydrated);
  }

  // An empty reply means the result was already delivered out-of-band (e.g. a
  // built-in skill completed the run and notified via onRunCompleted) — send nothing.
  if (result.reply) {
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
  }
  if (command.kind !== "pair") {
    await rememberActiveRun(connection, sessionIdentity, result.runId);
  }
  await touchConnectionUpdatedAt(connection.id);
  return result;
}

export async function handleTelegramWebhookSecret(
  webhookSecret: string,
  update: TelegramUpdate,
  sender: TelegramSender = sendTelegramMessage,
  attachmentContextLoader?: TelegramAttachmentContextLoader,
): Promise<TelegramDispatchResult> {
  const connection = await getConnectionByWebhookSecret(webhookSecret);
  if (!connection || connection.status === "disabled")
    return { ok: false, reply: "connection_not_found" };
  return processTelegramUpdate(connection, update, sender, attachmentContextLoader);
}

export async function pollTelegramConnection(connection: ChannelConnectionRow): Promise<number> {
  const token = connectionToken(connection);
  if (!token) return -1;

  const res = await telegramCall<Array<TelegramUpdate & { update_id: number }>>(token, "getUpdates", {
    offset: connection.pollOffset,
    timeout: 0,
    allowed_updates: ["message", "callback_query"],
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
