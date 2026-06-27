"use client";

import { useState } from "react";
import { Pencil, PlugZap, Plus, Trash2, Wrench } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CustomToolDialog } from "@/features/dashboard-settings/custom-tool-dialog";
import { BUILTIN_TOOLS } from "@/lib/tools/catalog";
import {
  readCustomTools,
  writeCustomTools,
  type CustomTool,
} from "@/lib/tools/custom-tools";
import { McpServersContent } from "./mcp-servers-page";

const CUSTOM_TOOLS_STORAGE_KEY = "aui:dashboard:custom-tools";

function notifyToolRegistryChanged() {
  window.dispatchEvent(
    new StorageEvent("storage", { key: CUSTOM_TOOLS_STORAGE_KEY }),
  );
}

export function ToolsPageContent({ team }: { team: string }) {
  const [activeTab, setActiveTab] = useState("http");
  const [tools, setTools] = useState<CustomTool[]>(() =>
    typeof window === "undefined" ? [] : readCustomTools(),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<CustomTool | null>(null);
  const [deletingTool, setDeletingTool] = useState<CustomTool | null>(null);
  const [dialogKey, setDialogKey] = useState(0);

  const persist = (next: CustomTool[]) => {
    setTools(next);
    writeCustomTools(next);
    notifyToolRegistryChanged();
  };

  const openCreateDialog = () => {
    setEditingTool(null);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  };

  const openEditDialog = (tool: CustomTool) => {
    setEditingTool(tool);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  };

  const saveTool = (tool: CustomTool) => {
    const exists = tools.some((item) => item.id === tool.id);
    persist(
      exists
        ? tools.map((item) => (item.id === tool.id ? tool : item))
        : [...tools, tool],
    );
  };

  const deleteTool = () => {
    if (!deletingTool) return;
    persist(tools.filter((tool) => tool.id !== deletingTool.id));
    setDeletingTool(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tools"
        description="Connect HTTP tools and remote MCP servers the assistant can call from a conversation."
        actions={
          activeTab === "http" ? (
            <Button size="sm" onClick={openCreateDialog}>
              <Plus className="size-4" /> Connect tool
            </Button>
          ) : null
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="http">
            <Wrench className="size-4" /> Tools
          </TabsTrigger>
          <TabsTrigger value="mcp">
            <PlugZap className="size-4" /> MCP
          </TabsTrigger>
        </TabsList>

        <TabsContent value="http" className="mt-4">
          {tools.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="No tools connected"
              description="Connect a REST or webhook endpoint the assistant can call. Each tool declares its method, schema, and can be edited before use."
              action={
                <Button onClick={openCreateDialog}>
                  <Plus className="size-4" /> Connect tool
                </Button>
              }
            />
          ) : (
            <section className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-foreground">
                    Connected tools
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Browser-executed HTTP tools stored locally for this
                    workspace.
                  </p>
                </div>
                <Badge variant="secondary">{tools.length} custom</Badge>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Params</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tools.map((tool) => (
                    <TableRow key={tool.id}>
                      <TableCell className="max-w-[280px] whitespace-normal">
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted-foreground">
                              {tool.name}
                            </code>
                            <Badge variant="outline">{tool.method}</Badge>
                          </div>
                          <p className="line-clamp-2 text-sm text-muted-foreground">
                            {tool.description}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[360px] whitespace-normal">
                        <span className="line-clamp-2 font-mono text-xs text-muted-foreground">
                          {tool.url}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {tool.params.length}{" "}
                          {tool.params.length === 1 ? "param" : "params"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => openEditDialog(tool)}
                            aria-label={`Edit ${tool.name}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            onClick={() => setDeletingTool(tool)}
                            aria-label={`Delete ${tool.name}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </TabsContent>

        <TabsContent value="mcp" className="mt-4">
          <McpServersContent team={team} embedded />
        </TabsContent>
      </Tabs>

      <CustomToolDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        existingNames={[
          ...BUILTIN_TOOLS.map((tool) => tool.name),
          ...tools
            .filter((tool) => tool.id !== editingTool?.id)
            .map((tool) => tool.name),
        ]}
        tool={editingTool}
        onSave={saveTool}
      />

      <AlertDialog
        open={!!deletingTool}
        onOpenChange={(open) => !open && setDeletingTool(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tool</AlertDialogTitle>
            <AlertDialogDescription>
              This removes{" "}
              {deletingTool?.name ? `"${deletingTool.name}"` : "this tool"} from
              the local tool registry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteTool}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
