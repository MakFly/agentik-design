/**
 * In-process chat gateway — the interactive fast-path, modeled on OpenClaw's embedded
 * agent runtime: a chat turn runs synchronously in this process and streams straight back
 * (no `runs` queue, no daemon claim). Reasoning is streamed live (and, like OpenClaw's
 * `isReasoning` payloads, not persisted); only the final user+assistant turns land in
 * `chat_messages` (the transcript). Turns that need the async lane — CLI/daemon runtimes,
 * missing provider key, or a deterministic builtin skill — are declined here so the caller
 * falls back to the queue path (sendChatMessage + /runs/:id/messages/live).
 */
import { and, eq, sql } from "drizzle-orm";
import { streamText } from "ai";
import { db, schema } from "../../infra/db/client";
import { genId } from "../../infra/db/ids";
import { resolveProviderEnv } from "../settings/providers-repo";
import { resolveInjectionContext, buildInjectionPreamble } from "../learning";
import {
  resolveApiProvider,
  buildModel,
  reasoningProviderOptions,
} from "../../execution/embedded/runtime/api";
import { appendAssistantTurn, buildChatPrompt } from "./repo";
import { agentHasBuiltinSkill } from "./skills";

const { chatSessions, chatMessages, agents } = schema;

export type ChatStreamResult =
  | { ok: true; response: Response }
  | { ok: false; status: number; error: string };

/**
 * Run a chat turn in-process and return an assistant-ui UIMessage stream. Returns
 * `{ ok:false, status:409, error:"no_api_runtime" }` when the turn belongs on the queue
 * path (no API provider for this runtime, or the agent has a builtin skill).
 */
export async function streamChatTurn(
  teamId: string,
  sessionId: string,
  content: string,
): Promise<ChatStreamResult> {
  const [row] = await db
    .select({
      agentId: chatSessions.agentId,
      runtimeKind: agents.runtimeKind,
      config: agents.config,
    })
    .from(chatSessions)
    .innerJoin(agents, eq(agents.id, chatSessions.agentId))
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.teamId, teamId)))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "not_found" };

  // Builtin skills are fulfilled server-side on the queue path — don't run a plain LLM
  // turn here that would bypass them.
  if (agentHasBuiltinSkill(row.config)) {
    return { ok: false, status: 409, error: "no_api_runtime" };
  }

  // Resolve a usable API provider from the team's keys; null → CLI/daemon runtime or no
  // key, which the queue path handles.
  const env = await resolveProviderEnv(teamId);
  const provider = resolveApiProvider(row.runtimeKind, env);
  if (!provider) return { ok: false, status: 409, error: "no_api_runtime" };
  const apiKey = env[provider.envVar];
  if (!apiKey) return { ok: false, status: 409, error: "no_api_runtime" };

  // Same context the daemon claim path assembles: learned-context preamble + the agent's
  // persona (systemPrompt) + model.
  const ctx = await resolveInjectionContext(teamId, row.agentId);
  const modelId = ctx.model ?? provider.defaultModel;

  // Persist the user turn, then build the multi-turn prompt (excludes the turn we just
  // inserted), mirroring sendChatMessage.
  const userMsgId = genId("cmsg");
  await db
    .insert(chatMessages)
    .values({ id: userMsgId, chatSessionId: sessionId, role: "user", content });
  await db
    .update(chatSessions)
    .set({ updatedAt: sql`now()` })
    .where(eq(chatSessions.id, sessionId));
  const prompt = buildInjectionPreamble(ctx) + (await buildChatPrompt(sessionId, userMsgId, content));

  const result = streamText({
    model: buildModel(provider, modelId, apiKey),
    system: ctx.systemPrompt,
    prompt,
    providerOptions: reasoningProviderOptions(provider, modelId),
    // Persist the final assistant turn (transcript) + notify the UI. Reasoning is live-only.
    onFinish: async ({ text }) => {
      await appendAssistantTurn(teamId, sessionId, genId("run"), text);
    },
  });

  return {
    ok: true,
    response: result.toUIMessageStreamResponse({
      sendReasoning: true,
      onError: (err) => (err instanceof Error ? err.message : "stream error"),
    }),
  };
}
