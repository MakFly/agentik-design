/**
 * "Use the assistant as if it were mine" — five concrete personal-assistant tasks run
 * against the LIVE engine, the way an owner (Kevin) would actually use Agentik. Unlike
 * assistant-cases.ts (capability proofs), these are real end-to-end errands with real
 * outputs printed in full:
 *
 *   1. Durable memory that changes behavior — teach a preference, see it shape a fresh chat.
 *   2. Planning            — a real GPT plan to reconnect Gmail + Telegram.
 *   3. Drafting            — a real GPT draft of a kickoff invitation.
 *   4. Real email          — the Gmail-send skill delivers an actual message (Mailpit).
 *   5. Automation (cron)   — a real schedule signal + rule that runs an agent each morning.
 *
 * Usage:  bun run apps/engine/scripts/owner-tasks.ts
 */
const ENGINE = process.env.ENGINE_URL ?? "http://localhost:8787";
const TEAM = process.env.TEAM ?? "demo";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const H = { "content-type": "application/json", "x-team": TEAM, "x-role": "owner" };

function j(path: string, init: RequestInit = {}) {
  return fetch(`${ENGINE}/api/v1${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
}
const jget = async <T = any>(p: string): Promise<T> => (await j(p)).json();
const jpost = async <T = any>(p: string, body?: unknown): Promise<T> =>
  (await j(p, { method: "POST", body: body ? JSON.stringify(body) : undefined })).json();

/** Drive an in-process streaming chat turn (real GPT) and return the assistant text. */
async function ask(sessionId: string, content: string): Promise<string> {
  const res = await j(`/chat/sessions/${sessionId}/stream`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const f of frames) {
      const line = f.trim();
      if (!line.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (ev.type === "text-delta" && typeof ev.delta === "string") text += ev.delta;
      } catch { /* keepalive */ }
    }
  }
  return text.trim();
}

async function agentByName(name: string): Promise<string> {
  const { items } = await jget<{ items: Array<{ id: string; name: string }> }>("/agents");
  const a = items.find((x) => x.name === name);
  if (!a) throw new Error(`agent '${name}' not found`);
  return a.id;
}
const session = async (agentId: string, title: string) =>
  (await jpost<{ id: string }>("/chat/sessions", { agentId, title })).id;

function box(n: number, title: string) {
  console.log(`\n${"━".repeat(70)}\n● Tâche ${n} — ${title}\n${"─".repeat(70)}`);
}

async function main() {
  console.log(`Agentik — l'assistant perso de Kevin, en action (live: ${ENGINE})`);
  const assistant = await agentByName("Assistant");
  const nonce = Date.now().toString(36);
  let pass = 0;
  const verdicts: string[] = [];
  const ok = (n: number, cond: boolean, note: string) => {
    if (cond) pass++;
    verdicts.push(`${cond ? "✅" : "⚠️"} Tâche ${n}: ${note}`);
    console.log(`\n  → ${cond ? "✅ OK" : "⚠️  à vérifier"} — ${note}`);
  };

  // ── 1. Durable memory that changes behavior ──────────────────────────────
  box(1, "Mémoire durable qui change le comportement");
  const mem = await jpost<{ id: string }>("/memory", {
    scope: "team",
    content:
      "L'utilisateur s'appelle Kevin, il construit Agentik (assistant perso type OpenClaw). Il veut des réponses en français, concises et actionnables.",
    confidence: 0.95,
  });
  console.log(`  mémoire durable créée: ${mem.id}`);
  const s1 = await session(assistant, "owner-memory");
  const a1 = await ask(s1, "Sans que je te le redise, qui suis-je, sur quoi je travaille, et dans quel style dois-tu me répondre ?");
  console.log(`\n  Assistant: ${a1}`);
  ok(1, /kevin/i.test(a1) && /agentik/i.test(a1) && /fran[çc]ais|concis/i.test(a1),
    "l'assistant connaît Kevin/Agentik et le style — mémoire durable injectée en session vierge");

  // ── 2. Planning (real GPT) ───────────────────────────────────────────────
  box(2, "Planification — reconnecter Gmail + Telegram demain matin");
  const s2 = await session(assistant, "owner-plan");
  const a2 = await ask(s2, "Établis un plan d'action concret en 5 étapes numérotées pour reconnecter Gmail (OAuth) et le bot Telegram Sangoku à Agentik demain matin. Une ligne par étape.");
  console.log(`\n  Assistant:\n${a2}`);
  ok(2, /1[.)]/.test(a2) && /telegram/i.test(a2) && /gmail/i.test(a2), "plan en étapes, couvre Gmail + Telegram");

  // ── 3. Drafting (real GPT) ───────────────────────────────────────────────
  box(3, "Rédaction — invitation de kickoff Acme");
  const s3 = await session(assistant, "owner-draft");
  const a3 = await ask(s3, "Rédige un court email d'invitation (objet + corps, 4-6 lignes) pour un kickoff projet avec Acme mercredi prochain à 11h. Ton professionnel et chaleureux.");
  console.log(`\n  Assistant:\n${a3}`);
  ok(3, /acme/i.test(a3) && a3.length > 120, "brouillon d'invitation réel généré");

  // ── 4. Real email via the Gmail-send skill (Mailpit fallback) ────────────
  box(4, "Email réel — envoi via le skill Gmail (livraison Mailpit, Gmail off)");
  const sender = await agentByName("Scheduler"); // declares the gmail.send capability
  const s4 = await session(sender, "owner-email");
  const to = `kevin+agentik-${nonce}@demo.local`;
  const subject = `Récap Agentik ${nonce}`;
  await jpost(`/chat/sessions/${s4}/messages`, {
    content: `Envoie un email à ${to} avec le sujet "${subject}" et le message "Salut Kevin, ton assistant Agentik tourne : mémoire, planning, rédaction et automatisations sont opérationnels."`,
  });
  let turn = "";
  for (let i = 0; i < 20; i++) {
    const d = await jget<{ messages: Array<{ role: string; content: string }> }>(`/chat/sessions/${s4}`);
    const last = [...d.messages].reverse().find((m) => m.role === "assistant");
    if (last) { turn = last.content; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  let inMailpit = false;
  try {
    const m = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(subject)}`)).json();
    inMailpit = Array.isArray(m?.messages) && m.messages.length > 0;
  } catch { /* mailpit optional */ }
  console.log(`\n  Assistant: ${turn.replace(/\s+/g, " ")}`);
  ok(4, /envoy/i.test(turn) && inMailpit, `email réellement livré (mailpit=${inMailpit})`);

  // ── 5. Automation: a real morning-briefing cron ──────────────────────────
  box(5, "Automatisation — briefing quotidien (cron 8h)");
  const sig = await jpost<{ id: string }>("/signals", {
    name: `Briefing matinal de Kevin ${nonce}`,
    kind: "schedule",
    source: "manual",
    config: { cron: "0 8 * * *", tz: "Europe/Paris" },
  });
  const rule = await jpost<{ id: string }>("/rules", {
    name: `Résumé des priorités ${nonce}`,
    signalId: sig.id,
    targetAgentId: assistant,
    action: { type: "run_agent", input: "Résume mes 3 priorités du jour en une ligne chacune." },
  });
  const signals = await jget<{ items?: Array<{ id: string; name: string; kind: string }> } | Array<any>>("/signals");
  const list = Array.isArray(signals) ? signals : (signals.items ?? []);
  const created = list.some((s: any) => s.id === sig.id);
  console.log(`\n  signal cron: ${sig.id} (0 8 * * *) · rule: ${rule.id} → agent Assistant`);
  ok(5, Boolean(sig.id && rule.id && created), "automatisation programmée créée et listée");

  // ── cleanup the durable memory (keep the demo tidy) ──────────────────────
  await j(`/memory/${mem.id}`, { method: "DELETE" }).catch(() => {});

  console.log(`\n${"━".repeat(70)}\nBILAN : ${pass}/5 tâches d'owner réussies`);
  for (const v of verdicts) console.log(`  ${v}`);
  process.exit(pass === 5 ? 0 : 1);
}

main().catch((e) => {
  console.error("owner-tasks failed:", e);
  process.exit(1);
});
