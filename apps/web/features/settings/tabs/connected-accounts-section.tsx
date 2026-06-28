"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Check, Loader2, PlugZap, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { onMutationError } from "@/lib/api/toast-error";
import { toast } from "sonner";

interface CodexStatus {
  connected: boolean;
  accountId: string | null;
  expiresAtMs: number | null;
}

/** Human-facing date as dd-mm-yyyy (machine values stay epoch ms on the wire). */
function formatExpiry(ms: number | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function useOauthStatus(team: string) {
  return useQuery({
    queryKey: ["team", team, "oauth"],
    queryFn: ({ signal }) =>
      apiFetch<{ codex: CodexStatus }>("/settings/oauth", { team, signal }),
  });
}

/**
 * Subscription accounts (e.g. Codex via a ChatGPT plan). The OAuth itself runs on
 * a machine with a browser via `agentik login codex` (the CLI client only allows a
 * loopback redirect, so the engine can't host the callback). This panel shows the
 * connection status and lets an admin disconnect.
 */
export function ConnectedAccountsSection({ team }: { team: string }) {
  const { data, isLoading } = useOauthStatus(team);
  const qc = useQueryClient();
  const codex = data?.codex;

  const disconnect = useMutation({
    mutationFn: () =>
      apiFetch("/settings/oauth/codex", { method: "DELETE", team }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team", team, "oauth"] });
      toast.success("Codex disconnected");
    },
    onError: onMutationError("Could not disconnect"),
  });

  const expiry = formatExpiry(codex?.expiresAtMs ?? null);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground">Connected accounts</h2>
      <p className="text-xs text-muted-foreground">
        Use a ChatGPT subscription for Codex runs instead of a metered API key.
        Connect from a machine with a browser by running{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">
          agentik login codex
        </code>
        . Tokens are stored encrypted and never displayed.{" "}
        <Link
          href="/docs/codex-vps"
          className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
        >
          Setup guide →
        </Link>
      </p>

      {isLoading && !data ? (
        <div className="h-20 animate-pulse rounded-xl bg-surface-2" />
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <PlugZap className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Codex · ChatGPT</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {codex?.connected
                  ? `Connected${codex.accountId ? ` · ${codex.accountId}` : ""}${
                      expiry ? ` · renews ${expiry}` : ""
                    }`
                  : "Not connected"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {codex?.connected ? (
              <>
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                  <Check className="size-3" /> connected
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Disconnect Codex"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate()}
                >
                  {disconnect.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Run the CLI to connect
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
