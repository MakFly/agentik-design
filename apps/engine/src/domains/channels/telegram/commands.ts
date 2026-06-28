function cleanArg(value: string) {
  return value
    .trim()
    .replace(/^["“]|["”]$/g, "")
    .trim();
}

function normalizeAgentHandle(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export type TelegramCommand =
  | { kind: "help" }
  | { kind: "pair"; code: string }
  | { kind: "agents" }
  | { kind: "projects" }
  | { kind: "tasks"; projectId?: string }
  | { kind: "agentMode"; handle?: string; agentId?: string; off?: boolean }
  | { kind: "run"; projectId: string; agentId?: string; title: string }
  | { kind: "runAgent"; agentId: string; input: string }
  | { kind: "runAgentHandle"; handle: string; input: string }
  | { kind: "orchestrate"; input: string }
  | { kind: "freeChat"; input: string }
  | { kind: "runTask"; taskId: string; instruction?: string }
  | { kind: "runHelp"; text?: string }
  | { kind: "status"; runId: string }
  | { kind: "kill"; runId: string }
  | { kind: "pause"; runId: string; reason?: string }
  | { kind: "resume"; runId: string; reason?: string }
  | { kind: "approve"; runId: string; reason?: string }
  | { kind: "reject"; runId: string; reason?: string }
  | { kind: "learn"; projectId?: string; content: string }
  | { kind: "unknown"; text: string };

export function parseTelegramCommand(text: string): TelegramCommand {
  const clean = text.trim();
  if (!clean || clean === "/help") return { kind: "help" };
  const start = clean.match(/^\/start(?:\s+(.+))?$/);
  if (start) return { kind: "pair", code: (start[1] ?? "").trim() };
  if (clean === "/projects") return { kind: "projects" };
  if (clean === "/agents") return { kind: "agents" };
  if (clean === "/agent") return { kind: "agentMode" };
  if (/^\/agent\s+(off|stop|none)$/i.test(clean)) return { kind: "agentMode", off: true };
  const agentModeHandle = clean.match(/^\/agent\s+@([a-zA-Z0-9_]+)$/);
  if (agentModeHandle?.[1]) {
    return { kind: "agentMode", handle: normalizeAgentHandle(agentModeHandle[1]) };
  }
  const agentModeId = clean.match(/^\/agent\s+agent:([^\s]+)$/);
  if (agentModeId?.[1]) return { kind: "agentMode", agentId: agentModeId[1] };
  const tasks = clean.match(/^\/tasks(?:\s+project:([^\s]+))?$/);
  if (tasks) return { kind: "tasks", projectId: tasks[1] };
  if (clean === "/run") return { kind: "runHelp" };
  const orchestrate = clean.match(/^\/orchestrate\s+([\s\S]+)$/);
  if (orchestrate?.[1]) {
    return { kind: "orchestrate", input: cleanArg(orchestrate[1]) };
  }
  const status = clean.match(/^\/status\s+([^\s]+)$/);
  if (status?.[1]) return { kind: "status", runId: status[1] };
  const kill = clean.match(/^\/kill\s+([^\s]+)$/);
  if (kill?.[1]) return { kind: "kill", runId: kill[1] };
  const pause = clean.match(/^\/pause\s+([^\s]+)(?:\s+([\s\S]+))?$/);
  if (pause?.[1])
    return {
      kind: "pause",
      runId: pause[1],
      reason: pause[2] ? cleanArg(pause[2]) : undefined,
    };
  const resume = clean.match(/^\/resume\s+([^\s]+)(?:\s+([\s\S]+))?$/);
  if (resume?.[1])
    return {
      kind: "resume",
      runId: resume[1],
      reason: resume[2] ? cleanArg(resume[2]) : undefined,
    };
  const approve = clean.match(/^\/approve\s+([^\s]+)(?:\s+([\s\S]+))?$/);
  if (approve?.[1])
    return {
      kind: "approve",
      runId: approve[1],
      reason: approve[2] ? cleanArg(approve[2]) : undefined,
    };
  const reject = clean.match(/^\/reject\s+([^\s]+)(?:\s+([\s\S]+))?$/);
  if (reject?.[1])
    return {
      kind: "reject",
      runId: reject[1],
      reason: reject[2] ? cleanArg(reject[2]) : undefined,
    };
  const learn = clean.match(/^\/learn(?:\s+project:([^\s]+))?\s+([\s\S]+)$/);
  if (learn)
    return {
      kind: "learn",
      projectId: learn[1],
      content: cleanArg(learn[2] ?? ""),
    };
  const runTask = clean.match(/^\/run\s+task:([^\s]+)(?:\s+([\s\S]+))?$/);
  if (runTask?.[1]) {
    return {
      kind: "runTask",
      taskId: runTask[1],
      instruction: runTask[2] ? cleanArg(runTask[2]) : undefined,
    };
  }
  const runAgentMatch = clean.match(/^\/run\s+agent:([^\s]+)\s+([\s\S]+)$/);
  if (runAgentMatch?.[1]) {
    return {
      kind: "runAgent",
      agentId: runAgentMatch[1],
      input: cleanArg(runAgentMatch[2] ?? ""),
    };
  }
  const runAgentHandleMatch = clean.match(/^\/run\s+@([a-zA-Z0-9_]+)\s+([\s\S]+)$/);
  if (runAgentHandleMatch?.[1]) {
    return {
      kind: "runAgentHandle",
      handle: normalizeAgentHandle(runAgentHandleMatch[1]),
      input: cleanArg(runAgentHandleMatch[2] ?? ""),
    };
  }
  const directAgentHandleMatch = clean.match(/^@([a-zA-Z0-9_]+)\s+([\s\S]+)$/);
  if (directAgentHandleMatch?.[1]) {
    return {
      kind: "runAgentHandle",
      handle: normalizeAgentHandle(directAgentHandleMatch[1]),
      input: cleanArg(directAgentHandleMatch[2] ?? ""),
    };
  }
  const run = clean.match(
    /^\/run\s+project:([^\s]+)(?:\s+agent:([^\s]+))?\s+([\s\S]+)$/,
  );
  if (run) {
    return {
      kind: "run",
      projectId: run[1]!,
      agentId: run[2],
      title: cleanArg(run[3] ?? ""),
    };
  }
  // Free-form natural language (no leading slash) routes to the orchestrator,
  // even when it mentions run-like words. The run-help nudge below only applies
  // to a slash-prefixed command that failed to parse but looks run-related.
  if (!clean.startsWith("/")) {
    return { kind: "freeChat", input: clean };
  }
  if (/\b(agent|agents|lance|lancer|lances|run|ex[eé]cute|start)\b/i.test(clean)) {
    return { kind: "runHelp", text: clean };
  }
  return { kind: "unknown", text: clean };
}
