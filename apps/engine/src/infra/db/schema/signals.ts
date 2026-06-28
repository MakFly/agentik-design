import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { ts } from "./_shared";
import { agents } from "./agents";

export type SignalStatus = "active" | "disabled";
export type AssistantRuleStatus = "active" | "disabled";
export type SignalDeliveryStatus = "received" | "matched" | "started" | "ignored" | "failed";

export const signals = pgTable("signals", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  source: text("source").notNull().default("manual"),
  status: text("status").$type<SignalStatus>().notNull().default("active"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const assistantRules = pgTable("assistant_rules", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<AssistantRuleStatus>().notNull().default("active"),
  signalId: text("signal_id").references(() => signals.id, { onDelete: "set null" }),
  /** Deterministic route target: when set, the rule runs this specific agent instead of orchestrating. */
  targetAgentId: text("target_agent_id").references(() => agents.id, { onDelete: "set null" }),
  condition: jsonb("condition").$type<Record<string, unknown>>().notNull().default({}),
  action: jsonb("action").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const signalDeliveries = pgTable("signal_deliveries", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  signalId: text("signal_id").references(() => signals.id, { onDelete: "set null" }),
  ruleId: text("rule_id").references(() => assistantRules.id, { onDelete: "set null" }),
  status: text("status").$type<SignalDeliveryStatus>().notNull().default("received"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  runId: text("run_id"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
