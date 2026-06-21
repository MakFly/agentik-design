import { type NodeExecutor, exprScope } from "../types";
import { evaluate } from "../expressions";
import type { NodeOutput } from "../items";

/**
 * Decision / Switch node — routes EACH item to an output port (n8n's IF/Switch
 * model). For every item, the first branch whose expression is truthy wins; if
 * none match, the item goes to the `default` port. Output ports are the branch
 * labels (+ default); only edges leaving a port that received items run their
 * downstream. Item linking is preserved via `pairedItem`.
 */
export const decisionNode: NodeExecutor = {
  type: "decision",
  async execute(ctx) {
    if (ctx.node.config.type !== "decision") return { main: ctx.input };
    const cfg = ctx.node.config;
    const out: NodeOutput = {};

    ctx.input.forEach((item, i) => {
      const scope = exprScope(ctx, i);
      let handle = cfg.default;
      for (const branch of cfg.branches) {
        try {
          if (evaluate(branch.expression, scope)) {
            handle = branch.label;
            break;
          }
        } catch {
          // A branch whose expression throws is treated as not-matched.
        }
      }
      (out[handle] ??= []).push({ ...item, pairedItem: { item: i } });
    });

    return out;
  },
};
