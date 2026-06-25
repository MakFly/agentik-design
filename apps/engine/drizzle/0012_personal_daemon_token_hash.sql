ALTER TABLE "app_users" DROP CONSTRAINT IF EXISTS "app_users_daemon_token_unique";--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "daemon_token_hash" text;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "daemon_token_prefix" text;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "daemon_token_issued_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_users" ADD CONSTRAINT "app_users_daemon_token_prefix_unique" UNIQUE("daemon_token_prefix");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "app_users" DROP COLUMN IF EXISTS "daemon_token";
