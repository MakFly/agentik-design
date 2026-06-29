import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const authFile = "e2e/.auth/state.json";

/**
 * Dev login as owner@agentik.dev (the demo org owner), exactly like the ghostchrome
 * harness: list dev users → POST /api/v1/auth/login → persist the session cookie as
 * storageState for the test project to reuse.
 */
setup("authenticate dev owner", async ({ request }) => {
  const usersRes = await request.get("/api/v1/auth/dev/users");
  expect(usersRes.ok(), "dev users endpoint must be reachable (dev mode)").toBeTruthy();
  const { items } = (await usersRes.json()) as {
    items: Array<{ email: string; password: string }>;
  };
  const owner = items.find((u) => u.email === "owner@agentik.dev");
  expect(owner, "dev owner@agentik.dev must exist").toBeTruthy();

  const loginRes = await request.post("/api/v1/auth/login", {
    data: { email: owner!.email, password: owner!.password },
  });
  expect(loginRes.ok(), "dev login must succeed").toBeTruthy();

  mkdirSync("e2e/.auth", { recursive: true });
  await request.storageState({ path: authFile });
});
