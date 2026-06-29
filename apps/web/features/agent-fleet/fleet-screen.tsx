"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { GitBranch, LayoutList, Network, Share2, UserRound, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useAgentGraph } from "./api";
import { FleetGraph } from "./fleet-graph";
import { fleetSummary } from "./fleet-graph-layout";
import { FleetListFallback } from "./fleet-list-fallback";
import { NodeInspector } from "./node-inspector";

type View = "graph" | "list";

const DESKTOP_QUERY = "(min-width: 768px)";

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

function FleetStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone?: "primary" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5",
        tone === "primary" && "border-primary/20 bg-primary/[0.03]",
      )}
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-md",
          tone === "primary" ? "bg-primary/10 text-primary" : "bg-surface-2 text-muted-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold tabular-nums leading-none" data-tabular>
          {value}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function FleetScreen({ team }: { team: string }) {
  const graph = useAgentGraph(team);
  const isDesktop = useIsDesktop();
  const [override, setOverride] = useState<View | null>(null);
  const view: View = override ?? (isDesktop ? "graph" : "list");
  const setView = (v: View) => setOverride(v);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [hideUnassigned, setHideUnassigned] = useState(false);

  const summary = useMemo(
    () => (graph.data ? fleetSummary(graph.data) : null),
    [graph.data],
  );

  const selectedNode = useMemo(
    () => graph.data?.nodes.find((n) => n.id === selectedId) ?? null,
    [graph.data, selectedId],
  );

  function select(id: string) {
    setSelectedId(id);
    setInspectorOpen(true);
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <PageHeader
        title="Fleet"
        description="Roster wiring — which orchestrators delegate to which operators, and with what instruction."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {summary && summary.unassigned > 0 ? (
              <label className="flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-xs text-muted-foreground sm:min-h-9">
                <Switch
                  checked={hideUnassigned}
                  onCheckedChange={setHideUnassigned}
                  aria-label="Hide unassigned agents"
                />
                Hide unassigned
              </label>
            ) : null}
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
      >
        {summary ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <FleetStat icon={Users} label="Agents" value={summary.total} />
            <FleetStat icon={GitBranch} label="Orchestrators" value={summary.orchestrators} tone="primary" />
            <FleetStat icon={Share2} label="Delegations" value={summary.delegations} />
            <FleetStat icon={UserRound} label="Unassigned" value={summary.unassigned} />
          </div>
        ) : null}
      </PageHeader>

      {graph.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[min(72dvh,40rem)] min-h-[24rem] rounded-xl" />
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
        <FleetGraph
          graph={graph.data}
          team={team}
          onSelect={select}
          hideUnassigned={hideUnassigned}
        />
      ) : (
        <div className="rounded-xl border border-border bg-surface p-2 shadow-xs">
          <FleetListFallback graph={graph.data} onSelect={select} hideUnassigned={hideUnassigned} />
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
