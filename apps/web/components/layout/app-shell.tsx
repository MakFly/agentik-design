"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { useRealtimeSync } from "@/lib/realtime/use-realtime-sync";
import { usePreferencesStore } from "@/lib/stores/preferences.store";
import { Topbar } from "./topbar";
import { AppSidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";

export function AppShell({
  team,
  children,
}: {
  team: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // The runs kanban is full-bleed (no centered max-width container).
  const fullBleed = pathname?.endsWith("/runs") ?? false;
  // The chat surface (/{team}/chat*) is immersive: no topbar, full height.
  const segment = pathname?.split("/")[2];
  const isChat = segment === "chat";
  const isConfigure = ["runtimes", "skills", "settings"].includes(
    segment ?? "",
  );
  const isSettings = segment === "settings";

  // One realtime socket per team; events invalidate React Query caches.
  useRealtimeSync(team);

  // Apply the "Reduce motion" preference app-wide.
  const reduceMotion = usePreferencesStore((s) => s.reduceMotion);
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
  }, [reduceMotion]);

  return (
    <SidebarProvider
      key={isChat ? "chat-shell" : "app-shell"}
      defaultOpen={!isChat}
    >
      <AppSidebar team={team} />
      <SidebarInset className="min-w-0">
        {isChat ? (
          <div className="h-svh overflow-hidden">{children}</div>
        ) : (
          <>
            <Topbar />
            <main className="min-w-0 flex-1 overflow-x-hidden">
              <div
                className={
                  isSettings
                    ? "w-full"
                    : isConfigure
                      ? "w-full p-4 md:p-6"
                      : fullBleed
                        ? "w-full p-4 md:p-6"
                        : "mx-auto w-full max-w-[1600px] p-4 md:p-6"
                }
              >
                {children}
              </div>
            </main>
          </>
        )}
        <CommandPalette team={team} />
      </SidebarInset>
    </SidebarProvider>
  );
}
