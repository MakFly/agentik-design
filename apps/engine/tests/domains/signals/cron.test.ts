import { describe, expect, test } from "bun:test";
import { cronMatches } from "../../../src/domains/signals/cron";

describe("cronMatches", () => {
  // 2026-01-05 is a Monday; 2026-01-04 is a Sunday.
  const monday0900 = new Date(2026, 0, 5, 9, 0, 0);
  const monday0901 = new Date(2026, 0, 5, 9, 1, 0);
  const sunday0900 = new Date(2026, 0, 4, 9, 0, 0);

  test("'* * * * *' always matches", () => {
    expect(cronMatches("* * * * *", monday0900)).toBe(true);
  });

  test("weekday 09:00 ('0 9 * * 1-5')", () => {
    expect(cronMatches("0 9 * * 1-5", monday0900)).toBe(true);
    expect(cronMatches("0 9 * * 1-5", monday0901)).toBe(false); // wrong minute
    expect(cronMatches("0 9 * * 1-5", sunday0900)).toBe(false); // weekend
  });

  test("step values ('*/15 * * * *')", () => {
    expect(cronMatches("*/15 * * * *", new Date(2026, 0, 5, 9, 0))).toBe(true);
    expect(cronMatches("*/15 * * * *", new Date(2026, 0, 5, 9, 30))).toBe(true);
    expect(cronMatches("*/15 * * * *", new Date(2026, 0, 5, 9, 7))).toBe(false);
  });

  test("lists and exact fields ('30 14 1 1 *')", () => {
    expect(cronMatches("30 14 1 1 *", new Date(2026, 0, 1, 14, 30))).toBe(true);
    expect(cronMatches("30 14 1 1 *", new Date(2026, 0, 2, 14, 30))).toBe(false);
    expect(cronMatches("0,30 * * * *", new Date(2026, 0, 5, 9, 30))).toBe(true);
  });

  test("Sunday accepts both 0 and 7", () => {
    expect(cronMatches("0 9 * * 0", sunday0900)).toBe(true);
    expect(cronMatches("0 9 * * 7", sunday0900)).toBe(true);
  });

  test("malformed expression never matches", () => {
    expect(cronMatches("not a cron", monday0900)).toBe(false);
    expect(cronMatches("* * *", monday0900)).toBe(false);
  });
});
