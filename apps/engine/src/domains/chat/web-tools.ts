import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * Web as real, parameterised LLM tools (Hermes model: `web_search` + `web_extract`).
 * Backend is auto-detected from env keys with a KEYLESS default so it works out of the box:
 *   search:  TAVILY_API_KEY → Tavily · BRAVE_SEARCH_API_KEY → Brave · else → DuckDuckGo (no key)
 *   extract: plain fetch + HTML→text (no key), SSRF-guarded.
 * The keyless default is DuckDuckGo's HTML endpoint (same as Hermes' `ddgs`): it only returns
 * results with browser-like headers (Referer/Origin/Accept-Language) — without them DDG serves
 * an empty page. Wikipedia is a secondary keyless fallback when DDG yields nothing. Like the
 * Gmail tools, `execute` never throws — infra errors come back as `{ error }`.
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

/** Decode a DDG result href: drop sponsored `y.js` ads, unwrap the `uddg=` redirect, fix `//`. */
function decodeDdgHref(href: string): string {
  const h = href.replace(/&amp;/g, "&");
  if (h.includes("/y.js")) return ""; // sponsored ad
  const u = h.match(/[?&]uddg=([^&]+)/);
  if (u?.[1]) {
    try {
      return decodeURIComponent(u[1]);
    } catch {
      return "";
    }
  }
  if (h.startsWith("//")) return `https:${h}`;
  return h.startsWith("http") ? h : "";
}

/**
 * Keyless default: DuckDuckGo's HTML endpoint (the `ddgs` approach). Needs browser-like
 * headers or DDG returns an empty page. Each result block holds a `result__a` (title+href)
 * then a `result__snippet`; we pair the snippet per-block so interleaved ads don't shift it.
 */
async function ddgSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const res = await fetchWithTimeout(
    "https://html.duckduckgo.com/html/",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": UA,
        referer: "https://duckduckgo.com/",
        origin: "https://duckduckgo.com",
        "accept-language": "en-US,en;q=0.9",
        accept: "text/html,application/xhtml+xml",
      },
      body: new URLSearchParams({ q: query, kl: "wt-wt" }).toString(),
    },
    8000,
  );
  if (!res.ok) throw new Error(`duckduckgo ${res.status}`);
  const html = await readCapped(res, 1_500_000);
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const matches = [...html.matchAll(linkRe)];
  const results: WebSearchResult[] = [];
  for (let i = 0; i < matches.length && results.length < limit; i++) {
    const m = matches[i]!;
    const url = decodeDdgHref(m[1] ?? "");
    if (!url) continue; // ad or unparseable
    // Snippet lives in this result's block — between this link and the next.
    const blockEnd = matches[i + 1]?.index ?? html.length;
    const block = html.slice((m.index ?? 0) + m[0].length, blockEnd);
    const snip = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "";
    results.push({ title: stripHtml(m[2] ?? ""), url, snippet: stripHtml(snip) });
  }
  return results;
}

/** Secondary keyless fallback when DDG yields nothing: Wikipedia search API (always reliable). */
async function wikipediaSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*` +
    `&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, { headers: { "user-agent": UA } }, 8000);
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);
  const data = (await res.json()) as {
    query?: { search?: Array<{ title?: string; snippet?: string }> };
  };
  return (data.query?.search ?? []).slice(0, limit).map((r) => ({
    title: r.title ?? "",
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent((r.title ?? "").replace(/ /g, "_"))}`,
    snippet: stripHtml(r.snippet ?? ""),
  }));
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
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
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
          let backend: string = searchBackend();
          let results =
            backend === "tavily"
              ? await tavilySearch(query, limit)
              : backend === "brave"
                ? await braveSearch(query, limit)
                : await ddgSearch(query, limit);
          // Keyless safety net: if DDG returns nothing (blocked/empty), fall back to Wikipedia.
          if (backend === "ddg" && results.length === 0) {
            results = await wikipediaSearch(query, limit);
            backend = "ddg→wikipedia";
          }
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
