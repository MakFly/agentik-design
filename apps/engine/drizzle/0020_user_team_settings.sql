ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "ui_preferences" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "settings" jsonb NOT NULL DEFAULT '{}'::jsonb;
