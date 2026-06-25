import {
  DEFAULT_ENGINE_URL,
  getLocalDaemonStatus,
  markEnginePersonalDaemonOffline,
  startLocalDaemon,
  stopLocalDaemon,
  uninstallLocalDaemon,
} from "./_daemon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getLocalDaemonStatus());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    action?: string;
  } | null;
  if (body?.action === "start") {
    const status = await startLocalDaemon({
      engineUrl: DEFAULT_ENGINE_URL,
      team: request.headers.get("x-team") ?? undefined,
      cookie: request.headers.get("cookie"),
    });
    return Response.json(
      status.ok
        ? status
        : {
            ...status,
            message:
              status.status ||
              "Daemon started locally, but the engine did not report it online yet.",
          },
      { status: status.ok ? 200 : 409 },
    );
  }
  if (body?.action === "stop") {
    const status = await stopLocalDaemon();
    await markEnginePersonalDaemonOffline({
      engineUrl: DEFAULT_ENGINE_URL,
      team: request.headers.get("x-team") ?? undefined,
      cookie: request.headers.get("cookie"),
    });
    return Response.json(status);
  }
  return Response.json(
    { ok: false, message: "Expected action start or stop." },
    { status: 400 },
  );
}

export async function DELETE() {
  return Response.json(await uninstallLocalDaemon());
}
