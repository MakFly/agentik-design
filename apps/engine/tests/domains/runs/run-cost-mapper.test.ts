import { describe, expect, test } from "bun:test";
import {
  daemonRunToWeb,
  orchestrationRunToWeb,
  runCostFromRow,
} from "../../../src/domains/runs/mappers";

describe("runCostFromRow", () => {
  test("maps Claude-style token usage and total cost", () => {
    expect(
      runCostFromRow({
        result: {
          usage: { input_tokens: 1200, output_tokens: 345 },
          total_cost_usd: 0.083,
        },
        costCents: null,
      }),
    ).toEqual({
      tokens: { input: 1200, output: 345, total: 1545 },
      money: { amountCents: 8, currency: "USD" },
    });
  });

  test("maps provider-style total token usage when input and output are absent", () => {
    expect(
      runCostFromRow({
        result: {
          usage: { total_tokens: 5000 },
          costUsd: 0.12,
        },
        costCents: null,
      }),
    ).toEqual({
      tokens: { input: 0, output: 0, total: 5000 },
      money: { amountCents: 12, currency: "USD" },
    });
  });

  test("keeps persisted cents as fallback when the result has no usage", () => {
    expect(
      runCostFromRow({
        result: { result: "done" },
        costCents: 77,
      }),
    ).toEqual({
      tokens: { input: 0, output: 0, total: 0 },
      money: { amountCents: 77, currency: "USD" },
    });
  });
});

describe("run web mappers", () => {
  test("does not expose startedAt before a queued daemon run starts", () => {
    const run = daemonRunToWeb({
      id: "run_queued",
      teamId: "team_1",
      agentId: "agt_1",
      projectTaskId: null,
      workflowId: null,
      versionId: null,
      trigger: "manual",
      status: "queued",
      kind: "chat",
      input: { prompt: "wait for a daemon" },
      result: null,
      error: null,
      completedSteps: 0,
      stepCount: 0,
      costCents: null,
      chatSessionId: null,
      parentRunId: null,
      projectId: null,
      createdBy: "usr_test",
      startedAt: "2026-06-29T10:00:00.000Z",
      endedAt: null,
      durationMs: null,
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    } as never);

    expect(run.startedAt).toBeNull();
  });

  test("keeps daemon run input visible for the operator console", () => {
    const run = daemonRunToWeb({
      id: "run_telegram",
      teamId: "team_1",
      agentId: "agt_1",
      projectTaskId: null,
      workflowId: null,
      versionId: null,
      trigger: "api",
      status: "running",
      kind: "chat",
      input: {
        prompt: [
          "résume ce fichier",
          'Pièces jointes Telegram : document "notes.md" text/markdown 128o.',
          'Aperçu du fichier "notes.md" :',
          "- Répondre avant vendredi",
        ].join("\n"),
      },
      result: null,
      error: null,
      completedSteps: 0,
      stepCount: 1,
      costCents: null,
      chatSessionId: null,
      parentRunId: null,
      projectId: null,
      createdBy: "usr_test",
      startedAt: "2026-06-29T10:00:00.000Z",
      endedAt: null,
      durationMs: null,
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    } as never);

    expect(run.input).toMatchObject({
      prompt: expect.stringContaining("Pièces jointes Telegram"),
    });
  });

  test("keeps orchestration input visible for the operator console", () => {
    const run = orchestrationRunToWeb({
      id: "run_orch",
      teamId: "team_1",
      agentId: null,
      projectTaskId: null,
      workflowId: null,
      versionId: null,
      trigger: "manual",
      status: "running",
      kind: "orchestration",
      input: {
        orchestration: {
          goal: "Research puis implémenter",
          steps: [],
        },
      },
      result: null,
      error: null,
      completedSteps: 0,
      stepCount: 1,
      costCents: null,
      chatSessionId: null,
      parentRunId: null,
      projectId: null,
      createdBy: "usr_test",
      startedAt: "2026-06-29T10:00:00.000Z",
      endedAt: null,
      durationMs: null,
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    } as never);

    expect(run.input).toMatchObject({
      orchestration: { goal: "Research puis implémenter" },
    });
    expect(run.subjectName).toBe("Research puis implémenter");
  });
});
