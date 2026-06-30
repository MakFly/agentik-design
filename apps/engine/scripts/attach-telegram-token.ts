/**
 * Attach a Telegram bot token to an existing channel connection and switch it to
 * live polling — so a bot created in BotFather actually drives the agent. Reuses the
 * connection's existing bindings/identities/pairing (no re-pairing needed).
 *
 * The token is read from the environment and never printed.
 *
 * Usage:
 *   BOT_TOKEN="<botfather-token>" bun run apps/engine/scripts/attach-telegram-token.ts
 * Env:
 *   BOT_TOKEN  (required)  the BotFather token (e.g. 123456:ABC...)
 *   TEAM       (default demo)
 *   LABEL      (optional)  connection label to target; else the team's first Telegram connection
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/infra/db/client";
import { encryptJson } from "../src/infra/crypto";
import { useTelegramPolling } from "../src/domains/channels/repo";

const TEAM = process.env.TEAM ?? "demo";
const LABEL = process.env.LABEL;
const token = process.env.BOT_TOKEN?.trim();

async function main() {
  if (!token) throw new Error("BOT_TOKEN env is required (and is never printed)");

  const [team] = await db
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.slug, TEAM))
    .limit(1);
  if (!team) throw new Error(`team '${TEAM}' not found`);

  const conns = await db
    .select()
    .from(schema.channelConnections)
    .where(
      and(
        eq(schema.channelConnections.teamId, team.id),
        eq(schema.channelConnections.provider, "telegram"),
      ),
    );
  const conn = LABEL ? conns.find((c) => c.label === LABEL) : conns[0];
  if (!conn) throw new Error(`no Telegram connection found for team '${TEAM}'${LABEL ? ` with label '${LABEL}'` : ""}`);

  // Store the encrypted token on the existing connection (keeps bindings/identities).
  await db
    .update(schema.channelConnections)
    .set({ botTokenEncrypted: encryptJson({ token }) })
    .where(eq(schema.channelConnections.id, conn.id));

  // Validate via getMe, deleteWebhook, sync commands, mark active + polling.
  const res = await useTelegramPolling(team.id, conn.id);
  if (!res.ok) throw new Error(`polling activation failed: ${res.error}`);

  console.log(`✅ Telegram live for connection ${conn.id} (label="${conn.label}")`);
  console.log(`   bot: @${res.botUsername ?? "?"} · transport=polling · status=active`);
  if (res.commandSyncError) console.log(`   ⚠ command sync: ${res.commandSyncError}`);
  console.log(`   The running engine poller will now pull updates for this bot.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("attach-telegram-token failed:", (err as Error).message);
  process.exit(1);
});
