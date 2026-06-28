/**
 * End-to-end test of the seeded daily-execution loop, driven through a real browser
 * with ghostchrome. Assumes the dev stack is already running (`make dev`) and reuses it.
 *
 *   login via the /login dev autofill  →  POST /dev/seed  →  simulate (triage done,
 *   invoice+meeting waiting)  →  approve  →  simulate (all succeed)  →  assert the
 *   invoice email landed in Mailpit  →  assert agents / fleet / run UI render.
 *
 * Usage:  bun run apps/web/scripts/e2e-seeded-loop.ts
 */
import { spawn } from "node:child_process";

const ghostchrome = process.env.GHOSTCHROME_BIN ?? "/home/kev/Documents/lab/tools/ghostchrome/ghostchrome";
const engineUrl = process.env.E2E_ENGINE_URL ?? "http://localhost:8787";
const webUrl = process.env.E2E_WEB_URL ?? "http://localhost:3333";
const mailpitApi = process.env.MAILPIT_API ?? "http://localhost:8025";
const session = `agentik-loop-${Date.now()}`;

function log(m: string) {
  console.log(`[e2e-loop] ${m}`);
}

function run(cmd: string[], timeoutMs = 45_000): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout: ${cmd.join(" ")}`));
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) reject(new Error(`${cmd.join(" ")} failed (${code})\n${stderr}`));
      else resolve({ stdout, code });
    });
  });
}

async function gc(args: string[]) {
  return run([ghostchrome, "-s", session, ...args]);
}

async function gcEval<T>(expression: string, url?: string): Promise<T> {
  const serialized = `(async () => JSON.stringify(await (${expression})))()`;
  const args = ["--format", "json", "-s", session, "eval", serialized];
  if (url) args.push(url);
  const { stdout } = await run([ghostchrome, ...args]);
  const start = stdout.indexOf("{");
  if (start === -1) throw new Error(`no JSON from ghostchrome:\n${stdout}`);
  const parsed = JSON.parse(stdout.slice(start)) as { result: string };
  return JSON.parse(parsed.result) as T;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function urlOk(url: string) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function mailpitCount(query: string): Promise<number> {
  const r = (await fetch(`${mailpitApi}/api/v1/search?query=${encodeURIComponent(query)}`).then((x) =>
    x.json(),
  )) as { messages_count?: number; total?: number };
  return r.messages_count ?? r.total ?? 0;
}

async function main() {
  assert(await urlOk(`${engineUrl}/api/v1/health`), "engine not up — run `make dev` first");
  assert(await urlOk(`${webUrl}/login`), "web not up — run `make dev` first");
  assert(await urlOk(`${mailpitApi}/api/v1/messages?limit=1`), "mailpit not up");

  log("1) login via the /login dev autofill button");
  const login = await gcEval<{ ok: boolean; org?: string; reason?: string }>(
    `(async () => {
      const findBtn = () => [...document.querySelectorAll('button')].find((b) => /owner@agentik\\.dev/.test(b.textContent || ''));
      let btn = null;
      for (let i = 0; i < 40 && !btn; i++) { btn = findBtn(); if (!btn) await new Promise((r) => setTimeout(r, 250)); }
      if (!btn) return { ok: false, reason: 'no-autofill-button' };
      btn.click();
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const me = await fetch('/api/v1/auth/me').then((r) => r.json()).catch(() => null);
        if (me && me.orgs && me.orgs.length) return { ok: true, org: me.orgs[0].slug };
      }
      return { ok: false, reason: 'login-timeout' };
    })()`,
    `${webUrl}/login`,
  );
  assert(login.ok, `dev autofill login failed: ${login.reason}`);
  assert(login.org === "demo", `expected demo org, got ${login.org}`);

  log("2) seed the SMB tenant via /dev/seed");
  const seed = await gcEval<{ runIds: string[]; agents: Record<string, string>; gmailWebhookToken: string }>(
    `fetch('/api/v1/dev/seed', { method: 'POST', headers: { 'x-team': 'demo', 'content-type': 'application/json' } }).then((r) => r.json())`,
  );
  assert(Object.keys(seed.agents).length === 4, "expected 4 seeded agents");
  assert(seed.runIds.length === 3, "expected 3 queued demo runs");
  assert(seed.gmailWebhookToken.startsWith("wht_"), "expected a gmail webhook token");

  log("3) simulate pass 1 (triage completes; invoice + meeting wait for approval)");
  const pass1 = await gcEval<{ processed: Array<{ runId: string; status: string }> }>(
    `fetch('/api/v1/dev/simulate', { method: 'POST', headers: { 'x-team': 'demo' } }).then((r) => r.json())`,
  );
  const waiting = pass1.processed.filter((p) => p.status === "waiting_approval");
  assert(waiting.length === 2, `expected 2 waiting, got ${waiting.length}`);
  assert(pass1.processed.some((p) => p.status === "succeeded"), "triage should have succeeded");

  log("4) approve the waiting runs, then simulate pass 2 (all succeed, emails sent)");
  for (const p of waiting) {
    await gcEval(
      `fetch('/api/v1/runs/${p.runId}/approve', { method: 'POST', headers: { 'x-team': 'demo', 'content-type': 'application/json' }, body: '{"reason":"e2e"}' }).then((r) => ({ ok: r.ok }))`,
    );
  }
  const pass2 = await gcEval<{ processed: Array<{ runId: string; status: string }> }>(
    `fetch('/api/v1/dev/simulate', { method: 'POST', headers: { 'x-team': 'demo' } }).then((r) => r.json())`,
  );
  assert(pass2.processed.every((p) => p.status === "succeeded"), "all runs should have succeeded after approval");

  log("5) assert the invoice + kickoff emails landed in Mailpit");
  assert((await mailpitCount("invoice #42")) > 0, "invoice email not found in mailpit");
  assert((await mailpitCount("Acme kickoff")) > 0, "kickoff email not found in mailpit");

  log("6) assert the agents registry renders the seeded fleet");
  await gc(["preview", `${webUrl}/demo/agents`, "--wait", "stable", "--level", "content"]);
  const agents = await gcEval<Record<string, boolean>>(
    `(() => { const t = document.body.innerText; return {
      officeManager: t.includes('Office Manager'),
      billing: t.includes('Billing Chaser'),
      scheduler: t.includes('Scheduler'),
    }; })()`,
  );
  for (const [k, v] of Object.entries(agents)) assert(v, `agents page missing ${k}`);

  log("7) assert the fleet graph renders");
  await gc(["preview", `${webUrl}/demo/agents/fleet`, "--wait", "stable", "--level", "content"]);
  const fleet = await gcEval<{ fleet: boolean }>(
    `(() => ({ fleet: document.body.innerText.includes('Fleet') }))()`,
  );
  assert(fleet.fleet, "fleet page did not render");

  log("8) assert a run detail view renders the simulated steps");
  const invoiceRunId = seed.runIds[1]!;
  await gc(["preview", `${webUrl}/demo/runs/${invoiceRunId}`, "--wait", "stable", "--level", "content"]);
  const runView = await gcEval<{ hasContent: boolean }>(
    `(() => ({ hasContent: document.body.innerText.length > 200 }))()`,
  );
  assert(runView.hasContent, "run detail view did not render");

  log(`PASSED — seeded daily-execution loop verified end-to-end (runs: ${seed.runIds.length})`);
}

main()
  .then(() => run([ghostchrome, "sessions", "stop", session]).catch(() => {}))
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("\n[e2e-loop] FAILED:", err.message);
    await run([ghostchrome, "sessions", "stop", session]).catch(() => {});
    process.exit(1);
  });
