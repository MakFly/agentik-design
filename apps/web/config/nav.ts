import {
  LayoutDashboard,
  Play,
  MessageSquare,
  Activity,
  Bot,
  Workflow,
  Wrench,
  Database,
  FlaskConical,
  ClipboardCheck,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "./permissions";

export type NavGroup = "observe" | "author" | "quality" | "system";

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
}

export const NAV_ITEMS: NavItem[] = [
  // OBSERVE
  { key: "dashboard", label: "Hermes Lite", segment: "thechat", icon: LayoutDashboard, group: "observe", hotkey: "d" },
  { key: "runs", label: "Executions", segment: "runs", icon: Play, group: "observe", hotkey: "r", permission: "run:read", badge: "activeRuns" },
  { key: "chat", label: "Chat", segment: "chat", icon: MessageSquare, group: "observe", hotkey: "c", permission: "run:read" },
  { key: "observability", label: "Observability", segment: "observability", icon: Activity, group: "observe", hotkey: "o" },
  // AUTHOR
  { key: "agents", label: "Agents", segment: "agents", icon: Bot, group: "author", hotkey: "a", permission: "agent:read" },
  { key: "workflows", label: "Workflows", segment: "workflows", icon: Workflow, group: "author", hotkey: "w", permission: "workflow:read" },
  { key: "tools", label: "Tools", segment: "tools", icon: Wrench, group: "author", hotkey: "t", permission: "tool:read" },
  { key: "memory", label: "Memory", segment: "memory", icon: Database, group: "author", hotkey: "m", permission: "memory:read" },
  // QUALITY
  { key: "reviews", label: "Reviews", segment: "reviews", icon: ClipboardCheck, group: "quality", hotkey: "v", permission: "review:read" },
  { key: "evals", label: "Evals", segment: "evals", icon: FlaskConical, group: "quality", hotkey: "e", permission: "eval:read" },
  // SYSTEM
  { key: "settings", label: "Settings", segment: "settings", icon: Settings, group: "system", hotkey: "s", permission: "settings:read" },
];

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  observe: "Pilotage",
  author: "Author",
  quality: "Quality",
  system: "",
};

/** Items shown in the mobile bottom tab bar (max 5; last is "More"). */
export const MOBILE_NAV_KEYS = ["dashboard", "runs", "agents", "tools"] as const;

export function hrefFor(team: string, segment: string): string {
  return `/${team}/${segment}`;
}
