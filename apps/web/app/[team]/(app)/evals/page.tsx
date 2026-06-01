import type { Metadata } from "next";
import { FlaskConical, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Evals" };

export default async function EvalsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Evaluation Center"
        description="Prove an agent, prompt, or model is better — datasets, scorers, A/B compare, and regression gates."
        actions={
          <Button size="sm">
            <Plus className="size-4" /> New suite
          </Button>
        }
      />
      <EmptyState
        icon={FlaskConical}
        title="No eval suites yet"
        description="Build a dataset, add scorers (exact-match, LLM-judge, human), and compare versions side-by-side with significance and a regression list."
        action={
          <Button>
            <Plus className="size-4" /> Create a suite
          </Button>
        }
      />
    </div>
  );
}
