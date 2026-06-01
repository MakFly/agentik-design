"use client";

import { useState, useMemo, type DragEvent } from "react";
import { Search } from "lucide-react";
import { PALETTE_CATEGORIES, NODE_TYPE_CONFIGS, type NodeTypeConfig } from "./constants";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NodeType } from "@/types/domain";

function onDragStart(e: DragEvent, nodeType: NodeType) {
  e.dataTransfer.setData("application/agentik-node", nodeType);
  e.dataTransfer.effectAllowed = "move";
}

function PaletteItem({ item }: { item: NodeTypeConfig }) {
  const Icon = item.icon;
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item.type)}
      className="group flex cursor-grab items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-all duration-150 hover:border-border hover:bg-surface-2 active:cursor-grabbing active:scale-[0.98]"
    >
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-[9px] shadow-sm transition-transform duration-150 group-hover:scale-105"
        style={{
          background: `var(${item.bgVar})`,
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
    </div>
  );
}

export function NodePalette() {
  const [query, setQuery] = useState("");

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

  return (
    <div className="flex h-full flex-col">
      {/* search */}
      <div className="border-b border-border px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search nodes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* items */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {filtered ? (
            filtered.length > 0 ? (
              filtered.map((item) => <PaletteItem key={item.type} item={item} />)
            ) : (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No nodes match &ldquo;{query}&rdquo;
              </p>
            )
          ) : (
            grouped.map((cat) => (
              <div key={cat.key}>
                <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground first:pt-1">
                  {cat.label}
                </p>
                {cat.items.map((item) => (
                  <PaletteItem key={item.type} item={item} />
                ))}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
