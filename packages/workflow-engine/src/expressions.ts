import vm from "node:vm";

export interface Scope {
  input: unknown;
  payload: unknown;
  outputs: Readonly<Record<string, unknown>>;
}

/**
 * Evaluate a single JS expression against the run scope. Used to resolve
 * `{{ ... }}` interpolations. The vm context is a convenience sandbox, NOT a
 * security boundary — inputs come from the workflow author, who is trusted.
 */
function evalExpr(expr: string, scope: Scope): unknown {
  const sandbox = Object.freeze({
    input: scope.input,
    payload: scope.payload,
    outputs: scope.outputs,
    $json: scope.input, // n8n-style alias for the current item
  });
  const context = vm.createContext({ ...sandbox });
  return vm.runInContext(`(${expr})`, context, { timeout: 1000 });
}

const TEMPLATE = /\{\{([\s\S]+?)\}\}/g;

/**
 * Resolve `{{ expr }}` interpolations in a string. If the entire string is a
 * single expression, the raw value is returned (preserving type); otherwise
 * each match is stringified and spliced in.
 */
export function resolveTemplate(str: string, scope: Scope): unknown {
  const single = str.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
  if (single) return evalExpr(single[1]!, scope);

  return str.replace(TEMPLATE, (_m, expr: string) => {
    const value = evalExpr(expr, scope);
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

/** Recursively resolve templates inside strings of a JSON-ish value. */
export function resolveDeep(value: unknown, scope: Scope): unknown {
  if (typeof value === "string") return resolveTemplate(value, scope);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, scope));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveDeep(v, scope)]),
    );
  }
  return value;
}
