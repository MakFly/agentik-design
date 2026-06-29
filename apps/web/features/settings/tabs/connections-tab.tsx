"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Mail, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useCredentials,
  useCreateCredential,
  useDeleteCredential,
} from "@/features/credentials/api";
import { qk } from "@/lib/api/queryKeys";
import { onMutationError } from "@/lib/api/toast-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DEFAULT_SCOPES =
  "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly";

/** Open the engine OAuth consent flow in a popup (same-origin → proxied to engine). */
function openOAuthPopup(credentialId: string) {
  window.open(
    `/api/v1/credentials/${credentialId}/authorize`,
    "agentik-oauth",
    "width=520,height=680,menubar=no,toolbar=no",
  );
}

/**
 * Self-service Google / Gmail connection. The user supplies their own Google OAuth
 * app (client id + secret) and scopes — no engine env vars — then connects the account
 * via the in-app consent popup. Once connected, that workspace's agent email sends
 * through the real Gmail API.
 */
export function ConnectionsTab({ team }: { team: string }) {
  const { data, isLoading } = useCredentials(team);
  const create = useCreateCredential(team);
  const remove = useDeleteCredential(team);
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Gmail");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scope, setScope] = useState(DEFAULT_SCOPES);

  const accounts = (data?.items ?? []).filter((c) => c.type === "googleOAuth2");

  // Refresh when the OAuth popup reports completion.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "oauth") {
        qc.invalidateQueries({ queryKey: qk.credentials.all(team) });
        if (e.data.ok) toast.success("Google account connected");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc, team]);

  async function submit() {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast.error("Client ID and secret are required");
      return;
    }
    try {
      const cred = await create.mutateAsync({
        type: "googleOAuth2",
        name: name.trim() || "Gmail",
        data: { clientId: clientId.trim(), clientSecret: clientSecret.trim(), scope: scope.trim() },
      });
      setOpen(false);
      setClientId("");
      setClientSecret("");
      openOAuthPopup(cred.id); // kick off Google consent immediately
    } catch (err) {
      onMutationError("Could not create the connection")(err);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground">Google / Gmail</h2>
      <p className="max-w-prose text-xs text-muted-foreground">
        Connect a Google account so your agents can send and read email through Gmail.
        Create an OAuth client in Google Cloud (redirect URI{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">
          {`${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/oauth/google/callback`}
        </code>
        ), paste its client ID/secret below, then authorize. Tokens are stored encrypted
        and never displayed.
      </p>

      {isLoading && !data ? (
        <div className="h-20 animate-pulse rounded-xl bg-surface-2" />
      ) : (
        <div className="flex flex-col gap-2">
          {accounts.map((acct) => (
            <div
              key={acct.id}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{acct.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {acct.connected ? "Connected · Gmail" : "Not connected — authorize to finish"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {acct.connected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                    <Check className="size-3" /> connected
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    onClick={() => openOAuthPopup(acct.id)}
                  >
                    Connect
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Disconnect ${acct.name}`}
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(acct.id, {
                      onSuccess: () => toast.success("Disconnected"),
                      onError: onMutationError("Could not disconnect"),
                    })
                  }
                >
                  {remove.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            className="min-h-11 self-start"
            onClick={() => setOpen(true)}
          >
            <Plus className="size-4" /> Connect a Google account
          </Button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Google</DialogTitle>
            <DialogDescription>
              Paste your Google OAuth client credentials. A consent window opens after saving.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="g-name">Name</Label>
              <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="g-client-id">Google client ID</Label>
              <Input
                id="g-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="h-9 font-mono text-xs"
                autoComplete="off"
                placeholder="…apps.googleusercontent.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="g-client-secret">Google client secret</Label>
              <Input
                id="g-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="h-9 font-mono text-xs"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="g-scope">Scopes</Label>
              <Input
                id="g-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="h-9 font-mono text-[11px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Save & connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
