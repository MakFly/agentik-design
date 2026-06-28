import { describe, expect, test } from "bun:test";
import { DAEMON_STALE_MS, isHeartbeatFresh } from "../../src/infra/daemon-liveness";

describe("isHeartbeatFresh", () => {
  const now = Date.parse("2026-06-28T12:00:00Z");
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  test("a missing heartbeat is never fresh", () => {
    expect(isHeartbeatFresh(null, now)).toBe(false);
  });

  test("a recent heartbeat is fresh", () => {
    expect(isHeartbeatFresh(at(1_000), now)).toBe(true);
  });

  test("the staleness boundary is inclusive", () => {
    expect(isHeartbeatFresh(at(DAEMON_STALE_MS), now)).toBe(true);
    expect(isHeartbeatFresh(at(DAEMON_STALE_MS + 1), now)).toBe(false);
  });

  test("an old heartbeat is stale", () => {
    expect(isHeartbeatFresh(at(60_000), now)).toBe(false);
  });

  test("parses the Postgres 2-digit-offset timestamp format", () => {
    // Postgres emits "2026-06-28 11:59:55+00" (space separator, 2-digit offset).
    expect(isHeartbeatFresh("2026-06-28 11:59:55+00", now)).toBe(true);
    expect(isHeartbeatFresh("2026-06-28 11:00:00+00", now)).toBe(false);
  });

  test("a malformed timestamp is treated as stale", () => {
    expect(isHeartbeatFresh("not-a-date", now)).toBe(false);
  });
});
