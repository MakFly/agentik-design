import type { NodeExecutor } from "../types";
import { toItems } from "../items";

/**
 * Manual / webhook / schedule entry point. Emits the run's trigger payload as
 * the initial item array. An array payload becomes one item per element (n8n
 * behaviour); anything else becomes a single item. A missing payload still
 * yields one empty item so downstream nodes run at least once.
 */
export const triggerNode: NodeExecutor = {
  type: "trigger",
  async execute({ payload }) {
    return toItems(payload ?? {});
  },
};
