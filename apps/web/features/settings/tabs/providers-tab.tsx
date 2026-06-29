"use client";

import { useState } from "react";
import { Loader2, Plug, Star, Check, Trash2 } from "lucide-react";
import { toastApiError, onMutationError } from "@/lib/api/toast-error";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PasswordInput } from "@/components/ui/password-input";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useRbac } from "@/lib/auth/rbac";
import {
  useProviders,
  useUpdateProvider,
  useTestProvider,
  useProviderKeys,
  useSetProviderKey,
  useRemoveProviderKey,
  type ProviderKey,
} from "../api";
import type { Provider } from "../types";

/** Provider cards use ids like `prov_openai`; the key family is the suffix. */
function providerFamily(id: string): string | null {
  return id.startsWith("prov_") ? id.slice(5) : null;
}

export function ProvidersTab({ team }: { team: string }) {
  const { data, isLoading, isError, error, refetch } = useProviders(team);
  const { data: keysData } = useProviderKeys(team);

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

  const keyByFamily = new Map(
    (keysData?.items ?? []).map((k) => [k.provider, k]),
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {data.items.map((p) => {
        const family = providerFamily(p.id);
        return (
          <ProviderCard
            key={p.id}
            team={team}
            provider={p}
            providerKey={family ? keyByFamily.get(family) : undefined}
          />
        );
      })}
    </div>
  );
}

function ProviderCard({
  team,
  provider,
  providerKey,
}: {
  team: string;
  provider: Provider;
  providerKey?: ProviderKey;
}) {
  const { can } = useRbac();
  const update = useUpdateProvider(team);
  const test = useTestProvider(team);
  const [testing, setTesting] = useState(false);
  const editable = can("settings:update");
  const enabled = provider.status === "active";

  const setKey = useSetProviderKey(team);
  const removeKey = useRemoveProviderKey(team);
  const [draft, setDraft] = useState("");
  const family = providerFamily(provider.id);

  async function saveKey() {
    if (!family || draft.trim().length < 8) return;
    try {
      await setKey.mutateAsync({ provider: family, key: draft.trim() });
      setDraft("");
      toast.success(`${provider.label} key saved`);
    } catch (e) {
      toastApiError(e, "Could not save key");
    }
  }

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
        {/* Credentials: inline API key (joined from /settings/provider-keys),
            or a base URL for self-hosted, or nothing. */}
        {providerKey ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <code className="font-mono text-[11px] text-muted-foreground">
                {providerKey.envVar}
              </code>
              {providerKey.hasKey && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                  <Check className="size-3" /> set
                </span>
              )}
            </div>
            {editable ? (
              <div className="flex flex-col gap-2">
                <PasswordInput
                  autoComplete="off"
                  wrapperClassName="flex-1"
                  placeholder={
                    providerKey.hasKey
                      ? "•••••••••• (configured, type to replace)"
                      : "Paste API key…"
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={draft.trim().length < 8 || setKey.isPending}
                    onClick={() => void saveKey()}
                  >
                    {setKey.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                  {providerKey.hasKey && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${provider.label} key`}
                      disabled={removeKey.isPending}
                      onClick={() =>
                        family &&
                        removeKey.mutate(family, {
                          onSuccess: () => toast.success("Key removed"),
                          onError: onMutationError("Could not remove key"),
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                {providerKey.hasKey ? "Key configured" : "No key set"}
              </span>
            )}
          </div>
        ) : provider.baseUrl ? (
          <span className="text-sm text-muted-foreground">
            Base URL{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
              {provider.baseUrl}
            </code>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">No credentials</span>
        )}

        {provider.models.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {provider.models.map((m) => (
              <code
                key={m}
                className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs"
              >
                {m}
              </code>
            ))}
          </div>
        )}
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
