"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FleetAvatar, HealthDot } from "./agent-node";
import type { FleetGraph, FleetNode } from "./api";

function graphAdjacency(graph: FleetGraph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  const instructionOf = new Map<string, string>();
  for (const e of graph.rosterEdges) {
    const list = childrenOf.get(e.parentAgentId) ?? [];
    list.push(e.subagentId);
    childrenOf.set(e.parentAgentId, list);
    if (e.instruction) instructionOf.set(`${e.parentAgentId}->${e.subagentId}`, e.instruction);
  }
  const childIds = new Set(graph.rosterEdges.map((e) => e.subagentId));
  const parentIds = new Set(graph.rosterEdges.map((e) => e.parentAgentId));
  const connected = new Set([...childIds, ...parentIds]);
  const roots = graph.nodes.filter(
    (n) => parentIds.has(n.id) || (n.isOrchestrator && !childIds.has(n.id)),
  );
  const pool = graph.nodes.filter((n) => !connected.has(n.id));
  return { byId, childrenOf, instructionOf, roots, pool };
}

/** Indented, expandable roster tree — default on mobile. */
export function FleetListFallback({
  graph,
  onSelect,
  hideUnassigned = false,
}: {
  graph: FleetGraph;
  onSelect: (id: string) => void;
  hideUnassigned?: boolean;
}) {
  const { byId, childrenOf, instructionOf, roots, pool } = useMemo(
    () => graphAdjacency(graph),
    [graph],
  );

  return (
    <div className="flex flex-col gap-4 p-1">
      {roots.length ? (
        <section>
          <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Delegation hubs
          </h3>
          <ul className="flex flex-col gap-1">
            {roots.map((n) => (
              <TreeRow
                key={n.id}
                node={n}
                depth={0}
                byId={byId}
                childrenOf={childrenOf}
                instructionOf={instructionOf}
                onSelect={onSelect}
                ancestors={new Set()}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {!hideUnassigned && pool.length ? (
        <section>
          <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Unassigned
          </h3>
          <ul className="flex flex-col gap-1">
            {pool.map((n) => (
              <PoolRow key={n.id} node={n} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function PoolRow({ node, onSelect }: { node: FleetNode; onSelect: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-left hover:bg-surface-2"
      >
        <FleetAvatar emoji={node.emoji} color={node.color} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{node.name}</span>
            <HealthDot health={node.health} />
          </span>
          {node.role ? (
            <span className="block truncate text-xs text-muted-foreground">{node.role}</span>
          ) : null}
        </span>
        <Badge variant="outline" className="rounded-full text-[10px]">
          Unassigned
        </Badge>
      </button>
    </li>
  );
}

function TreeRow({
  node,
  depth,
  byId,
  childrenOf,
  instructionOf,
  onSelect,
  ancestors,
}: {
  node: FleetNode;
  depth: number;
  byId: Map<string, FleetNode>;
  childrenOf: Map<string, string[]>;
  instructionOf: Map<string, string>;
  onSelect: (id: string) => void;
  ancestors: Set<string>;
}) {
  const [open, setOpen] = useState(depth < 1);
  const childIds = (childrenOf.get(node.id) ?? []).filter((id) => !ancestors.has(id) && byId.has(id));
  const hasChildren = childIds.length > 0;

  return (
    <li>
      <div
        className={cn(
          "flex min-h-[44px] items-center gap-2 rounded-lg px-2",
          node.isOrchestrator ? "bg-primary/[0.03]" : "hover:bg-surface-2",
        )}
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
            {node.role ? (
              <span className="block truncate text-xs text-muted-foreground">{node.role}</span>
            ) : null}
          </span>
          {node.isOrchestrator ? (
            <Badge variant="default" className="rounded-full text-[10px]">
              Orchestrator
            </Badge>
          ) : null}
        </button>
      </div>
      {hasChildren && open ? (
        <ul className="flex flex-col gap-1">
          {childIds.map((id) => {
            const instruction = instructionOf.get(`${node.id}->${id}`);
            return (
              <li key={id}>
                {instruction ? (
                  <p
                    className="truncate py-0.5 text-[11px] italic text-primary/80"
                    style={{ paddingInlineStart: `${(depth + 1) * 1.25 + 2.25}rem` }}
                  >
                    ↳ {instruction.replace(/\.$/, "")}
                  </p>
                ) : null}
                <TreeRow
                  node={byId.get(id)!}
                  depth={depth + 1}
                  byId={byId}
                  childrenOf={childrenOf}
                  instructionOf={instructionOf}
                  onSelect={onSelect}
                  ancestors={new Set([...ancestors, node.id])}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
