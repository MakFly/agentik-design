"use client";

import { useQuery } from "@tanstack/react-query";
import { Server, Cpu, CircleCheck, CircleX, Wifi, WifiOff, Download, ArrowUpCircle, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/shared/empty-state";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProviderKeysSection } from "./provider-keys-section";
import { useBundles, useRunBundle, useSetBundlePolicy, type BundleCommand } from "./bundles-api";

interface DetectedTool {
  name: string;
  path?: string;
  version?: string;
  available: boolean;
  /** True when the CLI already has usable credentials on the host (saved login or env key). */
  authenticated?: boolean;
  authSource?: string; // "session" | "key"
}

interface DaemonInfo {
  id: string;
  name: string;
  status: string;
  lastHeartbeatAt: string | null;
  meta: {
    host?: { host?: string; os?: string; arch?: string; go?: string };
    runtimes?: string[];
    tools?: DetectedTool[];
    /** CLI kinds this daemon knows how to install (from its bundle allowlist). */
    installable?: string[];
  };
}

interface SystemInfo {
  daemonEnabled: boolean;
  providers: { anthropic: boolean; openai: boolean; google: boolean };
  daemons: DaemonInfo[];
  runtimes: Array<{ id: string; daemonId: string; kind: string; status: string }>;
  /** Runtimes that are wired on an online daemon with the backing CLI present — selectable for new agents. */
  availableRuntimes: string[];
}

function useSystem(team: string) {
  return useQuery({
    queryKey: ["team", team, "system"],
    queryFn: ({ signal }) => apiFetch<SystemInfo>("/system", { team, signal }),
    refetchInterval: 5000, // diagnostics view — keep it live
  });
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        ok ? "bg-success/10 text-success" : "bg-surface-2 text-muted-foreground",
      )}
    >
      {ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
      {label}
    </span>
  );
}

const cmdKey = (daemonId: string, kind: string) => `${daemonId}|${kind}`;

