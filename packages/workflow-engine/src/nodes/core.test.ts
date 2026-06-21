import { describe, expect, test } from "bun:test";
import type { WorkflowGraph, WorkflowNode } from "@agentik/workflow-schema";
import type { INodeExecutionData } from "../items";
import type { NodeContext, PerItemContext } from "../types";
import { executeWorkflow } from "../executor";
import {
  setNode,
  filterNode,
  limitNode,
  noopNode,
  sortNode,
  aggregateNode,
  splitOutNode,
  removeDuplicatesNode,
  renameKeysNode,
  cryptoNode,
  dateTimeNode,
  summarizeNode,
} from "./core";
import { createHash } from "node:crypto";

function ctx(node: WorkflowNode, items: INodeExecutionData[]): NodeContext {
  return {
    node,
    input: items,
    inputsByPort: { main: items },
    payload: {},
    nodeOutputs: {},
    nodeNames: {},
    runId: "run",
    resolveCredential: async () => null,
  };
}
function perItem(node: WorkflowNode, items: INodeExecutionData[], i: number): PerItemContext {
  return { ...ctx(node, items), item: items[i]!, itemIndex: i };
}
const node = (config: WorkflowNode["config"]): WorkflowNode => ({
  id: "n",
  type: config.type,
  position: { x: 0, y: 0 },
  label: config.type,
  config,
});

