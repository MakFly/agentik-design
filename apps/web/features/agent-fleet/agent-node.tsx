"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentHealth } from "@/types/domain";
import type { AgentFlowNode } from "./fleet-graph-layout";

const DEFAULT_COLOR = "#6366f1";

const HEALTH_DOT: Record<AgentHealth, string> = {
  healthy: "bg-success",
  degraded: "bg-warning",
  error: "bg-danger",
  idle: "bg-muted-foreground/50",
  disabled: "bg-muted-foreground/30",
};

const HEALTH_LABEL: Record<AgentHealth, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  error: "Error",
  idle: "Idle",
  disabled: "Disabled",
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
        size === "sm" ? "size-7 text-base" : "size-10 text-xl",
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
      title={HEALTH_LABEL[health]}
      aria-label={`Health: ${health}`}
    />
  );
}

function RoleBadge({ role, isOrchestrator }: { role?: string; isOrchestrator: boolean }) {
  if (isOrchestrator) {
    return (
      <Badge variant="default" className="h-5 gap-1 rounded-full px-2 text-[10px] font-medium">
        <GitBranch className="size-2.5" aria-hidden />
        Orchestrator
      </Badge>
    );
  }
  if (!role) return null;
  return (
    <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px] font-medium capitalize">
      {role}
    </Badge>
  );
}

function AgentNodeImpl({ data, selected }: NodeProps<AgentFlowNode>) {
  const isHub = data.isOrchestrator || data.delegationCount > 0;

  return (
    <div
      className={cn(
        "group relative w-[200px] rounded-xl border bg-surface shadow-sm transition-all",
        data.isUnassigned && "border-dashed border-border bg-surface/80",
        isHub && !data.isUnassigned && "border-primary/30 bg-gradient-to-b from-primary/[0.04] to-surface",
        !isHub && !data.isUnassigned && "border-border",
        selected && "border-primary ring-2 ring-primary/25 shadow-md",
        !selected && "hover:border-border-strong hover:shadow-md",
      )}
    >
      {isHub && !data.isUnassigned ? (
        <span
          className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary/60"
          aria-hidden
        />
      ) : null}

      <Handle
        type="target"
        position={Position.Top}
        className="!-top-1.5 !size-2.5 !border-2 !border-border !bg-surface"
      />

      <div className="flex flex-col gap-2 px-3 py-3">
        <div className="flex items-start gap-2.5">
          <FleetAvatar emoji={data.emoji} color={data.color} />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">{data.name}</p>
            {data.role && !data.isOrchestrator ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{data.role}</p>
            ) : data.isOrchestrator ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">Routes work to roster</p>
            ) : null}
          </div>
          <HealthDot health={data.health} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <RoleBadge role={data.role} isOrchestrator={data.isOrchestrator} />
          {data.delegationCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <UserRound className="size-2.5" aria-hidden />
              {data.delegationCount} delegated
            </span>
          ) : data.isOrchestrator ? (
            <span className="text-[10px] text-muted-foreground">No roster yet</span>
          ) : null}
          {data.isUnassigned ? (
            <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
              Unassigned
            </Badge>
          ) : null}
        </div>
      </div>

      {data.isOrchestrator ? (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!-bottom-1.5 !size-2.5 !border-2 !border-primary/40 !bg-surface group-hover:!border-primary"
        />
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!-bottom-1.5 !size-2.5 !border-2 !border-border !bg-surface opacity-0"
        />
      )}
    </div>
  );
}

export const AgentNode = memo(AgentNodeImpl);
