"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { navItemsForSurface, hrefFor } from "@/config/nav";
import { useRbac } from "@/lib/auth/rbac";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
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
 * assistant's personal context (Memory, Automations, Telegram), and a link across to the
 * Multica platform. Chat itself is reached via the switcher, not a nav link.
 */
export function AssistantSidebar({ team }: { team: string }) {
  const pathname = usePathname();
  const { can } = useRbac();
  const items = navItemsForSurface("assistant").filter(
    (i) => i.key !== "chat" && (!i.permission || can(i.permission)),
  );

  return (
    <Sidebar collapsible="icon" variant="inset" className="select-none">
      <SidebarHeader>
        <TeamSwitcher team={team} />
        <AgentSwitcher team={team} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu className="gap-0.5">
            {items.map((item) => {
              const href = hrefFor(team, item.segment);
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
            })}
          </SidebarMenu>
        </SidebarGroup>
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
