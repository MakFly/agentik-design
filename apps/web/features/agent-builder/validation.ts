import type { AgentConfig, PromptVariable } from "@/types/domain";

export type Severity = "error" | "warning";
export interface Issue {
  section: BuilderSectionKey;
  severity: Severity;
  field?: string;
  message: string;
}

/**
 * Builder sections — the agent contract (role · goal · runtime · tools · memory ·
 * policy/approval) laid out identity-first. `persona` merges identity + system
 * prompt; `policy` merges limits, retry and guardrails. `delegation` wires the
 * roster (orchestrator → subagents); `reactivity` wires channel listen/act.
 */
export type BuilderSectionKey =
  | "persona"
  | "runtime"
  | "tools"
  | "memory"
  | "delegation"
  | "reactivity"
  | "policy"
  | "review";

export interface DraftIdentity {
  name: string;
  role: string;
  goal: string;
  /** OpenClaw-style identity: a glanceable avatar for rosters and the Fleet graph. */
  emoji?: string;
  color?: string;
  description?: string;
  /** Orchestrators delegate to a roster of subagents (Fleet graph parent nodes). */
  isOrchestrator?: boolean;
}

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Extract `{{variable}}` references from a prompt. */
export function promptVariables(prompt: string): string[] {
  const out = new Set<string>();
  for (const m of prompt.matchAll(VAR_RE)) out.add(m[1]);
  return [...out];
}

/**
 * Reconcile `config.promptVariables` with the `{{vars}}` actually present in the
 * prompt: keep the declared source/required for vars still referenced, add new
 * ones with sane defaults, drop vars no longer used. This is what makes the
 * variables panel real — the old editor detected vars but never synced them.
 */
export function syncPromptVariables(prompt: string, existing: PromptVariable[]): PromptVariable[] {
  const found = promptVariables(prompt);
  const byKey = new Map(existing.map((v) => [v.key, v]));
  return found.map((key) => byKey.get(key) ?? { key, source: "input", required: true });
}

/** Cheap token estimate (~4 chars/token) for the prompt counter. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Validate a draft into a flat issue list. Errors block Publish; warnings don't
 * (e.g. a write-scoped tool without an approval gate warns).
 */
export function validateDraft(identity: DraftIdentity, config: AgentConfig): Issue[] {
  const issues: Issue[] = [];

  if (!identity.name.trim()) issues.push({ section: "persona", severity: "error", field: "name", message: "Name is required." });
  if (!identity.role.trim()) issues.push({ section: "persona", severity: "error", field: "role", message: "Role is required." });
  if (!identity.goal.trim()) issues.push({ section: "persona", severity: "warning", field: "goal", message: "A clear goal improves agent behavior." });
  if (!config.systemPrompt.trim()) issues.push({ section: "persona", severity: "error", field: "systemPrompt", message: "System prompt is required." });

  if (!config.model.model) issues.push({ section: "runtime", severity: "error", field: "model", message: "Select a model." });
  if (config.model.temperature < 0 || config.model.temperature > 2)
    issues.push({ section: "runtime", severity: "error", field: "temperature", message: "Temperature must be between 0 and 2." });
  if (config.model.maxTokens <= 0) issues.push({ section: "runtime", severity: "error", field: "maxTokens", message: "Max tokens must be positive." });

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
    issues.push({ section: "policy", severity: "error", field: "maxCostPerRun", message: "Set a positive cost cap per run." });
  if (config.limits.timeoutMs < 1000)
    issues.push({ section: "policy", severity: "warning", field: "timeoutMs", message: "Timeout under 1s may abort legitimate runs." });
  if (config.tools.length > 0 && config.guardrails.egressAllowlist.length === 0)
    issues.push({ section: "policy", severity: "warning", field: "egress", message: "No egress allowlist — the agent can reach any domain its tools allow." });

  return issues;
}

export function errorCount(issues: Issue[]): number {
  return issues.filter((i) => i.severity === "error").length;
}

export function issuesForSection(issues: Issue[], section: BuilderSectionKey): Issue[] {
  return issues.filter((i) => i.section === section);
}
