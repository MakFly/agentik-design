import type { Money, ISODate, UserId, TeamId } from "@/types/domain";
import type { Role } from "@/config/permissions";

/** Settings domain types (docs/01 §4.10). All money is in cents. */

// ── API keys ───────────────────────────────────────────────────────────────
export type ApiKeyScope = "read" | "write" | "admin";

export interface ApiKey {
  id: string;
  name: string;
  /** masked display, e.g. "ak_live_a1b2••••" — the secret is never returned after creation */
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: ISODate;
  lastUsedAt: ISODate | null;
  createdBy: string;
}

/** Returned exactly once on creation; the plaintext secret is shown, then discarded. */
export interface ApiKeyCreated extends ApiKey {
  secret: string;
}

// ── Providers ────────────────────────────────────────────────────────────────
export type ProviderKind = "anthropic" | "openai" | "self-hosted";
export type ProviderStatus = "active" | "off" | "testing";

export interface Provider {
  id: string;
  kind: ProviderKind;
  label: string;
  status: ProviderStatus;
  /** a key is configured (write-only — value never leaves the server) */
  hasKey: boolean;
  models: string[];
  isDefault: boolean;
  /** self-hosted only */
  baseUrl?: string;
}

export interface ProvidersResponse {
  items: Provider[];
  /** provider ids in fallback priority order */
  fallbackOrder: string[];
  costCeilingPerDay: Money;
}

// ── Team / members ───────────────────────────────────────────────────────────
export type MemberStatus = "active" | "invited";

export interface Member {
  id: UserId;
  name: string;
  email: string;
  role: Role;
  status: MemberStatus;
  lastActiveAt: ISODate | null;
  avatarUrl?: string;
}

export interface TeamResponse {
  items: Member[];
  defaultRole: Role;
  ssoEnabled: boolean;
  scimEnabled: boolean;
}

// ── Billing ────────────────────────────────────────────────────────────────
export interface Invoice {
  id: string;
  period: string;
  amount: Money;
  status: "paid" | "open" | "void";
}

export interface SpendByAgent {
  agent: string;
  amount: Money;
  runs: number;
}

export interface Billing {
  plan: "Free" | "Team" | "Enterprise";
  includedRuns: number;
  usedRuns: number;
  includedSpend: Money;
  usedSpend: Money;
  budgetPerMonth: Money;
  spendByAgent: SpendByAgent[];
  invoices: Invoice[];
}

// ── Security ─────────────────────────────────────────────────────────────────
export type PiiPolicy = "block" | "redact" | "allow";
export type DataResidency = "us" | "eu" | "global";

export interface SecurityPolicy {
  ipAllowlist: string[];
  egressAllowlist: string[];
  piiPolicy: PiiPolicy;
  dataResidency: DataResidency;
  secretRotationDays: number;
  requireApprovalForProd: boolean;
  sessionTimeoutMinutes: number;
}

// ── Audit log ────────────────────────────────────────────────────────────────
export interface AuditEntry {
  id: string;
  at: ISODate;
  actor: string;
  action: string;
  resource: string;
  target: string;
  ip: string;
  suspicious: boolean;
}

export interface AuditResponse {
  items: AuditEntry[];
  total: number;
}

export type { TeamId };
