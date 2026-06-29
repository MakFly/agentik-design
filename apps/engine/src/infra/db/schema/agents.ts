import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  CreatedBy,
  MemoryPolicy,
  RuntimeKind,
  SkillPolicy,
} from "@agentik/workflow-schema";
import { ts, type AgentHealth, type DaemonStatus, type RuntimeStatus, type ToolGrantRecord } from "./_shared";

/** A configured agent — the subject of a daemon run. teamId is a soft ref (like runs). */
export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  goal: text("goal").notNull().default(""),
  description: text("description"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  /** Optional display identity surfaced in the roster/graph UIs. */
  emoji: text("emoji"),
  color: text("color"),
  avatarUrl: text("avatar_url"),
  /** When true this agent fans work out to its roster of subagents (orchestration-native). */
  isOrchestrator: boolean("is_orchestrator").notNull().default(false),
  health: text("health").$type<AgentHealth>().notNull().default("idle"),
  /** runtime kind this agent runs on (echo | claude | …). */
  runtimeKind: text("runtime_kind").notNull().default("echo"),
  /** Optional machine pin: when set, only this daemon may claim the agent's tasks. */
  preferredDaemonId: text("preferred_daemon_id").references(() => daemons.id, { onDelete: "set null" }),
  liveVersionId: text("live_version_id"),
  draftVersionId: text("draft_version_id"),
  config: jsonb("config").$type<Record<string, unknown>>(),
  maxConcurrentTasks: integer("max_concurrent_tasks").notNull().default(1),
  /** User who created the agent (ownership / audit). Null for system-seeded agents. */
  creatorId: text("creator_id"),
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

/**
 * Roster edge: a subagent an orchestrator can delegate to. Both sides reference
 * `agents.id` (cascade-deleted with either parent or child). `instruction` is an
 * optional per-edge note; `position` orders the roster.
 */
export const agentSubagents = pgTable(
  "agent_subagents",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    parentAgentId: text("parent_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    subagentId: text("subagent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    instruction: text("instruction"),
    position: integer("position").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_subagents_parent_child_unique").on(t.parentAgentId, t.subagentId),
    index("agent_subagents_team_parent_idx").on(t.teamId, t.parentAgentId),
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

