import { test, expect } from "@playwright/test";

// Since the Personal Assistant / Multica platform split, the platform Control Plane nav is
// led by the Command Center dashboard, with Projects directly beneath it.
test("Command Center leads the platform nav, above Projects", async ({ page }) => {
  await page.goto("/demo/platform/projects");

  const command = page.getByRole("link", { name: /Command Center/ }).first();
  const projects = page.getByRole("link", { name: /^Projects$/ }).first();

  await expect(command).toBeVisible();
  await expect(projects).toBeVisible();

  const cBox = await command.boundingBox();
  const pBox = await projects.boundingBox();
  expect(cBox, "Command Center nav link has a box").not.toBeNull();
  expect(pBox, "Projects nav link has a box").not.toBeNull();
  // Visual order: Command Center sits above Projects.
  expect(cBox!.y).toBeLessThan(pBox!.y);
});
