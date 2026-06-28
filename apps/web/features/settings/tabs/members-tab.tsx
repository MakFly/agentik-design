"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessionStore } from "@/lib/stores/session.store";
import { useRbac } from "@/lib/auth/rbac";
import { type Role } from "@/config/permissions";
import {
  useInviteMember,
  useRemoveMember,
  useRevokeInvitation,
  useTeamInvitations,
  useTeamMembers,
  useUpdateMemberRole,
} from "@/features/configure/settings-api";
import { toastApiError, onMutationError } from "@/lib/api/toast-error";
import {
  SettingsSection,
  SettingsPanel,
} from "@/features/settings/components/settings-section";

const ROLES: Role[] = ["owner", "admin", "engineer", "operator", "viewer"];

export function MembersTab({ team }: { team: string }) {
  const session = useSessionStore((s) => s.session);
  const { can } = useRbac();
  const { data: membersData, isLoading: membersLoading } = useTeamMembers(team);
  const { data: invitesData, isLoading: invitesLoading } =
    useTeamInvitations(team);
  const updateRole = useUpdateMemberRole(team);
  const remove = useRemoveMember(team);
  const invite = useInviteMember(team);
  const revoke = useRevokeInvitation(team);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("viewer");
  const [lastAcceptUrl, setLastAcceptUrl] = useState<string | null>(null);

  const editable = can("settings:update");
  const isOwner = session?.role === "owner";

  async function sendInvite() {
    try {
      const res = await invite.mutateAsync({
        email: inviteEmail,
        role: inviteRole,
      });
      setLastAcceptUrl(res.acceptUrl);
      setInviteEmail("");
      toast.success("Invitation sent");
    } catch (e) {
      toastApiError(e, "Could not invite member");
    }
  }

  const inviteAction = editable ? (
    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-4" />
          Invite member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Role</Label>
            <Select
              value={inviteRole}
              onValueChange={(v) => setInviteRole(v as Role)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {lastAcceptUrl ? (
            <p className="text-xs break-all text-muted-foreground">
              Invite link: {lastAcceptUrl}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            disabled={invite.isPending || !inviteEmail}
            onClick={() => void sendInvite()}
          >
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : undefined;

  return (
    <SettingsSection
      title="Members"
      description="Invite and manage workspace access."
      action={inviteAction}
    >
      <div className="flex flex-col gap-3">
        <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Members
        </h3>
        <SettingsPanel className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                {editable ? <TableHead className="w-24" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {membersLoading ? (
                <TableRow>
                  <TableCell colSpan={editable ? 3 : 2}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ) : (
                membersData?.items.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {m.name || m.email}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.email}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {editable && m.userId !== session?.user.id ? (
                        <Select
                          value={m.role}
                          onValueChange={(role) => {
                            updateRole.mutate(
                              { userId: m.userId, role: role as Role },
                              {
                                onSuccess: () => toast.success("Role updated"),
                                onError: onMutationError("Could not update role"),
                              },
                            );
                          }}
                          disabled={
                            (!isOwner && m.role === "owner") ||
                            updateRole.isPending
                          }
                        >
                          <SelectTrigger className="h-8 w-32 capitalize">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.filter((r) => isOwner || r !== "owner").map(
                              (r) => (
                                <SelectItem
                                  key={r}
                                  value={r}
                                  className="capitalize"
                                >
                                  {r}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="muted" className="capitalize">
                          {m.role}
                        </Badge>
                      )}
                    </TableCell>
                    {editable ? (
                      <TableCell>
                        {m.userId !== session?.user.id ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            disabled={remove.isPending}
                            onClick={() => {
                              remove.mutate(m.userId, {
                                onSuccess: () => toast.success("Member removed"),
                                onError: onMutationError(
                                  "Could not remove member",
                                ),
                              });
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </SettingsPanel>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Pending invitations
        </h3>
        <SettingsPanel className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Expires</TableHead>
                {editable ? <TableHead className="w-24" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitesLoading ? (
                <TableRow>
                  <TableCell colSpan={editable ? 4 : 3}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ) : invitesData?.items.length ? (
                invitesData.items.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell className="capitalize">{inv.role}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </TableCell>
                    {editable ? (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={revoke.isPending}
                          onClick={() => {
                            revoke.mutate(inv.id, {
                              onSuccess: () =>
                                toast.success("Invitation revoked"),
                              onError: onMutationError(
                                "Could not revoke invitation",
                              ),
                            });
                          }}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={editable ? 4 : 3}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    No pending invitations
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </SettingsPanel>
      </div>
    </SettingsSection>
  );
}
