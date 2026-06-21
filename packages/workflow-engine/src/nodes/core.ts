import { createHash, createHmac } from "node:crypto";
import { DateTime } from "luxon";
import { type NodeExecutor, exprScope } from "../types";
import { evaluate, resolveTemplate } from "../expressions";
import type { INodeExecutionData, JsonObject } from "../items";

/**
 * n8n "core" nodes — pure item manipulation, no credentials. They implement the
 * same `execute` / `executeItem` contract as every other node, which is the
 * whole point: the catalog grows by adding nodes on this contract.
 */

/** Edit Fields (Set) — assign/override fields on each item. */
export const setNode: NodeExecutor = {
  type: "set",
  async executeItem(ctx) {
    if (ctx.node.config.type !== "set") throw new Error("set node: config mismatch");
    const cfg = ctx.node.config;
    const scope = exprScope(ctx, ctx.itemIndex);
    const json: JsonObject = cfg.keepOnlySet ? {} : { ...ctx.item.json };
    for (const a of cfg.assignments) json[a.name] = resolveTemplate(a.value, scope);
    return json;
  },
};

/** Filter — keep only items whose condition expression is truthy. */
export const filterNode: NodeExecutor = {
  type: "filter",
  async execute(ctx) {
    if (ctx.node.config.type !== "filter") throw new Error("filter node: config mismatch");
    const { condition } = ctx.node.config;
    const kept: INodeExecutionData[] = [];
    ctx.input.forEach((item, i) => {
      let pass = false;
      try {
        pass = Boolean(evaluate(condition, exprScope(ctx, i)));
      } catch {
        pass = false; // a throwing condition drops the item
      }
      if (pass) kept.push({ ...item, pairedItem: { item: i } });
    });
    return kept;
  },
};

/** Limit — keep the first/last N items. */
export const limitNode: NodeExecutor = {
  type: "limit",
  async execute(ctx) {
    if (ctx.node.config.type !== "limit") throw new Error("limit node: config mismatch");
    const { maxItems, keep } = ctx.node.config;
    return keep === "last" ? ctx.input.slice(-maxItems) : ctx.input.slice(0, maxItems);
  },
};

/** Merge — combine items from all input ports into one stream. */
export const mergeNode: NodeExecutor = {
  type: "merge",
  async execute(ctx) {
    if (ctx.node.config.type !== "merge") throw new Error("merge node: config mismatch");
    return Object.values(ctx.inputsByPort).flat();
  },
};

/** No Operation — pass items through unchanged. */
export const noopNode: NodeExecutor = {
  type: "noop",
  async execute(ctx) {
    return ctx.input;
  },
};

/** Sort — order items by a field (asc/desc). */
export const sortNode: NodeExecutor = {
  type: "sort",
  async execute(ctx) {
    if (ctx.node.config.type !== "sort") throw new Error("sort node: config mismatch");
    const { field, order } = ctx.node.config;
    const dir = order === "desc" ? -1 : 1;
    return [...ctx.input].sort((a, b) => {
      const av = a.json[field] as never;
      const bv = b.json[field] as never;
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * dir;
    });
  },
};

/** Aggregate — combine all items into one (collect a field, or all json). */
export const aggregateNode: NodeExecutor = {
  type: "aggregate",
  async execute(ctx) {
    if (ctx.node.config.type !== "aggregate") throw new Error("aggregate node: config mismatch");
    const { field } = ctx.node.config;
    const json: JsonObject = field
      ? { [field]: ctx.input.map((i) => i.json[field]) }
      : { items: ctx.input.map((i) => i.json) };
    return [{ json }];
  },
};

