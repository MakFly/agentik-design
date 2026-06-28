"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentHealth } from "@/types/domain";
import type { FleetNode } from "./api";

const DEFAULT_COLOR = "#6366f1";

const HEALTH_DOT: Record<AgentHealth, string> = {
  healthy: "bg-success",
  degraded: "bg-warning",
  error: "bg-danger",
  idle: "bg-muted-foreground/50",
  disabled: "bg-muted-foreground/30",
};

/** A glanceable avatar (emoji on its color) reused by the graph, list and inspector. */
export function FleetAvatar({
  emoji,
  color,
  size = "md",
}: {
  emoji?: string;
  color?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-black/5",
        size === "sm" ? "size-7 text-base" : "size-9 text-xl",
      )}
      style={{ backgroundColor: color ?? DEFAULT_COLOR }}
      aria-hidden
    >
      <span className="drop-shadow-sm">{emoji ?? "🤖"}</span>
    </span>
  );
}

export function HealthDot({ health }: { health: AgentHealth }) {
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", HEALTH_DOT[health])}
      title={health}
      aria-label={`Health: ${health}`}
    />
  );
}

type AgentFlowNode = Node<FleetNode, "agent">;

function AgentNodeImpl({ data, selected }: NodeProps<AgentFlowNode>) {
  return (
    <div
      className={cn(
        "w-[180px] rounded-lg border bg-surface px-3 py-2.5 shadow-sm transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    >
      <Handle type="target" position={Position.Top} className="!size-2 !border-border !bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <FleetAvatar emoji={data.emoji} color={data.color} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{data.name}</p>
          {data.role ? <p className="truncate text-xs text-muted-foreground">{data.role}</p> : null}
        </div>
        <HealthDot health={data.health} />
      </div>
      {data.isOrchestrator ? (
        <Badge variant="secondary" className="mt-2 rounded-full text-[10px]">
          Orchestrator
        </Badge>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!size-2 !border-border !bg-muted-foreground" />
    </div>
  );
}

export const AgentNode = memo(AgentNodeImpl);
