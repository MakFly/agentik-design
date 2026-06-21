import vm from "node:vm";
import { DateTime } from "luxon";
import type { INodeExecutionData, JsonObject } from "./items";
import { firstJson } from "./items";

/**
 * Expression scope — everything an `{{ }}` expression can see for ONE item.
 * Modelled on n8n's expression variables. The executor builds one scope per
 * item before resolving a node's templated parameters.
 */
export interface ExprScope {
  /** The current node's full input, one entry per item. */
  items: INodeExecutionData[];
  /** Index of the item currently being processed. */
  itemIndex: number;
  /** The run's trigger payload. */
  payload: unknown;
  /** node id → that node's output items (concatenated across ports). */
  nodeOutputs: Readonly<Record<string, INodeExecutionData[]>>;
  /** node id → display label (for `$('Label')` / `$node["Label"]`). */
  nodeNames: Readonly<Record<string, string>>;
  runId: string;
  workflowName?: string;
  /** Injected for determinism in tests; defaults to "now" at build time. */
  now?: Date;
}

interface NodeAccessor {
  all(): INodeExecutionData[];
  first(): INodeExecutionData | undefined;
  last(): INodeExecutionData | undefined;
  item: INodeExecutionData | undefined;
}

function accessor(items: INodeExecutionData[], itemIndex: number): NodeAccessor {
  return {
    all: () => items,
    first: () => items[0],
    last: () => items[items.length - 1],
    item: items[itemIndex] ?? items[0],
  };
}

/** Build the n8n-style variable bag (`$json`, `$input`, `$()`, …) for a scope. */
export function expressionGlobals(scope: ExprScope): Record<string, unknown> {
  const { items, itemIndex } = scope;
  const current = items[itemIndex] ?? items[0] ?? { json: {} as JsonObject };
  // n8n exposes $now / $today as Luxon DateTime instances.
  const now = scope.now ? DateTime.fromJSDate(scope.now) : DateTime.now();
  const today = now.startOf("day");

  // label → id, so $('My Node') resolves by display name (n8n) or raw id.
  const idByName: Record<string, string> = {};
  for (const [id, name] of Object.entries(scope.nodeNames)) idByName[name] = id;

  const resolveNode = (nameOrId: string): NodeAccessor => {
    const id = idByName[nameOrId] ?? nameOrId;
    return accessor(scope.nodeOutputs[id] ?? [], itemIndex);
  };

  // $node["Name"].json — legacy n8n accessor.
  const $node = new Proxy(
    {},
    {
      get(_t, prop: string) {
        const acc = resolveNode(prop);
        const it = acc.item;
        return { json: it?.json ?? {}, binary: it?.binary ?? {} };
      },
    },
  );

  // Legacy agentik aliases (pre-items graphs): `input`/`outputs` as plain json.
  const outputsAlias = new Proxy(
    {},
    {
      get: (_t, prop: string) => firstJson(scope.nodeOutputs[prop] ?? []),
      has: (_t, prop: string) => prop in scope.nodeOutputs,
      ownKeys: () => Reflect.ownKeys(scope.nodeOutputs),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    },
  );

  return {
    // n8n core
    $json: current.json,
    $binary: current.binary ?? {},
    $itemIndex: itemIndex,
    $runIndex: 0,
    $input: {
      all: () => items,
      first: () => items[0],
      last: () => items[items.length - 1],
      item: current,
    },
    $: resolveNode,
    $node,
    $now: now,
    $today: today,
    $workflow: { name: scope.workflowName ?? "" },
    $execution: { id: scope.runId, mode: "manual" },
    // back-compat aliases for graphs authored against the old single-value model
    input: current.json,
    payload: scope.payload,
    outputs: outputsAlias,
  };
}

/**
 * Evaluate a single JS expression against an item scope. Resolves `{{ ... }}`.
 * The vm context is a convenience sandbox, NOT a security boundary — expressions
 * come from the workflow author, who is trusted.
 */
export function evaluate(expr: string, scope: ExprScope): unknown {
  const context = vm.createContext(expressionGlobals(scope));
  return vm.runInContext(`(${expr})`, context, { timeout: 1000 });
}

const TEMPLATE = /\{\{([\s\S]+?)\}\}/g;

/**
 * Resolve `{{ expr }}` interpolations in a string. If the whole string is a
 * single expression the raw typed value is returned; otherwise each match is
 * stringified and spliced into the surrounding text.
 */
export function resolveTemplate(str: string, scope: ExprScope): unknown {
  const single = str.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
  if (single) return evaluate(single[1]!, scope);

  return str.replace(TEMPLATE, (_m, expr: string) => {
    const value = evaluate(expr, scope);
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

/** Recursively resolve templates inside strings of a JSON-ish value. */
export function resolveDeep(value: unknown, scope: ExprScope): unknown {
  if (typeof value === "string") return resolveTemplate(value, scope);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, scope));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveDeep(v, scope)]),
    );
  }
  return value;
}
