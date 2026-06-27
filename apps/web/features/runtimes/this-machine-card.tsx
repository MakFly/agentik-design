"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleStop,
  CircleX,
  Laptop,
  Loader2,
  Play,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { qk } from "@/lib/api/queryKeys";
import {
  useControlLocalDaemon,
  useCreateLocalDaemonJob,
  useLocalDaemonStatus,
  useUninstallLocalDaemon,
  streamInstallJob,
} from "./local-daemon-api";
import { deriveDaemonView } from "./daemon-view";
import {
  useRevokeDaemonToken,
  useRotateDaemonToken,
  useDaemonToken,
} from "@/features/settings/tabs/daemon-token-api";
import type { InstallEvent, LocalDaemonStatus, SystemInfo } from "./types";

function InstallProgress({ events }: { events: InstallEvent[] }) {
  const latest =
    [...events].reverse().find((event) => event.phase !== "log") ??
    events.at(-1);
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin text-foreground" />
        <span className="font-medium text-foreground">Installing daemon</span>
        {latest?.message && (
          <span className="min-w-0 truncate">{latest.message}</span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full w-1/3 animate-[agentik-progress_1.2s_ease-in-out_infinite] rounded-full bg-foreground" />
      </div>
      <style jsx>{`
        @keyframes agentik-progress {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(320%);
          }
        }
      `}</style>
    </div>
  );
}

function InstallEventLog({ events }: { events: InstallEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-5">
      {events.slice(-12).map((event, index) => (
        <div
          key={`${event.at}-${index}`}
          className={cn(
            "flex gap-2",
            event.phase === "failed"
              ? "text-danger"
              : event.phase === "completed" || event.phase === "daemon.running"
                ? "text-success"
                : "text-muted-foreground",
          )}
        >
          <span className="shrink-0 text-muted-foreground">{event.phase}</span>
          <span className="min-w-0 break-words">{event.message}</span>
        </div>
      ))}
    </div>
  );
}

function StatusLine({ status }: { status?: LocalDaemonStatus }) {
  if (!status) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Checking local daemon status...
      </p>
    );
  }

  const view = deriveDaemonView(status);
  const label =
    view.state === "running"
      ? `Daemon running on ${view.device}`
      : view.state === "stopped"
        ? "Daemon installed, stopped"
        : "Daemon not installed on this machine";

  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {view.running ? (
        <CircleCheck className="size-3.5 text-success" />
      ) : (
        <CircleX className="size-3.5 text-muted-foreground" />
      )}
      <span>{label}</span>
      {view.pid ? (
        <span className="font-mono">pid={view.pid}</span>
      ) : null}
    </p>
  );
}

export function ThisMachineCard({
  team,
  system,
}: {
  team: string;
  system?: SystemInfo;
}) {
  const token = useDaemonToken(team);
  const rotate = useRotateDaemonToken(team);
  const revoke = useRevokeDaemonToken(team);
  const localDaemon = useLocalDaemonStatus();
  const createInstallJob = useCreateLocalDaemonJob(team);
  const controlLocal = useControlLocalDaemon(team);
  const uninstallLocal = useUninstallLocalDaemon(team);
  const qc = useQueryClient();
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [installEvents, setInstallEvents] = useState<InstallEvent[]>([]);
  const [installing, setInstalling] = useState(false);

  const localInstalled = Boolean(localDaemon.data?.installed);
  const localRunning = Boolean(
    localDaemon.data?.health?.running ?? localDaemon.data?.running,
  );
  const loadingLocalState = localDaemon.isLoading && !localDaemon.data;
  const personalOnline = system?.daemons.some(
    (d) => d.mode === "personal" && d.status === "online",
  );

  const handleInstall = async () => {
    try {
      setInstalling(true);
      setInstallEvents([]);
      const setupToken = freshToken ?? (await rotate.mutateAsync()).token;
      setFreshToken(setupToken);
      const job = await createInstallJob.mutateAsync({ token: setupToken });
      const terminal = await streamInstallJob(job.jobId, (event) => {
        setInstallEvents((events) => [...events, event]);
        if (event.phase === "daemon.running") {
          qc.invalidateQueries({ queryKey: ["local-daemon"] });
          qc.invalidateQueries({ queryKey: qk.settings.system(team) });
        }
      });
      toast.success(
        terminal.phase === "completed"
          ? "Daemon started"
          : "Daemon install finished",
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not install daemon locally",
      );
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstall = async () => {
    const local = await uninstallLocal.mutateAsync().then(
      () => ({ ok: true as const }),
      (reason) => ({ ok: false as const, reason }),
    );
    const remote = token.data?.hasToken
      ? await revoke.mutateAsync().then(
          () => ({ ok: true as const }),
          (reason) => ({ ok: false as const, reason }),
        )
      : { ok: true as const };
    if (!remote.ok) {
      toast.error(
        remote.reason instanceof Error
          ? remote.reason.message
          : "Could not revoke access",
      );
      return;
    }
    setFreshToken(null);
    setInstallEvents([]);
    qc.invalidateQueries({ queryKey: ["local-daemon"] });
    qc.invalidateQueries({ queryKey: qk.settings.system(team) });
    toast.success(
      !local.ok ? "Access revoked, local uninstall failed" : "Daemon uninstalled",
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Laptop className="size-4 text-muted-foreground" />
              This machine
            </CardTitle>
            <CardDescription>
              The browser can install and control the Agentik daemon on this
              computer.
            </CardDescription>
          </div>
          {personalOnline ? (
            <Badge variant="success">Checked in</Badge>
          ) : localRunning ? (
            <Badge variant="secondary">Running locally</Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <StatusLine status={localDaemon.data} />
        <div className="flex flex-wrap gap-2">
          {loadingLocalState ? (
            <>
              <Skeleton className="h-9 w-24 rounded-md" />
              <Skeleton className="h-9 w-20 rounded-md" />
            </>
          ) : !localInstalled ? (
            <Button
              size="sm"
              disabled={
                rotate.isPending || createInstallJob.isPending || installing
              }
              onClick={handleInstall}
            >
              {rotate.isPending ||
              createInstallJob.isPending ||
              installing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Install daemon
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                disabled={localRunning || controlLocal.isPending}
                onClick={() =>
                  controlLocal.mutate("start", {
                    onSuccess: () => toast.success("Daemon started"),
                    onError: (e) =>
                      toast.error(
                        e instanceof Error
                          ? e.message
                          : "Could not start daemon",
                      ),
                  })
                }
              >
                {controlLocal.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                Start
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!localRunning || controlLocal.isPending}
                onClick={() =>
                  controlLocal.mutate("stop", {
                    onSuccess: () => toast.success("Daemon stopped"),
                    onError: (e) =>
                      toast.error(
                        e instanceof Error
                          ? e.message
                          : "Could not stop daemon",
                      ),
                  })
                }
              >
                {controlLocal.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CircleStop className="size-4" />
                )}
                Stop
              </Button>
            </>
          )}
          {(localInstalled || token.data?.hasToken) && (
            <Button
              size="sm"
              variant="ghost"
              disabled={revoke.isPending || uninstallLocal.isPending}
              onClick={handleUninstall}
            >
              <Trash2 className="size-4" />
              Uninstall
            </Button>
          )}
        </div>
        {installing && <InstallProgress events={installEvents} />}
        <InstallEventLog events={installEvents} />
      </CardContent>
    </Card>
  );
}
