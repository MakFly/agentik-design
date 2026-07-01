"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import {
  navItemsForSurface,
  hrefFor,
  ASSISTANT_GROUP_ORDER,
  type NavItem,
} from "@/config/nav";
import { useRbac } from "@/lib/auth/rbac";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
} from "@/components/ui/sidebar";
import { TeamSwitcher } from "./team-switcher";
import { NavUser } from "./nav-user";
import { DaemonStatusFooter } from "./daemon-status";
import { AgentSwitcher } from "@/features/agent-chat/agent-switcher";

const MENU_BUTTON_CLASS =
  "text-muted-foreground hover:not-data-[active=true]:bg-sidebar-accent/70 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground";

/**
 * Personal assistant sidebar (OpenClaw-style): the agent switcher + "+" lead, then the
 * assistant's context grouped into labeled sections (Control · Agent · Knowledge ·
 * Automation), mirroring OpenClaw's single rich sidebar, and a link across to the Multica
 * platform for the heavier ops. Chat itself is reached via the switcher, not a nav link.
 *
 * Assistant items are all served from the team root, so hrefs are built directly
 * (`/{team}/{segment}`) — not via `hrefFor`, which would mis-route segments that also
 * exist on the platform surface (e.g. `agents`).
 */
export function AssistantSidebar({ team }: { team: string }) {
  const pathname = usePathname();
  const { can } = useRbac();
  const visible = navItemsForSurface("assistant").filter(
    (i) => i.key !== "chat" && (!i.permission || can(i.permission)),
  );

  const groups = ASSISTANT_GROUP_ORDER.map(({ group, label }) => ({
    label,
    items: visible.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);

  const renderItem = (item: NavItem) => {
    const href = `/${team}/assistant/${item.segment}`;
    const active = pathname === href || pathname.startsWith(`${href}/`);
    const Icon = item.icon;
    return (
      <SidebarMenuItem key={item.key}>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={item.label}
          className={MENU_BUTTON_CLASS}
        >
          <Link href={href} aria-current={active ? "page" : undefined}>
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon" variant="inset" className="select-none">
      <SidebarHeader>
        <TeamSwitcher team={team} />
        <AgentSwitcher team={team} />
      </SidebarHeader>

      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarMenu className="gap-0.5">{g.items.map(renderItem)}</SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Open the Multica platform"
              className={MENU_BUTTON_CLASS}
            >
              <Link href={hrefFor(team, "command-center")}>
                <LayoutGrid aria-hidden="true" />
                <span>Multica platform</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <DaemonStatusFooter />
        <NavUser team={team} />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
