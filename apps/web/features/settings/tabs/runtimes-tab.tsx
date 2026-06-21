"use client";

import { useQuery } from "@tanstack/react-query";
import { Server, Cpu, CircleCheck, CircleX, Wifi, WifiOff } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { EmptyState } from "@/components/shared/empty-state";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DetectedTool {
  name: string;
  path?: string;
  version?: string;
  available: boolean;
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
  };
}

interface SystemInfo {
  daemonEnabled: boolean;
  providers: { anthropic: boolean; openai: boolean; google: boolean };
  daemons: DaemonInfo[];
  runtimes: Array<{ id: string; daemonId: string; kind: string; status: string }>;
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

export function RuntimesTab({ team }: { team: string }) {
  const { data, isLoading, isError } = useSystem(team);

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
          Provider keys show presence only — values are never exposed. Agent CLIs (e.g. Claude Code) may authenticate via
          their own session instead of a key.
        </p>
      </section>

      {/* Daemons + detected CLIs */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">Daemons &amp; runtimes</h2>

        {isLoading && !data ? (
          <div className="h-24 animate-pulse rounded-xl bg-surface-2" />
        ) : data && data.daemons.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.daemons.map((d) => {
              const online = d.status === "online";
              const tools = d.meta.tools ?? [];
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

                  {/* Detected CLIs — who/what/how we can actually run */}
                  <div className="flex flex-col gap-1.5 border-t border-border pt-2">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Detected CLIs</span>
                    {tools.map((t) => (
                      <div key={t.name} className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          {t.available ? (
                            <CircleCheck className="size-3.5 text-success" />
                          ) : (
                            <CircleX className="size-3.5 text-muted-foreground/40" />
                          )}
                          <span className={cn("font-mono", !t.available && "text-muted-foreground")}>{t.name}</span>
                        </span>
                        <span className="truncate text-[11px] text-muted-foreground" title={t.path}>
                          {t.available ? (t.version || "available") : "not found"}
                        </span>
                      </div>
                    ))}
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
      </section>
    </div>
  );
}
