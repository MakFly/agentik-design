"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  NAV_ITEMS,
  NAV_GROUP_LABELS,
  hrefFor,
  type NavGroup,
  type NavItem,
} from "@/config/nav";
import { useRbac } from "@/lib/auth/rbac";
import { useIndicators } from "@/lib/hooks/use-indicators";
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
  SidebarMenuBadge,
  SidebarRail,
} from "@/components/ui/sidebar";
import { TeamSwitcher } from "./team-switcher";
import { NavUser } from "./nav-user";
import { DaemonStatusFooter } from "./daemon-status";

const GROUP_ORDER: NavGroup[] = [
  "control",
  "build",
  "knowledge",
  "system",
  "configure",
];

const MENU_BUTTON_CLASS =
  "text-muted-foreground hover:not-data-[active=true]:bg-sidebar-accent/70 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground";

export function AppSidebar({ team }: { team: string }) {
  const pathname = usePathname();
  const { can } = useRbac();
  const indicators = useIndicators();

  const visible = NAV_ITEMS.filter((i) => !i.permission || can(i.permission));

  function badgeFor(item: NavItem): number {
    if (item.badge === "activeRuns") return indicators.activeRuns;
    if (item.badge === "approvals") return indicators.approvals;
    return 0;
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <TeamSwitcher team={team} />
      </SidebarHeader>

      <SidebarContent>
        {GROUP_ORDER.map((group) => {
          const items = visible.filter((i) => i.group === group);
          if (!items.length) return null;
          const label = NAV_GROUP_LABELS[group];
          return (
            <SidebarGroup key={group}>
              {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
              <SidebarMenu className="gap-0.5">
                {items.map((item) => {
                  const href = hrefFor(team, item.segment);
                  const active =
                    pathname === href || pathname.startsWith(`${href}/`);
                  const Icon = item.icon;
                  const count = badgeFor(item);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                        className={MENU_BUTTON_CLASS}
                      >
                        <Link
                          href={href}
                          aria-current={active ? "page" : undefined}
                        >
                          <Icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {count > 0 ? (
                        <SidebarMenuBadge className="tabular-nums">
                          {count}
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <DaemonStatusFooter />
        <NavUser team={team} />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
