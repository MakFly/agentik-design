/**
 * Unified single-process server (solo mode): ONE public origin serving the Next
 * UI, the Hono API and the realtime WebSocket — no separate `next dev` + engine
 * processes.
 *
 * Design: Bun.serve owns the public origin (it keeps the engine's Bun-native WS
 * upgrade and `app.fetch`). The Next UI runs on an internal loopback listener via
 * its documented custom-server handler (Node `(req,res)`); Bun.serve forwards
 * every non-API request to it. One process, one public origin, no fragile
 * Web→Node request bridge. See plan: ~/.claude/plans/modular-munching-kettle.md.
 */
import path from "path";
import http from "http";
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

const PUBLIC_PORT = Number(process.env.UNIFIED_PORT ?? "3333");
const NEXT_PORT = Number(process.env.NEXT_INTERNAL_PORT ?? "3334");
const webDir = path.resolve(import.meta.dir, "../../web");
const dev = process.env.NODE_ENV !== "production";

// Boot the Next UI on a loopback listener. `next` lives in apps/web, so resolve
// it from there rather than depending on it in the engine package.
const nextEntry = Bun.resolveSync("next", webDir);
type NextApp = { getRequestHandler(): http.RequestListener; prepare(): Promise<void> };
const nextFactory = (await import(nextEntry)).default as (opts: {
  dev: boolean;
  dir: string;
}) => NextApp;
const nextApp = nextFactory({ dev, dir: webDir });
const nextHandler = nextApp.getRequestHandler();
await nextApp.prepare();
const nextServer = http.createServer((req, res) => nextHandler(req, res));
await new Promise<void>((resolve) => nextServer.listen(NEXT_PORT, "127.0.0.1", resolve));

// Requests the engine owns directly; everything else is the UI.
function isEnginePath(pathname: string): boolean {
  return (
    pathname === "/health" ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/daemon")
  );
}

const server = Bun.serve<WsData>({
  port: PUBLIC_PORT,
  idleTimeout: 120, // SSE streams need a generous idle window
  async fetch(req, srv) {
    const url = new URL(req.url);

    // Realtime channel — same origin now; tenancy resolved server-side.
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

    if (isEnginePath(url.pathname)) return app.fetch(req, srv);

    // UI → forward to the internal Next listener.
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const upstream = await fetch(`http://127.0.0.1:${NEXT_PORT}${url.pathname}${url.search}`, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? req.body : undefined,
      ...(hasBody ? { duplex: "half" } : {}),
      redirect: "manual",
    } as RequestInit);
    // Bun's fetch transparently decodes the body but leaves content-encoding/length
    // headers in place; forwarding them makes the client try to decode already-decoded
    // bytes (curl error 61 / a blank page in real browsers). Strip the framing headers
    // and let Bun.serve re-frame the (already-decoded) stream.
    const headers = new Headers(upstream.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
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

console.log(
  `[agentik] unified server on http://localhost:${server.port} (UI + API + realtime)`,
);

// Solo: seed the default team before the worker registers / the browser connects.
if (isSolo) await ensureSoloSeed();

// Same background jobs as the standalone engine (main.ts).
startTaskScanner();
startTelegramPolling();
if (env.SCHEDULER_ENABLED) startScheduler();

// Solo mode executes runs in-process (no remote Go daemon). Default on for the
// unified server unless explicitly disabled.
if (process.env.EMBEDDED_WORKER !== "false") startEmbeddedWorker();
