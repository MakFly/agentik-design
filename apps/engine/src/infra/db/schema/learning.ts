import { doublePrecision, integer, jsonb, pgTable, text, unique, index } from "drizzle-orm/pg-core";
import type {
  CreatedBy,
  KnowledgeScope,
  MemoryPolicy,
  RuntimeKind,
  SkillPolicy,
} from "@agentik/workflow-schema";
import { ts, type MemoryEventAction, type ToolGrantRecord } from "./_shared";
import { agents } from "./agents";

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

