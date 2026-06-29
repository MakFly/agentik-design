import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const proofDir = path.join(root, "artifacts/acceptance");

type RunnerProof = {
  id?: unknown;
  status?: unknown;
  runtime?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  prompt?: unknown;
  checks?: Array<{ name?: unknown; ok?: unknown }>;
  messages?: Array<{ type?: unknown; content?: unknown; tool?: unknown }>;
  result?: unknown;
  error?: unknown;
};

const commonChecks = [
  "runtime is registered",
  "runtime completed without error",
  "runtime emitted messages",
  "runtime produced result",
];


function latestRunnerProofFile() {
  if (!existsSync(proofDir)) return null;
  const files = readdirSync(proofDir)
    .filter((file) => /^agentik-runner-smoke-.*\.json$/.test(file))
    .map((file) => path.join(proofDir, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

function allRunnerProofFiles() {
  if (!existsSync(proofDir)) return [];
  return readdirSync(proofDir)
    .filter((file) => /^agentik-runner-smoke-.*\.json$/.test(file))
    .map((file) => path.join(proofDir, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

function parseArgs() {
  const runtimes: string[] = [];
  let explicitProof = process.env.RUNNER_PROOF_FILE;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--runtime") {
      const value = args[index + 1];
      if (!value) fail(["--runtime requires a value."]);
      runtimes.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--runtime=")) {
      runtimes.push(arg.slice("--runtime=".length));
      continue;
    }
    if (arg === "--proof") {
      explicitProof = args[index + 1];
      if (!explicitProof) fail(["--proof requires a value."]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--proof=")) {
      explicitProof = arg.slice("--proof=".length);
      continue;
    }
    if (!arg.startsWith("--") && !explicitProof) {
      explicitProof = arg;
      continue;
    }
    fail([`Unknown argument: ${arg}`]);
  }
  for (const runtime of (process.env.REQUIRED_RUNNER_RUNTIMES ?? "").split(",")) {
    const normalized = runtime.trim();
    if (normalized) runtimes.push(normalized);
  }
  return {
    explicitProof: explicitProof ? path.resolve(explicitProof) : null,
    runtimes: [...new Set(runtimes.map((runtime) => runtime.trim()).filter(Boolean))],
  };
}

function proofPathFromArgs(explicitProof: string | null) {
  if (explicitProof) return explicitProof;
  return latestRunnerProofFile();
}

function fail(messages: string[]): never {
  console.error("Runner proof audit failed:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}

function readProof(proofPath: string) {
  if (!existsSync(proofPath)) fail([`Proof artifact does not exist: ${proofPath}`]);
  try {
    return JSON.parse(readFileSync(proofPath, "utf8")) as RunnerProof;
  } catch (error) {
    fail([`Could not parse runner proof ${proofPath}: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

function validateProof(proof: RunnerProof, proofPath: string, expectedRuntime?: string) {
  const findings: string[] = [];
  if (typeof proof.id !== "string" || !proof.id.startsWith("agentik-runner-smoke-")) {
    findings.push("id must be an agentik-runner-smoke session id.");
  }
  if (proof.status !== "passed") findings.push(`status must be "passed", got ${JSON.stringify(proof.status)}.`);
  if (typeof proof.runtime !== "string" || !proof.runtime) findings.push("runtime is required.");
  if (expectedRuntime && proof.runtime !== expectedRuntime) {
    findings.push(`runtime must be ${expectedRuntime}, got ${JSON.stringify(proof.runtime)}.`);
  }
  if (typeof proof.prompt !== "string" || !proof.prompt.trim()) findings.push("prompt is required.");
  if (typeof proof.startedAt !== "string" || typeof proof.finishedAt !== "string") {
    findings.push("startedAt and finishedAt must be ISO timestamp strings.");
  }
  if (!Array.isArray(proof.checks) || proof.checks.length < commonChecks.length) {
    findings.push("checks must include the common runtime smoke checks.");
  }
  if (!Array.isArray(proof.messages) || proof.messages.length === 0) {
    findings.push("messages must contain emitted runtime messages.");
  }
  if (proof.result == null) findings.push("result is required.");
  if (proof.error) findings.push(`passed runner proof must not contain error: ${String(proof.error)}`);

  const checks = new Map((proof.checks ?? []).map((check) => [String(check.name), check.ok]));
  for (const required of commonChecks) {
    if (!checks.has(required)) findings.push(`missing check: ${required}`);
    else if (checks.get(required) !== true) findings.push(`check is not passing: ${required}`);
  }
  for (const check of proof.checks ?? []) {
    if (check.ok !== true) findings.push(`proof contains failed check: ${String(check.name)}`);
  }

  if (findings.length) {
    return findings.map((finding) => `${path.relative(root, proofPath)}: ${finding}`);
  }
  return [];
}

function latestProofForRuntime(runtime: string) {
  for (const proofPath of allRunnerProofFiles()) {
    const proof = readProof(proofPath);
    if (proof.runtime === runtime) return { proofPath, proof };
  }
  return null;
}

const { explicitProof, runtimes } = parseArgs();
const findings: string[] = [];
const audited: string[] = [];

if (runtimes.length > 0) {
  for (const runtime of runtimes) {
    const match = explicitProof ? { proofPath: explicitProof, proof: readProof(explicitProof) } : latestProofForRuntime(runtime);
    if (!match) {
      findings.push(`No runner proof artifact found for runtime ${runtime}. Run \`go run ./apps/daemon runtime-smoke --runtime ${runtime}\` first.`);
      continue;
    }
    findings.push(...validateProof(match.proof, match.proofPath, runtime));
    audited.push(`${runtime}:${path.relative(root, match.proofPath)}`);
  }
} else {
  const proofPath = proofPathFromArgs(explicitProof);
  if (!proofPath) {
    fail(["No runner proof artifact found. Run `go run ./apps/daemon runtime-smoke --runtime claude` first."]);
  }
  const proof = readProof(proofPath);
  findings.push(...validateProof(proof, proofPath));
  audited.push(`${String(proof.runtime)}:${path.relative(root, proofPath)}`);
}

if (findings.length) fail(findings);

console.log(`Runner proof audit passed: ${audited.join(", ")}.`);
