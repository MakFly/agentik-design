import path from "node:path";
import { readAcceptanceMatrix, remainingAuditItems } from "./acceptance-matrix";

const root = path.resolve(import.meta.dir, "..");
const { rows, markdown } = readAcceptanceMatrix(root);

const findings: string[] = [];

if (!rows.length) {
  findings.push("Acceptance matrix has no current evidence rows.");
}

for (const row of rows) {
  if (row.status === "Harnessed") {
    findings.push(`line ${row.line}: ${row.requirement} is still Harnessed, not live-proven.`);
  }
  if (row.status === "Implemented") {
    findings.push(`line ${row.line}: ${row.requirement} is Implemented but not yet Tested.`);
  }
  if (row.status.startsWith("Contract-tested")) {
    findings.push(`line ${row.line}: ${row.requirement} is contract-tested but still needs live proof where environment-dependent.`);
  }
  if (/partially|partial|blocked|pending/i.test(row.status)) {
    findings.push(`line ${row.line}: ${row.requirement} is ${row.status}.`);
  }
}

for (const item of remainingAuditItems(markdown)) {
  findings.push(`remaining audit: ${item}`);
}

if (findings.length) {
  console.error("Completion audit failed. The goal is not yet fully proven:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Completion audit passed: ${rows.length} acceptance rows fully proven.`);
