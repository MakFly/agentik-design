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
  | "amsg"
  | "chat"
  | "cmsg"
  // project/task cockpit
  | "proj"
  | "pres"
  | "ptask"
  | "pmsg"
  | "pwsp"
  // external channel control surfaces
  | "chan"
  | "chident"
  | "chmsg"
  | "daemon"
  | "runtime"
  | "mcp"
  | "mtool"
  // learning loop
  | "aver"
  | "mem"
  | "mevt"
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
