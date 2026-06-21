import { afterEach, describe, expect, mock, test } from "bun:test";
import type { WorkflowNode } from "@agentik/workflow-schema";
import type { INodeExecutionData } from "../items";
import type { PerItemContext } from "../types";
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

function ctx(node: WorkflowNode, json: Record<string, unknown> = {}): PerItemContext {
  const item: INodeExecutionData = { json };
  return {
    node,
    input: [item],
    inputsByPort: { main: [item] },
    payload: {},
    nodeOutputs: {},
    nodeNames: { a: "Agent" },
    runId: "run",
    resolveCredential: async () => null,
    item,
    itemIndex: 0,
  };
}

describe("agent node", () => {
  test("calls the chat API once per item with the templated prompt", async () => {
    let captured: { url: string; body: unknown } | null = null;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init.body)) };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "the answer is 42" } }], usage: { total_tokens: 5 } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const exec = createAgentNode({ apiKey: "sk-test", defaultModel: "gpt-4.1-mini" });
    const out = (await exec.executeItem!(ctx(agentNode({ prompt: "Double of {{ $json.n }}" }), { n: 21 }))) as {
      text: string;
      model: string;
    };

    expect(out.text).toBe("the answer is 42");
    expect(out.model).toBe("gpt-4.1-mini");
    expect(captured!.url).toContain("/chat/completions");
    const body = captured!.body as { messages: Array<{ role: string; content: string }> };
    expect(body.messages.at(-1)?.content).toBe("Double of 21");
  });

  test("fails clearly without an API key", async () => {
    const exec = createAgentNode({});
    await expect(exec.executeItem!(ctx(agentNode()))).rejects.toThrow(/API key/i);
  });
});
