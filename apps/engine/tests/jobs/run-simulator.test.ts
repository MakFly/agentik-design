/**
 * Run simulator end-to-end: queued → waiting_approval → (approve) → succeeded,
 * with a real email delivered to infra-mailpit. Skips when DB or Mailpit is down.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../src/infra/db/client";
import { genId } from "../../src/infra/db/ids";
import { resolveTeam } from "../../src/domains/workflows/repo";
import { approveRun } from "../../src/domains/runs/controls";
import { listRunEvents } from "../../src/domains/runs/repo";
import { processRun } from "../../src/jobs/run-simulator";

const MAILPIT_API = process.env.MAILPIT_API ?? "http://localhost:8025";

interface MailpitSearch {
  messages_count?: number;
  total?: number;
  messages?: unknown[];
}
async function mailpitSearch(query: string): Promise<number> {
  const res = (await fetch(
    `${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(query)}`,
  ).then((r) => r.json())) as MailpitSearch;
  return res.messages_count ?? res.total ?? res.messages?.length ?? 0;
}

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
if (!dbUp || !mailpitUp) {
  console.warn(`[run-simulator] skipping (db=${dbUp} mailpit=${mailpitUp})`);
}
const d = dbUp && mailpitUp ? describe : describe.skip;

d("run simulator approval + mailpit send", () => {
  let teamId: string;
  let runId: string;
  const subject = `Invoice reminder ${Date.now()}`;
  const to = `client-${Date.now()}@smb.test`;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-sim-${Date.now()}`);
    runId = genId("run");
    await db.insert(schema.runs).values({
      id: runId,
      teamId,
      executor: "daemon",
      status: "queued",
      kind: "chat",
      input: {
        prompt: "Send the invoice reminder",
        simulate: {
          requireApproval: true,
          steps: ["Reviewed the overdue invoice.", "Drafted a polite reminder."],
          email: { to, subject, text: "Your invoice #42 is overdue. Please settle at your earliest convenience." },
        },
      },
    });
  });

  test("first pass halts at waiting_approval (no email yet)", async () => {
    expect(await processRun(teamId, runId)).toBe("waiting_approval");
    const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
    expect(run!.status).toBe("waiting_approval");
    // Email must NOT have been sent before approval.
    expect(await mailpitSearch(subject)).toBe(0);
  });

  test("approve → second pass sends the email and succeeds", async () => {
    expect(await approveRun(teamId, runId)).toBe(true);
    expect(await processRun(teamId, runId)).toBe("succeeded");

    const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
    expect(run!.status).toBe("succeeded");

    // V2 ledger captured the email.send tool call.
    const events = await listRunEvents(teamId, runId);
    expect(events!.some((e) => e.toolCallId !== null || e.type === "tool_call")).toBe(true);

    // The email actually landed in Mailpit.
    expect(await mailpitSearch(subject)).toBeGreaterThan(0);
  });

  test("re-processing a finished run is a no-op", async () => {
    expect(await processRun(teamId, runId)).toBe("succeeded");
  });
});
