"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommandBlock } from "./command-block";
import {
  buildAgentikSetupCommand,
  buildDockerDaemonCommand,
  buildInstallScriptCommand,
  DEFAULT_APP_URL,
} from "./constants";
import { useRotateDaemonToken, useDaemonToken } from "@/features/settings/tabs/daemon-token-api";
import type { SystemInfo } from "./types";

export function ConnectRemoteDialog({
  team,
  open,
  onOpenChange,
}: {
  team: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const token = useDaemonToken(team);
  const rotate = useRotateDaemonToken(team);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const initialCount = useRef(0);

  const system = useQuery({
    queryKey: qk.settings.system(team),
    queryFn: ({ signal }) => apiFetch<SystemInfo>("/system", { team, signal }),
    enabled: open,
    refetchInterval: open ? 3000 : false,
  });

  useEffect(() => {
    if (!open) return;
    initialCount.current = system.data?.daemons.length ?? 0;
    setFreshToken(null);
  }, [open]);

  useEffect(() => {
    if (!open || !system.data) return;
    const count = system.data.daemons.length;
    if (count > initialCount.current) {
      toast.success("Computer connected");
      onOpenChange(false);
    }
  }, [open, system.data?.daemons.length, onOpenChange, system.data]);

  const setupToken = freshToken;
  const installCmd = buildInstallScriptCommand(DEFAULT_APP_URL);
  const setupCmd = setupToken ? buildAgentikSetupCommand(setupToken) : null;
  const dockerCmd = setupToken ? buildDockerDaemonCommand(setupToken) : null;

  const generateToken = () =>
    rotate.mutate(undefined, {
      onSuccess: (res) => {
        setFreshToken(res.token);
        toast.success("Setup command ready — copy it now");
      },
      onError: (e) =>
        toast.error(
          e instanceof Error ? e.message : "Could not create setup command",
        ),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a computer</DialogTitle>
          <DialogDescription>
            Run these commands on a server, dev box, or any machine with a
            terminal. It will register with this workspace automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <CommandBlock label="1. Install the Agentik CLI" command={installCmd} />

          {setupCmd ? (
            <CommandBlock label="2. Connect the daemon" command={setupCmd} />
          ) : (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border px-3 py-3">
              <p className="text-xs leading-5 text-muted-foreground">
                Generate a one-time setup token, then run the connect command on
                the target machine.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={rotate.isPending}
                onClick={generateToken}
              >
                {rotate.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                Generate setup command
              </Button>
            </div>
          )}

          {setupCmd && (
            <Tabs defaultValue="cli" className="gap-2">
              <TabsList className="w-fit">
                <TabsTrigger value="cli">CLI</TabsTrigger>
                <TabsTrigger value="docker">Docker</TabsTrigger>
              </TabsList>
              <TabsContent value="cli" className="mt-0">
                <p className="text-xs text-muted-foreground">
                  The command above is all you need for a native install.
                </p>
              </TabsContent>
              <TabsContent value="docker" className="mt-0">
                {dockerCmd ? (
                  <CommandBlock
                    label="Containerized daemon"
                    command={dockerCmd}
                  />
                ) : null}
              </TabsContent>
            </Tabs>
          )}

          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span>Waiting for connection…</span>
            {token.data?.prefix ? (
              <span className="ml-auto font-mono">token {token.data.prefix}</span>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AddComputerButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button size="sm" onClick={onClick}>
      <Plus className="size-4" />
      Add a computer
    </Button>
  );
}
