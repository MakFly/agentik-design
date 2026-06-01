import type { Metadata } from "next";
import { Wrench, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Tools" };

export default async function ToolsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tools"
        description="Connect external integrations with least-privilege scopes and a first-class test flow."
        actions={
          <Button size="sm">
            <Plus className="size-4" /> Connect tool
          </Button>
        }
      />
      <EmptyState
        icon={Wrench}
        title="No tools connected"
        description="Connect GitHub, Slack, Stripe, databases, or any REST/webhook endpoint. Each connection declares scopes and can be test-probed before use."
        action={
          <Button>
            <Plus className="size-4" /> Browse the catalog
          </Button>
        }
      />
    </div>
  );
}
