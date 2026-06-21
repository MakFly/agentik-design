import type { NodeExecutor } from "../types";
import { resolveDeep, resolveTemplate, type Scope } from "../expressions";

/** HTTP Request node — native fetch, with `{{ }}` templating on url/headers/body. */
export const apiNode: NodeExecutor = {
  type: "api",
  async execute({ node, input, payload, outputs, signal }) {
    if (node.config.type !== "api") throw new Error("api node: config mismatch");
    const cfg = node.config;
    const scope: Scope = { input, payload, outputs };

    const url = String(resolveTemplate(cfg.url, scope));
    const headers: Record<string, string> = cfg.headers
      ? (resolveDeep(cfg.headers, scope) as Record<string, string>)
      : {};

    let body: string | undefined;
    if (cfg.bodyMap && cfg.method !== "GET") {
      body = JSON.stringify(resolveDeep(cfg.bodyMap, scope));
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
        headers["content-type"] = "application/json";
      }
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    signal?.addEventListener("abort", () => ctrl.abort());

    try {
      const res = await fetch(url, { method: cfg.method, headers, body, signal: ctrl.signal });
      const text = await res.text();
      let parsedBody: unknown = text;
      try {
        parsedBody = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
      const output = {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers),
        body: parsedBody,
      };
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status} from ${url}`), { output });
      }
      return output;
    } finally {
      clearTimeout(timer);
    }
  },
};
