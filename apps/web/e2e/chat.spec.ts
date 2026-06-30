import { test, expect } from "@playwright/test";

// The conversational surface is the immersive assistant-ui surface (Base) embedded in
// the platform AppShell. On chat the main app nav collapses to an icon rail, there is
// no site topbar, and the Sessions rail is shown. Reverses the "no lite chat page" rule.
test("chat: no site topbar, Sessions rail shown, main nav collapsed", async ({ page }) => {
  await page.goto("/demo/chat");
  // No site header → the command palette search bar is absent.
  await expect(page.getByRole("button", { name: /Search or run a command/i })).toHaveCount(0);
  // The Sessions rail is shown by default.
  await expect(page.getByText("Sessions").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /New Thread/i })).toBeVisible();
  // assistant-ui composer is present.
  await expect(page.getByText(/Send a message/i)).toBeVisible();
});

test("the Sessions rail can be hidden and shown", async ({ page }) => {
  await page.goto("/demo/chat");
  await expect(page.getByRole("button", { name: /New Thread/i })).toBeVisible();
  await page.getByRole("button", { name: /Hide conversations/i }).click();
  await expect(page.getByRole("button", { name: /New Thread/i })).toBeHidden();
  await page.getByRole("button", { name: /Show conversations/i }).click();
  await expect(page.getByRole("button", { name: /New Thread/i })).toBeVisible();
});

test("platform nav exposes a Chat entry point", async ({ page }) => {
  await page.goto("/demo/platform/projects");
  await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();
});
