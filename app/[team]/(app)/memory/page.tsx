import type { Metadata } from "next";
import { Database, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Memory" };

export default async function MemoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Memory & Knowledge"
        description="Vector stores and RAG sources with transparent retrieval, citations, and retention policy."
        actions={
          <Button size="sm">
            <Plus className="size-4" /> New store
          </Button>
        }
      />
      <EmptyState
        icon={Database}
        title="No memory stores yet"
        description="Create a store, ingest documents or live sources, and inspect exactly which chunks an agent retrieves — and how they're cited."
        action={
          <Button>
            <Plus className="size-4" /> Create a store
          </Button>
        }
      />
    </div>
  );
}
