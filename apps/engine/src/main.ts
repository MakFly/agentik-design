import { env } from "./infra/env";
import app from "./app/server";
import { hub, type WsData } from "./infra/hub";
import { handleControl } from "./infra/control";
import { resolveAuthFromRequest } from "./app/middleware/auth";
import { startTaskScanner } from "./jobs/task-scanner";
import { startScheduler } from "./jobs/scheduler";
import { startTelegramPolling } from "./domains/channels/telegram/poller";
import { startEmbeddedWorker } from "./execution/embedded/worker";
import { isSolo } from "./infra/mode";
import { ensureSoloSeed } from "./infra/solo-seed";

const server = Bun.serve<WsData>({
  port: env.PORT,
  idleTimeout: 120, // SSE streams need a generous idle window
  async fetch(req, srv) {
    const url = new URL(req.url);
    // Team-scoped realtime channel: lifecycle + presence + control.
    // Tenancy is resolved SERVER-SIDE exactly like HTTP routes — the session cookie is
    // authoritative; `?team=` is honored only as the dev fallback (AUTH_DEV_HEADERS).
    if (url.pathname === "/realtime") {
      const auth = await resolveAuthFromRequest(req);
      if (!auth || !auth.orgId) return new Response("unauthorized", { status: 401 });
      if (
        srv.upgrade(req, {
          data: { teamId: auth.orgId, userId: auth.userId, role: auth.role },
        })
      )
        return undefined;
      return new Response("upgrade failed", { status: 426 });
    }
    return app.fetch(req, srv);
  },
  websocket: {
    open(ws) {
      hub.add(ws.data.teamId, ws);
    },
    close(ws) {
      hub.remove(ws.data.teamId, ws);
    },
    message(ws, raw) {
      void handleControl(ws, raw);
    },
  },
});

console.log(`[engine] API + realtime listening on http://localhost:${server.port}`);

// Lifecycle scanner: times out stuck tasks and auto-retries the retryable ones.
// Single-owner across instances via a Postgres advisory lock (see task-scanner.ts).
startTaskScanner();

// Telegram long polling (default channel transport): pulls updates so bots work
// with only a token — no public webhook URL required. Single-owner via advisory lock.
startTelegramPolling();

// Cron scheduler for schedule-kind signals. Opt-in (SCHEDULER_ENABLED) so it never
// auto-fires unless explicitly turned on.
if (env.SCHEDULER_ENABLED) startScheduler();

// Embedded in-process worker. Opt-in (EMBEDDED_WORKER) so the standalone engine
// keeps relying on remote daemons unless explicitly turned on.
if (env.EMBEDDED_WORKER) {
  if (isSolo) await ensureSoloSeed();
  startEmbeddedWorker();
}
