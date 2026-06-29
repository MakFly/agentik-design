import { describe, it, expect } from "bun:test";
import type { Role } from "@agentik/workflow-schema";
import { handleControl } from "../../src/infra/control";

// The RBAC gate runs BEFORE any runs-domain call: a forbidden role returns early
// with `accepted:false, reason:"forbidden"` and never touches the DB. These tests
// assert exactly that boundary (the new security behavior), so they stay pure and
// green on a bare checkout — the authorized path (action execution) is covered by
// the runs domain + HTTP route tests.

type Ack = { kind: string; runId: string; action: string; accepted: boolean; reason?: string };

function makeWs(role: Role) {
  const sent: Ack[] = [];
  const ws = {
    data: { teamId: "team_1", userId: "user_1", role },
    send: (s: string) => sent.push(JSON.parse(s) as Ack),
  } as never;
  return { ws, sent };
}

async function send(role: Role, body: Record<string, unknown>): Promise<Ack | undefined> {
  const { ws, sent } = makeWs(role);
  await handleControl(ws, JSON.stringify(body));
  return sent[0];
}

describe("handleControl — RBAC gate (deny path, DB-free)", () => {
  it("denies run.cancel for a viewer (lacks run:control)", async () => {
    const ack = await send("viewer", { type: "run.cancel", runId: "r1" });
    expect(ack).toMatchObject({ action: "run.cancel", accepted: false, reason: "forbidden" });
  });

  it("denies run.pause and run.resume for a viewer", async () => {
    expect(await send("viewer", { type: "run.pause", runId: "r1" })).toMatchObject({
      accepted: false,
      reason: "forbidden",
    });
    expect(await send("viewer", { type: "run.resume", runId: "r1" })).toMatchObject({
      accepted: false,
      reason: "forbidden",
    });
  });

  it("denies run.approve for a viewer", async () => {
    const ack = await send("viewer", { type: "run.approve", runId: "r1" });
    expect(ack).toMatchObject({ accepted: false, reason: "forbidden" });
  });

  it("denies run.approve for an engineer (has run:control but NOT run:approve)", async () => {
    const ack = await send("engineer", { type: "run.approve", runId: "r1" });
    expect(ack).toMatchObject({ accepted: false, reason: "forbidden" });
  });

  it("ignores unknown control types (no ack emitted, nothing runs)", async () => {
    expect(await send("owner", { type: "run.frobnicate", runId: "r1" })).toBeUndefined();
  });

  it("ignores malformed messages (missing runId)", async () => {
    expect(await send("viewer", { type: "run.cancel" })).toBeUndefined();
  });
});
