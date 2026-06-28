"use client";

import { toast } from "sonner";
import { Loader2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { onMutationError } from "@/lib/api/toast-error";
import {
  useDaemonToken,
  useRotateDaemonToken,
  useRevokeDaemonToken,
} from "@/features/settings/tabs/daemon-token-api";
import {
  SettingsSection,
  SettingsPanel,
} from "@/features/settings/components/settings-section";

export function TokensTab({ team }: { team: string }) {
  const { data, isLoading } = useDaemonToken(team);
  const rotate = useRotateDaemonToken(team);
  const revoke = useRevokeDaemonToken(team);

  return (
    <SettingsSection
      title="Tokens"
      description="Personal daemon token for connecting local machines."
    >
      <SettingsPanel className="p-5">
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : data?.hasToken ? (
            <>
              <p className="text-sm text-muted-foreground">
                Active token{" "}
                <span className="font-mono text-foreground">{data.prefix}…</span>
                {data.issuedAt
                  ? ` · issued ${new Date(data.issuedAt).toLocaleDateString()}`
                  : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rotate.isPending}
                  onClick={() => {
                    rotate.mutate(undefined, {
                      onSuccess: (res) => {
                        void navigator.clipboard?.writeText(res.token);
                        toast.success("Token rotated and copied");
                      },
                      onError: onMutationError("Could not rotate token"),
                    });
                  }}
                >
                  {rotate.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  Rotate &amp; copy
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={revoke.isPending}
                  onClick={() => {
                    revoke.mutate(undefined, {
                      onSuccess: () => toast.success("Token revoked"),
                      onError: onMutationError("Could not revoke token"),
                    });
                  }}
                >
                  Revoke
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                No daemon token yet. Generate one to connect a machine from
                Runtimes.
              </p>
              <Button
                size="sm"
                className="w-fit"
                disabled={rotate.isPending}
                onClick={() => {
                  rotate.mutate(undefined, {
                    onSuccess: (res) => {
                      void navigator.clipboard?.writeText(res.token);
                      toast.success("Token created and copied");
                    },
                    onError: onMutationError("Could not generate token"),
                  });
                }}
              >
                {rotate.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Generate token
              </Button>
            </>
          )}
        </div>
      </SettingsPanel>
    </SettingsSection>
  );
}
