import { bigint, boolean, integer, jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";
import {
  ts,
  type ChannelConnectionStatus,
  type ChannelGroupPolicy,
  type ChannelIdentityRole,
  type ChannelMessageDirection,
  type ChannelProvider,
  type ChannelTransport,
} from "./_shared";
import { agents } from "./agents";

/** Configured channel adapter. Telegram uses webhookSecret for the public webhook URL. */
export const channelConnections = pgTable("channel_connections", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  provider: text("provider").$type<ChannelProvider>().notNull(),
  label: text("label").notNull().default(""),
  status: text("status").$type<ChannelConnectionStatus>().notNull().default("setup"),
  botTokenEncrypted: text("bot_token_encrypted"),
  /** Public Telegram username from getMe. Safe to return and used for t.me pairing links. */
  botUsername: text("bot_username"),
  /** Default polling: the engine pulls updates with getUpdates — no public URL needed. */
  transport: text("transport").$type<ChannelTransport>().notNull().default("polling"),
  /** Last acknowledged Telegram update_id (next getUpdates offset). Prevents reprocessing on restart. */
  pollOffset: bigint("poll_offset", { mode: "number" }).notNull().default(0),
  webhookSecret: text("webhook_secret").notNull(),
  pairingCode: text("pairing_code").notNull(),
  createdBy: text("created_by").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Approved external identities. Commands are ignored until a user pairs with /start <code>. */
export const channelIdentities = pgTable(
  "channel_identities",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => channelConnections.id, { onDelete: "cascade" }),
    externalUserId: text("external_user_id").notNull(),
    externalChatId: text("external_chat_id").notNull(),
    displayName: text("display_name").notNull().default(""),
    role: text("role").$type<ChannelIdentityRole>().notNull().default("operator"),
    /** Optional conversational routing: free-form Telegram messages go to this agent. */
    activeAgentId: text("active_agent_id").references(() => agents.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at").notNull().defaultNow(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("channel_identity_connection_user_chat_unique").on(
      t.connectionId,
      t.externalUserId,
      t.externalChatId,
    ),
  ],
);

/**
 * Per-connection routing policy: which agent answers, whether to listen in group
 * chats (`groupPolicy`) and whether a mention is required (`requireMention`). Sits
 * above `channelIdentities.activeAgentId` — absence of a binding keeps legacy behavior.
 */
export const channelBindings = pgTable(
  "channel_bindings",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => channelConnections.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    groupPolicy: text("group_policy").$type<ChannelGroupPolicy>().notNull().default("off"),
    requireMention: boolean("require_mention").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("channel_bindings_connection_agent_unique").on(t.connectionId, t.agentId),
  ],
);

/** Audit trail for inbound commands and compact outbound Telegram summaries. */
export const channelMessages = pgTable("channel_messages", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  connectionId: text("connection_id")
    .notNull()
    .references(() => channelConnections.id, { onDelete: "cascade" }),
  identityId: text("identity_id").references(() => channelIdentities.id, { onDelete: "set null" }),
  externalMessageId: text("external_message_id"),
  direction: text("direction").$type<ChannelMessageDirection>().notNull(),
  text: text("text").notNull().default(""),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  runId: text("run_id"),
  projectId: text("project_id"),
  projectTaskId: text("project_task_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Conversation/session state for channel control surfaces. A Telegram chat can
 *  pin an active agent/project/run without turning Telegram into a second app. */
export const channelSessions = pgTable("channel_sessions", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  connectionId: text("connection_id")
    .notNull()
    .references(() => channelConnections.id, { onDelete: "cascade" }),
  identityId: text("identity_id").references(() => channelIdentities.id, { onDelete: "set null" }),
  externalChatId: text("external_chat_id").notNull(),
  activeAgentId: text("active_agent_id").references(() => agents.id, { onDelete: "set null" }),
  activeProjectId: text("active_project_id"),
  activeRunId: text("active_run_id"),
  status: text("status").notNull().default("active"),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Outbound delivery tracking for Telegram summaries, approvals, artifacts, and
 *  fallback sends. This makes channel output auditable and retryable. */
export const channelDeliveries = pgTable("channel_deliveries", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  connectionId: text("connection_id")
    .notNull()
    .references(() => channelConnections.id, { onDelete: "cascade" }),
  identityId: text("identity_id").references(() => channelIdentities.id, { onDelete: "set null" }),
  sessionId: text("session_id").references(() => channelSessions.id, { onDelete: "set null" }),
  channelMessageId: text("channel_message_id").references(() => channelMessages.id, { onDelete: "set null" }),
  provider: text("provider").$type<ChannelProvider>().notNull(),
  externalMessageId: text("external_message_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("pending"),
  parseMode: text("parse_mode"),
  attempt: integer("attempt").notNull().default(0),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
  runId: text("run_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
