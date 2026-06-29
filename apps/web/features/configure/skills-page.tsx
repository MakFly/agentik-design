"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Brain, CheckCircle2, ShieldCheck, Wrench } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import { useAgents } from "@/features/agent-registry/api";

type SkillScope = "team" | "project" | "agent" | "workflow";

interface SkillHead {
  id: string;
  teamId: string;
  name: string;
  description: string;
  scope: SkillScope;
  targetId: string | null;
  currentVersionId: string | null;
  createdBy: "user" | "system" | "review_agent";
  createdAt: string;
  updatedAt: string;
}

interface SystemCapability {
  id: string;
  name: string;
  source: "outil" | "skill config";
  approvalRequired: boolean;
  agents: string[];
}

function useSkills(team: string) {
  return useQuery({
    queryKey: qk.skills.list(team),
    queryFn: ({ signal }) =>
      apiFetch<{ items: SkillHead[]; total: number }>("/skills", { team, signal }),
  });
}

function formatScope(scope: SkillScope) {
  if (scope === "team") return "Equipe";
  if (scope === "project") return "Projet";
  if (scope === "agent") return "Agent";
  return "Workflow";
}

function sourceLabel(createdBy: SkillHead["createdBy"]) {
  if (createdBy === "review_agent") return "Revue approuvee";
  if (createdBy === "system") return "Systeme";
  return "Manuelle";
}

function buildSystemCapabilities(agents: ReturnType<typeof useAgents>["data"]): SystemCapability[] {
  const map = new Map<string, SystemCapability>();
  for (const agent of agents?.items ?? []) {
    for (const toolId of agent.tools ?? []) {
      const grant = agent.toolGrants?.find((item) => item.toolId === toolId);
      const item =
        map.get(toolId) ??
        {
          id: toolId,
          name: toolId,
          source: "outil" as const,
          approvalRequired: false,
          agents: [],
        };
      item.approvalRequired ||= Boolean(grant?.requireApproval);
      item.agents.push(agent.name);
      map.set(toolId, item);
    }
    for (const skillId of agent.configSkills ?? []) {
      const item =
        map.get(skillId) ??
        {
          id: skillId,
          name: skillId,
          source: "skill config" as const,
          approvalRequired: false,
          agents: [],
        };
      item.agents.push(agent.name);
      map.set(skillId, item);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function SkillsPage({ team }: { team: string }) {
  const agentsQuery = useAgents(team);
  const skillsQuery = useSkills(team);
  const systemCapabilities = useMemo(
    () => buildSystemCapabilities(agentsQuery.data),
    [agentsQuery.data],
  );
  const learnedSkills = skillsQuery.data?.items ?? [];
  const isLoading = agentsQuery.isLoading || skillsQuery.isLoading;

  return (
    <div className="@container flex flex-col gap-5">
      <PageHeader
        title="Competences"
        description="Capacites runtime, outils autorises et procedures apprises que les agents peuvent charger en contexte."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href={`/${team}/memory`}>
              <Brain className="size-4" />
              Memoire
            </Link>
          </Button>
        }
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Capacites systeme</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Elles viennent de la configuration publiee des agents : outils, grants et skills declarees.
            </p>
          </div>
          <Badge variant="outline" className="rounded-full tabular-nums">
            {systemCapabilities.length}
          </Badge>
        </div>

        {agentsQuery.isError ? (
          <ErrorState error={agentsQuery.error} onRetry={() => agentsQuery.refetch()} inline />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[36%]">Capacite</TableHead>
                  <TableHead className="hidden @2xl:table-cell">Agents</TableHead>
                  <TableHead className="hidden @2xl:table-cell">Source</TableHead>
                  <TableHead className="text-right">Garde-fou</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-sm text-muted-foreground">
                      Chargement des capacites...
                    </TableCell>
                  </TableRow>
                ) : systemCapabilities.length ? (
                  systemCapabilities.map((capability) => (
                    <TableRow key={capability.id}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2">
                          <Wrench className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-mono text-xs">{capability.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-md truncate text-muted-foreground @2xl:table-cell">
                        {capability.agents.join(", ")}
                      </TableCell>
                      <TableCell className="hidden @2xl:table-cell">
                        <Badge variant="secondary">{capability.source}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {capability.approvalRequired ? (
                          <Badge variant="outline" className="gap-1 rounded-full">
                            <ShieldCheck className="size-3.5" />
                            Approbation
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Runtime</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="h-36">
                      <EmptyState
                        icon={Wrench}
                        title="Aucune capacite publiee"
                        description="Publie un agent avec des outils ou des skills declarees pour les voir ici."
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Skills approuvees</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Elles sont apprises depuis les revues de run et injectees par la politique memoire/skills.
            </p>
          </div>
          <Badge variant="outline" className="rounded-full tabular-nums">
            {learnedSkills.length}
          </Badge>
        </div>

        {skillsQuery.isError ? (
          <ErrorState error={skillsQuery.error} onRetry={() => skillsQuery.refetch()} inline />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[40%]">Nom</TableHead>
                  <TableHead className="hidden @2xl:table-cell">Portee</TableHead>
                  <TableHead className="hidden @2xl:table-cell">Source</TableHead>
                  <TableHead className="text-right">Etat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-sm text-muted-foreground">
                      Chargement des skills...
                    </TableCell>
                  </TableRow>
                ) : learnedSkills.length ? (
                  learnedSkills.map((skill) => (
                    <TableRow key={skill.id}>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{skill.name}</span>
                          {skill.description ? (
                            <span className="truncate text-xs text-muted-foreground">{skill.description}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden @2xl:table-cell">{formatScope(skill.scope)}</TableCell>
                      <TableCell className="hidden @2xl:table-cell">
                        <Badge variant="secondary">{sourceLabel(skill.createdBy)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {skill.currentVersionId ? (
                          <Badge variant="outline" className="gap-1 rounded-full">
                            <CheckCircle2 className="size-3.5" />
                            Injectable
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Brouillon</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="h-44">
                      <EmptyState
                        icon={BookOpen}
                        title="Aucune skill apprise"
                        description="C'est normal tant qu'aucune revue de run n'a ete approuvee. Les capacites systeme restent visibles au-dessus."
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
