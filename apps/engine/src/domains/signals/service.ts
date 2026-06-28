import { sendOrchestratedTurn } from "../chat/orchestrator";
import { runAgent } from "../runs";
import { matchesCondition } from "./condition";
import { cronMatches } from "./cron";
import {
  type AssistantRuleRow,
  type DeliveryStatus,
  type SignalRow,
  getActiveRulesForSignal,
  getSignal,
  getSignalByWebhookToken,
  insertSignalDelivery,
  listScheduledSignals,
} from "./repo";

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

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

async function fireRule(
  teamId: string,
  signalId: string,
  rule: AssistantRuleRow,
  payload: Record<string, unknown>,
): Promise<{ status: DeliveryStatus; runId: string | null; error: string | null }> {
  const action = objectRecord(rule.action);
  const actionType = typeof action.type === "string" ? action.type : null;
  const actionInput = typeof action.input === "string" ? action.input.trim() : "";
  const payloadText = JSON.stringify(payload ?? {});
  const threadKey = `signal:${signalId}:rule:${rule.id}`;

  if (rule.targetAgentId) {
    // Deterministic route: run exactly this agent, no orchestration/router involved.
    const run = await runAgent(teamId, rule.targetAgentId, actionInput || payloadText);
    if (run === null) return { status: "ignored", runId: null, error: "target_agent_missing" };
    if ("error" in run) return { status: "failed", runId: null, error: run.error ?? null };
    return { status: "started", runId: run.runId, error: null };
  }
  if (actionType === "run_agent" && actionInput) {
    const routed = await sendOrchestratedTurn({
      teamId,
      surface: "web",
      actorId: `signal:${signalId}`,
      threadKey,
      text: actionInput,
    });
    return routedToDelivery(routed);
  }
  if (actionType === "orchestrate" && actionInput) {
    const routed = await sendOrchestratedTurn({
      teamId,
      surface: "web",
      actorId: `signal:${signalId}`,
      threadKey,
      text: actionInput,
      forceOrchestration: true,
    });
    return routedToDelivery(routed);
  }
  // Rule matched but declares no actionable action — record the match, take no action.
  return { status: "matched", runId: null, error: null };
}

/**
 * Ingest a signal payload: evaluate each active rule's condition against the payload
 * and fire only the rules that match. Records one delivery per evaluated rule
 * (status "ignored" + error "condition_unmet" when the condition does not match),
 * so the activity feed shows why a rule did or did not fire.
 */
export async function dispatchSignal(
  teamId: string,
  signalId: string,
  input: { payload: Record<string, unknown> },
) {
  const signal = await getSignal(teamId, signalId);
  if (!signal) return null;

  const payload = input.payload ?? {};
  const rules = await getActiveRulesForSignal(teamId, signalId);
  const deliveries = [];

  if (rules.length === 0) {
    deliveries.push(
      await insertSignalDelivery({
        teamId,
        signalId,
        ruleId: null,
        status: "received",
        payload,
        runId: null,
        error: null,
      }),
    );
    return { signal, deliveries };
  }

  for (const rule of rules) {
    let outcome: { status: DeliveryStatus; runId: string | null; error: string | null };
    if (!matchesCondition(rule.condition, payload)) {
      outcome = { status: "ignored", runId: null, error: "condition_unmet" };
    } else {
      outcome = await fireRule(teamId, signalId, rule, payload);
    }
    deliveries.push(
      await insertSignalDelivery({
        teamId,
        signalId,
        ruleId: rule.id,
        payload,
        ...outcome,
      }),
    );
  }

  return { signal, deliveries };
}

/** Re-read a Date's wall-clock fields in a named timezone (for cron `tz`). */
function inZone(date: Date, tz: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const f = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>;
    return new Date(
      Number(f.year),
      Number(f.month) - 1,
      Number(f.day),
      Number(f.hour) % 24,
      Number(f.minute),
      Number(f.second),
    );
  } catch {
    return date; // unknown tz → fall back to process-local time
  }
}

/** Active schedule signals whose cron expression matches `now` (minute granularity). */
export async function dueScheduledSignals(now: Date): Promise<SignalRow[]> {
  const scheduled = await listScheduledSignals();
  return scheduled.filter((s) => {
    const config = (s.config ?? {}) as { cron?: unknown; tz?: unknown };
    if (typeof config.cron !== "string") return false;
    const when = typeof config.tz === "string" ? inZone(now, config.tz) : now;
    return cronMatches(config.cron, when);
  });
}

/** Fire every due scheduled signal once. Used by the scheduler tick and by tests. */
export async function fireDueScheduledSignals(
  now: Date,
): Promise<Array<{ signalId: string; deliveries: number }>> {
  const due = await dueScheduledSignals(now);
  const fired: Array<{ signalId: string; deliveries: number }> = [];
  for (const signal of due) {
    const result = await dispatchSignal(signal.teamId, signal.id, {
      payload: { trigger: "cron", firedAt: now.toISOString() },
    });
    if (result) fired.push({ signalId: signal.id, deliveries: result.deliveries.length });
  }
  return fired;
}

/**
 * Unauthenticated external ingestion: an outside system (Gmail push, CRM, Stripe…)
 * posts to /signals/ingest/:token. The token resolves the signal (no session), then
 * normal condition-gated dispatch runs. Returns null if the token matches nothing.
 */
export async function ingestSignalWebhook(
  token: string,
  payload: Record<string, unknown>,
): Promise<{ signalId: string; deliveries: number } | null> {
  const signal = await getSignalByWebhookToken(token);
  if (!signal) return null;
  const result = await dispatchSignal(signal.teamId, signal.id, { payload });
  if (!result) return null;
  return { signalId: signal.id, deliveries: result.deliveries.length };
}
