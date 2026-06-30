"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { Bot, Filter, LayoutList, Plus, ShieldAlert, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RbacGate } from "@/lib/auth/rbac";
import { useAgents, useAgentTaskSnapshot, useDeleteAgent } from "./api";
import type { AgentRow } from "./types";
import { derivePresence, type AgentTaskSnapshot, type Availability } from "@/lib/agents/presence";
import { formatDuration, formatPercent, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TemplatesButton } from "./agent-templates-dialog";
import { toast } from "sonner";

const DOT: Record<Availability, string> = {
  online: "bg-success",
  unstable: "bg-warning",
  offline: "bg-muted-foreground/40",
};

const AVAILABILITY_LABEL: Record<Availability, string> = {
  online: "en ligne",
  unstable: "instable",
  offline: "hors ligne",
};

const HEALTH_LABEL: Record<AgentRow["health"], string> = {
  healthy: "Prêt",
  degraded: "Dégradé",
  error: "Erreur",
  idle: "Disponible",
  disabled: "Désactivé",
};

const HEALTH_CLASS: Record<AgentRow["health"], string> = {
  healthy: "bg-success/10 text-success",
  degraded: "bg-warning/10 text-warning",
  error: "bg-danger/10 text-danger",
  idle: "bg-surface-2 text-muted-foreground",
  disabled: "bg-surface-2 text-muted-foreground",
};

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];

function formatRelativeTimeFr(input: string | number | Date, now: number = Date.now()): string {
  const parse = (s: string) => Date.parse(s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  const ts = input instanceof Date ? input.getTime() : typeof input === "number" ? input : parse(input);
  if (Number.isNaN(ts)) return "—";
  const diff = ts - now;
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto", style: "short" });
  for (const [unit, msPerUnit] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= msPerUnit || unit === "second") {
      return rtf.format(Math.round(diff / msPerUnit), unit);
    }
  }
  return "maintenant";
}

/** Live availability × workload, derived from the shared snapshot. */
function PresenceCell({ agentId, snapshot }: { agentId: string; snapshot?: AgentTaskSnapshot }) {
  const meta = snapshot?.agents.find((a) => a.id === agentId);
  const p = derivePresence(snapshot, {
    id: agentId,
    runtimeKind: meta?.runtimeKind ?? "claude",
    maxConcurrentTasks: meta?.maxConcurrentTasks ?? 1,
  });
  const label =
    p.workload === "working"
      ? `${p.runningCount} en cours${p.queuedCount ? ` · ${p.queuedCount} en file` : ""}`
      : p.workload === "queued"
        ? `${p.queuedCount} en file`
        : "disponible";
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-2 shrink-0 rounded-full", DOT[p.availability])} title={AVAILABILITY_LABEL[p.availability]} aria-label={AVAILABILITY_LABEL[p.availability]} />
      <span className="text-xs text-muted-foreground tabular-nums">{label}</span>
    </div>
  );
}

function AgentHealthBadge({ status }: { status: AgentRow["health"] }) {
  return (
    <Badge className={cn("rounded-full px-2 py-0.5 text-[11px]", HEALTH_CLASS[status])}>
      {HEALTH_LABEL[status]}
    </Badge>
  );
}

function DeleteAgentDialog({ team, agent }: { team: string; agent: AgentRow }) {
  const deleteAgent = useDeleteAgent(team);

  return (
    <RbacGate permission="agent:delete">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5"
            onClick={(event) => event.stopPropagation()}
            disabled={deleteAgent.isPending}
            aria-label={`Supprimer ${agent.name}`}
          >
            <Trash2 className="size-4 text-destructive" />
            <span className="ml-1">Supprimer</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer l'agent</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est definitive. Elle supprimera <strong>{agent.name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" size="sm">
                Annuler
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
              disabled={deleteAgent.isPending}
              onClick={async (event) => {
                event.stopPropagation();
                try {
                  await deleteAgent.mutateAsync(agent.id);
                  toast.success(`${agent.name} supprime`);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Suppression impossible");
                  throw error;
                }
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RbacGate>
  );
}

const AGENT_SCOPES = ["all", "working", "ready", "attention"] as const;
type AgentScope = (typeof AGENT_SCOPES)[number];

const SCOPE_LABEL: Record<AgentScope, string> = {
  all: "Tous",
  working: "En cours",
  ready: "Prets",
  attention: "Attention",
};

function agentScope(agent: AgentRow, snapshot?: AgentTaskSnapshot): AgentScope[] {
  const meta = snapshot?.agents.find((a) => a.id === agent.id);
  const presence = derivePresence(snapshot, {
    id: agent.id,
    runtimeKind: meta?.runtimeKind ?? "claude",
    maxConcurrentTasks: meta?.maxConcurrentTasks ?? 1,
  });
  const scopes: AgentScope[] = ["all"];
  if (presence.runningCount > 0 || presence.queuedCount > 0) scopes.push("working");
  if (agent.health === "healthy" || agent.health === "idle") scopes.push("ready");
  if (agent.health === "degraded" || agent.health === "error" || presence.availability !== "online") scopes.push("attention");
  return scopes;
}

const columns: ColumnDef<AgentRow>[] = [
  {
    accessorKey: "name",
    header: "Nom",
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{row.original.name}</span>
        <span className="truncate text-xs text-muted-foreground">{row.original.role}</span>
      </div>
    ),
  },
  { accessorKey: "health", header: "Etat", cell: ({ row }) => <AgentHealthBadge status={row.original.health} /> },
  { accessorKey: "model", header: "Modele", cell: ({ row }) => <span className="font-mono text-xs">{row.original.model}</span> },
  {
    id: "lastRun",
    header: "Dernier run",
    accessorFn: (r) => r.stats.lastRunAt ?? "",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.stats.lastRunAt ? formatRelativeTimeFr(row.original.stats.lastRunAt) : "—"}
      </span>
    ),
  },
  {
    id: "successRate",
    header: "Reussite",
    accessorFn: (r) => r.stats.successRate,
    cell: ({ row }) => {
      const v = row.original.stats.successRate;
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn("h-full rounded-full", v >= 0.9 ? "bg-success" : v >= 0.7 ? "bg-warning" : "bg-danger")}
              style={{ width: `${Math.round(v * 100)}%` }}
            />
          </div>
          <span className="text-xs tabular-nums" data-tabular>
            {formatPercent(v)}
          </span>
        </div>
      );
    },
  },
  {
    id: "latency",
    header: "Latence",
    accessorFn: (r) => r.stats.avgLatencyMs,
    cell: ({ row }) => (
      <span className="tabular-nums" data-tabular>
        {row.original.stats.avgLatencyMs ? formatDuration(row.original.stats.avgLatencyMs) : "—"}
      </span>
    ),
  },
  {
    id: "cost",
    header: "Cout/run",
    accessorFn: (r) => r.stats.avgCost.amountCents,
    cell: ({ row }) => (
      <span className="tabular-nums" data-tabular>
        {formatMoney(row.original.stats.avgCost)}
      </span>
    ),
  },
];

