"use client";

import type { Step } from "@/types/domain";
import { MessageSquareText } from "lucide-react";
import { ReasoningStream } from "@/components/shared/reasoning-stream";
import { ToolCallRecord } from "@/components/shared/tool-call-record";
import { LogStream, type LogLineItem } from "@/components/shared/log-stream";
import { StatusBadge } from "@/components/shared/status-badge";
import { MarkdownBlock } from "@/components/assistant-ui/markdown-text";
import { ApprovalCard } from "./approval-card";
import { ActorIcon } from "./actor-icon";

export function StepFocusPanel({
  step,
  liveReasoning,
  logs,
  onDecide,
}: {
  step: Step;
  /** when streaming, overrides step.reasoning with the live-accumulated text */
  liveReasoning?: string;
  logs?: LogLineItem[];
  onDecide?: (decision: "approve" | "reject", reason: string) => void;
}) {
  const running = step.status === "running";
  const reasoning = liveReasoning ?? step.reasoning;
  const agentOutput =
    step.actor.kind === "agent" && !reasoning && !step.error && step.summary
      ? step.summary
      : "";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <ActorIcon actor={step.actor} className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">
            Step {step.index} · {step.actor.name}
          </h2>
        </div>
        <StatusBadge status={step.status} size="sm" />
      </header>

      {step.error ? (
        <div className="rounded-md border border-danger/30 bg-danger-surface/40 p-3">
          <p className="text-xs font-medium tracking-wide text-danger uppercase">Error · {step.error.kind}</p>
          <p className="mt-1 font-mono text-xs text-foreground">{step.error.code}</p>
          <p className="mt-1 text-sm text-foreground">{step.error.message}</p>
        </div>
      ) : null}

      {step.approval ? <ApprovalCard approval={step.approval} onDecide={onDecide} /> : null}

      {reasoning || running ? <ReasoningStream text={reasoning} streaming={running} /> : null}

      {agentOutput ? (
        <section className="rounded-md border border-border bg-surface-2/60 p-3" aria-label="Agent output">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <MessageSquareText className="size-3.5" aria-hidden="true" />
            Output
          </div>
          <MarkdownBlock
            text={agentOutput}
            className="max-h-[60vh] max-w-none overflow-y-auto text-sm leading-relaxed"
          />
        </section>
      ) : null}

      {step.toolCalls.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Tool calls ({step.toolCalls.length})
          </h3>
          <div className="flex flex-col gap-1.5">
            {step.toolCalls.map((call) => (
              <ToolCallRecord key={call.id} call={call} defaultOpen={call.status !== "succeeded"} />
            ))}
          </div>
        </section>
      ) : null}

      {logs && logs.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Logs</h3>
          <LogStream lines={logs} />
        </section>
      ) : null}
    </div>
  );
}
