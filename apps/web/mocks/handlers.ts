import { http, HttpResponse, delay, passthrough } from "msw";
import { agents } from "./seed";
import { runs, stepsByRun } from "./runs-seed";
import { providers, providerKeys, fallbackOrder, costCeilingPerDay } from "./settings-seed";

const API = "/api/v1";
const SETTINGS = `${API}/settings`;

/** MSW request handlers mirroring the API contract (docs/04 §9). Dev-only. */
export const handlers = [
  // ── System / presence (harness) ──────────────────────────────────────────
  http.get(`${API}/system`, async () => {
    await delay(200);
    return HttpResponse.json({
      daemonEnabled: false,
      providers: { anthropic: false, openai: false, google: false },
      daemons: [
        {
          id: "daemon_mock",
          name: "mock-daemon",
          status: "offline",
          lastHeartbeatAt: null,
          meta: {
            host: { host: "mock", os: "linux", arch: "amd64", go: "mock" },
            runtimes: ["claude"],
            tools: [
              { name: "claude", available: false },
              { name: "hermes", available: false },
              { name: "codex", available: false },
            ],
            installable: ["claude", "codex", "gemini", "hermes"],
            mode: "personal",
          },
        },
      ],
      runtimes: [],
      availableRuntimes: [],
    });
  }),

  http.get(`${API}/me/daemon-token`, async () => {
    await delay(150);
    return HttpResponse.json({
      hasToken: false,
      prefix: null,
      issuedAt: null,
      eligibleOrgs: [{ teamId: "team_mock", slug: "acme", name: "Acme" }],
    });
  }),

  http.post(`${API}/me/daemon-token/rotate`, async () => {
    await delay(250);
    return HttpResponse.json(
      {
        hasToken: true,
        prefix: "dtkn_mockedtoken",
        issuedAt: new Date().toISOString(),
        token: "dtkn_mockedtokenvalue",
        eligibleOrgs: [{ teamId: "team_mock", slug: "acme", name: "Acme" }],
      },
      { status: 201 },
    );
  }),

  http.delete(`${API}/me/daemon-token`, async () => {
    await delay(150);
    return HttpResponse.json({ ok: true });
  }),

  http.get(`${API}/agent-task-snapshot`, async () => {
    await delay(200);
    return HttpResponse.json({
      agents: agents.map((a) => ({ id: a.id, name: a.name, runtimeKind: "claude", maxConcurrentTasks: 1, health: a.health })),
      daemons: [],
      runtimes: [],
      activeTasks: [],
    });
  }),

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
  // Live board SSE is a real route handler — let the EventSource through so MSW
  // doesn't capture it as `runs/:id`. Must stay above the `runs/:id` handler.
  http.get(`${API}/runs/stream`, () => passthrough()),

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

  // ── Settings · Provider keys ─────────────────────────────────────────────
  // Same families as the provider cards; saving/removing a key flips `hasKey`
  // on both the key and its matching card (id = `prov_<family>`).
  http.get(`${SETTINGS}/provider-keys`, async () => {
    await delay(250);
    return HttpResponse.json({ items: providerKeys });
  }),

  http.put(`${SETTINGS}/provider-keys/:provider`, async ({ params }) => {
    await delay(250);
    const key = providerKeys.find((k) => k.provider === params.provider);
    if (!key) return HttpResponse.json({ message: "Unsupported provider", kind: "not_found" }, { status: 404 });
    key.hasKey = true;
    key.updatedAt = new Date().toISOString();
    const card = providers.find((p) => p.id === `prov_${params.provider}`);
    if (card) { card.hasKey = true; card.status = "active"; }
    return HttpResponse.json({ ok: true });
  }),

  http.delete(`${SETTINGS}/provider-keys/:provider`, async ({ params }) => {
    await delay(250);
    const key = providerKeys.find((k) => k.provider === params.provider);
    if (key) { key.hasKey = false; key.updatedAt = null; }
    const card = providers.find((p) => p.id === `prov_${params.provider}`);
    if (card) { card.hasKey = false; card.status = "off"; }
    return HttpResponse.json({ ok: true });
  }),
];
