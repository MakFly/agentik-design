/**
 * Telegram loop simulator — exercises the REAL inbound dispatch + outbound capture
 * without a live bot token.
 *
 *   1. seeds the SMB tenant (idempotent) so the Telegram connection/binding exist
 *   2. sends inbound Updates to the real webhook endpoint (the engine parses commands,
 *      routes to the bound agent, and "replies" — captured to channel_deliveries in dev)
 *   3. drives the run loop (simulate → approve → simulate) so run notifications land
 *   4. prints every outbound delivery (the bot's replies + run notifications)
 *
 * Usage:  bun run apps/engine/scripts/telegram-sim.ts
 * Env:    ENGINE_URL (default http://localhost:8787), TEAM (default demo)
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../src/infra/db/client";

const ENGINE = process.env.ENGINE_URL ?? "http://localhost:8787";
const TEAM = process.env.TEAM ?? "demo";

function devHeaders() {
  return { "content-type": "application/json", "x-team": TEAM, "x-role": "owner" };
}

async function api(path: string, body?: unknown) {
  const res = await fetch(`${ENGINE}/api/v1${path}`, {
    method: "POST",
    headers: devHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({}));
}

async function resolveTeamId(): Promise<string> {
  const [team] = await db
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.slug, TEAM))
    .limit(1);
  if (!team) throw new Error(`team '${TEAM}' not found — start the engine and seed first`);
  return team.id;
}

async function sendInbound(secret: string, chatId: string, text: string) {
  const update = {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      text,
      chat: { id: chatId, type: "private" },
      from: { id: chatId, first_name: "Operator", username: "smb_operator" },
    },
  };
  const res = await fetch(`${ENGINE}/api/v1/channels/telegram/${secret}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(update),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
  console.log(`  → inbound ${JSON.stringify(text)}  (engine ack: ${json.ok ?? res.status})`);
}

async function main() {
  console.log(`Telegram simulator → ${ENGINE} (team=${TEAM})\n`);

  console.log("1) Seeding SMB tenant (idempotent)…");
  const seed = (await api("/dev/seed")) as {
    channel?: { connectionId: string; chatId: string };
  };
  const teamId = await resolveTeamId();

  const [conn] = await db
    .select()
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.teamId, teamId), eq(schema.channelConnections.label, "SMB Ops Bot")))
    .limit(1);
  if (!conn) throw new Error("seeded Telegram connection not found");
  const chatId = seed.channel?.chatId ?? "900900900";

  console.log("\n2) Inbound commands from the operator's Telegram chat:");
  // Pair the chat first so subsequent commands are answered (not "not paired").
  await sendInbound(conn.webhookSecret, chatId, `/start ${conn.pairingCode}`);
  // Custom prompt(s): TELEGRAM_MSG="…" (use ' || ' to send several in sequence),
  // otherwise the default command tour.
  const custom = process.env.TELEGRAM_MSG;
  const messages = custom ? custom.split(" || ") : ["/agents", "/projects", "/tasks"];
  for (const m of messages) await sendInbound(conn.webhookSecret, chatId, m);

  console.log("\n3) Driving the run loop (simulate → approve → simulate)…");
  const pass1 = (await api("/dev/simulate")) as { processed: Array<{ runId: string; status: string }> };
  const waiting = pass1.processed.filter((p) => p.status === "waiting_approval");
  for (const p of waiting) {
    await api(`/runs/${p.runId}/approve`, { reason: "approved via Telegram sim" });
    console.log(`  → approved ${p.runId.slice(0, 14)} (was waiting)`);
  }
  await api("/dev/simulate");

  console.log("\n4) Outbound deliveries the bot produced (replies + run notifications):");
  const deliveries = await db
    .select()
    .from(schema.channelDeliveries)
    .where(eq(schema.channelDeliveries.teamId, teamId))
    .orderBy(desc(schema.channelDeliveries.createdAt))
    .limit(20);
  for (const d of deliveries.reverse()) {
    const payload = d.payload as { chatId?: string; text?: string };
    const text = (payload.text ?? "").replace(/\s+/g, " ").slice(0, 90);
    console.log(`  [${d.kind}/${d.status}] chat ${payload.chatId ?? "-"}: ${text}`);
  }

  console.log(`\n✓ ${deliveries.length} outbound deliveries captured. Telegram loop simulated end-to-end.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("telegram-sim failed:", err);
  process.exit(1);
});
