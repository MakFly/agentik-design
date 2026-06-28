import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import type {
  CreateRuleInput,
  CreateSignalInput,
  UpdateRuleInput,
  UpdateSignalInput,
} from "./schemas";

const { agents, assistantRules, signalDeliveries, signals } = schema;

export type DeliveryStatus = "received" | "matched" | "started" | "ignored" | "failed";
export type SignalRow = typeof signals.$inferSelect;
export type AssistantRuleRow = typeof assistantRules.$inferSelect;

export async function listSignals(teamId: string) {
  return db
    .select()
    .from(signals)
    .where(eq(signals.teamId, teamId))
    .orderBy(desc(signals.createdAt));
}

export async function createSignal(teamId: string, input: CreateSignalInput) {
  const [row] = await db
    .insert(signals)
    .values({ id: genId("sig"), teamId, ...input })
    .returning();
  return row!;
}

export async function updateSignal(teamId: string, id: string, input: UpdateSignalInput) {
  const [row] = await db
    .update(signals)
    .set({ ...input, updatedAt: sql`now()` })
    .where(and(eq(signals.id, id), eq(signals.teamId, teamId)))
    .returning();
  return row ?? null;
}

export async function deleteSignal(teamId: string, id: string) {
  const deleted = await db
    .delete(signals)
    .where(and(eq(signals.id, id), eq(signals.teamId, teamId)))
    .returning({ id: signals.id });
  return Boolean(deleted[0]);
}

export async function listRules(teamId: string) {
  return db
    .select()
    .from(assistantRules)
    .where(eq(assistantRules.teamId, teamId))
    .orderBy(desc(assistantRules.createdAt));
}

export async function createRule(teamId: string, input: CreateRuleInput) {
  const [row] = await db
    .insert(assistantRules)
    .values({ id: genId("rule"), teamId, ...input })
    .returning();
  return row!;
}

export async function updateRule(teamId: string, id: string, input: UpdateRuleInput) {
  const [row] = await db
    .update(assistantRules)
    .set({ ...input, updatedAt: sql`now()` })
    .where(and(eq(assistantRules.id, id), eq(assistantRules.teamId, teamId)))
    .returning();
  return row ?? null;
}

export async function deleteRule(teamId: string, id: string) {
  const deleted = await db
    .delete(assistantRules)
    .where(and(eq(assistantRules.id, id), eq(assistantRules.teamId, teamId)))
    .returning({ id: assistantRules.id });
  return Boolean(deleted[0]);
}

/** Resolve an ACTIVE signal by its per-signal webhook token (stored in config.webhookToken). */
export async function getSignalByWebhookToken(token: string) {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.status, "active"), sql`${signals.config} ->> 'webhookToken' = ${token}`))
    .limit(1);
  return row ?? null;
}

export async function getSignal(teamId: string, signalId: string) {
  const [signal] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.id, signalId), eq(signals.teamId, teamId)))
    .limit(1);
  return signal ?? null;
}

/** All ACTIVE schedule-kind signals across teams (the cron scheduler's work-list). */
export async function listScheduledSignals() {
  return db
    .select()
    .from(signals)
    .where(and(eq(signals.status, "active"), eq(signals.kind, "schedule")));
}

export async function getActiveRulesForSignal(teamId: string, signalId: string) {
  return db
    .select()
    .from(assistantRules)
    .where(
      and(
        eq(assistantRules.teamId, teamId),
        eq(assistantRules.status, "active"),
        eq(assistantRules.signalId, signalId),
      ),
    )
    .orderBy(desc(assistantRules.createdAt));
}

export async function insertSignalDelivery(values: {
  teamId: string;
  signalId: string;
  ruleId: string | null;
  status: DeliveryStatus;
  payload: Record<string, unknown>;
  runId: string | null;
  error: string | null;
}) {
  const [delivery] = await db
    .insert(signalDeliveries)
    .values({ id: genId("sdel"), ...values })
    .returning();
  return delivery!;
}

/** Recent signal deliveries with signal/rule/agent names joined for the activity feed. */
export async function listDeliveries(teamId: string) {
  const rows = await db
    .select({
      id: signalDeliveries.id,
      signalId: signalDeliveries.signalId,
      signalName: signals.name,
      ruleId: signalDeliveries.ruleId,
      ruleName: assistantRules.name,
      targetAgentId: assistantRules.targetAgentId,
      agentName: agents.name,
      status: signalDeliveries.status,
      runId: signalDeliveries.runId,
      error: signalDeliveries.error,
      createdAt: signalDeliveries.createdAt,
    })
    .from(signalDeliveries)
    .leftJoin(signals, eq(signals.id, signalDeliveries.signalId))
    .leftJoin(assistantRules, eq(assistantRules.id, signalDeliveries.ruleId))
    .leftJoin(agents, eq(agents.id, assistantRules.targetAgentId))
    .where(eq(signalDeliveries.teamId, teamId))
    .orderBy(desc(signalDeliveries.createdAt))
    .limit(100);
  const items = rows.map((r) => ({
    id: r.id,
    signalId: r.signalId,
    signalName: r.signalName ?? undefined,
    ruleId: r.ruleId,
    ruleName: r.ruleName ?? undefined,
    targetAgentId: r.targetAgentId ?? undefined,
    agentName: r.agentName ?? undefined,
    status: r.status,
    runId: r.runId ?? undefined,
    error: r.error ?? undefined,
    createdAt: r.createdAt,
  }));
  return { items, total: items.length };
}
