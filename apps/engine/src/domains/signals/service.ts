import { sendOrchestratedTurn } from "../chat/orchestrator";
import { runAgent } from "../runs";
import { matchesCondition } from "./condition";
import {
  type AssistantRuleRow,
  type DeliveryStatus,
  getActiveRulesForSignal,
  getSignal,
  insertSignalDelivery,
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
