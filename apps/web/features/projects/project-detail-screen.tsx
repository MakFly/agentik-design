"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Circle,
  ExternalLink,
  GitBranch,
  KeyRound,
  Layers3,
  ListTodo,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  RadioTower,
  Send,
  TerminalSquare,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAgents } from "@/features/agent-registry/api";
import { useChannels } from "@/features/channels/api";
import type { ChannelConnection } from "@/features/channels/types";
import { useRun } from "@/features/run-view/api";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDuration, formatMoney, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  useAddProjectResource,
  useAddProjectTaskComment,
  useCreateProjectTask,
  useProject,
  useProjectTaskComments,
  useRunProjectTask,
  useUpdateProjectTask,
} from "./api";
import type {
  ProjectDetail,
  ProjectResourceType,
  ProjectTask,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from "./types";

const BOARD: Array<{ status: ProjectTaskStatus; label: string }> = [
  { status: "ready", label: "Ready" },
  { status: "running", label: "Running" },
  { status: "blocked", label: "Blocked" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
];

export function ProjectDetailScreen({
  team,
  projectId,
}: {
  team: string;
  projectId: string;
}) {
  const project = useProject(team, projectId);
  const agents = useAgents(team);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const selectedTask = useMemo(() => {
    const tasks = project.data?.tasks ?? [];
    return (
      tasks.find((task) => task.id === selectedTaskId) ??
      tasks.find((task) => task.status === "running") ??
      tasks[0] ??
      null
    );
  }, [project.data?.tasks, selectedTaskId]);

  if (project.isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Project"
          back={{ href: `/${team}/projects`, label: "Projects" }}
        />
        <ErrorState error={project.error} onRetry={() => project.refetch()} />
      </div>
    );
  }

  if (project.isLoading || !project.data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Project"
          back={{ href: `/${team}/projects`, label: "Projects" }}
        />
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[520px]" />
        </div>
      </div>
    );
  }

  const agentName = (id: string | null | undefined) =>
    agents.data?.items.find((agent) => agent.id === id)?.name ??
    id ??
    "Unassigned";

  return (
    <div className="flex min-h-[calc(100dvh-var(--navbar-h)-3rem)] flex-col md:min-h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <ProjectDetailHeader
        team={team}
        projectId={projectId}
        detail={project.data}
        agents={agents.data?.items ?? []}
      />

      <div className="grid min-h-0 flex-1 gap-4 pt-4 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        <TaskBoard
          detail={project.data}
          selectedTaskId={selectedTask?.id ?? null}
          onSelect={setSelectedTaskId}
          agentName={agentName}
        />
        <ProjectConsole
          team={team}
          projectId={projectId}
          task={selectedTask}
          agents={agents.data?.items ?? []}
          agentName={agentName}
        />
        <ProjectContextPanel
          team={team}
          detail={project.data}
          agentName={agentName}
        />
      </div>
    </div>
  );
}

function ProjectDetailHeader({
  team,
  projectId,
  detail,
  agents,
}: {
  team: string;
  projectId: string;
  detail: ProjectDetail;
  agents: Array<{ id: string; name: string }>;
}) {
  const activeCount = detail.tasks.filter((task) =>
    ["running", "blocked", "review"].includes(task.status),
  ).length;

  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div className="flex min-w-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="size-9">
          <Link href={`/${team}/projects`} aria-label="Back to projects">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-base font-semibold">
              {detail.project.name}
            </h1>
            <ProjectKindBadge type={detail.project.type} />
            <Badge variant={activeCount > 0 ? "default" : "secondary"}>
              {activeCount} active
            </Badge>
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {detail.project.description ||
              "Project workspace, task queue, agent console, memory and channels."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          <ListTodo className="size-3.5" />
          {detail.project.openTaskCount} open
        </Badge>
        <AddResourceDialog team={team} projectId={projectId} />
        <CreateTaskDialog team={team} projectId={projectId} agents={agents} />
      </div>
    </header>
  );
}

function ProjectKindBadge({ type }: { type: string }) {
  const Icon =
    type === "ops" ? Bot : type === "code" ? GitBranch : TerminalSquare;
  return (
    <Badge variant="secondary">
      <Icon className="size-3.5" />
      {type}
    </Badge>
  );
}

