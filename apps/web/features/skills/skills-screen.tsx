"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainIcon, CheckIcon, SparklesIcon, WrenchIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import { Button } from "@/components/ui/button";
import { RbacGate } from "@/lib/auth/rbac";

interface SkillSummary {
  id: string;
  name: string;
  description: string;
  scope: "team" | "project" | "agent" | "workflow";
  targetId: string | null;
  createdBy: string;
  updatedAt: string;
}

interface ProposedSkillChange {
  changeId: string;
  action: "create" | "patch";
  skillName: string;
  description?: string;
  reason?: string;
}
interface ProposedMemoryChange {
  changeId: string;
  content: string;
  reason: string;
}
interface PendingReview {
  id: string;
  runId: string;
  summary: string;
  riskLevel: "low" | "medium" | "high";
  proposedSkillChanges: ProposedSkillChange[];
  proposedMemories: ProposedMemoryChange[];
}

/**
 * Skills (OpenClaw "Skills" / Hermes procedural memory): the procedural knowledge the
 * assistant applies and **improves itself**. Active skills (read-only list, `GET /skills`)
 * are injected into runs via `buildInjectionPreamble`. Above them, the self-improvement loop
 * surfaces **pending proposals** from the Review Agent (`GET /run-reviews?status=pending`):
 * each finished run can propose new/improved skills + memories, applied only on approval
 * (`POST /run-reviews/:id/approve` → `applyRunReview`) — the closed learning loop.
 */
export function SkillsScreen({ team }: { team: string }) {
  const qc = useQueryClient();

  const { data: skillsData, isLoading, isError } = useQuery({
    queryKey: qk.skills.list(team),
    queryFn: ({ signal }) =>
      apiFetch<{ items: SkillSummary[]; total: number }>("/skills", { team, signal }),
  });

  const { data: reviewsData } = useQuery({
    queryKey: qk.reviews.list(team, "pending"),
    queryFn: ({ signal }) =>
      apiFetch<{ items: PendingReview[]; total: number }>("/run-reviews?status=pending", {
        team,
        signal,
      }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.reviews.all(team) });
    qc.invalidateQueries({ queryKey: qk.skills.all(team) });
  };

  const approve = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ status: string; applied: number }>(`/run-reviews/${id}/approve`, {
        method: "POST",
        team,
        body: {},
      }),
    onSuccess: (res) => {
      toast.success(`Proposition appliquée (${res.applied} changement·s).`);
      invalidate();
    },
    onError: () => toast.error("Impossible d’appliquer la proposition."),
  });

  const reject = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ status: string }>(`/run-reviews/${id}/reject`, { method: "POST", team }),
    onSuccess: () => {
      toast.success("Proposition rejetée.");
      invalidate();
    },
    onError: () => toast.error("Impossible de rejeter la proposition."),
  });

  const items = skillsData?.items ?? [];
  const reviews = (reviewsData?.items ?? []).filter(
    (r) => r.proposedSkillChanges.length > 0 || r.proposedMemories.length > 0,
  );
  const busy = approve.isPending || reject.isPending;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <SparklesIcon className="size-5 text-muted-foreground" aria-hidden />
          Skills
        </h1>
        <p className="text-muted-foreground text-sm">
          Procédures réutilisables que l’assistant applique et améliore — injectées dans le
          prompt des runs (modèle OpenClaw/Hermes).
        </p>
      </header>

      {reviews.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-tight">
            Propositions en attente{" "}
            <span className="text-muted-foreground font-normal">
              · l’assistant suggère d’apprendre ces éléments
            </span>
          </h2>
          {reviews.map((r) => (
            <div
              key={r.id}
              className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm">{r.summary}</p>
                <span className="text-muted-foreground bg-muted shrink-0 rounded-full px-2 py-0.5 text-xs">
                  risque {r.riskLevel}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {r.proposedSkillChanges.map((c) => (
                  <li key={c.changeId} className="flex items-start gap-2 text-sm">
                    <WrenchIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>
                      <span className="font-medium">
                        {c.action === "create" ? "Nouveau skill" : "Améliorer"} : {c.skillName}
                      </span>
                      {c.reason && <span className="text-muted-foreground"> — {c.reason}</span>}
                    </span>
                  </li>
                ))}
                {r.proposedMemories.map((m) => (
                  <li key={m.changeId} className="flex items-start gap-2 text-sm">
                    <BrainIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span className="text-muted-foreground">{m.content}</span>
                  </li>
                ))}
              </ul>
              <RbacGate permission="review:approve">
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={busy} onClick={() => approve.mutate(r.id)}>
                    <CheckIcon className="size-4" aria-hidden /> Appliquer
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => reject.mutate(r.id)}
                  >
                    <XIcon className="size-4" aria-hidden /> Rejeter
                  </Button>
                </div>
              </RbacGate>
            </div>
          ))}
        </section>
      )}

      {isLoading && <p className="text-muted-foreground text-sm">Chargement…</p>}
      {isError && (
        <p className="text-destructive text-sm">Impossible de charger les skills.</p>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <div className="border-border/60 text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          Aucun skill pour l’instant. Les skills sont créés lors des runs (auto-curation) ou
          ajoutés depuis la plateforme.
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((s) => (
          <li
            key={s.id}
            className="border-border/60 bg-card flex flex-col gap-1 rounded-lg border p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground bg-muted rounded-full px-2 py-0.5 text-xs">
                {s.scope}
              </span>
            </div>
            {s.description && (
              <p className="text-muted-foreground text-sm">{s.description}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
