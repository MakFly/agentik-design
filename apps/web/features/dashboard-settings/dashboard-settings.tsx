"use client";

import { useEffect, useMemo, useState, type FC } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeftIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  WrenchIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ToolsSection } from "./tools-section";
import { PreferencesSection } from "./preferences-section";

type SectionId = "preferences" | "tools";

type Section = {
  id: SectionId;
  label: string;
  group: string;
  icon: FC<{ className?: string }>;
  render: () => React.ReactNode;
};

const SECTIONS: readonly Section[] = [
  { id: "preferences", label: "Preferences", group: "Personal", icon: SlidersHorizontalIcon, render: () => <PreferencesSection /> },
  { id: "tools", label: "Tools", group: "Assistant", icon: WrenchIcon, render: () => <ToolsSection /> },
];

const GROUP_ORDER = ["Personal", "Assistant"] as const;

/**
 * Linear-style settings surface for the dashboard assistant: a navigation
 * sidebar ("Back to app" + search + grouped sections) on the left and a content
 * pane on the right. Escape (or "Back to app") returns to the chat. Reachable at
 * /{team}/chat/settings.
 */
export function DashboardSettings({ team }: { team: string }) {
  const router = useRouter();
  const backHref = `/${team}/chat`;
  const [active, setActive] = useState<SectionId>("preferences");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(backHref);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, backHref]);

  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  // The search box filters the nav list only; the active section's content
  // stays visible even when its label is filtered out.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => s.label.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="flex h-dvh bg-background">
      {/* Navigation sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r">
        <div className="p-3">
          <Link
            href={backHref}
            className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2"
          >
            <ChevronLeftIcon className="size-4" />
            Back to app
          </Link>
        </div>

        <div className="px-3 pb-2">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              aria-label="Search settings"
              className="h-8 pl-8 text-sm shadow-none"
            />
          </div>
        </div>

        <nav
          aria-label="Settings sections"
          className="flex-1 space-y-4 overflow-y-auto px-2 pb-4 pt-2"
        >
          {GROUP_ORDER.map((group) => {
            const items = filtered.filter((s) => s.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="flex flex-col gap-0.5">
                <p className="text-muted-foreground px-2 pb-1 text-xs font-medium">
                  {group}
                </p>
                {items.map((s) => {
                  const Icon = s.icon;
                  const isActive = s.id === active;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => setActive(s.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
                        "hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 focus-visible:ring-2",
                        isActive
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-10 sm:px-10">
          {current.render()}
        </div>
      </main>
    </div>
  );
}
