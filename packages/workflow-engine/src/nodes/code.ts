import vm from "node:vm";
import type { NodeExecutor } from "../types";

/**
 * Code node — runs author-supplied JavaScript natively (the whole reason the
 * engine is on Bun). The user's source runs inside an async IIFE, so a top-level
 * `return` yields the node output. `input`, `payload` and `outputs` are in scope.
 *
 * SECURITY: node:vm is NOT a sandbox against malicious code. This is safe for a
 * single-tenant, trusted-author deployment. Before multi-tenant / prod, swap to
 * isolated-vm or a locked-down Worker. Tracked for Phase 5.
 */
export const codeNode: NodeExecutor = {
  type: "code",
  async execute({ node, input, payload, outputs }) {
    if (node.config.type !== "code") throw new Error("code node: config mismatch");

    const sandbox = {
      input,
      payload,
      outputs,
      console: { log: (...args: unknown[]) => console.log("[code]", ...args) },
    };
    const context = vm.createContext(sandbox);
    const wrapped = `(async () => {\n${node.config.source}\n})()`;
    return await vm.runInContext(wrapped, context, { timeout: 5_000 });
  },
};
