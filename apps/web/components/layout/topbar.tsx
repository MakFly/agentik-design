"use client";

import { useRouter } from "next/navigation";
import {
  PanelLeft,
  Search,
  ChevronsUpDown,
  Check,
  Play,
  ShieldCheck,
  User,
  LogOut,
  Keyboard,
  Menu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./theme-toggle";
import { useUiStore } from "@/lib/stores/ui.store";
import { useSessionStore } from "@/lib/stores/session.store";
import { useIndicators } from "@/lib/hooks/use-indicators";
import type { Env } from "@/types/domain";
import { cn } from "@/lib/utils";

const ENVS: Env[] = ["dev", "staging", "prod"];

export function Topbar({ team, onMenu }: { team: string; onMenu?: () => void }) {
  const router = useRouter();
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const env = useUiStore((s) => s.env);
  const setEnv = useUiStore((s) => s.setEnv);
  const session = useSessionStore((s) => s.session);
  const indicators = useIndicators();

  function switchTeam(slug: string) {
    if (slug !== team) router.push(`/${slug}/dashboard`);
  }

  return (
    <header
      className="sticky top-0 z-30 flex h-[var(--navbar-h)] items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur-sm"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={onMenu}>
        <Menu className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden lg:inline-flex"
        aria-label="Toggle sidebar"
        onClick={toggleSidebar}
      >
        <PanelLeft className="size-4" />
      </Button>

      {/* team switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2 font-semibold">
            <span className="flex size-5 items-center justify-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
              {session.team.name.charAt(0)}
            </span>
            <span className="hidden max-w-[10rem] truncate sm:inline">{session.team.name}</span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Teams</DropdownMenuLabel>
          {session.teams.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => switchTeam(t.slug)}>
              <span className="flex-1 truncate">{t.name}</span>
              {t.slug === team ? <Check className="size-4" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* command palette trigger */}
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="mx-1 hidden h-9 flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-3 md:flex"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search or run a command…</span>
        <kbd className="rounded border border-border bg-surface px-1.5 text-[11px] font-medium">⌘K</kbd>
      </button>
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setCommandOpen(true)}>
        <Search className="size-4" />
      </Button>

      <div className="ml-auto flex items-center gap-1">
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

        {/* user menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Account menu">
              <span className="flex size-7 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold">
                {session.user.name.charAt(0)}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="truncate font-medium">{session.user.name}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">{session.user.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="size-4" /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCommandOpen(true)}>
              <Keyboard className="size-4" /> Command palette
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
