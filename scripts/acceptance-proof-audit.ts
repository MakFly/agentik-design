import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const proofDir = path.join(root, "artifacts/acceptance");

const requiredChecks = [
  "engine health is reachable",
  "web login is reachable",
  "mailpit API is reachable",
  "dev autofill login succeeds",
  "logged in org is demo",
  "seed created 4 agents",
  "seed created 4 demo runs",
  "seed created gmail webhook token",
  "simulation pass 1 has 2 approval-gated runs",
  "seed has 2 historical triage runs already succeeded",
  "simulation pass 2 succeeds after approvals",
  "invoice email delivery recorded",
  "kickoff email delivery recorded",
  "agents page: officeManager",
  "agents page: billing",
  "agents page: scheduler",
  "fleet graph renders",
  "project cockpit: projectName",
  "project cockpit: tasks",
  "project cockpit: agentConsole",
  "project cockpit: runInstruction",
  "project cockpit: latestRun",
  "project cockpit: projectContext",
  "project cockpit: activeRuns",
  "project cockpit: resources",
  "project cockpit: linkedChannels",
  "project cockpit: invoiceTask",
  "seed exposes an invoice run detail",
  "run detail view: transcript",
  "run detail view: projectTask",
  "run detail view: runMetadata",
  "run detail view: operatorInput",
  "run detail view: projectName",
  "run detail view: taskTitle",
  "run detail view: invoiceEvidence",
  "connections page: heading",
  "connections page: connectButton",
];

type Proof = {
  id?: unknown;
  status?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  urls?: { engine?: unknown; web?: unknown; mailpit?: unknown };
  seed?: { projectId?: unknown; runIds?: unknown; agentCount?: unknown };
  checks?: Array<{ name?: unknown; ok?: unknown }>;
  error?: unknown;
};

function latestProofFile() {
  if (!existsSync(proofDir)) return null;
  const files = readdirSync(proofDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(proofDir, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

function proofPathFromArgs() {
  const explicit = process.argv[2] ?? process.env.ACCEPTANCE_PROOF_FILE;
  if (explicit) return path.resolve(explicit);
  return latestProofFile();
}

function fail(messages: string[]): never {
  console.error("Acceptance proof audit failed:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}

const proofPath = proofPathFromArgs();
if (!proofPath) {
  fail([
    "No proof artifact found. Run `bun run apps/web/scripts/e2e-seeded-loop.ts` against a live dev stack first.",
  ]);
}
if (!existsSync(proofPath)) fail([`Proof artifact does not exist: ${proofPath}`]);

let proof: Proof;
try {
  proof = JSON.parse(readFileSync(proofPath, "utf8")) as Proof;
} catch (error) {
  fail([`Could not parse proof artifact ${proofPath}: ${error instanceof Error ? error.message : String(error)}`]);
}

const findings: string[] = [];
if (typeof proof.id !== "string" || !proof.id.startsWith("agentik-loop-")) {
  findings.push("id must be an agentik-loop session id.");
}
if (proof.status !== "passed") {
  findings.push(`status must be "passed", got ${JSON.stringify(proof.status)}.`);
}
if (typeof proof.startedAt !== "string" || typeof proof.finishedAt !== "string") {
  findings.push("startedAt and finishedAt must be ISO timestamp strings.");
}
for (const key of ["engine", "web", "mailpit"] as const) {
  if (typeof proof.urls?.[key] !== "string" || !String(proof.urls[key]).startsWith("http")) {
    findings.push(`urls.${key} must be an http URL.`);
  }
}
if (typeof proof.seed?.projectId !== "string" || !proof.seed.projectId) {
  findings.push("seed.projectId is required.");
}
if (!Array.isArray(proof.seed?.runIds) || proof.seed.runIds.length !== 4) {
  findings.push("seed.runIds must contain the 4 seeded demo runs.");
}
if (proof.seed?.agentCount !== 4) {
  findings.push("seed.agentCount must be 4.");
}
if (!Array.isArray(proof.checks) || proof.checks.length === 0) {
  findings.push("checks must be a non-empty array.");
}

const checks = new Map((proof.checks ?? []).map((check) => [String(check.name), check.ok]));
for (const required of requiredChecks) {
  if (!checks.has(required)) findings.push(`missing check: ${required}`);
  else if (checks.get(required) !== true) findings.push(`check is not passing: ${required}`);
}
for (const check of proof.checks ?? []) {
  if (check.ok !== true) findings.push(`proof contains failed check: ${String(check.name)}`);
}
if (proof.error) findings.push(`passed proof must not contain error: ${String(proof.error)}`);

if (findings.length) fail(findings);

console.log(`Acceptance proof audit passed: ${path.relative(root, proofPath)} (${requiredChecks.length} required checks).`);
