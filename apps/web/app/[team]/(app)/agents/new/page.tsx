import type { Metadata } from "next";
import { AgentBuilder } from "@/features/agent-builder/agent-builder";
import { buildDraftFromTemplate } from "@/features/agent-registry/agent-templates";

export const metadata: Metadata = { title: "New agent" };

export default async function NewAgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<{ template?: string; harness?: string }>;
}) {
  const { team } = await params;
  const { template, harness } = await searchParams;
  const draft = buildDraftFromTemplate(template, harness);

  return (
    <AgentBuilder team={team} mode="create" initialIdentity={draft?.identity} initialConfig={draft?.config} />
  );
}
