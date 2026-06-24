import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
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
export type AgentTaskStatus =
  | "queued"
  | "dispatched"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type TaskMessageType = "text" | "thinking" | "tool_use" | "tool_result" | "error";

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Org-scoped token a daemon uses to register/claim for this org (issued at org creation). */
  daemonToken: text("daemon_token").unique(),
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

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull(),
  status: text("status").$type<RunStatus>().notNull().default("queued"),
  trigger: text("trigger").$type<TriggerKind>().notNull().default("manual"),
  payload: jsonb("payload"),
  error: text("error"),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
  durationMs: integer("duration_ms"),
  stepCount: integer("step_count").notNull().default(0),
  completedSteps: integer("completed_steps").notNull().default(0),
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

/* ── Agent-execution harness ─────────────────────────────────────────── */

/** A configured agent — the subject of an agent task. teamId is a soft ref (like runs). */
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
  liveVersionId: text("live_version_id"),
  draftVersionId: text("draft_version_id"),
  config: jsonb("config").$type<Record<string, unknown>>(),
  maxConcurrentTasks: integer("max_concurrent_tasks").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** A registered daemon (remote worker host). */
export const daemons = pgTable("daemons", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<DaemonStatus>().notNull().default("online"),
  lastHeartbeatAt: ts("last_heartbeat_at"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

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

/** A unit of agent work — claimed by a daemon, mapped to a Run in the web UI. */
export const agentTasks = pgTable("agent_tasks", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  agentId: text("agent_id").notNull(),
  runtimeId: text("runtime_id"),
  daemonId: text("daemon_id"),
  status: text("status").$type<AgentTaskStatus>().notNull().default("queued"),
  priority: integer("priority").notNull().default(0),
  kind: text("kind").notNull().default("chat"), // chat | direct
  input: jsonb("input"),
  workDir: text("work_dir"),
  result: jsonb("result"),
  error: text("error"),
  stepCount: integer("step_count").notNull().default(0),
  completedSteps: integer("completed_steps").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  dispatchedAt: ts("dispatched_at"),
  startedAt: ts("started_at"),
  endedAt: ts("ended_at"),
  durationMs: integer("duration_ms"),
});

/** Streamed output of an agent task — maps to a Step/timeline entry in the web UI. */
export const taskMessages = pgTable(
  "task_messages",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => agentTasks.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").$type<TaskMessageType>().notNull(),
    tool: text("tool"),
    content: text("content"),
    input: jsonb("input"),
    output: jsonb("output"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("task_messages_task_seq_unique").on(t.taskId, t.seq)],
);

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
  sourceRunId: text("source_run_id"), // = agent_tasks.id
  confidence: doublePrecision("confidence").notNull().default(0.5),
  createdBy: text("created_by").$type<CreatedBy>().notNull().default("user"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

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

/** Propose-only review of a finished run. runId = agent_tasks.id (soft ref). */
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
