"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";

export type RiskLevel = "low" | "medium" | "high";
export type ProposedMemory = { changeId: string; content: string; reason: string; confidence: number; scope: string };
export type ProposedSkill = { changeId: string; action: "create" | "patch"; skillName: string; reason: string };
export type Review = {
  id: string;
  runId: string;
  status: string;
  summary: string;
  riskLevel: RiskLevel;
  proposedMemories: ProposedMemory[];
  proposedSkillChanges: ProposedSkill[];
  createdAt: string;
};

export function useReviews(team: string, status = "pending") {
  return useQuery({
    queryKey: qk.reviews.list(team, status),
    queryFn: ({ signal }) =>
      apiFetch<{ items: Review[] }>(`/run-reviews?status=${status}`, { team, signal }),
  });
}

export function useResolveReview(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; action: "approve" | "reject"; changeIds?: string[] }) =>
      apiFetch(`/run-reviews/${v.id}/${v.action}`, {
        method: "POST",
        team,
        body: v.action === "approve" ? { changeIds: v.changeIds } : undefined,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.reviews.all(team) }),
  });
}
