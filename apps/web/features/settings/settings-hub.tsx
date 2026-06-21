"use client";

import { useQueryState } from "nuqs";
import { ShieldX } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRbac } from "@/lib/auth/rbac";
import type { Permission } from "@/config/permissions";
import { ApiKeysTab } from "./tabs/api-keys-tab";
import { RuntimesTab } from "./tabs/runtimes-tab";
import { ProvidersTab } from "./tabs/providers-tab";
import { TeamTab } from "./tabs/team-tab";
import { RolesTab } from "./tabs/roles-tab";
import { BillingTab } from "./tabs/billing-tab";
import { SecurityTab } from "./tabs/security-tab";
import { AuditTab } from "./tabs/audit-tab";

interface TabDef {
  value: string;
  label: string;
  /** extra permission required beyond settings:read (page-level) */
  permission?: Permission;
  render: (team: string) => React.ReactNode;
}

const TABS: TabDef[] = [
  { value: "runtimes", label: "Runtimes", render: (t) => <RuntimesTab team={t} /> },
  { value: "api-keys", label: "API keys", render: (t) => <ApiKeysTab team={t} /> },
  { value: "providers", label: "Providers", render: (t) => <ProvidersTab team={t} /> },
  { value: "team", label: "Team", render: (t) => <TeamTab team={t} /> },
  { value: "roles", label: "Roles", render: (t) => <RolesTab team={t} /> },
  { value: "billing", label: "Billing", permission: "billing:read", render: (t) => <BillingTab team={t} /> },
  { value: "security", label: "Security", render: (t) => <SecurityTab team={t} /> },
  { value: "audit", label: "Audit log", permission: "audit:read", render: (t) => <AuditTab team={t} /> },
];

function NoAccess() {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
        <ShieldX className="size-5" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">You don&apos;t have access to this section</p>
      <p className="max-w-xs text-sm text-muted-foreground">Ask a workspace owner or admin to grant the required permission.</p>
    </div>
  );
}

export function SettingsHub({ team }: { team: string }) {
  const { can } = useRbac();
  const [tab, setTab] = useQueryState("tab", { defaultValue: "api-keys" });
  const active = TABS.some((t) => t.value === tab) ? tab : "api-keys";

  return (
    <Tabs value={active} onValueChange={setTab} className="gap-6">
      {/* Horizontal scroll keeps all tabs reachable on narrow viewports without wrapping. */}
      <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabsList className="w-max min-w-full justify-start">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="flex-none px-3">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="mt-0">
          {t.permission && !can(t.permission) ? <NoAccess /> : t.render(team)}
        </TabsContent>
      ))}
    </Tabs>
  );
}
