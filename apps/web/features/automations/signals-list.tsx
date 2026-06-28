"use client";

import { useState } from "react";
import { Plus, Radio, Send, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { StatusBadge } from "@/components/shared/status-badge";
import { useDeleteSignal, useDispatchSignal, useSignals } from "./api";
import { SignalForm } from "./signal-form";
import type { Signal } from "./types";

export function SignalsList({ team }: { team: string }) {
  const signals = useSignals(team);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Signal | undefined>(undefined);

  function openCreate() {
    setEditing(undefined);
    setFormOpen(true);
  }
  function openEdit(signal: Signal) {
    setEditing(signal);
    setFormOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">External triggers that fire your rules.</p>
        <Button size="sm" className="min-h-[44px] sm:min-h-9" onClick={openCreate}>
          <Plus className="size-4" /> Signal
        </Button>
      </div>

      {signals.isError ? (
        <ErrorState error={signals.error} onRetry={() => signals.refetch()} />
      ) : signals.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      ) : signals.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {signals.data.map((signal) => (
            <SignalCard key={signal.id} team={team} signal={signal} onEdit={() => openEdit(signal)} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Radio}
          title="No signals yet"
          description="Create a signal, then add a rule that runs an agent when it fires."
          action={
            <Button onClick={openCreate} className="min-h-[44px]">
              <Plus className="size-4" /> New signal
            </Button>
          }
        />
      )}

      <SignalForm team={team} open={formOpen} onOpenChange={setFormOpen} signal={editing} />
    </div>
  );
}

function SignalCard({ team, signal, onEdit }: { team: string; signal: Signal; onEdit: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{signal.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="capitalize">{signal.kind}</Badge>
              {signal.source ? <Badge variant="secondary">{signal.source}</Badge> : null}
            </div>
          </div>
          <StatusBadge status={signal.status === "disabled" ? "disabled" : "healthy"} size="sm" />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <DispatchDialog team={team} signal={signal} />
          <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-8" onClick={onEdit}>
            <Pencil className="size-4" /> Edit
          </Button>
          <DeleteSignalButton team={team} signal={signal} />
        </div>
      </CardContent>
    </Card>
  );
}

function DispatchDialog({ team, signal }: { team: string; signal: Signal }) {
  const dispatch = useDispatchSignal(team);
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    let parsed: unknown = {};
    if (payload.trim()) {
      try {
        parsed = JSON.parse(payload);
      } catch {
        setError("Payload must be valid JSON.");
        return;
      }
    }
    try {
      await dispatch.mutateAsync({ id: signal.id, payload: parsed });
      toast.success("Signal dispatched — check Deliveries");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dispatch failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-8" onClick={() => setOpen(true)}>
        <Send className="size-4" /> Test
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dispatch “{signal.name}”</DialogTitle>
          <DialogDescription>Send a test payload through this signal to fire matching rules.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dispatch-payload">Payload (JSON)</Label>
          <Textarea
            id="dispatch-payload"
            value={payload}
            onChange={(e) => {
              setPayload(e.target.value);
              setError(null);
            }}
            className="min-h-32 font-mono text-xs"
          />
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={dispatch.isPending}>
            Cancel
          </Button>
          <Button onClick={run} disabled={dispatch.isPending}>
            {dispatch.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSignalButton({ team, signal }: { team: string; signal: Signal }) {
  const remove = useDeleteSignal(team);
  const [open, setOpen] = useState(false);

  async function confirm() {
    try {
      await remove.mutateAsync(signal.id);
      toast.success(`Deleted ${signal.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete signal");
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 text-muted-foreground sm:size-8"
        aria-label={`Delete ${signal.name}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{signal.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Rules referencing this signal will stop firing. This cannot be undone.
          </AlertDialogDescription>
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
