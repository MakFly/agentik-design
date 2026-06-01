"use client";

import { useState } from "react";
import { UserPlus, Loader2, Trash2, Mail } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { RbacGate, useRbac } from "@/lib/auth/rbac";
import { formatRelativeTime } from "@/lib/format";
import { ROLES, type Role } from "@/config/permissions";
import { useMembers, useInviteMember, useUpdateMemberRole, useRemoveMember } from "../api";
import type { Member } from "../types";
import { ConfirmDialog } from "./confirm-dialog";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function TeamTab({ team }: { team: string }) {
  const { data, isLoading, isError, error, refetch } = useMembers(team);

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">Default role: {data?.defaultRole ?? "—"}</Badge>
          <Badge variant={data?.ssoEnabled ? "secondary" : "outline"}>SSO {data?.ssoEnabled ? "on" : "off"}</Badge>
          <Badge variant={data?.scimEnabled ? "secondary" : "outline"}>SCIM {data?.scimEnabled ? "on" : "off"}</Badge>
        </div>
        <RbacGate permission="settings:update">
          <InviteDialog team={team} defaultRole={data?.defaultRole ?? "viewer"} />
        </RbacGate>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {data?.items.map((m) => (
            <MemberRow key={m.id} team={team} member={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberRow({ team, member }: { team: string; member: Member }) {
  const { can } = useRbac();
  const updateRole = useUpdateMemberRole(team);
  const remove = useRemoveMember(team);
  const editable = can("settings:update") && member.role !== "owner";

  async function changeRole(role: Role) {
    try {
      await updateRole.mutateAsync({ id: member.id, role });
      toast.success(`${member.name} is now ${role}`);
    } catch {
      toast.error("Could not change role");
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium text-muted-foreground">
          {initials(member.name)}
        </span>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">{member.name}</span>
            {member.status === "invited" && (
              <Badge variant="outline" className="gap-1 text-[11px]">
                <Mail className="size-3" /> invited
              </Badge>
            )}
          </div>
          <span className="truncate text-xs text-muted-foreground">
            {member.email} · {member.lastActiveAt ? `active ${formatRelativeTime(member.lastActiveAt)}` : "pending"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 self-start sm:self-auto">
        {editable ? (
          <Select value={member.role} onValueChange={(v) => changeRole(v as Role)} disabled={updateRole.isPending}>
            <SelectTrigger className="h-8 w-32 text-xs capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="secondary" className="capitalize">
            {member.role}
          </Badge>
        )}

        {editable && (
          <ConfirmDialog
            title="Remove member"
            description={`${member.name} will lose access to ${team} immediately.`}
            confirmLabel="Remove"
            onConfirm={async () => {
              await remove.mutateAsync(member.id);
              toast.success(`Removed ${member.name}`);
            }}
            trigger={
              <Button variant="ghost" size="icon" className="size-8 text-danger hover:text-danger" aria-label={`Remove ${member.name}`}>
                <Trash2 className="size-4" />
              </Button>
            }
          />
        )}
      </div>
    </li>
  );
}

function InviteDialog({ team, defaultRole }: { team: string; defaultRole: Role }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(defaultRole);
  const invite = useInviteMember(team);

  async function submit() {
    try {
      await invite.mutateAsync({ email: email.trim(), role });
      toast.success(`Invitation sent to ${email}`);
      setOpen(false);
      setEmail("");
      setRole(defaultRole);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send invite");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" /> Invite
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>They&apos;ll receive an email to join {team}.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoFocus />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger id="invite-role" className="capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.filter((r) => r !== "owner").map((r) => (
                <SelectItem key={r} value={r} className="capitalize">
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={invite.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!email.trim() || invite.isPending}>
            {invite.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
