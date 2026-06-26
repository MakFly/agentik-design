import { spawn, execFile } from "node:child_process";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const DEFAULT_ENGINE_URL =
  process.env.NEXT_PUBLIC_ENGINE_URL ??
  process.env.API_URL ??
  "http://localhost:8787";
export const DEFAULT_RUNTIMES = "echo,claude,hermes";

const DEFAULT_HEALTH_PORT =
  process.env.AGENTIK_DAEMON_HEALTH_PORT ?? "19514";

export interface DaemonHealthSnapshot {
  running: boolean;
  daemonId?: string;
  deviceName?: string;
  engineUrl?: string;
  pid?: number;
  runtimes?: string[];
}

export interface LocalDaemonStatus {
  ok: boolean;
  orchestratorAvailable: boolean;
  installed: boolean;
  running: boolean;
  status: string;
  command?: string;
  configPath?: string;
  health?: DaemonHealthSnapshot;
}

interface CommandResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
}

export type InstallEvent =
  | { phase: "started"; message: string; at: string }
  | { phase: "log"; message: string; at: string }
  | { phase: "status"; message: string; at: string; running: boolean }
  | { phase: "daemon.running"; message: string; at: string; running: true }
  | { phase: "completed"; message: string; at: string; terminal: true }
  | { phase: "failed"; message: string; at: string; terminal: true };

export interface InstallJob {
  id: string;
  events: InstallEvent[];
  done: boolean;
  subscribers: Set<(event: InstallEvent) => void>;
}

interface SystemInfo {
  daemons: Array<{ status: string; mode?: string }>;
}

declare global {
  var __agentikLocalDaemonJobs: Map<string, InstallJob> | undefined;
}

const jobs =
  globalThis.__agentikLocalDaemonJobs ??
  (globalThis.__agentikLocalDaemonJobs = new Map<string, InstallJob>());

export async function resolveAgentikBin(): Promise<string> {
  if (process.env.AGENTIK_CLI_PATH) return process.env.AGENTIK_CLI_PATH;
  const local = path.resolve(process.cwd(), "../../bin/agentik");
  try {
    await access(local);
    return local;
  } catch {
    return "agentik";
  }
}

async function isOrchestratorAvailable(): Promise<boolean> {
  if (process.env.AGENTIK_CLI_PATH) {
    try {
      await access(process.env.AGENTIK_CLI_PATH);
      return true;
    } catch {
      return false;
    }
  }
  const local = path.resolve(process.cwd(), "../../bin/agentik");
  try {
    await access(local);
    return true;
  } catch {
    try {
      const { stdout } = await exec("which", ["agentik"], { timeout: 3000 });
      return Boolean(stdout.trim());
    } catch {
      return false;
    }
  }
}

