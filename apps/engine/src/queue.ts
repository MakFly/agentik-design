import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

/**
 * Shared Redis connection. BullMQ requires maxRetriesPerRequest: null.
 * Typed as BullMQ's ConnectionOptions to sidestep the well-known dual-ioredis
 * type clash (bullmq bundles a slightly older ioredis than our direct dep); the
 * instances are runtime-compatible.
 */
export const connection: ConnectionOptions = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
}) as unknown as ConnectionOptions;

export const RUN_QUEUE = "workflow-runs";

export type RunJobData = { runId: string };

export const runQueue = new Queue<RunJobData>(RUN_QUEUE, { connection });

export async function enqueueRun(runId: string): Promise<void> {
  await runQueue.add(
    "execute",
    { runId },
    { removeOnComplete: 1000, removeOnFail: 5000, attempts: 1 },
  );
}
