CREATE TABLE "bundle_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"daemon_id" text NOT NULL,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" text DEFAULT '' NOT NULL,
	"result" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_settings_team_key_unique" UNIQUE("team_id","key")
);
--> statement-breakpoint
ALTER TABLE "bundle_commands" ADD CONSTRAINT "bundle_commands_daemon_id_daemons_id_fk" FOREIGN KEY ("daemon_id") REFERENCES "public"."daemons"("id") ON DELETE cascade ON UPDATE no action;