CREATE TABLE IF NOT EXISTS "channel_deliveries" (
  "id" text PRIMARY KEY NOT NULL,
  "team_id" text NOT NULL,
  "connection_id" text NOT NULL REFERENCES "channel_connections"("id") ON DELETE CASCADE,
  "identity_id" text REFERENCES "channel_identities"("id") ON DELETE SET NULL,
  "session_id" text REFERENCES "channel_sessions"("id") ON DELETE SET NULL,
  "channel_message_id" text REFERENCES "channel_messages"("id") ON DELETE SET NULL,
  "provider" text NOT NULL,
  "external_message_id" text,
  "kind" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "parse_mode" text,
  "attempt" integer DEFAULT 0 NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" text,
  "run_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "channel_deliveries_team_idx" ON "channel_deliveries" ("team_id");
CREATE INDEX IF NOT EXISTS "channel_deliveries_run_idx" ON "channel_deliveries" ("run_id");
CREATE INDEX IF NOT EXISTS "channel_deliveries_status_idx" ON "channel_deliveries" ("status");
