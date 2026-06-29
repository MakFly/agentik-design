"use client";

import { Pause, Play, Square, RotateCcw } from "lucide-react";
import type { Run, RunId } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { RbacGate } from "@/lib/auth/rbac";
import { pauseRun, resumeRun, cancelRun } from "@/lib/realtime/run-control";

/**
 * Run interventions (docs/01 §4.4). Controls are RBAC-gated (run:control) and
 * status-aware; they dispatch through the control channel (lib/realtime/run-control).
 */
export function RunControls({ run }: { run: Run }) {
  const paused = run.status === "paused";
  const live = run.status === "running" || paused || run.status === "waiting_approval";

  return (
    <div className="flex items-center gap-2">
      <RbacGate permission="run:control">
        {live ? (
          <>
            {paused ? (
              <Button variant="outline" size="sm" onClick={() => resumeRun(run.id as RunId)}>
                <Play className="size-4" /> Resume
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => pauseRun(run.id as RunId)}>
                <Pause className="size-4" /> Pause
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => cancelRun(run.id as RunId)}>
              <Square className="size-4" /> Cancel
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <RotateCcw className="size-4" /> Replay
          </Button>
        )}
      </RbacGate>
    </div>
  );
}
