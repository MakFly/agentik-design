import type { NextRequest } from "next/server";
import type { Run, RunId, RunStatus, TeamId, VersionId, AgentId, WorkflowId, Cost } from "@/types/domain";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock live runs stream for the kanban board. Each connection gets its own
 * in-memory simulation: a snapshot, then status transitions / progress ticks /
 * new runs every ~1.6s. There is no engine behind this — it's pure mock data.
 */

const TEAM = "team_acme" as TeamId;
const enc = new TextEncoder();

const cost = (cents: number, input: number, output: number): Cost => ({
  tokens: { input, output, total: input + output },
  money: { amountCents: cents, currency: "USD" },
});

const SUBJECTS = [
  { kind: "workflow" as const, name: "Support Triage Flow", id: "wf_77" },
  { kind: "agent" as const, name: "Scraper", id: "agt_scraper" },
  { kind: "agent" as const, name: "Triage Agent", id: "agt_triage" },
  { kind: "agent" as const, name: "Resolve Agent", id: "agt_resolve" },
  { kind: "workflow" as const, name: "Nightly Digest", id: "wf_42" },
  { kind: "agent" as const, name: "Lead Enricher", id: "agt_enrich" },
  { kind: "workflow" as const, name: "Invoice Reconcile", id: "wf_19" },
  { kind: "agent" as const, name: "Doc Summarizer", id: "agt_summ" },
];
const TRIGGERS = ["webhook", "schedule", "manual", "api"] as const;
const ENVS = ["prod", "staging", "dev"] as const;

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const rid = () => `run_${Math.random().toString(36).slice(2, 8)}` as RunId;

function makeRun(status: RunStatus): Run {
  const subject = pick(SUBJECTS);
  const stepCount = 3 + Math.floor(Math.random() * 6);
  const terminal = status === "succeeded" || status === "failed";
  const completedSteps =
    status === "queued" ? 0 : terminal ? (status === "succeeded" ? stepCount : Math.floor(Math.random() * stepCount)) : Math.floor(Math.random() * stepCount);
  const startedAt = new Date(Date.now() - Math.floor(Math.random() * 600_000)).toISOString();
  return {
    id: rid(),
    teamId: TEAM,
    env: pick(ENVS),
    subject:
      subject.kind === "workflow"
        ? { kind: "workflow", workflowId: subject.id as WorkflowId, versionId: `${subject.id}_v1` as VersionId }
        : { kind: "agent", agentId: subject.id as AgentId, versionId: `${subject.id}_v1` as VersionId },
    subjectName: subject.name,
    status,
    trigger: { kind: pick(TRIGGERS) },
    startedAt,
    endedAt: terminal ? new Date().toISOString() : null,
    durationMs: terminal ? 4_000 + Math.floor(Math.random() * 80_000) : null,
    cost: cost(2 + Math.floor(Math.random() * 30), 2000 + Math.floor(Math.random() * 12000), 300 + Math.floor(Math.random() * 3000)),
    traceId: Math.random().toString(16).slice(2, 8),
    stepCount,
    completedSteps,
    ...(status === "failed" ? { error: { kind: "tool_error" as const, message: "search_kb returned 500", traceId: "9b1d00" } } : {}),
  };
}

// Initial board: a spread across every lane.
function seedRuns(): Run[] {
  const layout: RunStatus[] = [
    "running",
    "running",
    "running",
    "queued",
    "queued",
    "waiting_approval",
    "paused",
    "succeeded",
    "succeeded",
    "failed",
  ];
  return layout.map(makeRun);
}

const NEXT: Partial<Record<RunStatus, RunStatus[]>> = {
  queued: ["running", "running", "running"],
  running: ["running", "succeeded", "succeeded", "failed", "waiting_approval", "paused"],
  waiting_approval: ["running", "running", "failed"],
  paused: ["running", "running"],
};

export async function GET(req: NextRequest) {
  const runs = seedRuns();
  let eventId = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(enc.encode(`id: ${++eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("snapshot", { runs });

      const tick = setInterval(() => {
        const roll = Math.random();

        // ~15%: spawn a new queued run (capped so the board stays readable).
        if (roll < 0.15 && runs.length < 16) {
          const run = makeRun("queued");
          runs.push(run);
          send("run.created", run);
          return;
        }

        // ~35%: progress an in-flight run (steps + cost creep up).
        const active = runs.filter((r) => r.status === "running" && r.completedSteps < r.stepCount);
        if (roll < 0.5 && active.length > 0) {
          const run = pick(active);
          run.completedSteps = Math.min(run.stepCount, run.completedSteps + 1);
          run.cost = cost(
            run.cost.money.amountCents + 1 + Math.floor(Math.random() * 4),
            run.cost.tokens.input + 400,
            run.cost.tokens.output + 120,
          );
          send("run.progress", { id: run.id, completedSteps: run.completedSteps, cost: run.cost });
          return;
        }

        // Otherwise: transition a non-terminal run to its next state.
        const movable = runs.filter((r) => NEXT[r.status]);
        if (movable.length === 0) return;
        const run = pick(movable);
        const next = pick(NEXT[run.status]!);
        run.status = next;
        const terminal = next === "succeeded" || next === "failed";
        run.endedAt = terminal ? new Date().toISOString() : null;
        run.durationMs = terminal ? Math.max(1000, Date.now() - Date.parse(run.startedAt)) : null;
        if (next === "succeeded") run.completedSteps = run.stepCount;
        run.error = next === "failed" ? { kind: "tool_error", message: "search_kb returned 500", traceId: "9b1d00" } : undefined;
        send("run.status.changed", {
          id: run.id,
          status: run.status,
          endedAt: run.endedAt,
          durationMs: run.durationMs,
          error: run.error,
        });
      }, 1600);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(tick);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
