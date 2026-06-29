import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

/**
 * RESERVED (Phase 4): bridge between an assistant-ui chat UI and the async agent-task
 * backend. The standalone /chat route was removed; kept to be embedded into the
 * Project/Agent console (consumer: components/runtime/agent-task-runtime-provider).
 * Each turn: ensure a chat session for the selected agent, enqueue the message as a
 * real task, wait for the daemon to produce the assistant turn, then stream it back
 * in the UIMessage protocol. Single-shot: only the latest user message is sent to the
 * agent (no server-side multi-turn context yet — matches the runtime's capabilities).
 */

export const maxDuration = 120;

const ENGINE = process.env.API_URL ?? "http://localhost:8787";
const POLL_MS = 1500;
const TIMEOUT_MS = 110_000;

interface ChatMessageView { role: string; content: string; taskId: string | null }

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; parts?: Array<{ type?: string; text?: string }> };
    if (m?.role !== "user") continue;
    return (m.parts ?? []).filter((p) => p?.type === "text").map((p) => p.text ?? "").join("").trim();
  }
  return "";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function textStream(messages: unknown, text: string) {
  const stream = createUIMessageStream({
    originalMessages: messages as never,
    execute: async ({ writer }) => {
      // Protocol: open a text part before deltas, then close it.
      writer.write({ type: "text-start", id: "reply" });
      writer.write({ type: "text-delta", id: "reply", delta: text });
      writer.write({ type: "text-end", id: "reply" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

export async function POST(req: Request) {
  const { messages } = await req.json();
  const agentId = req.headers.get("x-agent-id") ?? "";
  const team = req.headers.get("x-team") ?? "";
  const text = lastUserText(messages);

  if (!agentId) return textStream(messages, "Pick an agent (top-left) to start chatting.");
  if (!text) return textStream(messages, "Please type a message.");

  // Forward auth to the engine: dev resolves the team from x-team; cookies carry the
  // real session in non-dev. Keep both so it works in either mode.
  const headers: Record<string, string> = { "content-type": "application/json", "x-team": team };
  const cookie = req.headers.get("cookie");
  if (cookie) headers["cookie"] = cookie;
  const efetch = (path: string, init?: RequestInit) => fetch(`${ENGINE}/api/v1${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });

  try {
    const sessionRes = await efetch("/chat/sessions", { method: "POST", body: JSON.stringify({ agentId }) });
    if (!sessionRes.ok) return textStream(messages, "Could not start a session for this agent.");
    const { id: sessionId } = (await sessionRes.json()) as { id: string };

    const msgRes = await efetch(`/chat/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify({ content: text }) });
    if (!msgRes.ok) return textStream(messages, "Could not send the message.");
    const { taskId } = (await msgRes.json()) as { taskId: string };

    // Poll until the assistant turn for this task lands, or the run fails.
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const sRes = await efetch(`/chat/sessions/${sessionId}`);
      if (sRes.ok) {
        const detail = (await sRes.json()) as { messages: ChatMessageView[] };
        const hit = [...detail.messages].reverse().find((m) => m.taskId === taskId && m.role === "assistant");
        if (hit) return textStream(messages, hit.content);
      }
      const rRes = await efetch(`/runs/${taskId}`);
      if (rRes.ok) {
        const run = (await rRes.json()) as { status?: string; error?: string };
        if (run.status === "failed" || run.status === "cancelled") {
          return textStream(messages, `⚠ The agent run ${run.status}. ${run.error ?? ""}`.trim());
        }
      }
    }
    return textStream(messages, "Timed out waiting for the agent. Is a daemon connected for this runtime?");
  } catch {
    return textStream(messages, "Could not reach the engine.");
  }
}
