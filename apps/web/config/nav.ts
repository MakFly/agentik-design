import {
  Play,
  Activity,
  Bot,
  FolderKanban,
  Wrench,
  Database,
  RadioTower,
  Settings,
  LayoutDashboard,
  Monitor,
  MessageSquare,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "./permissions";

export type NavGroup =
  | "control"
  | "agent"
  | "build"
  | "knowledge"
  | "system"
  | "configure";

/**
 * Two product surfaces with distinct shells:
 * - `assistant`: the OpenClaw-style personal assistant (chat + its personal context),
 *   served from the team root (`/{team}/chat`, `/{team}/memory`, …).
 * - `platform`: the Multica business control-plane, served under `/{team}/platform/*`.
 */
export type NavSurface = "assistant" | "platform";

export interface NavItem {
  key: string;
  label: string;
  /** path segment (after the surface prefix) */
  segment: string;
  icon: LucideIcon;
  group: NavGroup;
  /** which product surface this item belongs to */
  surface: NavSurface;
  /** `g`-prefixed go-to shortcut letter */
  hotkey: string;
  /** permission required to see the item; undefined = always visible */
  permission?: Permission;
  /** live-count badge source key (resolved from realtime/session) */
  badge?: "activeRuns" | "approvals";
  /** feature shipped but temporarily disabled — shown as non-clickable "In progress" */
  comingSoon?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  // ── ASSISTANT surface (personal assistant, served from the team root) ──
  {
    key: "chat",
    label: "Chat",
    segment: "chat",
    icon: MessageSquare,
    group: "control",
    surface: "assistant",
    hotkey: "c",
    permission: "run:read",
  },
  {
    key: "assistant-activity",
    label: "Activity",
    segment: "activity",
    icon: Activity,
    group: "control",
    surface: "assistant",
    hotkey: "y",
    permission: "run:read",
    badge: "activeRuns",
  },
  {
    key: "assistant-agents",
    label: "Agents",
    segment: "agents",
    icon: Bot,
    group: "agent",
    surface: "assistant",
    hotkey: "e",
    permission: "agent:read",
  },
  {
    key: "assistant-skills",
    label: "Skills",
    segment: "skills",
    icon: Sparkles,
    group: "agent",
    surface: "assistant",
    hotkey: "k",
    permission: "skill:read",
  },
  {
    key: "memory",
    label: "Memory",
    segment: "memory",
    icon: Database,
    group: "knowledge",
    surface: "assistant",
    hotkey: "m",
    permission: "memory:read",
  },
  {
    key: "automations",
    label: "Automations",
    segment: "automations",
    icon: Zap,
    group: "build",
    surface: "assistant",
    hotkey: "z",
    permission: "agent:read",
  },
  {
    key: "channels",
    label: "Telegram",
    segment: "channels",
    icon: RadioTower,
    group: "knowledge",
    surface: "assistant",
    hotkey: "h",
    permission: "settings:read",
  },
  // ── PLATFORM surface (Multica control-plane, served under /platform/*) ──
  {
    key: "command-center",
    label: "Command Center",
    segment: "command-center",
    icon: LayoutDashboard,
    group: "control",
    surface: "platform",
    hotkey: "g",
    permission: "run:read",
    badge: "approvals",
  },
  {
    key: "projects",
    label: "Projects",
    segment: "projects",
    icon: FolderKanban,
    group: "control",
    surface: "platform",
    hotkey: "p",
    permission: "run:read",
    badge: "activeRuns",
  },
  {
    key: "runs",
    label: "Runs",
    segment: "runs",
    icon: Play,
    group: "control",
    surface: "platform",
    hotkey: "r",
    permission: "run:read",
    badge: "activeRuns",
  },
  {
    key: "agents",
    label: "Agents",
    segment: "agents",
    icon: Bot,
    group: "control",
    surface: "platform",
    hotkey: "a",
    permission: "agent:read",
  },
  {
    key: "tools",
    label: "Tools",
    segment: "tools",
    icon: Wrench,
    group: "build",
    surface: "platform",
    hotkey: "t",
    permission: "tool:read",
  },
  {
    key: "observability",
    label: "Observability",
    segment: "observability",
    icon: Activity,
    group: "system",
    surface: "platform",
    hotkey: "o",
  },
  {
    key: "runtimes",
    label: "Runtimes",
    segment: "runtimes",
    icon: Monitor,
    group: "configure",
    surface: "platform",
    hotkey: "u",
    permission: "settings:read",
  },
  {
    key: "settings",
    label: "Settings",
    segment: "settings",
    icon: Settings,
    group: "configure",
    surface: "platform",
    hotkey: "s",
    permission: "settings:read",
  },
];

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  control: "Control Plane",
  agent: "Agent",
  build: "Builder",
  knowledge: "Knowledge",
  system: "System",
  configure: "Configure",
};

/** Display order + labels for the assistant sidebar's grouped sections (OpenClaw-style). */
export const ASSISTANT_GROUP_ORDER: { group: NavGroup; label: string }[] = [
  { group: "control", label: "Control" },
  { group: "agent", label: "Agent" },
  { group: "knowledge", label: "Knowledge" },
  { group: "build", label: "Automation" },
];

/** Segments served under the `/platform/*` prefix (the Multica surface). */
export const PLATFORM_SEGMENTS = new Set(
  NAV_ITEMS.filter((i) => i.surface === "platform").map((i) => i.segment),
);

export function navItemsForSurface(surface: NavSurface): NavItem[] {
  return NAV_ITEMS.filter((i) => i.surface === surface);
}

/** Items shown in the mobile bottom tab bar (max 5; last is "More"). */
export const MOBILE_NAV_KEYS = [
  "command-center",
  "projects",
  "runs",
  "agents",
] as const;

/**
 * Build a route href. Platform segments live under `/{team}/platform/*`; everything else
 * (assistant surface) is served from the team root. `rest` appends a dynamic tail
 * (e.g. a run id) — pass without a leading slash.
 */
export function hrefFor(team: string, segment: string, rest?: string): string {
  const base = PLATFORM_SEGMENTS.has(segment)
    ? `/${team}/platform/${segment}`
    : `/${team}/${segment}`;
  return rest ? `${base}/${rest}` : base;
}
