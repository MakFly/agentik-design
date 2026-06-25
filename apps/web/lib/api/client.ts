import { normalizeResponse, toAppError } from "./errors";

const BASE = "/api/v1";

export interface ApiOpts {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  team?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Typed fetch wrapper (docs/03 §7.4). Normalizes failures into AppError and
 * scopes requests to the active team. MSW is opt-in only; dev requests hit the
 * engine through the Next.js API rewrite by default.
 */
export async function apiFetch<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(opts.team ? { "x-team": opts.team } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
    if (!res.ok) throw await normalizeResponse(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (e) {
    throw toAppError(e);
  }
}

/** Build a query string from an object, skipping null/undefined/empty values. */
export function qs(params: object): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
