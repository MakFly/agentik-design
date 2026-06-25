import type { AgentConfig } from "@/types/domain";
import type { DraftIdentity } from "./validation";

/**
 * Local persistence for an in-progress agent draft. The autosave indicator promises
 * "Draft saved" — this is what makes that true: the working copy survives reload and
 * navigation. Published versions are immutable and live server-side; this is only the
 * unpublished draft. localStorage (no backend, no env) — best-effort, SSR-safe.
 */
export interface PersistedDraft {
  identity: DraftIdentity;
  config: AgentConfig;
}

const PREFIX = "agentik:agent-draft:";
export const draftKey = (team: string, scope: string) => `${PREFIX}${team}:${scope}`;

export function readDraft(key: string): PersistedDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as PersistedDraft) : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, draft: PersistedDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* quota exceeded / private mode — best-effort, the draft just won't persist */
  }
}

export function clearDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
