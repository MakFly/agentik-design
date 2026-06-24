/**
 * Bot-to-bot relay — Agentik orchestrates a bounded conversation between two
 * agents (each a real run on the daemon). This is the "discuter entre bots" piece
 * that Hermes itself does not do: Hermes connects each bot to a platform
 * (Telegram/Discord) via its gateway; Agentik relays A's reply into B and back,
 * with a hard turn cap so it can't loop forever.
 *
 * Usage (engine + daemon must be up):
 *   ENGINE_URL=http://localhost:8787 TEAM=demo RUNTIME=echo TURNS=4 \
 *     bun run scripts/bot-relay.ts "Bonjour, on parle de quoi ?"
 *
 * Bridge to platforms: point a Hermes gateway at each agent (docs/hermes-gateway.env.example),
 * then a Telegram user talks to Bot A and a Discord user sees Bot B — Agentik relays between them.
 */

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8787";
const TEAM = process.env.TEAM ?? "demo";
const RUNTIME = process.env.RUNTIME ?? "echo";
const TURNS = Number(process.env.TURNS ?? "4");
const SEED = process.argv[2] ?? "Bonjour ! Présente-toi en une phrase.";

const BOTS = [
  { name: "Bot A", instructions: process.env.BOT_A ?? "Tu es Bot A, curieux et concis. Réponds en une phrase et pose une question." },
  { name: "Bot B", instructions: process.env.BOT_B ?? "Tu es Bot B, pragmatique et concis. Réponds en une phrase et relance." },
];

const headers = { "content-type": "application/json", "x-team": TEAM, "x-role": "owner" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run one turn on a bot and return its final textual reply. */
async function ask(bot: { name: string; instructions: string }, input: string): Promise<string> {
  const create = await fetch(`${ENGINE_URL}/api/v1/agents/test`, {
    method: "POST",
    headers,
    body: JSON.stringify({ config: { instructions: bot.instructions, runtimeKind: RUNTIME }, input, runtime: RUNTIME }),
  });
  const { runId } = (await create.json()) as { runId: string };

  // Poll until the run reaches a terminal state, then take the last step's text.
  // Generous budget: a claude turn on a long prompt can take well over a minute.
  for (let i = 0; i < 240; i++) {
    await sleep(750);
    const res = await fetch(`${ENGINE_URL}/api/v1/runs/${runId}`, { headers });
    const detail = (await res.json()) as { run: { status: string; error?: { message: string } }; steps: { summary: string }[] };
    const { status } = detail.run;
    if (["succeeded", "failed", "cancelled", "timed_out"].includes(status)) {
      if (status !== "succeeded") throw new Error(`${bot.name} run ${status}: ${detail.run.error?.message ?? ""}`);
      const last = detail.steps.at(-1);
      return last?.summary ?? "(no reply)";
    }
  }
  throw new Error(`${bot.name} run timed out`);
}

console.log(`\n🤖 Relay — runtime=${RUNTIME}, turns=${TURNS}, team=${TEAM}\n`);
let message = SEED;
console.log(`💬 seed → ${message}\n`);
for (let turn = 0; turn < TURNS; turn++) {
  const bot = BOTS[turn % 2]!;
  const reply = await ask(bot, message);
  console.log(`${turn % 2 === 0 ? "🟦" : "🟩"} ${bot.name}: ${reply}\n`);
  message = reply; // hand this bot's reply to the other bot next turn
}
console.log("✅ relay complete (turn cap reached)\n");
