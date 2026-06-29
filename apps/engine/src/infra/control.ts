import { roleCan, type Permission } from "@agentik/workflow-schema";
import type { AppWebSocket } from "./hub";
import { approveRun, cancelRun, pauseRun, rejectRun, resumeRun } from "../domains/runs";

/** Each control action maps to the SAME permission its HTTP route enforces
 * (see domains/runs/routes.ts), so the realtime channel can never be a softer
 * path around RBAC. */
const REQUIRED_PERMISSION: Record<string, Permission> = {
  "run.cancel": "run:control",
  "run.pause": "run:control",
  "run.resume": "run:control",
  "run.approve": "run:approve",
};

/**
 * Handle a ControlMessage from the web client (run-control.ts). The control
 * contract mirrors apps/web/types/events.ts. Every action is gated on the
 * connection's role — resolved server-side at the /realtime upgrade and carried
 * in WsData — using the same RBAC matrix as the HTTP routes. A caller without
 * the permission gets `accepted:false, reason:"forbidden"` and the action never
 * runs.
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

  const required = REQUIRED_PERMISSION[type];
  if (!required) return; // unknown control type

  if (!roleCan(ws.data.role, required)) {
    ws.send(
      JSON.stringify({ kind: "control.ack", runId, action: type, accepted: false, reason: "forbidden" }),
    );
    return;
  }

  let accepted = false;
  if (type === "run.cancel") {
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
