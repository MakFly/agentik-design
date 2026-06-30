"use client";

import Link from "next/link";
import { Fragment, useMemo, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Brain,
  Circle,
  Clock,
  Cpu,
  Database,
  History,
  ListTodo,
  Pencil,
  ShieldCheck,
  Tag,
  Wrench,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInjectionPreview } from "@/features/memory/api";
import { useAgent, useAgentTaskSnapshot } from "./api";
import { useRuns } from "@/features/run-view/api";
import { derivePresence } from "@/lib/agents/presence";
import {
  formatCompactNumber,
  formatDuration,
  formatMoney,
  formatPercent,
  formatShortId,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Run } from "@/types/domain";
import type { AgentRow } from "./types";

const AVAILABILITY_CLASS: Record<"online" | "unstable" | "offline", string> = {
  online: "bg-success",
  unstable: "bg-warning",
  offline: "bg-muted-foreground/40",
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

function normalizeTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function detailLabel(value: string | null | undefined) {
  return value || "—";
}

function presenceToLabel(availability: "online" | "unstable" | "offline") {
  return availability === "online" ? "En ligne" : availability === "unstable" ? "Instable" : "Hors ligne";
}

function workloadLabel(running: number, queued: number) {
  if (running || queued) return `${running} en cours · ${queued} en file`;
  return "Disponible";
}

function runStartedAt(run: Run) {
  if (!run.startedAt) return "—";
  return formatRelativeTimeFr(run.startedAt);
}

function MetaField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function MetaGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-4 sm:grid-cols-2", className)}>{children}</dl>
  );
}

function MetricTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-[4.5rem] flex-col justify-between rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="text-lg font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function AgentHealthBadge({ status }: { status: AgentRow["health"] }) {
  return (
    <Badge className={cn("rounded-full px-2 py-0.5 text-xs", HEALTH_CLASS[status])}>
      {HEALTH_LABEL[status]}
    </Badge>
  );
}

function AgentMetrics({ agent }: { agent: AgentRow }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <MetricTile label="Réussite 7j" value={formatPercent(agent.stats.successRate)} />
      <MetricTile label="Latence moy." value={formatDuration(agent.stats.avgLatencyMs)} />
      <MetricTile label="Coût moyen" value={formatMoney(agent.stats.avgCost)} />
      <MetricTile label="Runs / 24h" value={formatCompactNumber(agent.stats.runs24h)} />
      <MetricTile
        label="Dernier run"
        value={agent.stats.lastRunAt ? formatRelativeTimeFr(agent.stats.lastRunAt) : "—"}
      />
    </div>
  );
}

