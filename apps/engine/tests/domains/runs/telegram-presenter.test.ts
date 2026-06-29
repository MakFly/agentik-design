import { describe, expect, test } from "bun:test";
import {
  formatRunApprovalForTelegram,
  formatRunCompletionForTelegram,
  formatRunFailureForTelegram,
  formatRunProgressForTelegram,
  runApprovalTelegramActions,
} from "../../../src/domains/runs/telegram-presenter";

describe("Telegram run presenter", () => {
  test("presents Gmail send completion as an agent response", () => {
    const formatted = formatRunCompletionForTelegram({
      ok: true,
      skill: "gmail.send",
      result: "raw transport detail",
      email: {
        to: "operator@example.test",
        subject: "Test",
        transport: "gmail",
        delivered: true,
      },
    });

    expect(formatted.includeLink).toBe(false);
    expect(formatted.text).toContain("Email envoyé.");
    expect(formatted.text).toContain("À : operator@example.test");
    expect(formatted.text).toContain("Objet : Test");
    expect(formatted.text).toContain("Canal : Gmail");
    expect(formatted.text).not.toContain("Run completed");
    expect(formatted.text).not.toContain("raw transport detail");
  });

  test("presents Gmail read completion as a compact inbox summary", () => {
    const formatted = formatRunCompletionForTelegram({
      ok: true,
      skill: "gmail.read",
      result: "raw inbox markdown",
      emails: [
        {
          subject: "Token GitHub bientôt expiré",
          fromName: "GitHub",
          snippet: "Your personal access token is about to expire.",
        },
        {
          subject: "Nouvelle opportunité",
          fromName: "Collective",
          snippet: "Un brief projet vient d'arriver.",
        },
      ],
    });

    expect(formatted.includeLink).toBe(false);
    expect(formatted.text).toContain("J'ai trouvé 2 emails récents.");
    expect(formatted.text).toContain("À traiter :");
    expect(formatted.text).toContain("Token GitHub bientôt expiré");
    expect(formatted.text).toContain("Le point à regarder en premier");
    expect(formatted.text).not.toContain("Run completed");
    expect(formatted.text).not.toContain("raw inbox markdown");
  });

  test("falls back to a linked generic run summary for unknown results", () => {
    const formatted = formatRunCompletionForTelegram({ result: "Task completed." });

    expect(formatted.includeLink).toBe(true);
    expect(formatted.text).toBe("J'ai terminé ce run.\nRésumé : Task completed.");
  });

  test("presents echo runtime completion without raw JSON", () => {
    const formatted = formatRunCompletionForTelegram({
      echo: "Chase overdue invoice #42 — draft and (after approval) send the reminder.",
      ok: true,
    });

    expect(formatted.includeLink).toBe(true);
    expect(formatted.text).toContain("J'ai terminé la tâche.");
    expect(formatted.text).toContain("Résultat : Chase overdue invoice #42");
    expect(formatted.text).toContain("traces d'exécution");
    expect(formatted.text).not.toContain('{"echo"');
    expect(formatted.text).not.toContain('"ok":true');
  });

  test("presents progress as a compact agent status", () => {
    const text = formatRunProgressForTelegram({
      completedSteps: 2,
      stepCount: 5,
      latest: "Completed web.search · OpenClaw Telegram agent channel orchestration",
    });

    expect(text).toContain("Je suis dessus.");
    expect(text).toContain("2/5 étapes terminées.");
    expect(text).toContain("Dernière action : Étape terminée : OpenClaw Telegram agent channel orchestration");
    expect(text).not.toContain("Completed web.search");
    expect(text).not.toContain("Run progress");
    expect(text).not.toContain("steps completed");
  });

  test("presents echo search progress without leaking tool internals", () => {
    const text = formatRunProgressForTelegram({
      completedSteps: 1,
      stepCount: 3,
      latest: "Completed search · Chase overdue invoice #42 — draft and (after approval) send the reminder.",
    });

    expect(text).toContain("Je suis dessus.");
    expect(text).toContain("1/3 étapes terminées.");
    expect(text).toContain("Dernière action : Contexte vérifié : Chase overdue invoice #42");
    expect(text).not.toContain("Completed search");
    expect(text).not.toContain("draft and (after approval)");
  });

  test("presents approval requests with Telegram control commands", () => {
    const formatted = formatRunApprovalForTelegram("run_123", "Send email to lead@example.test?");

    expect(formatted.includeLink).toBe(true);
    expect(formatted.text).toContain("J'ai besoin de ton accord");
    expect(formatted.text).toContain("Action : Send email to lead@example.test?");
    expect(formatted.text).toContain("/approve run_123 ok");
    expect(formatted.text).toContain("/reject run_123 raison");
    expect(formatted.text).not.toContain("Approval requested");
    expect(runApprovalTelegramActions("run_123")).toEqual({
      inline_keyboard: [
        [
          { text: "Approuver", callback_data: "run:approve:run_123" },
          { text: "Refuser", callback_data: "run:reject:run_123" },
        ],
      ],
    });
  });

  test("presents failures without raw run-system phrasing", () => {
    const formatted = formatRunFailureForTelegram("SMTP rejected with 554 relay denied");

    expect(formatted.includeLink).toBe(true);
    expect(formatted.text).toContain("Je me suis arrêté sur une erreur.");
    expect(formatted.text).toContain("Raison : SMTP rejected with 554 relay denied");
    expect(formatted.text).toContain("Le détail est dans le run.");
    expect(formatted.text).not.toContain("Run failed");
  });
});
