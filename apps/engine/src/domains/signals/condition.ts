/**
 * Rule condition evaluator. A signal carries a payload; a rule fires only when
 * its `condition` matches that payload. An empty condition ({}) matches everything
 * (backward compatible with rules created before evaluation existed).
 *
 * Grammar (all fields optional, AND-combined within a node):
 *   combinators: { all: Node[] } | { any: Node[] } | { not: Node }
 *   leaf:        { path: "dot.path", <one or more matchers> }
 *   matchers:    equals | notEquals | contains | in | exists | matches (regex, case-insensitive)
 */

export type ConditionNode = Record<string, unknown>;

function getByPath(payload: unknown, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = payload;
  for (const segment of path.split(".")) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Loose equality: exact, or equal once both sides are stringified (so "5" == 5). */
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function matchLeaf(node: ConditionNode, payload: unknown): boolean {
  const value = getByPath(payload, String(node.path));

  if ("exists" in node) {
    if ((value !== undefined) !== Boolean(node.exists)) return false;
  }
  if ("equals" in node && !looseEq(value, node.equals)) return false;
  if ("notEquals" in node && looseEq(value, node.notEquals)) return false;
  if ("contains" in node) {
    if (value === undefined) return false;
    if (!String(value).toLowerCase().includes(String(node.contains).toLowerCase())) return false;
  }
  if ("in" in node) {
    const options = Array.isArray(node.in) ? node.in : [];
    if (!options.some((option) => looseEq(value, option))) return false;
  }
  if ("matches" in node) {
    if (value === undefined) return false;
    try {
      if (!new RegExp(String(node.matches), "i").test(String(value))) return false;
    } catch {
      return false; // invalid regex never matches
    }
  }
  return true;
}

function evalNode(node: unknown, payload: unknown): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return true;
  const n = node as ConditionNode;
  const checks: boolean[] = [];

  if (Array.isArray(n.all)) checks.push(n.all.every((child) => evalNode(child, payload)));
  if (Array.isArray(n.any)) {
    checks.push(n.any.length === 0 || n.any.some((child) => evalNode(child, payload)));
  }
  if ("not" in n) checks.push(!evalNode(n.not, payload));
  if ("path" in n) checks.push(matchLeaf(n, payload));

  // No recognized keys → permissive (empty condition matches everything).
  if (checks.length === 0) return true;
  return checks.every(Boolean);
}

export function matchesCondition(
  condition: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  return evalNode(condition ?? {}, payload);
}
