import type { NodeExecutor } from "../types";
import { evaluate, type Scope } from "../expressions";

/**
 * Decision node — conditional branch (n8n's IF/Switch). It passes its input
 * straight through (so downstream nodes see the same data) and uses `route()`
 * to pick the active branch: the first branch whose expression is truthy, else
 * the default. Outgoing edges carry `sourceHandle = branch label`.
 */
export const decisionNode: NodeExecutor = {
  type: "decision",
  async execute({ input }) {
    return input;
  },
  async route({ node, input, payload, outputs }) {
    if (node.config.type !== "decision") return "default";
    const scope: Scope = { input, payload, outputs };
    for (const branch of node.config.branches) {
      try {
        if (evaluate(branch.expression, scope)) return branch.label;
      } catch {
        // A branch whose expression throws is treated as not-matched.
      }
    }
    return node.config.default;
  },
};
