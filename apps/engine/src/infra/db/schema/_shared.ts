import { timestamp } from "drizzle-orm/pg-core";
import type {
  CreatedBy,
  KnowledgeScope,
  MemoryPolicy,
  ProposedMemoryChange,
  ProposedSkillChange,
  RiskLevel,
  RunStatus,
  RunReviewStatus,
  RuntimeKind,
  SkillPolicy,
  StepStatus,
  TriggerKind,
  WorkflowGraph,
} from "@agentik/workflow-schema";

export const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });

/* ── Agent-execution harness (multica-style) ─────────────────────────── */

export type AgentHealth = "healthy" | "degraded" | "error" | "idle" | "disabled";
export type DaemonStatus = "online" | "offline" | "draining";
export type RuntimeStatus = "online" | "offline";
export type McpTransport = "streamable_http" | "sse";
export type McpServerStatus = "unknown" | "online" | "error";
export type McpToolStatus = "available" | "unavailable";
export interface ToolGrantRecord {
  toolId: string;
  scopes: string[];
  rateCapPerMin?: number;
  requireApproval?: boolean;
}
export type RunExecutor = "workflow" | "daemon" | "orchestrator";
export type RunMessageType = "text" | "thinking" | "tool_use" | "tool_result" | "error";

/** Map legacy agent_tasks / daemon wire status to unified {@link RunStatus}. */
export function agentTaskStatusToRunStatus(status: string): RunStatus {
  switch (status) {
    case "completed":
      return "succeeded";
    case "dispatched":
      return "queued";
    default:
      return status as RunStatus;
  }
}

/** Map unified {@link RunStatus} to legacy daemon task status (claim/complete wire format). */
export function runStatusToAgentTaskStatus(status: RunStatus): string {
  switch (status) {
    case "succeeded":
      return "completed";
    case "timed_out":
      return "failed";
    default:
      return status;
  }
}
export type ChatSessionStatus = "active" | "archived";
export type ChatMessageRole = "user" | "assistant";
export type ProjectType = "ops" | "code" | "hybrid";
export type ProjectStatus = "active" | "archived";
export type ProjectResourceType = "git_repo" | "local_dir" | "url" | "document" | "tool";
export type ProjectTaskStatus = "backlog" | "ready" | "running" | "blocked" | "review" | "done" | "cancelled";
export type ProjectTaskPriority = "P0" | "P1" | "P2" | "P3";
export type ProjectTaskCommentAuthorKind = "user" | "agent" | "system";
export type ProjectWorkspaceStatus = "pending" | "ready" | "syncing" | "error";
export type ChannelProvider = "telegram";
export type ChannelConnectionStatus = "setup" | "active" | "disabled" | "error";
/** How Telegram updates reach us. Polling needs no public URL (default); webhook needs one. */
export type ChannelTransport = "polling" | "webhook";
export type ChannelIdentityRole = "operator" | "viewer";
export type ChannelMessageDirection = "inbound" | "outbound";
/** How a channel binding listens in group chats: open to all, an allowlist, or off. */
export type ChannelGroupPolicy = "open" | "allowlist" | "off";
/**
 * Why a task ended in `failed`. Drives retry policy: `timeout`/`runtime_offline`/
 * `runtime_recovery` are retryable; `agent_error` is terminal. v1 only produces
 * `timeout` (scanner) and `agent_error` (daemon-reported); the others are reserved.
 */
export type TaskErrorReason = "timeout" | "runtime_offline" | "runtime_recovery" | "agent_error";
export const RETRYABLE_TASK_ERROR_REASONS: TaskErrorReason[] = ["timeout", "runtime_offline", "runtime_recovery"];

export type OrgRole = "owner" | "admin" | "engineer" | "operator" | "viewer";
export type MemoryEventAction = "create" | "update" | "archive" | "restore";
export type BundleAction = "install" | "upgrade" | "uninstall";
export type BundleCommandStatus = "queued" | "running" | "done" | "failed";
