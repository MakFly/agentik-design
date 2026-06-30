"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useAgentSelection } from "./agent-selection";
import { apiFetch } from "@/lib/api/client";

/**
 * Real assistant-ui runtime pointing at /api/agent-chat — a bridge that runs each turn
 * in-process on the engine and streams the result back. Engine-persisted: an assistant-ui
 * thread maps 1:1 to an engine chat session. The session id travels in the `x-session-id`
 * header so the engine threads multi-turn context; a brand-new thread lazily creates its
 * session on first send (then the URL routes to /chat/c/<id>). The selected agent comes
 * from `AgentSelectionProvider` (shared with the sidebar switcher).
 */

/** Session id baked into the current /chat/c/<id> URL, or null on the bare chat route. */
function sessionIdFromPath(pathname: string): string | null {
  const m = pathname.match(/\/chat\/c\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; parts?: Array<{ type?: string; text?: string }> };
    if (m?.role !== "user") continue;
    return (m.parts ?? []).filter((p) => p?.type === "text").map((p) => p.text ?? "").join("").trim();
  }
  return "";
}

/**
 * Resolve the engine session for the turn: reuse the one in the URL, otherwise create a
 * fresh session for the selected agent, route to it, and notify the history rail. Runs
 * inside the transport's async request-prep so the id is ready before the request flies.
 */
async function ensureChatSession(
  team: string,
  agentId: string | null,
  messages: unknown,
): Promise<string> {
  const fromUrl =
    typeof window !== "undefined" ? sessionIdFromPath(window.location.pathname) : null;
  if (fromUrl) return fromUrl;
  if (!agentId) return "";
  const title = lastUserText(messages).slice(0, 80);
  const created = await apiFetch<{ id: string }>("/chat/sessions", {
    method: "POST",
    team,
    body: { agentId, ...(title ? { title } : {}) },
  });
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", `/${team}/chat/c/${created.id}`);
    window.dispatchEvent(
      new CustomEvent("agentik:chat-session-created", { detail: { sessionId: created.id } }),
    );
  }
  return created.id;
}

export function AgentTaskRuntimeProvider({
  team,
  children,
}: {
  team: string;
  children: React.ReactNode;
}) {
  const { selectedAgentId } = useAgentSelection();

  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/agent-chat",
      prepareSendMessagesRequest: async (options) => {
        const o = options as {
          id: string;
          messages: unknown;
          trigger?: unknown;
          messageId?: unknown;
          requestMetadata?: unknown;
          body?: Record<string, unknown>;
        };
        const sessionId = await ensureChatSession(team, selectedAgentId, o.messages);
        // Per-thread /model override (set by the composer's `/model` slash). Read at send
        // time so a switch mid-conversation takes effect on the next turn. Engine ignores
        // it when it targets a different provider than the agent's.
        const model =
          typeof window !== "undefined" ? window.localStorage.getItem("assistant:model") : null;
        // Mirror the transport's default body (it uses ours verbatim when present)
        // and attach the routing headers, incl. the resolved engine session id.
        return {
          headers: {
            "x-agent-id": selectedAgentId ?? "",
            "x-team": team,
            "x-session-id": sessionId,
          },
          body: {
            ...(o.body ?? {}),
            id: o.id,
            messages: o.messages,
            trigger: o.trigger,
            messageId: o.messageId,
            metadata: o.requestMetadata,
            ...(model ? { model } : {}),
          },
        };
      },
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
  );
}
