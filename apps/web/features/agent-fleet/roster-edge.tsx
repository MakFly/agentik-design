"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { ArrowDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type RosterEdgeData = {
  instruction?: string;
  onRemove?: () => void;
};

type RosterFlowEdge = Edge<RosterEdgeData, "roster">;

/**
 * Delegation edge — instruction pill at midpoint; hover reveals remove affordance.
 */
export function RosterEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<RosterFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const label = data?.instruction?.replace(/\.$/, "") ?? "Delegates";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className="!stroke-[color-mix(in_oklch,var(--primary)_45%,var(--border))]"
      />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="pointer-events-none absolute flex flex-col items-center gap-1"
        >
          <ArrowDown className="size-3 text-primary/50" aria-hidden />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data?.onRemove?.();
            }}
            className={cn(
              "pointer-events-auto group/pill flex max-w-[168px] items-center gap-1 rounded-full border border-primary/20 bg-surface px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm transition-colors",
              "hover:border-danger/40 hover:bg-danger/5 hover:text-danger",
            )}
            title={data?.instruction ? `${data.instruction} — click to remove` : "Click to remove delegation"}
          >
            <span className="truncate">{label}</span>
            <X className="size-3 shrink-0 opacity-0 transition-opacity group-hover/pill:opacity-70" aria-hidden />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
