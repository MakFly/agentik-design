/**
 * Dev/sim capture: a tokenless Telegram connection records would-be outbound to
 * channel_deliveries so the loop is observable without a live bot. DB-guarded.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../../src/infra/db/client";
import { genId } from "../../../src/infra/db/ids";
import { resolveTeam } from "../../../src/domains/workflows/repo";
import { sendTelegramMessage } from "../../../src/domains/channels/telegram/client";

let dbUp = false;
try {
  await db.execute(sql`select 1`);
  dbUp = true;
} catch {
  dbUp = false;
}
if (!dbUp) console.warn("[telegram-sim-capture] no DB reachable - skipping");
const d = dbUp ? describe : describe.skip;

d("tokenless telegram send capture", () => {
  let teamId: string;
  let connectionId: string;

  beforeAll(async () => {
    teamId = await resolveTeam(`itest-tgcap-${Date.now()}`);
    connectionId = genId("chan");
    await db.insert(schema.channelConnections).values({
      id: connectionId,
      teamId,
      provider: "telegram",
      label: "Captureless Bot",
      status: "active",
      webhookSecret: "sec",
      pairingCode: "PAIR1234",
      createdBy: "usr_test",
    });
  });

  test("captures a simulated delivery instead of hitting Telegram", async () => {
    const [connection] = await db
      .select()
      .from(schema.channelConnections)
      .where(eq(schema.channelConnections.id, connectionId));
    await sendTelegramMessage({
      connection: connection!,
      chatId: "12345",
      text: "hello operator",
      replyMarkup: {
        inline_keyboard: [[{ text: "Approuver", callback_data: "run:approve:run_123" }]],
      },
    });

    const deliveries = await db
      .select()
      .from(schema.channelDeliveries)
      .where(and(eq(schema.channelDeliveries.teamId, teamId), eq(schema.channelDeliveries.connectionId, connectionId)));
    expect(deliveries.length).toBe(1);
    expect(deliveries[0]!.status).toBe("simulated");
    expect((deliveries[0]!.payload as { text?: string }).text).toBe("hello operator");
    expect(deliveries[0]!.payload).toMatchObject({
      replyMarkup: {
        inline_keyboard: [[{ text: "Approuver", callback_data: "run:approve:run_123" }]],
      },
    });
  });
});
