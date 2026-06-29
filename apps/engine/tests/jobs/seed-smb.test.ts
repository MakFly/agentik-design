/**
 * SMB seeder + full loop integration: seed → simulate → approve → simulate, with a
 * real mailpit email, plus idempotency and signal condition-gating. Skips when DB or
 * Mailpit is unavailable.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../src/infra/db/client";
import { resolveTeam } from "../../src/domains/workflows/repo";
import { approveRun } from "../../src/domains/runs/controls";
import { simulateQueuedRuns } from "../../src/jobs/run-simulator";
import { seedSmbTenant } from "../../src/jobs/seed-smb";
import { dispatchSignal } from "../../src/domains/signals/service";
import { resolveMemoryInjectionPreview } from "../../src/domains/learning";

const MAILPIT_API = process.env.MAILPIT_API ?? "http://localhost:8025";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
let mailpitUp = false;
try {
  mailpitUp = (await fetch(`${MAILPIT_API}/api/v1/messages?limit=1`)).ok;
} catch {
  mailpitUp = false;
}
if (!dbUp || !mailpitUp) console.warn(`[seed-smb] skipping (db=${dbUp} mailpit=${mailpitUp})`);
const d = dbUp && mailpitUp ? describe : describe.skip;

d("SMB seeder + daily-execution loop", () => {
  let teamId: string;
  let seed: Awaited<ReturnType<typeof seedSmbTenant>>;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-seed-${Date.now()}`);
    seed = await seedSmbTenant(teamId, "usr_test");
  });

  test("provisions the full data model", () => {
    expect(Object.keys(seed.agents)).toHaveLength(4);
    expect(seed.taskIds).toHaveLength(3);
    expect(seed.signalIds).toHaveLength(3);
    // 2 historical Inbox Triage runs + 2 approval-gated queued runs (invoice, meeting).
    expect(seed.runIds).toHaveLength(4);
    expect(seed.channel.connectionId).toBeTruthy();
    expect(seed.gmailWebhookToken).toStartWith("wht_");
  });

  test("seeds Hermes memory and injectable skills", async () => {
    const memoryCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.memoryEntries)
      .where(eq(schema.memoryEntries.teamId, teamId));
    const skillCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.skills)
      .where(eq(schema.skills.teamId, teamId));
    expect(memoryCount[0]!.n).toBeGreaterThanOrEqual(4);
    expect(skillCount[0]!.n).toBeGreaterThanOrEqual(2);

    const preview = await resolveMemoryInjectionPreview(teamId, seed.agents["Billing Chaser"]!);
    expect(preview?.memories.length).toBeGreaterThan(0);
    expect(preview?.skills.some((skill) => skill.name === "Relance facture approuvee")).toBe(true);
  });

  test("simulate → approve → simulate completes every run and sends the invoice email", async () => {
    const pass1 = await simulateQueuedRuns(teamId);
    const waiting = pass1.processed.filter((p) => p.status === "waiting_approval");
    expect(waiting.length).toBe(2); // invoice + meeting need approval

    // Inbox Triage is seeded as history (succeeded) — not claimed/driven by the simulator.
    const triageRuns = await db
      .select()
      .from(schema.runs)
      .where(and(eq(schema.runs.teamId, teamId), eq(schema.runs.projectTaskId, seed.taskIds[0]!)));
    expect(triageRuns.length).toBe(2);
    expect(triageRuns.every((r) => r.status === "succeeded")).toBe(true);

    for (const p of waiting) expect(await approveRun(teamId, p.runId)).toBe(true);
    const pass2 = await simulateQueuedRuns(teamId);
    expect(pass2.processed.every((p) => p.status === "succeeded")).toBe(true);

    const runs = await db.select().from(schema.runs).where(eq(schema.runs.teamId, teamId));
    expect(runs.every((r) => r.status === "succeeded")).toBe(true);

    // Telegram notifications recorded (the invoice run notifies after approval;
    // triage is historical and no longer notifies during the loop).
    const deliveries = await db
      .select()
      .from(schema.channelDeliveries)
      .where(eq(schema.channelDeliveries.teamId, teamId));
    expect(deliveries.length).toBeGreaterThanOrEqual(1);

    // The invoice reminder reached Mailpit.
    const found = (await fetch(
      `${MAILPIT_API}/api/v1/search?query=${encodeURIComponent("invoice #42")}`,
    ).then((r) => r.json())) as { messages_count?: number; total?: number };
    expect(found.messages_count ?? found.total ?? 0).toBeGreaterThan(0);
  });

  test("is idempotent on structure (re-seed does not duplicate agents/project)", async () => {
    const again = await seedSmbTenant(teamId, "usr_test");
    expect(again.projectId).toBe(seed.projectId);
    const agentCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.agents)
      .where(eq(schema.agents.teamId, teamId));
    expect(agentCount[0]!.n).toBe(4);
  });

  test("signal rule condition gating: matching fires, non-matching is ignored", async () => {
    const gmailSignalId = seed.signalIds[0]!; // "Gmail — new message"
    const matched = await dispatchSignal(teamId, gmailSignalId, {
      payload: { label: "invoice", subject: "Invoice #42 overdue" },
    });
    const ignored = await dispatchSignal(teamId, gmailSignalId, {
      payload: { label: "newsletter", subject: "Weekly digest" },
    });
    // Matching payload → the rule was evaluated and acted on (not "ignored").
    expect(matched!.deliveries.some((x) => x.ruleId && x.status !== "ignored")).toBe(true);
    // Non-matching payload → recorded as condition_unmet / ignored.
    expect(ignored!.deliveries.every((x) => x.status === "ignored")).toBe(true);
  });
});
