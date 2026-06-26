ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "verify_code" text;
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "verify_code_expires_at" timestamp with time zone;
