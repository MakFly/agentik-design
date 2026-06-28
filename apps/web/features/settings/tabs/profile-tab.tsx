"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useSessionStore } from "@/lib/stores/session.store";
import { useUpdateProfile } from "@/features/configure/settings-api";
import { toastApiError } from "@/lib/api/toast-error";
import {
  SettingsSection,
  SettingsPanel,
  SettingsSaveBar,
} from "@/features/settings/components/settings-section";
import { refreshSession } from "@/features/settings/lib/refresh-session";

export function ProfileTab({ team }: { team: string }) {
  const session = useSessionStore((s) => s.session);
  const update = useUpdateProfile();
  const [name, setName] = useState(session?.user.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (session?.user.name) setName(session.user.name);
  }, [session?.user.name]);

  const nameDirty = !!session && name.trim() !== session.user.name;

  async function saveName() {
    try {
      await update.mutateAsync({ name });
      await refreshSession(team);
      toast.success("Profile updated");
    } catch (e) {
      toastApiError(e, "Could not update profile");
    }
  }

  async function savePassword() {
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    try {
      await update.mutateAsync({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed");
    } catch (e) {
      toastApiError(e, "Could not change password");
    }
  }

  if (!session) return null;

  return (
    <SettingsSection
      title="Profile"
      description="Your account details for this workspace."
    >
      <SettingsPanel className="p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={session.user.email} readOnly />
          </div>
          <div className="grid gap-2">
            <Label>Role</Label>
            <Badge variant="muted" className="w-fit capitalize">
              {session.role}
            </Badge>
          </div>
        </div>
      </SettingsPanel>

      <SettingsPanel className="p-5">
        <div className="mb-4 space-y-1">
          <h3 className="text-sm font-medium text-foreground">Password</h3>
          <p className="text-xs text-muted-foreground">
            Use at least 8 characters.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="current-password">Current password</Label>
            <PasswordInput
              id="current-password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="mt-4 w-fit"
          disabled={
            update.isPending ||
            !currentPassword ||
            newPassword.length < 8 ||
            !confirmPassword
          }
          onClick={() => void savePassword()}
        >
          {update.isPending && currentPassword ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          Change password
        </Button>
      </SettingsPanel>

      <SettingsSaveBar
        show={nameDirty}
        pending={update.isPending}
        onSave={() => void saveName()}
        onReset={() => setName(session.user.name)}
        label="Save name"
      />
    </SettingsSection>
  );
}
