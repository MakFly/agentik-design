-- Universal orchestration trees and generic signal/rule substrate.
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "parent_run_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_parent_run_id_idx" ON "runs" ("parent_run_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "signals" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL DEFAULT 'manual',
	"status" text NOT NULL DEFAULT 'active',
	"config" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_team_created_idx" ON "signals" ("team_id","created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "assistant_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL DEFAULT 'active',
	"signal_id" text REFERENCES "signals"("id") ON DELETE SET NULL,
	"condition" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"action" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_rules_team_created_idx" ON "assistant_rules" ("team_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_rules_signal_idx" ON "assistant_rules" ("signal_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "signal_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"signal_id" text REFERENCES "signals"("id") ON DELETE SET NULL,
	"rule_id" text REFERENCES "assistant_rules"("id") ON DELETE SET NULL,
	"status" text NOT NULL DEFAULT 'received',
	"payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"run_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_deliveries_team_created_idx" ON "signal_deliveries" ("team_id","created_at");
