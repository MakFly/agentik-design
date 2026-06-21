import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
} from "ai";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPEN_AI ?? process.env.OPEN_AI_KEY;

  if (!apiKey) {
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        await writer.write({
          type: "text-delta",
          id: "fallback-text",
          delta:
            "This starter is running without OPENAI_API_KEY or OPEN_AI. Add one to .env.local to enable live AI responses.",
        });
      },
    });

    return createUIMessageStreamResponse({ stream });
  }

  const openai = createOpenAI({ apiKey });
  const result = streamText({
    model: openai(process.env.OPENAI_MODEL ?? "gpt-4.1-mini"),
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
