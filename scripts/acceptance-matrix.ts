import { readFileSync } from "node:fs";
import path from "node:path";

export type AcceptanceRow = {
  requirement: string;
  evidence: string;
  status: string;
  line: number;
};

export function acceptanceMatrixPath(root: string) {
  return path.join(root, "docs/agentic-system/ACCEPTANCE_MATRIX.md");
}

export function readAcceptanceMatrix(root: string) {
  const matrixPath = acceptanceMatrixPath(root);
  const markdown = readFileSync(matrixPath, "utf8");
  return { matrixPath, markdown, rows: parseAcceptanceRows(markdown) };
}

export function parseAcceptanceRows(markdown: string): AcceptanceRow[] {
  const rows: AcceptanceRow[] = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (!line.startsWith("|")) return;
    if (/^\|\s*-+/.test(line) || line.includes("| Requirement |")) return;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 3) return;
    rows.push({
      requirement: cells[0]!,
      evidence: cells[1]!,
      status: cells[2]!,
      line: index + 1,
    });
  });
  return rows;
}

export function evidenceItems(cell: string) {
  const backticked = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!.trim());
  if (backticked.length) return backticked;
  return cell
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function remainingAuditItems(markdown: string) {
  const match = markdown.match(/## Remaining Audit Before Completion\s*\n([\s\S]*)$/);
  if (!match?.[1]) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}
