"use client";

import {
  ArrowUpCircle,
  CircleCheck,
  CircleX,
  Loader2,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { PresenceBadge } from "@/components/shared/presence-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useForgetDaemon } from "./local-daemon-api";
import type { DaemonInfo, SystemInfo } from "./types";

const modeLabel = (mode: DaemonInfo["mode"]): string => {
  if (mode === "personal") return "Personal";
  if (mode === "org") return "Workspace";
  if (mode === "legacy") return "Legacy";
  return "Workspace";
};

function daemonDisplayName(daemon: DaemonInfo): string {
  return (
    daemon.meta.deviceName ??
    daemon.meta.host?.host ??
    daemon.name
  );
}

/** Mirror of the engine's DELETE_MIN_OFFLINE_MS: only offer "Forget" once a
 *  daemon has been silent well past the 15s online-flap window, so a brief blip
 *  can't surface a destructive action on a live machine (the API also refuses). */
const FORGET_MIN_OFFLINE_MS = 120_000;

function isForgettable(daemon: DaemonInfo): boolean {
  if (daemon.status === "online") return false;
  if (!daemon.lastHeartbeatAt) return true;
  // Postgres offset "+00" → "+00:00" for Date.parse.
  const ts = Date.parse(
    String(daemon.lastHeartbeatAt)
      .replace(" ", "T")
      .replace(/([+-]\d{2})$/, "$1:00"),
  );
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts >= FORGET_MIN_OFFLINE_MS;
}

function ForgetDaemonButton({
  team,
  daemon,
}: {
  team: string;
  daemon: DaemonInfo;
}) {
  const forget = useForgetDaemon(team);
  const name = daemonDisplayName(daemon);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground hover:text-danger pointer-coarse:size-11"
          aria-label={`Forget ${name}`}
          disabled={forget.isPending}
        >
          {forget.isPending ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Forget this computer?</AlertDialogTitle>
          <AlertDialogDescription>
            Removes <span className="font-medium">{name}</span> from this
            workspace. A daemon that is still running won&apos;t re-register on
            its own — restart it (or re-run the installer) to bring it back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={() =>
              forget.mutate(daemon.id, {
                onSuccess: () => toast.success("Computer forgotten"),
                onError: (e) =>
                  toast.error(
                    e instanceof Error ? e.message : "Could not forget computer",
                  ),
              })
            }
          >
            Forget
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DaemonCard({ team, daemon }: { team: string; daemon: DaemonInfo }) {
  const online = daemon.status === "online";
  const stale = !online;
  const tools = daemon.meta.tools ?? [];
  const host = daemon.meta.host;

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <div className="min-w-0">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
            <Server className="size-4 text-muted-foreground" />
            <span className="truncate">{daemonDisplayName(daemon)}</span>
          </CardTitle>
          <CardDescription className="truncate">
            {host
              ? `${host.os}/${host.arch}${daemon.meta.deviceId ? ` · ${daemon.meta.deviceId.slice(0, 8)}` : ""}`
              : "Computer details unavailable"}
          </CardDescription>
        </div>
        <CardAction className="flex items-center gap-2">
          <PresenceBadge status={daemon.status} />
          <Badge variant="muted">{modeLabel(daemon.mode)}</Badge>
          {isForgettable(daemon) ? (
            <ForgetDaemonButton team={team} daemon={daemon} />
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4">
        <div className="flex flex-wrap gap-1.5">
          {(daemon.meta.runtimes ?? []).map((r) => (
            <Badge key={r} variant="muted" className="font-mono">
              {r}
            </Badge>
          ))}
          {(daemon.meta.runtimes ?? []).length === 0 && (
            <span className="text-xs text-muted-foreground">
              No agent backends registered yet
            </span>
          )}
        </div>
        <Separator />
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Agent CLIs on this computer
          </span>
          {tools.length > 0 ? (
            tools.map((tool) => {
              const upToDate =
                tool.available &&
                tool.updateChecked &&
                tool.updateAvailable === false;
              const upgradeReady =
                tool.available &&
                tool.updateChecked &&
                tool.updateAvailable === true;
              return (
                <div
                  key={tool.name}
                  className="rounded-md border border-border px-2.5 py-2 text-xs"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {tool.available ? (
                      stale ? (
                        <CircleCheck className="size-3.5 text-muted-foreground/60" />
                      ) : (
                        <CircleCheck className="size-3.5 text-success" />
                      )
                    ) : (
                      <CircleX className="size-3.5 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        "font-mono",
                        (!tool.available || stale) && "text-muted-foreground",
                      )}
                    >
                      {tool.name}
                    </span>
                    {!stale &&
                      tool.available &&
                      (tool.authenticated ? (
                        <Badge variant="success">
                          <ShieldCheck /> ready
                        </Badge>
                      ) : (
                        <Badge variant="warning">
                          <ShieldAlert /> sign in needed
                        </Badge>
                      ))}
                    {stale && tool.available && (
                      <Badge variant="muted">cached</Badge>
                    )}
                    {!stale && upToDate && (
                      <Badge variant="success">up to date</Badge>
                    )}
                    {!stale && upgradeReady && (
                      <Badge variant="info">
                        <ArrowUpCircle className="size-3" />
                        update available
                      </Badge>
                    )}
                  </div>
                  <p
                    className="mt-1 truncate text-[11px] text-muted-foreground"
                    title={tool.path}
                  >
                    {tool.available
                      ? stale
                        ? tool.version
                          ? `${tool.version} (last check-in)`
                          : "cached from last check-in"
                        : upgradeReady && tool.latestVersion
                          ? `${tool.version ?? "installed"} → ${tool.latestVersion}`
                          : tool.version || tool.path || "available"
                      : "not found"}
                  </p>
                </div>
              );
            })
          ) : (
            <span className="text-xs text-muted-foreground">
              No CLI check-in yet.
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {daemon.lastHeartbeatAt
            ? online
              ? `Last check-in ${formatRelativeTime(daemon.lastHeartbeatAt)}`
              : `Last seen ${formatRelativeTime(daemon.lastHeartbeatAt)} — offline`
            : "No recent check-in"}
        </p>
      </CardContent>
    </Card>
  );
}

export function RuntimesComputersList({
  team,
  data,
  loading,
}: {
  team: string;
  data?: SystemInfo;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected computers</CardTitle>
        <CardDescription>
          Machines running the Agentik daemon and checking in to this workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading && !data ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <Skeleton className="h-56 rounded-lg" />
            <Skeleton className="h-56 rounded-lg" />
          </div>
        ) : data && data.daemons.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.daemons.map((d) => (
              <DaemonCard key={d.id} team={team} daemon={d} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
