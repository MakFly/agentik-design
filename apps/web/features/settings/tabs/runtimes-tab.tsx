"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import {
  ArrowUpCircle,
  CircleCheck,
  CircleX,
  CircleStop,
  Copy,
  KeyRound,
  Laptop,
  Loader2,
  PlugZap,
  RotateCcw,
  Play,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { PresenceBadge } from "@/components/shared/presence-badge";
import { Button } from "@/components/ui/button";
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
import { EmptyState } from "@/components/shared/empty-state";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { qk } from "@/lib/api/queryKeys";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProviderKeysSection } from "./provider-keys-section";
import {
  useDaemonToken,
  useRevokeDaemonToken,
  useRotateDaemonToken,
} from "./daemon-token-api";

interface DetectedTool {
  name: string;
  path?: string;
  version?: string;
  available: boolean;
  authenticated?: boolean;
  authSource?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  updateChecked?: boolean;
}

interface DaemonInfo {
  id: string;
  name: string;
  status: string;
  mode?: "personal" | "org" | "legacy";
  lastHeartbeatAt: string | null;
  meta: {
    host?: { host?: string; os?: string; arch?: string; go?: string };
    runtimes?: string[];
    tools?: DetectedTool[];
    installable?: string[];
  };
}

interface SystemInfo {
  daemonEnabled: boolean;
  providers: { anthropic: boolean; openai: boolean; google: boolean };
  daemons: DaemonInfo[];
  runtimes: Array<{
    id: string;
    daemonId: string;
    kind: string;
    status: string;
  }>;
  availableRuntimes: string[];
}

const PERSONAL_RUNTIMES = "echo,claude,hermes";
const DEFAULT_ENGINE_URL =
  process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:8787";

export function buildAgentikSetupCommand(
  token: string,
  engineUrl = DEFAULT_ENGINE_URL,
): string {
  return `agentik setup --url ${engineUrl} --token ${token} --runtimes ${PERSONAL_RUNTIMES} --start`;
}

export function buildDockerDaemonCommand(
  token: string,
  engineUrl = DEFAULT_ENGINE_URL,
): string {
  return `docker run -d --name agentik-daemon -e ENGINE_URL=${engineUrl} -e DAEMON_USER_TOKEN=${token} -e RUNTIME_KINDS=${PERSONAL_RUNTIMES} agentik-daemon:latest`;
}

export function buildPersonalDaemonCommand(token: string): string {
  return buildAgentikSetupCommand(token);
}

function useSystem(team: string) {
  return useQuery({
    queryKey: qk.settings.system(team),
    queryFn: ({ signal }) => apiFetch<SystemInfo>("/system", { team, signal }),
    refetchInterval: 5000,
  });
}

interface LocalDaemonStatus {
  ok: boolean;
  installed: boolean;
  running: boolean;
  status: string;
}

interface LocalDaemonJob {
  jobId: string;
}

interface InstallEvent {
  phase:
    | "started"
    | "log"
    | "status"
    | "daemon.running"
    | "completed"
    | "failed";
  message: string;
  at: string;
  running?: boolean;
  terminal?: boolean;
}

function useLocalDaemonStatus() {
  return useQuery({
    queryKey: ["local-daemon"],
    queryFn: ({ signal }) =>
      apiFetch<LocalDaemonStatus>("/local/daemon", { signal }),
    refetchInterval: 3000,
  });
}

function useCreateLocalDaemonJob(team: string) {
  return useMutation({
    mutationFn: (input: { token: string }) =>
      apiFetch<LocalDaemonJob>("/local/daemon/jobs", {
        method: "POST",
        team,
        body: {
          token: input.token,
          engineUrl: DEFAULT_ENGINE_URL,
          runtimes: PERSONAL_RUNTIMES,
          team,
        },
      }),
  });
}

function useControlLocalDaemon(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: "start" | "stop") =>
      apiFetch<LocalDaemonStatus>("/local/daemon", {
        method: "POST",
        team,
        body: { action },
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["local-daemon"] });
      qc.invalidateQueries({ queryKey: qk.settings.system(team) });
    },
  });
}

function useUninstallLocalDaemon(team: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<LocalDaemonStatus>("/local/daemon", {
        method: "DELETE",
        team,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["local-daemon"] });
      qc.invalidateQueries({ queryKey: qk.settings.system(team) });
    },
  });
}

