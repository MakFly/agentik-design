"use client";

import { useEffect, useState } from "react";
import { Plus, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CREDENTIAL_FIELDS,
  CREDENTIAL_LABELS,
  isOAuthCredential,
  type CredentialType,
} from "@agentik/workflow-schema";
import { useCredentials, useCreateCredential } from "./api";
import { qk } from "@/lib/api/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  team: string;
  type: CredentialType;
  value?: string;
  onChange: (id: string) => void;
}

const secretField = (key: string) => /secret|token|value|password/i.test(key);

/** Open the engine OAuth consent flow in a popup. */
function openOAuthPopup(credentialId: string) {
  window.open(
    `/api/v1/credentials/${credentialId}/authorize`,
    "agentik-oauth",
    "width=520,height=680,menubar=no,toolbar=no",
  );
}

/** Select an existing credential of `type`, create one inline, and (OAuth) connect. */
export function CredentialPicker({ team, type, value, onChange }: Props) {
  const { data } = useCredentials(team);
  const create = useCreateCredential(team);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  const items = (data?.items ?? []).filter((c) => c.type === type);
  const selected = items.find((c) => c.id === value);
  const isOAuth = isOAuthCredential(type);

  // Refresh the list when an OAuth popup reports completion.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "oauth") qc.invalidateQueries({ queryKey: qk.credentials.all(team) });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc, team]);

  const submit = async () => {
    const cred = await create.mutateAsync({ type, name: name || type, data: fields });
    onChange(cred.id);
    setOpen(false);
    setName("");
    setFields({});
    if (isOAuth) openOAuthPopup(cred.id); // kick off Google consent right away
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger className="h-8 flex-1 text-sm">
          <SelectValue placeholder="Select credential" />
        </SelectTrigger>
        <SelectContent>
          {items.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No {CREDENTIAL_LABELS[type] ?? type} credential yet</div>
          ) : (
            items.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-1.5">
                  {c.name}
                  {isOAuth && c.connected && <Check className="size-3 text-[var(--n8n-success)]" />}
                </span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      {/* OAuth: let the user (re)connect an already-selected credential. */}
      {isOAuth && selected && !selected.connected && (
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 text-xs" onClick={() => openOAuthPopup(selected.id)}>
          Connect
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0 px-2"
        onClick={() => setOpen(true)}
        aria-label="New credential"
      >
        <Plus className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New {CREDENTIAL_LABELS[type] ?? type} credential</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cred-name">Name</Label>
              <Input
                id="cred-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`My ${CREDENTIAL_LABELS[type] ?? type}`}
                className="h-9"
              />
            </div>
            {CREDENTIAL_FIELDS[type].map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`cred-${f.key}`}>{f.label}</Label>
                <Input
                  id={`cred-${f.key}`}
                  type={secretField(f.key) ? "password" : "text"}
                  value={fields[f.key] ?? ""}
                  onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="h-9 font-mono text-xs"
                  autoComplete="off"
                />
              </div>
            ))}
            {isOAuth && (
              <p className="text-[11px] text-muted-foreground">
                After saving, a Google window opens to authorize access.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={create.isPending}>
              {create.isPending ? "Saving…" : isOAuth ? "Save & connect" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
