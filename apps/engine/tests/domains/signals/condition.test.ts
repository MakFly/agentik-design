import { describe, expect, test } from "bun:test";
import { matchesCondition } from "../../../src/domains/signals/condition";

describe("matchesCondition", () => {
  const email = {
    label: "invoice",
    from: "client@acme.com",
    subject: "Invoice #42 overdue",
    priority: 3,
    flagged: true,
    nested: { sender: { vip: true } },
    tags: ["billing", "urgent"],
  };

  test("empty / missing condition matches everything", () => {
    expect(matchesCondition({}, email)).toBe(true);
    expect(matchesCondition(null, email)).toBe(true);
    expect(matchesCondition(undefined, email)).toBe(true);
  });

  test("leaf equals (with loose string/number coercion)", () => {
    expect(matchesCondition({ path: "label", equals: "invoice" }, email)).toBe(true);
    expect(matchesCondition({ path: "label", equals: "spam" }, email)).toBe(false);
    expect(matchesCondition({ path: "priority", equals: "3" }, email)).toBe(true);
    expect(matchesCondition({ path: "priority", equals: 3 }, email)).toBe(true);
  });

  test("contains is case-insensitive substring", () => {
    expect(matchesCondition({ path: "subject", contains: "overdue" }, email)).toBe(true);
    expect(matchesCondition({ path: "subject", contains: "OVERDUE" }, email)).toBe(true);
    expect(matchesCondition({ path: "subject", contains: "refund" }, email)).toBe(false);
  });

  test("in / exists / matches / notEquals", () => {
    expect(matchesCondition({ path: "label", in: ["invoice", "receipt"] }, email)).toBe(true);
    expect(matchesCondition({ path: "label", in: ["spam"] }, email)).toBe(false);
    expect(matchesCondition({ path: "flagged", exists: true }, email)).toBe(true);
    expect(matchesCondition({ path: "missing", exists: false }, email)).toBe(true);
    expect(matchesCondition({ path: "missing", exists: true }, email)).toBe(false);
    expect(matchesCondition({ path: "from", matches: "@acme\\.com$" }, email)).toBe(true);
    expect(matchesCondition({ path: "label", notEquals: "spam" }, email)).toBe(true);
    expect(matchesCondition({ path: "label", notEquals: "invoice" }, email)).toBe(false);
  });

  test("dot paths into nested objects and array indices", () => {
    expect(matchesCondition({ path: "nested.sender.vip", equals: true }, email)).toBe(true);
    expect(matchesCondition({ path: "tags.0", equals: "billing" }, email)).toBe(true);
    expect(matchesCondition({ path: "tags.5", exists: false }, email)).toBe(true);
  });

  test("all = AND, any = OR, not = negation, and nesting", () => {
    expect(
      matchesCondition(
        { all: [{ path: "label", equals: "invoice" }, { path: "priority", equals: 3 }] },
        email,
      ),
    ).toBe(true);
    expect(
      matchesCondition(
        { all: [{ path: "label", equals: "invoice" }, { path: "priority", equals: 9 }] },
        email,
      ),
    ).toBe(false);
    expect(
      matchesCondition(
        { any: [{ path: "label", equals: "spam" }, { path: "flagged", equals: true }] },
        email,
      ),
    ).toBe(true);
    expect(matchesCondition({ not: { path: "label", equals: "spam" } }, email)).toBe(true);
    expect(
      matchesCondition(
        { all: [{ path: "label", equals: "invoice" }], not: { path: "from", contains: "spam" } },
        email,
      ),
    ).toBe(true);
  });

  test("matcher against an absent value fails (except exists:false)", () => {
    expect(matchesCondition({ path: "missing", equals: "x" }, email)).toBe(false);
    expect(matchesCondition({ path: "missing", contains: "x" }, email)).toBe(false);
    expect(matchesCondition({ path: "missing", matches: ".*" }, email)).toBe(false);
  });
});
