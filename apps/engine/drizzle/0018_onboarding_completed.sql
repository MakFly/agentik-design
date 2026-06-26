ALTER TABLE "org_members" ADD COLUMN IF NOT EXISTS "onboarding_completed_at" timestamp with time zone;
-- Existing members already use the app — don't force them through welcome again.
UPDATE "org_members" SET "onboarding_completed_at" = NOW() WHERE "onboarding_completed_at" IS NULL;
