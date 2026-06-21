import { type NodeExecutor, exprScope } from "../types";
import { resolveDeep, resolveTemplate } from "../expressions";

/**
 * HTTP Request node — runs once per input item (n8n behaviour), so `url`,
 * `headers` and `body` can be `{{ }}`-templated against the current item's
 * `$json`. With static parameters the request is self-contained and ignores
 * the input entirely.
 */
export const apiNode: NodeExecutor = {
  type: "api",
  async executeItem(ctx) {
    const { node, itemIndex, signal } = ctx;
    if (node.config.type !== "api") throw new Error("api node: config mismatch");
    const cfg = node.config;
    const scope = exprScope(ctx, itemIndex);

    const url = String(resolveTemplate(cfg.url, scope));
    const headers: Record<string, string> = cfg.headers
      ? (resolveDeep(cfg.headers, scope) as Record<string, string>)
      : {};

    // Optional credential → inject auth at run time. OAuth2 (access_token) →
    // Bearer; httpHeaderAuth ({name,value}) → custom header.
    if (cfg.credentialId) {
      const cred = await ctx.resolveCredential(cfg.credentialId);
      if (cred?.access_token) headers.authorization = `Bearer ${cred.access_token}`;
      else if (cred?.name && cred.value) headers[cred.name] = cred.value;
    }

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
