import { genId } from "../../infra/db/ids";
import { hub } from "../../infra/hub";
import {
  createProjectRun,
  getProjectMemories,
  getProjectResources,
  getProjectRow,
  getProjectTaskRow,
  getRunnableAgent,
  type ProjectResourceRow,
  type ProjectRow,
  type ProjectTaskRow,
} from "./repo";

interface RunApprovalPolicy {
  requiresApproval: true;
  approved: false;
  message: string;
  risks: string[];
}

type ProjectMemoryRow = Awaited<ReturnType<typeof getProjectMemories>>[number];

function taskPrompt(input: {
  project: ProjectRow;
  task: ProjectTaskRow;
  instruction?: string;
  resources: ProjectResourceRow[];
  memories: ProjectMemoryRow[];
  approval?: RunApprovalPolicy | null;
}) {
  const resourceLines = input.resources.length
    ? input.resources.map((r) => `- ${r.type}: ${r.label || r.ref} (${r.ref})`).join("\n")
    : "- No attached resource yet.";
  const memoryLines = input.memories.length
    ? input.memories.map((memory) => `- ${memory.content}`).join("\n")
    : "- No confirmed project memory yet.";
  return [
    `Project: ${input.project.name}`,
    `Project type: ${input.project.type}`,
    input.project.description ? `Project context: ${input.project.description}` : "",
    "",
    `Task: ${input.task.title}`,
    input.task.description ? `Task detail: ${input.task.description}` : "",
    input.instruction ? `Operator instruction: ${input.instruction}` : "",
    "",
    "Project resources:",
    resourceLines,
    "",
    "Confirmed project memory:",
    memoryLines,
    input.approval ? `Preflight approval required before execution: ${input.approval.risks.join(", ")}.` : "",
    "",
    "Work as an Agentik project agent. Produce concise progress, mention blockers, and for coding tasks report files/tests/diff expectations.",
  ]
    .filter(Boolean)
    .join("\n");
}

function riskyApprovalPolicy(input: {
  project: ProjectRow;
  task: ProjectTaskRow;
  instruction?: string;
  resources: ProjectResourceRow[];
}): RunApprovalPolicy | null {
  const text = [input.project.name, input.project.description, input.task.title, input.task.description, input.instruction]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const checks: Array<[string, RegExp]> = [
    ["destructive shell/filesystem", /\b(rm\s+-rf|delete|destroy|drop\s+table|truncate|wipe|erase|remove\s+all)\b/],
    ["production deploy", /\b(deploy|release|production|prod|ship)\b/],
    ["external write", /\b(git\s+push|push\s+to|send\s+email|webhook|post\s+to|external\s+api|write\s+to\s+api)\b/],
    ["billing/provider change", /\b(stripe|charge|refund|invoice|paid|billing|provider\s+key|api\s+key)\b/],
    ["database migration", /\b(migrate|migration|schema\s+change|alter\s+table)\b/],
  ];
  const risks = checks.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  const hasWritableWorkspace = input.resources.some((resource) => resource.type === "git_repo" || resource.type === "local_dir");
  if (hasWritableWorkspace && /\b(commit|merge|rebase|checkout\s+-b|branch)\b/.test(text)) {
    risks.push("git mutation");
  }
  const uniqueRisks = [...new Set(risks)];
  if (!uniqueRisks.length) return null;
  return {
    requiresApproval: true,
    approved: false,
    message: `Approval required before executing risky project task: ${uniqueRisks.join(", ")}.`,
    risks: uniqueRisks,
  };
}

/** Queue a run for a project task: resolves the assigned agent, builds the
 *  contextual prompt + approval preflight, then persists the run + bookkeeping. */
export async function runProjectTask(teamId: string, projectTaskId: string, instruction?: string) {
  const task = await getProjectTaskRow(teamId, projectTaskId);
  if (!task) return { error: "task_not_found" as const };
  const project = await getProjectRow(teamId, task.projectId);
  if (!project) return { error: "project_not_found" as const };
  const agentId = task.assignedAgentId ?? project.leadAgentId;
  if (!agentId) return { error: "agent_required" as const };
  const agent = await getRunnableAgent(teamId, agentId);
  if (!agent) return { error: "agent_not_found" as const };
  if (!agent.liveVersionId) return { error: "not_published" as const };

  const [resources, memories] = await Promise.all([
    getProjectResources(teamId, project.id),
    getProjectMemories(teamId, project.id),
  ]);
  const approval = riskyApprovalPolicy({ project, task, instruction, resources });
  const runId = genId("run");
  await createProjectRun({
    teamId,
    runId,
    agentId,
    projectId: project.id,
    taskId: task.id,
    payload: {
      prompt: taskPrompt({ project, task, instruction, resources, memories, approval }),
      ...(approval ? { approval } : {}),
    },
  });
  hub.publish(teamId, { kind: "run", action: "created", runId });
  return { runId };
}
