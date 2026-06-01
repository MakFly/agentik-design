"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, NAV_GROUP_LABELS, hrefFor, type NavGroup, type NavItem } from "@/config/nav";
import { useUiStore } from "@/lib/stores/ui.store";
import { useRbac } from "@/lib/auth/rbac";
import { useIndicators } from "@/lib/hooks/use-indicators";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const GROUP_ORDER: NavGroup[] = ["observe", "author", "quality", "system"];

export function Sidebar({ team, onNavigate }: { team: string; onNavigate?: () => void }) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
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
    <nav
      aria-label="Primary"
      className={cn("flex h-full flex-col gap-4 overflow-y-auto p-3", collapsed ? "w-16" : "w-60")}
    >
      {GROUP_ORDER.map((group) => {
        const items = visible.filter((i) => i.group === group);
        if (!items.length) return null;
        return (
          <div key={group} className="flex flex-col gap-0.5">
            {!collapsed && NAV_GROUP_LABELS[group] ? (
              <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-subtle-foreground uppercase">
                {NAV_GROUP_LABELS[group]}
              </p>
            ) : null}
            {items.map((item) => {
              const href = hrefFor(team, item.segment);
              const active = pathname === href || pathname.startsWith(`${href}/`);
              const Icon = item.icon;
              const count = badgeFor(item);

              const link = (
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex min-h-[40px] items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                    collapsed && "justify-center",
                  )}
                >
                  {active ? (
                    <span
                      className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                  {!collapsed && count > 0 ? (
                    <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
                      {count}
                    </span>
                  ) : null}
                  {collapsed && count > 0 ? (
                    <span className="absolute top-1 right-1 size-2 rounded-full bg-primary" aria-hidden="true" />
                  ) : null}
                </Link>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.key}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              }
              return <div key={item.key}>{link}</div>;
            })}
          </div>
        );
      })}
    </nav>
  );
}
