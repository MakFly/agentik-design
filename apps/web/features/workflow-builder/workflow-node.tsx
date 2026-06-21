"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { NODE_TYPE_CONFIGS } from "./constants";
import { useWorkflowStore } from "./store";
import { cn } from "@/lib/utils";
import type { NodeType, NodeConfig } from "@/types/domain";

export type WorkflowNodeData = {
  nodeType: NodeType;
  label: string;
  config?: NodeConfig;
};

type WfNode = Node<WorkflowNodeData, "workflow">;

function WorkflowNodeRaw({ id, data, selected }: NodeProps<WfNode>) {
  const cfg = NODE_TYPE_CONFIGS[data.nodeType];
  const Icon = cfg.icon;
  const execution = useWorkflowStore((s) => s.nodeExecutions[id]);

  return (
    <>
      {data.nodeType !== "trigger" && (
        <Handle type="target" position={Position.Left} />
      )}

      <div
        className={cn(
          "group/node flex min-w-[220px] max-w-[280px] items-center gap-3",
          "rounded-[14px] border border-[var(--n8n-node-border)] bg-[var(--n8n-node)] px-3 py-3",
          "shadow-[0_2px_6px_rgb(15_23_42/0.08)] transition-[border-color,box-shadow,transform] duration-150",
          "hover:border-[var(--n8n-border-strong)] hover:shadow-[0_8px_18px_rgb(15_23_42/0.10)]",
          selected && "border-[var(--n8n-brand)] shadow-[0_0_0_3px_var(--n8n-focus),0_8px_22px_rgb(15_23_42/0.12)]",
        )}
      >
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-[var(--n8n-border)] bg-[var(--n8n-surface)] shadow-[0_1px_2px_rgb(15_23_42/0.06)]"
          style={{ color: `var(${cfg.accentVar})` }}
        >
          <Icon className="size-[18px]" strokeWidth={2} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight text-foreground">
            {data.label}
          </p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {cfg.description}
          </p>
        </div>
        <NodeStatus status={execution?.status} />
      </div>

      {data.nodeType === "decision" ? (
        <DecisionHandles config={data.config} />
      ) : (
        data.nodeType !== "end" && <Handle type="source" position={Position.Right} />
      )}
    </>
  );
}

/** One labelled source handle per branch (+ default) so edges carry sourceHandle. */
function DecisionHandles({ config }: { config?: NodeConfig }) {
  const branches =
    config?.type === "decision"
      ? [...config.branches.map((b) => b.label), config.default]
      : ["default"];
  const handles = Array.from(new Set(branches.filter(Boolean)));

  return (
    <>
      {handles.map((label, i) => {
        const top = ((i + 1) / (handles.length + 1)) * 100;
        return (
          <Handle
            key={label}
            id={label}
            type="source"
            position={Position.Right}
            style={{ top: `${top}%` }}
          >
            <span className="pointer-events-none absolute left-3 -translate-y-1/2 whitespace-nowrap text-[9px] font-medium text-muted-foreground">
              {label}
            </span>
          </Handle>
        );
      })}
    </>
  );
}

function NodeStatus({ status }: { status?: "waiting" | "running" | "success" | "error" }) {
  if (status === "running") {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-[var(--n8n-brand-soft)] text-[var(--n8n-brand)]">
        <Loader2 className="size-3 animate-spin" />
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-danger-surface text-danger">
        <AlertTriangle className="size-3" />
      </span>
    );
  }

  if (status === "success") {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-[var(--n8n-success-soft)] text-[var(--n8n-success)]">
        <Check className="size-3" />
      </span>
    );
  }

  return <span className="size-2 rounded-full bg-[var(--n8n-success)] shadow-[0_0_0_3px_var(--n8n-success-soft)]" />;
}

export const WorkflowNode = memo(WorkflowNodeRaw);
