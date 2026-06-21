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
import { Play, Settings2, SlidersHorizontal, Trash2, X } from "lucide-react";
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
    <div className="flex h-full flex-col border-l border-[var(--n8n-border)] bg-[var(--n8n-panel)]">
      <div className="flex items-center gap-3 border-b border-[var(--n8n-border)] bg-[var(--n8n-surface)] px-4 py-3">
        <div
          className="flex size-9 items-center justify-center rounded-[10px] border border-[var(--n8n-border)] bg-[var(--n8n-surface)] shadow-sm"
          style={{ color: `var(${cfg.accentVar})` }}
        >
          <Icon className="size-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-tight text-foreground">{data.label}</p>
          <p className="text-[11px] text-muted-foreground">{cfg.description}</p>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 border-[var(--n8n-border)] bg-[var(--n8n-surface)] px-2.5 text-xs hover:bg-[var(--n8n-hover)]">
          <Play className="size-3.5" />
          Test step
        </Button>
        <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:bg-[var(--n8n-hover)]" onClick={() => selectNode(null)}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 border-b border-[var(--n8n-border)] bg-[var(--n8n-surface)] px-3 py-2">
        <button className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--n8n-brand-soft)] text-xs font-semibold text-[var(--n8n-brand)]">
          <SlidersHorizontal className="size-3.5" />
          Parameters
        </button>
        <button className="flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-[var(--n8n-hover)]">
          <Settings2 className="size-3.5" />
          Settings
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 p-4">
          <SectionTitle>Node</SectionTitle>
          <Field label="Label">
            <Input
              value={data.label}
              onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
              className="h-8 border-[var(--n8n-border)] bg-[var(--n8n-surface)] text-sm focus-visible:ring-[var(--n8n-focus)]"
            />
          </Field>

          <Separator />

          <SectionTitle>Configuration</SectionTitle>
          <NodeConfigForm nodeType={data.nodeType} config={data.config ?? {}} nodeId={node.id} />
        </div>
      </ScrollArea>

      <div className="border-t border-[var(--n8n-border)] bg-[var(--n8n-surface)] p-3">
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
  const renameDecisionBranch = useWorkflowStore((s) => s.renameDecisionBranch);
  const removeDecisionBranch = useWorkflowStore((s) => s.removeDecisionBranch);
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
          <Field label="Model">
            <Input
              value={(config.model as string) ?? ""}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder="gpt-4.1-mini"
              className="h-8 text-sm"
            />
          </Field>
          <Field label="Instructions (system)">
            <Textarea
              value={(config.instructions as string) ?? ""}
              onChange={(e) => patch({ instructions: e.target.value })}
              placeholder="You are a helpful assistant…"
              className="min-h-[80px] text-sm"
            />
          </Field>
          <Field label="Prompt">
            <Textarea
              value={(config.prompt as string) ?? ""}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder="{{ input.text }}"
              className="min-h-[80px] font-mono text-xs leading-relaxed"
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

    case "tool":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Tool">
            <Input
              value={(config.toolId as string) ?? ""}
              onChange={(e) => patch({ toolId: e.target.value })}
              placeholder="Select a tool"
              className="h-8 text-sm"
            />
          </Field>
          <Field label="Action">
            <Input
              value={(config.action as string) ?? ""}
              onChange={(e) => patch({ action: e.target.value })}
              placeholder="run"
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

    case "decision": {
      const branches = (config.branches as Array<{ label: string; expression: string }>) ?? [];
      const setExpression = (i: number, expression: string) =>
        patch({ branches: branches.map((b, j) => (j === i ? { ...b, expression } : b)) });
      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {branches.map((b, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-md border border-[var(--n8n-border)] p-2.5">
                <div className="flex items-center gap-2">
                  <Input
                    value={b.label}
                    onChange={(e) => renameDecisionBranch(nodeId, i, e.target.value)}
                    placeholder="branch label"
                    className="h-8 text-sm"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => removeDecisionBranch(nodeId, i)}
                    aria-label="Remove branch"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Input
                  value={b.expression}
                  onChange={(e) => setExpression(i, e.target.value)}
                  placeholder="input.amount > 100"
                  className="h-8 font-mono text-xs"
                />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => patch({ branches: [...branches, { label: `branch_${branches.length + 1}`, expression: "true" }] })}
            >
              Add branch
            </Button>
          </div>
          <Field label="Default branch (fallback)">
            <Input
              value={(config.default as string) ?? ""}
              onChange={(e) => patch({ default: e.target.value })}
              placeholder="default"
              className="h-8 text-sm"
            />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            The first branch whose expression is truthy is taken; otherwise the default. Each branch is a
            connection point on the node. Use <code>input</code>, <code>payload</code> in expressions.
          </p>
        </div>
      );
    }

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

    case "subflow":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Workflow">
            <Input
              value={(config.workflowId as string) ?? ""}
              onChange={(e) => patch({ workflowId: e.target.value })}
              placeholder="Select workflow"
              className="h-8 text-sm"
            />
          </Field>
          <Field label="Version">
            <Input
              value={(config.versionId as string) ?? "live"}
              onChange={(e) => patch({ versionId: e.target.value })}
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
