const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_SAFE_CHUNK = 3600;

export function formatTelegramHtmlMessages(input: string) {
  const formatted = formatTelegramText(input, Number.POSITIVE_INFINITY);
  const parts: string[] = [];
  for (const chunk of splitTelegramSource(formatted, TELEGRAM_SAFE_CHUNK)) {
    const html = markdownToTelegramHtml(chunk);
    if (html.length <= TELEGRAM_MESSAGE_LIMIT) {
      parts.push(html);
      continue;
    }
    for (const smaller of splitTelegramSource(chunk, 900)) {
      parts.push(markdownToTelegramHtml(smaller));
    }
  }
  return parts.filter(Boolean);
}

export function formatTelegramText(input: string, maxChars = 1800) {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const next = lines[i + 1] ?? "";
    if (isMarkdownTableRow(line) && isMarkdownTableDivider(next)) {
      const headers = splitMarkdownTableRow(line);
      i += 2;
      while (i < lines.length && isMarkdownTableRow(lines[i] ?? "")) {
        const values = splitMarkdownTableRow(lines[i] ?? "");
        const pairs = headers
          .map((header, index) => [header, values[index] ?? ""] as const)
          .filter(([, value]) => value.trim() !== "");
        out.push(
          `- ${pairs
            .map(([header, value]) => `${header}: ${value}`)
            .join(" ; ")}`,
        );
        i += 1;
      }
      i -= 1;
      continue;
    }
    out.push(line);
  }
  const compact = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

function splitTelegramSource(input: string, maxChars: number) {
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };
  for (const line of input.split("\n")) {
    if (line.length > maxChars) {
      push();
      for (let i = 0; i < line.length; i += maxChars) {
        chunks.push(line.slice(i, i + maxChars));
      }
      continue;
    }
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxChars) {
      push();
      current = line;
    } else {
      current = next;
    }
  }
  push();
  return chunks.length ? chunks : [""];
}

function markdownToTelegramHtml(input: string) {
  const lines = input.split("\n");
  const out: string[] = [];
  let inFence = false;
  let codeLines: string[] = [];

  const flushCode = () => {
    if (!codeLines.length) return;
    out.push(`<pre><code>${escapeTelegramHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      if (inFence) {
        flushCode();
        inFence = false;
      } else {
        inFence = true;
        codeLines = [];
      }
      continue;
    }
    if (inFence) {
      codeLines.push(raw);
      continue;
    }

    const heading = raw.match(/^\s{0,3}#{1,6}\s+(.+)$/);
    if (heading?.[1]) {
      out.push(`<b>${inlineTelegramHtml(heading[1])}</b>`);
      continue;
    }

    const bullet = raw.match(/^\s*[-*]\s+(.+)$/);
    if (bullet?.[1]) {
      out.push(`• ${inlineTelegramHtml(bullet[1])}`);
      continue;
    }

    out.push(inlineTelegramHtml(raw));
  }
  if (inFence) flushCode();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function inlineTelegramHtml(input: string) {
  let text = escapeTelegramHtml(input);
  text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => {
    return `<a href="${escapeTelegramAttr(url)}">${label}</a>`;
  });
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  text = text.replace(/\*([^*\n]+)\*/g, "<i>$1</i>");
  return text;
}

function escapeTelegramHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeTelegramAttr(input: string) {
  return escapeTelegramHtml(input).replace(/"/g, "&quot;");
}

function isMarkdownTableRow(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.split("|").length >= 4;
}

function isMarkdownTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}
