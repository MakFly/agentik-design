"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { LayoutList, Network, Share2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAgentGraph } from "./api";
import { FleetGraph } from "./fleet-graph";
import { FleetListFallback } from "./fleet-list-fallback";
import { NodeInspector } from "./node-inspector";

type View = "graph" | "list";

const DESKTOP_QUERY = "(min-width: 768px)";

/** Live md+ media-query state — the right primitive for a responsive default (no setState-in-effect, SSR-safe). */
function useIsDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(DESKTOP_QUERY);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

export function FleetScreen({ team }: { team: string }) {
  const graph = useAgentGraph(team);
  const isDesktop = useIsDesktop();
  // Default follows the viewport (Graph at md+, List below); a user toggle overrides it.
  const [override, setOverride] = useState<View | null>(null);
  const view: View = override ?? (isDesktop ? "graph" : "list");
  const setView = (v: View) => setOverride(v);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const selectedNode = useMemo(
    () => graph.data?.nodes.find((n) => n.id === selectedId) ?? null,
    [graph.data, selectedId],
  );

  function select(id: string) {
    setSelectedId(id);
    setInspectorOpen(true);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Fleet"
        description="How your agents delegate — orchestrators and the subagents they route work to."
        actions={
          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(v) => v && setView(v as View)}
              variant="outline"
              size="sm"
              aria-label="Fleet view"
            >
              <ToggleGroupItem value="graph" aria-label="Graph view" className="min-h-[44px] sm:min-h-9">
                <Share2 className="size-4" /> Graph
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view" className="min-h-[44px] sm:min-h-9">
                <LayoutList className="size-4" /> List
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        }
      />

      {graph.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : graph.isError ? (
        <ErrorState error={graph.error} onRetry={() => graph.refetch()} />
      ) : !graph.data || graph.data.nodes.length === 0 ? (
        <EmptyState
          icon={Network}
          title="No agents yet"
          description="Publish an agent, then mark one as an orchestrator to start delegating."
          action={
            <Button asChild>
              <Link href={`/${team}/agents/new`}>New agent</Link>
            </Button>
          }
        />
      ) : view === "graph" ? (
        <FleetGraph graph={graph.data} team={team} onSelect={select} />
      ) : (
        <div className="rounded-lg border border-border bg-surface p-2">
          <FleetListFallback graph={graph.data} onSelect={select} />
        </div>
      )}

      <NodeInspector
        team={team}
        nodeId={selectedId}
        node={selectedNode}
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
      />
    </div>
  );
}
