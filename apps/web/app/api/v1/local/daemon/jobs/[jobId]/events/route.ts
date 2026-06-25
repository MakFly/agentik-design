import { getInstallJob, type InstallEvent } from "../../../_daemon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function encode(event: InstallEvent): string {
  return `event: ${event.phase}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await ctx.params;
  const job = getInstallJob(jobId);
  if (!job) {
    return Response.json(
      {
        ok: false,
        error: "job_not_found",
        message: "Install job not found or expired.",
      },
      { status: 404 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: InstallEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encode(event)));
        if ("terminal" in event && event.terminal) {
          closed = true;
          job.subscribers.delete(send);
          controller.close();
        }
      };

      for (const event of job.events) send(event);
      if (!job.done) job.subscribers.add(send);

      request.signal.addEventListener("abort", () => {
        job.subscribers.delete(send);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
