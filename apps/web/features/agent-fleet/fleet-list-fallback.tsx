"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FleetAvatar, HealthDot } from "./agent-node";
import type { FleetGraph, FleetNode } from "./api";

/** Indented, expandable roster tree — the default (and most legible) view on mobile. */
export function FleetListFallback({
  graph,
  onSelect,
}: {
  graph: FleetGraph;
  onSelect: (id: string) => void;
}) {
  const { byId, childrenOf, roots } = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const childrenOf = new Map<string, string[]>();
    for (const e of graph.rosterEdges) {
      const list = childrenOf.get(e.parentAgentId) ?? [];
      list.push(e.subagentId);
      childrenOf.set(e.parentAgentId, list);
    }
    const childIds = new Set(graph.rosterEdges.map((e) => e.subagentId));
    const roots = graph.nodes.filter((n) => n.isOrchestrator || !childIds.has(n.id));
    return { byId, childrenOf, roots };
  }, [graph]);

  return (
    <ul className="flex flex-col gap-1">
      {roots.map((n) => (
        <TreeRow
          key={n.id}
          node={n}
          depth={0}
          byId={byId}
          childrenOf={childrenOf}
          onSelect={onSelect}
          ancestors={new Set()}
        />
      ))}
    </ul>
  );
}

function TreeRow({
  node,
  depth,
  byId,
  childrenOf,
  onSelect,
  ancestors,
}: {
  node: FleetNode;
  depth: number;
  byId: Map<string, FleetNode>;
  childrenOf: Map<string, string[]>;
  onSelect: (id: string) => void;
  ancestors: Set<string>;
}) {
  const [open, setOpen] = useState(depth < 1);
  // Stop cycles: don't recurse into an ancestor already on this path.
  const childIds = (childrenOf.get(node.id) ?? []).filter((id) => !ancestors.has(id) && byId.has(id));
  const hasChildren = childIds.length > 0;

  return (
    <li>
      <div
        className="flex min-h-[44px] items-center gap-2 rounded-md px-2 hover:bg-surface-2"
        style={{ paddingInlineStart: `${depth * 1.25 + 0.5}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
          >
            <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          <FleetAvatar emoji={node.emoji} color={node.color} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">{node.name}</span>
              <HealthDot health={node.health} />
            </span>
            {node.role ? <span className="block truncate text-xs text-muted-foreground">{node.role}</span> : null}
          </span>
          {node.isOrchestrator ? (
            <Badge variant="secondary" className="rounded-full text-[10px]">
              Orchestrator
            </Badge>
          ) : null}
        </button>
      </div>
      {hasChildren && open ? (
        <ul className="flex flex-col gap-1">
          {childIds.map((id) => (
            <TreeRow
              key={id}
              node={byId.get(id)!}
              depth={depth + 1}
              byId={byId}
              childrenOf={childrenOf}
              onSelect={onSelect}
              ancestors={new Set([...ancestors, node.id])}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
