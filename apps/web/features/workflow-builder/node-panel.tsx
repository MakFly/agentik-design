"use client";

import { useWorkflowStore } from "./store";
import { NODE_TYPE_CONFIGS } from "./constants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, X } from "lucide-react";
import type { NodeType } from "@/types/domain";

export function NodePanel() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const deleteSelected = useWorkflowStore((s) => s.deleteSelected);
  const selectNode = useWorkflowStore((s) => s.selectNode);

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const data = node.data as { nodeType: NodeType; label: string; config?: Record<string, unknown> };
  const cfg = NODE_TYPE_CONFIGS[data.nodeType];
  const Icon = cfg.icon;

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div
          className="flex size-8 items-center justify-center rounded-lg"
          style={{ background: `var(${cfg.bgVar})`, color: `var(${cfg.accentVar})` }}
        >
          <Icon className="size-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight text-foreground">{cfg.label}</p>
          <p className="text-[11px] text-muted-foreground">{cfg.description}</p>
        </div>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => selectNode(null)}>
          <X className="size-3.5" />
        </Button>
      </div>

      {/* body */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-5 p-4">
          <SectionTitle>General</SectionTitle>
          <Field label="Label">
            <Input
              value={data.label}
              onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
              className="h-8 text-sm"
            />
          </Field>

          <Separator />

          <SectionTitle>Configuration</SectionTitle>
          <NodeConfigForm nodeType={data.nodeType} config={data.config ?? {}} nodeId={node.id} />
        </div>
      </ScrollArea>

      {/* footer */}
      <div className="border-t border-border p-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-xs text-danger hover:bg-danger-surface hover:text-danger"
          onClick={deleteSelected}
        >
          <Trash2 className="size-3.5" /> Delete node
        </Button>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function NodeConfigForm({
  nodeType,
  config,
  nodeId,
}: {
  nodeType: NodeType;
  config: Record<string, unknown>;
  nodeId: string;
}) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const patch = (partial: Record<string, unknown>) => {
    updateNodeData(nodeId, { config: { ...config, ...partial } });
  };

  switch (nodeType) {
    case "trigger":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Trigger type">
            <Select
              value={(config.trigger as string) ?? "manual"}
              onValueChange={(v) => patch({ trigger: v })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="webhook">Webhook</SelectItem>
                <SelectItem value="schedule">Schedule (cron)</SelectItem>
                <SelectItem value="event">Event</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {config.trigger === "schedule" && (
            <Field label="Cron expression">
              <Input
                value={(config.cron as string) ?? ""}
                onChange={(e) => patch({ cron: e.target.value })}
                placeholder="0 * * * *"
                className="h-8 font-mono text-sm"
              />
            </Field>
          )}
        </div>
      );

    case "agent":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Agent">
            <Input
              value={(config.agentId as string) ?? ""}
              onChange={(e) => patch({ agentId: e.target.value })}
              placeholder="Select an agent…"
              className="h-8 text-sm"
            />
          </Field>
          <Field label="Timeout (ms)">
            <Input
              type="number"
              value={(config.timeoutMs as number) ?? 60000}
              onChange={(e) => patch({ timeoutMs: Number(e.target.value) })}
              className="h-8 text-sm"
            />
          </Field>
        </div>
      );

    case "api":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Method">
            <Select
              value={(config.method as string) ?? "GET"}
              onValueChange={(v) => patch({ method: v })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="URL">
            <Input
              value={(config.url as string) ?? ""}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder="https://api.example.com/…"
              className="h-8 text-sm"
            />
          </Field>
        </div>
      );

    case "code":
      return (
        <Field label="Source code">
          <Textarea
            value={(config.source as string) ?? ""}
            onChange={(e) => patch({ source: e.target.value })}
            className="min-h-[160px] font-mono text-xs leading-relaxed"
            placeholder="// your code here"
          />
        </Field>
      );

    case "decision":
      return (
        <Field label="Default branch">
          <Input
            value={(config.default as string) ?? ""}
            onChange={(e) => patch({ default: e.target.value })}
            className="h-8 text-sm"
          />
        </Field>
      );

    case "approval":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Approver role">
            <Input
              value={(config.approverRole as string) ?? ""}
              onChange={(e) => patch({ approverRole: e.target.value })}
              className="h-8 text-sm"
            />
          </Field>
          <Field label="Message">
            <Textarea
              value={(config.message as string) ?? ""}
              onChange={(e) => patch({ message: e.target.value })}
              className="min-h-[80px] text-sm"
            />
          </Field>
        </div>
      );

    case "loop":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Collection variable">
            <Input
              value={(config.collection as string) ?? ""}
              onChange={(e) => patch({ collection: e.target.value })}
              className="h-8 text-sm"
            />
          </Field>
          <Field label="Max iterations">
            <Input
              type="number"
              value={(config.maxIterations as number) ?? 100}
              onChange={(e) => patch({ maxIterations: Number(e.target.value) })}
              className="h-8 text-sm"
            />
          </Field>
        </div>
      );

    default:
      return (
        <p className="text-xs text-muted-foreground">
          No additional configuration for this node type.
        </p>
      );
  }
}
