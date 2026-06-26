"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import {
  User,
  SlidersHorizontal,
  Bell,
  Key,
  Settings,
  Users,
  Plug,
  Loader2,
  Copy,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { Separator } from "@/components/ui/separator";
import { useSessionStore } from "@/lib/stores/session.store";
import {
  usePreferencesStore,
  type SubmitMode,
  type ThemePreference,
} from "@/lib/stores/preferences.store";
import { ProviderKeysSection } from "@/features/settings/tabs/provider-keys-section";
import { ProvidersTab } from "@/features/settings/tabs/providers-tab";
import {
  useDaemonToken,
  useRotateDaemonToken,
  useRevokeDaemonToken,
} from "@/features/settings/tabs/daemon-token-api";
import { authApi } from "@/lib/auth/api";
import { ROLE_PERMISSIONS, type Permission, type Role } from "@/config/permissions";
import type { Session, TeamId, UserId } from "@/types/domain";
import {
  useInviteMember,
  useRemoveMember,
  useRevokeInvitation,
  useTeamInvitations,
  useTeamMembers,
  useUpdateMemberRole,
  useUpdateNotificationPreferences,
  useUpdateProfile,
  useUpdateUiPreferences,
  useUpdateWorkspace,
  useWorkspaceSettings,
  type NotificationPreferences,
} from "./settings-api";
import { toastApiError, onMutationError } from "@/lib/api/toast-error";
import { toast } from "sonner";
import { useRbac } from "@/lib/auth/rbac";
import { Skeleton } from "@/components/ui/skeleton";

const ACCOUNT_TABS = [
  { value: "profile", label: "Profile", icon: User },
  { value: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "tokens", label: "Tokens", icon: Key },
] as const;

const WORKSPACE_TABS = [
  { value: "workspace", label: "General", icon: Settings },
  { value: "providers", label: "Providers", icon: Plug },
  { value: "members", label: "Members", icon: Users },
] as const;

const VALID_TABS = new Set<string>([
  ...ACCOUNT_TABS.map((t) => t.value),
  ...WORKSPACE_TABS.map((t) => t.value),
]);

const TAB_QUERY_KEY = "tab";
const DEFAULT_TAB = "profile";

const ROLES: Role[] = ["owner", "admin", "engineer", "operator", "viewer"];

const DEFAULT_NOTIFICATIONS: Required<NotificationPreferences> = {
  emailRunComplete: false,
  emailRunFailed: true,
  emailApprovalNeeded: true,
  emailInvitations: true,
  inAppRuns: true,
  inAppApprovals: true,
  inAppMentions: true,
};

export function TeamSettingsPage({ team }: { team: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useSessionStore((s) => s.session);
  const workspaceName = session?.team.name ?? "Workspace";

  const tabFromUrl = searchParams.get(TAB_QUERY_KEY);
  const activeTab =
    tabFromUrl && VALID_TABS.has(tabFromUrl) ? tabFromUrl : DEFAULT_TAB;

  const handleTabChange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(TAB_QUERY_KEY, next);
      router.replace(`/${team}/settings?${params.toString()}`);
    },
    [router, searchParams, team],
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      orientation="vertical"
      className="flex min-h-[calc(100svh-3.5rem)] flex-1 flex-col gap-0 overflow-y-auto md:flex-row md:overflow-hidden"
    >
      <div className="shrink-0 border-b p-3 md:w-52 md:overflow-y-auto md:border-r md:border-b-0 md:p-4">
        <h1 className="mb-4 px-2 text-sm font-semibold">Settings</h1>
        <TabsList variant="line" className="w-full flex-col items-stretch">
          <span className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
            My account
          </span>
          {ACCOUNT_TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon className="size-4" />
              {label}
            </TabsTrigger>
          ))}

          <span className="truncate px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground">
            {workspaceName}
          </span>
          {WORKSPACE_TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon className="size-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div className="min-w-0 flex-1 md:overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
          <TabsContent value="profile">
            <ProfileTab team={team} />
          </TabsContent>
          <TabsContent value="preferences">
            <PreferencesTab />
          </TabsContent>
          <TabsContent value="notifications">
            <NotificationsTab />
          </TabsContent>
          <TabsContent value="tokens">
            <TokensTab team={team} />
          </TabsContent>
          <TabsContent value="workspace">
            <WorkspaceTab team={team} />
          </TabsContent>
          <TabsContent value="providers">
            <div className="flex flex-col gap-6">
              <ProviderKeysSection team={team} />
              <ProvidersTab team={team} />
            </div>
          </TabsContent>
          <TabsContent value="members">
            <MembersTab team={team} />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

async function refreshSession(team: string) {
  const me = await authApi.me();
  if (!me) return;
  const active =
    me.orgs.find((o) => o.slug === team) ??
    me.orgs.find((o) => o.teamId === me.activeOrgId) ??
    me.orgs[0];
  if (!active) return;
  const role = active.role as Role;
  const perms = ROLE_PERMISSIONS[role];
  const session: Session = {
    user: {
      id: me.user.userId as UserId,
      name: me.user.name || me.user.email,
      email: me.user.email,
    },
    team: { id: active.teamId as TeamId, slug: active.slug, name: active.name },
    role,
    permissions: perms === "*" ? "*" : ([...perms] as Permission[]),
    teams: me.orgs.map((o) => ({
      id: o.teamId as TeamId,
      slug: o.slug,
      name: o.name,
    })),
    onboardingCompleted: active.onboardingCompleted,
  };
  useSessionStore.getState().setSession(session);
}

function ProfileTab({ team }: { team: string }) {
  const session = useSessionStore((s) => s.session);
  const update = useUpdateProfile();
  const [name, setName] = useState(session?.user.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (session?.user.name) setName(session.user.name);
  }, [session?.user.name]);

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
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Account</CardTitle>
          <CardDescription>Update your display name and password.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
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
          <Button
            size="sm"
            className="w-fit"
            disabled={update.isPending || !name.trim()}
            onClick={() => void saveName()}
          >
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save name
          </Button>

          <Separator />

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
            className="w-fit"
            disabled={
              update.isPending ||
              !currentPassword ||
              newPassword.length < 8 ||
              !confirmPassword
            }
            onClick={() => void savePassword()}
          >
            Change password
          </Button>
        </CardContent>
      </Card>
    </SettingsSection>
  );
}

