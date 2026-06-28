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
  | "asub"
  | "amsg"
  | "revt"
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
  | "chbind"
  | "chmsg"
  | "chsess"
  | "chdel"
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
  // runtime subscription OAuth tokens (e.g. Codex via ChatGPT)
  | "roauth"
  // bundle manager + generic org settings
  | "bcmd"
  | "oset"
  // audit trail
  | "audit"
  // universal signal/rule layer
  | "sig"
  | "rule"
  | "sdel";

export function genId(prefix: IdPrefix): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
