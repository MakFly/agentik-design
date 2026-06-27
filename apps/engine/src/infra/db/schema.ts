import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  CreatedBy,
  KnowledgeScope,
  MemoryPolicy,
  ProposedMemoryChange,
  ProposedSkillChange,
  RiskLevel,
  RunStatus,
  RunReviewStatus,
  RuntimeKind,
  SkillPolicy,
  StepStatus,
  TriggerKind,
  WorkflowGraph,
} from "@agentik/workflow-schema";

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });

/* ── Agent-execution harness (multica-style) ─────────────────────────── */

export type AgentHealth = "healthy" | "degraded" | "error" | "idle" | "disabled";
export type DaemonStatus = "online" | "offline" | "draining";
export type RuntimeStatus = "online" | "offline";
export type McpTransport = "streamable_http" | "sse";
export type McpServerStatus = "unknown" | "online" | "error";
export type McpToolStatus = "available" | "unavailable";
export interface ToolGrantRecord {
  toolId: string;
  scopes: string[];
  rateCapPerMin?: number;
  requireApproval?: boolean;
}
export type RunExecutor = "workflow" | "daemon";
export type RunMessageType = "text" | "thinking" | "tool_use" | "tool_result" | "error";

/** Map legacy agent_tasks / daemon wire status to unified {@link RunStatus}. */
export function agentTaskStatusToRunStatus(status: string): RunStatus {
  switch (status) {
    case "completed":
      return "succeeded";
    case "dispatched":
      return "queued";
    default:
      return status as RunStatus;
  }
}

/** Map unified {@link RunStatus} to legacy daemon task status (claim/complete wire format). */
export function runStatusToAgentTaskStatus(status: RunStatus): string {
  switch (status) {
    case "succeeded":
      return "completed";
    case "timed_out":
      return "failed";
    default:
      return status;
  }
}
export type ChatSessionStatus = "active" | "archived";
export type ChatMessageRole = "user" | "assistant";
export type ProjectType = "ops" | "code" | "hybrid";
export type ProjectStatus = "active" | "archived";
export type ProjectResourceType = "git_repo" | "local_dir" | "url" | "document" | "tool";
export type ProjectTaskStatus = "backlog" | "ready" | "running" | "blocked" | "review" | "done" | "cancelled";
export type ProjectTaskPriority = "P0" | "P1" | "P2" | "P3";
export type ProjectTaskCommentAuthorKind = "user" | "agent" | "system";
export type ProjectWorkspaceStatus = "pending" | "ready" | "syncing" | "error";
export type ChannelProvider = "telegram";
export type ChannelConnectionStatus = "setup" | "active" | "disabled" | "error";
/** How Telegram updates reach us. Polling needs no public URL (default); webhook needs one. */
export type ChannelTransport = "polling" | "webhook";
export type ChannelIdentityRole = "operator" | "viewer";
export type ChannelMessageDirection = "inbound" | "outbound";
/**
 * Why a task ended in `failed`. Drives retry policy: `timeout`/`runtime_offline`/
 * `runtime_recovery` are retryable; `agent_error` is terminal. v1 only produces
 * `timeout` (scanner) and `agent_error` (daemon-reported); the others are reserved.
 */
export type TaskErrorReason = "timeout" | "runtime_offline" | "runtime_recovery" | "agent_error";
export const RETRYABLE_TASK_ERROR_REASONS: TaskErrorReason[] = ["timeout", "runtime_offline", "runtime_recovery"];

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Org-scoped token a daemon uses to register/claim for this org (issued at org creation). */
  daemonToken: text("daemon_token").unique(),
  /** Workspace-level settings (provider routing, cost ceiling, etc.). */
  settings: jsonb("settings").notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const credentials = pgTable("credentials", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  /** AES-256-GCM blob (iv:tag:ciphertext, base64). Never returned by the API. */
  data: text("data").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    transport: text("transport").$type<McpTransport>().notNull().default("streamable_http"),
    url: text("url").notNull(),
    credentialId: text("credential_id").references(() => credentials.id, { onDelete: "set null" }),
    status: text("status").$type<McpServerStatus>().notNull().default("unknown"),
    lastSyncAt: ts("last_sync_at"),
    lastError: text("last_error"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("mcp_servers_team_name_unique").on(t.teamId, t.name)],
);

