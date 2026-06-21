import type { NodeExecutor } from "../types";

/** Manual / webhook / schedule entry point. Emits the run's trigger payload. */
export const triggerNode: NodeExecutor = {
  type: "trigger",
  async execute({ payload }) {
    return payload ?? {};
  },
};
