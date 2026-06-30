/**
 * Deployment mode resolver — the seam between the two targets.
 *
 *   solo     : one process, zero external services. Persistence is embedded PGlite
 *              under ~/.agentik/db; the embedded worker executes runs; Redis off.
 *   platform : managed Postgres (DATABASE_URL) + Redis + remote Go daemons.
 *
 * Explicit AGENTIK_MODE wins; otherwise infer from whether DATABASE_URL is set.
 */
import os from "os";
import path from "path";

export type Mode = "solo" | "platform";

function resolveMode(): Mode {
  const m = process.env.AGENTIK_MODE;
  if (m === "solo" || m === "platform") return m;
  return process.env.DATABASE_URL ? "platform" : "solo";
}

export const MODE: Mode = resolveMode();
export const isSolo = MODE === "solo";

/** Agentik state dir (matches the Go daemon's ~/.agentik). Override with $AGENTIK_HOME. */
export function agentikHome(): string {
  if (process.env.AGENTIK_HOME) return process.env.AGENTIK_HOME;
  const home = os.homedir();
  return home ? path.join(home, ".agentik") : path.join(process.cwd(), ".agentik");
}

/** Embedded PGlite data directory (persisted across restarts) for solo mode. */
export function soloDbDir(): string {
  return path.join(agentikHome(), "db");
}

/** Default team slug seeded in solo mode — matches the dev-header tenancy fallback. */
export const SOLO_TEAM_SLUG = process.env.AGENTIK_SOLO_TEAM ?? "acme";
