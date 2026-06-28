"use client";

import { useParams } from "next/navigation";
import { Info, Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useToolCatalog } from "@/features/tools/api";
import type { ToolCatalogItem, ToolGrant, ToolId } from "@/types/domain";
import { useBuilderStore } from "../store-context";
import type { Issue } from "../validation";
import { SectionWarnings, SectionHeading } from "./section-kit";

export function ToolsSection({ issues }: { issues: Issue[] }) {
  const { team } = useParams<{ team: string }>();
  const config = useBuilderStore((s) => s.config);
  const setTools = useBuilderStore((s) => s.setTools);
  const { data: catalog = [], isLoading } = useToolCatalog(team);
  const selected = new Map(config.tools.map((grant) => [grant.toolId, grant]));

  const updateGrant = (toolId: ToolId, patch: Partial<ToolGrant>) => {
    setTools(config.tools.map((grant) => (grant.toolId === toolId ? { ...grant, ...patch } : grant)));
  };

  const toggleTool = (tool: ToolCatalogItem, checked: boolean) => {
    if (!checked) {
      setTools(config.tools.filter((grant) => grant.toolId !== tool.toolId));
      return;
    }
    if (selected.has(tool.toolId)) return;
    setTools([
      ...config.tools,
      { toolId: tool.toolId, scopes: tool.scopes.includes("read") ? ["read"] : [tool.scopes[0] ?? "read"] },
    ]);
  };

  const toggleScope = (grant: ToolGrant, scope: string, checked: boolean) => {
    const scopes = checked ? [...new Set([...grant.scopes, scope])] : grant.scopes.filter((item) => item !== scope);
    updateGrant(grant.toolId, { scopes: scopes.length ? scopes : ["read"] });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <SectionHeading title="Tools" hint="Grant least-privilege scopes; gate writes behind approval." />
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading tool catalog…
        </div>
      ) : catalog.length === 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          Connect MCP servers in Tools, sync their catalog, then grant tools here with least-privilege scopes.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {catalog.map((tool) => {
            const grant = selected.get(tool.toolId);
            const disabled = tool.status !== "available";
            return (
              <li key={tool.toolId} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 items-start gap-3">
                    <Checkbox
                      className="mt-0.5"
                      checked={!!grant}
                      disabled={disabled}
                      onCheckedChange={(checked) => toggleTool(tool, checked === true)}
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm">{tool.name}</span>
                        <Badge variant="outline">{tool.source}</Badge>
                        {tool.serverName ? <span className="text-xs text-muted-foreground">{tool.serverName}</span> : null}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">
                        {tool.description || "No description provided."}
                      </span>
                    </span>
                  </label>
                  {disabled ? <Badge variant="secondary">unavailable</Badge> : null}
                </div>

                {grant ? (
                  <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {tool.scopes.map((scope) => (
                        <label key={scope} className="flex min-h-[44px] items-center gap-1.5 text-xs text-muted-foreground">
                          <Checkbox
                            checked={grant.scopes.includes(scope)}
                            onCheckedChange={(checked) => toggleScope(grant, scope, checked === true)}
                          />
                          {scope}
                        </label>
                      ))}
                      <Button variant="ghost" size="sm" className="ml-auto" onClick={() => toggleTool(tool, false)}>
                        Remove
                      </Button>
                    </div>
                    <label className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2">
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ShieldCheck className="size-3.5" />
                        Require approval before each call
                      </span>
                      <Switch
                        checked={grant.requireApproval ?? false}
                        onCheckedChange={(requireApproval) => updateGrant(grant.toolId, { requireApproval })}
                      />
                    </label>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <SectionWarnings issues={issues} />
    </div>
  );
}
