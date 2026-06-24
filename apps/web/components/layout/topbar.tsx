"use client";

import { Search, ChevronsUpDown, Play, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "./theme-toggle";
import { useUiStore } from "@/lib/stores/ui.store";
import { useIndicators } from "@/lib/hooks/use-indicators";
import type { Env } from "@/types/domain";
import { cn } from "@/lib/utils";

const ENVS: Env[] = ["dev", "staging", "prod"];

/**
 * Slim header inside the SidebarInset. The org switcher and account card now
 * live in the sidebar (TeamSwitcher / NavUser); this bar keeps the cross-cutting
 * actions: sidebar toggle, centered ⌘K search, env and live indicators.
 */
export function Topbar() {
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const env = useUiStore((s) => s.env);
  const setEnv = useUiStore((s) => s.setEnv);
  const indicators = useIndicators();

  return (
    <header className="sticky top-0 z-10 flex h-[var(--navbar-h)] shrink-0 items-center gap-2 bg-background px-4">
      <SidebarTrigger className="-ml-1 text-muted-foreground" />

      {/* command palette trigger — absolutely centered in the header */}
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="absolute top-1/2 left-1/2 hidden h-9 w-full max-w-md -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md bg-surface-2 px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-3 md:flex"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search or run a command…</span>
        <kbd className="rounded border border-border bg-surface px-1.5 text-[11px] font-medium">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setCommandOpen(true)}>
          <Search className="size-4" />
        </Button>

        {/* env selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <span
                className={cn(
                  "size-2 rounded-full",
                  env === "prod" ? "bg-warning" : env === "staging" ? "bg-info" : "bg-success",
                )}
                aria-hidden="true"
              />
              <span className="capitalize">{env}</span>
              <ChevronsUpDown className="size-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Environment</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={env} onValueChange={(v) => setEnv(v as Env)}>
              {ENVS.map((e) => (
                <DropdownMenuRadioItem key={e} value={e} className="capitalize">
                  {e}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* active runs */}
        <Button variant="ghost" size="icon" className="relative" aria-label={`${indicators.activeRuns} active runs`}>
          <Play className="size-4" />
          {indicators.activeRuns > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-running px-1 text-[10px] font-bold text-primary-foreground tabular-nums">
              {indicators.activeRuns}
            </span>
          ) : null}
        </Button>

        {/* approvals */}
        <Button variant="ghost" size="icon" className="relative" aria-label={`${indicators.approvals} pending approvals`}>
          <ShieldCheck className="size-4" />
          {indicators.approvals > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-info px-1 text-[10px] font-bold text-primary-foreground tabular-nums">
              {indicators.approvals}
            </span>
          ) : null}
        </Button>

        <ThemeToggle />
      </div>
    </header>
  );
}
