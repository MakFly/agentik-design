"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare } from "lucide-react";
import {
  navItemsForSurface,
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

export function PlatformSidebar({ team }: { team: string }) {
  const pathname = usePathname();
  const { can } = useRbac();
  const indicators = useIndicators();

  const visible = navItemsForSurface("platform").filter(
    (i) => !i.permission || can(i.permission),
  );

  // Active item = the one whose href is the longest prefix of the current
  // pathname. This keeps nested routes (e.g. /agents/123) highlighting their
  // parent while preventing a shorter parent (/agents) from also lighting up
  // when a more specific sibling (/agents/fleet) is the real match.
  const activeKey = visible.reduce<{ key: string | null; len: number }>(
    (best, item) => {
      const href = hrefFor(team, item.segment);
      if (pathname === href || pathname.startsWith(`${href}/`)) {
        if (href.length > best.len) return { key: item.key, len: href.length };
      }
      return best;
    },
    { key: null, len: -1 },
  ).key;

  function badgeFor(item: NavItem): number {
    if (item.badge === "activeRuns") return indicators.activeRuns;
    if (item.badge === "approvals") return indicators.approvals;
    return 0;
  }

  return (
    <Sidebar collapsible="icon" variant="inset" className="select-none">
      <SidebarHeader>
        <TeamSwitcher team={team} />
        {/* Back to the personal assistant surface (chat). */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Back to the Assistant"
              className={MENU_BUTTON_CLASS}
            >
              <Link href={hrefFor(team, "chat")}>
                <MessageSquare aria-hidden="true" />
                <span>Assistant</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
                  const active = item.key === activeKey;
                  const Icon = item.icon;
                  const count = badgeFor(item);

                  if (item.comingSoon) {
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton
                          disabled
                          tooltip={`${item.label} — In progress`}
                          className={MENU_BUTTON_CLASS}
                          aria-disabled="true"
                        >
                          <Icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        <SidebarMenuBadge className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          In progress
                        </SidebarMenuBadge>
                      </SidebarMenuItem>
                    );
                  }

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