function PreferencesTab() {
  const { setTheme: setNextTheme } = useTheme();
  const reduceMotion = usePreferencesStore((s) => s.reduceMotion);
  const submitMode = usePreferencesStore((s) => s.submitMode);
  const theme = usePreferencesStore((s) => s.theme);
  const setReduceMotion = usePreferencesStore((s) => s.setReduceMotion);
  const setSubmitMode = usePreferencesStore((s) => s.setSubmitMode);
  const setThemePref = usePreferencesStore((s) => s.setTheme);
  const update = useUpdateUiPreferences();

  async function persist(patch: {
    reduceMotion?: boolean;
    submitMode?: SubmitMode;
    theme?: ThemePreference;
  }) {
    try {
      await update.mutateAsync(patch);
    } catch (e) {
      toastApiError(e, "Could not sync preferences");
    }
  }

  return (
    <SettingsSection
      title="Preferences"
      description="Interface defaults synced to your account."
    >
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Reduce motion</p>
              <p className="text-xs text-muted-foreground">
                Minimize animations across the app.
              </p>
            </div>
            <Switch
              checked={reduceMotion}
              onCheckedChange={(v) => {
                setReduceMotion(v);
                void persist({ reduceMotion: v });
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Composer submit</p>
              <p className="text-xs text-muted-foreground">
                {submitMode === "enter"
                  ? "Enter sends, Shift+Enter newline"
                  : "Ctrl+Enter sends, Enter newline"}
              </p>
            </div>
            <Switch
              checked={submitMode === "ctrlEnter"}
              onCheckedChange={(on) => {
                const mode = (on ? "ctrlEnter" : "enter") satisfies SubmitMode;
                setSubmitMode(mode);
                void persist({ submitMode: mode });
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Theme</p>
              <p className="text-xs text-muted-foreground">
                Light, dark, or follow system.
              </p>
            </div>
            <Select
              value={theme}
              onValueChange={(v) => {
                const t = v as ThemePreference;
                setThemePref(t);
                setNextTheme(t === "system" ? "system" : t);
                void persist({ theme: t });
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </SettingsSection>
  );
}

function NotificationsTab() {
  const [prefs, setPrefs] = useState<Required<NotificationPreferences>>(
    DEFAULT_NOTIFICATIONS,
  );
  const [loaded, setLoaded] = useState(false);
  const update = useUpdateNotificationPreferences();

  useEffect(() => {
    void authApi.me().then((me) => {
      if (me?.user.notificationPreferences) {
        setPrefs({ ...DEFAULT_NOTIFICATIONS, ...me.user.notificationPreferences });
      }
      setLoaded(true);
    });
  }, []);

  async function toggle(key: keyof NotificationPreferences, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      await update.mutateAsync({ [key]: value });
    } catch (e) {
      setPrefs(prefs);
      toastApiError(e, "Could not save notification preference");
    }
  }

  const rows: { key: keyof NotificationPreferences; label: string; hint: string }[] = [
    { key: "emailRunComplete", label: "Run completed", hint: "Email when a run succeeds." },
    { key: "emailRunFailed", label: "Run failed", hint: "Email when a run fails." },
    { key: "emailApprovalNeeded", label: "Approval needed", hint: "Email when a run waits for approval." },
    { key: "emailInvitations", label: "Workspace invites", hint: "Email when you're invited to a workspace." },
    { key: "inAppRuns", label: "Run activity", hint: "In-app toasts for run status changes." },
    { key: "inAppApprovals", label: "Approvals", hint: "In-app alerts for pending approvals." },
    { key: "inAppMentions", label: "Mentions", hint: "In-app when you're mentioned on a task." },
  ];

  return (
    <SettingsSection
      title="Notifications"
      description="Choose how Agentik reaches you."
    >
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          {!loaded ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            rows.map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between gap-4"
              >
                <div>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.hint}</p>
                </div>
                <Switch
                  checked={prefs[row.key]}
                  onCheckedChange={(v) => void toggle(row.key, v)}
                  disabled={update.isPending}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </SettingsSection>
  );
}

function WorkspaceTab({ team }: { team: string }) {
  const router = useRouter();
  const { can } = useRbac();
  const { data, isLoading } = useWorkspaceSettings(team);
  const update = useUpdateWorkspace(team);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  useEffect(() => {
    if (data) {
      setName(data.name);
      setSlug(data.slug);
    }
  }, [data]);

  async function save() {
    try {
      const res = await update.mutateAsync({ name, slug });
      await refreshSession(team);
      toast.success("Workspace updated");
      if (res.slug !== team) router.replace(`/${res.slug}/settings?tab=workspace`);
    } catch (e) {
      toastApiError(e, "Could not update workspace");
    }
  }

  const editable = can("settings:update");

  return (
    <SettingsSection
      title="General"
      description="Workspace identity and URL slug."
    >
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          {isLoading ? (
            <>
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="ws-name">Name</Label>
                <Input
                  id="ws-name"
                  value={name}
                  readOnly={!editable}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ws-slug">Slug</Label>
                <Input
                  id="ws-slug"
                  value={slug}
                  readOnly={!editable}
                  className="font-mono"
                  onChange={(e) =>
                    setSlug(
                      e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                    )
                  }
                />
              </div>
            </>
          )}
          {editable ? (
            <div className="sm:col-span-2">
              <Button
                size="sm"
                disabled={update.isPending || !name.trim() || !slug}
                onClick={() => void save()}
              >
                {update.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Save workspace
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              You need settings:update to edit workspace details.
            </p>
          )}
        </CardContent>
      </Card>
    </SettingsSection>
  );
}

function TokensTab({ team }: { team: string }) {
  const { data, isLoading } = useDaemonToken(team);
  const rotate = useRotateDaemonToken(team);
  const revoke = useRevokeDaemonToken(team);

  return (
    <SettingsSection
      title="Tokens"
      description="Personal daemon token for connecting local machines."
    >
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          {isLoading ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : data?.hasToken ? (
            <>
              <p className="text-sm text-muted-foreground">
                Active token{" "}
                <span className="font-mono text-foreground">
                  {data.prefix}…
                </span>
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
                  Rotate & copy
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
        </CardContent>
      </Card>
    </SettingsSection>
  );
}

function MembersTab({ team }: { team: string }) {
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

  return (
    <SettingsSection
      title="Members"
      description="Invite and manage workspace access."
    >
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
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
                      {ROLES.filter((r) => isOwner || r !== "owner").map(
                        (r) => (
                          <SelectItem key={r} value={r} className="capitalize">
                            {r}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {lastAcceptUrl ? (
                  <p className="text-xs text-muted-foreground break-all">
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
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Members</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
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
                            {ROLES.filter(
                              (r) => isOwner || r !== "owner",
                            ).map((r) => (
                              <SelectItem key={r} value={r} className="capitalize">
                                {r}
                              </SelectItem>
                            ))}
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
                                onError: onMutationError("Could not remove member"),
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pending invitations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
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
                              onSuccess: () => toast.success("Invitation revoked"),
                              onError: onMutationError("Could not revoke invitation"),
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
        </CardContent>
      </Card>
    </SettingsSection>
  );
}
