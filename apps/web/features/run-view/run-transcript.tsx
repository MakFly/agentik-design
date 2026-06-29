"use client";

import { useEffect, useRef } from "react";
import { TerminalSquare } from "lucide-react";
import type { Step } from "@/types/domain";
import type { LogLineItem } from "@/components/shared/log-stream";
import { StepFocusPanel } from "./step-focus-panel";

/**
 * Hermes-style operator console: the whole run read top-to-bottom as one
 * transcript. Each step renders its full detail inline (reasoning, output, tool
 * calls, approvals, errors) — no master/detail clicking. The running step shows
 * live reasoning + logs and the view auto-scrolls to it while the run is live.
 */
export function RunTranscript({
  steps,
  runningStepId,
  liveReasoning,
  logs,
  isLive,
  onDecide,
}: {
  steps: Step[];
  runningStepId: string | null;
  liveReasoning?: string;
  logs?: LogLineItem[];
  isLive: boolean;
  onDecide: (stepId: string, decision: "approve" | "reject", reason: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Follow the stream: scroll to the latest step as steps arrive while live.
  useEffect(() => {
    if (isLive && steps.length) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [isLive, steps.length]);

  if (!steps.length) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background px-6 py-10 text-center">
        <TerminalSquare className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Waiting for runtime output</h2>
        <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
          This run is queued or has not emitted steps yet. Tool calls, reasoning, approvals, and errors stream
          in here as the daemon works.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {steps.map((step) => {
        const isRunning = step.id === runningStepId;
        const needsApproval = step.approval?.status === "pending";
        return (
          <section
            key={step.id}
            aria-current={isRunning ? "step" : undefined}
            className={
              "rounded-lg border bg-surface p-4 transition-colors " +
              (needsApproval
                ? "border-info/40 ring-1 ring-info/20"
                : isRunning
                  ? "border-running/40"
                  : "border-border")
            }
          >
            <StepFocusPanel
              step={step}
              liveReasoning={isRunning ? liveReasoning : undefined}
              logs={isRunning ? logs : undefined}
              onDecide={(decision, reason) => onDecide(step.id, decision, reason)}
            />
          </section>
        );
      })}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
