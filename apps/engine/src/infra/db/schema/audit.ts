import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { ts } from "./_shared";

/**
 * Immutable audit trail of sensitive mutations (who did what, to which target, when).
 * Cross-cutting infra concern, not owned by a single domain. `metadata` holds
 * non-secret context only — never plaintext credentials. Append-only by convention.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    /** User who performed the action; null for system/automated actions. */
    actorId: text("actor_id"),
    /** Stable action verb, e.g. "settings.providers_policy.update", "member.invite". */
    action: text("action").notNull(),
    /** Affected entity kind + id, e.g. ("provider_key", "anthropic"). */
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Non-secret structured context for the action. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_team_created_idx").on(t.teamId, t.createdAt)],
);
