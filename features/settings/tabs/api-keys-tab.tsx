"use client";

import { useState } from "react";
import { KeyRound, Plus, Copy, Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { RbacGate } from "@/lib/auth/rbac";
import { formatRelativeTime } from "@/lib/format";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "../api";
import type { ApiKeyScope } from "../types";
import { ConfirmDialog } from "./confirm-dialog";

const ALL_SCOPES: ApiKeyScope[] = ["read", "write", "admin"];

export function ApiKeysTab({ team }: { team: string }) {
  const { data, isLoading, isError, error, refetch } = useApiKeys(team);
  const revoke = useRevokeApiKey(team);
  const keys = data?.items ?? [];

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Programmatic access keys, scoped by capability. The secret is shown once at creation and never again — rotate by creating a new key and revoking the old one.
        </p>
        <RbacGate permission="settings:update">
          <CreateKeyDialog team={team} />
        </RbacGate>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : keys.length === 0 ? (
        <EmptyState icon={KeyRound} title="No API keys" description="Create a key to call the Agentik API from CI or your own services." />
      ) : (
        <ul className="flex flex-col gap-2">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{k.name}</span>
                  {k.scopes.map((s) => (
                    <Badge key={s} variant="secondary" className="text-[11px] capitalize">
                      {s}
                    </Badge>
                  ))}
                </div>
                <code className="font-mono text-xs text-muted-foreground">{k.prefix}</code>
                <span className="text-xs text-muted-foreground">
                  {k.lastUsedAt ? `Last used ${formatRelativeTime(k.lastUsedAt)}` : "Never used"} · by {k.createdBy}
                </span>
              </div>
              <RbacGate permission="settings:update">
                <ConfirmDialog
                  title="Revoke API key"
                  description={`"${k.name}" will stop working immediately. This cannot be undone.`}
                  confirmLabel="Revoke"
                  onConfirm={async () => {
                    await revoke.mutateAsync(k.id);
                    toast.success(`Revoked ${k.name}`);
                  }}
                  trigger={
                    <Button variant="ghost" size="sm" className="self-start text-danger hover:text-danger sm:self-auto">
                      <Trash2 className="size-4" /> Revoke
                    </Button>
                  }
                />
              </RbacGate>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateKeyDialog({ team }: { team: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["read"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useCreateApiKey(team);

  function reset() {
    setName("");
    setScopes(["read"]);
    setSecret(null);
    setCopied(false);
  }

  function toggleScope(s: ApiKeyScope) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function submit() {
    try {
      const created = await create.mutateAsync({ name: name.trim(), scopes });
      setSecret(created.secret);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create key");
    }
  }

  async function copy() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    toast.success("Secret copied to clipboard");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New key
      </Button>
      <DialogContent>
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your secret now</DialogTitle>
              <DialogDescription>This is the only time the full key is shown. Store it somewhere safe.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-3">
              <code className="min-w-0 flex-1 truncate font-mono text-sm">{secret}</code>
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>Name the key and pick its scopes. Least privilege is recommended.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CI pipeline" autoFocus />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Scopes</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_SCOPES.map((s) => {
                  const on = scopes.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleScope(s)}
                      aria-pressed={on}
                      className={`min-h-[36px] rounded-full border px-3 text-sm font-medium capitalize transition-colors ${
                        on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-surface-2"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!name.trim() || scopes.length === 0 || create.isPending}>
                {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                Create
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
