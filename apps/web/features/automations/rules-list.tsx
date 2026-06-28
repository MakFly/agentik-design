"use client";

import { useState } from "react";
import { ArrowRight, Pencil, Plus, Trash2, Workflow, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { useDeleteRule, useRules } from "./api";
import { RuleForm } from "./rule-form";
import type { Rule } from "./types";

export function RulesList({ team, agentId }: { team: string; agentId?: string }) {
  const rules = useRules(team, agentId ? { agentId } : {});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | undefined>(undefined);

  function openCreate() {
    setEditing(undefined);
    setFormOpen(true);
  }
  function openEdit(rule: Rule) {
    setEditing(rule);
    setFormOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">When a signal fires, run or orchestrate an agent.</p>
        <Button size="sm" className="min-h-[44px] sm:min-h-9" onClick={openCreate}>
          <Plus className="size-4" /> Rule
        </Button>
      </div>

      {rules.isError ? (
        <ErrorState error={rules.error} onRetry={() => rules.refetch()} />
      ) : rules.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      ) : rules.data?.length ? (
        <div className="flex flex-col gap-3">
          {rules.data.map((rule) => (
            <RuleCard key={rule.id} team={team} rule={rule} onEdit={() => openEdit(rule)} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Zap}
          title={agentId ? "No rules target this agent" : "No rules yet"}
          description="Add a rule to run an agent automatically when a signal fires."
          action={
            <Button onClick={openCreate} className="min-h-[44px]">
              <Plus className="size-4" /> New rule
            </Button>
          }
        />
      )}

      <RuleForm team={team} open={formOpen} onOpenChange={setFormOpen} rule={editing} defaultAgentId={agentId} />
    </div>
  );
}

function RuleCard({ team, rule, onEdit }: { team: string; rule: Rule; onEdit: () => void }) {
  const disabled = rule.status === "disabled";
  const signalLabel = rule.signalName ?? (rule.signalId ? "a signal" : "any signal");
  const agentLabel = rule.agentName ?? (rule.targetAgentId ? rule.targetAgentId : "—");
  const ActionIcon = rule.action.type === "orchestrate" ? Workflow : Zap;

  return (
    <Card className={disabled ? "opacity-70" : undefined}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{rule.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="rounded bg-surface-2 px-1.5 py-0.5">when {signalLabel}</span>
              <ArrowRight className="size-3.5" />
              <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5">
                <ActionIcon className="size-3" />
                {rule.action.type === "orchestrate" ? "orchestrate" : "run"} {agentLabel}
              </span>
            </div>
          </div>
          <Badge variant={disabled ? "outline" : "secondary"}>{disabled ? "Disabled" : "Active"}</Badge>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-8" onClick={onEdit}>
            <Pencil className="size-4" /> Edit
          </Button>
          <DeleteRuleButton team={team} rule={rule} />
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteRuleButton({ team, rule }: { team: string; rule: Rule }) {
  const remove = useDeleteRule(team);
  const [open, setOpen] = useState(false);

  async function confirm() {
    try {
      await remove.mutateAsync(rule.id);
      toast.success(`Deleted ${rule.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete rule");
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 text-muted-foreground sm:size-8"
        aria-label={`Delete ${rule.name}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{rule.name}”?</AlertDialogTitle>
          <AlertDialogDescription>This rule will stop firing. This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
