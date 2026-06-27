import type { LocalDaemonStatus } from "./types";

export type DaemonState = "running" | "stopped" | "not_installed" | "unknown";

export interface DaemonView {
  state: DaemonState;
  running: boolean;
  /** Device name when known, else a generic "this machine". */
  device: string;
  pid?: number;
}

/**
 * Single source of truth for deriving the local daemon's presentational state
 * from a {@link LocalDaemonStatus}. Pure — consumers (sidebar card, runtimes
 * "this machine" card) layer their own wording/icons on top.
 */
export function deriveDaemonView(
  status: LocalDaemonStatus | undefined,
): DaemonView {
  if (!status) return { state: "unknown", running: false, device: "this machine" };
  const running = Boolean(status.health?.running ?? status.running);
  const device = status.health?.deviceName ?? "this machine";
  const pid = status.health?.pid;
  if (running) return { state: "running", running: true, device, pid };
  if (status.installed) return { state: "stopped", running: false, device };
  return { state: "not_installed", running: false, device };
}
