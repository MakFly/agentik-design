import { jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";
import { ts, type OrgRole } from "./_shared";
import { teams } from "./settings";

/** A person. Named app_users to avoid the legacy Laravel `users` table in the shared dev DB. */
export const appUsers = pgTable("app_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull().default(""),
  emailVerifiedAt: ts("email_verified_at"),
  /** One-time email-verification token; cleared once verified. */
  verifyToken: text("verify_token"),
  /** 6-digit OTP for email verification; cleared once verified. */
  verifyCode: text("verify_code"),
  verifyCodeExpiresAt: ts("verify_code_expires_at"),
  /** Onboarding questionnaire answers (source, role, use_case). */
  onboardingQuestionnaire: jsonb("onboarding_questionnaire").notNull().default({}),
  /** Client UI prefs synced across devices (reduce motion, submit mode, theme). */
  uiPreferences: jsonb("ui_preferences").notNull().default({}),
  /** Email / in-app notification toggles. */
  notificationPreferences: jsonb("notification_preferences").notNull().default({}),
  /** Personal daemon token metadata. The token itself is revealed once and stored as a hash only. */
  daemonTokenHash: text("daemon_token_hash"),
  daemonTokenPrefix: text("daemon_token_prefix").unique(),
  daemonTokenIssuedAt: ts("daemon_token_issued_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** A logged-in session. `token` is the high-entropy value stored in an httpOnly cookie. */
export const userSessions = pgTable("user_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Membership of a user in an org (= team) with a role. One org = one team. */
export const orgMembers = pgTable(
  "org_members",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    role: text("role").$type<OrgRole>().notNull().default("viewer"),
    /** When the member finished the post-signup welcome onboarding for this org. */
    onboardingCompletedAt: ts("onboarding_completed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("org_members_team_user_unique").on(t.teamId, t.userId)],
);

/** Pending invitation to join an org. `token` backs the invite link. */
export const orgInvitations = pgTable("org_invitations", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<OrgRole>().notNull().default("viewer"),
  token: text("token").notNull().unique(),
  invitedBy: text("invited_by"),
  acceptedAt: ts("accepted_at"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

