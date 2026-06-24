CREATE TABLE "provider_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"provider" text NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_keys_team_provider_unique" UNIQUE("team_id","provider")
);