async function pollDaemonHealth(): Promise<DaemonHealthSnapshot | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${DEFAULT_HEALTH_PORT}/health`, {
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as DaemonHealthSnapshot;
  } catch {
    return null;
  }
}

export function sanitizeEngineUrl(value: unknown): string | null {
  const engineUrl =
    typeof value === "string" && value.trim()
      ? value.trim()
      : DEFAULT_ENGINE_URL;
  try {
    const url = new URL(engineUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return engineUrl;
  } catch {
    return null;
  }
}

export function sanitizeRuntimes(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_RUNTIMES;
}

function maskTokenArg(args: string[]): string[] {
  return args.map((arg, index) =>
    args[index - 1] === "--token" ? "[redacted]" : arg,
  );
}

function defaultConfigPath(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, "agentik", "config.json");
  }
  const home = os.homedir();
  return home
    ? path.join(home, ".config", "agentik", "config.json")
    : path.join(process.cwd(), ".agentik", "config.json");
}

async function configExists(): Promise<boolean> {
  try {
    await access(defaultConfigPath());
    return true;
  } catch {
    return false;
  }
}

async function runAgentik(args: string[]): Promise<CommandResult> {
  const bin = await resolveAgentikBin();
  const command = [bin, ...maskTokenArg(args)].join(" ");
  try {
    const { stdout, stderr } = await exec(bin, args, {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    return { ok: true, command, stdout, stderr };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      command,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "agentik command failed",
    };
  }
}

export async function getLocalDaemonStatus(): Promise<LocalDaemonStatus> {
  const orchestratorAvailable = await isOrchestratorAvailable();
  const health = await pollDaemonHealth();
  const [result, installed] = await Promise.all([
    orchestratorAvailable
      ? runAgentik(["daemon", "status"])
      : Promise.resolve({
          ok: false,
          command: "agentik",
          stdout: "",
          stderr: "Local orchestrator unavailable on this host.",
        }),
    configExists(),
  ]);
  const running =
    Boolean(health?.running) || result.stdout.includes("running pid=");
  return {
    ok: orchestratorAvailable ? result.ok : false,
    orchestratorAvailable,
    installed,
    running,
    status:
      health?.deviceName && running
        ? `Daemon running on ${health.deviceName}`
        : result.stdout.trim() || result.stderr.trim(),
    command: result.command,
    configPath: defaultConfigPath(),
    health: health ?? undefined,
  };
}

export async function startLocalDaemon(input?: {
  engineUrl?: string;
  team?: string;
  cookie?: string | null;
}): Promise<LocalDaemonStatus> {
  const result = await runAgentik(["daemon", "start", "--background"]);
  const status = await getLocalDaemonStatus();
  const visible =
    result.ok && status.running
      ? await waitForEnginePresence({
          engineUrl: input?.engineUrl ?? DEFAULT_ENGINE_URL,
          team: input?.team,
          cookie: input?.cookie,
        })
      : false;
  return {
    ok: result.ok && status.ok && status.running && visible,
    orchestratorAvailable: status.orchestratorAvailable,
    installed: status.installed,
    running: status.running,
    status: [
      result.stdout.trim() || result.stderr.trim(),
      status.status,
      status.running && !visible
        ? "Daemon process started, waiting for engine check-in timed out."
        : visible
          ? "Daemon checked in with the engine."
          : "",
    ]
      .filter(Boolean)
      .join("\n"),
    command: result.command,
    configPath: status.configPath,
    health: status.health,
  };
}

export async function stopLocalDaemon(): Promise<LocalDaemonStatus> {
  const result = await runAgentik(["daemon", "stop"]);
  const status = await getLocalDaemonStatus();
  return {
    ok: result.ok && status.ok,
    orchestratorAvailable: status.orchestratorAvailable,
    installed: status.installed,
    running: status.running,
    status: [result.stdout.trim() || result.stderr.trim(), status.status]
      .filter(Boolean)
      .join("\n"),
    command: result.command,
    configPath: status.configPath,
    health: status.health,
  };
}

export async function markEnginePersonalDaemonOffline(input: {
  engineUrl: string;
  team?: string;
  cookie?: string | null;
}): Promise<boolean> {
  try {
    const url = new URL("/api/v1/me/daemon-token/offline", input.engineUrl);
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (input.team) headers["x-team"] = input.team;
    if (input.cookie) headers.cookie = input.cookie;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: "{}",
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function uninstallLocalDaemon(): Promise<LocalDaemonStatus> {
  const result = await runAgentik(["disconnect"]);
  const status = await getLocalDaemonStatus();
  return {
    ok: result.ok && status.ok,
    orchestratorAvailable: status.orchestratorAvailable,
    installed: status.installed,
    running: status.running,
    status: [result.stdout.trim() || result.stderr.trim(), status.status]
      .filter(Boolean)
      .join("\n"),
    command: result.command,
    configPath: status.configPath,
    health: status.health,
  };
}

function emit(job: InstallJob, event: InstallEvent) {
  job.events.push(event);
  for (const subscriber of job.subscribers) subscriber(event);
}

function now(): string {
  return new Date().toISOString();
}

export async function startInstallJob(input: {
  token: string;
  engineUrl: string;
  runtimes: string;
  team?: string;
  cookie?: string | null;
}): Promise<InstallJob> {
  const id = crypto.randomUUID();
  const job: InstallJob = {
    id,
    events: [],
    done: false,
    subscribers: new Set(),
  };
  jobs.set(id, job);

  const bin = await resolveAgentikBin();
  const args = [
    "setup",
    "--url",
    input.engineUrl,
    "--token",
    input.token,
    "--runtimes",
    input.runtimes,
    "--start",
  ];

  queueMicrotask(() => {
    let terminal = false;
    const finish = (event: Extract<InstallEvent, { terminal: true }>) => {
      if (terminal) return;
      terminal = true;
      job.done = true;
      emit(job, event);
      setTimeout(() => jobs.delete(job.id), 10 * 60 * 1000);
    };

    emit(job, {
      phase: "started",
      message: `Starting ${[bin, ...maskTokenArg(args)].join(" ")}`,
      at: now(),
    });

    void stopLocalDaemon()
      .then((before) => {
        emit(job, {
          phase: "status",
          message: before.status || "Local daemon preflight complete.",
          running: before.running,
          at: now(),
        });

        const child = spawn(bin, args, {
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });

        const push = (chunk: Buffer) => {
          const text = chunk.toString("utf8").trim();
          if (!text) return;
          for (const line of text.split(/\r?\n/)) {
            emit(job, { phase: "log", message: line, at: now() });
          }
        };

        child.stdout.on("data", push);
        child.stderr.on("data", push);
        child.on("error", (error) => {
          finish({
            phase: "failed",
            message: error.message,
            at: now(),
            terminal: true,
          });
        });
        child.on("close", async (code) => {
          const status = await getLocalDaemonStatus();
          emit(job, {
            phase: "status",
            message: status.status,
            running: status.running,
            at: now(),
          });
          if (code === 0 && status.running) {
            emit(job, {
              phase: "daemon.running",
              message: status.status,
              running: true,
              at: now(),
            });
            emit(job, {
              phase: "status",
              message: "Waiting for engine check-in...",
              running: true,
              at: now(),
            });
            const visible = await waitForEnginePresence(input);
            if (visible) {
              finish({
                phase: "completed",
                message: "Daemon started and checked in with the engine.",
                at: now(),
                terminal: true,
              });
              return;
            }
            finish({
              phase: "failed",
              message:
                "Daemon process started, but the engine did not report it online before timeout.",
              at: now(),
              terminal: true,
            });
            return;
          }
          finish({
            phase: "failed",
            message: `Install command exited with ${code ?? "unknown"}.`,
            at: now(),
            terminal: true,
          });
        });
      })
      .catch((error) => {
        finish({
          phase: "failed",
          message:
            error instanceof Error ? error.message : "Daemon install failed.",
          at: now(),
          terminal: true,
        });
      });
  });

  return job;
}

export function getInstallJob(id: string): InstallJob | null {
  return jobs.get(id) ?? null;
}

async function waitForEnginePresence(input: {
  engineUrl: string;
  team?: string;
  cookie?: string | null;
}): Promise<boolean> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await hasOnlinePersonalDaemon(input)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function hasOnlinePersonalDaemon(input: {
  engineUrl: string;
  team?: string;
  cookie?: string | null;
}): Promise<boolean> {
  try {
    const url = new URL("/api/v1/system", input.engineUrl);
    const headers: Record<string, string> = { accept: "application/json" };
    if (input.team) headers["x-team"] = input.team;
    if (input.cookie) headers.cookie = input.cookie;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return false;
    const system = (await res.json()) as SystemInfo;
    return system.daemons.some(
      (daemon) => daemon.mode === "personal" && daemon.status === "online",
    );
  } catch {
    return false;
  }
}
