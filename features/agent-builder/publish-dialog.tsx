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
 * Publish flow: create the agent (if new) then publish an immutable version with
 * a changelog (docs/01 §4.2). Shows a resolved-config summary before committing.
 */
export function PublishDialog({
  open,
  onOpenChange,
  team,
  identity,
  config,
  disabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  team: string;
  identity: DraftIdentity;
  config: AgentConfig;
  disabled: boolean;
}) {
  const router = useRouter();
  const [changelog, setChangelog] = useState("Initial version");
  const createAgent = useCreateAgent(team);
  const publishAgent = usePublishAgent(team);
  const busy = createAgent.isPending || publishAgent.isPending;
  const meta = findModel(config.model.model);

  async function publish() {
    try {
      const created = await createAgent.mutateAsync({ name: identity.name, role: identity.role, goal: identity.goal });
      const result = await publishAgent.mutateAsync({ agentId: created.id as AgentId, config, changelog });
      toast.success(`Published ${identity.name} v${result.version}`);
      onOpenChange(false);
      router.push(`/${team}/agents/${created.id}`);
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
