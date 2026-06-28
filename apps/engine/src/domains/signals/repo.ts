import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { sendOrchestratedTurn } from "../chat/orchestrator";
import { runAgent } from "../runs";
import type {
  CreateRuleInput,
  CreateSignalInput,
  UpdateRuleInput,
  UpdateSignalInput,
} from "./schemas";

const { agents, assistantRules, signalDeliveries, signals } = schema;

type DeliveryStatus = "received" | "matched" | "started" | "ignored" | "failed";

/** Map an orchestrator turn result onto a delivery outcome. */
function routedToDelivery(
  routed: Awaited<ReturnType<typeof sendOrchestratedTurn>>,
): { status: DeliveryStatus; runId: string | null; error: string | null } {
  if (routed.kind === "orchestration" || routed.kind === "run") {
    return { status: "started", runId: routed.runId, error: null };
  }
  return {
    status: "failed",
    runId: null,
    error: routed.kind === "error" ? routed.error : "clarification_required",
  };
}

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

export async function dispatchSignal(
  teamId: string,
  signalId: string,
  input: { payload: Record<string, unknown> },
) {
  const [signal] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.id, signalId), eq(signals.teamId, teamId)))
    .limit(1);
  if (!signal) return null;

  const rules = await db
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

  const payloadText = JSON.stringify(input.payload ?? {});
  const deliveries = [];
  for (const rule of rules.length ? rules : [null]) {
    const deliveryId = genId("sdel");
    let status: DeliveryStatus = rule ? "matched" : "received";
    let runId: string | null = null;
    let error: string | null = null;

    if (rule) {
      const action = objectRecord(rule.action);
      const actionType = typeof action.type === "string" ? action.type : null;
      const actionInput = typeof action.input === "string" ? action.input.trim() : "";
      const threadKey = `signal:${signalId}:rule:${rule.id}`;

      if (rule.targetAgentId) {
        // Deterministic route: run exactly this agent, no orchestration/router involved.
        const run = await runAgent(teamId, rule.targetAgentId, actionInput || payloadText);
        if (run === null) {
          status = "ignored"; // agent was deleted/unknown — skip rather than fail loudly
          error = "target_agent_missing";
        } else if ("error" in run) {
          status = "failed";
          error = run.error ?? null;
        } else {
          status = "started";
          runId = run.runId;
        }
      } else if (actionType === "run_agent" && actionInput) {
        // Single-agent intent: let the router pick, but never force a multi-step plan.
        const routed = await sendOrchestratedTurn({
          teamId,
          surface: "web",
          actorId: `signal:${signalId}`,
          threadKey,
          text: actionInput,
        });
        ({ status, runId, error } = routedToDelivery(routed));
      } else if (actionType === "orchestrate" && actionInput) {
        const routed = await sendOrchestratedTurn({
          teamId,
          surface: "web",
          actorId: `signal:${signalId}`,
          threadKey,
          text: actionInput,
          forceOrchestration: true,
        });
        ({ status, runId, error } = routedToDelivery(routed));
      }
    }

    const [delivery] = await db
      .insert(signalDeliveries)
      .values({
        id: deliveryId,
        teamId,
        signalId,
        ruleId: rule?.id ?? null,
        status,
        payload: input.payload,
        runId,
        error,
      })
      .returning();
    deliveries.push(delivery!);
  }

  return { signal, deliveries };
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

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
