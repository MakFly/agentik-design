"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { Plus } from "lucide-react";
import { useWorkflowStore, type WorkflowSnapshot } from "./store";
import { Toolbar } from "./toolbar";
import { NodePalette } from "./node-palette";
import { NodePanel } from "./node-panel";
import { Canvas } from "./canvas";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const AUTOSAVE_MS = 800;

const LG_QUERY = "(min-width: 1024px)";
function subscribeToMedia(cb: () => void) {
  const mql = window.matchMedia(LG_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}
function getIsDesktop() {
  return window.matchMedia(LG_QUERY).matches;
}
function useIsDesktop() {
  return useSyncExternalStore(subscribeToMedia, getIsDesktop, () => false);
}

export function WorkflowBuilder({
  team,
  workflowId,
  initialSnapshot,
}: {
  team: string;
  workflowId?: string;
  initialSnapshot?: WorkflowSnapshot;
}) {
  const router = useRouter();
  const init = useWorkflowStore((s) => s.init);
  const initFromEngine = useWorkflowStore((s) => s.initFromEngine);
  const storeWorkflowId = useWorkflowStore((s) => s.workflowId);
  const paletteOpen = useWorkflowStore((s) => s.paletteOpen);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const setSaveState = useWorkflowStore((s) => s.setSaveState);
  const setPaletteOpen = useWorkflowStore((s) => s.setPaletteOpen);
  const persistDraft = useWorkflowStore((s) => s.persistDraft);
  const saveToEngine = useWorkflowStore((s) => s.saveToEngine);
  const executeWorkflow = useWorkflowStore((s) => s.executeWorkflow);
  const copySelectedNode = useWorkflowStore((s) => s.copySelectedNode);
  const pasteClipboardNode = useWorkflowStore((s) => s.pasteClipboardNode);
  const duplicateSelectedNode = useWorkflowStore((s) => s.duplicateSelectedNode);
  const deleteSelected = useWorkflowStore((s) => s.deleteSelected);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);
  const rev = useWorkflowStore((s) => s.rev);
  const isDesktop = useIsDesktop();
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (workflowId && initialSnapshot) initFromEngine(team, workflowId, initialSnapshot);
    else init(team);
  }, [init, initFromEngine, team, workflowId, initialSnapshot]);

  // On /new (no workflowId prop), once the first save creates the workflow,
  // move to its canonical edit URL. Armed only after we've observed the clean
  // null state post-init, so the singleton store's stale id (left over from a
  // previously-edited workflow) can't bounce us on mount.
  const redirectArmedRef = useRef(false);
  useEffect(() => {
    if (workflowId) return; // edit route — never redirect
    if (!storeWorkflowId) {
      redirectArmedRef.current = true;
      return;
    }
    if (redirectArmedRef.current) {
      router.replace(`/${team}/workflows/${storeWorkflowId}`);
    }
  }, [workflowId, storeWorkflowId, team, router]);

  useEffect(() => () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
  }, []);

  useEffect(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    const state = useWorkflowStore.getState();
    if (state.saveState !== "dirty") return;
    const revisionToSave = rev;

    setSaveState("saving");
    autosaveTimerRef.current = setTimeout(() => {
      const current = useWorkflowStore.getState();
      if (current.rev === revisionToSave) {
        const persisted = current.persistDraft(team);
        setSaveState(persisted ? "saved" : "dirty");
      }
    }, AUTOSAVE_MS);
  }, [persistDraft, rev, setSaveState, team]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (event.key === "Tab" && !isTextField) {
        event.preventDefault();
        setPaletteOpen(true);
      }

      if (isTextField) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveToEngine(team);
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void executeWorkflow();
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        if (copySelectedNode()) event.preventDefault();
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        if (pasteClipboardNode()) event.preventDefault();
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        if (duplicateSelectedNode()) event.preventDefault();
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        const selected = useWorkflowStore.getState().selectedNodeId;
        if (selected) {
          event.preventDefault();
          deleteSelected();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    copySelectedNode,
    deleteSelected,
    duplicateSelectedNode,
    executeWorkflow,
    pasteClipboardNode,
    redo,
    saveToEngine,
    setPaletteOpen,
    team,
    undo,
  ]);

  return (
    <ReactFlowProvider>
      <div
        className="n8n-workflow flex h-dvh flex-col overflow-hidden bg-[var(--n8n-canvas)] text-[var(--n8n-text)]"
      >
        <Toolbar team={team} />

        <div className="relative flex min-h-0 flex-1">
          {isDesktop && (
            <aside
              className={cn(
                "w-[320px] shrink-0 border-r border-[var(--n8n-border)] bg-[var(--n8n-panel)] transition-[width,opacity] duration-200",
                !paletteOpen && "w-0 overflow-hidden opacity-0",
              )}
            >
              <NodePalette />
            </aside>
          )}

          <div className="min-w-0 flex-1">
            <Canvas />
          </div>

          {isDesktop && selectedNodeId && (
            <aside className="w-[420px] shrink-0 animate-in slide-in-from-right-4 duration-200">
              <NodePanel />
            </aside>
          )}
        </div>

        {!isDesktop && (
          <div className="fixed bottom-20 right-4 z-50" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <Sheet>
              <SheetTrigger asChild>
                <Button size="icon" className="size-12 rounded-full bg-[var(--n8n-brand)] text-[var(--n8n-brand-foreground)] shadow-lg hover:bg-[var(--n8n-brand-hover)]">
                  <Plus className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[70dvh]">
                <SheetHeader>
                  <SheetTitle>Add node</SheetTitle>
                </SheetHeader>
                <NodePalette />
              </SheetContent>
            </Sheet>
          </div>
        )}

        {!isDesktop && selectedNodeId && (
          <Sheet open onOpenChange={(open) => { if (!open) useWorkflowStore.getState().selectNode(null); }}>
            <SheetContent side="bottom" className="max-h-[70dvh]">
              <SheetHeader className="sr-only">
                <SheetTitle>Node settings</SheetTitle>
              </SheetHeader>
              <NodePanel />
            </SheetContent>
          </Sheet>
        )}
      </div>
    </ReactFlowProvider>
  );
}
