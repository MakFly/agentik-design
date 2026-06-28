/**
 * Cron scheduler tick: every interval, fire any active schedule-kind signal whose
 * cron expression matches the current minute — once per minute (in-process dedup).
 * Opt-in via SCHEDULER_ENABLED so it never auto-fires unless asked.
 *
 * Safety: scheduled signals dispatch through the SAME condition-gated path as every
 * other trigger, so a misconfigured rule still can't fire on a non-matching payload.
 */
import { dueScheduledSignals, dispatchSignal } from "../domains/signals/service";

function minuteKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}

export function startScheduler(intervalMs = 30_000): () => void {
  const fired = new Set<string>(); // `${signalId}@${minuteKey}` — prevents double-fire within a minute

  const tick = async () => {
    const now = new Date();
    const mk = minuteKey(now);
    try {
      const due = await dueScheduledSignals(now);
      for (const signal of due) {
        const key = `${signal.id}@${mk}`;
        if (fired.has(key)) continue;
        fired.add(key);
        await dispatchSignal(signal.teamId, signal.id, {
          payload: { trigger: "cron", firedAt: now.toISOString() },
        });
      }
      // Bound the dedup set: keep only this minute's keys.
      for (const key of fired) if (!key.endsWith(`@${mk}`)) fired.delete(key);
    } catch (err) {
      console.error("[scheduler] tick failed:", err);
    }
  };

  void tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
