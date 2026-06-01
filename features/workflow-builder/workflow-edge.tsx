"use client";

import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { Plus } from "lucide-react";
import { createNode } from "./utils";
import { useWorkflowStore } from "./store";

function WorkflowEdgeRaw({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const addNode = useWorkflowStore((s) => s.addNode);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const isActive = selected || hovered;

  return (
    <>
      {/* invisible wider hit area */}
      <path
        d={edgePath}
        fill="none"
        strokeWidth={28}
        stroke="transparent"
        className="react-flow__edge-interaction"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isActive ? "var(--primary)" : "var(--border-strong)",
          strokeWidth: isActive ? 2 : 1.5,
          transition: "stroke 0.15s ease, stroke-width 0.15s ease",
        }}
      />

      {/* midpoint: label or add-node button */}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {label ? (
            <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm">
              {label}
            </span>
          ) : (
            <button
              className={cn(
                "flex size-6 items-center justify-center rounded-full",
                "border border-border bg-surface shadow-sm",
                "transition-all duration-150",
                "hover:border-primary hover:bg-primary hover:text-primary-foreground hover:scale-110",
                isActive ? "opacity-100 scale-100" : "opacity-0 scale-75",
              )}
              onClick={(e) => {
                e.stopPropagation();
                const midX = (sourceX + targetX) / 2;
                const midY = (sourceY + targetY) / 2;
                addNode(createNode("agent", { x: midX - 100, y: midY - 25 }));
              }}
            >
              <Plus className="size-3" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export const WorkflowEdge = memo(WorkflowEdgeRaw);
