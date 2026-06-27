/**
 * Fix unified runs references in moved engine modules.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync, statSync } from "node:fs";

const root = join(import.meta.dir, "../src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function fixUnified(code: string): string {
  return (
    code
      .replace(/\bagentTasks\b/g, "runs")
      .replace(/\btaskMessages\b/g, "runMessages")
      .replace(/taskMessages\.taskId/g, "runMessages.runId")
      .replace(/eq\(runMessages\.taskId/g, "eq(runMessages.runId")
      .replace(/inArray\(runMessages\.taskId/g, "inArray(runMessages.runId")
      .replace(/\[runMessages\.taskId,/g, "[runMessages.runId,")
      .replace(/genId\("atask"\)/g, 'genId("run")')
      .replace(/AgentTaskStatus/g, "RunStatus")
      .replace(/TaskMessageType/g, "RunMessageType")
      .replace(/FROM agent_tasks/g, "FROM runs")
      .replace(/status = 'dispatched'/g, "status = 'queued' AND dispatched_at IS NOT NULL")
      .replace(/"dispatched"/g, '"queued"')
      .replace(/"completed"/g, '"succeeded"')
      .replace(/atask_/g, "run_")
      .replace(/startsWith\("run_"\)/g, 'startsWith("run_")') // noop but keeps consistency
      .replace(
        /import type \{ RunStatus \} from "\.\.\/\.\.\/infra\/db\/schema";/,
        'import type { RunMessageType, RunStatus } from "../../infra/db/schema";',
      )
  );
}

function fixDaemonRepo(code: string): string {
  let c = fixUnified(code);
  // Add executor filter for daemon-scoped run queries
  c = c.replace(
    /eq\(runs\.daemonId, daemonId\),\n        inArray\(runs\.status, ACTIVE_TASK_STATUS\)/,
    'eq(runs.executor, "daemon"),\n        eq(runs.daemonId, daemonId),\n        inArray(runs.status, ACTIVE_TASK_STATUS)',
  );
  c = c.replace(
    /const ACTIVE_TASK_STATUS: RunStatus\[\] = \[\n  "queued",\n  "running"/,
    'const ACTIVE_TASK_STATUS: RunStatus[] = [\n  "running"',
  );
  // claim updates: use runStatusToAgentTaskStatus import
  if (!c.includes("runStatusToAgentTaskStatus")) {
    c = c.replace(
      /import type \{\n  RunStatus,\n  TaskErrorReason,\n  RunMessageType,\n\}/,
      'import {\n  runStatusToAgentTaskStatus,\n  type RunMessageType,\n  type RunStatus,\n  type TaskErrorReason,\n}',
    );
  }
  return c;
}

for (const file of walk(root)) {
  if (file.includes("domains/runs/repo.ts")) continue;
  let src = readFileSync(file, "utf8");
  if (!src.includes("agentTasks") && !src.includes("taskMessages") && !src.includes('genId("atask")') && !src.includes("atask_")) {
    continue;
  }
  const next = file.endsWith("execution/daemon/repo.ts")
    ? fixDaemonRepo(src)
    : fixUnified(src);
  writeFileSync(file, next);
  console.log("unified", file.replace(root + "/", ""));
}
