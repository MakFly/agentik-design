"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRealtimeSync } from "@/lib/realtime/use-realtime-sync";
import { Topbar } from "./topbar";
import { Sidebar } from "./sidebar";
import { MobileTabBar } from "./mobile-nav";
import { CommandPalette } from "./command-palette";

export function AppShell({ team, children }: { team: string; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  // The runs kanban is full-bleed (no centered max-width container).
  const fullBleed = pathname?.endsWith("/runs") ?? false;

  // One realtime socket per team; events invalidate React Query caches.
  useRealtimeSync(team);

  return (
    <div className="min-h-dvh">
      <Topbar team={team} onMenu={() => setMobileOpen(true)} />

      <div className="flex">
        <aside className="sticky top-[var(--navbar-h)] hidden h-[calc(100dvh-var(--navbar-h))] shrink-0 overflow-y-auto border-r border-border bg-sidebar lg:block">
          <Sidebar team={team} />
        </aside>

        <main className="min-w-0 flex-1 pb-20 lg:pb-0">
          <div className={fullBleed ? "w-full p-4 md:p-6" : "mx-auto w-full max-w-[1600px] p-4 md:p-6"}>
            {children}
          </div>
        </main>
      </div>

      <MobileTabBar team={team} onMore={() => setMobileOpen(true)} />

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="pt-2">
            <Sidebar team={team} onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <CommandPalette team={team} />
    </div>
  );
}
