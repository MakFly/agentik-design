-- Per-connection routing policy (which agent answers, group-chat listen rules).
CREATE TABLE IF NOT EXISTS "channel_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"connection_id" text NOT NULL REFERENCES "channel_connections"("id") ON DELETE CASCADE,
	"agent_id" text REFERENCES "agents"("id") ON DELETE SET NULL,
	"group_policy" text NOT NULL DEFAULT 'off',
	"require_mention" boolean NOT NULL DEFAULT true,
	"config" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"status" text NOT NULL DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_bindings_connection_agent_unique" ON "channel_bindings" ("connection_id","agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_bindings_team_idx" ON "channel_bindings" ("team_id");
