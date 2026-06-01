"use client";

import { useState } from "react";
import { Play, Loader2 } from "lucide-react";
import type { AgentConfig } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/shared/error-state";
import { Timeline } from "@/features/run-view/timeline";
import { StepFocusPanel } from "@/features/run-view/step-focus-panel";
import { useRun } from "@/features/run-view/api";
import { useTestRun } from "./api";

/**
 * Sandbox test harness. Runs the *draft* config and renders the resulting trace
 * by reusing the run-view components (Timeline + StepFocusPanel) — the same UI
 * the Task Execution View uses (docs/01 §4.2). No duplication of trace rendering.
 */
export function TestHarness({ team, config }: { team: string; config: AgentConfig }) {
  const [input, setInput] = useState("My card was charged twice this month.");
  const [runId, setRunId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const testRun = useTestRun(team);
  const { data, isLoading } = useRun(team, runId ?? "");

  const steps = data?.steps ?? [];
  const selectedStep = steps.find((s) => s.id === (selected ?? steps[0]?.id)) ?? steps[0] ?? null;

  function run() {
    testRun.mutate(
      { config, input },
      { onSuccess: ({ runId }) => { setRunId(runId); setSelected(null); } },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Textarea value={input} onChange={(e) => setInput(e.target.value)} aria-label="Test input" className="min-h-16 text-sm" placeholder="Enter a test input…" />
        <Button size="sm" onClick={run} disabled={testRun.isPending} className="self-start">
          {testRun.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Run test
        </Button>
      </div>

      {testRun.isError ? <ErrorState error={testRun.error} inline onRetry={run} /> : null}

      {runId ? (
        <div className="rounded-md border border-border">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Starting test run…</p>
          ) : steps.length ? (
            <div className="grid grid-cols-1 gap-0 md:grid-cols-[180px_1fr]">
              <div className="border-b border-border p-2 md:border-r md:border-b-0">
                <Timeline steps={steps} selectedId={selectedStep?.id ?? null} onSelect={setSelected} />
              </div>
              <div className="p-3">{selectedStep ? <StepFocusPanel step={selectedStep} /> : null}</div>
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No steps produced.</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Run a test to see the agent reason, call tools, and report cost before publishing.</p>
      )}
    </div>
  );
}
