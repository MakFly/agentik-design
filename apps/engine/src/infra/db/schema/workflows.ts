import { boolean, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import type { WorkflowGraph } from "@agentik/workflow-schema";
import { ts } from "./_shared";
import { teams } from "./settings";

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

