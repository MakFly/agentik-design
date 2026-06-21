/** Prefixed, URL-safe ids. Prefix makes ids self-describing in logs and URLs. */
export type IdPrefix = "team" | "wf" | "ver" | "run" | "step";

export function genId(prefix: IdPrefix): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
