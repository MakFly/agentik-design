import { z } from "zod";

/**
 * Runtime contract — mirrors what the daemon already speaks
 * (apps/daemon/internal/protocol). Multi-runtime ready, claude first.
 * NOTE: this package is named `workflow-schema` for historical reasons; it is
 * the shared contract package. Rename to `@agentik/contracts` is a post-MVP chore.
 */

export const runtimeKindSchema = z.enum([
  "echo",
  "claude",
  "hermes",
  "codex",
  "openai",
  "anthropic",
  "openrouter",
  "custom",
]); // enum stays extensible — "hermes" wraps the Nous Research CLI as a daemon runtime
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;

/** Stream event emitted by a runtime — maps 1:1 to task_messages.type (+ done). */
export const runtimeEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), content: z.string() }),
  z.object({ type: z.literal("thinking"), content: z.string() }),
  z.object({ type: z.literal("tool_use"), tool: z.string(), input: z.unknown() }),
  z.object({ type: z.literal("tool_result"), tool: z.string(), output: z.unknown() }),
  z.object({ type: z.literal("error"), content: z.string() }),
  z.object({ type: z.literal("done"), result: z.unknown() }),
]);
export type RuntimeEvent = z.infer<typeof runtimeEvent>;

export const runtimeActor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), agentId: z.string().optional(), name: z.string().optional() }),
  z.object({ kind: z.literal("runtime"), runtimeKind: runtimeKindSchema, name: z.string().optional() }),
  z.object({ kind: z.literal("tool"), toolId: z.string(), name: z.string().optional() }),
  z.object({ kind: z.literal("system"), name: z.string().optional() }),
]);
export type RuntimeActor = z.infer<typeof runtimeActor>;

export const runtimeEventV2 = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    eventId: z.string(),
    seq: z.number().int().nonnegative(),
    actor: runtimeActor,
    content: z.string(),
  }),
  z.object({
    type: z.literal("thinking"),
    eventId: z.string(),
    seq: z.number().int().nonnegative(),
    actor: runtimeActor,
    content: z.string(),
  }),
  z.object({
    type: z.literal("tool_call.started"),
    eventId: z.string(),
    seq: z.number().int().nonnegative(),
    actor: runtimeActor,
    toolCallId: z.string(),
    toolId: z.string(),
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("tool_call.completed"),
    eventId: z.string(),
    seq: z.number().int().nonnegative(),
    actor: runtimeActor,
    toolCallId: z.string(),
    toolId: z.string(),
    output: z.unknown().optional(),
    status: z.enum(["succeeded", "failed"]),
    latencyMs: z.number().int().nonnegative().optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  }),
  z.object({
    type: z.literal("artifact.created"),
    eventId: z.string(),
    seq: z.number().int().nonnegative(),
    actor: runtimeActor,
    artifact: z.object({
      kind: z.enum(["summary", "markdown", "diff", "test", "file", "log"]),
      title: z.string(),
      content: z.unknown(),
    }),
  }),
  z.object({
    type: z.literal("error"),
    eventId: z.string(),
    seq: z.number().int().nonnegative(),
    actor: runtimeActor,
    message: z.string(),
    code: z.string().optional(),
  }),
]);
export type RuntimeEventV2 = z.infer<typeof runtimeEventV2>;
