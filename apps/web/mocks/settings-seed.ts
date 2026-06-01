import type { UserId } from "@/types/domain";
import type {
  ApiKey,
  Provider,
  Member,
  Billing,
  SecurityPolicy,
  AuditEntry,
} from "@/features/settings/types";

const usd = (amountCents: number) => ({ amountCents, currency: "USD" as const });

// ── API keys ──────────────────────────────────────────────────────────────
export const apiKeys: ApiKey[] = [
  { id: "key_ci", name: "CI pipeline", prefix: "ak_live_9f3c••••", scopes: ["read", "write"], createdAt: "2026-03-12T10:00:00Z", lastUsedAt: "2026-05-31T13:55:00Z", createdBy: "alice" },
  { id: "key_dash", name: "Internal dashboard", prefix: "ak_live_2b7a••••", scopes: ["read"], createdAt: "2026-04-02T09:30:00Z", lastUsedAt: "2026-05-31T09:12:00Z", createdBy: "bob" },
  { id: "key_admin", name: "Terraform (infra)", prefix: "ak_live_c1d8••••", scopes: ["read", "write", "admin"], createdAt: "2026-01-20T08:00:00Z", lastUsedAt: null, createdBy: "alice" },
];

// ── Providers ─────────────────────────────────────────────────────────────
export const providers: Provider[] = [
  { id: "prov_anthropic", kind: "anthropic", label: "Anthropic", status: "active", hasKey: true, models: ["claude-opus-4", "claude-sonnet-4", "claude-haiku-4.5"], isDefault: true },
  { id: "prov_openai", kind: "openai", label: "OpenAI", status: "active", hasKey: true, models: ["gpt-4o", "o4-mini"], isDefault: false },
  { id: "prov_selfhosted", kind: "self-hosted", label: "Self-hosted", status: "off", hasKey: false, models: [], isDefault: false, baseUrl: "https://llm.internal" },
];

export const fallbackOrder = ["prov_anthropic", "prov_openai"];
export const costCeilingPerDay = usd(20000); // $200/day

// ── Team / members ──────────────────────────────────────────────────────────
export const members: Member[] = [
  { id: "usr_alice" as UserId, name: "Alice Martin", email: "alice@acme.dev", role: "owner", status: "active", lastActiveAt: "2026-05-31T14:22:00Z" },
  { id: "usr_bob" as UserId, name: "Bob Chen", email: "bob@acme.dev", role: "admin", status: "active", lastActiveAt: "2026-05-31T11:40:00Z" },
  { id: "usr_carol" as UserId, name: "Carol Diaz", email: "carol@acme.dev", role: "engineer", status: "active", lastActiveAt: "2026-05-30T17:05:00Z" },
  { id: "usr_dan" as UserId, name: "Dan Okoro", email: "dan@acme.dev", role: "operator", status: "active", lastActiveAt: "2026-05-31T08:15:00Z" },
  { id: "usr_eve" as UserId, name: "Eve Laurent", email: "eve@acme.dev", role: "viewer", status: "active", lastActiveAt: "2026-05-29T12:00:00Z" },
  { id: "usr_frank" as UserId, name: "Frank Weiss", email: "frank@contractor.io", role: "engineer", status: "invited", lastActiveAt: null },
];

export const team = {
  defaultRole: "viewer" as const,
  ssoEnabled: true,
  scimEnabled: false,
};

// ── Billing ──────────────────────────────────────────────────────────────
export const billing: Billing = {
  plan: "Team",
  includedRuns: 50_000,
  usedRuns: 38_240,
  includedSpend: usd(50000),
  usedSpend: usd(41880),
  budgetPerMonth: usd(60000),
  spendByAgent: [
    { agent: "Resolve Agent", amount: usd(18420), runs: 4260 },
    { agent: "Triage Agent", amount: usd(11200), runs: 6300 },
    { agent: "Summarizer", amount: usd(7640), runs: 1920 },
    { agent: "Scraper", amount: usd(2980), runs: 2640 },
    { agent: "Invoice Agent", amount: usd(1640), runs: 900 },
  ],
  invoices: [
    { id: "inv_2605", period: "May 2026", amount: usd(41880), status: "open" },
    { id: "inv_2604", period: "Apr 2026", amount: usd(47210), status: "paid" },
    { id: "inv_2603", period: "Mar 2026", amount: usd(39950), status: "paid" },
  ],
};

// ── Security ─────────────────────────────────────────────────────────────
export const security: SecurityPolicy = {
  ipAllowlist: ["10.0.0.0/8", "192.168.1.0/24"],
  egressAllowlist: ["api.stripe.com", "*.acme.dev", "hooks.slack.com"],
  piiPolicy: "redact",
  dataResidency: "eu",
  secretRotationDays: 90,
  requireApprovalForProd: true,
  sessionTimeoutMinutes: 480,
};

// ── Audit log ───────────────────────────────────────────────────────────────
export const auditLog: AuditEntry[] = [
  { id: "aud_01", at: "2026-05-31T14:22:11Z", actor: "Alice Martin", action: "agent.publish", resource: "agent", target: "Resolve Agent v4", ip: "10.0.4.12", suspicious: false },
  { id: "aud_02", at: "2026-05-31T13:55:02Z", actor: "CI pipeline", action: "run.create", resource: "run", target: "run_8f2", ip: "34.120.0.9", suspicious: false },
  { id: "aud_03", at: "2026-05-31T11:40:48Z", actor: "Bob Chen", action: "member.role_change", resource: "settings", target: "carol@acme.dev → engineer", ip: "10.0.4.20", suspicious: false },
  { id: "aud_04", at: "2026-05-31T09:12:33Z", actor: "Dan Okoro", action: "run.approve", resource: "run", target: "run_7c1 (prod)", ip: "10.0.4.31", suspicious: false },
  { id: "aud_05", at: "2026-05-30T23:47:10Z", actor: "unknown", action: "auth.login_failed", resource: "settings", target: "alice@acme.dev ×5", ip: "203.0.113.77", suspicious: true },
  { id: "aud_06", at: "2026-05-30T18:02:55Z", actor: "Alice Martin", action: "apikey.create", resource: "settings", target: "CI pipeline", ip: "10.0.4.12", suspicious: false },
  { id: "aud_07", at: "2026-05-30T17:05:21Z", actor: "Carol Diaz", action: "tool.update", resource: "tool", target: "Postgres connector", ip: "10.0.4.44", suspicious: false },
  { id: "aud_08", at: "2026-05-30T08:30:00Z", actor: "Bob Chen", action: "provider.disable", resource: "settings", target: "Self-hosted", ip: "10.0.4.20", suspicious: false },
  { id: "aud_09", at: "2026-05-29T22:14:09Z", actor: "unknown", action: "apikey.use_revoked", resource: "settings", target: "ak_live_0000••••", ip: "198.51.100.23", suspicious: true },
  { id: "aud_10", at: "2026-05-29T12:00:41Z", actor: "Eve Laurent", action: "settings.security_update", resource: "settings", target: "data residency → eu", ip: "10.0.4.55", suspicious: false },
];
