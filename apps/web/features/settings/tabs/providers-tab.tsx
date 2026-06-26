"use client";

import { useState, useEffect } from "react";
import { Loader2, Plug, Star, ArrowRight } from "lucide-react";
import { toastApiError } from "@/lib/api/toast-error";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useRbac } from "@/lib/auth/rbac";
import { formatMoney } from "@/lib/format";
import { useProviders, useUpdateProvider, useTestProvider } from "../api";
import { useUpdateProvidersPolicy } from "@/features/configure/settings-api";
import type { Provider } from "../types";

function ProvidersPolicyCard({ team, data }: { team: string; data: NonNullable<ReturnType<typeof useProviders>["data"]> }) {
  const { can } = useRbac();
  const updatePolicy = useUpdateProvidersPolicy(team);
  const [cents, setCents] = useState(String(data.costCeilingPerDay.amountCents));

  useEffect(() => {
    setCents(String(data.costCeilingPerDay.amountCents));
  }, [data.costCeilingPerDay.amountCents]);

  const orderLabels = data.fallbackOrder
    .map((id) => data.items.find((p) => p.id === id)?.label)
    .filter(Boolean);

  async function saveCeiling() {
    const value = Number(cents);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Invalid amount");
      return;
    }
    try {
      await updatePolicy.mutateAsync({ costCeilingPerDayCents: value });
      toast.success("Cost ceiling updated");
    } catch (e) {
      toastApiError(e, "Could not update cost ceiling");
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Fallback order</span>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {orderLabels.map((label, i) => (
              <span key={label} className="flex items-center gap-1.5">
                <Badge variant="outline">{label}</Badge>
                {i < orderLabels.length - 1 && <ArrowRight className="size-3.5" aria-hidden="true" />}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <span className="text-sm font-medium text-foreground">Cost ceiling / team / day</span>
          {can("settings:update") ? (
            <div className="flex items-center gap-2">
              <Input
                className="h-8 w-28 font-mono tabular-nums"
                value={cents}
                onChange={(e) => setCents(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">¢</span>
              <Button size="sm" variant="outline" disabled={updatePolicy.isPending} onClick={() => void saveCeiling()}>
                Save
              </Button>
            </div>
          ) : (
            <span className="font-mono text-sm tabular-nums text-muted-foreground" data-tabular>
              {formatMoney(data.costCeilingPerDay)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProvidersTab({ team }: { team: string }) {
  const { data, isLoading, isError, error, refetch } = useProviders(team);

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {data.items.map((p) => (
          <ProviderCard key={p.id} team={team} provider={p} />
        ))}
      </div>

      <ProvidersPolicyCard team={team} data={data} />
    </div>
  );
}

function ProviderCard({ team, provider }: { team: string; provider: Provider }) {
  const { can } = useRbac();
  const update = useUpdateProvider(team);
  const test = useTestProvider(team);
  const [testing, setTesting] = useState(false);
  const editable = can("settings:update");
  const enabled = provider.status === "active";

  async function toggle(on: boolean) {
    try {
      await update.mutateAsync({ id: provider.id, status: on ? "active" : "off" });
    } catch (e) {
      toastApiError(e, "Could not update provider");
    }
  }

  async function setDefault() {
    try {
      await update.mutateAsync({ id: provider.id, isDefault: true });
      toast.success(`${provider.label} is now the default provider`);
    } catch (e) {
      toastApiError(e, "Could not set default provider");
    }
  }

  async function runTest() {
    setTesting(true);
    try {
      const res = await test.mutateAsync(provider.id);
      if (res.ok) toast.success(`${provider.label} reachable · ${res.latencyMs}ms`);
      else toast.error(res.message ?? "Test failed");
    } catch (e) {
      toastApiError(e, "Provider test failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {provider.label}
          {provider.isDefault && (
            <Badge variant="secondary" className="gap-1 text-[11px]">
              <Star className="size-3" /> default
            </Badge>
          )}
        </CardTitle>
        <Switch checked={enabled} onCheckedChange={toggle} disabled={!editable || update.isPending} aria-label={`Enable ${provider.label}`} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-5 pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <span>{provider.hasKey ? "Key ••••" : provider.baseUrl ? `Base URL ${provider.baseUrl}` : "No credentials"}</span>
          {provider.models.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {provider.models.map((m) => (
                <code key={m} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
                  {m}
                </code>
              ))}
            </span>
          )}
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={runTest} disabled={testing}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
              Test
            </Button>
            {!provider.isDefault && enabled && (
              <Button variant="ghost" size="sm" onClick={setDefault} disabled={update.isPending}>
                <Star className="size-4" /> Set default
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
