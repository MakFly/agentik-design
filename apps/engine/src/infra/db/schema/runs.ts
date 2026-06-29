import { type AnyPgColumn, integer, jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";
import type {
  ProposedMemoryChange,
  ProposedSkillChange,
  RiskLevel,
  RunReviewStatus,
  RunStatus,
  RuntimeEventV2,
  StepStatus,
  TriggerKind,
} from "@agentik/workflow-schema";
import {
  agentTaskStatusToRunStatus,
  runStatusToAgentTaskStatus,
  ts,
  type ChatMessageRole,
  type ChatSessionStatus,
  type RunExecutor,
  type RunMessageType,
  type TaskErrorReason,
} from "./_shared";
export { agentTaskStatusToRunStatus, runStatusToAgentTaskStatus };
import { workflows } from "./workflows";
import { projects, projectTasks } from "./projects";

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
  /** Orchestration run tree: null for root runs, set on child runs.
   *  Self-referencing FK so a deleted/cancelled parent orphans (SET NULL), never zombies. */
  parentRunId: text("parent_run_id").references((): AnyPgColumn => runs.id, {
    onDelete: "set null",
  }),
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
  /** Realized cost of this run in integer cents (USD). Extracted from the runtime's
   *  reported `cost_usd` at completion; null when the runtime reports no cost. */
  costCents: integer("cost_cents"),
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

/** Normalized append-only runtime/event ledger. This is the V2 source of truth;
 *  run_messages remains as a read-compat layer while older runs migrate. */
export const runEvents = pgTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    actor: jsonb("actor").notNull(),
    toolCallId: text("tool_call_id"),
    parentEventId: text("parent_event_id"),
    payload: jsonb("payload").$type<RuntimeEventV2>().notNull(),
    contractEvent: text("contract_event"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("run_events_run_seq_unique").on(t.runId, t.seq)],
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
