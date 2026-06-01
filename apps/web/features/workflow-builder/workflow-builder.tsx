"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Plus } from "lucide-react";
import { useWorkflowStore } from "./store";
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

export function WorkflowBuilder({ team }: { team: string }) {
  const init = useWorkflowStore((s) => s.init);
  const paletteOpen = useWorkflowStore((s) => s.paletteOpen);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const saveState = useWorkflowStore((s) => s.saveState);
  const setSaveState = useWorkflowStore((s) => s.setSaveState);
  const rev = useWorkflowStore((s) => s.rev);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    setSaveState("saving");
    const t = setTimeout(() => setSaveState("saved"), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [rev, saveState, setSaveState]);

  return (
    <ReactFlowProvider>
      <div className="flex h-dvh flex-col overflow-hidden">
        <Toolbar team={team} />

        <div className="relative flex min-h-0 flex-1">
          {/* palette — desktop */}
          {isDesktop && (
            <aside
              className={cn(
                "w-[280px] shrink-0 border-r border-border bg-surface transition-[width,opacity] duration-200",
                !paletteOpen && "w-0 overflow-hidden opacity-0",
              )}
            >
              <NodePalette />
            </aside>
          )}

          {/* canvas */}
          <div className="min-w-0 flex-1">
            <Canvas />
          </div>

          {/* config panel — desktop */}
          {isDesktop && selectedNodeId && (
            <aside className="w-[340px] shrink-0 animate-in slide-in-from-right-4 duration-200">
              <NodePanel />
            </aside>
          )}
        </div>

        {/* mobile FAB */}
        {!isDesktop && (
          <div className="fixed bottom-20 right-4 z-50" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <Sheet>
              <SheetTrigger asChild>
                <Button size="icon" className="size-12 rounded-full shadow-lg">
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

        {/* mobile config sheet */}
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
