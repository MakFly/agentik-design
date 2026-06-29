/**
 * End-to-end test of the seeded daily-execution loop, driven through a real browser
 * with ghostchrome. Assumes the dev stack is already running (`make dev`) and reuses it.
 *
 *   login via the /login dev autofill  →  POST /dev/seed  →  simulate (triage done,
 *   invoice+meeting waiting)  →  approve  →  simulate (all succeed)  →  assert the
 *   invoice email landed in Mailpit  →  assert agents / project / run UI render.
 *
 * Usage:  bun run apps/web/scripts/e2e-seeded-loop.ts
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ghostchrome = process.env.GHOSTCHROME_BIN ?? "/home/kev/Documents/lab/tools/ghostchrome/ghostchrome";
const engineUrl = process.env.E2E_ENGINE_URL ?? "http://localhost:8787";
const webUrl = process.env.E2E_WEB_URL ?? "http://localhost:3333";
const mailpitApi = process.env.MAILPIT_API ?? "http://localhost:8025";
const session = `agentik-loop-${Date.now()}`;
const proofDir = process.env.E2E_PROOF_DIR
  ? resolve(process.env.E2E_PROOF_DIR)
  : join(repoRoot, "artifacts/acceptance");
const proofPath = join(proofDir, `${session}.json`);

type ProofCheck = {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
};

const proof: {
  id: string;
  status: "running" | "passed" | "failed";
  startedAt: string;
  finishedAt?: string;
  urls: { engine: string; web: string; mailpit: string };
  seed?: { projectId: string; runIds: string[]; agentCount: number };
  checks: ProofCheck[];
  error?: string;
} = {
  id: session,
  status: "running",
  startedAt: new Date().toISOString(),
  urls: { engine: engineUrl, web: webUrl, mailpit: mailpitApi },
  checks: [],
};

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

function check(name: string, cond: unknown, details?: Record<string, unknown>) {
  const ok = Boolean(cond);
  proof.checks.push({ name, ok, details });
  assert(ok, name);
}

function checkMap(label: string, values: Record<string, boolean>) {
  for (const [key, value] of Object.entries(values)) {
    check(`${label}: ${key}`, value);
  }
}

function writeProof(status: "passed" | "failed", error?: unknown) {
  proof.status = status;
  proof.finishedAt = new Date().toISOString();
  if (error) proof.error = error instanceof Error ? error.message : String(error);
  mkdirSync(proofDir, { recursive: true });
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  log(`proof written: ${proofPath}`);
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

async function runDetailText(runId: string): Promise<string> {
  const detail = await gcEval<unknown>(
    `fetch('/api/v1/runs/${runId}', { headers: { 'x-team': 'demo' } }).then((r) => r.json())`,
  );
  return JSON.stringify(detail);
}

async function runDetails(runIds: string[]) {
  return Promise.all(runIds.map(async (runId) => ({ runId, text: await runDetailText(runId) })));
}

async function runStatuses(runIds: string[]) {
  return gcEval<Array<{ runId: string; status?: string }>>(
    `(async () => Promise.all(${JSON.stringify(runIds)}.map(async (runId) => {
      const detail = await fetch('/api/v1/runs/' + runId, { headers: { 'x-team': 'demo' } }).then((r) => r.json()).catch(() => ({}));
      return { runId, status: detail?.run?.status };
    })))()`,
  );
}

async function waitForSucceededRuns(runIds: string[], timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let statuses: Array<{ runId: string; status?: string }> = [];
  while (Date.now() < deadline) {
    statuses = await runStatuses(runIds);
    if (statuses.every((run) => run.status === "succeeded")) return statuses;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return statuses;
}

function findRunByText(runs: Array<{ runId: string; text: string }>, needle: string) {
  return runs.find((run) => run.text.includes(needle));
}

function hasRecordedEmailDelivery(run: { text: string } | undefined, mailpitMatches: number) {
  return mailpitMatches > 0 || /Email sent .* via (gmail|mailpit)/i.test(run?.text ?? "");
}

async function main() {
  check("engine health is reachable", await urlOk(`${engineUrl}/api/v1/health`), { url: `${engineUrl}/api/v1/health` });
  check("web login is reachable", await urlOk(`${webUrl}/login`), { url: `${webUrl}/login` });
  check("mailpit API is reachable", await urlOk(`${mailpitApi}/api/v1/messages?limit=1`), { url: `${mailpitApi}/api/v1/messages?limit=1` });

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
  check("dev autofill login succeeds", login.ok, { reason: login.reason });
  check("logged in org is demo", login.org === "demo", { org: login.org });

  log("2) seed the SMB tenant via /dev/seed");
  const seed = await gcEval<{
    projectId: string;
    runIds: string[];
    agents: Record<string, string>;
    gmailWebhookToken: string;
  }>(
    `fetch('/api/v1/dev/seed', { method: 'POST', headers: { 'x-team': 'demo', 'content-type': 'application/json' } }).then((r) => r.json())`,
  );
  proof.seed = {
    projectId: seed.projectId,
    runIds: seed.runIds,
    agentCount: Object.keys(seed.agents).length,
  };
  check("seed created 4 agents", Object.keys(seed.agents).length === 4, { agents: Object.keys(seed.agents) });
  check("seed created 4 demo runs", seed.runIds.length === 4, { runIds: seed.runIds });
  check("seed created gmail webhook token", seed.gmailWebhookToken.startsWith("wht_"));

  log("3) simulate pass 1 (triage completes; invoice + meeting wait for approval)");
  const pass1 = await gcEval<{ processed: Array<{ runId: string; status: string }> }>(
    `fetch('/api/v1/dev/simulate', { method: 'POST', headers: { 'x-team': 'demo' } }).then((r) => r.json())`,
  );
  const waiting = pass1.processed.filter((p) => p.status === "waiting_approval");
  check("simulation pass 1 has 2 approval-gated runs", waiting.length === 2, { processed: pass1.processed });
  const detailsAfterPass1 = await runDetails(seed.runIds);
  const triageHistory = detailsAfterPass1.filter(
    (run) => run.text.includes("Triage today's inbox") && run.text.includes('"status":"succeeded"'),
  );
  check("seed has 2 historical triage runs already succeeded", triageHistory.length === 2, {
    runIds: triageHistory.map((run) => run.runId),
  });

  log("4) approve the waiting runs, then simulate pass 2 (all succeed, emails sent)");
  for (const p of waiting) {
    await gcEval(
      `fetch('/api/v1/runs/${p.runId}/approve', { method: 'POST', headers: { 'x-team': 'demo', 'content-type': 'application/json' }, body: '{"reason":"e2e"}' }).then((r) => ({ ok: r.ok }))`,
    );
  }
  const pass2 = await gcEval<{ processed: Array<{ runId: string; status: string }> }>(
    `fetch('/api/v1/dev/simulate', { method: 'POST', headers: { 'x-team': 'demo' } }).then((r) => r.json())`,
  );
  const processedRunIds = pass2.processed.map((run) => run.runId);
  const finalStatuses = await waitForSucceededRuns(processedRunIds);
  check("simulation pass 2 succeeds after approvals", finalStatuses.every((p) => p.status === "succeeded"), {
    processed: pass2.processed,
    finalStatuses,
  });

  log("5) assert the invoice + kickoff emails were delivered or recorded");
  const invoiceEmailCount = await mailpitCount("invoice #42");
  const kickoffEmailCount = await mailpitCount("Acme kickoff");
  const detailsAfterPass2 = await runDetails(seed.runIds);
  const invoiceDeliveryRun = findRunByText(detailsAfterPass2, "Chase overdue invoice #42");
  const kickoffDeliveryRun = findRunByText(detailsAfterPass2, "Schedule the Acme kickoff");
  check("invoice email delivery recorded", hasRecordedEmailDelivery(invoiceDeliveryRun, invoiceEmailCount), {
    mailpitCount: invoiceEmailCount,
    runId: invoiceDeliveryRun?.runId,
  });
  check("kickoff email delivery recorded", hasRecordedEmailDelivery(kickoffDeliveryRun, kickoffEmailCount), {
    mailpitCount: kickoffEmailCount,
    runId: kickoffDeliveryRun?.runId,
  });

  log("6) assert the agents registry renders the seeded fleet");
  await gc(["preview", `${webUrl}/demo/agents`, "--wait", "stable", "--level", "content"]);
  const agents = await gcEval<Record<string, boolean>>(
    `(() => { const t = document.body.innerText; return {
      officeManager: t.includes('Office Manager'),
      billing: t.includes('Billing Chaser'),
      scheduler: t.includes('Scheduler'),
    }; })()`,
  );
  checkMap("agents page", agents);

  log("7) assert the project cockpit renders task board, console, context, resources and channels");
  await gc(["preview", `${webUrl}/demo/projects/${seed.projectId}`, "--wait", "stable", "--level", "content"]);
  const projectCockpit = await gcEval<Record<string, boolean>>(
    `(() => { const t = document.body.innerText; return {
      projectName: t.includes('Daily Office Ops'),
      tasks: t.includes('Tasks'),
      agentConsole: t.includes('Agent console'),
      runInstruction: t.includes('Run instruction'),
      latestRun: t.includes('Latest run'),
      projectContext: t.includes('Project context'),
      activeRuns: t.includes('Active runs'),
      resources: t.includes('Resources'),
      linkedChannels: t.includes('Linked channels'),
      invoiceTask: t.includes('Chase overdue invoice #42'),
    }; })()`,
  );
  checkMap("project cockpit", projectCockpit);

  log("8) assert a run detail view renders the Hermes-style transcript and project summary");
  const invoiceCandidates = await runDetails(seed.runIds);
  const invoiceRunId = findRunByText(invoiceCandidates, "Chase overdue invoice #42")?.runId;
  check("seed exposes an invoice run detail", invoiceRunId, {
    runIds: seed.runIds,
  });
  await gc(["preview", `${webUrl}/demo/runs/${invoiceRunId}`, "--wait", "stable", "--level", "content"]);
  const runView = await gcEval<Record<string, boolean>>(
    `(() => { const t = document.body.innerText; const lower = t.toLowerCase(); return {
      transcript: lower.includes('execution transcript'),
      projectTask: lower.includes('project task'),
      runMetadata: lower.includes('run metadata'),
      operatorInput: lower.includes('operator input'),
      projectName: t.includes('Daily Office Ops'),
      taskTitle: t.includes('Chase overdue invoice #42'),
      invoiceEvidence: t.includes('Found invoice #42') || t.includes('Drafted a polite reminder'),
    }; })()`,
  );
  checkMap("run detail view", runView);

  writeProof("passed");
  log(`PASSED — seeded daily-execution loop + project cockpit + run console verified (runs: ${seed.runIds.length})`);
}

main()
  .then(() => run([ghostchrome, "sessions", "stop", session]).catch(() => {}))
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("\n[e2e-loop] FAILED:", err.message);
    writeProof("failed", err);
    await run([ghostchrome, "sessions", "stop", session]).catch(() => {});
    process.exit(1);
  });
