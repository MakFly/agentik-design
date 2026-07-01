import { test, expect } from "@playwright/test";

// The conversational surface is the immersive assistant-ui surface (Base) embedded in
// the platform AppShell. On chat the main app nav collapses to an icon rail, there is
// no site topbar, and the Sessions rail is shown. Reverses the "no lite chat page" rule.
test("chat: no site topbar, Sessions rail shown, main nav collapsed", async ({ page }) => {
  await page.goto("/demo/assistant/chat");
  // No site header → the command palette search bar is absent.
  await expect(page.getByRole("button", { name: /Search or run a command/i })).toHaveCount(0);
  // The Sessions rail is shown by default.
  await expect(page.getByText("Sessions").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /New Thread/i })).toBeVisible();
  // assistant-ui composer is present.
  await expect(page.getByText(/Send a message/i)).toBeVisible();
});

test("the Sessions rail can be hidden and shown", async ({ page }) => {
  await page.goto("/demo/assistant/chat");
  // Toggle the Sessions rail: Hide → the control flips to Show, and back.
  await expect(page.getByRole("button", { name: /Hide conversations/i })).toBeVisible();
  await page.getByRole("button", { name: /Hide conversations/i }).click();
  await expect(page.getByRole("button", { name: /Show conversations/i })).toBeVisible();
  await page.getByRole("button", { name: /Show conversations/i }).click();
  await expect(page.getByRole("button", { name: /Hide conversations/i })).toBeVisible();
});

test("platform nav bridges back to the Assistant surface", async ({ page }) => {
  await page.goto("/demo/platform/projects");
  // The platform sidebar links back to the personal assistant (renamed from "Chat").
  await expect(page.getByRole("link", { name: "Assistant" })).toBeVisible();
});
