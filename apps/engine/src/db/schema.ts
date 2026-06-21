import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { RunStatus, StepStatus, TriggerKind, WorkflowGraph } from "@agentik/workflow-schema";

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
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
