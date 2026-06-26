"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Server, WifiOff } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import {
  AddComputerButton,
  ConnectRemoteDialog,
} from "./connect-remote-dialog";
import { ThisMachineCard } from "./this-machine-card";
import { useLocalDaemonCapability } from "./use-local-daemon-capability";
import { RuntimesComputersList } from "./runtimes-computers-list";
import type { SystemInfo } from "./types";

function useSystem(team: string) {
  return useQuery({
    queryKey: qk.settings.system(team),
    queryFn: ({ signal }) => apiFetch<SystemInfo>("/system", { team, signal }),
    refetchInterval: 5000,
  });
}

export function RuntimesPageContent({ team }: { team: string }) {
  const system = useSystem(team);
  const { capability } = useLocalDaemonCapability();
  const [remoteOpen, setRemoteOpen] = useState(false);

  if (system.isError) {
    return (
      <EmptyState
        icon={WifiOff}
        title="Engine unreachable"
        description="Couldn't load runtime system info. Check the engine process and the app API proxy."
      />
    );
  }

  const showThisMachine = capability === "local_available";
  const hasDaemons = (system.data?.daemons.length ?? 0) > 0;
  const loading = system.isLoading && !system.data;

  return (
    <>
      <PageHeader
        title="Runtimes"
        description="Connect computers that run the Agentik daemon."
        actions={<AddComputerButton onClick={() => setRemoteOpen(true)} />}
      />

      <div className="mt-6 flex flex-col gap-5">
        {loading ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : !hasDaemons ? (
          <EmptyState
            icon={Server}
            title="No runtimes yet"
            description="Install the daemon on this computer or connect a remote machine with a terminal."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {capability === "local_available" && (
                  <Button
                    size="sm"
                    onClick={() => {
                      document
                        .getElementById("this-machine-card")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    <Plus className="size-4" />
                    Install on this machine
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={
                    capability === "local_available" ? "outline" : "default"
                  }
                  onClick={() => setRemoteOpen(true)}
                >
                  <Plus className="size-4" />
                  Add a computer
                </Button>
              </div>
            }
          />
        ) : null}

        {showThisMachine ? (
          <div id="this-machine-card">
            <ThisMachineCard team={team} system={system.data} />
          </div>
        ) : null}

        {hasDaemons ? (
          <RuntimesComputersList data={system.data} loading={loading} />
        ) : null}
      </div>

      <ConnectRemoteDialog
        team={team}
        open={remoteOpen}
        onOpenChange={setRemoteOpen}
      />
    </>
  );
}
