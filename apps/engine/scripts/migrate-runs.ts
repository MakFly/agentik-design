/**
 * One-shot migration: agents-repo.ts → domains/runs/* + domains/agents/repo.ts
 * with unified `runs` / `runMessages` schema.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../src");
const src = readFileSync(join(root, "agents-repo.ts"), "utf8");

function fixUnified(code: string): string {
  return (
    code
      // imports
      .replace(/from "\.\/db\/client"/g, 'from "../../infra/db/client"')
      .replace(/from "\.\/db\/ids"/g, 'from "../../infra/db/ids"')
      .replace(/from "\.\/hub"/g, 'from "../../infra/hub"')
      .replace(/from "\.\/learning-repo"/g, 'from "../learning/repo"')
      .replace(/from "\.\/db\/schema"/g, 'from "../../infra/db/schema"')
      // schema tables
      .replace(/\bagentTasks\b/g, "runs")
      .replace(/\btaskMessages\b/g, "runMessages")
      .replace(/taskMessages\.taskId/g, "runMessages.runId")
      .replace(/eq\(runMessages\.taskId/g, "eq(runMessages.runId")
      .replace(/inArray\(runMessages\.taskId/g, "inArray(runMessages.runId")
      .replace(/\[runMessages\.taskId,/g, "[runMessages.runId,")
      .replace(/taskId,/g, "runId,")
      .replace(/taskId:/g, "runId:")
      .replace(/taskId\)/g, "runId)")
      .replace(/taskId /g, "runId ")
      .replace(/taskId`/g, "runId`")
      .replace(/taskId"/g, 'runId"')
      .replace(/WHERE task_id/g, "WHERE run_id")
      // types & names
      .replace(/type TaskRowDb/g, "type DaemonRunRowDb")
      .replace(/TaskRowDb/g, "DaemonRunRowDb")
      .replace(/type MsgRowDb/g, "type RunMsgRowDb")
      .replace(/MsgRowDb/g, "RunMsgRowDb")
      .replace(/AgentTaskStatus/g, "RunStatus")
      .replace(/AgentStatsTaskRow/g, "AgentStatsRunRow")
      .replace(/agentTaskToRun/g, "daemonRunToWeb")
      .replace(/taskMessageToStep/g, "runMessageToStep")
      .replace(/projectContextForTask/g, "projectContextForRun")
      .replace(/placementForTask/g, "placementForRun")
      .replace(/artifactsFromTask/g, "artifactsFromRun")
      .replace(/getAgentTaskStatus/g, "getRunStatus")
      .replace(/getAgentTaskName/g, "getRunAgentName")
      .replace(/listTaskMessagesAfter/g, "listRunMessagesAfter")
      .replace(/listRunsUnion/g, "listRuns")
      .replace(/getRunUnified/g, "getRunDetail")
      .replace(/cancelAgentTask/g, "cancelRun")
      .replace(/pauseAgentTask/g, "pauseRun")
      .replace(/resumeAgentTask/g, "resumeRun")
      .replace(/requestAgentTaskApproval/g, "requestRunApproval")
      .replace(/approveAgentTask/g, "approveRun")
      .replace(/rejectAgentTask/g, "rejectRun")
      .replace(/retryAgentTask/g, "retryRun")
      .replace(/agentTaskMessageToEvents/g, "runMessageToEvents")
      .replace(/contractEventForTaskMessage/g, "contractEventForRunMessage")
      .replace(/nextTaskMessageSeq/g, "nextRunMessageSeq")
      .replace(/genId\("atask"\)/g, 'genId("run")')
      // remove legacy prefix guards
      .replace(/\s*if \(!id\.startsWith\("atask_"\)\) return false;\n/g, "\n")
      .replace(/\s*if \(!id\.startsWith\("atask_"\)\) return null;\n/g, "\n")
      // status literals (daemon wire → unified)
      .replace(/"dispatched"/g, '"queued"')
      .replace(/status === "completed"/g, 'status === "succeeded"')
      .replace(/t\.status === "completed"/g, 't.status === "succeeded"')
      .replace(/\.filter\(\(t\) => t\.status === "completed"\)/g, '.filter((t) => t.status === "succeeded")')
      // ids in runMessages inserts
      .replace(/taskId: runId,/g, "runId,")
      .replace(/taskId: id,/g, "runId: id,")
      .replace(/taskId: taskId,/g, "runId: runId,")
      .replace(/msg\.taskId/g, "msg.runId")
      // remove AgentTaskStatus import issues - TASK_TO_RUN_STATUS
      .replace(
        /const TASK_TO_RUN_STATUS: Record<RunStatus, WebRunStatus> = \{[\s\S]*?\};\n\n/,
        "",
      )
      .replace(/TASK_TO_RUN_STATUS\[t\.status\]/g, "t.status as WebRunStatus")
      .replace(/TASK_TO_RUN_STATUS\[task\.status\]/g, "task.status as WebRunStatus")
      // fix duplicate runs in destructuring
      .replace(
        /runMessages,\n  memoryEntries,\n  runReviews,\n  runs,\n  runSteps,/,
        "runMessages,\n  memoryEntries,\n  runReviews,\n  runSteps,",
      )
      // listRuns: unified query
      .replace(
        /\/\* ── Runs \(union: workflow runs ⨄ agent tasks\) ─+\*\/[\s\S]*?async function workflowNameMap/,
        `/* ── Runs (unified runs table) ─────────────────────────────────────── */