describe("core nodes", () => {
  test("set assigns templated fields, keeping existing json", async () => {
    const n = node({ type: "set", assignments: [{ name: "double", value: "{{ $json.n * 2 }}" }], keepOnlySet: false });
    const out = await setNode.executeItem!(perItem(n, [{ json: { n: 21 } }], 0));
    expect(out).toEqual({ n: 21, double: 42 });
  });

  test("set keepOnlySet drops the original fields", async () => {
    const n = node({ type: "set", assignments: [{ name: "x", value: "{{ $json.n }}" }], keepOnlySet: true });
    const out = await setNode.executeItem!(perItem(n, [{ json: { n: 7, other: "z" } }], 0));
    expect(out).toEqual({ x: 7 });
  });

  test("filter keeps only items whose condition is truthy", async () => {
    const n = node({ type: "filter", condition: "$json.n > 2" });
    const items = [{ json: { n: 1 } }, { json: { n: 3 } }, { json: { n: 5 } }];
    const out = (await filterNode.execute!(ctx(n, items))) as INodeExecutionData[];
    expect(out.map((i) => i.json)).toEqual([{ n: 3 }, { n: 5 }]);
    expect(out.map((i) => i.pairedItem)).toEqual([{ item: 1 }, { item: 2 }]);
  });

  test("limit keeps first or last N", async () => {
    const items = [{ json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }];
    const first = (await limitNode.execute!(ctx(node({ type: "limit", maxItems: 2, keep: "first" }), items))) as INodeExecutionData[];
    expect(first.map((i) => i.json)).toEqual([{ n: 1 }, { n: 2 }]);
    const last = (await limitNode.execute!(ctx(node({ type: "limit", maxItems: 2, keep: "last" }), items))) as INodeExecutionData[];
    expect(last.map((i) => i.json)).toEqual([{ n: 2 }, { n: 3 }]);
  });

  test("noop passes items through unchanged", async () => {
    const items = [{ json: { a: 1 } }];
    expect(await noopNode.execute!(ctx(node({ type: "noop" }), items))).toBe(items);
  });

  test("sort orders items by a field", async () => {
    const items = [{ json: { n: 3 } }, { json: { n: 1 } }, { json: { n: 2 } }];
    const asc = (await sortNode.execute!(ctx(node({ type: "sort", field: "n", order: "asc" }), items))) as INodeExecutionData[];
    expect(asc.map((i) => i.json.n)).toEqual([1, 2, 3]);
    const desc = (await sortNode.execute!(ctx(node({ type: "sort", field: "n", order: "desc" }), items))) as INodeExecutionData[];
    expect(desc.map((i) => i.json.n)).toEqual([3, 2, 1]);
  });

  test("aggregate collects a field across items into one item", async () => {
    const items = [{ json: { n: 1 } }, { json: { n: 2 } }];
    const out = (await aggregateNode.execute!(ctx(node({ type: "aggregate", field: "n" }), items))) as INodeExecutionData[];
    expect(out).toHaveLength(1);
    expect(out[0]!.json).toEqual({ n: [1, 2] });
  });

  test("splitOut turns an array field into one item per element", async () => {
    const items = [{ json: { tags: ["a", "b", "c"] } }];
    const out = (await splitOutNode.execute!(ctx(node({ type: "splitOut", field: "tags" }), items))) as INodeExecutionData[];
    expect(out.map((i) => i.json)).toEqual([{ tags: "a" }, { tags: "b" }, { tags: "c" }]);
    expect(out.map((i) => i.pairedItem)).toEqual([{ item: 0 }, { item: 0 }, { item: 0 }]);
  });

  test("removeDuplicates drops items with a repeated field value", async () => {
    const items = [{ json: { id: 1 } }, { json: { id: 1 } }, { json: { id: 2 } }];
    const out = (await removeDuplicatesNode.execute!(ctx(node({ type: "removeDuplicates", field: "id" }), items))) as INodeExecutionData[];
    expect(out.map((i) => i.json.id)).toEqual([1, 2]);
  });

  test("renameKeys renames fields on each item", async () => {
    const n = node({ type: "renameKeys", renames: [{ from: "old", to: "new" }] });
    const out = await renameKeysNode.executeItem!(perItem(n, [{ json: { old: 5, keep: 1 } }], 0));
    expect(out).toEqual({ new: 5, keep: 1 });
  });

  test("crypto hashes a templated value into a field", async () => {
    const n = node({ type: "crypto", action: "hash", algorithm: "sha256", value: "{{ $json.pw }}", field: "digest" });
    const out = (await cryptoNode.executeItem!(perItem(n, [{ json: { pw: "secret" } }], 0))) as { digest: string };
    expect(out.digest).toBe(createHash("sha256").update("secret").digest("hex"));
  });

  test("dateTime formats a source date into a field", async () => {
    const n = node({ type: "dateTime", action: "format", sourceField: "d", outputField: "ymd", format: "yyyy-MM-dd", amount: 0, unit: "days" });
    const out = (await dateTimeNode.executeItem!(perItem(n, [{ json: { d: "2026-06-21T12:00:00Z" } }], 0))) as { ymd: string };
    expect(out.ymd).toBe("2026-06-21");
  });

  test("dateTime adds an interval", async () => {
    const n = node({ type: "dateTime", action: "add", sourceField: "d", outputField: "later", format: "yyyy-MM-dd", amount: 3, unit: "days" });
    const out = (await dateTimeNode.executeItem!(perItem(n, [{ json: { d: "2026-06-21T12:00:00Z" } }], 0))) as { later: string };
    expect(out.later).toBe("2026-06-24");
  });

  test("summarize groups and counts/sums", async () => {
    const items = [{ json: { cat: "a", v: 2 } }, { json: { cat: "a", v: 3 } }, { json: { cat: "b", v: 5 } }];
    const counts = (await summarizeNode.execute!(ctx(node({ type: "summarize", groupBy: "cat", operation: "count" }), items))) as INodeExecutionData[];
    expect(counts.map((i) => i.json)).toEqual([{ cat: "a", result: 2 }, { cat: "b", result: 1 }]);
    const sums = (await summarizeNode.execute!(ctx(node({ type: "summarize", groupBy: "cat", operation: "sum", field: "v" }), items))) as INodeExecutionData[];
    expect(sums.map((i) => i.json)).toEqual([{ cat: "a", result: 5 }, { cat: "b", result: 5 }]);
  });
});

describe("merge node (multi-input)", () => {
  test("combines items from two upstream branches", async () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, label: "T", config: { type: "trigger", trigger: "manual" } },
        { id: "a", type: "code", position: { x: 0, y: 0 }, label: "A", config: { type: "code", language: "js", source: "return { src: 'a' }", mode: "all" } },
        { id: "b", type: "code", position: { x: 0, y: 0 }, label: "B", config: { type: "code", language: "js", source: "return { src: 'b' }", mode: "all" } },
        { id: "m", type: "merge", position: { x: 0, y: 0 }, label: "M", config: { type: "merge", mode: "append" } },
      ],
      edges: [
        { id: "t-a", source: "t", target: "a" },
        { id: "t-b", source: "t", target: "b" },
        { id: "a-m", source: "a", target: "m" },
        { id: "b-m", source: "b", target: "m" },
      ],
    };
    const result = await executeWorkflow({ graph: g, payload: {} });
    expect(result.status).toBe("succeeded");
    expect(result.outputs.m!.map((i) => i.json)).toEqual([{ src: "a" }, { src: "b" }]);
  });
});