function streamInstallJob(
  jobId: string,
  onEvent: (event: InstallEvent) => void,
): Promise<InstallEvent> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/v1/local/daemon/jobs/${jobId}/events`);
    const finish = (event: InstallEvent) => {
      es.close();
      if (event.phase === "failed") {
        reject(new Error(event.message));
        return;
      }
      resolve(event);
    };
    const handle = (raw: MessageEvent) => {
      const event = JSON.parse(raw.data) as InstallEvent;
      onEvent(event);
      if (event.terminal) finish(event);
    };
    for (const type of [
      "started",
      "log",
      "status",
      "daemon.running",
      "completed",
      "failed",
    ]) {
      es.addEventListener(type, handle);
    }
    es.onerror = () => {
      es.close();
      reject(
        new Error(
          "Install stream unavailable. The local daemon route may not be registered yet.",
        ),
      );
    };
  });
}

const modeLabel = (mode: DaemonInfo["mode"]): string => {
  if (mode === "personal") return "Personal";
  if (mode === "org") return "Workspace";
  if (mode === "legacy") return "Legacy";
  return "Workspace";
};

const CONNECTION_SECTIONS = [
  { value: "overview", label: "Overview" },
  { value: "setup", label: "Daemon" },
  { value: "providers", label: "Provider keys" },
] as const;

type ConnectionSection = (typeof CONNECTION_SECTIONS)[number]["value"];

export function RuntimesTab({ team }: { team: string }) {
  const system = useSystem(team);
  const [section, setSection] = useQueryState("section", {
    defaultValue: "overview",
  });
  const active: ConnectionSection = CONNECTION_SECTIONS.some(
    (s) => s.value === section,
  )
    ? (section as ConnectionSection)
    : section === "computers"
      ? "setup"
      : "overview";

  if (system.isError) {
    return (
      <EmptyState
        icon={WifiOff}
        title="Engine unreachable"
        description="Couldn't load runtime system info. Check the engine process and the app API proxy."
      />
    );
  }

  return (
    <Tabs value={active} onValueChange={(v) => setSection(v)} className="gap-5">
      <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabsList className="w-fit">
          {CONNECTION_SECTIONS.map((s) => (
            <TabsTrigger
              key={s.value}
              value={s.value}
              className="flex-none px-3"
            >
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="overview" className="mt-0 flex flex-col gap-5">
        <ConnectionsIntro />
        <RuntimeSummary data={system.data} loading={system.isLoading} />
      </TabsContent>

      <TabsContent value="setup" className="mt-0 flex flex-col gap-5">
        <ConnectMachine team={team} />
        <ConnectedComputers data={system.data} loading={system.isLoading} />
      </TabsContent>

      <TabsContent value="providers" className="mt-0">
        <ProviderKeysSection team={team} />
      </TabsContent>
    </Tabs>
  );
}

function ConnectedComputers({
  data,
  loading,
}: {
  data?: SystemInfo;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected computers</CardTitle>
        <CardDescription>
          Machines checking in and the agent CLIs detected on each one.
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
              <DaemonCard key={d.id} daemon={d} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Laptop}
            title="No computer connected"
            description="Install the daemon on a target machine and it will appear here."
          />
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionsIntro() {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)] lg:items-start">
        <div className="max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
            <PlugZap className="size-3.5" />
            Local tools
          </div>
          <h2 className="text-base font-semibold text-foreground">
            Connect a computer so agents can use its CLIs.
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Agentik does not run Claude, Hermes, or other local CLIs on its own.
            A small local connector reports which tools are installed on your
            machine and makes them selectable for runs.
          </p>
        </div>
        <ol className="grid gap-2 text-sm">
          <SetupStep
            number="1"
            title="Create command"
            description="Generate a private one-time command for your account."
          />
          <SetupStep
            number="2"
            title="Install locally"
            description="Run the Agentik CLI on the machine that owns the CLIs."
          />
          <SetupStep
            number="3"
            title="Keep it online"
            description="When the connector is running, available tools appear below."
          />
        </ol>
      </div>
    </section>
  );
}

function SetupStep({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <span className="flex size-7 items-center justify-center rounded-full bg-surface text-xs font-semibold text-foreground shadow-xs">
        {number}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
    </li>
  );
}

function RuntimeSummary({
  data,
  loading,
}: {
  data?: SystemInfo;
  loading: boolean;
}) {
  const online = data?.daemons.filter((d) => d.status === "online").length ?? 0;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <SummaryCard
        label="Local connector"
        description="Engine accepts daemon connections for this workspace."
        value={data?.daemonEnabled ? "Enabled" : "Unavailable"}
        ok={Boolean(data?.daemonEnabled)}
        loading={loading}
      />
      <SummaryCard
        label="Connected computers"
        description="Machines currently available for agent runs."
        value={`${online}/${data?.daemons.length ?? 0} online`}
        ok={online > 0}
        loading={loading}
      />
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Tools ready for runs</CardTitle>
          <CardDescription>Selectable by agents right now.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5 px-4">
          {loading && !data ? (
            <Skeleton className="h-6 w-28" />
          ) : data && data.availableRuntimes.length > 0 ? (
            data.availableRuntimes.map((r) => (
              <Badge key={r} variant="secondary">
                {r}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">None</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  description,
  value,
  ok,
  loading,
}: {
  label: string;
  description: string;
  value: string;
  ok: boolean;
  loading: boolean;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{label}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2 px-4">
        {loading ? (
          <Skeleton className="h-6 w-24" />
        ) : (
          <>
            {ok ? (
              <CircleCheck className="size-4 text-success" />
            ) : (
              <CircleX className="size-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">{value}</span>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectMachine({ team }: { team: string }) {
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
  const cliCommand = freshToken ? buildAgentikSetupCommand(freshToken) : null;
  const dockerCommand = freshToken
    ? buildDockerDaemonCommand(freshToken)
    : null;
  const orgCount = token.data?.eligibleOrgs.length ?? 0;
  const localInstalled = Boolean(localDaemon.data?.installed);
  const localRunning = Boolean(localDaemon.data?.running);
  const loadingLocalState = localDaemon.isLoading && !localDaemon.data;
  const generateCommand = () =>
    rotate.mutate(undefined, {
      onSuccess: (res) => {
        setFreshToken(res.token);
        toast.success("Connection command created");
      },
      onError: (e) =>
        toast.error(
          e instanceof Error ? e.message : "Could not create setup command",
        ),
    });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Install daemon</CardTitle>
          <CardDescription>
            Create a private setup command for the computer that should execute
            local tools.
          </CardDescription>
        </div>
        <CardAction>
          {token.data?.hasToken ? (
            <Badge variant="secondary">
              <KeyRound /> Token {token.data.prefix}
            </Badge>
          ) : (
            <Badge variant="outline">No command yet</Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span>
                Works for {orgCount} eligible org{orgCount === 1 ? "" : "s"}
              </span>
              {token.data?.issuedAt && (
                <span>Created {formatRelativeTime(token.data.issuedAt)}</span>
              )}
              {freshToken && (
                <span className="font-medium text-warning">
                  Copy now. This exact command is shown once.
                </span>
              )}
            </div>
            <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
              Generating a command from the CLI native or Docker runner tab
              creates a new setup token and invalidates the previous one. Revoke
              access when this computer should no longer connect.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={
                (!token.data?.hasToken && !localInstalled) ||
                revoke.isPending ||
                uninstallLocal.isPending
              }
              onClick={async () => {
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
                  !local.ok
                    ? "Access revoked, local uninstall failed"
                    : "Daemon uninstalled",
                );
              }}
            >
              <Trash2 className="size-4" />
              Uninstall daemon
            </Button>
          </div>
        </div>

        <Tabs defaultValue="local" className="gap-3">
          <TabsList className="w-fit">
            <TabsTrigger value="local">Local install</TabsTrigger>
            <TabsTrigger value="cli">CLI native</TabsTrigger>
            <TabsTrigger value="docker">Docker runner</TabsTrigger>
          </TabsList>
          <TabsContent value="local" className="mt-0">
            <div className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-foreground">
                  <Terminal className="size-3.5 text-muted-foreground" />
                  Daemon on this computer
                </div>
                <p className="max-w-xl text-xs leading-5 text-muted-foreground">
                  Install the local Agentik daemon, then start or stop it from
                  this machine.
                </p>
                <LocalDaemonLine status={localDaemon.data} />
              </div>
              {loadingLocalState ? (
                <DaemonButtonsSkeleton />
              ) : !localInstalled ? (
                <Button
                  size="sm"
                  variant="default"
                  disabled={
                    rotate.isPending || createInstallJob.isPending || installing
                  }
                  onClick={async () => {
                    try {
                      setInstalling(true);
                      setInstallEvents([]);
                      const setupToken =
                        freshToken ?? (await rotate.mutateAsync()).token;
                      setFreshToken(setupToken);
                      const job = await createInstallJob.mutateAsync({
                        token: setupToken,
                      });
                      const terminal = await streamInstallJob(
                        job.jobId,
                        (event) => {
                          setInstallEvents((events) => [...events, event]);
                          if (event.phase === "daemon.running") {
                            qc.invalidateQueries({
                              queryKey: ["local-daemon"],
                            });
                            qc.invalidateQueries({
                              queryKey: qk.settings.system(team),
                            });
                          }
                        },
                      );
                      toast.success(
                        terminal.phase === "completed"
                          ? "Daemon started"
                          : "Daemon install finished",
                      );
                    } catch (e) {
                      toast.error(
                        e instanceof Error
                          ? e.message
                          : "Could not install daemon locally",
                      );
                    } finally {
                      setInstalling(false);
                    }
                  }}
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="default"
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
                </div>
              )}
            </div>
            {installing && <InstallProgress events={installEvents} />}
            <InstallEventLog events={installEvents} />
          </TabsContent>
          <TabsContent value="cli" className="mt-0">
            {cliCommand ? (
              <CommandBlock
                label="Run on the target machine"
                command={cliCommand}
              />
            ) : (
              <GenerateCommand
                text="Generate a one-time command to set up the native CLI on the target machine."
                onGenerate={generateCommand}
                pending={rotate.isPending}
              />
            )}
          </TabsContent>
          <TabsContent value="docker" className="mt-0">
            {dockerCommand ? (
              <CommandBlock
                label="Run a containerized daemon"
                command={dockerCommand}
              />
            ) : (
              <GenerateCommand
                text="Generate a one-time command to run a containerized daemon."
                onGenerate={generateCommand}
                pending={rotate.isPending}
              />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function DaemonButtonsSkeleton() {
  return (
    <div className="flex flex-wrap gap-2">
      <Skeleton className="h-9 w-20 rounded-md" />
      <Skeleton className="h-9 w-20 rounded-md" />
    </div>
  );
}

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

function LocalDaemonLine({ status }: { status?: LocalDaemonStatus }) {
  if (!status) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Checking local daemon status...
      </p>
    );
  }
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {status.running ? (
        <CircleCheck className="size-3.5 text-success" />
      ) : (
        <CircleX className="size-3.5 text-muted-foreground" />
      )}
      <span>
        {status.running
          ? "Local daemon running"
          : status.installed
            ? "Local daemon installed, stopped"
            : "Local daemon not installed"}
      </span>
      {status.status && <span className="font-mono">{status.status}</span>}
    </p>
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

function CommandBlock({ label, command }: { label: string; command: string }) {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-foreground">
          <Terminal className="size-3.5 text-muted-foreground" />
          {label}
        </div>
        <code className="block overflow-x-auto whitespace-nowrap rounded-md bg-surface px-2.5 py-2 font-mono text-xs">
          {command}
        </code>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          navigator.clipboard?.writeText(command);
          toast.success("Command copied");
        }}
      >
        <Copy className="size-4" />
        Copy
      </Button>
    </div>
  );
}

function GenerateCommand({
  text,
  onGenerate,
  pending,
}: {
  text: string;
  onGenerate: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-lg border border-dashed border-border px-3 py-3">
      <p className="text-xs leading-5 text-muted-foreground">{text}</p>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={onGenerate}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RotateCcw className="size-4" />
        )}
        Generate command
      </Button>
    </div>
  );
}

function DaemonCard({ daemon }: { daemon: DaemonInfo }) {
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
            <span className="truncate">{daemon.name}</span>
          </CardTitle>
          <CardDescription className="truncate">
            {host
              ? `${host.host ?? "host"} · ${host.os}/${host.arch}`
              : "Computer details unavailable"}
          </CardDescription>
        </div>
        <CardAction className="flex gap-2">
          <PresenceBadge status={daemon.status} />
          <Badge variant="muted">{modeLabel(daemon.mode)}</Badge>
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
              No tools available to runs yet
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
              : `Last seen ${formatRelativeTime(daemon.lastHeartbeatAt)} — offline (CLI list may be stale)`
            : "No recent check-in"}
        </p>
      </CardContent>
    </Card>
  );
}