export async function listRuns(
  teamId: string,
  filters: { status?: string; agentId?: string },
) {
  const wheres = [eq(runs.teamId, teamId)];
  if (filters.agentId) {
    wheres.push(eq(runs.executor, "daemon"));
    wheres.push(eq(runs.agentId, filters.agentId));
  }
  const rows = await db
    .select()
    .from(runs)
    .where(and(...wheres))
    .orderBy(desc(runs.createdAt))
    .limit(200);
  const agentNames = await agentNameMap(teamId);
  const wfNames = await workflowNameMap(teamId);
  let items = rows.map((r) =>
    r.executor === "daemon"
      ? daemonRunToWeb(r, r.agentId ? agentNames.get(r.agentId) : undefined)
      : workflowRunToWeb(r, r.workflowId ? wfNames.get(r.workflowId ?? "") : undefined),
  );
  if (filters.status) items = items.filter((r) => r.status === filters.status);
  items.sort((a, b) =>
    b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0,
  );
  return items;
}

/** Tenancy-scoped run detail for any executor. */
export async function getRunDetail(teamId: string, id: string) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.teamId, teamId)))
    .limit(1);
  if (!run) return null;
  if (run.executor === "workflow") {
    const steps = await db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, id))
      .orderBy(runSteps.index);
    const wfNames = await workflowNameMap(teamId);
    return workflowDetailToWeb(
      { ...run, steps },
      run.workflowId ? wfNames.get(run.workflowId) : undefined,
    );
  }
  const msgs = await db
    .select()
    .from(runMessages)
    .where(eq(runMessages.runId, id))
    .orderBy(runMessages.seq);
  const names = await agentNameMap(run.teamId);
  const name = run.agentId ? names.get(run.agentId) : undefined;
  const projectContext = await projectContextForRun(run);
  const artifacts = artifactsFromRun(run);
  const placement = await placementForRun(run);
  const steps = msgs.map((m) => runMessageToStep(m, name));
  const fallback = steps.length === 0 ? fallbackResultStep(run, name) : null;
  return {
    run: daemonRunToWeb(run, name),
    steps: fallback ? [fallback] : steps,
    ...(artifacts ? { artifacts } : {}),
    ...(placement ? { placement } : {}),
    ...(projectContext ? { projectContext } : {}),
  };
}

async function agentNameMap(teamId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.teamId, teamId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function workflowNameMap`,
      )
      // daemon run inserts need executor
      .replace(
        /await db\.insert\(runs\)\.values\(\{\n      id: taskId,/g,
        'await db.insert(runs).values({\n      id: runId,\n      executor: "daemon",',
      )
      .replace(/const taskId = genId\("run"\)/g, 'const runId = genId("run")')
      .replace(/id: taskId,/g, "id: runId,")
      .replace(/runId: taskId/g, "runId")
      .replace(/taskId\)/g, "runId)")
      // active task queries filter daemon
      .replace(
        /from\(runs\)\n    \.where\(eq\(runs\.teamId, teamId\)\);/g,
        'from(runs)\n    .where(and(eq(runs.teamId, teamId), eq(runs.executor, "daemon")));',
      )
      .replace(
        /inArray\(runs\.status, \["queued", "queued", "running"\]\)/g,
        'inArray(runs.status, ["queued", "running"])',
      )
      .replace(
        /inArray\(runs\.status, \["queued", "running"\]\)/g,
        'inArray(runs.status, ["queued", "running"])',
      )
  );
}

const runsDir = join(root, "domains/runs");
mkdirSync(runsDir, { recursive: true });
const fixed = fixUnified(src);
writeFileSync(join(runsDir, "repo.ts"), fixed);

// agents: extract agent-only exports (lines with createAgent, listAgentRows, etc.)
// For now symlink via re-export from runs until split — create agents/repo.ts with key fns
const agentsExtract = `export {
  createAgent,
  deleteAgent,
  publishAgent,
  runAgent,
  createTestTask,
  listAgentRows,
  getAgentRow,
  getAgentTaskSnapshot,
  getAgentPlacementLabel,
  ensureDevAgents,
} from "../runs/repo";
`;
writeFileSync(join(root, "domains/agents/repo.ts"), agentsExtract);

// index barrel for runs imports
writeFileSync(
  join(runsDir, "index.ts"),
  `export * from "./repo";
export * from "./events";
`,
);

console.log("migrated runs/repo.ts", fixed.length, "bytes");
