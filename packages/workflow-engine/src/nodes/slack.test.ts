import { afterEach, describe, expect, mock, test } from "bun:test";
import type { WorkflowNode } from "@agentik/workflow-schema";
import type { INodeExecutionData } from "../items";
import type { PerItemContext } from "../types";
import { slackNode } from "./slack";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function ctx(
  config: Extract<WorkflowNode["config"], { type: "slack" }>,
  json: Record<string, unknown>,
  cred: Record<string, string> | null,
): PerItemContext {
  const item: INodeExecutionData = { json };
  const node: WorkflowNode = { id: "s", type: "slack", position: { x: 0, y: 0 }, label: "Slack", config };
  return {
    node,
    input: [item],
    inputsByPort: { main: [item] },
    payload: {},
    nodeOutputs: {},
    nodeNames: {},
    runId: "run",
    resolveCredential: async () => cred,
    item,
    itemIndex: 0,
  };
}

describe("slack node", () => {
  test("posts a templated message with the resolved bot token", async () => {
    let captured: { url: string; auth?: string; body: { channel: string; text: string } } | null = null;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      captured = {
        url: String(url),
        auth: (init.headers as Record<string, string>).authorization,
        body: JSON.parse(String(init.body)),
      };
      return new Response(JSON.stringify({ ok: true, ts: "123.45", channel: "C1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const out = (await slackNode.executeItem!(
      ctx({ type: "slack", credentialId: "cred_1", channel: "#general", text: "Hi {{ $json.name }}" }, { name: "Ada" }, { token: "xoxb-test" }),
    )) as { ok: boolean; ts: string };

    expect(out.ok).toBe(true);
    expect(captured!.url).toContain("chat.postMessage");
    expect(captured!.auth).toBe("Bearer xoxb-test");
    expect(captured!.body.text).toBe("Hi Ada");
  });

  test("fails clearly when the credential is missing", async () => {
    await expect(
      slackNode.executeItem!(ctx({ type: "slack", credentialId: "x", channel: "#c", text: "hi" }, {}, null)),
    ).rejects.toThrow(/credential/i);
  });
});
