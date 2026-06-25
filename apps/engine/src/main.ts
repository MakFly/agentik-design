import { env } from "./env";
import app from "./server";
import { hub, type WsData } from "./hub";
import { handleControl } from "./control";
import { resolveAuthFromRequest } from "./auth";
import { startTaskScanner } from "./task-scanner";

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
      if (srv.upgrade(req, { data: { teamId: auth.orgId } })) return undefined;
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
