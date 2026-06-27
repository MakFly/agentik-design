import { jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";
import { daemons } from "./agents";
import { ts, type BundleAction, type BundleCommandStatus } from "./_shared";

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Org-scoped token a daemon uses to register/claim for this org (issued at org creation). */
  daemonToken: text("daemon_token").unique(),
  /** Workspace-level settings (provider routing, cost ceiling, etc.). */
  settings: jsonb("settings").notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/**
 * Org-scoped runtime provider API keys, managed from the web Settings UI and
 * injected (decrypted) into the daemon at claim time so runtimes (hermes, claude…)
 * authenticate without any out-of-band config. `secret` is an AES-256-GCM blob
 * (see crypto.ts); the plaintext key never leaves the engine except into a claim.
 */
export const providerKeys = pgTable(
  "provider_keys",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    provider: text("provider").notNull(), // openrouter | openai | anthropic | google
    secret: text("secret").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("provider_keys_team_provider_unique").on(t.teamId, t.provider)],
);

/* ── Bundle manager (install/provision agent CLIs on a daemon host) ───── */

/**
 * A request to install/upgrade/uninstall an agent CLI on a specific daemon host.
 * The engine NEVER ships a shell command — it ships a validated {kind, action}; the
 * daemon maps that to a compile-time installer arg-vector from its own allowlist.
 */
export const bundleCommands = pgTable("bundle_commands", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  daemonId: text("daemon_id")
    .notNull()
    .references(() => daemons.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // CLI/runtime kind: claude | codex | gemini | …
  action: text("action").$type<BundleAction>().notNull(),
  status: text("status").$type<BundleCommandStatus>().notNull().default("queued"),
  requestedBy: text("requested_by").notNull().default(""),
  result: text("result"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  startedAt: ts("started_at"),
  endedAt: ts("ended_at"),
});

/**
 * Generic per-org persisted settings (key → jsonb). Lets behavior flags live in the
 * DB / Settings UI instead of process env (e.g. bundle.network_install). Read-through
 * defaults are applied in code, so an absent row means "default".
 */
export const orgSettings = pgTable(
  "org_settings",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("org_settings_team_key_unique").on(t.teamId, t.key)],
);
