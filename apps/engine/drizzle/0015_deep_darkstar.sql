ALTER TABLE "channel_connections" ADD COLUMN "transport" text DEFAULT 'polling' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "poll_offset" bigint DEFAULT 0 NOT NULL;