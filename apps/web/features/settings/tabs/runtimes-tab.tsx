"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import {
  CircleCheck,
  CircleX,
  PlugZap,
  Server,
  Terminal,
  WifiOff,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { qk } from "@/lib/api/queryKeys";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProviderKeysSection } from "./provider-keys-section";
import {
  AddComputerButton,
  ConnectRemoteDialog,
} from "@/features/runtimes/connect-remote-dialog";
import { RuntimesComputersList } from "@/features/runtimes/runtimes-computers-list";
import { ThisMachineCard } from "@/features/runtimes/this-machine-card";
import { useLocalDaemonCapability } from "@/features/runtimes/use-local-daemon-capability";
import type { SystemInfo } from "@/features/runtimes/types";

// Re-export for tests and legacy imports
export {
  buildAgentikSetupCommand,
  buildDockerDaemonCommand,
  buildPersonalDaemonCommand,
} from "@/features/runtimes/constants";

function useSystem(team: string) {
  return useQuery({
    queryKey: qk.settings.system(team),
    queryFn: ({ signal }) => apiFetch<SystemInfo>("/system", { team, signal }),
    refetchInterval: 5000,
  });
}

const CONNECTION_SECTIONS = [
  { value: "runtimes", label: "Runtimes" },
  { value: "providers", label: "Providers" },
] as const;

type ConnectionSection = (typeof CONNECTION_SECTIONS)[number]["value"];

const LEGACY_SECTION_ALIASES: Record<string, ConnectionSection> = {
  overview: "runtimes",
  setup: "runtimes",
  computers: "runtimes",
};

export function RuntimesTab({
  team,
  fixedSection,
}: {
  team: string;
  fixedSection?: ConnectionSection;
}) {
  const system = useSystem(team);
  const { capability } = useLocalDaemonCapability();
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [section, setSection] = useQueryState("section", {
    defaultValue: "runtimes",
  });
  const active: ConnectionSection = fixedSection
    ? fixedSection
    : CONNECTION_SECTIONS.some((s) => s.value === section)
      ? (section as ConnectionSection)
      : (LEGACY_SECTION_ALIASES[section] ?? "runtimes");

  if (system.isError) {
    return (
      <EmptyState
        icon={WifiOff}
        title="Engine unreachable"
        description="Couldn't load runtime system info. Check the engine process and the app API proxy."
      />
    );
  }

  const runtimesBody = (
    <>
      <ConnectionsIntro />
      <RuntimeSummary data={system.data} loading={system.isLoading} />
      <div className="flex justify-end">
        <AddComputerButton onClick={() => setRemoteOpen(true)} />
      </div>
      {capability === "local_available" ? (
        <ThisMachineCard team={team} system={system.data} />
      ) : null}
      <RuntimesComputersList
        team={team}
        data={system.data}
        loading={system.isLoading}
      />
      <ConnectRemoteDialog
        team={team}
        open={remoteOpen}
        onOpenChange={setRemoteOpen}
      />
    </>
  );

  if (fixedSection) {
    return (
      <div className="flex flex-col gap-5">
        {fixedSection === "runtimes" ? runtimesBody : null}
        {fixedSection === "providers" ? (
          <ProviderKeysSection team={team} />
        ) : null}
      </div>
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

      <TabsContent value="runtimes" className="mt-0 flex flex-col gap-5">
        {runtimesBody}
      </TabsContent>

      <TabsContent value="providers" className="mt-0">
        <ProviderKeysSection team={team} />
      </TabsContent>
    </Tabs>
  );
}

function ConnectionsIntro() {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.85fr)] lg:items-start">
        <div className="max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
            <PlugZap className="size-3.5" />
            Daemon runtime layer
          </div>
          <h2 className="text-base font-semibold text-foreground">
            Connect computers that run the Agentik daemon.
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Each connected machine runs a daemon that registers with the engine,
            reports status, and executes agent tasks against local folders and
            repos.
          </p>
        </div>
        <div className="grid gap-2 text-sm">
          <RuntimeLayer
            icon={Server}
            title="Workspace daemon"
            description="Keeps the machine online, clones repos, and streams run events."
          />
          <RuntimeLayer
            icon={Terminal}
            title="Local execution"
            description="Hands tasks to CLIs and provider-backed agents on that host."
          />
        </div>
      </div>
    </section>
  );
}

function RuntimeLayer({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Terminal;
  title: string;
  description: string;
}) {
  return (
    <div className="grid grid-cols-[1.75rem_1fr] gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
      <span className="flex size-7 items-center justify-center rounded-md bg-surface text-foreground shadow-xs">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
    </div>
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
    <div className="grid gap-3 md:grid-cols-2">
      <SummaryCard
        label="Daemon connector"
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
