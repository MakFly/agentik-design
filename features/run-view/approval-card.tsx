"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { ApprovalState } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyValueList } from "@/components/shared/key-value-list";
import { RbacGate, useRbac } from "@/lib/auth/rbac";

/**
 * Inline human-approval gate (docs/01 §4.4). Shown only to users with run:approve;
 * others see "awaiting approval by <role>". Dispatches through the control channel.
 */
export function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: ApprovalState;
  onDecide?: (decision: "approve" | "reject", reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const { can } = useRbac();
  const decided = approval.status !== "pending";

  return (
    <div className="rounded-lg border border-info/40 bg-info-surface/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-info">
        <ShieldCheck className="size-4" aria-hidden="true" />
        Human approval required
      </div>
      <p className="mt-1 text-sm text-foreground">{approval.message}</p>

      <KeyValueList
        className="mt-3"
        items={Object.entries(approval.context).map(([k, v]) => ({ label: k, value: String(v) }))}
      />

      {decided ? (
        <p className="mt-3 text-sm font-medium capitalize">
          {approval.status} {approval.reason ? <span className="font-normal text-muted-foreground">— {approval.reason}</span> : null}
        </p>
      ) : (
        <RbacGate
          permission="run:approve"
          fallback={
            <p className="mt-3 text-sm text-muted-foreground">
              Awaiting approval by <span className="font-medium capitalize">{approval.approverRole}</span>.
            </p>
          }
        >
          <div className="mt-3 space-y-2">
            <Label htmlFor="approval-reason" className="text-xs">
              Reason (optional)
            </Label>
            <Input
              id="approval-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Add context for the audit log…"
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={!can("run:approve")} onClick={() => onDecide?.("approve", reason)}>
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDecide?.("reject", reason)}>
                Reject
              </Button>
            </div>
          </div>
        </RbacGate>
      )}
    </div>
  );
}
