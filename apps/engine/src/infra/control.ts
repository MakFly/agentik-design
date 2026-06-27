import type { AppWebSocket } from "./hub";
import { approveRun, cancelRun, pauseRun, rejectRun, resumeRun } from "../domains/runs";

/**
 * Handle a ControlMessage from the web client (run-control.ts). The control
 * contract mirrors apps/web/types/events.ts. Cancel flips the task (and the repo
 * broadcasts the resulting run event); other actions are acked optimistically
 * until their gates are implemented.
 */
export async function handleControl(ws: AppWebSocket, raw: string | Buffer): Promise<void> {
  let msg: { type?: string; runId?: string; decision?: "approve" | "reject"; reason?: string } | null = null;
  try {
    msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
  } catch {
    return;
  }
  const type = msg?.type;
  const runId = msg?.runId;
  if (!type || !runId) return;
  const control = msg as { type: string; runId: string; decision?: "approve" | "reject"; reason?: string };

  let accepted = true;
  if (type === "run.cancel") {
    // NOTE: the HTTP cancel route is gated on `run:control`, but this WS channel is only
    // team-scoped (no user/role is carried through the /realtime upgrade). Gating it on
    // `run:control` requires plumbing identity into WsData — deferred (out of Phase 1 scope).
    accepted = await cancelRun(ws.data.teamId, runId);
  } else if (type === "run.pause") {
    accepted = await pauseRun(ws.data.teamId, runId);
  } else if (type === "run.resume") {
    accepted = await resumeRun(ws.data.teamId, runId);
  } else if (type === "run.approve") {
    accepted =
      control.decision === "reject"
        ? await rejectRun(ws.data.teamId, runId, control.reason)
        : await approveRun(ws.data.teamId, runId, control.reason);
  }

  ws.send(JSON.stringify({ kind: "control.ack", runId, action: type, accepted }));
}
