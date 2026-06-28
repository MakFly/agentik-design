"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import type { AgentConfig, AgentId } from "@/types/domain";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { KeyValueList } from "@/components/shared/key-value-list";
import { findModel } from "@/config/models";
import { formatMoney } from "@/lib/format";
import { useCreateAgent, usePublishAgent } from "./api";
import type { DraftIdentity } from "./validation";

/**
 * Atomic publish (docs/01 §4.2). One mutation, one spinner, one toast:
 *  - create mode → POST /agents with the full config; the server create+publishes.
 *  - edit mode   → PATCH identity, then POST /agents/:id/publish (server-atomic).
 * Nothing is committed on a thrown error and the local draft is only cleared on
 * success, so a failed publish leaves the draft intact in localStorage.
 */
export function PublishDialog({
  open,
  onOpenChange,
  team,
  mode,
  agentId,
  identity,
  config,
  disabled,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  team: string;
  mode: "create" | "edit";
  agentId?: string;
  identity: DraftIdentity;
  config: AgentConfig;
  disabled: boolean;
  /** Called after a successful publish — e.g. to clear the saved local draft. */
  onPublished?: () => void;
}) {
  const router = useRouter();
  const [changelog, setChangelog] = useState(mode === "create" ? "Initial version" : "Update");
  const createAgent = useCreateAgent(team);
  const publishAgent = usePublishAgent(team);
  const busy = createAgent.isPending || publishAgent.isPending;
  const meta = findModel(config.model.model);

  async function publish() {
    try {
      if (mode === "create") {
        // Single call: create + publish atomically (server publishes when config is sent).
        const created = await createAgent.mutateAsync({
          name: identity.name,
          role: identity.role,
          goal: identity.goal,
          emoji: identity.emoji,
          color: identity.color,
          description: identity.description,
          isOrchestrator: identity.isOrchestrator,
          config,
        });
        toast.success(`Published ${identity.name}${created.version ? ` v${created.version}` : ""}`);
        onPublished?.();
        onOpenChange(false);
        router.push(`/${team}/agents/${created.id}`);
        return;
      }

      // Edit: identity patch + new immutable version in ONE server transaction.
      const id = agentId as AgentId;
      const result = await publishAgent.mutateAsync({
        agentId: id,
        config,
        changelog,
        identity: {
          name: identity.name,
          role: identity.role,
          goal: identity.goal,
          emoji: identity.emoji,
          color: identity.color,
          description: identity.description,
          isOrchestrator: identity.isOrchestrator,
        },
      });
      toast.success(`Published ${identity.name} v${result.version}`);
      onPublished?.();
      onOpenChange(false);
      router.push(`/${team}/agents/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Publish failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish agent</DialogTitle>
          <DialogDescription>Creates an immutable version. Running agents keep their current version until you switch them.</DialogDescription>
        </DialogHeader>

        <KeyValueList
          items={[
            { label: "Name", value: identity.name || "—" },
            { label: "Model", value: meta?.label ?? config.model.model },
            { label: "Tools", value: config.tools.length },
            { label: "Cost cap", value: formatMoney(config.limits.maxCostPerRun) },
          ]}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="changelog">Changelog</Label>
          <Textarea id="changelog" value={changelog} onChange={(e) => setChangelog(e.target.value)} className="min-h-20 text-sm" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={publish} disabled={disabled || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
