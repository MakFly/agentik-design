import { describe, expect, test } from "bun:test";
import {
  agentTaskStatus,
  claimedTask,
  daemonRunStatus,
  DAEMON_PATHS,
  mapAgentTaskStatusToRunStatus,
  registerInput,
  run,
} from "./index";

describe("daemonRunStatus", () => {
  test("maps completed → succeeded", () => {
    expect(mapAgentTaskStatusToRunStatus("completed")).toBe("succeeded");
    expect(daemonRunStatus("completed")).toBe("succeeded");
  });

  test("maps dispatched → queued", () => {
    expect(daemonRunStatus("dispatched")).toBe("queued");
  });

  test("accepts all agent task statuses", () => {
    for (const status of agentTaskStatus.options) {
      expect(typeof daemonRunStatus(status)).toBe("string");
    }
  });
});

describe("run schema", () => {
  test("accepts workflow executor", () => {
    const row = run.parse({
      id: "run_1",
      teamId: "team_1",
      executor: "workflow",
      workflowId: "wf_1",
      versionId: "ver_1",
      status: "running",
      trigger: "manual",
      payload: null,
      error: null,
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: null,
      durationMs: null,
    });
    expect(row.executor).toBe("workflow");
  });

  test("accepts daemon executor with agent fields", () => {
    const row = run.parse({
      id: "atask_1",
      teamId: "team_1",
      executor: "daemon",
      workflowId: null,
      versionId: null,
      status: "queued",
      trigger: "api",
      payload: null,
      error: null,
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: null,
      durationMs: null,
      agentId: "agt_1",
      projectId: "prj_1",
      priority: 0,
      kind: "chat",
      attempt: 1,
    });
    expect(row.agentId).toBe("agt_1");
  });
});

describe("daemon-protocol", () => {
  test("defines 18 endpoint paths", () => {
    expect(Object.keys(DAEMON_PATHS)).toHaveLength(18);
  });

  test("parses register input", () => {
    const input = registerInput.parse({
      name: "dev-box",
      team: "acme",
      runtimes: [{ kind: "claude" }],
    });
    expect(input.runtimes).toHaveLength(1);
  });

  test("parses claimed task", () => {
    const task = claimedTask.parse({
      id: "atask_1",
      teamId: "team_1",
      agentId: "agt_1",
      kind: "direct",
      input: { prompt: "hi" },
      workDir: "/work/atask_1",
    });
    expect(task.workDir).toBe("/work/atask_1");
  });
});
