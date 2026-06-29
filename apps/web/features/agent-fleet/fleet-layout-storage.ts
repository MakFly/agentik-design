/** Per-team canvas positions — local only, same spirit as workflow builder drafts. */

export type FleetLayoutPositions = Record<string, { x: number; y: number }>;

const key = (team: string) => `agentik:fleet-layout:${team}`;

function hasStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadFleetLayout(team: string): FleetLayoutPositions {
  if (!hasStorage()) return {};
  try {
    const raw = window.localStorage.getItem(key(team));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as FleetLayoutPositions;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveFleetLayout(team: string, positions: FleetLayoutPositions) {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key(team), JSON.stringify(positions));
  } catch {
    // quota / private mode — ignore
  }
}

export function positionsFromNodes(nodes: Array<{ id: string; position: { x: number; y: number } }>) {
  return Object.fromEntries(nodes.map((n) => [n.id, n.position]));
}
