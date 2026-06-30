import { z } from "zod";

/** Treat an empty env var ("") as unset, so `DATABASE_URL=` falls back to solo/default. */
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

/** Bun auto-loads `.env`. Validate it once at boot so misconfig fails loudly. */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  /** Postgres URL — required in platform mode; unset in solo (embedded PGlite). */
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  REDIS_URL: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default("redis://localhost:6379"),
  ),
  OPENAI_API_KEY: z.string().optional(),
  /** Secret used to derive the AES-256 key for credential encryption at rest. */
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(16).optional(),
  /** Public base URL of the engine — used to build the OAuth redirect URI. */
  ENGINE_PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  /** Public base URL of the web app — where the OAuth popup returns. */
  WEB_PUBLIC_URL: z.string().url().default("http://localhost:3333"),
  /** Telegram polling cadence in ms. Lower values make local bots feel instant. */
  TELEGRAM_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(500),
  /** Default Google OAuth2 app credentials (used unless a credential overrides). */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Per-team API rate limit: max authenticated requests per window (fixed window). */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  /** Agent-execution harness. The daemon authenticates with this shared token. */
  DAEMON_ENABLED: z.coerce.boolean().default(false),
  DAEMON_AUTH_TOKEN: z.string().min(16).optional(),
  /**
   * Allow the dev x-team/x-role header fallback when there is no session cookie.
   * Defaults true for local dev/tests; set "false" in production so unauthenticated
   * requests are rejected and tenancy is never trusted from the client.
   * NOTE: parsed by string compare — z.coerce.boolean treats "false" as true.
   */
  AUTH_DEV_HEADERS: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  /** Opt-in cron scheduler for schedule-kind signals. Off unless "true". */
  SCHEDULER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /**
   * Opt-in embedded in-process worker (solo mode): claims the runs queue and
   * executes runtimes locally instead of relying on a remote Go daemon. Off unless
   * "true". `make up` turns it on.
   */
  EMBEDDED_WORKER: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid engine environment:\n", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
