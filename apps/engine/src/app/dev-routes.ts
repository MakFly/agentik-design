/**
 * Dev/test-only routes. Mounted ONLY when AUTH_DEV_HEADERS is on (never in prod).
 * They let the e2e harness and local workflows drive the product loop without the
 * Go daemon: seed a realistic tenant and advance queued runs via the simulator.
 */
import { Hono } from "hono";
import type { AuthVars } from "./middleware/auth";
import { simulateQueuedRuns } from "../jobs/run-simulator";
import { seedSmbTenant } from "../jobs/seed-smb";

export const devRoutes = new Hono<{ Variables: AuthVars }>();

// Provision a realistic SMB tenant (agents/roster, project, signals+rules, Telegram
// binding, queued demo runs) into the caller's team. Idempotent on structure.
devRoutes.post("/dev/seed", async (c) => {
  const result = await seedSmbTenant(c.get("teamId"), c.get("auth").userId);
  return c.json(result, 201);
});

// Advance every queued run for the team one step (idempotent). Call again after an
// approval to let waiting runs finish (send email, notify, succeed).
devRoutes.post("/dev/simulate", async (c) => {
  const result = await simulateQueuedRuns(c.get("teamId"));
  return c.json(result);
});