function TaskBoard({
  detail,
  selectedTaskId,
  onSelect,
  agentName,
}: {
  detail: ProjectDetail;
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
  agentName: (agentId: string | null | undefined) => string;
}) {
  if (!detail.tasks.length) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <PanelHeader
          icon={ListTodo}
          title="Tasks"
          meta={`${detail.project.openTaskCount} open`}
        />
        <EmptyState
          icon={MessageSquare}
          title="No tasks"
          description="Create a task to assign an agent and start a run."
          className="min-h-[420px] border-0"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <PanelHeader
        icon={ListTodo}
        title="Tasks"
        meta={`${detail.project.openTaskCount} open`}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {BOARD.map((column) => {
          const tasks = detail.tasks.filter(
            (task) => task.status === column.status,
          );
          return (
            <section key={column.status} className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>{column.label}</span>
                <span className="tabular-nums">{tasks.length}</span>
              </div>
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onSelect(task.id)}
                  className={cn(
                    "flex w-full flex-col gap-2 rounded-md border border-border bg-background p-3 text-left text-sm transition-colors hover:border-primary/40",
                    selectedTaskId === task.id && "border-primary bg-primary/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 font-medium leading-5">
                      {task.title}
                    </span>
                    <Badge variant="outline">{task.priority}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Circle className="size-2 fill-current" />
                    <span className="truncate">
                      {agentName(task.assignedAgentId)}
                    </span>
                  </div>
                </button>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ProjectConsole({
  team,
  projectId,
  task,
  agents,
  agentName,
}: {
  team: string;
  projectId: string;
  task: ProjectTask | null;
  agents: Array<{ id: string; name: string }>;
  agentName: (agentId: string | null | undefined) => string;
}) {
  const comments = useProjectTaskComments(team, task?.id ?? null);
  const addComment = useAddProjectTaskComment(team, projectId);
  const runTask = useRunProjectTask(team, projectId);
  const updateTask = useUpdateProjectTask(team, projectId);
  const latestRunId = task?.lastRunId ?? "";
  const latestRun = useRun(team, latestRunId, {
    enabled: Boolean(latestRunId),
  });
  const [message, setMessage] = useState("");
  const [instruction, setInstruction] = useState("");

  if (!task) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <PanelHeader
          icon={TerminalSquare}
          title="Agent console"
          meta="No task selected"
        />
        <EmptyState
          icon={TerminalSquare}
          title="Select a task"
          description="The TUI console is scoped to one task so comments, runs, and review stay attached."
          className="min-h-[520px] border-0"
        />
      </div>
    );
  }
  const activeTask = task;

  async function submitComment() {
    if (!message.trim()) return;
    try {
      await addComment.mutateAsync({ taskId: activeTask.id, content: message });
      setMessage("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add comment",
      );
    }
  }

  async function run() {
    try {
      const res = await runTask.mutateAsync({
        taskId: activeTask.id,
        instruction,
      });
      setInstruction("");
      toast.success("Run queued");
      window.setTimeout(() => {
        if (res.runId) window.location.href = `/${team}/runs/${res.runId}`;
      }, 350);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start run",
      );
    }
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <TerminalSquare className="size-3.5" />
              Agent console
            </span>
            <Badge variant="outline">{task.status}</Badge>
            <Badge variant="secondary">{task.priority}</Badge>
          </div>
          <h2 className="line-clamp-1 text-base font-semibold">
            {task.title}
          </h2>
          {task.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {task.description}
            </p>
          ) : null}
        </div>
        {task.lastRunId ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/${team}/runs/${task.lastRunId}`}>Open run</Link>
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-agent">Assigned agent</Label>
            <Select
              value={task.assignedAgentId ?? "none"}
              onValueChange={(assignedAgentId) =>
                updateTask.mutate({
                  taskId: task.id,
                  assignedAgentId:
                    assignedAgentId === "none" ? null : assignedAgentId,
                })
              }
            >
              <SelectTrigger id="task-agent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-status">Status</Label>
            <Select
              value={task.status}
              onValueChange={(status) =>
                updateTask.mutate({
                  taskId: task.id,
                  status: status as ProjectTaskStatus,
                })
              }
            >
              <SelectTrigger id="task-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {BOARD.map((item) => (
                    <SelectItem key={item.status} value={item.status}>
                      {item.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="backlog">Backlog</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        <section className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">Run instruction</h3>
              <p className="text-xs text-muted-foreground">
                Runtime target: {agentName(task.assignedAgentId)}
              </p>
            </div>
            <Button
              onClick={run}
              disabled={runTask.isPending || !task.assignedAgentId}
              size="sm"
            >
              {runTask.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Run
            </Button>
          </div>
          <Textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="/run optional instruction for this attempt: inspect the repo, propose a patch, list tests."
            className="min-h-24 font-mono text-sm"
          />
        </section>

        <section className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Latest run</h3>
              <p className="text-xs text-muted-foreground">
                Hermes-style execution handoff for this task.
              </p>
            </div>
            {task.lastRunId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/${team}/runs/${task.lastRunId}`}>
                  Open console
                </Link>
              </Button>
            ) : null}
          </div>
          {!task.lastRunId ? (
            <p className="text-sm text-muted-foreground">
              No run yet. Assign an agent, then start the task.
            </p>
          ) : latestRun.isLoading ? (
            <Skeleton className="h-16" />
          ) : latestRun.data?.run ? (
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <RunMetric
                label="Status"
                value={
                  <StatusBadge status={latestRun.data.run.status} size="sm" />
                }
              />
              <RunMetric
                label="Steps"
                value={`${latestRun.data.run.completedSteps}/${latestRun.data.run.stepCount}`}
              />
              <RunMetric
                label="Cost"
                value={`${formatMoney(latestRun.data.run.cost.money)} · ${formatDuration(latestRun.data.run.durationMs)}`}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Run details are not available yet.
            </p>
          )}
        </section>

        <section className="flex flex-1 flex-col gap-3 rounded-md border border-border bg-background p-3">
          <h3 className="text-sm font-medium">Thread</h3>
          <div className="flex min-h-40 flex-col gap-2 overflow-y-auto">
            {comments.isLoading ? (
              <Skeleton className="h-20" />
            ) : comments.data?.items.length ? (
              comments.data.items.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{comment.authorKind}</span>
                    <span>{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap leading-6">
                    {comment.content}
                  </p>
                  {comment.runId ? (
                    <Link
                      href={`/${team}/runs/${comment.runId}`}
                      className="mt-2 inline-flex text-xs font-medium text-primary"
                    >
                      Open linked run
                    </Link>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            )}
          </div>
          <div className="flex flex-col gap-2 md:flex-row">
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="/task note, blocker, decision, or next instruction."
            className="min-h-20 flex-1"
          />
            <Button
              onClick={submitComment}
              disabled={!message.trim() || addComment.isPending}
              className="md:self-end"
            >
              <Send className="size-4" />
              Send
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function RunMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
      <div className="min-h-5 text-sm font-medium tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ProjectContextPanel({
  team,
  detail,
  agentName,
}: {
  team: string;
  detail: ProjectDetail;
  agentName: (agentId: string | null | undefined) => string;
}) {
  const channels = useChannels(team);
  const activeRunTasks = detail.tasks.filter((task) =>
    ["running", "blocked", "review"].includes(task.status),
  );

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <PanelHeader icon={Layers3} title="Project context" meta="live scope" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Context</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {detail.project.description ||
            "Add context so agents know the company, codebase, constraints, and definition of done."}
        </p>
        <div className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <span className="text-muted-foreground">Lead:</span>{" "}
          {agentName(detail.project.leadAgentId)}
        </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Active runs</h2>
        {activeRunTasks.length ? (
          activeRunTasks.slice(0, 5).map((task) => (
            <div
              key={task.id}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{task.title}</span>
                <StatusBadge status={task.status} size="sm" />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{agentName(task.assignedAgentId)}</span>
                {task.lastRunId ? (
                  <Link
                    href={`/${team}/runs/${task.lastRunId}`}
                    className="inline-flex items-center gap-1 text-primary"
                  >
                    Console
                    <ExternalLink className="size-3" />
                  </Link>
                ) : (
                  <span>No run yet</span>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No active run for this project.
          </p>
        )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Resources</h2>
        {detail.resources.length ? (
          detail.resources.map((resource) => (
            <div
              key={resource.id}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{resource.label}</span>
                <Badge variant="outline">{resource.type}</Badge>
              </div>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {resource.ref}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Attach a Git repo, local folder, URL, document, or tool.
          </p>
        )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Memory</h2>
        {detail.memories.length ? (
          detail.memories.slice(0, 6).map((memory) => (
            <div
              key={memory.id}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <p className="leading-5">{memory.content}</p>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{memory.createdBy}</span>
                <span>{formatRelativeTime(memory.createdAt)}</span>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Telegram /learn and approved reviews will add reusable project
            memory here.
          </p>
        )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Workspaces</h2>
        {detail.workspaces.length ? (
          detail.workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <StatusBadge status={workspace.status} size="sm" />
                <Badge variant="secondary">
                  {workspace.branch || "default"}
                </Badge>
              </div>
              <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                {workspace.path || "No path reported yet"}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {workspace.daemonId
                    ? `daemon ${workspace.daemonId}`
                    : "daemon pending"}
                </span>
                <span>
                  {workspace.resourceId ? "resource-backed" : "scratch"}
                </span>
              </div>
              {workspace.error ? (
                <p className="mt-1 text-xs text-danger">{workspace.error}</p>
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Workspace provisioning will appear after the daemon prepares this
            project.
          </p>
        )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Linked channels</h2>
        {channels.isLoading ? (
          <Skeleton className="h-20" />
        ) : channels.data?.items.length ? (
          channels.data.items
            .slice(0, 4)
            .map((channel) => (
              <ProjectChannelCard key={channel.id} channel={channel} />
            ))
        ) : (
          <div className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-sm text-muted-foreground">
            <p>No Telegram channel connected.</p>
            <Link
              href={`/${team}/channels`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary"
            >
              Connect channel
              <ExternalLink className="size-3" />
            </Link>
          </div>
        )}
        </section>
      </div>
    </aside>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  meta,
}: {
  icon: typeof TerminalSquare;
  title: string;
  meta: string;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
      <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{title}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
    </div>
  );
}

function ProjectChannelCard({ channel }: { channel: ChannelConnection }) {
  const startUrl = telegramStartUrl(channel);

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-2 font-medium">
          <RadioTower className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{channel.label}</span>
        </span>
        <StatusBadge status={channel.status} size="sm" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-surface-2 px-2 py-1">
          <span className="text-muted-foreground">Identities </span>
          <span className="font-medium tabular-nums">
            {channel.identityCount}
          </span>
        </div>
        <div className="rounded bg-surface-2 px-2 py-1">
          <span className="text-muted-foreground">Token </span>
          <span className="font-medium">
            {channel.botTokenConfigured ? "set" : "missing"}
          </span>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 rounded bg-surface-2 px-2 py-1 font-mono text-xs text-muted-foreground">
        <KeyRound className="size-3.5 shrink-0" />
        /start {channel.pairingCode}
        {startUrl ? (
          <a
            href={startUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex shrink-0 items-center gap-1 font-sans text-foreground hover:underline"
          >
            Open
            <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function telegramStartUrl(channel: Pick<ChannelConnection, "botUsername" | "pairingCode">) {
  if (!channel.botUsername) return null;
  return `https://t.me/${channel.botUsername}?start=${encodeURIComponent(channel.pairingCode)}`;
}

function CreateTaskDialog({
  team,
  projectId,
  agents,
}: {
  team: string;
  projectId: string;
  agents: Array<{ id: string; name: string }>;
}) {
  const createTask = useCreateProjectTask(team, projectId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<ProjectTaskPriority>("P2");
  const [assignedAgentId, setAssignedAgentId] = useState("none");

  async function submit() {
    try {
      await createTask.mutateAsync({
        title,
        description,
        priority,
        assignedAgentId: assignedAgentId === "none" ? null : assignedAgentId,
      });
      setTitle("");
      setDescription("");
      setPriority("P2");
      setAssignedAgentId("none");
      setOpen(false);
      toast.success("Task created");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create task",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          New task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Create a project task that can spawn an agent run.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-detail">Detail</Label>
            <Textarea
              id="task-detail"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) =>
                  setPriority(value as ProjectTaskPriority)
                }
              >
                <SelectTrigger id="task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="P0">P0</SelectItem>
                    <SelectItem value="P1">P1</SelectItem>
                    <SelectItem value="P2">P2</SelectItem>
                    <SelectItem value="P3">P3</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-agent-new">Agent</Label>
              <Select
                value={assignedAgentId}
                onValueChange={setAssignedAgentId}
              >
                <SelectTrigger id="task-agent-new">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Use project lead</SelectItem>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!title.trim() || createTask.isPending}
          >
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddResourceDialog({
  team,
  projectId,
}: {
  team: string;
  projectId: string;
}) {
  const addResource = useAddProjectResource(team, projectId);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ProjectResourceType>("git_repo");
  const [label, setLabel] = useState("");
  const [ref, setRef] = useState("");

  async function submit() {
    try {
      await addResource.mutateAsync({ type, label, ref });
      setLabel("");
      setRef("");
      setOpen(false);
      toast.success("Resource attached");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not attach resource",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" />
          Resource
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add resource</DialogTitle>
          <DialogDescription>
            Attach a repo, local path, URL, document, or tool to the project
            context.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="resource-type">Type</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as ProjectResourceType)}
              >
                <SelectTrigger id="resource-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="git_repo">Git repo</SelectItem>
                    <SelectItem value="local_dir">Local dir</SelectItem>
                    <SelectItem value="url">URL</SelectItem>
                    <SelectItem value="document">Document</SelectItem>
                    <SelectItem value="tool">Tool</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="resource-label">Label</Label>
              <Input
                id="resource-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="resource-ref">Reference</Label>
            <Input
              id="resource-ref"
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              placeholder="git@github.com:org/repo.git, /home/me/repo, or https://..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!ref.trim() || addResource.isPending}
          >
            Attach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
