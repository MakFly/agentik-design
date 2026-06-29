import { test, expect } from "@playwright/test";

// Phase 0 — the Runtimes surface was (correctly) KEPT: its infra is wired into the
// daemon-status indicator and agent-builder. This guards against regressing it back
// into the dead-code removal.
test("Runtimes page renders with the connect entry point", async ({ page }) => {
  await page.goto("/demo/runtimes");
  await expect(page.getByRole("heading", { name: "Runtimes" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Add a computer/i }).first(),
  ).toBeVisible();
});
