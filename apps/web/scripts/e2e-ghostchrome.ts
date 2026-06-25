import { spawn, type ChildProcessByStdio } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";

type ManagedProcess = ChildProcessByStdio<null, Readable, Readable>;

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const ghostchrome =
  process.env.GHOSTCHROME_BIN ??
  "/home/kev/Documents/lab/tools/ghostchrome/ghostchrome";
const engineUrl = process.env.E2E_ENGINE_URL ?? "http://localhost:8787";
const webUrl = process.env.E2E_WEB_URL ?? "http://localhost:3333";
const session = `agentik-e2e-${Date.now()}`;
const debug = process.env.E2E_DEBUG === "1";

const children: ManagedProcess[] = [];
const processLogs = new Map<ManagedProcess, { label: string; lines: string[] }>();

function log(message: string) {
  console.log(`[e2e] ${message}`);
}

async function drain(
  stream: Readable | null,
  label: string,
  owner: ManagedProcess,
) {
  if (!stream) return;
  for await (const chunk of stream) {
    const text = chunk.toString();
    const record = processLogs.get(owner);
    if (record) {
      record.lines.push(
        ...text
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .filter(Boolean),
      );
      record.lines = record.lines.slice(-30);
    }
    if (debug) process.stdout.write(`[${label}] ${text}`);
  }
}

