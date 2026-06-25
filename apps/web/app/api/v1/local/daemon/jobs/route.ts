import {
  sanitizeEngineUrl,
  sanitizeRuntimes,
  startInstallJob,
} from "../_daemon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    token?: string;
    engineUrl?: string;
    runtimes?: string;
    team?: string;
  } | null;
  const token = body?.token?.trim();
  if (!token) {
    return Response.json(
      { ok: false, message: "Missing daemon token." },
      { status: 400 },
    );
  }
  const engineUrl = sanitizeEngineUrl(body?.engineUrl);
  if (!engineUrl) {
    return Response.json(
      { ok: false, message: "Invalid engine URL." },
      { status: 400 },
    );
  }
  const job = await startInstallJob({
    token,
    engineUrl,
    runtimes: sanitizeRuntimes(body?.runtimes),
    team:
      typeof body?.team === "string" && body.team.trim()
        ? body.team.trim()
        : (request.headers.get("x-team") ?? undefined),
    cookie: request.headers.get("cookie"),
  });
  return Response.json({ jobId: job.id }, { status: 202 });
}
