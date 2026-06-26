ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "onboarding_questionnaire" jsonb NOT NULL DEFAULT '{}'::jsonb;
