import type { SSEStreamingApi } from "hono/streaming";
import {
  contractEventForRunMessage,
  contractEventForStatus,
  runMessageToEvents,
  type LiveRunEvent,
  type OrchestratorRunEvent,
} from "./events";
import type { WebRunStatus } from "./mappers";
import {
  getRunAgentName,
  getRunDetail,
  getRunStatus,
  listRunMessagesAfter,
} from "./repo";
import { getRun } from "../workflows/repo";

export const TERMINAL_RUN_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

/**
 * Live streams run until the run reaches a terminal state or the client
 * disconnects — bounded only by a generous wall-clock ceiling so long SMB batch
 * runs (e.g. bulk email triage over hours) keep streaming. Replaces the old fixed
 * 1500-iteration cap that silently cut streams off at ~7.5 minutes.
 */
const MAX_LIVE_STREAM_MS = 6 * 60 * 60 * 1000;

type WebRunStatusOrNull = Awaited<ReturnType<typeof getRunStatus>>;

/**
 * Agent-task live stream: emits typed RunEvents built from task_messages.
 * Resumable via `?lastEventId=<seq>`.
 */
export async function streamDaemonRunLive(
  stream: SSEStreamingApi,
  id: string,
  teamId: string,
  resumeAfter: number,
) {
  let lastSeq = resumeAfter;
  let lastStatus: WebRunStatusOrNull = null;
  let envSeq = 0;
  const name = await getRunAgentName(teamId, id);

  const emit = async (
    ev: LiveRunEvent,
    idSeq: number,
    contractEvent?: OrchestratorRunEvent,
  ) => {
    envSeq += 1;
    const envelope = {
      id: String(idSeq),
      seq: envSeq,
      ts: new Date().toISOString(),
      runId: id,
      event: ev.type,
      ...(contractEvent ? { contractEvent } : {}),
      data: ev,
    };
    await stream.writeSSE({
      id: String(idSeq),
      event: ev.type,
      data: JSON.stringify(envelope),
    });
  };

  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_LIVE_STREAM_MS) {
    if (stream.aborted) return;
    const status = await getRunStatus(teamId, id);
    if (!status) {
      await emit(
        {
          type: "stream.error",
          kind: "unknown",
          message: "not_found",
          fatal: true,
        },
        lastSeq,
      );
      return;
    }
    if (status !== lastStatus) {
      lastStatus = status;
      await emit(
        { type: "run.status.changed", status },
        lastSeq,
        contractEventForStatus(status),
      );
    }
    const msgs = await listRunMessagesAfter(id, lastSeq);
    for (const m of msgs) {
      for (const ev of runMessageToEvents(m, name))
        await emit(ev, m.seq, contractEventForRunMessage(m, ev));
      lastSeq = m.seq;
    }
    if (TERMINAL_RUN_STATUSES.has(status)) return;
    await stream.sleep(300);
  }
}

/** SSE handler for `/runs/:id/live` — daemon runs use typed events; workflow runs poll status. */
export async function streamRunLive(
  stream: SSEStreamingApi,
  id: string,
  teamId: string,
  resumeAfter: number,
) {
  const detail = await getRunDetail(teamId, id);
  if (!detail) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({ error: "not_found" }),
    });
    return;
  }
  if (detail.run.subject.kind === "agent") {
    await streamDaemonRunLive(stream, id, teamId, resumeAfter);
    return;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_LIVE_STREAM_MS) {
    if (stream.aborted) return;
    const run = await getRun(id, teamId);
    if (!run) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: "not_found" }),
      });
      return;
    }
    await stream.writeSSE({ event: "run", data: JSON.stringify(run) });
    if (TERMINAL_RUN_STATUSES.has(run.status as WebRunStatus)) return;
    await stream.sleep(200);
  }
}
