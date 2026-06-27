"use client";

import { Laptop } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useLocalDaemonStatus } from "@/features/runtimes/local-daemon-api";
import {
  deriveDaemonView,
  type DaemonState,
} from "@/features/runtimes/daemon-view";
import type { LocalDaemonStatus } from "@/features/runtimes/types";

type Tone = "running" | "stopped" | "idle";

interface DaemonChip {
  tone: Tone;
  secondary: string;
  pid?: number;
  tooltip: string;
}

const DOT_TONE: Record<Tone, string> = {
  running: "bg-success",
  stopped: "bg-muted-foreground",
  idle: "bg-muted-foreground/50",
};

/** Presentational wording for the sidebar chip, on top of the shared view. */
function describe(
  status: LocalDaemonStatus | undefined,
  loading: boolean,
): DaemonChip {
  const view = deriveDaemonView(status);
  const byState: Record<DaemonState, DaemonChip> = {
    running: {
      tone: "running",
      secondary: `running · ${view.device}`,
      pid: view.pid,
      tooltip: `Daemon running · ${view.device}${view.pid ? ` · pid ${view.pid}` : ""}`,
    },
    stopped: {
      tone: "stopped",
      secondary: "stopped",
      tooltip: "Daemon installed · stopped",
    },
    not_installed: {
      tone: "idle",
      secondary: "not installed",
      tooltip: "Daemon not installed on this machine",
    },
    unknown: {
      tone: "idle",
      secondary: loading ? "checking…" : "unknown",
      tooltip: "Daemon · checking status",
    },
  };
  return byState[view.state];
}

/**
 * Read-only daemon presence card pinned to the sidebar footer (above the user
 * card). Reuses the shared `["local-daemon"]` query so there is no extra polling.
 */
export function DaemonStatusFooter() {
  const { data, isLoading } = useLocalDaemonStatus();

  // No local orchestrator (hosted deployment) → nothing meaningful to show.
  if (data?.orchestratorAvailable === false) return null;

  const view = describe(data, isLoading);
  const dot = cn(
    "shrink-0 rounded-full",
    DOT_TONE[view.tone],
    view.tone === "running" && "animate-pulse motion-reduce:animate-none",
  );

  return (
    <div className="group-data-[collapsible=icon]:px-0">
      {/* Expanded: full card */}
      <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3 group-data-[collapsible=icon]:hidden">
        <div className="flex items-center gap-2">
          <Laptop
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground">
            Daemon
          </span>
          <span className={cn(dot, "size-2")} />
        </div>
        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
          {view.secondary}
        </p>
        {view.pid ? (
          <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
            pid {view.pid}
          </p>
        ) : null}
      </div>

      {/* Collapsed (icon rail): compact icon + status dot, details on hover */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative mx-auto hidden size-8 items-center justify-center rounded-md hover:bg-sidebar-accent group-data-[collapsible=icon]:flex">
            <Laptop
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            <span className={cn(dot, "absolute right-1 top-1 size-1.5")} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">{view.tooltip}</TooltipContent>
      </Tooltip>
    </div>
  );
}
