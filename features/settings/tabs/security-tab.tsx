"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useRbac } from "@/lib/auth/rbac";
import { useSecurity, useUpdateSecurity } from "../api";
import type { SecurityPolicy } from "../types";

export function SecurityTab({ team }: { team: string }) {
  const { data, isLoading, isError, error, refetch } = useSecurity(team);
  const update = useUpdateSecurity(team);
  const { can } = useRbac();
  const editable = can("settings:update");

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  async function patch(p: Partial<SecurityPolicy>) {
    try {
      await update.mutateAsync(p);
      toast.success("Security policy updated");
    } catch {
      toast.error("Could not update policy");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Policy</CardTitle>
          <CardDescription>Guardrails applied across every run in this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-5 pt-0">
          <label className="flex items-center justify-between gap-4">
            <span className="flex flex-col">
              <span className="text-sm font-medium text-foreground">Require approval for prod runs</span>
              <span className="text-xs text-muted-foreground">Operators must approve before any production run starts.</span>
            </span>
            <Switch
              checked={data.requireApprovalForProd}
              onCheckedChange={(v) => patch({ requireApprovalForProd: v })}
              disabled={!editable || update.isPending}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="PII policy">
              <Select value={data.piiPolicy} onValueChange={(v) => patch({ piiPolicy: v as SecurityPolicy["piiPolicy"] })} disabled={!editable}>
                <SelectTrigger className="capitalize"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["block", "redact", "allow"] as const).map((v) => (
                    <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Data residency">
              <Select value={data.dataResidency} onValueChange={(v) => patch({ dataResidency: v as SecurityPolicy["dataResidency"] })} disabled={!editable}>
                <SelectTrigger className="uppercase"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="us">US</SelectItem>
                  <SelectItem value="eu">EU</SelectItem>
                  <SelectItem value="global">Global</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Secret rotation">
              <Select value={String(data.secretRotationDays)} onValueChange={(v) => patch({ secretRotationDays: Number(v) })} disabled={!editable}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[30, 60, 90, 180].map((d) => (
                    <SelectItem key={d} value={String(d)}>Every {d} days</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Session timeout">
              <Select value={String(data.sessionTimeoutMinutes)} onValueChange={(v) => patch({ sessionTimeoutMinutes: Number(v) })} disabled={!editable}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[60, 240, 480, 1440].map((m) => (
                    <SelectItem key={m} value={String(m)}>{m >= 1440 ? "24 hours" : m >= 60 ? `${m / 60} hours` : `${m} min`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <AllowlistCard
          title="IP allowlist"
          description="Only these CIDR ranges may reach the API."
          placeholder="10.0.0.0/8"
          values={data.ipAllowlist}
          editable={editable}
          onChange={(ipAllowlist) => patch({ ipAllowlist })}
        />
        <AllowlistCard
          title="Egress allowlist"
          description="Hosts agents are allowed to call out to."
          placeholder="api.example.com"
          values={data.egressAllowlist}
          editable={editable}
          onChange={(egressAllowlist) => patch({ egressAllowlist })}
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}

function AllowlistCard({
  title,
  description,
  placeholder,
  values,
  editable,
  onChange,
}: {
  title: string;
  description: string;
  placeholder: string;
  values: string[];
  editable: boolean;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setDraft("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-5 pt-0">
        <ul className="flex flex-wrap gap-2">
          {values.map((v) => (
            <li key={v}>
              <Badge variant="outline" className="gap-1 font-mono text-xs">
                {v}
                {editable && (
                  <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="ml-0.5 rounded-full hover:text-danger">
                    <X className="size-3" />
                  </button>
                )}
              </Badge>
            </li>
          ))}
          {values.length === 0 && <span className="text-sm text-muted-foreground">No entries — all traffic allowed.</span>}
        </ul>
        {editable && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} className="h-8 font-mono text-xs" />
            <Button type="submit" size="sm" variant="outline" disabled={!draft.trim()}>
              <Plus className="size-4" /> Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
