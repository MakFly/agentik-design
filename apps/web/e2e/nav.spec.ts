import { test, expect } from "@playwright/test";

// Phase 2 — North Star recentering: Projects is the center of the product, so it
// must lead the Control Plane nav ahead of the Command Center dashboard.
test("Projects leads the sidebar nav, above Command Center", async ({ page }) => {
  await page.goto("/demo/projects");

  const projects = page.getByRole("link", { name: /^Projects$/ }).first();
  const command = page.getByRole("link", { name: /Command Center/ }).first();

  await expect(projects).toBeVisible();
  await expect(command).toBeVisible();

  const pBox = await projects.boundingBox();
  const cBox = await command.boundingBox();
  expect(pBox, "Projects nav link has a box").not.toBeNull();
  expect(cBox, "Command Center nav link has a box").not.toBeNull();
  // Visual order: Projects sits above Command Center.
  expect(pBox!.y).toBeLessThan(cBox!.y);
});
