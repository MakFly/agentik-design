"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export type RosterEdgeData = {
  instruction?: string;
  onRemove?: () => void;
};

type RosterFlowEdge = Edge<RosterEdgeData, "roster">;

/**
 * Delegation edge. Shows the per-edge instruction as a pill at the midpoint; the
 * pill is the click target for removing the link (the graph wires a confirm).
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

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="!stroke-border" />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data?.onRemove?.();
          }}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="pointer-events-auto absolute max-w-[140px] truncate rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-muted-foreground shadow-sm transition-colors hover:border-danger hover:text-danger"
          title={data?.instruction ? `${data.instruction} — click to remove` : "Click to remove"}
        >
          {data?.instruction ? data.instruction : "delegates ✕"}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