function spawnManaged(
  label: string,
  cmd: string[],
  env: Record<string, string>,
) {
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  processLogs.set(child, { label, lines: [] });
  void drain(child.stdout, label, child);
  void drain(child.stderr, `${label}:err`, child);
  return child;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url: string, label: string, timeoutMs = 120_000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    const exited = children.find((child) => child.exitCode !== null);
    if (exited) {
      const record = processLogs.get(exited);
      throw new Error(
        `${record?.label ?? "server"} exited while waiting for ${label}\n${record?.lines.join("\n") ?? ""}`,
      );
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = `${res.status} ${res.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  const logs = [...processLogs.values()]
    .map((record) => `-- ${record.label} --\n${record.lines.join("\n")}`)
    .join("\n");
  throw new Error(`${label} did not become ready: ${lastError}\n${logs}`);
}

async function urlOk(url: string) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

function portFromUrl(url: string) {
  return new URL(url).port;
}

async function run(
  cmd: string[],
  opts: { timeoutMs?: number; allowFailure?: boolean } = {},
) {
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise<number | null>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolve(124);
    }, opts.timeoutMs ?? 30_000);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  if (exitCode !== 0 && !opts.allowFailure) {
    throw new Error(
      `${cmd.join(" ")} failed (${exitCode})\n${stdout}\n${stderr}`.trim(),
    );
  }
  return { stdout, stderr, exitCode };
}

async function gc(args: string[], timeoutMs = 30_000) {
  return run([ghostchrome, "-s", session, ...args], { timeoutMs });
}

function parseJson(stdout: string) {
  const index = stdout.indexOf("{");
  if (index === -1) throw new Error(`No JSON object in ghostchrome output:\n${stdout}`);
  return JSON.parse(stdout.slice(index));
}

async function gcEval<T>(expression: string, url?: string): Promise<T> {
  const serialized = `(async () => JSON.stringify(await (${expression})))()`;
  const args = ["--format", "json", "-s", session, "eval", serialized];
  if (url) args.push(url);
  const { stdout } = await run([ghostchrome, ...args], { timeoutMs: 45_000 });
  return JSON.parse(String(parseJson(stdout).result)) as T;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function cleanup() {
  await run([ghostchrome, "sessions", "stop", session], {
    allowFailure: true,
    timeoutMs: 10_000,
  });
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("close", resolve)),
      sleep(3_000),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

process.on("SIGINT", () => {
  void cleanup().finally(() => process.exit(130));
});

try {
  log("preparing real engine and web servers");
  if (await urlOk(`${engineUrl}/api/v1/health`)) {
    log(`reusing engine at ${engineUrl}`);
  } else {
    spawnManaged("engine", ["bun", "run", "--cwd", "apps/engine", "start"], {
      PORT: portFromUrl(engineUrl),
      AUTH_DEV_HEADERS: "true",
      DAEMON_ENABLED: "false",
      ENGINE_PUBLIC_URL: engineUrl,
      WEB_PUBLIC_URL: webUrl,
    });
    await waitForUrl(`${engineUrl}/api/v1/health`, "engine");
  }

  if (await urlOk(`${webUrl}/login`)) {
    log(`reusing web at ${webUrl}`);
  } else {
    spawnManaged(
      "web",
      [
        "bun",
        "run",
        "--cwd",
        "apps/web",
        "dev",
        "--hostname",
        new URL(webUrl).hostname,
        "--port",
        portFromUrl(webUrl),
      ],
      {
        API_URL: engineUrl,
        NEXT_PUBLIC_ENGINE_URL: engineUrl,
        NEXT_PUBLIC_USE_MOCK: "false",
        PORT: portFromUrl(webUrl),
      },
    );
    await waitForUrl(`${webUrl}/login`, "web", 180_000);
  }

  log("checking engine proxy and disabled MSW");
  const proxy = await gcEval<{
    service: string;
    mockServiceWorker: boolean;
  }>(
    `(async () => {
      const health = await fetch('/api/v1/health').then((res) => res.json());
      const regs = navigator.serviceWorker
        ? await navigator.serviceWorker.getRegistrations()
        : [];
      return {
        service: health.service,
        mockServiceWorker: regs.some((reg) =>
          String(reg.active?.scriptURL || '').includes('mockServiceWorker'),
        ),
      };
    })()`,
    `${webUrl}/login`,
  );
  assert(proxy.service === "engine", "Next API rewrite did not hit engine");
  assert(!proxy.mockServiceWorker, "MSW worker is active during E2E");

  log("logging in with the real dev account");
  const login = await gcEval<{ ok: boolean; org: string | null }>(
    `(async () => {
      const users = await fetch('/api/v1/auth/dev/users').then((res) => res.json());
      const owner = users.items.find((item) => item.email === 'owner@agentik.dev');
      if (!owner) return { ok: false, org: null };
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: owner.email, password: owner.password }),
      });
      const me = await fetch('/api/v1/auth/me').then((r) => r.json());
      return { ok: res.ok, org: me.orgs?.[0]?.slug ?? null };
    })()`,
  );
  assert(login.ok, "dev login failed");
  assert(login.org === "demo", "demo org was not selected after login");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const projectName = `Ghostchrome agent cockpit ${stamp}`;
  const taskTitle = `Inspect agentic workspace ${stamp}`;
  const resourceLabel = "Agentik local repo";

  log("creating project, resource, and task through the real API");
  const created = await gcEval<{
    projectId: string;
    taskId: string;
    resourceId: string;
  }>(
    `(async () => {
      const headers = { 'content-type': 'application/json', 'x-team': 'demo' };
      const project = await fetch('/api/v1/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: ${JSON.stringify(projectName)},
          type: 'hybrid',
          description: 'Ghostchrome E2E context for Multica/OpenClaw/Hermes cockpit parity.',
        }),
      }).then((res) => res.json());
      const resource = await fetch('/api/v1/projects/' + project.id + '/resources', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'local_dir',
          label: ${JSON.stringify(resourceLabel)},
          ref: ${JSON.stringify(root)},
        }),
      }).then((res) => res.json());
      const task = await fetch('/api/v1/projects/' + project.id + '/tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: ${JSON.stringify(taskTitle)},
          description: 'Use Claude Code, Codex, or Hermes against this workspace. Do not start a live run in E2E.',
          priority: 'P1',
        }),
      }).then((res) => res.json());
      return { projectId: project.id, resourceId: resource.id, taskId: task.id };
    })()`,
  );
  assert(created.projectId, "project was not created");
  assert(created.taskId, "task was not created");
  assert(created.resourceId, "resource was not created");

  log("checking project cockpit UI");
  await gc([
    "preview",
    `${webUrl}/demo/projects/${created.projectId}`,
    "--wait",
    "stable",
    "--level",
    "content",
  ]);
  const cockpit = await gcEval<Record<string, boolean>>(
    `(() => {
      const text = document.body.innerText;
      return {
        project: text.includes(${JSON.stringify(projectName)}),
        task: text.includes(${JSON.stringify(taskTitle)}),
        resource: text.includes(${JSON.stringify(resourceLabel)}),
        console: text.includes('Agent console'),
        context: text.includes('Project context'),
        channels: text.includes('Linked channels'),
        workspaces: text.includes('Workspaces'),
      };
    })()`,
  );
  for (const [key, ok] of Object.entries(cockpit)) {
    assert(ok, `project cockpit is missing ${key}`);
  }

  log("checking agents, runs, and runtime settings UI");
  await gc(["preview", `${webUrl}/demo/agents`, "--wait", "stable"]);
  const agents = await gcEval<Record<string, boolean>>(
    `(() => {
      const text = document.body.innerText;
      return {
        agents: text.includes('Agents'),
        templates: text.includes('Template') || text.includes('New agent'),
        runtime: text.includes('Runtime') || text.includes('Claude') || text.includes('Codex'),
      };
    })()`,
  );
  assert(agents.agents && agents.templates, "agents page did not render");

  await gc(["preview", `${webUrl}/demo/runs`, "--wait", "stable"]);
  const runs = await gcEval<Record<string, boolean>>(
    `(() => {
      const text = document.body.innerText;
      return {
        runs: text.includes('Runs'),
        active: text.includes('Active'),
        review: text.includes('Needs review'),
      };
    })()`,
  );
  assert(runs.runs && runs.active && runs.review, "runs board did not render");

  await gc([
    "preview",
    `${webUrl}/demo/settings?section=runtimes`,
    "--wait",
    "stable",
  ]);
  const settings = await gcEval<Record<string, boolean>>(
    `(() => {
      const text = document.body.innerText;
      return {
        runtimeLayer: text.includes('Agent runtime layer'),
        daemon: text.includes('Workspace daemon'),
        terminal: text.includes('Terminal runners'),
        gateway: text.includes('Gateway channels'),
      };
    })()`,
  );
  for (const [key, ok] of Object.entries(settings)) {
    assert(ok, `settings runtime page is missing ${key}`);
  }

  log(`passed with real engine, no MSW, project ${created.projectId}`);
} finally {
  await cleanup();
}
