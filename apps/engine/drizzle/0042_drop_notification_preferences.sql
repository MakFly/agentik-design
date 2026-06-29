-- Drop the user notification_preferences column. The Account settings "Notifications"
-- tab was write-only: the 7 toggles persisted here but no engine code ever read them
-- (no email/in-app notification dispatch consulted them). Removing the dead UI + endpoint,
-- so the backing column goes too.
--
-- Destructive & irreversible: this discards any stored per-user notification toggles.
-- Acceptable because nothing consumed them — the data had no effect.
ALTER TABLE "app_users" DROP COLUMN IF EXISTS "notification_preferences";
