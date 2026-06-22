"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { type Review, type RiskLevel, useResolveReview, useReviews } from "./api";

const RISK_TONE: Record<RiskLevel, string> = {
  low: "bg-surface-2 text-muted-foreground",
  medium: "bg-warning-surface text-warning",
  high: "bg-danger-surface text-danger",
};

export function ReviewInbox({ team }: { team: string }) {
  const { data, isLoading, isError } = useReviews(team);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading reviews…</p>;
  if (isError) return <p className="text-sm text-muted-foreground">Could not load reviews. Is the engine running?</p>;

  const reviews = data?.items ?? [];
  if (reviews.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center">
        <p className="font-medium">No pending reviews</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When a run finishes, its proposed memory &amp; skill changes show up here for approval.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {reviews.map((r) => (
        <ReviewCard key={r.id} team={team} review={r} />
      ))}
    </ul>
  );
}

function ReviewCard({ team, review }: { team: string; review: Review }) {
  const allIds = [...review.proposedMemories.map((m) => m.changeId), ...review.proposedSkillChanges.map((s) => s.changeId)];
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allIds));
  const resolve = useResolveReview(team);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <li className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-pretty font-medium">{review.summary}</p>
          <p className="mt-1 font-mono text-xs text-subtle-foreground">run {review.runId}</p>
        </div>
        <Badge className={RISK_TONE[review.riskLevel]}>{review.riskLevel} risk</Badge>
      </div>

      {allIds.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {review.proposedMemories.map((m) => (
            <label key={m.changeId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-surface-2/50 p-3">
              <Checkbox checked={selected.has(m.changeId)} onCheckedChange={() => toggle(m.changeId)} className="mt-0.5" />
              <span className="min-w-0 text-sm">
                <Badge className="mr-2 bg-accent text-accent-foreground">memory · {m.scope}</Badge>
                {m.content}
                <span className="mt-0.5 block text-xs text-subtle-foreground">
                  {m.reason} · confidence {m.confidence}
                </span>
              </span>
            </label>
          ))}
          {review.proposedSkillChanges.map((s) => (
            <label key={s.changeId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-surface-2/50 p-3">
              <Checkbox checked={selected.has(s.changeId)} onCheckedChange={() => toggle(s.changeId)} className="mt-0.5" />
              <span className="min-w-0 text-sm">
                <Badge className="mr-2 bg-accent text-accent-foreground">skill · {s.action}</Badge>
                {s.skillName}
                <span className="mt-0.5 block text-xs text-subtle-foreground">{s.reason}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          className="min-h-11"
          disabled={resolve.isPending || selected.size === 0}
          onClick={() => resolve.mutate({ id: review.id, action: "approve", changeIds: [...selected] })}
        >
          Approve {selected.size > 0 ? `(${selected.size})` : ""}
        </Button>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={resolve.isPending}
          onClick={() => resolve.mutate({ id: review.id, action: "reject" })}
        >
          Reject
        </Button>
      </div>
    </li>
  );
}
