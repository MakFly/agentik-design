/** Prefixed, URL-safe ids. Prefix makes ids self-describing in logs and URLs. */
export type IdPrefix =
  | "team"
  | "wf"
  | "ver"
  | "run"
  | "step"
  | "cred"
  // agent-execution harness
  | "agt"
  | "atask"
  | "amsg"
  | "chat"
  | "cmsg"
  | "daemon"
  | "runtime"
  // learning loop
  | "aver"
  | "mem"
  | "skill"
  | "sver"
  | "rev"
  // identity & org
  | "usr"
  | "sess"
  | "mbr"
  | "inv"
  // runtime provider keys (managed from the web UI, injected into the daemon)
  | "pkey"
  // bundle manager + generic org settings
  | "bcmd"
  | "oset";

export function genId(prefix: IdPrefix): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
