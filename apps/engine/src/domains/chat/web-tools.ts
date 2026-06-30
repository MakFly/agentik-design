import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * Web as real, parameterised LLM tools (Hermes model: `web_search` + `web_extract`).
 * Backend is auto-detected from env keys with a KEYLESS default so it works out of the box:
 *   search:  TAVILY_API_KEY → Tavily · BRAVE_SEARCH_API_KEY → Brave · else → DuckDuckGo (no key)
 *   extract: plain fetch + HTML→text (no key); Tavily used when TAVILY_API_KEY is set.
 * Like the Gmail tools, `execute` never throws — infra errors come back as `{ error }` so the
 * model can relay an actionable message instead of aborting the turn.
 */

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function webError(e: unknown): { error: string } {
  const msg = (e as Error)?.message ?? String(e);
  return { error: `Recherche web impossible : ${msg}` };
}

/** Which search backend to use, mirroring Hermes' priority (explicit keys beat the keyless default). */
function searchBackend(): "tavily" | "brave" | "ddg" {
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  return "ddg";
}

async function tavilySearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const res = await fetchWithTimeout(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: limit,
        search_depth: "basic",
      }),
    },
    8000,
  );
  if (!res.ok) throw new Error(`tavily ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).slice(0, limit).map((r) => ({
    title: r.title ?? r.url ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

async function braveSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetchWithTimeout(
    url,
    { headers: { accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY ?? "" } },
    8000,
  );
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? []).slice(0, limit).map((r) => ({
    title: r.title ?? r.url ?? "",
    url: r.url ?? "",
    snippet: stripHtml(r.description ?? ""),
  }));
}

/** Keyless fallback: scrape DuckDuckGo's lite endpoint (same approach as Hermes' `ddgs`). */
async function ddgSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const res = await fetchWithTimeout(
    "https://lite.duckduckgo.com/lite/",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body: new URLSearchParams({ q: query }).toString(),
    },
    8000,
  );
  if (!res.ok) throw new Error(`duckduckgo ${res.status}`);
  const html = await readCapped(res, 1_000_000);
  const results: WebSearchResult[] = [];
  // Lite layout: <a ... class="result-link" href="URL">TITLE</a> then a result-snippet cell.
  const linkRe = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html))) snippets.push(stripHtml(sm[1] ?? ""));
  let lm: RegExpExecArray | null;
  // Pair the snippet by LINK position (linkIdx), not by pushed-result count, so a rejected
  // link doesn't shift every following snippet by one.
  let linkIdx = 0;
  while ((lm = linkRe.exec(html)) && results.length < limit) {
    const url = decodeDdgUrl(lm[1] ?? "");
    const snippet = snippets[linkIdx] ?? "";
    linkIdx++;
    if (!url) continue;
    results.push({ title: stripHtml(lm[2] ?? ""), url, snippet });
  }
  return results;
}

/** DDG lite sometimes wraps targets in a redirect (//duckduckgo.com/l/?uddg=ENC). Unwrap it. */
function decodeDdgUrl(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return "";
    }
  }
  return href.startsWith("http") ? href : "";
}

/** True when a dotted-quad IPv4 falls in a loopback / private / link-local / metadata range. */
function isPrivateV4(ip: string): boolean {
  return (
    ip === "0.0.0.0" ||
    ip === "169.254.169.254" ||
    /^127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

/** Extract the embedded IPv4 from an IPv4-mapped IPv6 host (URL normalises it to hex, e.g. ::ffff:a9fe:a9fe). */
function mappedV4(h: string): string | null {
  const m = h.match(/^::ffff:(.+)$/i);
  if (!m) return null;
  const tail = m[1]!;
  if (tail.includes(".")) return tail; // ::ffff:169.254.169.254
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i); // ::ffff:a9fe:a9fe
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

/**
 * SSRF guard: web_extract fetches a URL the LLM chose (possibly influenced by a web_search
 * result), so refuse loopback / private / link-local / cloud-metadata targets and non-http(s)
 * schemes — including IPv4-mapped IPv6 literals. Re-run on every redirect hop by the caller.
 * Residual risk (DNS rebinding) is out of scope for this first line of defence.
 */
export function blockedTarget(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "URL invalide";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "schéma non autorisé";
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = mappedV4(h);
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") ||
    h === "metadata.google.internal" ||
    h === "::1" ||
    h === "::" ||
    /^(fc|fd|fe80)/i.test(h) ||
    isPrivateV4(h) ||
    // IPv4-mapped IPv6: block when the embedded v4 is private (and we couldn't parse → block).
    (h.startsWith("::ffff:") && (mapped === null || isPrivateV4(mapped)))
  ) {
    return "hôte interne refusé";
  }
  return null;
}

/** fetch with an abort timeout (the gateway runs the chat turn synchronously — never hang it). */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Read at most `maxBytes` of a response body as text (avoids buffering a huge/endless page). */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return out;
}

/** Follow redirects manually, re-validating the SSRF guard on every hop (closes the redirect bypass). */
async function safeExtractFetch(url: string, maxRedirects = 4): Promise<Response | { error: string }> {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const blocked = blockedTarget(current);
    if (blocked) return { error: blocked };
    const res = await fetchWithTimeout(current, { headers: { "user-agent": UA }, redirect: "manual" }, 8000);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  return { error: "trop de redirections" };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[n as string] ?? " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the web tool set: `web_search` (query→results) and `web_extract` (url→readable text). */
export function buildWebTools(): ToolSet {
  return {
    web_search: tool({
      description:
        "Rechercher sur le web des informations à jour. Renvoie une liste {title, url, snippet}. " +
        "Utilise ensuite web_extract pour lire le contenu complet d'un résultat pertinent.",
      inputSchema: z.object({
        query: z.string().describe("La requête de recherche"),
        limit: z.number().int().min(1).max(10).default(5).describe("Nombre de résultats"),
      }),
      execute: async ({ query, limit }) => {
        try {
          const backend = searchBackend();
          const results =
            backend === "tavily"
              ? await tavilySearch(query, limit)
              : backend === "brave"
                ? await braveSearch(query, limit)
                : await ddgSearch(query, limit);
          return { backend, count: results.length, results };
        } catch (e) {
          return webError(e);
        }
      },
    }),
    web_extract: tool({
      description:
        "Récupérer et extraire le texte lisible d'une page web (URL). À utiliser après web_search " +
        "pour lire en détail une source.",
      inputSchema: z.object({
        url: z.string().url().describe("L'URL de la page à lire"),
      }),
      execute: async ({ url }) => {
        try {
          const res = await safeExtractFetch(url);
          if ("error" in res) return { error: `Lecture refusée : ${res.error}.` };
          if (!res.ok) return { error: `fetch ${res.status}` };
          const html = await readCapped(res, 2_000_000);
          const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
          const text = stripHtml(html).slice(0, 8000);
          return { url, title, text };
        } catch (e) {
          return webError(e);
        }
      },
    }),
  };
}
