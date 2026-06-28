import { schema } from "../../../infra/db/client";

export type ChannelConnectionRow = typeof schema.channelConnections.$inferSelect;
export type ChannelIdentityRow = typeof schema.channelIdentities.$inferSelect;

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id?: number;
  text?: string;
  chat?: {
    id?: number | string;
    /** "private" | "group" | "supergroup" | "channel" — drives binding group policy. */
    type?: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  entities?: Array<{ type?: string; offset?: number; length?: number }>;
  from?: {
    id?: number | string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
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
