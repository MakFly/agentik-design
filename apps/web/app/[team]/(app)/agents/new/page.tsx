import type { Metadata } from "next";
import { AgentBuilder } from "@/features/agent-builder/agent-builder";
import { ArchetypeGallery } from "@/features/agent-builder/archetype-gallery";
import { buildDraftFromTemplate } from "@/features/agent-registry/agent-templates";

export const metadata: Metadata = { title: "New agent" };

export default async function NewAgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<{ template?: string; harness?: string; blank?: string }>;
}) {
  const { team } = await params;
  const { template, harness, blank } = await searchParams;

  // Step 1: no archetype chosen yet → show the foundry gallery.
  if (!template && !blank) {
    return <ArchetypeGallery team={team} />;
  }

  // Step 2: archetype (or blank) chosen → operator config console.
  const draft = buildDraftFromTemplate(template, harness);
  return (
    <AgentBuilder
      team={team}
      mode="create"
      initialIdentity={draft?.identity}
      initialConfig={draft?.config}
    />
  );
}
