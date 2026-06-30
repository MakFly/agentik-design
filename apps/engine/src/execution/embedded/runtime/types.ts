/**
 * Embedded runtime adapter contract. An adapter turns a ClaimedTask into streamed
 * run messages + a final result, in-process — the solo-mode equivalent of the Go
 * daemon shelling out to a CLI. Two implementations: cli.ts (parity, spawns the
 * local CLI) and api.ts (zero-install, calls a provider via the AI SDK).
 */
import type { ClaimedTask, IncomingMessage } from "../../daemon/service";

export type Emit = (messages: IncomingMessage[]) => Promise<{ cancel: boolean }>;

export interface RuntimeAdapter {
  /** Label recorded on the run result + logs, e.g. "cli:claude" / "api:anthropic". */
  readonly label: string;
  run(
    task: ClaimedTask,
    emit: Emit,
    signal: AbortSignal,
  ): Promise<{ result: unknown }>;
}

export interface TaskInput {
  prompt: string;
  systemPrompt?: string;
  model?: string;
}

/** Pull the fields claimTask folds into `input` (preamble+prompt, systemPrompt, model). */
export function readTaskInput(task: ClaimedTask): TaskInput {
  const input = (
    task.input && typeof task.input === "object" ? task.input : {}
  ) as Record<string, unknown>;
  return {
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    systemPrompt:
      typeof input.systemPrompt === "string" ? input.systemPrompt : undefined,
    model: typeof input.model === "string" ? input.model : undefined,
  };
}