/** Split Out — turn an array field into one item per element. */
export const splitOutNode: NodeExecutor = {
  type: "splitOut",
  async execute(ctx) {
    if (ctx.node.config.type !== "splitOut") throw new Error("splitOut node: config mismatch");
    const { field } = ctx.node.config;
    const out: INodeExecutionData[] = [];
    ctx.input.forEach((item, i) => {
      const value = item.json[field];
      const arr = Array.isArray(value) ? value : [value];
      for (const el of arr) {
        const json: JsonObject =
          el && typeof el === "object" && !Array.isArray(el) ? (el as JsonObject) : { [field]: el };
        out.push({ json, pairedItem: { item: i } });
      }
    });
    return out;
  },
};

/** Remove Duplicates — drop items with a repeated key (a field, or whole json). */
export const removeDuplicatesNode: NodeExecutor = {
  type: "removeDuplicates",
  async execute(ctx) {
    if (ctx.node.config.type !== "removeDuplicates") throw new Error("removeDuplicates node: config mismatch");
    const { field } = ctx.node.config;
    const seen = new Set<string>();
    const out: INodeExecutionData[] = [];
    ctx.input.forEach((item, i) => {
      const key = JSON.stringify(field ? item.json[field] : item.json);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...item, pairedItem: { item: i } });
    });
    return out;
  },
};

/** Rename Keys — rename fields on each item. */
export const renameKeysNode: NodeExecutor = {
  type: "renameKeys",
  async executeItem(ctx) {
    if (ctx.node.config.type !== "renameKeys") throw new Error("renameKeys node: config mismatch");
    const json: JsonObject = { ...ctx.item.json };
    for (const { from, to } of ctx.node.config.renames) {
      if (from in json) {
        json[to] = json[from];
        delete json[from];
      }
    }
    return json;
  },
};

/** Crypto — hash/HMAC a value into a field. */
export const cryptoNode: NodeExecutor = {
  type: "crypto",
  async executeItem(ctx) {
    if (ctx.node.config.type !== "crypto") throw new Error("crypto node: config mismatch");
    const cfg = ctx.node.config;
    const scope = exprScope(ctx, ctx.itemIndex);
    const value = String(resolveTemplate(cfg.value, scope));
    const digest =
      cfg.action === "hmac"
        ? createHmac(cfg.algorithm, cfg.secret ? String(resolveTemplate(cfg.secret, scope)) : "")
            .update(value)
            .digest("hex")
        : createHash(cfg.algorithm).update(value).digest("hex");
    return { ...ctx.item.json, [cfg.field]: digest };
  },
};

/** Date & Time — format or shift a date into a field (Luxon). */
export const dateTimeNode: NodeExecutor = {
  type: "dateTime",
  async executeItem(ctx) {
    if (ctx.node.config.type !== "dateTime") throw new Error("dateTime node: config mismatch");
    const cfg = ctx.node.config;
    const src = cfg.sourceField ? ctx.item.json[cfg.sourceField] : undefined;
    let dt = src === undefined ? DateTime.now() : DateTime.fromISO(String(src));
    if (!dt.isValid) dt = DateTime.now();
    if (cfg.action === "add") dt = dt.plus({ [cfg.unit]: cfg.amount });
    return { ...ctx.item.json, [cfg.outputField]: cfg.format ? dt.toFormat(cfg.format) : dt.toISO() };
  },
};

/** Summarize — group items by a field and count/sum another. */
export const summarizeNode: NodeExecutor = {
  type: "summarize",
  async execute(ctx) {
    if (ctx.node.config.type !== "summarize") throw new Error("summarize node: config mismatch");
    const { groupBy, operation, field } = ctx.node.config;
    const groups = new Map<string, { key: unknown; count: number; sum: number }>();
    for (const item of ctx.input) {
      const keyVal = item.json[groupBy];
      const k = JSON.stringify(keyVal);
      const g = groups.get(k) ?? { key: keyVal, count: 0, sum: 0 };
      g.count += 1;
      if (field) g.sum += Number(item.json[field]) || 0;
      groups.set(k, g);
    }
    return [...groups.values()].map((g) => ({
      json: { [groupBy]: g.key, result: operation === "sum" ? g.sum : g.count },
    }));
  },
};
