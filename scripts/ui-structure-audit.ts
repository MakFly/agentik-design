import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

type Check = {
  name: string;
  file: string;
  mustContain: string[];
};

const checks: Check[] = [
  {
    name: "command center route mounts the project-first screen",
    file: "apps/web/app/[team]/(app)/command-center/page.tsx",
    mustContain: [
      "CommandCenterScreen",
      "metadata",
      "Command Center",
    ],
  },
  {
    name: "command center shows project, run, approval, agent and Telegram control lanes",
    file: "apps/web/features/command-center/command-center-screen.tsx",
    mustContain: [
      "Project-first control plane",
      "Project Workspaces",
      "Active runs",
      "Approvals",
      "Agents",
      "Telegram",
      "ApprovalPanel",
      "TelegramPanel",
      "RunPanel",
      "AgentPanel",
    ],
  },
  {
    name: "project detail route mounts the cockpit",
    file: "apps/web/app/[team]/(app)/projects/[projectId]/page.tsx",
    mustContain: [
      "ProjectDetailScreen",
      "projectId",
    ],
  },
  {
    name: "project cockpit exposes task board, agent console, context rail and channels",
    file: "apps/web/features/projects/project-detail-screen.tsx",
    mustContain: [
      "TaskBoard",
      "ProjectConsole",
      "ProjectContextPanel",
      "Agent console",
      "Run instruction",
      "Latest run",
      "Project context",
      "Active runs",
      "Resources",
      "Memory",
      "Workspaces",
      "Linked channels",
    ],
  },
  {
    name: "run detail route mounts the Hermes-style run view",
    file: "apps/web/app/[team]/(app)/runs/[runId]/page.tsx",
    mustContain: [
      "RunView",
      "runId",
    ],
  },
  {
    name: "run view exposes navigator, transcript and summary rail",
    file: "apps/web/features/run-view/run-view.tsx",
    mustContain: [
      "RunNavigator",
      "Execution transcript",
      "RunTranscript",
      "RunSummary",
      "ChildRunsSection",
    ],
  },
  {
    name: "run summary exposes cost, project task, operator input, metadata and errors",
    file: "apps/web/features/run-view/run-summary.tsx",
    mustContain: [
      "Cost &amp; tokens",
      "Project task",
      "Operator input",
      "Subagent plan",
      "Run metadata",
      "Errors",
    ],
  },
  {
    name: "run transcript renders Hermes-style inline steps with approvals and live logs",
    file: "apps/web/features/run-view/run-transcript.tsx",
    mustContain: [
      "Hermes-style operator console",
      "Waiting for runtime output",
      "StepFocusPanel",
      "approval",
      "liveReasoning",
      "logs",
    ],
  },
];

const failures: string[] = [];

for (const check of checks) {
  const filePath = path.join(root, check.file);
  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    failures.push(`${check.name}: cannot read ${check.file}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  for (const expected of check.mustContain) {
    if (!content.includes(expected)) {
      failures.push(`${check.name}: ${check.file} is missing "${expected}"`);
    }
  }
}

if (failures.length) {
  console.error("UI structure audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`UI structure audit passed: ${checks.length} surfaces verified.`);
