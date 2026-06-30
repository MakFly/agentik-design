"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { useRealtimeSync } from "@/lib/realtime/use-realtime-sync";
import { usePreferencesStore } from "@/lib/stores/preferences.store";
import { Topbar } from "./topbar";
import { AssistantSidebar } from "./assistant-sidebar";
import { CommandPalette } from "./command-palette";

/**
 * Personal assistant shell (OpenClaw-style) — minimal sidebar (agent switcher + "+").
 * Chat is immersive (full-height, no topbar, its own header); the other assistant pages
 * (Memory, Automations, Telegram) render in a padded container with the topbar.
 */
export function AssistantShell({
  team,
  children,
}: {
  team: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const segment = pathname?.split("/")[2];
  const isChat = segment === "chat";

  // One realtime socket per team; events invalidate React Query caches.
  useRealtimeSync(team);

  // Apply the "Reduce motion" preference app-wide.
  const reduceMotion = usePreferencesStore((s) => s.reduceMotion);
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
  }, [reduceMotion]);

  return (
    <SidebarProvider>
      <AssistantSidebar team={team} />
      <SidebarInset className="min-w-0">
        {isChat ? null : <Topbar team={team} />}
        <main className="min-w-0 flex-1 overflow-x-hidden">
          {isChat ? (
            // Fill the inset card (minus its m-2 inset margins). The chat surface (h-full)
            // manages its own scroll and docks the composer.
            <div className="h-[calc(100svh-1rem)] min-h-0">{children}</div>
          ) : (
            <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6">{children}</div>
          )}
        </main>
        <CommandPalette team={team} />
      </SidebarInset>
    </SidebarProvider>
  );
}
