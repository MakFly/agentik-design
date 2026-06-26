"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Check, Loader2, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { toastApiError, onMutationError } from "@/lib/api/toast-error";
import { toast } from "sonner";

interface ProviderKey {
  provider: string;
  envVar: string;
  hasKey: boolean;
  updatedAt: string | null;
}

const LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

function useProviderKeys(team: string) {
  return useQuery({
    queryKey: ["team", team, "provider-keys"],
    queryFn: ({ signal }) =>
      apiFetch<{ items: ProviderKey[] }>("/settings/provider-keys", {
        team,
        signal,
      }),
  });
}

/**
 * Manage the org's runtime provider keys from the UI. Keys are stored encrypted on
 * the engine and made available to matching runtimes at run time. Values are
 * write-only: the server returns presence (hasKey) only, never the secret.
 */
export function ProviderKeysSection({ team }: { team: string }) {
  const { data, isLoading } = useProviderKeys(team);
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["team", team, "provider-keys"] });

  const save = useMutation({
    mutationFn: ({ provider, key }: { provider: string; key: string }) =>
      apiFetch(`/settings/provider-keys/${provider}`, {
        method: "PUT",
        team,
        body: { key },
      }),
    onSuccess: (_d, v) => {
      setDrafts((s) => ({ ...s, [v.provider]: "" }));
      invalidate();
      toast.success(`${LABELS[v.provider] ?? v.provider} key saved`);
    },
    onError: (e) => toastApiError(e, "Could not save key"),
  });

  const remove = useMutation({
    mutationFn: (provider: string) =>
      apiFetch(`/settings/provider-keys/${provider}`, {
        method: "DELETE",
        team,
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Key removed");
    },
    onError: onMutationError("Could not remove key"),
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground">Provider keys</h2>
      <p className="text-xs text-muted-foreground">
        Stored encrypted and used automatically by matching runtimes such as
        Hermes or Claude. Values are write-only and never displayed again.
      </p>

      <div className="flex flex-col gap-2">
        {isLoading && !data ? (
          <div className="h-32 animate-pulse rounded-xl bg-surface-2" />
        ) : (
          (data?.items ?? []).map((p) => (
            <div
              key={p.provider}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 items-center gap-2 sm:w-48">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {LABELS[p.provider] ?? p.provider}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {p.envVar}
                  </p>
                </div>
              </div>

              <PasswordInput
                autoComplete="off"
                wrapperClassName="flex-1"
                placeholder={
                  p.hasKey
                    ? "•••••••••• (configured, type to replace)"
                    : "Paste API key…"
                }
                value={drafts[p.provider] ?? ""}
                onChange={(e) =>
                  setDrafts((s) => ({ ...s, [p.provider]: e.target.value }))
                }
              />

              <div className="flex items-center gap-2">
                {p.hasKey && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                    <Check className="size-3" /> set
                  </span>
                )}
                <Button
                  size="sm"
                  disabled={
                    !((drafts[p.provider] ?? "").trim().length >= 8) ||
                    save.isPending
                  }
                  onClick={() =>
                    save.mutate({
                      provider: p.provider,
                      key: (drafts[p.provider] ?? "").trim(),
                    })
                  }
                >
                  {save.isPending && save.variables?.provider === p.provider ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
                {p.hasKey && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${p.provider} key`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(p.provider)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
