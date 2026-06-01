"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { NAV_ITEMS, MOBILE_NAV_KEYS, hrefFor } from "@/config/nav";
import { cn } from "@/lib/utils";

/** Bottom tab bar for <768px: 4 primary destinations + a "More" entry. */
export function MobileTabBar({ team, onMore }: { team: string; onMore?: () => void }) {
  const pathname = usePathname();
  const items = MOBILE_NAV_KEYS.map((k) => NAV_ITEMS.find((i) => i.key === k)).filter(
    (i): i is (typeof NAV_ITEMS)[number] => Boolean(i),
  );

  return (
    <nav
      aria-label="Primary mobile"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 backdrop-blur-sm lg:hidden"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      {items.map((item) => {
        const href = hrefFor(team, item.segment);
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-[44px] flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium text-muted-foreground"
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
        More
      </button>
    </nav>
  );
}
