"use client";

import { toast } from "sonner";
import type { ControlMessage } from "@/types/events";
import type { RunId, StepId } from "@/types/domain";
import { realtime } from "./ws-client";

/**
 * Run control channel (docs/04 §10.3). Pushes ControlMessages over the single
 * multiplexed realtime socket. The engine replies with `control.ack`; we don't
 * block the UI on it (optimistic), but the cache invalidation from the resulting
 * lifecycle event reconciles state. When the socket is down (mock mode), the
 * action is acknowledged optimistically so the UI flow stays exercised.
 */
function send(message: ControlMessage): Promise<{ accepted: boolean; error?: string }> {
  realtime.send(message);
  return Promise.resolve({ accepted: true });
}

export async function pauseRun(runId: RunId) {
  await send({ type: "run.pause", runId });
  toast.success("Pause requested");
}

export async function resumeRun(runId: RunId) {
  await send({ type: "run.resume", runId });
  toast.success("Resume requested");
}

export async function cancelRun(runId: RunId) {
  await send({ type: "run.cancel", runId });
  toast.success("Cancel requested");
}

export async function approveStep(runId: RunId, stepId: StepId, decision: "approve" | "reject", reason?: string) {
  await send({ type: "run.approve", runId, stepId, decision, reason });
  toast.success(decision === "approve" ? "Approved" : "Rejected");
}
