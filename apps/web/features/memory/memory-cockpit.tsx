"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Database,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
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
  SelectGroup,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAgents } from "@/features/agent-registry/api";
import { useProjects } from "@/features/projects/api";
import {
  type MemoryEntry,
  type MemoryFilters,
  type MemoryInput,
  type MemoryScope,
  type SessionRecallHit,
  useArchiveMemory,
  useCreateMemory,
  useInjectionPreview,
  useMemoryEntries,
  useMemoryEvents,
  useRestoreMemory,
  useSessionRecall,
  useUpdateMemory,
} from "./api";

const scopes: MemoryScope[] = ["team", "project", "agent"];

export function MemoryCockpit({ team }: { team: string }) {
  const [filters, setFilters] = useState<MemoryFilters>({ scope: "all", createdBy: "all" });
  const [editing, setEditing] = useState<MemoryEntry | null>(null);
  const [creatingFrom, setCreatingFrom] = useState<Partial<MemoryInput> | null>(null);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | undefined>();
  const [agentId, setAgentId] = useState<string | undefined>();
  const [recallQuery, setRecallQuery] = useState("");

  const memories = useMemoryEntries(team, filters);
  const events = useMemoryEvents(team, selectedMemoryId);
  const agents = useAgents(team);
  const projects = useProjects(team);
  const preview = useInjectionPreview(team, agentId);
  const recall = useSessionRecall(team, recallQuery);
  const archiveMemory = useArchiveMemory(team);
  const restoreMemory = useRestoreMemory(team);

  const items = memories.data?.items ?? [];
  const activeCount = items.filter((item) => !item.archivedAt).length;
  const archivedCount = items.filter((item) => item.archivedAt).length;
  const reviewCount = items.filter((item) => item.createdBy === "review_agent").length;
  const injectedCount = preview.data?.memories.length ?? 0;

  const targetName = useTargetNamer(
    projects.data?.items ?? [],
    agents.data?.items ?? [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Memory"
        description="Inspect, curate, and audit the durable context injected into agent runs."
        actions={
          <Button size="sm" onClick={() => setCreatingFrom({ scope: "team", confidence: 1 })}>
            <Plus data-icon="inline-start" />
            New memory
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Active" value={activeCount} />
        <Metric label="From reviews" value={reviewCount} />
        <Metric label="Archived" value={archivedCount} />
        <Metric label="Preview injected" value={injectedCount} />
      </div>

      <Tabs defaultValue="memory" className="gap-4">
        <TabsList>
          <TabsTrigger value="memory">
            <Database />
            Entries
          </TabsTrigger>
          <TabsTrigger value="preview">
            <ShieldCheck />
            Injection Preview
          </TabsTrigger>
          <TabsTrigger value="recall">
            <History />
            Session Recall
          </TabsTrigger>
        </TabsList>

        <TabsContent value="memory" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search durable memory"
                value={filters.q ?? ""}
                onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
              />
            </div>
            <Select
              value={filters.scope ?? "all"}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, scope: value as MemoryFilters["scope"], targetId: undefined }))}
            >
              <SelectTrigger className="w-full md:w-36">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All scopes</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={filters.createdBy ?? "all"}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, createdBy: value as MemoryFilters["createdBy"] }))}
            >
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="review_agent">Review agent</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              variant={filters.includeArchived ? "secondary" : "outline"}
              onClick={() => setFilters((prev) => ({ ...prev, includeArchived: !prev.includeArchived }))}
            >
              {filters.includeArchived ? "Hide archived" : "Show archived"}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[360px]">Memory</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-36 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memories.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-40 text-center text-sm text-muted-foreground">
                      Loading memory.
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="p-0">
                      <EmptyState
                        icon={Database}
                        title="No memory matches this view"
                        description="Create a durable note or approve a review proposal, then it can be injected into future agent runs."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedMemoryId(item.id)}
                    >
                      <TableCell className="max-w-[520px] whitespace-normal">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm leading-5">{item.content}</span>
                          {item.archivedAt ? <Badge variant="muted">Archived</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.scope}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {targetName(item.scope, item.targetId)}
                      </TableCell>
                      <TableCell className="tabular-nums">{Math.round(item.confidence * 100)}%</TableCell>
                      <TableCell>
                        <Badge variant={item.createdBy === "review_agent" ? "info" : "secondary"}>
                          {item.createdBy}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(item.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(item)} title="Edit memory">
                            <Pencil />
                          </Button>
                          {item.archivedAt ? (
                            <Button variant="ghost" size="icon-sm" onClick={() => restoreMemory.mutate(item.id)} title="Restore memory">
                              <RotateCcw />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon-sm" onClick={() => archiveMemory.mutate(item.id)} title="Archive memory">
                              <Archive />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Audit trail</h2>
                <p className="text-sm text-muted-foreground">
                  Select a row to inspect create, edit, archive, and restore events.
                </p>
              </div>
              {selectedMemoryId ? <Badge variant="outline">{selectedMemoryId}</Badge> : null}
            </div>
            <div className="flex flex-col gap-2">
              {(events.data?.items ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit events selected.</p>
              ) : (
                events.data!.items.map((event) => (
                  <div key={event.id} className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="muted">{event.action}</Badge>
                      <span className="text-sm text-muted-foreground">{event.actorId}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{formatDate(event.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="preview" className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Injection Preview</h2>
              <p className="text-sm text-muted-foreground">
                See the durable context the engine will prepend when this agent claims its next run.
              </p>
            </div>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="w-full md:w-72">
                <SelectValue placeholder="Select a published agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(agents.data?.items ?? []).map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {!agentId ? (
            <EmptyState
              icon={ShieldCheck}
              title="Select an agent"
              description="The preview uses the agent's live memory policy, confidence threshold, and max entry cap."
            />
          ) : preview.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading preview.</p>
          ) : preview.data ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex flex-col gap-2">
                {preview.data.memories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No memories currently match this agent policy.</p>
                ) : (
                  preview.data.memories.map((memory, index) => (
                    <div key={`${memory.scope}-${index}`} className="rounded-md border border-border p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Badge variant="outline">{memory.scope}</Badge>
                        <span className="text-xs text-muted-foreground">{Math.round(memory.confidence * 100)}%</span>
                      </div>
                      <p className="text-sm leading-5">{memory.content}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="rounded-md border border-border p-3">
                <h3 className="mb-2 text-sm font-semibold">Policy</h3>
                <dl className="grid gap-2 text-sm">
                  <Row label="Inject" value={preview.data.memoryPolicy.inject ? "yes" : "no"} />
                  <Row label="Scopes" value={preview.data.memoryPolicy.scopes.join(", ")} />
                  <Row label="Max entries" value={String(preview.data.memoryPolicy.maxEntries)} />
                  <Row label="Min confidence" value={`${Math.round(preview.data.memoryPolicy.minConfidence * 100)}%`} />
                  <Row label="Skills" value={String(preview.data.skills.length)} />
                </dl>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="No live version"
              description="Publish the agent before previewing injected memory."
            />
          )}
        </TabsContent>

        <TabsContent value="recall" className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-surface p-3">
            <Label htmlFor="session-recall">Search session history</Label>
            <div className="mt-2 flex gap-2">
              <Input
                id="session-recall"
                placeholder="Search prior chat turns"
                value={recallQuery}
                onChange={(event) => setRecallQuery(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {(recall.data?.items ?? []).length === 0 ? (
              <EmptyState
                icon={History}
                title={recallQuery.trim().length >= 2 ? "No matching turns" : "Type at least two characters"}
                description="Session recall is read only until you promote a useful turn into durable memory."
              />
            ) : (
              recall.data!.items.map((hit) => (
                <RecallRow
                  key={hit.messageId}
                  hit={hit}
                  onPromote={() => setCreatingFrom({ scope: "team", confidence: 1, content: hit.content })}
                />
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      <MemoryDialog
        team={team}
        open={Boolean(editing || creatingFrom)}
        memory={editing}
        initial={creatingFrom ?? undefined}
        projects={projects.data?.items ?? []}
        agents={agents.data?.items ?? []}
        onClose={() => {
          setEditing(null);
          setCreatingFrom(null);
        }}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function RecallRow({ hit, onPromote }: { hit: SessionRecallHit; onPromote: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="outline">{hit.role}</Badge>
        <span className="text-sm text-muted-foreground">{hit.agentName ?? hit.agentId ?? "Unknown agent"}</span>
        <span className="text-sm text-muted-foreground">{formatDate(hit.createdAt)}</span>
      </div>
      <p className="mb-3 text-sm leading-5">{hit.content}</p>
      <Button variant="outline" size="sm" onClick={onPromote}>
        <Plus data-icon="inline-start" />
        Promote to memory
      </Button>
    </div>
  );
}

function MemoryDialog({
  team,
  open,
  memory,
  initial,
  projects,
  agents,
  onClose,
}: {
  team: string;
  open: boolean;
  memory: MemoryEntry | null;
  initial?: Partial<MemoryInput>;
  projects: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const createMemory = useCreateMemory(team);
  const updateMemory = useUpdateMemory(team);
  const [scope, setScope] = useState<MemoryScope>("team");
  const [targetId, setTargetId] = useState<string>("");
  const [confidence, setConfidence] = useState("1");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!open) return;
    setScope(memory?.scope ?? initial?.scope ?? "team");
    setTargetId(memory?.targetId ?? initial?.targetId ?? "");
    setConfidence(String(memory?.confidence ?? initial?.confidence ?? 1));
    setContent(memory?.content ?? initial?.content ?? "");
  }, [open, memory, initial]);

  const targets = scope === "project" ? projects : scope === "agent" ? agents : [];
  const disabled = createMemory.isPending || updateMemory.isPending;

  const submit = () => {
    const body = {
      scope,
      targetId: scope === "team" ? null : targetId,
      content,
      confidence: Number(confidence),
    };
    if (memory) {
      updateMemory.mutate({ id: memory.id, ...body }, { onSuccess: onClose });
    } else {
      createMemory.mutate(body, { onSuccess: onClose });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{memory ? "Edit memory" : "New memory"}</DialogTitle>
          <DialogDescription>
            Durable memory is injected only when an agent's policy allows its scope and confidence.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)_120px]">
            <div className="flex flex-col gap-2">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={(value) => {
                setScope(value as MemoryScope);
                setTargetId("");
              }}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {scopes.map((item) => (
                      <SelectItem key={item} value={item}>{item}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Target</Label>
              <Select
                value={scope === "team" ? "team" : targetId}
                disabled={scope === "team"}
                onValueChange={setTargetId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={scope === "team" ? "Whole team" : "Select target"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {scope === "team" ? (
                      <SelectItem value="team">Whole team</SelectItem>
                    ) : (
                      targets.map((target) => (
                        <SelectItem key={target.id} value={target.id}>{target.name}</SelectItem>
                      ))
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="memory-confidence">Confidence</Label>
              <Input
                id="memory-confidence"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={confidence}
                onChange={(event) => setConfidence(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="memory-content">Content</Label>
            <Textarea
              id="memory-content"
              className="min-h-36"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Write one durable fact, preference, constraint, or operating rule."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={disabled || !content.trim() || (scope !== "team" && !targetId)}>
            {memory ? "Save changes" : "Create memory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useTargetNamer(
  projects: Array<{ id: string; name: string }>,
  agents: Array<{ id: string; name: string }>,
) {
  return useMemo(() => {
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
    return (scope: MemoryScope, targetId: string | null) => {
      if (scope === "team") return "Whole team";
      if (!targetId) return "Unscoped";
      if (scope === "project") return projectNames.get(targetId) ?? targetId;
      if (scope === "agent") return agentNames.get(targetId) ?? targetId;
      return targetId;
    };
  }, [projects, agents]);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
