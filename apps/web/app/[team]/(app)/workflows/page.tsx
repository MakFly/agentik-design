import type { Metadata } from "next";
import Link from "next/link";
import { Workflow, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Workflows" };

export default async function WorkflowsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workflows"
        description="Compose agents, tools, decisions, and human approvals into runnable graphs."
        actions={
          <Button asChild size="sm">
            <Link href={`/${team}/workflows/new`}>
              <Plus className="size-4" /> New workflow
            </Link>
          </Button>
        }
      />
      <EmptyState
        icon={Workflow}
        title="No workflows yet"
        description="The visual canvas lets you wire agent, tool, decision, and approval nodes with typed connections, then test the whole graph live."
        action={
          <Button asChild>
            <Link href={`/${team}/workflows/new`}>
              <Plus className="size-4" /> Create a workflow
            </Link>
          </Button>
        }
      />
    </div>
  );
}