export const mcpTools = pgTable(
  "mcp_tools",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    toolId: text("tool_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    inputSchema: jsonb("input_schema").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<McpToolStatus>().notNull().default("available"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("mcp_tools_team_tool_id_unique").on(t.teamId, t.toolId),
    unique("mcp_tools_server_name_unique").on(t.serverId, t.name),
  ],
);

export const workflows = pgTable("workflows", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(false),
  currentVersionId: text("current_version_id"),
  lastRunAt: ts("last_run_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const workflowVersions = pgTable("workflow_versions", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: text("status").$type<"draft" | "published" | "archived">().notNull().default("draft"),
  graph: jsonb("graph").$type<WorkflowGraph>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/* ── Agent-execution harness ─────────────────────────────────────────── */

/** A configured agent — the subject of a daemon run. teamId is a soft ref (like runs). */
export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  goal: text("goal").notNull().default(""),
  description: text("description"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  health: text("health").$type<AgentHealth>().notNull().default("idle"),
  /** runtime kind this agent runs on (echo | claude | …). */
  runtimeKind: text("runtime_kind").notNull().default("echo"),
  /** Optional machine pin: when set, only this daemon may claim the agent's tasks. */
  preferredDaemonId: text("preferred_daemon_id").references(() => daemons.id, { onDelete: "set null" }),
  liveVersionId: text("live_version_id"),
  draftVersionId: text("draft_version_id"),
  config: jsonb("config").$type<Record<string, unknown>>(),
  maxConcurrentTasks: integer("max_concurrent_tasks").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** A registered daemon (remote worker host). */
export const daemons = pgTable(
  "daemons",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    status: text("status").$type<DaemonStatus>().notNull().default("online"),
    lastHeartbeatAt: ts("last_heartbeat_at"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    // One row per (team, machine identity): enforces the register dedup at the DB
    // level and backs the deviceId lookup. Partial — legacy rows without a
    // deviceId are exempt (they dedup by name in app code).
    uniqueIndex("daemons_team_device_unique")
      .on(t.teamId, sql`(${t.meta} ->> 'deviceId')`)
      .where(sql`${t.meta} ->> 'deviceId' is not null`),
  ],
);

/** A runtime advertised by a daemon (one per agent kind it can run). */
export const runtimes = pgTable("runtimes", {
  id: text("id").primaryKey(),
  daemonId: text("daemon_id")
    .notNull()
    .references(() => daemons.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull(),
  kind: text("kind").notNull(), // echo | claude
  status: text("status").$type<RuntimeStatus>().notNull().default("online"),
  capabilities: jsonb("capabilities").$type<{ maxConcurrent?: number; agentKinds?: string[] }>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/* ── Project/task cockpit (Multica-style product layer) ─────────────── */

/** A project is the user's operating context: TPE/PME ops, coding repo, or both. */
export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  type: text("type").$type<ProjectType>().notNull().default("hybrid"),
  status: text("status").$type<ProjectStatus>().notNull().default("active"),
  description: text("description").notNull().default(""),
  leadAgentId: text("lead_agent_id"),
  createdBy: text("created_by").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Resources attached to a project: repos/local folders for coding, URLs/docs/tools for ops. */
export const projectResources = pgTable("project_resources", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").$type<ProjectResourceType>().notNull(),
  label: text("label").notNull().default(""),
  ref: text("ref").notNull(),
  status: text("status").notNull().default("active"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Product-level work item. One task may spawn many daemon runs (`executor=daemon`). */
export const projectTasks = pgTable("project_tasks", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").$type<ProjectTaskStatus>().notNull().default("ready"),
  priority: text("priority").$type<ProjectTaskPriority>().notNull().default("P2"),
  assignedAgentId: text("assigned_agent_id"),
  lastRunId: text("last_run_id"),
  createdBy: text("created_by").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Unified execution record: workflow runs (`executor=workflow`) and daemon agent runs
 * (`executor=daemon`). Replaces the former split between `runs` and `agent_tasks`.
 */
export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  executor: text("executor").$type<RunExecutor>().notNull().default("workflow"),
  workflowId: text("workflow_id").references(() => workflows.id, { onDelete: "cascade" }),
  versionId: text("version_id"),
  status: text("status").$type<RunStatus>().notNull().default("queued"),
  trigger: text("trigger").$type<TriggerKind>().notNull().default("manual"),
  payload: jsonb("payload"),
  error: text("error"),
  /** Daemon run: agent that executes this run. Null for workflow runs. */
  agentId: text("agent_id"),
  /** Daemon run: product context when backing a project task. */
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  projectTaskId: text("project_task_id").references(() => projectTasks.id, { onDelete: "set null" }),
  runtimeId: text("runtime_id"),
  daemonId: text("daemon_id"),
  priority: integer("priority"),
  kind: text("kind"), // chat | direct (daemon runs)
  input: jsonb("input"),
  workDir: text("work_dir"),
  result: jsonb("result"),
  /** Classified failure cause; null unless status = failed. Drives retry policy. */
  errorReason: text("error_reason").$type<TaskErrorReason>(),
  /** 1-based attempt counter; bumped on auto-retry of a retryable failure. */
  attempt: integer("attempt"),
  /** Set when this run backs a chat turn; result is written back as an assistant message. */
  chatSessionId: text("chat_session_id"),
  stepCount: integer("step_count").notNull().default(0),
  completedSteps: integer("completed_steps").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  dispatchedAt: ts("dispatched_at"),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
  durationMs: integer("duration_ms"),
});

export const runSteps = pgTable("run_steps", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(),
  label: text("label").notNull(),
  status: text("status").$type<StepStatus>().notNull().default("pending"),
  input: jsonb("input"),
  output: jsonb("output"),
  error: text("error"),
  attempt: integer("attempt").notNull().default(1),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
  durationMs: integer("duration_ms"),
});

/** TUI-style task thread: human comments, agent notes, and run links. */
export const projectTaskComments = pgTable("project_task_comments", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  projectTaskId: text("project_task_id")
    .notNull()
    .references(() => projectTasks.id, { onDelete: "cascade" }),
  authorKind: text("author_kind").$type<ProjectTaskCommentAuthorKind>().notNull().default("user"),
  userId: text("user_id"),
  agentId: text("agent_id"),
  content: text("content").notNull().default(""),
  runId: text("run_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** A daemon-local workspace prepared for a project resource. */
export const projectWorkspaces = pgTable("project_workspaces", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  resourceId: text("resource_id").references(() => projectResources.id, { onDelete: "set null" }),
  daemonId: text("daemon_id").references(() => daemons.id, { onDelete: "set null" }),
  path: text("path").notNull().default(""),
  branch: text("branch").notNull().default(""),
  status: text("status").$type<ProjectWorkspaceStatus>().notNull().default("pending"),
  error: text("error"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/* ── External channels (OpenClaw-style control surfaces) ─────────────── */

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

/** Streamed output of a run — maps to a Step/timeline entry in the web UI. */
export const runMessages = pgTable(
  "run_messages",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").$type<RunMessageType>().notNull(),
    tool: text("tool"),
    content: text("content"),
    input: jsonb("input"),
    output: jsonb("output"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("run_messages_run_seq_unique").on(t.runId, t.seq)],
);

/** A chat conversation with an agent. Each user turn spawns a `kind='chat'` daemon run. */
export const chatSessions = pgTable("chat_sessions", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  agentId: text("agent_id").notNull(),
  /** User who started the session (soft ref; may be empty in dev). */
  creatorId: text("creator_id").notNull().default(""),
  title: text("title").notNull().default(""),
  status: text("status").$type<ChatSessionStatus>().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** A single turn in a chat session. The assistant turn is written on task completion. */
export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  chatSessionId: text("chat_session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role").$type<ChatMessageRole>().notNull(),
  content: text("content").notNull().default(""),
  /** The daemon run that produced this message (assistant turns); null for user turns. */
  taskId: text("task_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/* ── Learning loop (the moat) ────────────────────────────────────────── */

/** Immutable, versioned agent config. Replaces overwriting agents.config on publish. */
export const agentVersions = pgTable(
  "agent_versions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(), // monotonic per agent
    model: text("model"),
    instructions: text("instructions").notNull().default(""),
    tools: jsonb("tools").$type<string[]>().notNull().default([]),
    toolGrants: jsonb("tool_grants").$type<ToolGrantRecord[]>().notNull().default([]),
    runtimeKind: text("runtime_kind").$type<RuntimeKind>().notNull().default("echo"),
    memoryPolicy: jsonb("memory_policy").$type<MemoryPolicy>().notNull(),
    skillPolicy: jsonb("skill_policy").$type<SkillPolicy>().notNull(),
    createdBy: text("created_by").$type<CreatedBy>().notNull().default("user"),
    changelog: text("changelog"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("agent_versions_agent_version_unique").on(t.agentId, t.version)],
);

/** Declarative knowledge. teamId is a soft ref (like runs/agents). */
export const memoryEntries = pgTable("memory_entries", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  scope: text("scope").$type<KnowledgeScope>().notNull(),
  targetId: text("target_id"),
  content: text("content").notNull(),
  sourceRunId: text("source_run_id"), // = runs.id (daemon runs)
  confidence: doublePrecision("confidence").notNull().default(0.5),
  createdBy: text("created_by").$type<CreatedBy>().notNull().default("user"),
  lastEditedBy: text("last_edited_by"),
  archivedAt: ts("archived_at"),
  archivedBy: text("archived_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  index("memory_entries_team_created_idx").on(t.teamId, t.createdAt),
  index("memory_entries_team_scope_target_idx").on(t.teamId, t.scope, t.targetId),
]);

export type MemoryEventAction = "create" | "update" | "archive" | "restore";

export const memoryEvents = pgTable("memory_events", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  memoryId: text("memory_id").notNull(),
  action: text("action").$type<MemoryEventAction>().notNull(),
  actorId: text("actor_id").notNull().default("system"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("memory_events_team_memory_created_idx").on(t.teamId, t.memoryId, t.createdAt),
]);

/** Procedural knowledge (head row). Points at its current version. */
export const skills = pgTable("skills", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  scope: text("scope").$type<KnowledgeScope>().notNull(),
  targetId: text("target_id"),
  currentVersionId: text("current_version_id"),
  createdBy: text("created_by").$type<CreatedBy>().notNull().default("user"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: integer("version").notNull(), // monotonic per skill
    bodyMd: text("body_md").notNull().default(""),
    triggerConditions: jsonb("trigger_conditions").$type<string[]>().notNull().default([]),
    pitfalls: jsonb("pitfalls").$type<string[]>().notNull().default([]),
    verificationSteps: jsonb("verification_steps").$type<string[]>().notNull().default([]),
    sourceRunId: text("source_run_id"),
    createdBy: text("created_by").$type<CreatedBy>().notNull().default("user"),
    changelog: text("changelog"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("skill_versions_skill_version_unique").on(t.skillId, t.version)],
);

/* ── Identity & org tenancy (Phase 0) ────────────────────────────────── */

export type OrgRole = "owner" | "admin" | "engineer" | "operator" | "viewer";

/** A person. Named app_users to avoid the legacy Laravel `users` table in the shared dev DB. */
export const appUsers = pgTable("app_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull().default(""),
  emailVerifiedAt: ts("email_verified_at"),
  /** One-time email-verification token; cleared once verified. */
  verifyToken: text("verify_token"),
  /** 6-digit OTP for email verification; cleared once verified. */
  verifyCode: text("verify_code"),
  verifyCodeExpiresAt: ts("verify_code_expires_at"),
  /** Onboarding questionnaire answers (source, role, use_case). */
  onboardingQuestionnaire: jsonb("onboarding_questionnaire").notNull().default({}),
  /** Client UI prefs synced across devices (reduce motion, submit mode, theme). */
  uiPreferences: jsonb("ui_preferences").notNull().default({}),
  /** Email / in-app notification toggles. */
  notificationPreferences: jsonb("notification_preferences").notNull().default({}),
  /** Personal daemon token metadata. The token itself is revealed once and stored as a hash only. */
  daemonTokenHash: text("daemon_token_hash"),
  daemonTokenPrefix: text("daemon_token_prefix").unique(),
  daemonTokenIssuedAt: ts("daemon_token_issued_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** A logged-in session. `token` is the high-entropy value stored in an httpOnly cookie. */
export const userSessions = pgTable("user_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Membership of a user in an org (= team) with a role. One org = one team. */
export const orgMembers = pgTable(
  "org_members",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    role: text("role").$type<OrgRole>().notNull().default("viewer"),
    /** When the member finished the post-signup welcome onboarding for this org. */
    onboardingCompletedAt: ts("onboarding_completed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("org_members_team_user_unique").on(t.teamId, t.userId)],
);

/** Pending invitation to join an org. `token` backs the invite link. */
export const orgInvitations = pgTable("org_invitations", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<OrgRole>().notNull().default("viewer"),
  token: text("token").notNull().unique(),
  invitedBy: text("invited_by"),
  acceptedAt: ts("accepted_at"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Propose-only review of a finished run. runId = runs.id (soft ref). */
export const runReviews = pgTable("run_reviews", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  runId: text("run_id").notNull(),
  status: text("status").$type<RunReviewStatus>().notNull().default("pending"),
  summary: text("summary").notNull().default(""),
  riskLevel: text("risk_level").$type<RiskLevel>().notNull().default("low"),
  proposedMemories: jsonb("proposed_memories").$type<ProposedMemoryChange[]>().notNull().default([]),
  proposedSkillChanges: jsonb("proposed_skill_changes")
    .$type<ProposedSkillChange[]>()
    .notNull()
    .default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Org-scoped runtime provider API keys, managed from the web Settings UI and
 * injected (decrypted) into the daemon at claim time so runtimes (hermes, claude…)
 * authenticate without any out-of-band config. `secret` is an AES-256-GCM blob
 * (see crypto.ts); the plaintext key never leaves the engine except into a claim.
 */
export const providerKeys = pgTable(
  "provider_keys",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    provider: text("provider").notNull(), // openrouter | openai | anthropic | google
    secret: text("secret").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("provider_keys_team_provider_unique").on(t.teamId, t.provider)],
);

/* ── Bundle manager (install/provision agent CLIs on a daemon host) ───── */

export type BundleAction = "install" | "upgrade" | "uninstall";
export type BundleCommandStatus = "queued" | "running" | "done" | "failed";

/**
 * A request to install/upgrade/uninstall an agent CLI on a specific daemon host.
 * The engine NEVER ships a shell command — it ships a validated {kind, action}; the
 * daemon maps that to a compile-time installer arg-vector from its own allowlist.
 */
export const bundleCommands = pgTable("bundle_commands", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  daemonId: text("daemon_id")
    .notNull()
    .references(() => daemons.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // CLI/runtime kind: claude | codex | gemini | …
  action: text("action").$type<BundleAction>().notNull(),
  status: text("status").$type<BundleCommandStatus>().notNull().default("queued"),
  requestedBy: text("requested_by").notNull().default(""),
  result: text("result"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  startedAt: ts("started_at"),
  endedAt: ts("ended_at"),
});

/**
 * Generic per-org persisted settings (key → jsonb). Lets behavior flags live in the
 * DB / Settings UI instead of process env (e.g. bundle.network_install). Read-through
 * defaults are applied in code, so an absent row means "default".
 */
export const orgSettings = pgTable(
  "org_settings",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("org_settings_team_key_unique").on(t.teamId, t.key)],
);
