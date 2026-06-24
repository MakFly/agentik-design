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
