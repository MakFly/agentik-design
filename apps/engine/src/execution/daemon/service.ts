import {
  appendMessages as appendMessagesDb,
  claimTask as claimTaskDb,
  completeTask as completeTaskDb,
  failTask as failTaskDb,
  requestDaemonTaskApproval as requestDaemonTaskApprovalDb,
  startTask as startTaskDb,
  type ClaimedTask,
  type IncomingMessage,
} from "./repo";
import {
  onRunCompleted,
  onRunDispatched,
  onRunFailed,
  onRunProgress,
  onRunRunning,
  onRunWaitingApproval,
} from "../../domains/runs/service";
import type { TaskErrorReason } from "../../infra/db/schema";

export type { ClaimedTask, IncomingMessage };

export async function claimTask(runtimeId: string): Promise<ClaimedTask | null> {
  const task = await claimTaskDb(runtimeId);
  if (task) onRunDispatched(task.teamId, task.id);
  return task;
}

export async function startTask(runId: string): Promise<boolean> {
  const row = await startTaskDb(runId);
  if (!row) return false;
  await onRunRunning(row.teamId, runId);
  return true;
}

export async function requestDaemonTaskApproval(
  runId: string,
  input: { message?: string; context?: Record<string, unknown> },
): Promise<boolean> {
  const res = await requestDaemonTaskApprovalDb(runId, input);
  if (!res) return false;
  await onRunWaitingApproval(res.teamId, runId, res.message);
  return true;
}

export async function appendMessages(
  runId: string,
  messages: IncomingMessage[],
): Promise<{ cancel: boolean }> {
  const res = await appendMessagesDb(runId, messages);
  if (res.teamId != null && res.completedSteps != null && res.stepCount != null) {
    onRunProgress(res.teamId, runId, res.completedSteps, res.stepCount);
  }
  return { cancel: res.cancel };
}

export async function completeTask(
  runId: string,
  result: unknown,
): Promise<boolean> {
  const row = await completeTaskDb(runId, result);
  if (!row) return false;
  await onRunCompleted(row.teamId, runId, result, {
    chatSessionId: row.chatSessionId,
    projectTaskId: row.projectTaskId,
  });
  return true;
}

export async function failTask(
  runId: string,
  error: string,
  reason: TaskErrorReason = "agent_error",
): Promise<boolean> {
  const row = await failTaskDb(runId, error, reason);
  if (!row) return false;
  await onRunFailed(row.teamId, runId, error, {
    projectTaskId: row.projectTaskId,
  });
  return true;
}
