/**
 * Assistant proof cases — five concrete, end-to-end scenarios run against the LIVE
 * engine (same HTTP surface the web chat uses), proving the Personal Assistant is a
 * real OpenClaw/Hermes-style assistant rather than a demo shell:
 *
 *   1. Streaming chat round-trip  — real LLM turn streamed in-process (OpenAI key).
 *   2. Multi-turn context         — a follow-up resolves against prior turns.
 *   3. Durable memory injection   — an agent-curated fact changes a later answer.
 *   4. Built-in tool (Gmail send) — deterministic skill delivers a real email (Mailpit).
 *   5. Telegram channel loop      — inbound update → bound agent → outbound delivery.
 *
 * Usage:  bun run apps/engine/scripts/assistant-cases.ts
 * Env:    ENGINE_URL (default http://localhost:8787), TEAM (default demo),
 *         MAILPIT_URL (default http://localhost:8025)
 *
 * Read-mostly: it creates throwaway chat sessions and one memory entry (archived at the
 * end). It does not mutate agents or channels beyond the idempotent dev seed.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../src/infra/db/client";

const ENGINE = process.env.ENGINE_URL ?? "http://localhost:8787";
const TEAM = process.env.TEAM ?? "demo";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

const H = { "content-type": "application/json", "x-team": TEAM, "x-role": "owner" };

function j(path: string, init: RequestInit = {}) {
  return fetch(`${ENGINE}/api/v1${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
}
async function jget<T = any>(path: string): Promise<T> {
  return (await j(path)).json() as Promise<T>;
}
async function jpost<T = any>(path: string, body?: unknown): Promise<T> {
  return (await j(path, { method: "POST", body: body ? JSON.stringify(body) : undefined })).json() as Promise<T>;
}

/** Drive an in-process streaming chat turn and accumulate the assistant text. */
async function streamTurn(sessionId: string, content: string): Promise<string> {
  const res = await j(`/chat/sessions/${sessionId}/stream`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "text-delta" && typeof ev.delta === "string") text += ev.delta;
      } catch {
        /* keepalive / non-JSON frame */
      }
    }
  }
  return text.trim();
}

async function newSession(agentId: string, title: string): Promise<string> {
  const s = await jpost<{ id: string }>("/chat/sessions", { agentId, title });
  if (!s.id) throw new Error(`session create failed: ${JSON.stringify(s)}`);
  return s.id;
}

async function agentByName(name: string): Promise<{ id: string; runtimeKind: string }> {
  const { items } = await jget<{ items: Array<{ id: string; name: string; runtimeKind: string }> }>("/agents");
  const a = items.find((x) => x.name === name);
  if (!a) throw new Error(`agent '${name}' not found`);
  return a;
}

// ── reporting ───────────────────────────────────────────────────────────────
type Case = { n: number; title: string; ok: boolean; evidence: string };
const results: Case[] = [];
function record(n: number, title: string, ok: boolean, evidence: string) {
  results.push({ n, title, ok, evidence });
  const tag = ok ? "✅ PASS" : "❌ FAIL";
  console.log(`\n[Case ${n}] ${title}\n  ${tag} — ${evidence}`);
}
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

async function resolveTeamId(): Promise<string> {
  const [team] = await db
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.slug, TEAM))
    .limit(1);
  if (!team) throw new Error(`team '${TEAM}' not found — start & seed the engine first`);
  return team.id;
}

