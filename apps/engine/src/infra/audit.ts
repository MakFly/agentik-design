import { db, schema } from "./db/client";
import { genId } from "./db/ids";

export interface AuditEntry {
  teamId: string;
  /** User who performed the action; null/omitted for system actions. */
  actorId?: string | null;
  /** Stable action verb, e.g. "settings.providers_policy.update". */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Non-secret context only — never plaintext credentials. */
  metadata?: Record<string, unknown> | null;
}

/**
 * Append a sensitive mutation to the immutable audit trail. Best-effort: failures
 * are logged but never thrown into the caller — auditing must not break (or roll
 * back) the mutation it records.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      id: genId("audit"),
      teamId: entry.teamId,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (err) {
    console.error(`[audit] failed to record ${entry.action}:`, err);
  }
}
