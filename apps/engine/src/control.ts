import type { AppWebSocket } from "./hub";
import { cancelAgentTask } from "./agents-repo";

/**
 * Handle a ControlMessage from the web client (run-control.ts). The control
 * contract mirrors apps/web/types/events.ts. Cancel flips the task (and the repo
 * broadcasts the resulting run event); other actions are acked optimistically
 * until their gates are implemented.
 */
export async function handleControl(ws: AppWebSocket, raw: string | Buffer): Promise<void> {
  let msg: { type?: string; runId?: string } | null = null;
  try {
    msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
  } catch {
    return;
  }
  const type = msg?.type;
  const runId = msg?.runId;
  if (!type || !runId) return;

  let accepted = true;
  if (type === "run.cancel") {
    accepted = await cancelAgentTask(ws.data.teamId, runId);
  }

  ws.send(JSON.stringify({ kind: "control.ack", runId, action: type, accepted }));
}
