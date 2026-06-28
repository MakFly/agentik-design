"use client";

import Link from "next/link";
import { Info, RadioTower, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import {
  useChannels,
  useChannelBindings,
  useCreateBinding,
  useDeleteBinding,
  useUpdateBinding,
} from "@/features/channels/api";
import type { GroupPolicy } from "@/features/automations/types";
import { SectionHeading } from "./section-kit";

const POLICIES: GroupPolicy[] = ["open", "allowlist", "off"];

export function ReactivitySection({
  team,
  mode,
  agentId,
}: {
  team: string;
  mode: "create" | "edit";
  agentId?: string;
}) {
  if (mode === "create" || !agentId) {
    return (
      <div className="flex max-w-2xl flex-col gap-5">
        <SectionHeading
          title="Reactivity"
          hint="Decide where this agent listens and whether it acts on every message or only on mention."
        />
        <div className="flex items-start gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          Save the agent first to wire channel reactivity. Channel bindings live on a published agent.
        </div>
      </div>
    );
  }

  return <ReactivityEditor team={team} agentId={agentId} />;
}

function ReactivityEditor({ team, agentId }: { team: string; agentId: string }) {
  const channels = useChannels(team);

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <SectionHeading
        title="Reactivity"
        hint="Bind this agent to channels and control its listen-vs-act behavior per channel."
      />

      {channels.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      ) : channels.data?.items.length ? (
        <ul className="flex flex-col gap-3">
          {channels.data.items.map((channel) => (
            <ChannelBindingRow
              key={channel.id}
              team={team}
              channelId={channel.id}
              channelLabel={channel.label}
              agentId={agentId}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={RadioTower}
          title="No channels"
          description="Connect a channel (e.g. Telegram) first, then bind this agent to it."
        />
      )}

      <div className="border-t border-border pt-4">
        <Button asChild variant="outline" className="min-h-[44px]">
          <Link href={`/${team}/automations?agent=${agentId}`}>
            <Zap className="size-4" /> Create an automation that runs this agent
          </Link>
        </Button>
      </div>
    </div>
  );
}

function ChannelBindingRow({
  team,
  channelId,
  channelLabel,
  agentId,
}: {
  team: string;
  channelId: string;
  channelLabel: string;
  agentId: string;
}) {
  const bindings = useChannelBindings(team, channelId);
  const create = useCreateBinding(team, channelId);
  const update = useUpdateBinding(team);
  const remove = useDeleteBinding(team);
  const binding = bindings.data?.find((b) => b.agentId === agentId);

  async function enable() {
    try {
      await create.mutateAsync({ agentId, groupPolicy: "open", requireMention: true });
      toast.success(`Bound to ${channelLabel}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not bind channel");
    }
  }

  async function patch(patch: { groupPolicy?: GroupPolicy; requireMention?: boolean }) {
    if (!binding) return;
    try {
      await update.mutateAsync({ bindingId: binding.id, patch });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update binding");
    }
  }

  async function unbind() {
    if (!binding) return;
    try {
      await remove.mutateAsync(binding.id);
      toast.success(`Unbound from ${channelLabel}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove binding");
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{channelLabel}</span>
        {binding ? (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={unbind} disabled={remove.isPending}>
            Unbind
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-8" onClick={enable} disabled={create.isPending}>
            Enable on this channel
          </Button>
        )}
      </div>

      {binding ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Listen policy</Label>
            <Select value={binding.groupPolicy} onValueChange={(v) => patch({ groupPolicy: v as GroupPolicy })}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLICIES.map((p) => (
                  <SelectItem key={p} value={p} className="capitalize">
                    {p === "off" ? "Off (don't listen)" : p === "open" ? "Open (all messages)" : "Allowlist only"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex min-h-[44px] items-center justify-between gap-2 self-end rounded-md border border-border px-3">
            <span className="text-xs text-muted-foreground">Require mention</span>
            <Switch checked={binding.requireMention} onCheckedChange={(v) => patch({ requireMention: v })} aria-label="Require mention" />
          </label>
        </div>
      ) : null}
    </li>
  );
}
