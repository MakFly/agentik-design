"use client";

import { useRouter } from "next/navigation";
import { BotIcon, CheckIcon, PlusIcon } from "lucide-react";
import { useAgents } from "@/features/agent-registry/api";
import { useAgentSelection } from "@/components/runtime/agent-selection";
import { AgentAvatar, isApiRuntime, useDaemonOnline } from "@/features/agent-chat/agent-presence";
import { hrefFor } from "@/config/nav";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgentItem {
  id: string;
  name: string;
  role?: string;
  goal?: string;
  runtimeKind?: string;
  model?: string;
}

/**
 * Assistant-native agent roster (OpenClaw model). Unlike the platform builder, clicking an
 * agent SELECTS it for the chat and stays on the assistant surface — it never routes into
 * /platform/* (which needs a runtime/daemon and breaks the personal-assistant flow). New
 * agents are created conversationally by the assistant itself (agent_create tool).
 */
export function AssistantAgentsScreen({ team }: { team: string }) {
  const router = useRouter();
  const { data, isLoading, isError } = useAgents(team);
  const { selectedAgentId, setSelectedAgentId } = useAgentSelection();
  const online = useDaemonOnline(team);
  const items = (data?.items ?? []) as AgentItem[];

  const openInChat = (id: string) => {
    setSelectedAgentId(id);
    router.push(hrefFor(team, "chat"));
  };

  const createAgent = () => {
    router.push(hrefFor(team, "chat"));
    // The composer (base.tsx) listens for this and sends the conversational create prompt.
    window.dispatchEvent(
      new CustomEvent("agentik:send-prompt", {
        detail:
          "Aide-moi à créer un nouvel agent : demande-moi le nom, le but et les instructions " +
          "s'ils manquent, puis crée-le.",
      }),
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BotIcon className="size-5 text-muted-foreground" aria-hidden />
            Agents
          </h1>
          <p className="text-muted-foreground text-sm">
            Choisis avec qui discuter. Clique un agent pour l’ouvrir dans le chat — la gestion
            avancée reste dans la plateforme.
          </p>
        </div>
        <Button size="sm" onClick={createAgent}>
          <PlusIcon className="size-4" aria-hidden /> Nouvel agent
        </Button>
      </header>

      {isLoading && <p className="text-muted-foreground text-sm">Chargement…</p>}
      {isError && <p className="text-destructive text-sm">Impossible de charger les agents.</p>}
      {!isLoading && !isError && items.length === 0 && (
        <div className="border-border/60 text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          Aucun agent. Clique « Nouvel agent » pour en créer un en discutant.
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((a) => {
          const selected = a.id === selectedAgentId;
          const ready = isApiRuntime(a.runtimeKind) || online;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => openInChat(a.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors",
                  selected
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/60 bg-card hover:bg-accent/50",
                )}
              >
                <AgentAvatar name={a.name} online={ready} />
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2 font-medium">
                    {a.name}
                    {selected && (
                      <span className="text-primary inline-flex items-center gap-1 text-xs">
                        <CheckIcon className="size-3" aria-hidden /> actif
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground truncate text-sm">
                    {a.role || "agent"}
                    {a.goal ? ` · ${a.goal}` : ""}
                  </span>
                </div>
                <span className="text-muted-foreground ml-auto shrink-0 text-right text-xs">
                  <span className="bg-muted rounded-full px-2 py-0.5">{a.model || a.runtimeKind}</span>
                  <span className="mt-1 block">{ready ? "ready" : "no runtime"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
