import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e against a RUNNING stack (web + engine). Set E2E_WEB_URL to point
 * elsewhere; defaults to the dev web origin. Auth is established once via the dev
 * login (auth.setup.ts) and reused through storageState — same flow as the
 * ghostchrome harness, but using the standard @playwright/test runner.
 *
 *   cd apps/web && bunx playwright test
 */
const baseURL = process.env.E2E_WEB_URL ?? "http://localhost:3333";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/state.json" },
      dependencies: ["setup"],
    },
  ],
});
