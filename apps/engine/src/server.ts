import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  createWorkflowInput,
  runWorkflowInput,
  saveVersionInput,
} from "@agentik/workflow-schema";
import {
  createRun,
  createWorkflow,
  getRun,
  getWorkflow,
  listWorkflows,
  resolveTeam,
  saveVersion,
} from "./repo";
import { enqueueRun } from "./queue";

type Vars = { teamId: string; teamSlug: string };

const app = new Hono<{ Variables: Vars }>();

app.use("*", cors());

app.get("/api/v1/health", (c) => c.json({ ok: true, service: "engine" }));

const api = new Hono<{ Variables: Vars }>();

/** Dev tenancy: resolve team from x-team header (defaults to "acme"). */
api.use("*", async (c, next) => {
  const slug = c.req.header("x-team") ?? "acme";
  c.set("teamSlug", slug);
  c.set("teamId", await resolveTeam(slug));
  await next();
});

api.get("/workflows", async (c) => {
  const items = await listWorkflows(c.get("teamId"));
  return c.json({ items, nextCursor: null, total: items.length });
});

api.post("/workflows", async (c) => {
  const parsed = createWorkflowInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const wf = await createWorkflow(c.get("teamId"), parsed.data);
  return c.json(wf, 201);
});

api.get("/workflows/:id", async (c) => {
  const wf = await getWorkflow(c.get("teamId"), c.req.param("id"));
  if (!wf) return c.json({ error: "not_found" }, 404);
  return c.json(wf);
});

api.put("/workflows/:id/versions", async (c) => {
  const parsed = saveVersionInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const wf = await saveVersion(c.get("teamId"), c.req.param("id"), parsed.data);
  if (!wf) return c.json({ error: "not_found" }, 404);
  return c.json(wf);
});

api.post("/workflows/:id/run", async (c) => {
  const parsed = runWorkflowInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", detail: parsed.error.issues }, 400);
  const result = await createRun(c.get("teamId"), c.req.param("id"), "manual", parsed.data.payload);
  if ("error" in result) {
    return c.json({ error: result.error }, result.error === "not_found" ? 404 : 409);
  }
  await enqueueRun(result.runId);
  const run = await getRun(result.runId);
  return c.json(run, 202);
});

api.get("/runs/:id", async (c) => {
  const run = await getRun(c.req.param("id"));
  if (!run) return c.json({ error: "not_found" }, 404);
  return c.json(run);
});

/** Live run status via SSE — polls the run until it reaches a terminal state. */
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
api.get("/runs/:id/stream", (c) => {
  const id = c.req.param("id");
  return streamSSE(c, async (stream) => {
    for (let i = 0; i < 600; i++) {
      const run = await getRun(id);
      if (!run) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "not_found" }) });
        return;
      }
      await stream.writeSSE({ event: "run", data: JSON.stringify(run) });
      if (TERMINAL.has(run.status)) return;
      await stream.sleep(500);
    }
  });
});

app.route("/api/v1", api);

export default app;
