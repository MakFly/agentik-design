import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import {
  ts,
  type ProjectResourceType,
  type ProjectStatus,
  type ProjectTaskCommentAuthorKind,
  type ProjectTaskPriority,
  type ProjectTaskStatus,
  type ProjectType,
  type ProjectWorkspaceStatus,
} from "./_shared";
import { daemons } from "./agents";

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

