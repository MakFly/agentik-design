import { describe, expect, test } from "bun:test";
import { ROLES, roleCan, type Permission } from "./index";

describe("roleCan", () => {
  test("owner can do everything", () => {
    for (const p of ["agent:delete", "review:approve", "billing:read", "settings:read"] as Permission[]) {
      expect(roleCan("owner", p)).toBe(true);
    }
  });

  test("viewer is read-only across the moat", () => {
    expect(roleCan("viewer", "memory:read")).toBe(true);
    expect(roleCan("viewer", "skill:read")).toBe(true);
    expect(roleCan("viewer", "review:read")).toBe(true);
    expect(roleCan("viewer", "review:approve")).toBe(false);
    expect(roleCan("viewer", "agent:create")).toBe(false);
  });

  test("operator approves runs/reviews but cannot author agents", () => {
    expect(roleCan("operator", "run:approve")).toBe(true);
    expect(roleCan("operator", "review:approve")).toBe(true);
    expect(roleCan("operator", "agent:create")).toBe(false);
  });

  test("engineer authors agents/skills but cannot approve reviews", () => {
    expect(roleCan("engineer", "agent:create")).toBe(true);
    expect(roleCan("engineer", "skill:create")).toBe(true);
    expect(roleCan("engineer", "review:approve")).toBe(false);
  });

  test("every role is defined", () => {
    expect(ROLES).toEqual(["owner", "admin", "engineer", "operator", "viewer"]);
  });
});
