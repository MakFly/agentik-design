/**
 * CLI runtime adapter — parity with the platform Go daemon, in-process. Spawns the
 * local runtime CLI and streams its output as run messages. `claude` is parsed
 * faithfully (stream-json NDJSON, mirroring apps/daemon/internal/runtime/claude.go);
 * other CLIs use a generic single-shot capture (the Go daemon stays the
 * production-grade multi-CLI executor for platform mode).
 */
import { readTaskInput, type Emit, type RuntimeAdapter } from "./types";
import type { IncomingMessage } from "../../daemon/service";

const KIND_BIN: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  hermes: "hermes",
};

/** Absolute path to the CLI for a runtime kind if it is on PATH, else null. */
export function cliBinaryFor(kind: string): string | null {
  const bin = KIND_BIN[kind];
  return bin ? Bun.which(bin) : null;
}

export function cliAdapter(kind: string, binPath: string): RuntimeAdapter {
  return {
    label: `cli:${kind}`,
    async run(task, emit, signal) {
      const { prompt, systemPrompt, model } = readTaskInput(task);
      if (!prompt.trim()) throw new Error("empty prompt");
      const env = { ...process.env, ...(task.env ?? {}) } as Record<string, string>;
      return kind === "claude"
        ? runClaude(binPath, { prompt, systemPrompt, model }, env, emit, signal)
        : runGeneric(kind, binPath, prompt, env, emit, signal);
    },
  };
}

interface ClaudeBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
}
interface ClaudeEvent {
  type: string;
  message?: { content?: ClaudeBlock[] };
  total_cost_usd?: number;
  result?: unknown;
}

async function runClaude(
  bin: string,
  input: { prompt: string; systemPrompt?: string; model?: string },
  env: Record<string, string>,
  emit: Emit,
  signal: AbortSignal,
): Promise<{ result: unknown }> {
  const args = ["-p", input.prompt, "--output-format", "stream-json", "--verbose"];
  if (input.systemPrompt?.trim()) args.push("--append-system-prompt", input.systemPrompt);
  if (input.model?.trim()) args.push("--model", input.model);

  const proc = Bun.spawn([bin, ...args], { env, stdout: "pipe", stderr: "inherit" });
  const onAbort = () => proc.kill();
  signal.addEventListener("abort", onAbort);

  let seq = 0;
  let result: unknown = null;
  try {
    for await (const line of readLines(proc.stdout)) {
      if (!line) continue;
      let ev: ClaudeEvent;
      try {
        ev = JSON.parse(line) as ClaudeEvent;
      } catch {
        continue; // tolerate non-JSON noise
      }
      if (ev.type === "result") {
        result = { ...(typeof ev.result === "object" && ev.result ? ev.result : { result: ev.result }), cost_usd: ev.total_cost_usd };
        continue;
      }
      if (ev.type !== "assistant" || !ev.message?.content) continue;
      const msgs: IncomingMessage[] = [];
      for (const b of ev.message.content) {
        if (b.type === "text" && b.text) msgs.push({ seq: ++seq, type: "text", content: b.text });
        else if (b.type === "thinking" && b.thinking) msgs.push({ seq: ++seq, type: "thinking", content: b.thinking });
        else if (b.type === "tool_use") msgs.push({ seq: ++seq, type: "tool_use", tool: b.name, input: b.input });
      }
      if (msgs.length) {
        const { cancel } = await emit(msgs);
        if (cancel) {
          proc.kill();
          break;
        }
      }
    }
    await proc.exited;
    if (proc.exitCode && proc.exitCode !== 0 && !signal.aborted)
      throw new Error(`claude exited ${proc.exitCode}`);
    return { result: result ?? { runtime: "cli:claude", steps: seq } };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Best-effort single-shot capture for non-claude CLIs: `<bin> -p <prompt>` → text. */
async function runGeneric(
  kind: string,
  bin: string,
  prompt: string,
  env: Record<string, string>,
  emit: Emit,
  signal: AbortSignal,
): Promise<{ result: unknown }> {
  const proc = Bun.spawn([bin, "-p", prompt], { env, stdout: "pipe", stderr: "inherit" });
  const onAbort = () => proc.kill();
  signal.addEventListener("abort", onAbort);
  try {
    const out = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    if (proc.exitCode && proc.exitCode !== 0 && !signal.aborted)
      throw new Error(`${kind} exited ${proc.exitCode}`);
    if (out) await emit([{ seq: 1, type: "text", content: out }]);
    return { result: { runtime: `cli:${kind}`, summary: out.slice(0, 280) } };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Yield decoded lines from a byte stream, buffering partial lines across chunks. */
async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, nl);
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) yield buf;
}
