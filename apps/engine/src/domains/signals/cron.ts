/**
 * Minimal 5-field cron matcher (minute hour day-of-month month day-of-week).
 * Supports: *  n  a,b,c  a-b  *​/n  a-b/n. Day-of-week 0 or 7 = Sunday.
 * Matching is minute-granular against the fields of the provided Date (caller chooses
 * the timezone by passing an appropriately-shifted Date).
 */

function matchField(field: string, value: number, min: number, max: number): boolean {
  for (const part of field.split(",")) {
    const segments = part.split("/");
    const rangePart = segments[0] ?? "*";
    const stepPart = segments[1];
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isFinite(step) || step < 1) continue;
    let lo: number;
    let hi: number;
    if (rangePart === "*" || rangePart === "") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = hi = Number(rangePart);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    for (let v = lo; v <= hi; v += step) {
      if (v === value) return true;
    }
  }
  return false;
}

export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dom, month, dowRaw] = parts as [string, string, string, string, string];
  // Normalize Sunday: cron allows 0 or 7; JS getDay() returns 0.
  const dow = dowRaw.replace(/7/g, "0");
  return (
    matchField(minute, date.getMinutes(), 0, 59) &&
    matchField(hour, date.getHours(), 0, 23) &&
    matchField(dom, date.getDate(), 1, 31) &&
    matchField(month, date.getMonth() + 1, 1, 12) &&
    matchField(dow, date.getDay(), 0, 6)
  );
}
