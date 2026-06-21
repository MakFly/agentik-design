import type { NodeExecutor } from "../types";

/** Terminal marker node. Passes its input items through as the workflow result. */
export const endNode: NodeExecutor = {
  type: "end",
  async execute({ input }) {
    return input;
  },
};
