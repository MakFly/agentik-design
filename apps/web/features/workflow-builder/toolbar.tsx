"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Play,
  Save,
  PanelLeftClose,
  PanelLeft,
  Loader2,
  Check,
  Circle,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkflowStore } from "./store";

export function Toolbar({ team }: { team: string }) {
  const name = useWorkflowStore((s) => s.workflowName);
  const setName = useWorkflowStore((s) => s.setWorkflowName);
  const saveState = useWorkflowStore((s) => s.saveState);
  const paletteOpen = useWorkflowStore((s) => s.paletteOpen);
  const setPaletteOpen = useWorkflowStore((s) => s.setPaletteOpen);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);

  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
      {/* breadcrumb */}
      <Link
        href={`/${team}/workflows`}
        className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:flex"
      >
        <Workflow className="size-3.5" />
        Workflows
      </Link>
      <ChevronRight className="hidden size-3 text-border-strong sm:block" />

      {/* palette toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 hidden lg:inline-flex"
            onClick={() => setPaletteOpen(!paletteOpen)}
          >
            {paletteOpen ? (
              <PanelLeftClose className="size-3.5" />
            ) : (
              <PanelLeft className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {paletteOpen ? "Hide" : "Show"} palette
        </TooltipContent>
      </Tooltip>

      {/* workflow name */}
      <div className="min-w-0 flex-1 px-1">
        {editing ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") setEditing(false);
            }}
            className="w-full rounded-md bg-surface-2 px-2 py-0.5 text-[13px] font-semibold text-foreground outline-none ring-1 ring-primary/30"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="max-w-full truncate rounded-md px-2 py-0.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-surface-2"
          >
            {name || "Untitled workflow"}
          </button>
        )}
      </div>

      {/* status */}
      <div className="hidden items-center gap-3 pr-2 text-[11px] tabular text-muted-foreground md:flex">
        <span>{nodes.length} nodes</span>
        <span>{edges.length} edges</span>
      </div>

      {/* save indicator */}
      <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
        {saveState === "saving" && (
          <>
            <Loader2 className="size-3 animate-spin text-primary" /> Saving
          </>
        )}
        {saveState === "saved" && (
          <>
            <Check className="size-3 text-success" /> Saved
          </>
        )}
        {saveState === "dirty" && (
          <>
            <Circle className="size-2 fill-warning text-warning" /> Unsaved
          </>
        )}
      </span>

      {/* actions */}
      <div className="flex shrink-0 items-center gap-1.5 pl-2">
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs">
          <Save className="size-3" /> Save
        </Button>
        <Button size="sm" className="h-7 gap-1.5 px-3 text-xs">
          <Play className="size-3" /> Test run
        </Button>
      </div>
    </div>
  );
}
