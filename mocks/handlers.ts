import { http, HttpResponse, delay } from "msw";
import { agents } from "./seed";
import { runs, stepsByRun } from "./runs-seed";
import {
  apiKeys,
  providers,
  fallbackOrder,
  costCeilingPerDay,
  members,
  team,
  billing,
  security,
  auditLog,
} from "./settings-seed";
import type { ApiKeyScope } from "@/features/settings/types";
import type { Role } from "@/config/permissions";

const API = "/api/v1";
const SETTINGS = `${API}/settings`;
const id36 = () => Math.floor(performance.now()).toString(36);

/** MSW request handlers mirroring the API contract (docs/04 §9). Dev-only. */
export const handlers = [
  // ── Agents ─────────────────────────────────────────────────────────────
  http.get(`${API}/agents`, async ({ request }) => {
    await delay(350);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q")?.toLowerCase();
    let items = [...agents];
    if (status) items = items.filter((a) => a.health === status);
    if (q) items = items.filter((a) => a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q));
    return HttpResponse.json({ items, nextCursor: null, total: items.length });
  }),

  http.get(`${API}/agents/:id`, async ({ params }) => {
    await delay(200);
    const agent = agents.find((a) => a.id === params.id);
    if (!agent) return HttpResponse.json({ message: "Agent not found", kind: "not_found" }, { status: 404 });
    return HttpResponse.json(agent);
  }),

  // ── Agent Builder (P3) ──────────────────────────────────────────────────
  http.post(`${API}/agents`, async () => {
    await delay(300);
    const id = `agt_${Math.floor(performance.now()).toString(36)}`;
    return HttpResponse.json({ id, draftVersionId: `${id}_draft` }, { status: 201 });
  }),

  http.post(`${API}/agents/:id/publish`, async ({ params }) => {
    await delay(400);
    return HttpResponse.json({ versionId: `${params.id}_v1`, version: 1, status: "published" }, { status: 201 });
  }),

  // Start a sandbox test run; the live trace streams from the SSE route.
  http.post(`${API}/agents/test`, async () => {
    await delay(250);
    return HttpResponse.json({ runId: "run_8f2" }, { status: 202 });
  }),

  // ── Runs ───────────────────────────────────────────────────────────────
  http.get(`${API}/runs`, async ({ request }) => {
    await delay(350);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const env = url.searchParams.get("env");
    let items = [...runs];
    if (status) items = items.filter((r) => r.status === status);
    if (env) items = items.filter((r) => r.env === env);
    return HttpResponse.json({ items, nextCursor: null, total: items.length });
  }),

  http.get(`${API}/runs/:id`, async ({ params }) => {
    await delay(250);
    const run = runs.find((r) => r.id === params.id);
    if (!run) return HttpResponse.json({ message: "Run not found", kind: "not_found" }, { status: 404 });
    const steps = stepsByRun[params.id as string] ?? [];
    return HttpResponse.json({ run, steps });
  }),

  // ── Settings · API keys ──────────────────────────────────────────────────
  http.get(`${SETTINGS}/api-keys`, async () => {
    await delay(250);
    return HttpResponse.json({ items: apiKeys });
  }),

  http.post(`${SETTINGS}/api-keys`, async ({ request }) => {
    await delay(350);
    const body = (await request.json()) as { name?: string; scopes?: ApiKeyScope[] };
    const suffix = id36();
    const secret = `ak_live_${suffix}${id36()}`;
    const created = {
      id: `key_${suffix}`,
      name: body.name?.trim() || "Untitled key",
      prefix: `${secret.slice(0, 12)}••••`,
      scopes: body.scopes?.length ? body.scopes : (["read"] as ApiKeyScope[]),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      createdBy: "alice",
    };
    apiKeys.unshift(created);
    // The plaintext secret is returned exactly once.
    return HttpResponse.json({ ...created, secret }, { status: 201 });
  }),

  http.delete(`${SETTINGS}/api-keys/:id`, async ({ params }) => {
    await delay(250);
    const i = apiKeys.findIndex((k) => k.id === params.id);
    if (i === -1) return HttpResponse.json({ message: "Key not found", kind: "not_found" }, { status: 404 });
    apiKeys.splice(i, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── Settings · Providers ─────────────────────────────────────────────────
  http.get(`${SETTINGS}/providers`, async () => {
    await delay(250);
    return HttpResponse.json({ items: providers, fallbackOrder, costCeilingPerDay });
  }),

  http.patch(`${SETTINGS}/providers/:id`, async ({ params, request }) => {
    await delay(250);
    const body = (await request.json()) as { status?: "active" | "off"; isDefault?: boolean };
    const prov = providers.find((p) => p.id === params.id);
    if (!prov) return HttpResponse.json({ message: "Provider not found", kind: "not_found" }, { status: 404 });
    if (body.status) prov.status = body.status;
    if (body.isDefault) providers.forEach((p) => (p.isDefault = p.id === prov.id));
    return HttpResponse.json(prov);
  }),

  http.post(`${SETTINGS}/providers/:id/test`, async ({ params }) => {
    await delay(700);
    const prov = providers.find((p) => p.id === params.id);
    if (!prov?.hasKey && !prov?.baseUrl) {
      return HttpResponse.json({ ok: false, message: "No key or base URL configured" }, { status: 422 });
    }
    return HttpResponse.json({ ok: true, latencyMs: 180 + Math.floor(performance.now() % 220) });
  }),

  // ── Settings · Team / members ──────────────────────────────────────────────
  http.get(`${SETTINGS}/members`, async () => {
    await delay(250);
    return HttpResponse.json({ items: members, ...team });
  }),

  http.post(`${SETTINGS}/members`, async ({ request }) => {
    await delay(350);
    const body = (await request.json()) as { email?: string; role?: Role };
    const member = {
      id: `usr_${id36()}` as (typeof members)[number]["id"],
      name: body.email?.split("@")[0] ?? "Invitee",
      email: body.email ?? "",
      role: body.role ?? team.defaultRole,
      status: "invited" as const,
      lastActiveAt: null,
    };
    members.push(member);
    return HttpResponse.json(member, { status: 201 });
  }),

  http.patch(`${SETTINGS}/members/:id`, async ({ params, request }) => {
    await delay(250);
    const body = (await request.json()) as { role?: Role };
    const member = members.find((m) => m.id === params.id);
    if (!member) return HttpResponse.json({ message: "Member not found", kind: "not_found" }, { status: 404 });
    if (body.role) member.role = body.role;
    return HttpResponse.json(member);
  }),

  http.delete(`${SETTINGS}/members/:id`, async ({ params }) => {
    await delay(250);
    const i = members.findIndex((m) => m.id === params.id);
    if (i === -1) return HttpResponse.json({ message: "Member not found", kind: "not_found" }, { status: 404 });
    members.splice(i, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── Settings · Billing ─────────────────────────────────────────────────────
  http.get(`${SETTINGS}/billing`, async () => {
    await delay(300);
    return HttpResponse.json(billing);
  }),

  // ── Settings · Security ─────────────────────────────────────────────────────
  http.get(`${SETTINGS}/security`, async () => {
    await delay(250);
    return HttpResponse.json(security);
  }),

  http.patch(`${SETTINGS}/security`, async ({ request }) => {
    await delay(300);
    const patch = (await request.json()) as Partial<typeof security>;
    Object.assign(security, patch);
    return HttpResponse.json(security);
  }),

  // ── Settings · Audit log ────────────────────────────────────────────────────
  http.get(`${SETTINGS}/audit`, async ({ request }) => {
    await delay(300);
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.toLowerCase();
    const suspicious = url.searchParams.get("suspicious") === "true";
    let items = [...auditLog];
    if (suspicious) items = items.filter((a) => a.suspicious);
    if (q) items = items.filter((a) => `${a.actor} ${a.action} ${a.target}`.toLowerCase().includes(q));
    return HttpResponse.json({ items, total: items.length });
  }),
];
