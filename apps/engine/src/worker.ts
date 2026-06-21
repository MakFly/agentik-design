import { Worker } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
import { createAgentNode, executeWorkflow } from "@agentik/workflow-engine";
import { env } from "./env";
import { db, schema } from "./db/client";
import { genId } from "./db/ids";
import { decryptJson, encryptJson } from "./crypto";
import { refreshGoogleToken } from "./oauth";
import { connection, RUN_QUEUE, type RunJobData } from "./queue";

// Agent node needs an API key — injected here so the engine package stays
// provider-agnostic. Without a key, agent nodes fail with a clear message.
const agentNode = createAgentNode({ apiKey: env.OPENAI_API_KEY });

const { runs, workflowVersions, runSteps, credentials } = schema;

/** Resolve a credential's decrypted secrets, scoped to the run's team. */
function credentialResolver(teamId: string) {
  return async (id: string): Promise<Record<string, string> | null> => {
    const [row] = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, id), eq(credentials.teamId, teamId)))
      .limit(1);
    if (!row) return null;
    let data: Record<string, string>;
    try {
      data = decryptJson<Record<string, string>>(row.data);
    } catch {
      throw new Error(`Credential ${id} could not be decrypted (key mismatch or corrupt data).`);
    }

    // Refresh an expired Google OAuth2 access token (60s skew) and persist it.
    if (
      row.type === "googleOAuth2" &&
      data.refresh_token &&
      Number(data.expires_at ?? 0) < Date.now() + 60_000
    ) {
      const refreshed = await refreshGoogleToken({
        refreshToken: data.refresh_token,
        clientId: data.clientId || env.GOOGLE_CLIENT_ID || "",
        clientSecret: data.clientSecret || env.GOOGLE_CLIENT_SECRET || "",
      });
      data = {
        ...data,
        access_token: refreshed.access_token,
        expires_at: String(Date.now() + refreshed.expires_in * 1000),
      };
      await db.update(credentials).set({ data: encryptJson(data), updatedAt: sql`now()` }).where(eq(credentials.id, id));
    }

    return data;
  };
}

const durationSql = sql`round(extract(epoch from (now() - ${runs.startedAt})) * 1000)`;

async function runWorkflow(runId: string): Promise<void> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error(`run ${runId} not found`);

  const [version] = await db
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.id, run.versionId))
    .limit(1);

  if (!version) {
    await db
      .update(runs)
      .set({ status: "failed", error: "Workflow version not found.", endedAt: sql`now()` })
      .where(eq(runs.id, runId));
    return;
  }

  await db.update(runs).set({ status: "running", startedAt: sql`now()` }).where(eq(runs.id, runId));

  const stepIdByIndex = new Map<number, string>();

  const result = await executeWorkflow({
    graph: version.graph,
    payload: run.payload,
    runId,
    executors: [agentNode],
    resolveCredential: credentialResolver(run.teamId),
    hooks: {
      async onStepStart(ev) {
        const id = genId("step");
        stepIdByIndex.set(ev.index, id);
        await db.insert(runSteps).values({
          id,
          runId,
          index: ev.index,
          nodeId: ev.nodeId,
          nodeType: ev.nodeType,
          label: ev.label,
          status: "running",
          input: ev.input ?? null,
        });
        await db
          .update(runs)
          .set({ stepCount: sql`${runs.stepCount} + 1` })
          .where(eq(runs.id, runId));
      },
      async onStepFinish(ev) {
        const id = stepIdByIndex.get(ev.index);
        if (!id) return;
        await db
          .update(runSteps)
          .set({
            status: ev.status,
            output: ev.output ?? null,
            error: ev.error ?? null,
            endedAt: sql`now()`,
            durationMs: ev.durationMs,
          })
          .where(eq(runSteps.id, id));
        if (ev.status === "succeeded") {
          await db
            .update(runs)
            .set({ completedSteps: sql`${runs.completedSteps} + 1` })
            .where(eq(runs.id, runId));
        }
      },
    },
  });

  await db
    .update(runs)
    .set({
      status: result.status,
      error: result.error ?? null,
      endedAt: sql`now()`,
      durationMs: durationSql,
    })
    .where(eq(runs.id, runId));
}

const worker = new Worker<RunJobData>(
  RUN_QUEUE,
  async (job) => {
    try {
      await runWorkflow(job.data.runId);
    } catch (err) {
      // Unexpected engine/db failure: never leave a run stuck in "running".
      await db
        .update(runs)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          endedAt: sql`now()`,
        })
        .where(eq(runs.id, job.data.runId));
      throw err;
    }
  },
  { connection, concurrency: 5 },
);

worker.on("failed", (job, err) => {
  console.error(`[engine] run ${job?.data.runId} failed:`, err.message);
});
worker.on("completed", (job) => {
  console.log(`[engine] run ${job.data.runId} done`);
});

console.log("[engine] worker started, waiting for runs…");
