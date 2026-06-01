import type { AgentConfig } from "@/types/domain";

export type Severity = "error" | "warning";
export interface Issue {
  section: BuilderSectionKey;
  severity: Severity;
  field?: string;
  message: string;
}

export type BuilderSectionKey =
  | "identity"
  | "model"
  | "prompt"
  | "tools"
  | "memory"
  | "limits"
  | "guardrails"
  | "review";

export interface DraftIdentity {
  name: string;
  role: string;
  goal: string;
}

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Extract `{{variable}}` references from a prompt. */
export function promptVariables(prompt: string): string[] {
  const out = new Set<string>();
  for (const m of prompt.matchAll(VAR_RE)) out.add(m[1]);
  return [...out];
}

/** Cheap token estimate (~4 chars/token) for the prompt counter. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Validate a draft into a flat issue list. Errors block Publish; warnings don't
 * (docs/01 §4.2 — e.g. a write-scoped tool without an approval gate warns).
 */
export function validateDraft(identity: DraftIdentity, config: AgentConfig): Issue[] {
  const issues: Issue[] = [];

  if (!identity.name.trim()) issues.push({ section: "identity", severity: "error", field: "name", message: "Name is required." });
  if (!identity.role.trim()) issues.push({ section: "identity", severity: "error", field: "role", message: "Role is required." });
  if (!identity.goal.trim()) issues.push({ section: "identity", severity: "warning", field: "goal", message: "A clear goal improves agent behavior." });

  if (!config.model.model) issues.push({ section: "model", severity: "error", field: "model", message: "Select a model." });
  if (config.model.temperature < 0 || config.model.temperature > 2)
    issues.push({ section: "model", severity: "error", field: "temperature", message: "Temperature must be between 0 and 2." });
  if (config.model.maxTokens <= 0) issues.push({ section: "model", severity: "error", field: "maxTokens", message: "Max tokens must be positive." });

  if (!config.systemPrompt.trim()) issues.push({ section: "prompt", severity: "error", field: "systemPrompt", message: "System prompt is required." });

  // tools: write/admin scope without an approval gate is a warning, not a block
  for (const grant of config.tools) {
    const writeScope = grant.scopes.some((s) => /write|admin|create|delete|refund/i.test(s));
    if (writeScope && !grant.requireApproval) {
      issues.push({
        section: "tools",
        severity: "warning",
        field: grant.toolId,
        message: `Tool "${grant.toolId}" has a write/admin scope without an approval gate.`,
      });
    }
  }

  if (config.limits.maxCostPerRun.amountCents <= 0)
    issues.push({ section: "limits", severity: "error", field: "maxCostPerRun", message: "Set a positive cost cap per run." });
  if (config.limits.timeoutMs < 1000)
    issues.push({ section: "limits", severity: "warning", field: "timeoutMs", message: "Timeout under 1s may abort legitimate runs." });

  if (config.tools.length > 0 && config.guardrails.egressAllowlist.length === 0)
    issues.push({ section: "guardrails", severity: "warning", message: "No egress allowlist — the agent can reach any domain its tools allow." });

  return issues;
}

export function errorCount(issues: Issue[]): number {
  return issues.filter((i) => i.severity === "error").length;
}

export function issuesForSection(issues: Issue[], section: BuilderSectionKey): Issue[] {
  return issues.filter((i) => i.section === section);
}