async function main() {
  console.log(`Assistant proof cases → ${ENGINE} (team=${TEAM})`);
  const teamId = await resolveTeamId();
  const assistant = await agentByName("Assistant");
  const nonce = Date.now().toString(36);

  // ── Case 1 — Streaming chat round-trip (real LLM via the in-process gateway) ──
  try {
    const sid = await newSession(assistant.id, "case1-stream");
    const answer = await streamTurn(sid, 'Réponds exactement par ce seul mot, sans ponctuation : PONG');
    const ok = /pong/i.test(answer);
    record(1, "Streaming chat round-trip (OpenAI gateway)", ok, `runtime=${assistant.runtimeKind} answer=${JSON.stringify(answer.slice(0, 80))}`);
  } catch (e) {
    record(1, "Streaming chat round-trip (OpenAI gateway)", false, `error: ${(e as Error).message}`);
  }

  // ── Case 2 — Multi-turn context (the follow-up resolves against earlier turns) ──
  try {
    const sid = await newSession(assistant.id, "case2-context");
    await streamTurn(sid, "Retiens ces deux faits pour la suite : je m'appelle Kevin et j'habite à Lyon.");
    const answer = await streamTurn(sid, "Dans quelle ville est-ce que j'habite ? Réponds en un mot.");
    const ok = /lyon/i.test(answer);
    record(2, "Multi-turn context recall", ok, `answer=${JSON.stringify(answer.slice(0, 80))}`);
  } catch (e) {
    record(2, "Multi-turn context recall", false, `error: ${(e as Error).message}`);
  }

  // ── Case 3 — Durable memory injection changes a later answer ──
  let memoryId: string | null = null;
  try {
    const secret = `SnowfallVioletQuokka-${nonce}`;
    const created = await jpost<{ id: string }>("/memory", {
      scope: "team",
      content: `The user's private project codeword is "${secret}".`,
      confidence: 0.95,
    });
    memoryId = created.id ?? null;
    // Fresh session (no conversational history) → only durable memory can supply the answer.
    const sid = await newSession(assistant.id, "case3-memory");
    const answer = await streamTurn(sid, "What is my private project codeword? Answer with just the codeword.");
    const ok = answer.includes(secret);
    record(3, "Durable memory injection", ok, `injected=${JSON.stringify(secret)} answer=${JSON.stringify(answer.slice(0, 100))}`);
  } catch (e) {
    record(3, "Durable memory injection", false, `error: ${(e as Error).message}`);
  } finally {
    if (memoryId) await j(`/memory/${memoryId}`, { method: "DELETE" }).catch(() => {});
  }

  // ── Case 4 — Built-in Gmail-send skill delivers a real email (Mailpit fallback) ──
  try {
    const scheduler = await agentByName("Scheduler"); // declares the gmail.send capability
    const sid = await newSession(scheduler.id, "case4-gmail");
    const to = `proof-${nonce}@demo.local`;
    const subject = `Assistant proof ${nonce}`;
    // Queue path: deterministic builtin skill is fulfilled server-side (engine, not daemon).
    const sent = await jpost<{ taskId?: string }>(`/chat/sessions/${sid}/messages`, {
      content: `Envoie un email à ${to} avec le sujet "${subject}" et le message "Ceci est une preuve automatisée."`,
    });
    if (!sent.taskId) throw new Error(`no taskId: ${JSON.stringify(sent)}`);
    // The assistant turn is written on completion; poll the transcript briefly.
    let turn = "";
    for (let i = 0; i < 20; i++) {
      const detail = await jget<{ messages: Array<{ role: string; content: string }> }>(`/chat/sessions/${sid}`);
      const last = [...detail.messages].reverse().find((m) => m.role === "assistant");
      if (last) { turn = last.content; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    // Independent proof: the message actually landed in Mailpit's mailbox.
    let inMailpit = false;
    try {
      const box = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(subject)}`)).json();
      inMailpit = Array.isArray(box?.messages) && box.messages.length > 0;
    } catch { /* mailpit API optional */ }
    const ok = /envoy/i.test(turn) && (inMailpit || /mailpit/i.test(turn));
    record(4, "Built-in Gmail-send skill → real delivery", ok, `mailpit=${inMailpit} turn=${JSON.stringify(turn.replace(/\s+/g, " ").slice(0, 110))}`);
  } catch (e) {
    record(4, "Built-in Gmail-send skill → real delivery", false, `error: ${(e as Error).message}`);
  }

  // ── Case 5 — Telegram channel loop: inbound update → bound agent → outbound ──
  try {
    const seed = await jpost<{ channel?: { chatId: string } }>("/dev/seed");
    const [conn] = await db
      .select()
      .from(schema.channelConnections)
      .where(and(eq(schema.channelConnections.teamId, teamId), eq(schema.channelConnections.label, "SMB Ops Bot")))
      .limit(1);
    if (!conn) throw new Error("seeded Telegram connection not found");
    const chatId = seed.channel?.chatId ?? "900900900";
    const webhook = async (text: string) =>
      fetch(`${ENGINE}/api/v1/channels/telegram/${conn.webhookSecret}/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          update_id: Math.floor(Math.random() * 1e9),
          message: { message_id: Math.floor(Math.random() * 1e9), text, chat: { id: chatId, type: "private" }, from: { id: chatId, first_name: "Operator", username: "smb_operator" } },
        }),
      });
    await webhook(`/start ${conn.pairingCode}`); // pair so the bot answers
    await webhook("/agents");
    await new Promise((r) => setTimeout(r, 600));
    const deliveries = await db
      .select()
      .from(schema.channelDeliveries)
      .where(eq(schema.channelDeliveries.teamId, teamId))
      .orderBy(desc(schema.channelDeliveries.createdAt))
      .limit(5);
    const ok = deliveries.length > 0;
    const sample = (deliveries[0]?.payload as { text?: string } | undefined)?.text?.replace(/\s+/g, " ").slice(0, 80) ?? "";
    record(5, "Telegram inbound → agent → outbound", ok, `deliveries=${deliveries.length} latest=${JSON.stringify(sample)}`);
  } catch (e) {
    record(5, "Telegram inbound → agent → outbound", false, `error: ${(e as Error).message}`);
  }

  // ── Summary ──
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n────────────────────────────────────────────`);
  console.log(`RESULT: ${passed}/${results.length} cases passed`);
  for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} Case ${r.n}: ${r.title}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("assistant-cases failed:", err);
  process.exit(1);
});
