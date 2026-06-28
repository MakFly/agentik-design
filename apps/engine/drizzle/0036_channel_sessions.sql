CREATE TABLE IF NOT EXISTS "channel_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "team_id" text NOT NULL,
  "connection_id" text NOT NULL REFERENCES "channel_connections"("id") ON DELETE CASCADE,
  "identity_id" text REFERENCES "channel_identities"("id") ON DELETE SET NULL,
  "external_chat_id" text NOT NULL,
  "active_agent_id" text REFERENCES "agents"("id") ON DELETE SET NULL,
  "active_project_id" text,
  "active_run_id" text,
  "status" text DEFAULT 'active' NOT NULL,
  "state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "channel_sessions_team_idx" ON "channel_sessions" ("team_id");
CREATE INDEX IF NOT EXISTS "channel_sessions_connection_chat_idx" ON "channel_sessions" ("connection_id","external_chat_id");
