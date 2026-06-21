import { type NodeExecutor, exprScope } from "../types";
import { resolveTemplate } from "../expressions";

export interface AgentNodeOptions {
  apiKey?: string;
  /** OpenAI-compatible base URL. */
  baseUrl?: string;
  defaultModel?: string;
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: unknown;
  error?: { message?: string };
};

/**
 * Agent node — calls an OpenAI-compatible chat model, once per input item (n8n
 * AI-node behaviour). The node carries its own model/instructions/prompt; the
 * prompt is `{{ }}`-templated against the current item (`$json`). Built as a
 * factory because it needs an API key, which the engine package stays agnostic
 * of — the worker injects it from env.
 */
export function createAgentNode(opts: AgentNodeOptions = {}): NodeExecutor {
  const baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
  const defaultModel = opts.defaultModel ?? "gpt-4.1-mini";

  return {
    type: "agent",
    async executeItem(ctx) {
      const { node, item, itemIndex, signal } = ctx;
      if (node.config.type !== "agent") throw new Error("agent node: config mismatch");
      if (!opts.apiKey) throw new Error("Agent node requires an API key on the engine (OPENAI_API_KEY).");
      if (signal?.aborted) throw new Error("Run cancelled before the agent call.");

      const cfg = node.config;
      const scope = exprScope(ctx, itemIndex);
      const model = cfg.model ?? defaultModel;
      const instructions = cfg.instructions ?? "You are a helpful assistant.";
      const userContent = cfg.prompt
        ? String(resolveTemplate(cfg.prompt, scope))
        : JSON.stringify(item.json);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
      signal?.addEventListener("abort", () => ctrl.abort());

      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: instructions },
              { role: "user", content: userContent },
            ],
          }),
          signal: ctrl.signal,
        });
        const data = (await res.json()) as ChatResponse;
        if (!res.ok) {
          throw new Error(`LLM error ${res.status}: ${data?.error?.message ?? "unknown"}`);
        }
        return {
          text: data.choices?.[0]?.message?.content ?? "",
          model,
          usage: data.usage ?? null,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
