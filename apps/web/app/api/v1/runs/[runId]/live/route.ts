import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Workflow engine (apps/engine). Same default as next.config rewrites.
const API_URL = process.env.API_URL ?? "http://localhost:8787";

/**
 * SSE proxy for live run status. The catch-all Next rewrite buffers streaming
 * responses, so EventSource never receives incremental `run` events through it.
 * This dedicated route handler pipes the engine's SSE body straight to the
 * client, unbuffered — which is what drives the per-node loader on the canvas.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;

  const upstream = await fetch(`${API_URL}/api/v1/runs/${runId}/live`, {
    headers: { accept: "text/event-stream" },
    signal: req.signal,
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(`upstream error ${upstream.status}`, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
