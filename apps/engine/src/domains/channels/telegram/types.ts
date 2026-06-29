import { schema } from "../../../infra/db/client";

export type ChannelConnectionRow = typeof schema.channelConnections.$inferSelect;
export type ChannelIdentityRow = typeof schema.channelIdentities.$inferSelect;

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id?: number;
  message_thread_id?: number | string;
  text?: string;
  caption?: string;
  chat?: {
    id?: number | string;
    /** "private" | "group" | "supergroup" | "channel" — drives binding group policy. */
    type?: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  reply_to_message?: TelegramMessage;
  photo?: Array<{ file_id?: string; file_unique_id?: string; width?: number; height?: number; file_size?: number }>;
  document?: {
    file_id?: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  voice?: {
    file_id?: string;
    file_unique_id?: string;
    duration?: number;
    mime_type?: string;
    file_size?: number;
  };
  audio?: {
    file_id?: string;
    file_unique_id?: string;
    duration?: number;
    performer?: string;
    title?: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  video?: {
    file_id?: string;
    file_unique_id?: string;
    width?: number;
    height?: number;
    duration?: number;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  from?: {
    id?: number | string;
    is_bot?: boolean;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
}

export interface TelegramMessageEntity {
  type?: string;
  offset?: number;
  length?: number;
  user?: TelegramMessage["from"];
}

export interface TelegramCallbackQuery {
  id?: string;
  data?: string;
  message?: TelegramMessage;
  from?: TelegramMessage["from"];
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

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
  replyMarkup?: TelegramInlineKeyboardMarkup;
}) => Promise<void | { messageId?: number | string }>;

export type TelegramEditSender = (input: {
  connection: ChannelConnectionRow;
  chatId: string;
  messageId: number | string;
  text: string;
  parseMode?: "HTML";
}) => Promise<void>;

export type TelegramActionSender = (input: {
  connection: ChannelConnectionRow;
  chatId: string;
  action: "typing";
}) => Promise<void>;
