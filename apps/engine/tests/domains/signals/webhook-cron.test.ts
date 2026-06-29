/**
 * Webhook ingestion (token → dispatch) + cron scheduler firing. DB-guarded.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../../../src/infra/db/client";
import { resolveTeam } from "../../../src/infra/tenancy";
import { createSignal } from "../../../src/domains/signals/repo";
import {
  dueScheduledSignals,
  fireDueScheduledSignals,
  ingestSignalWebhook,
} from "../../../src/domains/signals/service";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[webhook-cron] no DB reachable - skipping");
const d = dbUp ? describe : describe.skip;

d("signal webhook ingestion", () => {
  let teamId: string;
  const token = `wht_test_${Date.now()}`;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-wh-${Date.now()}`);
    await createSignal(teamId, {
      name: "Inbound webhook",
      kind: "webhook",
      source: "gmail",
      status: "active",
      config: { webhookToken: token },
    });
  });

  test("valid token dispatches; unknown token is rejected", async () => {
    const ok = await ingestSignalWebhook(token, { label: "invoice" });
    expect(ok).not.toBeNull();
    expect(ok!.deliveries).toBeGreaterThanOrEqual(1);
    expect(await ingestSignalWebhook("wht_does_not_exist", {})).toBeNull();
  });
});

d("cron scheduler firing", () => {
  let teamId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-cron-${Date.now()}`);
    await createSignal(teamId, {
      name: "Always due",
      kind: "schedule",
      source: "cron",
      status: "active",
      config: { cron: "* * * * *" },
    });
    await createSignal(teamId, {
      name: "Never due",
      kind: "schedule",
      source: "cron",
      status: "active",
      config: { cron: "0 0 31 2 *" }, // Feb 31 never exists
    });
  });

  test("only the matching cron signal is due and fires", async () => {
    const now = new Date();
    const due = await dueScheduledSignals(now);
    const names = new Set(due.map((s) => s.name));
    expect(names.has("Always due")).toBe(true);
    expect(names.has("Never due")).toBe(false);

    const fired = await fireDueScheduledSignals(now);
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });
});
