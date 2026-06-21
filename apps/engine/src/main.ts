import { env } from "./env";
import app from "./server";

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
  idleTimeout: 120, // SSE streams need a generous idle window
});

console.log(`[engine] API listening on http://localhost:${server.port}`);
