"use client";

import { toast } from "sonner";
import type { ControlMessage } from "@/types/events";
import type { RunId, StepId } from "@/types/domain";

/**
 * Run control channel (docs/04 §10.3). The production transport is a single
 * multiplexed WebSocket carrying control + run subscriptions. This module is the
 * one integration point: swap `send()` to push ControlMessages over the socket
 * and reconcile `control.ack`. For now it optimistically toasts so the UI flow
 * is exercised; the backend WS is wired in the same place.
 */
function send(message: ControlMessage): Promise<{ accepted: boolean; error?: string }> {
  // TODO(P2-backend): push `message` over the WS, await the matching control.ack.
  void message;
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
