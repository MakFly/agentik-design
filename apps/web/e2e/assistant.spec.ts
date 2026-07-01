import { test, expect } from "@playwright/test";

/**
 * Assistant surface must be cleanly separated from the platform: navigating within the
 * assistant never dumps the user into /platform/* (the builder, which needs a runtime).
 * These are deterministic (no LLM) — they assert routing, labels and settings presence.
 */

test("agents surface is iso with the platform, but edits stay on the assistant", async ({
  page,
}) => {
  await page.goto("/demo/assistant/agents");
  // Same registry table as the platform, but its create entry point stays on the assistant.
  await expect(page.getByRole("link", { name: /Nouvel agent/i })).toHaveAttribute(
    "href",
    "/demo/assistant/agents/new",
  );
  // Opening an agent from the table stays on the assistant surface (never routes into /platform).
  await page.getByRole("cell", { name: "main" }).first().click();
  await expect(page).toHaveURL(/\/demo\/assistant\/agents\/[^/]+$/);
  expect(page.url()).not.toContain("/platform/");
});

test("assistant agent switcher shows an API agent as ready (not 'no runtime')", async ({ page }) => {
  await page.goto("/demo/assistant/chat");
  // main runs on the openai API runtime → the switcher shows "openai · ready" via the gateway,
  // even with the daemon stopped (previously it wrongly said "no runtime").
  await expect(page.getByText(/openai · ready/i).first()).toBeVisible();
});

test("settings live on the assistant surface at /{team}/settings", async ({ page }) => {
  await page.goto("/demo/assistant/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Providers" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Account" })).toBeVisible();
  // Assistant shell, not platform: no platform-only "Command Center" nav here.
  await expect(page.getByRole("link", { name: "Command Center" })).toHaveCount(0);
});

test("assistant sidebar exposes its own groups + a single bridge to the platform", async ({
  page,
}) => {
  await page.goto("/demo/assistant/chat");
  // Assistant nav groups.
  for (const label of ["Agents", "Skills", "Memory", "Settings"]) {
    await expect(page.getByRole("link", { name: label }).first()).toBeVisible();
  }
  // Exactly one explicit bridge into the platform.
  await expect(page.getByRole("link", { name: /Multica platform/i })).toBeVisible();
});
