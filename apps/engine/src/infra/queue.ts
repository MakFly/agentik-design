import { type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";
import { isSolo } from "./mode";

/**
 * Shared Redis connection. BullMQ requires maxRetriesPerRequest: null.
 * Typed as BullMQ's ConnectionOptions to sidestep the well-known dual-ioredis
 * type clash (bullmq bundles a slightly older ioredis than our direct dep); the
 * instances are runtime-compatible.
 *
 * Null in solo mode: there is no Redis, and the only consumer (the rate limiter)
 * degrades to its in-process store. Zero external services.
 */
export const connection: ConnectionOptions | null = isSolo
  ? null
  : (new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    }) as unknown as ConnectionOptions);
