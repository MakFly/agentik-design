import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ReviewInbox } from "@/features/review-inbox/review-inbox";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Review Inbox"
        description="Approve or reject the memory & skill changes proposed from finished runs. Approved changes are injected into the agent's next run."
      />
      <ReviewInbox team={team} />
    </div>
  );
}
