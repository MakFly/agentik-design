"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { User, Settings, Plug, Link2, type LucideIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ConnectedAccountsSection } from "@/features/settings/tabs/connected-accounts-section";
import { ConnectionsTab } from "@/features/settings/tabs/connections-tab";
import { ProvidersTab } from "@/features/settings/tabs/providers-tab";
import { ProfileTab } from "@/features/settings/tabs/profile-tab";
import { PreferencesTab } from "@/features/settings/tabs/preferences-tab";
import { TokensTab } from "@/features/settings/tabs/tokens-tab";
import { WorkspaceTab } from "@/features/settings/tabs/workspace-tab";
import { MembersTab } from "@/features/settings/tabs/members-tab";

type TabDef = { value: string; label: string; icon: LucideIcon };

const TABS: TabDef[] = [
  { value: "account", label: "Account", icon: User },
  { value: "workspace", label: "Workspace", icon: Settings },
  { value: "providers", label: "Providers", icon: Plug },
  { value: "connections", label: "Connections", icon: Link2 },
];

const VALID_TABS = new Set(TABS.map((t) => t.value));
const TAB_QUERY_KEY = "tab";
const DEFAULT_TAB = "account";

export function TeamSettingsPage({ team }: { team: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

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
      className="w-full gap-6 p-4 md:p-6"
    >
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and this workspace.
        </p>
      </header>

      <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabsList variant="line" className="w-max">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon className="size-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="account" className="flex flex-col gap-6">
        <ProfileTab team={team} />
        <PreferencesTab />
        <TokensTab team={team} />
      </TabsContent>

      <TabsContent value="workspace" className="flex flex-col gap-6">
        <WorkspaceTab team={team} />
        <MembersTab team={team} />
      </TabsContent>

      <TabsContent value="providers" className="flex flex-col gap-6">
        <ProvidersTab team={team} />
        <ConnectedAccountsSection team={team} />
      </TabsContent>

      <TabsContent value="connections" className="flex flex-col gap-6">
        <ConnectionsTab team={team} />
      </TabsContent>
    </Tabs>
  );
}
