import { describe, expect, test } from "vitest";
import { summarizeOrchestrationPlan, summarizeRunInput } from "./run-summary";

describe("summarizeRunInput", () => {
  test("extracts Telegram attachment context from a run prompt", () => {
    const summary = summarizeRunInput({
      prompt: [
        "résume ce fichier",
        "Pièces jointes Telegram : document \"notes.md\" text/markdown 128o.",
        'Fichier Telegram disponible : document "notes.md".',
        'Aperçu du fichier "notes.md" :',
        "# Brief client",
        "- Répondre avant vendredi",
        "Utilise le contenu extrait ci-dessus quand il est pertinent.",
      ].join("\n"),
    });

    expect(summary).toEqual({
      source: "Telegram",
      preview: "résume ce fichier",
      attachments: 'document "notes.md" text/markdown 128o. · 1 preview',
    });
  });

  test("summarizes orchestration input by goal", () => {
    expect(
      summarizeRunInput({
        orchestration: { goal: "Research puis implémenter" },
      }),
    ).toEqual({
      source: "Orchestration",
      preview: "Research puis implémenter",
    });
  });
});

describe("summarizeOrchestrationPlan", () => {
  test("extracts ordered subagent steps with child run links", () => {
    expect(
      summarizeOrchestrationPlan({
        orchestration: {
          goal: "Research puis implémenter",
          steps: [
            {
              index: 1,
              agentName: "Code Implementer",
              prompt: "Implémenter le patch",
              status: "pending",
            },
            {
              index: 0,
              agentName: "Researcher",
              prompt: "Trouver la solution",
              status: "succeeded",
              childRunId: "run_child_1",
            },
          ],
        },
      }),
    ).toEqual({
      goal: "Research puis implémenter",
      total: 2,
      completed: 1,
      steps: [
        {
          index: 0,
          agentName: "Researcher",
          prompt: "Trouver la solution",
          status: "succeeded",
          childRunId: "run_child_1",
        },
        {
          index: 1,
          agentName: "Code Implementer",
          prompt: "Implémenter le patch",
          status: "pending",
        },
      ],
    });
  });
});
