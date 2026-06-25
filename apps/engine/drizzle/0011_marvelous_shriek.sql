ALTER TABLE "app_users" ADD COLUMN "daemon_token_hash" text;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "daemon_token_prefix" text;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "daemon_token_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_daemon_token_prefix_unique" UNIQUE("daemon_token_prefix");
