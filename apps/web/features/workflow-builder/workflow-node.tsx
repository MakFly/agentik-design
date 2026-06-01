"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { NODE_TYPE_CONFIGS } from "./constants";
import { cn } from "@/lib/utils";
import type { NodeType, NodeConfig } from "@/types/domain";

export type WorkflowNodeData = {
  nodeType: NodeType;
  label: string;
  config?: NodeConfig;
};

type WfNode = Node<WorkflowNodeData, "workflow">;

function WorkflowNodeRaw({ data, selected }: NodeProps<WfNode>) {
  const cfg = NODE_TYPE_CONFIGS[data.nodeType];
  const Icon = cfg.icon;

  return (
    <>
      {data.nodeType !== "trigger" && (
        <Handle type="target" position={Position.Left} />
      )}

      <div
        className={cn(
          "group/node flex min-w-[200px] max-w-[260px] items-center gap-3.5",
          "rounded-xl border border-border bg-surface px-4 py-3.5",
          "shadow-sm transition-all duration-150",
          selected && "ring-2 ring-primary/40 border-primary/30 shadow-lg",
        )}
      >
        {/* icon badge */}
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-[10px] shadow-sm"
          style={{ background: `var(${cfg.bgVar})`, color: `var(${cfg.accentVar})` }}
        >
          <Icon className="size-[18px]" strokeWidth={2} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight tracking-tight text-foreground">
            {data.label}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {cfg.description}
          </p>
        </div>
      </div>

      {data.nodeType !== "end" && (
        <Handle type="source" position={Position.Right} />
      )}
    </>
  );
}

export const WorkflowNode = memo(WorkflowNodeRaw);
