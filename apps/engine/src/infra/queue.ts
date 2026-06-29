import { type ConnectionOptions } from "bullmq";
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
