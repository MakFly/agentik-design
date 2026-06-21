"use client";

import { useState, useMemo, type DragEvent } from "react";
import { Search, Sparkles } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { PALETTE_CATEGORIES, NODE_TYPE_CONFIGS, type NodeTypeConfig } from "./constants";
import { useWorkflowStore } from "./store";
import { createNode } from "./utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NodeType } from "@/types/domain";

function onDragStart(e: DragEvent, nodeType: NodeType) {
  e.dataTransfer.setData("application/agentik-node", nodeType);
  e.dataTransfer.effectAllowed = "move";
}

function PaletteItem({ item, onSelect }: { item: NodeTypeConfig; onSelect: (item: NodeTypeConfig) => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => onDragStart(e, item.type)}
      onClick={() => onSelect(item)}
      className="group flex w-full cursor-grab items-center gap-3 rounded-md border border-transparent px-2.5 py-2 text-left transition-all duration-150 hover:border-[var(--n8n-border)] hover:bg-[var(--n8n-hover)] active:cursor-grabbing active:scale-[0.99]"
    >
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-md border border-[var(--n8n-border)] bg-[var(--n8n-surface)] shadow-[0_1px_2px_rgb(15_23_42/0.06)] transition-transform duration-150 group-hover:scale-105"
        style={{
          color: `var(${item.accentVar})`,
        }}
      >
        <Icon className="size-4" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-tight text-foreground">
          {item.label}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {item.description}
        </p>
      </div>
    </button>
  );
}

export function NodePalette() {
  const [query, setQuery] = useState("");
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const addNode = useWorkflowStore((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();

  const allItems = useMemo(() => Object.values(NODE_TYPE_CONFIGS), []);

  const filtered = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return allItems.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q) ||
        n.type.includes(q),
    );
  }, [query, allItems]);

  const grouped = useMemo(
    () =>
      PALETTE_CATEGORIES.map((cat) => ({
        ...cat,
        items: allItems.filter((n) => n.category === cat.key),
      })),
    [allItems],
  );

  const addFromPalette = (item: NodeTypeConfig) => {
    const selected = nodes.find((node) => node.id === selectedNodeId);
    const selectedType = selected?.data?.nodeType;
    const selectedOutgoing = selected ? edges.find((edge) => edge.source === selected.id) : undefined;
    const position = selected
      ? { x: selected.position.x + 320, y: selected.position.y }
      : screenToFlowPosition({
          x: window.innerWidth / 2,
          y: Math.min(window.innerHeight / 2, 460),
        });

    addNode(createNode(item.type, position), {
      insertOnEdge: selectedOutgoing
        ? { id: selectedOutgoing.id, source: selectedOutgoing.source, target: selectedOutgoing.target }
        : undefined,
      connectFrom: selected && selectedType !== "end" && !selectedOutgoing ? selected.id : undefined,
      select: true,
    });
  };

  return (
    <div className="flex h-full flex-col bg-[var(--n8n-panel)]">
      <div className="border-b border-[var(--n8n-border)] px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold text-foreground">Nodes</p>
            <p className="text-[11px] text-muted-foreground">Search or drag into the workflow</p>
          </div>
          <div className="flex size-7 items-center justify-center rounded-md bg-[var(--n8n-brand-soft)] text-[var(--n8n-brand)]">
            <Sparkles className="size-3.5" />
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search nodes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-full rounded-md border border-[var(--n8n-border)] bg-[var(--n8n-surface)] pl-8 pr-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-[var(--n8n-brand)] focus:ring-2 focus:ring-[var(--n8n-focus)]"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2.5">
          {filtered ? (
            filtered.length > 0 ? (
              filtered.map((item) => <PaletteItem key={item.type} item={item} onSelect={addFromPalette} />)
            ) : (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No nodes match &ldquo;{query}&rdquo;
              </p>
            )
          ) : (
            grouped.map((cat) => (
              <div key={cat.key}>
                <p className="px-2.5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground first:pt-1">
                  {cat.label}
                </p>
                {cat.items.map((item) => (
                  <PaletteItem key={item.type} item={item} onSelect={addFromPalette} />
                ))}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
