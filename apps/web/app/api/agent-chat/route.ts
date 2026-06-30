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

interface ChatMessageView { role: string; content: string; taskId: string | null }

type EngineFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Parse a `text/event-stream` body into `{ event, data }` records. */
async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      yield { event, data: data.join("\n") };
    }
  }
}

/** Final assistant turn for the run (or latest), for the non-streaming fallback path. */
async function fetchFinalAssistant(
  efetch: EngineFetch,
  sessionId: string,
  runId: string,
): Promise<string> {
  try {
    const res = await efetch(`/chat/sessions/${sessionId}`);
    if (!res.ok) return "";
    const detail = (await res.json()) as { messages: ChatMessageView[] };
    const byTask = [...detail.messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.taskId === runId);
    const latest = [...detail.messages].reverse().find((m) => m.role === "assistant");
    return (byTask ?? latest)?.content ?? "";
  } catch {
    return "";
  }
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

  // A stable session id (one per assistant-ui thread) gives multi-turn context: the
  // engine appends prior turns to the prompt. Absent → a fresh session is created.
  const incomingSessionId = req.headers.get("x-session-id") ?? "";

  if (!agentId) return textStream(messages, "Pick an agent (top-left) to start chatting.");
  if (!text) return textStream(messages, "Please type a message.");

  // Forward auth to the engine: dev resolves the team from x-team; cookies carry the
  // real session in non-dev. Keep both so it works in either mode.
  const headers: Record<string, string> = { "content-type": "application/json", "x-team": team };
  const cookie = req.headers.get("cookie");
  if (cookie) headers["cookie"] = cookie;
  const efetch = (path: string, init?: RequestInit) => fetch(`${ENGINE}/api/v1${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });

  try {
    let sessionId = incomingSessionId;
    if (!sessionId) {
      const sessionRes = await efetch("/chat/sessions", { method: "POST", body: JSON.stringify({ agentId }) });
      if (!sessionRes.ok) return textStream(messages, "Could not start a session for this agent.");
      sessionId = ((await sessionRes.json()) as { id: string }).id;
    }

    // Interactive fast-path: run the turn in-process on the engine and pipe its
    // assistant-ui UIMessage stream straight through. A 409 (`no_api_runtime`: a
    // CLI/daemon runtime or a builtin skill) falls through to the queue path below.
    const gw = await efetch(`/chat/sessions/${sessionId}/stream`, {
      method: "POST",
      body: JSON.stringify({ content: text }),
      signal: req.signal,
    });
    if (gw.ok && gw.body) {
      const headers = new Headers(gw.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(gw.body, { status: 200, headers });
    }

    const msgRes = await efetch(`/chat/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify({ content: text }) });
    if (!msgRes.ok) return textStream(messages, "Could not send the message.");
    const { taskId } = (await msgRes.json()) as { taskId: string };

    // Stream the run's deltas as assistant-ui parts: `thinking` → reasoning block,
    // `text` → the reply. Falls back to the final persisted turn when nothing streamed
    // (built-in skill / instant reply / a run with no live deltas).
    const stream = createUIMessageStream({
      originalMessages: messages as never,
      execute: async ({ writer }) => {
        let reasoningOpen = false;
        let textOpen = false;
        let sawText = false;
        let errorMsg = "";
        const openText = () => {
          if (reasoningOpen) {
            writer.write({ type: "reasoning-end", id: "reason" });
            reasoningOpen = false;
          }
          if (!textOpen) {
            writer.write({ type: "text-start", id: "reply" });
            textOpen = true;
          }
        };

        try {
          const res = await efetch(`/runs/${taskId}/messages/live`, { signal: req.signal });
          if (res.ok && res.body) {
            for await (const ev of parseSSE(res.body)) {
              if (ev.event === "delta") {
                const d = JSON.parse(ev.data) as { type: string; delta: string };
                if (d.type === "thinking") {
                  if (!reasoningOpen) {
                    writer.write({ type: "reasoning-start", id: "reason" });
                    reasoningOpen = true;
                  }
                  writer.write({ type: "reasoning-delta", id: "reason", delta: d.delta });
                } else if (d.type === "text") {
                  openText();
                  writer.write({ type: "text-delta", id: "reply", delta: d.delta });
                  sawText = true;
                }
              } else if (ev.event === "error") {
                errorMsg = (JSON.parse(ev.data) as { message?: string }).message ?? "The agent run failed.";
                break;
              } else if (ev.event === "done") {
                break;
              }
            }
          }
        } catch {
          // Network/abort — close out cleanly below, then fall back if needed.
        }

        if (errorMsg && !sawText) {
          openText();
          writer.write({ type: "text-delta", id: "reply", delta: `⚠ ${errorMsg}` });
          sawText = true;
        }
        if (!sawText) {
          const finalText = await fetchFinalAssistant(efetch, sessionId, taskId);
          openText();
          writer.write({
            type: "text-delta",
            id: "reply",
            delta: finalText || "Timed out waiting for the agent. Is a daemon connected for this runtime?",
          });
        }
        if (reasoningOpen) writer.write({ type: "reasoning-end", id: "reason" });
        if (textOpen) writer.write({ type: "text-end", id: "reply" });
      },
    });
    return createUIMessageStreamResponse({ stream });
  } catch {
    return textStream(messages, "Could not reach the engine.");
  }
}
