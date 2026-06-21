import { type NodeExecutor, exprScope } from "../types";
import { resolveTemplate } from "../expressions";

type SlackResponse = { ok: boolean; ts?: string; channel?: string; error?: string };

/**
 * Slack — post a message via chat.postMessage. Runs once per item; channel/text
 * are `{{ }}`-templated. The bot token comes from a `slackApi` credential
 * resolved (and decrypted) by the host, so no secret lives in the graph.
 */
export const slackNode: NodeExecutor = {
  type: "slack",
  async executeItem(ctx) {
    if (ctx.node.config.type !== "slack") throw new Error("slack node: config mismatch");
    const cfg = ctx.node.config;
    const cred = await ctx.resolveCredential(cfg.credentialId);
    if (!cred?.token) throw new Error("Slack node: no slackApi credential / token.");

    const scope = exprScope(ctx, ctx.itemIndex);
    const channel = String(resolveTemplate(cfg.channel, scope));
    const text = String(resolveTemplate(cfg.text, scope));

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cred.token}` },
      body: JSON.stringify({ channel, text }),
      signal: ctx.signal,
    });
    const data = (await res.json()) as SlackResponse;
    if (!data.ok) throw new Error(`Slack error: ${data.error ?? "unknown"}`);
    return { ok: true, ts: data.ts, channel: data.channel };
  },
};
