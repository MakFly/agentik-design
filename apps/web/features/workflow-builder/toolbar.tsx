"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Clock3,
  Copy,
  History,
  Import,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  PanelLeftClose,
  Play,
  Power,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "./store";

export function Toolbar({ team }: { team: string }) {
  const name = useWorkflowStore((s) => s.workflowName);
  const setName = useWorkflowStore((s) => s.setWorkflowName);
  const saveState = useWorkflowStore((s) => s.saveState);
  const paletteOpen = useWorkflowStore((s) => s.paletteOpen);
  const setPaletteOpen = useWorkflowStore((s) => s.setPaletteOpen);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const setSaveState = useWorkflowStore((s) => s.setSaveState);
  const persistDraft = useWorkflowStore((s) => s.persistDraft);
  const saveToEngine = useWorkflowStore((s) => s.saveToEngine);
  const runState = useWorkflowStore((s) => s.runState);
  const executeWorkflow = useWorkflowStore((s) => s.executeWorkflow);
  const active = useWorkflowStore((s) => s.active);
  const setActive = useWorkflowStore((s) => s.setActive);
  const resetDraft = useWorkflowStore((s) => s.resetDraft);
  const showExecutions = useWorkflowStore((s) => s.showExecutions);
  const setShowExecutions = useWorkflowStore((s) => s.setShowExecutions);
  const exportWorkflowSnapshot = useWorkflowStore((s) => s.exportWorkflowSnapshot);
  const importWorkflowSnapshot = useWorkflowStore((s) => s.importWorkflowSnapshot);
  const copySelectedNode = useWorkflowStore((s) => s.copySelectedNode);
  const pasteClipboardNode = useWorkflowStore((s) => s.pasteClipboardNode);
  const duplicateSelectedNode = useWorkflowStore((s) => s.duplicateSelectedNode);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const clipboardNode = useWorkflowStore((s) => s.clipboardNode);
  const undoStack = useWorkflowStore((s) => s.undoStack);
  const redoStack = useWorkflowStore((s) => s.redoStack);
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const commitSave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void saveToEngine(team);
  };

  const runWorkflow = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await executeWorkflow();
  };

  const copyWorkflowJson = async () => {
    const payload = JSON.stringify(exportWorkflowSnapshot(), null, 2);

    try {
      await navigator.clipboard?.writeText(payload);
    } catch {
      window.localStorage.setItem(`agentik:workflow-builder:${team}:clipboard-export`, payload);
    }
  };

  const importWorkflowJson = async () => {
    let payload = window.localStorage.getItem(`agentik:workflow-builder:${team}:clipboard-export`) ?? "";

    try {
      const clipboardText = await navigator.clipboard?.readText();
      if (clipboardText) payload = clipboardText;
    } catch {
      // Browser clipboard permissions are not guaranteed in local dev.
    }

    const result = importWorkflowSnapshot(payload);
    if (result.ok) {
      setSaveState(persistDraft(team) ? "saved" : "dirty");
    }
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--n8n-border)] bg-[var(--n8n-surface)] px-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <Link
        href={`/${team}/workflows`}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--n8n-hover)] hover:text-foreground"
        aria-label="Back to workflows"
      >
        <ArrowLeft className="size-4" />
      </Link>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="hidden size-8 shrink-0 text-muted-foreground hover:bg-[var(--n8n-hover)] lg:inline-flex"
            onClick={() => setPaletteOpen(!paletteOpen)}
          >
            {paletteOpen ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeft className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {paletteOpen ? "Hide" : "Show"} nodes panel
        </TooltipContent>
      </Tooltip>

      <div className="min-w-0 flex flex-1 items-center gap-2 px-1">
        {editing ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") setEditing(false);
            }}
            className="h-8 w-full max-w-[420px] rounded-md border border-[var(--n8n-brand)] bg-[var(--n8n-surface)] px-2 text-[14px] font-semibold text-foreground outline-none ring-2 ring-[var(--n8n-focus)]"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="max-w-full truncate rounded-md px-2 py-1 text-[14px] font-semibold text-foreground transition-colors hover:bg-[var(--n8n-hover)]"
          >
            {name || "Untitled workflow"}
          </button>
        )}
        <span className="hidden items-center gap-1 rounded-full border border-[var(--n8n-border)] bg-[var(--n8n-subtle)] px-2 py-0.5 text-[11px] text-muted-foreground md:inline-flex">
          <Clock3 className="size-3" />
          {nodes.length} nodes, {edges.length} connection{edges.length === 1 ? "" : "s"}
        </span>
      </div>

      <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
        {saveState === "saving" && (
          <>
            <Loader2 className="size-3 animate-spin text-[var(--n8n-brand)]" /> Saving
          </>
        )}
        {saveState === "saved" && (
          <>
            <Check className="size-3 text-success" /> Saved
          </>
        )}
        {saveState === "dirty" && (
          <>
            <span className="size-1.5 rounded-full bg-warning" /> Unsaved
          </>
        )}
      </span>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className="hidden size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--n8n-hover)] disabled:pointer-events-none disabled:opacity-50 sm:inline-flex"
          onClick={() => {
            if (canUndo) useWorkflowStore.getState().undo();
          }}
          disabled={!canUndo}
          aria-disabled={!canUndo}
          aria-label="Undo"
          data-testid="workflow-undo"
        >
          <Undo2 className="size-4" />
        </button>
        <button
          type="button"
          className="hidden size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--n8n-hover)] disabled:pointer-events-none disabled:opacity-50 sm:inline-flex"
          onClick={() => {
            if (canRedo) useWorkflowStore.getState().redo();
          }}
          disabled={!canRedo}
          aria-disabled={!canRedo}
          aria-label="Redo"
          data-testid="workflow-redo"
        >
          <Redo2 className="size-4" />
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActive(!active)}
          className="hidden h-8 gap-2 border border-[var(--n8n-border)] px-2.5 text-xs hover:bg-[var(--n8n-hover)] md:inline-flex"
        >
          <Power className={active ? "size-3.5 text-success" : "size-3.5 text-muted-foreground"} />
          {active ? "Active" : "Inactive"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "hidden size-8 text-muted-foreground hover:bg-[var(--n8n-hover)] sm:inline-flex",
            showExecutions && "bg-[var(--n8n-brand-soft)] text-[var(--n8n-brand)]",
          )}
          onClick={() => setShowExecutions(!showExecutions)}
          aria-label="Execution history"
        >
          <History className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden size-8 text-muted-foreground hover:bg-[var(--n8n-hover)] sm:inline-flex"
              aria-label="Workflow actions"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={!selectedNodeId} onClick={copySelectedNode}>
              <Copy className="size-4" />
              Copy node
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!clipboardNode} onClick={pasteClipboardNode}>
              <Copy className="size-4" />
              Paste node
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!selectedNodeId} onClick={duplicateSelectedNode}>
              <Copy className="size-4" />
              Duplicate node
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={copyWorkflowJson}>
              <Copy className="size-4" />
              Copy JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={importWorkflowJson}>
              <Import className="size-4" />
              Import JSON
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => resetDraft(team)}>
              <RotateCcw className="size-4" />
              Reset draft
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-[var(--n8n-border)] bg-[var(--n8n-surface)] px-3 text-xs hover:bg-[var(--n8n-hover)]"
          onClick={commitSave}
        >
          {saveState === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>
        <Button
          size="sm"
          className="h-8 gap-1.5 bg-[var(--n8n-brand)] px-3 text-xs text-[var(--n8n-brand-foreground)] shadow-none hover:bg-[var(--n8n-brand-hover)]"
          onClick={runWorkflow}
          disabled={runState === "running"}
        >
          {runState === "running" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {runState === "running" ? "Executing" : "Execute workflow"}
        </Button>
      </div>
    </div>
  );
}