export function RuntimesTab({ team }: { team: string }) {
  const { data, isLoading, isError } = useSystem(team);
  const bundles = useBundles(team);
  const runBundle = useRunBundle(team);
  const setPolicy = useSetBundlePolicy(team);

  const networkInstall = bundles.data?.policy.networkInstall ?? false;

  // Latest command per (daemon, kind) so a row can show its in-flight / last state.
  const latestByTarget = new Map<string, BundleCommand>();
  for (const c of bundles.data?.items ?? []) {
    if (!latestByTarget.has(cmdKey(c.daemonId, c.kind))) latestByTarget.set(cmdKey(c.daemonId, c.kind), c);
  }

  function run(daemonId: string, kind: string, action: "install" | "upgrade") {
    runBundle.mutate(
      { daemonId, kind, action },
      {
        onSuccess: () => toast.success(`${action} ${kind} queued`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Bundle command failed"),
      },
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={WifiOff}
        title="Engine unreachable"
        description="Couldn't load system info. Is the engine running (and is the app in non-mock mode)?"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Capabilities summary */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">Capabilities</h2>
        <div className="flex flex-wrap gap-2">
          <Chip ok={!!data?.daemonEnabled} label="Daemon protocol" />
          <Chip ok={!!data?.providers.anthropic} label="Anthropic key" />
          <Chip ok={!!data?.providers.openai} label="OpenAI key" />
          <Chip ok={!!data?.providers.google} label="Google key" />
        </div>
        <p className="text-xs text-muted-foreground">
          Pills above reflect keys in the engine&apos;s own env. Manage per-org runtime keys below — Agent CLIs (e.g.
          Claude Code) may also authenticate via their own session instead of a key.
        </p>

        {/* Selectable runtimes — the set the agent builder can target right now */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Selectable runtimes</span>
          {data && data.availableRuntimes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {data.availableRuntimes.map((r) => (
                <span key={r} className="inline-flex items-center gap-1 rounded-full bg-running/10 px-2 py-0.5 text-[11px] font-medium text-running">
                  <Cpu className="size-3" />
                  {r}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              None yet — connect a daemon whose host has the agent CLI installed (claude, hermes…) to make it selectable in the agent builder.
            </p>
          )}
        </div>
      </section>

      {/* Managed runtime provider keys (encrypted, injected into the daemon) */}
      <ProviderKeysSection team={team} />

      {/* Daemons + detected CLIs + bundle install */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Daemons &amp; runtimes</h2>

          {/* Network-install policy — persisted per org (not an env flag). Off by default. */}
          <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
            <span className="flex flex-col">
              <span className="text-xs font-medium">Allow CLI installs from the UI</span>
              <span className="text-[11px] text-muted-foreground">Lets owners install/upgrade agent CLIs on a daemon host. Off by default.</span>
            </span>
            <Switch
              checked={networkInstall}
              disabled={setPolicy.isPending || bundles.isLoading}
              onCheckedChange={(v) =>
                setPolicy.mutate(v, {
                  onSuccess: () => toast.success(v ? "CLI installs enabled" : "CLI installs disabled"),
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Need owner rights to change this"),
                })
              }
            />
          </label>
        </div>

        {isLoading && !data ? (
          <div className="h-24 animate-pulse rounded-xl bg-surface-2" />
        ) : data && data.daemons.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.daemons.map((d) => {
              const online = d.status === "online";
              const tools = d.meta.tools ?? [];
              const installable = d.meta.installable ?? [];
              const host = d.meta.host;
              return (
                <div key={d.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Server className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{d.name}</span>
                    </div>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                        online ? "bg-success/10 text-success" : "bg-surface-2 text-muted-foreground",
                      )}
                    >
                      {online ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
                      {d.status}
                    </span>
                  </div>

                  {host && (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {host.host} · {host.os}/{host.arch} · {host.go}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {(d.meta.runtimes ?? []).map((r) => (
                      <span key={r} className="inline-flex items-center gap-1 rounded-full bg-running/10 px-2 py-0.5 text-[11px] font-medium text-running">
                        <Cpu className="size-3" />
                        {r}
                      </span>
                    ))}
                  </div>

                  {/* Detected CLIs — who/what/how we can actually run, with install/upgrade */}
                  <div className="flex flex-col gap-1.5 border-t border-border pt-2">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Detected CLIs</span>
                    {tools.map((t) => {
                      const canBundle = online && installable.includes(t.name);
                      const cmd = latestByTarget.get(cmdKey(d.id, t.name));
                      const inFlight = cmd?.status === "queued" || cmd?.status === "running";
                      return (
                        <div key={t.name} className="flex items-center justify-between gap-2 text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            {t.available ? (
                              <CircleCheck className="size-3.5 text-success" />
                            ) : (
                              <CircleX className="size-3.5 text-muted-foreground/40" />
                            )}
                            <span className={cn("font-mono", !t.available && "text-muted-foreground")}>{t.name}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[11px] text-muted-foreground" title={t.path}>
                              {t.available ? (t.version || "available") : "not found"}
                            </span>
                            {t.available &&
                              (t.authenticated ? (
                                <span
                                  className="inline-flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success"
                                  title={`Authenticated via ${t.authSource === "key" ? "an API key" : "a saved session"} — usable now`}
                                >
                                  <ShieldCheck className="size-2.5" /> ready
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                                  title="Installed but not authenticated — log in on the host, or set a matching provider key below"
                                >
                                  <ShieldAlert className="size-2.5" /> auth
                                </span>
                              ))}
                            {canBundle &&
                              (inFlight ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-running">
                                  <Loader2 className="size-3 animate-spin" />
                                  {cmd?.action}…
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 gap-1 px-2 text-[11px]"
                                  disabled={!networkInstall || runBundle.isPending}
                                  title={networkInstall ? undefined : "Enable “Allow CLI installs from the UI” first"}
                                  onClick={() => run(d.id, t.name, t.available ? "upgrade" : "install")}
                                >
                                  {t.available ? <ArrowUpCircle className="size-3" /> : <Download className="size-3" />}
                                  {t.available ? "Upgrade" : "Install"}
                                </Button>
                              ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-[11px] text-muted-foreground">
                    {online && d.lastHeartbeatAt ? `Heartbeat ${formatRelativeTime(d.lastHeartbeatAt)}` : "No recent heartbeat"}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Server}
            title="No daemon connected"
            description="Start the agent daemon (make dev/daemon) to register runtimes and detect available agent CLIs here."
          />
        )}

        {/* Recent bundle commands — feedback on installs/upgrades */}
        {(bundles.data?.items.length ?? 0) > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent install activity</span>
            <ul className="flex flex-col gap-1">
              {bundles.data!.items.slice(0, 6).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px]">
                  <span className="inline-flex items-center gap-2">
                    <BundleStatusDot status={c.status} />
                    <span className="font-mono">
                      {c.action} {c.kind}
                    </span>
                  </span>
                  <span className="truncate text-muted-foreground" title={c.error ?? c.result ?? undefined}>
                    {c.error ? c.error : c.result ? c.result : c.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function BundleStatusDot({ status }: { status: BundleCommand["status"] }) {
  const cls =
    status === "done"
      ? "bg-success"
      : status === "failed"
        ? "bg-danger"
        : status === "running"
          ? "bg-running animate-pulse"
          : "bg-muted-foreground/40";
  return <span className={cn("size-2 shrink-0 rounded-full", cls)} />;
}
