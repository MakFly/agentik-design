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
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
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
}) => Promise<void>;

export type TelegramActionSender = (input: {
  connection: ChannelConnectionRow;
  chatId: string;
  action: "typing";
}) => Promise<void>;