export function NewAgentButton({ team }: { team: string }) {
  return (
    <RbacGate permission="agent:create">
      <Button asChild size="sm">
        <Link href={`/${team}/platform/agents/new`}>
          <Plus className="size-4" /> Nouvel agent
        </Link>
      </Button>
    </RbacGate>
  );
}

export function AgentsTable({ team }: { team: string }) {
  const router = useRouter();
  const [scopeParam, setScopeParam] = useQueryState("scope");
  const [query, setQuery] = useQueryState("q");
  const scope = AGENT_SCOPES.includes(scopeParam as AgentScope) ? (scopeParam as AgentScope) : "all";
  const { data, isLoading, isError, error, refetch } = useAgents(team, { q: query ?? undefined });
  const { data: snapshot } = useAgentTaskSnapshot(team);
  const items = data?.items ?? [];
  const scopeCounts = useMemo(() => {
    const counts: Record<AgentScope, number> = { all: 0, working: 0, ready: 0, attention: 0 };
    for (const agent of items) {
      for (const bucket of agentScope(agent, snapshot)) counts[bucket]++;
    }
    return counts;
  }, [items, snapshot]);
  const visibleItems = useMemo(
    () => items.filter((agent) => agentScope(agent, snapshot).includes(scope)),
    [items, scope, snapshot],
  );

  // Inject the live presence column after the name column.
  const cols = useMemo<ColumnDef<AgentRow>[]>(() => {
    const presence: ColumnDef<AgentRow> = {
      id: "presence",
      header: "Presence",
      cell: ({ row }) => <PresenceCell agentId={row.original.id} snapshot={snapshot} />,
    };
    const actions: ColumnDef<AgentRow> = {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DeleteAgentDialog team={team} agent={row.original} />
      ),
    };
    return [columns[0]!, presence, ...columns.slice(1), actions];
  }, [snapshot, team]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-sm font-medium">Agents</h1>
          <span className="font-mono text-xs tabular-nums text-muted-foreground/70">{items.length}</span>
          <p className="ml-2 hidden truncate text-xs text-muted-foreground md:block">
            Agents lies a un runtime, avec outils, memoire et approbations
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TemplatesButton team={team} />
          <NewAgentButton team={team} />
        </div>
      </div>

      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {AGENT_SCOPES.map((item) => {
            const active = scope === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setScopeParam(item === "all" ? null : item)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                  active
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {SCOPE_LABEL[item]}
                <span className="font-mono tabular-nums text-muted-foreground/70">{scopeCounts[item]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative w-56 max-w-full">
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query ?? ""}
              onChange={(event) => setQuery(event.target.value.trim() ? event.target.value : null)}
              placeholder="Filtrer les agents"
              aria-label="Filtrer les agents"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
            <LayoutList className="size-3.5" />
            <span className="tabular-nums">{visibleItems.length}</span>
            affiches
          </span>
          {scopeCounts.attention > 0 ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-warning/20 bg-warning/10 px-2 text-xs font-medium text-warning">
              <ShieldAlert className="size-3.5" />
              <span className="tabular-nums">{scopeCounts.attention}</span>
            </span>
          ) : null}
        </div>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className="min-h-0 flex-1 pt-3">
          <DataTable
            columns={cols}
            data={visibleItems}
            isLoading={isLoading}
            onRowClick={(a) => router.push(`/${team}/platform/agents/${a.id}`)}
            emptyState={
              scope !== "all" || query ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Aucun agent ne correspond a cette vue.{" "}
                  <button
                    type="button"
                    className="text-primary underline"
                    onClick={() => {
                      setScopeParam(null);
                      setQuery(null);
                    }}
                  >
                    Reinitialiser
                  </button>
                </div>
              ) : (
                <EmptyState
                  icon={Bot}
                  title="Aucun agent"
                  description="Cree un premier agent pour le voir ici."
                  action={<NewAgentButton team={team} />}
                />
              )
            }
          />
        </div>
      )}
    </div>
  );
}
