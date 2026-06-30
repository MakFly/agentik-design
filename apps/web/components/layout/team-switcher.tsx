"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSessionStore } from "@/lib/stores/session.store";
import { hrefFor } from "@/config/nav";

/**
 * Organisation switcher in the sidebar header (v3 look). Lists the teams the
 * session is a member of and navigates to the picked team's project cockpit.
 */
export function TeamSwitcher({ team }: { team: string }) {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const session = useSessionStore((s) => s.session);

  if (!session) return null;

  function switchTeam(slug: string) {
    if (slug !== team) router.push(hrefFor(slug, "chat"));
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={session.team.name}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                {session.team.name.charAt(0)}
              </span>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{session.team.name}</span>
                <span className="truncate text-xs text-muted-foreground">Workspace</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Teams</DropdownMenuLabel>
            {session.teams.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => switchTeam(t.slug)} className="gap-2">
                <span className="flex aspect-square size-6 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-bold">
                  {t.name.charAt(0)}
                </span>
                <span className="flex-1 truncate">{t.name}</span>
                {t.slug === team ? <Check className="size-4" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
