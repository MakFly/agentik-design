"use client";

import { useEffect, useState, type FC } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WrenchIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolsSection } from "./tools-section";

type SectionId = "tools";

type Section = {
  id: SectionId;
  label: string;
  icon: FC<{ className?: string }>;
  render: () => React.ReactNode;
};

const SECTIONS: readonly Section[] = [
  { id: "tools", label: "Tools", icon: WrenchIcon, render: () => <ToolsSection /> },
];

/**
 * Linear-style settings surface for the dashboard assistant: a full-screen view
 * with a section rail on the left and a content pane on the right. Escape (or the
 * close button) returns to the chat. Reachable at /{team}/dashboard/settings.
 */
export function DashboardSettings({ team }: { team: string }) {
  const router = useRouter();
  const backHref = `/${team}/dashboard`;
  const [active, setActive] = useState<SectionId>("tools");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(backHref);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, backHref]);

  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="text-muted-foreground truncate capitalize">{team}</span>
          <span className="text-muted-foreground/50">/</span>
          <span className="font-medium">Settings</span>
        </div>
        <Link
          href={backHref}
          aria-label="Close settings"
          className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs outline-none focus-visible:ring-2"
        >
          <span className="hidden sm:inline">Esc</span>
          <XIcon className="size-4" />
        </Link>
      </header>

      {/* Body: rail + content (rail becomes a top strip on mobile) */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-56 md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <p className="text-muted-foreground hidden px-2 pt-1 pb-2 text-xs font-medium tracking-wide uppercase md:block">
            Assistant
          </p>
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = s.id === active;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActive(s.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors",
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
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
            {current.render()}
          </div>
        </main>
      </div>
    </div>
  );
}
