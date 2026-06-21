import vm from "node:vm";
import { type NodeContext, type NodeExecutor, exprScope } from "../types";
import { type INodeExecutionData, toItems } from "../items";
import { expressionGlobals } from "../expressions";

/**
 * Code node — runs author-supplied JavaScript natively (the whole reason the
 * engine is on Bun). Mirrors n8n's two modes:
 *   - "all"  (default): runs once; sees every item via `$input.all()` / `items`.
 *   - "each":           runs once per item; `$json` is the current item.
 * A top-level `return` yields the output: an object/array is normalized into
 * items, so `return { x: 1 }` and `return [{ json: { x: 1 } }]` both work.
 * The full n8n variable set is in scope ($json, $input, $(), $node, $now, …).
 *
 * SECURITY: node:vm is NOT a sandbox against malicious code. Safe for a single
 * tenant with a trusted author. Swap to isolated-vm before multi-tenant. (Phase 5)
 */
function buildSandbox(ctx: NodeContext, itemIndex: number): Record<string, unknown> {
  const items = ctx.input;
  return {
    ...expressionGlobals(exprScope(ctx, itemIndex)),
    items,
    $items: () => items,
    console: { log: (...args: unknown[]) => console.log("[code]", ...args) },
  };
}

export const codeNode: NodeExecutor = {
  type: "code",
  async execute(ctx) {
    if (ctx.node.config.type !== "code") throw new Error("code node: config mismatch");
    const cfg = ctx.node.config;
    const wrapped = `(async () => {\n${cfg.source}\n})()`;
    const run = (sandbox: Record<string, unknown>) =>
      vm.runInContext(wrapped, vm.createContext(sandbox), { timeout: 5_000 });

    if ((cfg.mode ?? "all") === "each") {
      const out: INodeExecutionData[] = [];
      for (let i = 0; i < ctx.input.length; i++) {
        const result = await run(buildSandbox(ctx, i));
        for (const it of toItems(result)) out.push({ ...it, pairedItem: { item: i } });
      }
      return out;
    }

    const result = await run(buildSandbox(ctx, 0));
    return toItems(result);
  },
};
