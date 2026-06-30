/**
 * Adapter resolution policy: CLI first (parity with the platform daemon), then a
 * provider API key (zero-install solo path), else null — the run "needs setup",
 * surfaced in the cockpit. Matches the chosen behavior: CLI default, API fallback,
 * clear status when nothing is configured.
 */
import type { ClaimedTask } from "../../daemon/service";
import type { RuntimeAdapter } from "./types";
import { cliAdapter, cliBinaryFor } from "./cli";
import { apiAdapter, resolveApiProvider } from "./api";

export const SETUP_HINT =
  "No runtime available for this agent. Install a CLI (claude, codex, or hermes) on the host, or add a provider API key (Anthropic / OpenAI / Google) in Settings → Providers.";

export function resolveAdapter(
  task: ClaimedTask,
  kind: string,
): RuntimeAdapter | null {
  const bin = cliBinaryFor(kind);
  if (bin) return cliAdapter(kind, bin);

  const provider = resolveApiProvider(kind, task.env ?? {});
  if (provider) return apiAdapter(provider);

  return null;
}
