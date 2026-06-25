"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, FolderKanban, GitBranch, Plus, TerminalSquare } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAgents } from "@/features/agent-registry/api";
import { formatRelativeTime } from "@/lib/format";
import { useCreateProject, useProjects } from "./api";
import type { ProjectType } from "./types";

export function ProjectsScreen({ team }: { team: string }) {
  const projects = useProjects(team);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Agentic cockpit for business operations, coding work, and hybrid project tasks."
        actions={<CreateProjectDialog team={team} />}
      />

      {projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
      ) : projects.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      ) : projects.data?.items.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.data.items.map((project) => (
            <Link key={project.id} href={`/${team}/projects/${project.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{project.name}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {project.description || "No project context yet."}
                      </CardDescription>
                    </div>
                    <ProjectTypeBadge type={project.type} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <Metric label="Open" value={project.openTaskCount} />
                    <Metric label="Running" value={project.taskCounts.running} />
                    <Metric label="Resources" value={project.resourceCount} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{project.leadAgentId ? "Lead agent assigned" : "No lead agent"}</span>
                    <span>{formatRelativeTime(project.updatedAt)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create one cockpit per client, internal operation, or codebase. Tasks then spawn real agent runs."
          action={<CreateProjectDialog team={team} />}
        />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ProjectTypeBadge({ type }: { type: ProjectType }) {
  const label = type === "ops" ? "Ops" : type === "code" ? "Code" : "Hybrid";
  const Icon = type === "ops" ? Bot : type === "code" ? GitBranch : TerminalSquare;
  return (
    <Badge variant="secondary">
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </Badge>
  );
}

function CreateProjectDialog({ team }: { team: string }) {
  const createProject = useCreateProject(team);
  const agents = useAgents(team);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ProjectType>("hybrid");
  const [description, setDescription] = useState("");
  const [leadAgentId, setLeadAgentId] = useState<string>("none");

  function reset() {
    setName("");
    setType("hybrid");
    setDescription("");
    setLeadAgentId("none");
  }

  async function submit() {
    try {
      await createProject.mutateAsync({
        name,
        type,
        description,
        leadAgentId: leadAgentId === "none" ? null : leadAgentId,
      });
      toast.success("Project created");
      reset();
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create project");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Create a shared context for tasks, resources, and agent runs.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Client ops cockpit" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-type">Type</Label>
              <Select value={type} onValueChange={(value) => setType(value as ProjectType)}>
                <SelectTrigger id="project-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                    <SelectItem value="ops">TPE/PME ops</SelectItem>
                    <SelectItem value="code">Coding</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-agent">Lead agent</Label>
              <Select value={leadAgentId} onValueChange={setLeadAgentId}>
                <SelectTrigger id="lead-agent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">No lead yet</SelectItem>
                    {(agents.data?.items ?? []).map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-description">Context</Label>
            <Textarea
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this project is for, what agents should know, and what done looks like."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || createProject.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
