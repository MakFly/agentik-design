"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  useSyncMcpServer,
  useTestMcpServer,
  useUpdateMcpServer,
} from "./api";
import type { McpServer, McpTransport } from "@/types/domain";

interface FormState {
  name: string;
  transport: McpTransport;
  url: string;
  credentialId: string;
}

const emptyForm: FormState = {
  name: "",
  transport: "streamable_http",
  url: "",
  credentialId: "",
};

function toForm(server?: McpServer | null): FormState {
  if (!server) return emptyForm;
  return {
    name: server.name,
    transport: server.transport,
    url: server.url,
    credentialId: server.credentialId ?? "",
  };
}

export function McpServersPage({ team }: { team: string }) {
  return <McpServersContent team={team} />;
}

export function McpServersContent({
  team,
  embedded = false,
}: {
  team: string;
  embedded?: boolean;
}) {
  const { data: servers = [], isLoading } = useMcpServers(team);
  const createServer = useCreateMcpServer(team);
  const updateServer = useUpdateMcpServer(team);
  const deleteServer = useDeleteMcpServer(team);
  const testServer = useTestMcpServer(team);
  const syncServer = useSyncMcpServer(team);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [deleting, setDeleting] = useState<McpServer | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [feedback, setFeedback] = useState<string | null>(null);

  const busyId = useMemo(
    () =>
      testServer.variables ??
      syncServer.variables ??
      deleteServer.variables ??
      null,
    [deleteServer.variables, syncServer.variables, testServer.variables],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFeedback(null);
    setDialogOpen(true);
  };

  const openEdit = (server: McpServer) => {
    setEditing(server);
    setForm(toForm(server));
    setFeedback(null);
    setDialogOpen(true);
  };

  const submit = async () => {
    const body = {
      name: form.name.trim(),
      transport: form.transport,
      url: form.url.trim(),
      credentialId: form.credentialId.trim() || null,
    };
    if (editing) await updateServer.mutateAsync({ id: editing.id, ...body });
    else await createServer.mutateAsync(body);
    setDialogOpen(false);
  };

  const runTest = async (server: McpServer) => {
    const result = await testServer.mutateAsync(server.id);
    setFeedback(
      result.ok
        ? `${server.name}: ${result.toolCount} tool${result.toolCount > 1 ? "s" : ""} detected`
        : `${server.name}: ${result.error}`,
    );
  };

  const runSync = async (server: McpServer) => {
    const result = await syncServer.mutateAsync(server.id);
    setFeedback(
      "error" in result
        ? `${server.name}: ${result.error}`
        : `${server.name}: ${result.tools?.length ?? result.toolCount ?? 0} tools synced`,
    );
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    await deleteServer.mutateAsync(deleting.id);
    setDeleting(null);
  };

  return (
    <div className="flex flex-col gap-6">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">
              MCP servers
            </h2>
            <p className="text-sm text-muted-foreground">
              Remote MCP over Streamable HTTP and SSE.
            </p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" /> Add server
          </Button>
        </div>
      ) : (
        <PageHeader
          title="MCP servers"
          back={{ href: `/${team}/tools`, label: "Tools" }}
          description="Register remote MCP servers, sync their tools, then grant those tools to agents."
          actions={
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" /> Add server
            </Button>
          }
        />
      )}

      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
          <p className="text-sm text-muted-foreground">
            V1 supports remote MCP over Streamable HTTP and SSE.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/${team}/tools`}>
              <ArrowLeft className="size-4" /> HTTP tools
            </Link>
          </Button>
        </div>
      ) : null}

      {feedback ? (
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-muted-foreground">
          {feedback}
        </div>
      ) : null}

      {servers.length === 0 && !isLoading ? (
        <EmptyState
          icon={PlugZap}
          title="No MCP server connected"
          description="Add a remote MCP endpoint, test the connection, then sync its tool catalog."
          action={
            <Button onClick={openCreate}>
              <Plus className="size-4" /> Add server
            </Button>
          }
        />
      ) : (
        <section className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead className="w-48 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.map((server) => (
                <TableRow key={server.id}>
                  <TableCell className="max-w-[240px] whitespace-normal">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-foreground">
                        {server.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {server.transport === "sse" ? "SSE" : "Streamable HTTP"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[360px] whitespace-normal">
                    <span className="line-clamp-2 font-mono text-xs text-muted-foreground">
                      {server.url}
                    </span>
                    {server.lastError ? (
                      <p className="mt-1 line-clamp-2 text-xs text-danger">
                        {server.lastError}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        server.status === "online" ? "default" : "secondary"
                      }
                    >
                      {server.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{server.toolCount ?? 0}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => runTest(server)}
                        disabled={busyId === server.id}
                        aria-label={`Test ${server.name}`}
                      >
                        {busyId === server.id && testServer.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <PlugZap className="size-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => runSync(server)}
                        disabled={busyId === server.id}
                        aria-label={`Sync ${server.name}`}
                      >
                        {busyId === server.id && syncServer.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => openEdit(server)}
                        aria-label={`Edit ${server.name}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleting(server)}
                        aria-label={`Delete ${server.name}`}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit MCP server" : "Add MCP server"}
            </DialogTitle>
            <DialogDescription>
              Remote MCP servers are exposed to agents after a successful sync.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-name">Name</Label>
              <Input
                id="mcp-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Linear MCP"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-url">URL</Label>
              <Input
                id="mcp-url"
                value={form.url}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    url: event.target.value,
                  }))
                }
                placeholder="https://example.com/mcp"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-transport">Transport</Label>
              <Select
                value={form.transport}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    transport: value as McpTransport,
                  }))
                }
              >
                <SelectTrigger id="mcp-transport">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="streamable_http">
                    Streamable HTTP
                  </SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-credential">Credential ID</Label>
              <Input
                id="mcp-credential"
                value={form.credentialId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    credentialId: event.target.value,
                  }))
                }
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={
                !form.name.trim() ||
                !form.url.trim() ||
                createServer.isPending ||
                updateServer.isPending
              }
            >
              {createServer.isPending || updateServer.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {editing ? "Save" : "Add server"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete MCP server</AlertDialogTitle>
            <AlertDialogDescription>
              This removes{" "}
              {deleting?.name ? `"${deleting.name}"` : "this server"} and its
              synced tools.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
