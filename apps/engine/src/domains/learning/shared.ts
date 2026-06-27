/** Next monotonic version given existing version numbers. Starts at 1. */
export function nextVersion(existing: number[]): number {
  return existing.reduce((max, v) => (v > max ? v : max), 0) + 1;
}
