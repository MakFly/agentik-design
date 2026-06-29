import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { evidenceItems, readAcceptanceMatrix } from "./acceptance-matrix";

const root = path.resolve(import.meta.dir, "..");
const allowedStatuses = new Set(["Implemented", "Tested", "Harnessed"]);

type Finding = {
  row: number;
  requirement: string;
  message: string;
};

function rel(file: string) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function allFiles(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) allFiles(full, out);
    else out.push(rel(full));
  }
  return out;
}

function globToRegex(pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", "[^/]*")}$`);
}

function evidenceExists(evidence: string, files: string[]) {
  if (evidence.includes("*")) {
    const rx = globToRegex(evidence);
    return files.some((file) => rx.test(file));
  }
  return existsSync(path.join(root, evidence));
}

const { markdown, rows } = readAcceptanceMatrix(root);
const files = allFiles(root);
const findings: Finding[] = [];

if (!rows.length) {
  findings.push({ row: 0, requirement: "matrix", message: "No acceptance rows found." });
}

for (const row of rows) {
  const statusOk =
    allowedStatuses.has(row.status) ||
    row.status.startsWith("Contract-tested") ||
    row.status.startsWith("Partially live-tested");
  if (!statusOk) {
    findings.push({
      row: row.line,
      requirement: row.requirement,
      message: `Unknown status "${row.status}".`,
    });
  }

  const items = evidenceItems(row.evidence);
  if (!items.length) {
    findings.push({
      row: row.line,
      requirement: row.requirement,
      message: "Evidence cell is empty.",
    });
    continue;
  }

  for (const item of items) {
    if (!evidenceExists(item, files)) {
      findings.push({
        row: row.line,
        requirement: row.requirement,
        message: `Evidence path does not exist: ${item}`,
      });
    }
  }
}

if (!/## Remaining Audit Before Completion/.test(markdown)) {
  findings.push({
    row: 0,
    requirement: "remaining audit",
    message: "Missing Remaining Audit Before Completion section.",
  });
}

if (findings.length) {
  console.error("Acceptance audit failed:");
  for (const finding of findings) {
    const prefix = finding.row ? `line ${finding.row}` : "matrix";
    console.error(`- ${prefix}: ${finding.requirement} — ${finding.message}`);
  }
  process.exit(1);
}

console.log(`Acceptance audit passed: ${rows.length} rows, ${files.length} files indexed.`);
