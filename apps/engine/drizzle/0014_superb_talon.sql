CREATE TABLE "channel_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"provider" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'setup' NOT NULL,
	"bot_token_encrypted" text,
	"webhook_secret" text NOT NULL,
	"pairing_code" text NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_identity_connection_user_chat_unique" UNIQUE("connection_id","external_user_id","external_chat_id")
);
--> statement-breakpoint
CREATE TABLE "channel_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"identity_id" text,
	"external_message_id" text,
	"direction" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"payload" jsonb,
	"run_id" text,
	"project_id" text,
	"project_task_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_identity_id_channel_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE set null ON UPDATE no action;