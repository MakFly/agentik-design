import { afterEach, describe, expect, mock, test } from "bun:test";
import type { WorkflowNode } from "@agentik/workflow-schema";
import { createAgentNode } from "./agent";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function agentNode(config: Partial<Extract<WorkflowNode["config"], { type: "agent" }>> = {}): WorkflowNode {
  return {
    id: "a",
    type: "agent",
    position: { x: 0, y: 0 },
    label: "Agent",
    config: { type: "agent", inputMap: {}, timeoutMs: 30_000, ...config },
  };
}

describe("agent node", () => {
  test("calls the chat API with the templated prompt and returns text", async () => {
    let captured: { url: string; body: unknown } | null = null;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init.body)) };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "the answer is 42" } }], usage: { total_tokens: 5 } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const exec = createAgentNode({ apiKey: "sk-test", defaultModel: "gpt-4.1-mini" });
    const out = (await exec.execute({
      node: agentNode({ prompt: "Double of {{ input.n }}" }),
      input: { n: 21 },
      payload: {},
      outputs: {},
    })) as { text: string; model: string };

    expect(out.text).toBe("the answer is 42");
    expect(out.model).toBe("gpt-4.1-mini");
    expect(captured!.url).toContain("/chat/completions");
    const body = captured!.body as { messages: Array<{ role: string; content: string }> };
    expect(body.messages.at(-1)?.content).toBe("Double of 21");
  });

  test("fails clearly without an API key", async () => {
    const exec = createAgentNode({});
    await expect(
      exec.execute({ node: agentNode(), input: {}, payload: {}, outputs: {} }),
    ).rejects.toThrow(/API key/i);
  });
});
