import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateCredentialInput, CredentialSummary } from "@agentik/workflow-schema";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";

export function useCredentials(team: string) {
  return useQuery({
    queryKey: qk.credentials.list(team),
    queryFn: ({ signal }) =>
      apiFetch<{ items: CredentialSummary[] }>("/credentials", { team, signal }),
  });
}

export function useCreateCredential(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCredentialInput) =>
      apiFetch<CredentialSummary>("/credentials", { method: "POST", team, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.credentials.all(team) }),
  });
}

export function useDeleteCredential(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/credentials/${id}`, { method: "DELETE", team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.credentials.all(team) }),
  });
}
