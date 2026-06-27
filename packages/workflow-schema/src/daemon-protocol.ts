import { z } from "zod";

/** Base mount path for the daemon HTTP API (apps/engine/src/daemon-routes.ts). */
export const DAEMON_BASE = "/daemon" as const;

/** All 18 daemon protocol endpoints (relative to DAEMON_BASE). */
export const DAEMON_PATHS = {
  orgs: "/orgs",
  agentsList: "/agents/list",
  agentRun: "/agents/:id/run",
  orchestratorTurn: "/orchestrator/turn",
  runDetail: "/runs/:id/detail",
  register: "/register",
  meta: "/meta",
  heartbeat: "/heartbeat",
  claimTask: "/runtimes/:id/tasks/claim",
  taskStart: "/tasks/:id/start",
  taskApprovalRequest: "/tasks/:id/approval/request",
  taskMessages: "/tasks/:id/messages",
  taskToolsInvoke: "/tasks/:id/tools/invoke",
  taskComplete: "/tasks/:id/complete",
  taskFail: "/tasks/:id/fail",
  projectWorkspaceStatus: "/project-workspaces/:id/status",
  bundlesClaim: "/bundles/claim",
  bundleStatus: "/bundles/:id/status",
} as const;

export type DaemonPath = (typeof DAEMON_PATHS)[keyof typeof DAEMON_PATHS];

export const daemonRuntimeCapabilities = z.object({
  maxConcurrent: z.number().int().positive().optional(),
  agentKinds: z.array(z.string()).optional(),
});

export const daemonRegisterRuntime = z.object({
  kind: z.string(),
  capabilities: daemonRuntimeCapabilities.optional(),
});

export const registerInput = z.object({
  team: z.string().optional(),
  teamId: z.string().optional(),
  name: z.string(),
  legacyIds: z.array(z.string()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  runtimes: z.array(daemonRegisterRuntime).min(1),
});
export type RegisterInput = z.infer<typeof registerInput>;

export const registerResponse = z.object({
  daemonId: z.string(),
  teamId: z.string(),
  runtimes: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
    }),
  ),
});
export type RegisterResponse = z.infer<typeof registerResponse>;

export const daemonMetaInput = z.object({
  daemonId: z.string(),
  meta: z.record(z.string(), z.unknown()),
});
export type DaemonMetaInput = z.infer<typeof daemonMetaInput>;

export const daemonHeartbeatInput = z.object({
  daemonId: z.string(),
});
export type DaemonHeartbeatInput = z.infer<typeof daemonHeartbeatInput>;

export const okResponse = z.object({ ok: z.boolean() });
export type OkResponse = z.infer<typeof okResponse>;

export const taskMessageType = z.enum([
  "text",
  "thinking",
  "tool_use",
  "tool_result",
  "error",
]);
export type TaskMessageType = z.infer<typeof taskMessageType>;

export const incomingMessage = z.object({
  seq: z.number().int().nonnegative(),
  type: taskMessageType,
  tool: z.string().optional(),
  content: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});
export type IncomingMessage = z.infer<typeof incomingMessage>;

export const taskMessagesInput = z.object({
  messages: z.array(incomingMessage),
});
export type TaskMessagesInput = z.infer<typeof taskMessagesInput>;

export const taskMessagesResponse = z.object({
  cancel: z.boolean(),
});
export type TaskMessagesResponse = z.infer<typeof taskMessagesResponse>;

export const claimedTaskWorkspace = z.object({
  id: z.string(),
  projectId: z.string(),
  resourceId: z.string(),
  type: z.enum(["git_repo", "local_dir"]),
  ref: z.string(),
  branch: z.string(),
  path: z.string(),
});

export const claimedTask = z.object({
  id: z.string(),
  teamId: z.string(),
  agentId: z.string(),
  projectId: z.string().nullish(),
  projectTaskId: z.string().nullish(),
  kind: z.string(),
  input: z.unknown(),
  workDir: z.string(),
  workspace: claimedTaskWorkspace.optional(),
  context: z.unknown().optional(),
  env: z.record(z.string(), z.string()).optional(),
});
export type ClaimedTask = z.infer<typeof claimedTask>;

export const taskApprovalRequestInput = z.object({
  message: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type TaskApprovalRequestInput = z.infer<typeof taskApprovalRequestInput>;

export const invokeToolInput = z.object({
  toolId: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});
export type InvokeToolInput = z.infer<typeof invokeToolInput>;

export const completeTaskInput = z.object({
  result: z.unknown().optional(),
});
export type CompleteTaskInput = z.infer<typeof completeTaskInput>;

export const failTaskInput = z.object({
  error: z.string().optional(),
});
export type FailTaskInput = z.infer<typeof failTaskInput>;

export const projectWorkspaceStatusInput = z.object({
  status: z.enum(["pending", "ready", "syncing", "error"]),
  path: z.string().optional(),
  error: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type ProjectWorkspaceStatusInput = z.infer<
  typeof projectWorkspaceStatusInput
>;

export const bundleClaimInput = z.object({
  daemonId: z.string(),
});
export type BundleClaimInput = z.infer<typeof bundleClaimInput>;

export const bundleCommand = z.object({
  id: z.string(),
  teamId: z.string(),
  kind: z.string(),
  action: z.enum(["install", "upgrade", "uninstall"]),
});
export type BundleCommand = z.infer<typeof bundleCommand>;

export const bundleStatusInput = z.object({
  status: z.enum(["done", "failed"]),
  result: z.string().optional(),
  error: z.string().optional(),
});
export type BundleStatusInput = z.infer<typeof bundleStatusInput>;

export const daemonTeamBody = z.object({
  teamId: z.string().optional(),
});
export type DaemonTeamBody = z.infer<typeof daemonTeamBody>;

export const daemonAgentRunInput = daemonTeamBody.extend({
  input: z.string().optional(),
});
export type DaemonAgentRunInput = z.infer<typeof daemonAgentRunInput>;

export const orchestratorTurnInput = daemonTeamBody.extend({
  input: z.string().optional(),
  agentHintId: z.string().nullable().optional(),
  threadKey: z.string().optional(),
});
export type OrchestratorTurnInput = z.infer<typeof orchestratorTurnInput>;

export const orgRef = z.object({
  teamId: z.string(),
  slug: z.string(),
  name: z.string(),
});
export type OrgRef = z.infer<typeof orgRef>;

export const orgsResponse = z.object({
  orgs: z.array(orgRef),
});
export type OrgsResponse = z.infer<typeof orgsResponse>;

export const agentSummary = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  goal: z.string(),
  health: z.string(),
  runtimeKind: z.string(),
  model: z.string().nullable().optional(),
  published: z.boolean(),
});
export type AgentSummary = z.infer<typeof agentSummary>;

export const agentsListResponse = z.object({
  agents: z.array(agentSummary),
});
export type AgentsListResponse = z.infer<typeof agentsListResponse>;
