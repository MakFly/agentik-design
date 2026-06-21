/**
 * User-created HTTP tools, persisted client-side and executed in the browser
 * (assistant-ui "frontend" tools). The chat route already exposes their schemas
 * to the model via `frontendTools(body.tools)`; when the model calls one, the
 * runtime runs `execute` here (a fetch to the configured endpoint).
 *
 * Tier limits (by design, for now): browser fetch → subject to CORS, and any
 * auth header lives client-side. Server-side execution + a DB + secret storage
 * is the next tier for authenticated / non-CORS APIs.
 */

export type ParamType = "string" | "number" | "boolean";

export type ToolParam = {
  name: string;
  type: ParamType;
  description?: string;
  required?: boolean;
};

export type CustomTool = {
  id: string;
  /** Model-facing tool name (snake_case). */
  name: string;
  description: string;
  method: "GET" | "POST";
  url: string;
  params: ToolParam[];
};

const STORAGE_KEY = "aui:dashboard:custom-tools";

export function readCustomTools(): CustomTool[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCustomTools(tools: CustomTool[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tools));
  } catch {
    /* ignore quota/availability errors */
  }
}

/** Compile a tool's params into a JSON Schema object for the model. */
export function paramsToJsonSchema(params: ToolParam[]) {
  return {
    type: "object" as const,
    properties: Object.fromEntries(
      params
        .filter((p) => p.name.trim())
        .map((p) => [
          p.name,
          { type: p.type, ...(p.description ? { description: p.description } : {}) },
        ]),
    ),
    required: params.filter((p) => p.required && p.name.trim()).map((p) => p.name),
    additionalProperties: false,
  };
}

/** Run a custom tool's HTTP request with the model-provided args. */
export async function executeCustomTool(
  def: CustomTool,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    let target = def.url;
    const init: RequestInit = { method: def.method, headers: {} };
    if (def.method === "GET") {
      const u = new URL(def.url);
      for (const [k, v] of Object.entries(args ?? {})) {
        if (v != null) u.searchParams.set(k, String(v));
      }
      target = u.toString();
    } else {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(args ?? {});
    }
    const res = await fetch(target, init);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    if (!res.ok) return { error: `HTTP ${res.status}`, body };
    return body;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Request failed" };
  }
}

/** Slugify a label into a safe snake_case tool name. */
export function slugifyToolName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}