function CapabilityPanel({ agent }: { agent: AgentRow }) {
  const capabilities = [
    ...(agent.configSkills ?? []).map((id) => ({
      id,
      kind: "Skill config",
      approval: false,
      scopes: [] as string[],
    })),
    ...(agent.tools ?? []).map((id) => {
      const grant = agent.toolGrants?.find((item) => item.toolId === id);
      return {
        id,
        kind: "Outil",
        approval: Boolean(grant?.requireApproval),
        scopes: grant?.scopes ?? [],
      };
    }),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="size-4 text-primary" />
          Capacités
        </CardTitle>
        <CardDescription>Outils et skills déclarées dans la version publiée.</CardDescription>
      </CardHeader>
      <CardContent>
        {capabilities.length ? (
          <div className="grid gap-2">
            {capabilities.map((capability) => (
              <div key={`${capability.kind}-${capability.id}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{capability.id}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {capability.kind}
                    {capability.scopes.length ? ` · ${capability.scopes.join(", ")}` : ""}
                  </p>
                </div>
                {capability.approval ? (
                  <Badge variant="outline" className="shrink-0 gap-1 rounded-full">
                    <ShieldCheck className="size-3.5" />
                    Approbation
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="shrink-0 rounded-full">Actif</Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Wrench}
            title="Aucune capacité publiée"
            description="Publie une version avec outils ou skills pour activer cette surface."
          />
        )}
      </CardContent>
    </Card>
  );
}

function MemoryInjectionPanel({ team, agent }: { team: string; agent: AgentRow }) {
  const previewQuery = useInjectionPreview(team, agent.id);
  const preview = previewQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="size-4 text-primary" />
          Mémoire Hermes
        </CardTitle>
        <CardDescription>Contexte approuvé injecté au prochain run de cet agent.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {previewQuery.isLoading ? (
          <Skeleton className="h-32" />
        ) : previewQuery.isError ? (
          <ErrorState error={previewQuery.error} onRetry={() => previewQuery.refetch()} inline />
        ) : preview ? (
          <>
            <MetaGrid>
              <MetaField label="Mémoire">
                {preview.memoryPolicy.inject ? (
                  <span>{preview.memoryPolicy.maxEntries} max · confiance ≥ {preview.memoryPolicy.minConfidence}</span>
                ) : (
                  "Désactivée"
                )}
              </MetaField>
              <MetaField label="Scopes mémoire">{preview.memoryPolicy.scopes.join(", ")}</MetaField>
              <MetaField label="Skills">
                {preview.skillPolicy.inject ? `${preview.skillPolicy.maxSkills} max` : "Désactivées"}
              </MetaField>
              <MetaField label="Scopes skills">{preview.skillPolicy.scopes.join(", ")}</MetaField>
            </MetaGrid>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Database className="size-4 text-muted-foreground" />
                  Souvenirs injectés
                  <Badge variant="outline" className="ml-auto rounded-full tabular-nums">
                    {preview.memories.length}
                  </Badge>
                </div>
                {preview.memories.length ? (
                  <ul className="space-y-2">
                    {preview.memories.slice(0, 4).map((memory, index) => (
                      <li key={`${memory.scope}-${index}`} className="text-sm leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">{memory.scope}</span> · {memory.content}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Aucun souvenir injecté. Les prochaines revues approuvées alimenteront ce contexte.
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <BookIcon />
                  Skills injectées
                  <Badge variant="outline" className="ml-auto rounded-full tabular-nums">
                    {preview.skills.length}
                  </Badge>
                </div>
                {preview.skills.length ? (
                  <ul className="space-y-2">
                    {preview.skills.slice(0, 4).map((skill) => (
                      <li key={skill.name} className="text-sm leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">{skill.name}</span>
                        {skill.triggerConditions.length ? ` · ${skill.triggerConditions.join(", ")}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Aucune skill apprise n'est encore sélectionnée pour cet agent.
                  </p>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Aucune version publiée ne permet encore de prévisualiser l'injection.</p>
        )}
      </CardContent>
    </Card>
  );
}

function BookIcon() {
  return <Brain className="size-4 text-muted-foreground" aria-hidden="true" />;
}

export function AgentDetailScreen({ team, agentId }: { team: string; agentId: string }) {
  const agentQuery = useAgent(team, agentId);
  const snapshotQuery = useAgentTaskSnapshot(team);
  const runsQuery = useRuns(team);
  const agent = agentQuery.data;
  const presence = useMemo(() => {
    if (!agent || !snapshotQuery.data) return null;
    return derivePresence(snapshotQuery.data, {
      id: agent.id,
      runtimeKind: agent.runtimeKind ?? "claude",
      maxConcurrentTasks: 1,
    });
  }, [agent, snapshotQuery.data]);

  const agentRuns = useMemo(() => {
    if (!agent || !runsQuery.data?.items) return [];
    return runsQuery.data.items
      .filter((run) => run.subject.kind === "agent" && run.subject.agentId === agent.id)
      .sort((a, b) => {
        const right = b.startedAt
          ? Date.parse(b.startedAt.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"))
          : 0;
        const left = a.startedAt
          ? Date.parse(a.startedAt.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"))
          : 0;
        if (Number.isNaN(left) || Number.isNaN(right)) return 0;
        return right - left;
      });
  }, [agent, runsQuery.data]);

  const displayTaskGroups = useMemo(() => {
    const map = new Map<string, { title: string | null; runs: Run[] }>();
    for (const run of agentRuns) {
      const key = run.taskId ?? "__no_task__";
      const group = map.get(key) ?? { title: run.taskTitle ?? null, runs: [] };
      group.runs.push(run);
      map.set(key, group);
    }
    let budget = 8;
    const out: { title: string | null; total: number; runs: Run[] }[] = [];
    for (const group of map.values()) {
      if (budget <= 0) break;
      out.push({ title: group.title, total: group.runs.length, runs: group.runs.slice(0, budget) });
      budget -= Math.min(budget, group.runs.length);
    }
    return out;
  }, [agentRuns]);

  if (agentQuery.isLoading || (!agentQuery.data && agentQuery.isFetching)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Chargement de l'agent"
          back={{ href: `/${team}/platform/agents`, label: "Agents" }}
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href={`/${team}/platform/agents`}>
                <ArrowLeft className="size-4" />
                Retour
              </Link>
            </Button>
          }
        />
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (agentQuery.isError || !agent) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Agent"
          back={{ href: `/${team}/platform/agents`, label: "Agents" }}
        />
        <ErrorState error={agentQuery.error} onRetry={() => agentQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-var(--navbar-h)-3rem)] flex-col gap-6 md:min-h-[calc(100dvh-var(--navbar-h)-4rem)]">
      <PageHeader
        title={agent.name}
        description="Mission, runtime, capacités, mémoire injectée et historique d'exécution."
        back={{ href: `/${team}/platform/agents`, label: "Agents" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <Link href={`/${team}/platform/agents/${agent.id}/edit`}>
                <Pencil className="size-4" />
                Modifier
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/${team}/memory?agent=${agent.id}`}>
                <Brain className="size-4" />
                Mémoire
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/${team}/platform/runs`}>
                <History className="size-4" />
                Runs
              </Link>
            </Button>
          </div>
        }
      />

      {presence && presence.availability !== "online" ? (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0">
            Aucun daemon vivant pour le runtime{" "}
            <span className="font-mono">{agent.runtimeKind ?? "claude"}</span>. Les runs seront rejetés tant qu'un
            daemon compatible n'est pas en ligne.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4 text-primary" />
              Mission
            </CardTitle>
            <CardDescription>Rôle, objectif et contexte métier de l'agent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <AgentHealthBadge status={agent.health} />
              <Badge variant="outline" className="rounded-full">
                {presence ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`size-1.5 rounded-full ${AVAILABILITY_CLASS[presence.availability]}`} />
                    {presenceToLabel(presence.availability)}
                  </span>
                ) : (
                  "Présence inconnue"
                )}
              </Badge>
              <Badge variant="secondary" className="rounded-full tabular-nums">
                {agent.stats.runs24h} runs / 24h
              </Badge>
            </div>

            <MetaGrid>
              <MetaField label="Rôle">{detailLabel(agent.role)}</MetaField>
              <MetaField label="Créé le">{normalizeTimestamp(agent.createdAt)}</MetaField>
              <MetaField label="Objectif" className="sm:col-span-2">
                <span className="leading-relaxed text-muted-foreground">{detailLabel(agent.goal)}</span>
              </MetaField>
              {agent.description ? (
                <MetaField label="Description" className="sm:col-span-2">
                  <span className="leading-relaxed text-muted-foreground">{agent.description}</span>
                </MetaField>
              ) : null}
            </MetaGrid>

            <div className="flex flex-wrap items-center gap-2">
              {agent.tags.length ? (
                agent.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="rounded-full">
                    <Tag className="size-3.5" />
                    {tag}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">Aucun tag</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="size-4 text-primary" />
              Exécution
            </CardTitle>
            <CardDescription>Runtime, modèle, charge et signaux opérationnels.</CardDescription>
          </CardHeader>
          <CardContent>
            <MetaGrid>
              <MetaField label="Modèle">{detailLabel(agent.model)}</MetaField>
              <MetaField label="Runtime">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono">{agent.runtimeKind ?? "claude"}</span>
                  {presence ? (
                    <span
                      className={`size-1.5 rounded-full ${AVAILABILITY_CLASS[presence.availability]}`}
                      title={presenceToLabel(presence.availability)}
                      aria-label={presenceToLabel(presence.availability)}
                    />
                  ) : null}
                </span>
              </MetaField>
              <MetaField label="Mis à jour">{normalizeTimestamp(agent.updatedAt)}</MetaField>
              <MetaField label="Charge">
                {presence ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Circle className="size-3.5 text-muted-foreground" />
                    <span className="tabular-nums">
                      {workloadLabel(presence.runningCount, presence.queuedCount)}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Snapshot en attente...</span>
                )}
              </MetaField>
            </MetaGrid>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        <CapabilityPanel agent={agent} />
        <MemoryInjectionPanel team={team} agent={agent} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            Signaux opérationnels
          </CardTitle>
          <CardDescription>Performance récente sans exposer les identifiants techniques.</CardDescription>
        </CardHeader>
        <CardContent>
          <AgentMetrics agent={agent} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            Runs récents
          </CardTitle>
          <CardDescription>Exécutions regroupées par tâche déclenchante.</CardDescription>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <Skeleton className="h-40" />
          ) : runsQuery.isError ? (
            <ErrorState error={runsQuery.error} onRetry={() => runsQuery.refetch()} inline />
          ) : !agentRuns.length ? (
            <EmptyState
              icon={Clock}
              title="Aucun run"
              description="Les exécutions de cet agent apparaîtront ici."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>État</TableHead>
                    <TableHead>Déclencheur</TableHead>
                    <TableHead>Démarrage</TableHead>
                    <TableHead className="text-right">Coût</TableHead>
                    <TableHead>Env</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayTaskGroups.map((group, gi) => (
                    <Fragment key={group.title ?? `task-${gi}`}>
                      <TableRow className="bg-surface-2/50 hover:bg-surface-2/50">
                        <TableCell colSpan={6} className="py-1.5">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <ListTodo className="size-3.5" aria-hidden="true" />
                            <span className="truncate">{group.title ?? "Hors tâche"}</span>
                            <span className="tabular-nums text-muted-foreground/60">
                              · {group.total} {group.total > 1 ? "runs" : "run"}
                            </span>
                          </span>
                        </TableCell>
                      </TableRow>
                      {group.runs.map((run, i) => (
                        <TableRow key={run.id}>
                          <TableCell>
                            <Link
                              href={`/${team}/platform/runs/${run.id}`}
                              className="inline-flex items-center gap-1.5 font-mono text-xs hover:underline"
                              title={run.id}
                            >
                              {group.total > 1 ? (
                                <span className="rounded bg-surface-2 px-1 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                                  #{group.total - i}
                                </span>
                              ) : null}
                              {formatShortId(run.id)}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={run.status} size="sm" />
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{run.trigger.kind}</Badge>
                          </TableCell>
                          <TableCell
                            className="text-muted-foreground"
                            title={normalizeTimestamp(run.startedAt)}
                          >
                            {runStartedAt(run)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(run.cost.money)}
                          </TableCell>
                          <TableCell className="text-muted-foreground uppercase">{run.env}</TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
              {agentRuns.length > 8 ? (
                <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  8 runs affichés sur {formatCompactNumber(agentRuns.length)}.{" "}
                  <Link href={`/${team}/platform/runs`} className="text-primary hover:underline">
                    Tout voir
                  </Link>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
