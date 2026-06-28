import {
  Play,
  Activity,
  Bot,
  FolderKanban,
  Workflow,
  Wrench,
  Database,
  RadioTower,
  Settings,
  LayoutDashboard,
  Monitor,
  BookOpenText,
  Network,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "./permissions";

export type NavGroup =
  | "control"
  | "build"
  | "knowledge"
  | "system"
  | "configure";

export interface NavItem {
  key: string;
  label: string;
  /** path segment under /{team} */
  segment: string;
  icon: LucideIcon;
  group: NavGroup;
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
  // CONTROL PLANE
  {
    key: "command-center",
    label: "Command Center",
    segment: "command-center",
    icon: LayoutDashboard,
    group: "control",
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
    hotkey: "a",
    permission: "agent:read",
  },
  {
    key: "fleet",
    label: "Fleet",
    segment: "agents/fleet",
    icon: Network,
    group: "control",
    hotkey: "f",
    permission: "agent:read",
  },
  // BUILD
  {
    key: "workflows",
    label: "Workflows",
    segment: "workflows",
    icon: Workflow,
    group: "build",
    hotkey: "w",
    permission: "workflow:read",
    comingSoon: true,
  },
  {
    key: "automations",
    label: "Automations",
    segment: "automations",
    icon: Zap,
    group: "build",
    hotkey: "z",
    permission: "agent:read",
  },
  {
    key: "tools",
    label: "Tools",
    segment: "tools",
    icon: Wrench,
    group: "build",
    hotkey: "t",
    permission: "tool:read",
  },
  // KNOWLEDGE
  {
    key: "memory",
    label: "Memory",
    segment: "memory",
    icon: Database,
    group: "knowledge",
    hotkey: "m",
    permission: "memory:read",
  },
  {
    key: "channels",
    label: "Telegram",
    segment: "channels",
    icon: RadioTower,
    group: "knowledge",
    hotkey: "h",
    permission: "settings:read",
  },
  // SYSTEM
  {
    key: "observability",
    label: "Observability",
    segment: "observability",
    icon: Activity,
    group: "system",
    hotkey: "o",
  },
  // CONFIGURE (Multica-style: runtimes, skills, settings)
  {
    key: "runtimes",
    label: "Runtimes",
    segment: "runtimes",
    icon: Monitor,
    group: "configure",
    hotkey: "u",
    permission: "settings:read",
  },
  {
    key: "skills",
    label: "Skills",
    segment: "skills",
    icon: BookOpenText,
    group: "configure",
    hotkey: "k",
    permission: "settings:read",
  },
  {
    key: "settings",
    label: "Settings",
    segment: "settings",
    icon: Settings,
    group: "configure",
    hotkey: "s",
    permission: "settings:read",
  },
];

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  control: "Control Plane",
  build: "Builder",
  knowledge: "Knowledge",
  system: "System",
  configure: "Configure",
};

/** Items shown in the mobile bottom tab bar (max 5; last is "More"). */
export const MOBILE_NAV_KEYS = [
  "command-center",
  "projects",
  "runs",
  "agents",
] as const;

export function hrefFor(team: string, segment: string): string {
  return `/${team}/${segment}`;
}
