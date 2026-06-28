-- Immutable audit trail of sensitive mutations (who did what, to which target, when).
-- metadata holds non-secret context only — never plaintext credentials.
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_team_created_idx" ON "audit_log" ("team_id","created_at");
