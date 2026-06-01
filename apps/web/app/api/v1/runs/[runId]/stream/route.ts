import type { NextRequest } from "next/server";
import type { EventEnvelope, RunEvent } from "@/types/events";
import type { RunId, StepId } from "@/types/domain";

export const dynamic = "force-dynamic";

/**
 * Mock SSE endpoint (dev). Streams a scripted execution for a live run so the
 * Task Execution View animates end-to-end. A real backend replaces this with the
 * run bus fan-out; the wire format (docs/04 §10) is identical. Respects
 * `?lastEventId=` by resuming after that sequence number.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const url = new URL(req.url);
  const resumeAfter = Number(url.searchParams.get("lastEventId") ?? "0") || 0;

  const script = buildScript(runId as RunId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      req.signal.addEventListener("abort", () => {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      for (const env of script) {
        if (closed) break;
        if (env.seq <= resumeAfter) continue;
        const frame = `id: ${env.id}\nevent: ${env.event}\ndata: ${JSON.stringify(env)}\n\n`;
        controller.enqueue(encoder.encode(frame));
        await sleep(env.event === "reasoning.delta" ? 90 : 450);
      }
      if (!closed) {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildScript(runId: RunId): EventEnvelope[] {
  let seq = 0;
  const ts = "2026-05-31T14:22:05Z";
  const make = <T extends RunEvent>(data: T): EventEnvelope => {
    seq += 1;
    return { id: String(seq), seq, ts, runId, event: data.type, data };
  };

  const stepId = "step_live" as StepId;
  const reasoning =
    "The ticket mentions a duplicate charge. I should look up the customer's recent transactions and the refund policy window before deciding whether a refund is warranted.";

  const events: EventEnvelope[] = [
    make({ type: "run.status.changed", status: "running" }),
    make({
      type: "step.started",
      step: { id: stepId, index: 0, actor: { kind: "agent", agentId: "agt_resolve" as never, name: "Resolve Agent" }, summary: "Investigating the charge" },
    }),
  ];

  // token-by-token reasoning
  for (const word of reasoning.split(" ")) {
    events.push(make({ type: "reasoning.delta", stepId, textDelta: word + " " }));
  }

  events.push(
    make({ type: "tool_call.started", stepId, call: { id: "tc_live", toolId: "tl_crm" as never, action: "get_customer", request: { id: "cus_4831" } } }),
    make({ type: "tool_call.completed", stepId, callId: "tc_live", status: "succeeded", httpStatus: 200, latencyMs: 410, response: { id: "cus_4831", plan: "pro", lastCharge: "$520.00" } }),
    make({ type: "log.line", stepId, level: "info", message: "retrieved customer cus_4831" }),
    make({ type: "run.cost.updated", cost: { tokens: { input: 6100, output: 700, total: 6800 }, money: { amountCents: 9, currency: "USD" } }, capRemaining: { amountCents: 11, currency: "USD" } }),
    make({ type: "step.completed", stepId, status: "succeeded", durationMs: 3200, summary: "Confirmed duplicate charge", cost: { tokens: { input: 6100, output: 700, total: 6800 }, money: { amountCents: 9, currency: "USD" } } }),
    make({
      type: "approval.requested",
      stepId: "step_live_appr" as StepId,
      approval: { status: "pending", approverRole: "operator", message: "Approve refund of $520 to cus_4831?", context: { refundAmount: "$520.00", customer: "cus_4831", reason: "duplicate charge" } },
    }),
    make({ type: "run.status.changed", status: "waiting_approval" }),
  );

  return events;
}
