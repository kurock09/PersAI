import {
  splitTelegramOutboundText,
  TELEGRAM_BOT_API_MAX_MESSAGE_LENGTH
} from "./telegram-outbound-chunks";

export { TELEGRAM_BOT_API_MAX_MESSAGE_LENGTH };

const STASH_OPEN = "\uE000";
const STASH_CLOSE = "\uE001";

const FENCE_INFO_LINE = /^[A-Za-z0-9][A-Za-z0-9_#.+-]*$/;

const LANGUAGE_ALIASES: Record<string, string> = {
  "c++": "cpp",
  "c#": "csharp",
  "f#": "fsharp",
  "objective-c": "objc",
  objectivec: "objc",
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  rs: "rust",
  kt: "kotlin"
};

export function normalizeTelegramLanguageId(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return "";
  }
  const mapped = LANGUAGE_ALIASES[value] ?? value;
  return mapped.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function escapeTelegramHtmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function fencedBlockToHtml(language: string, code: string): string {
  const escaped = escapeTelegramHtmlText(code);
  const langNorm = normalizeTelegramLanguageId(language);
  if (langNorm) {
    return `<pre><code class="language-${langNorm}">${escaped}</code></pre>`;
  }
  return `<pre>${escaped}</pre>`;
}

type SourceSegment =
  | { kind: "text"; raw: string }
  | { kind: "fence"; language: string; code: string };

export function segmentSourceByFencedBlocks(source: string): SourceSegment[] {
  const segments: SourceSegment[] = [];
  let position = 0;
  while (position < source.length) {
    const open = source.indexOf("```", position);
    if (open === -1) {
      if (position < source.length) {
        segments.push({ kind: "text", raw: source.slice(position) });
      }
      break;
    }
    if (open > position) {
      segments.push({ kind: "text", raw: source.slice(position, open) });
    }
    const afterTicks = open + 3;
    const nextNewline = source.indexOf("\n", afterTicks);
    if (nextNewline === -1) {
      segments.push({ kind: "text", raw: source.slice(open) });
      break;
    }
    const infoLine = source.slice(afterTicks, nextNewline).trimEnd();
    const codeStart = nextNewline + 1;
    const close = source.indexOf("```", codeStart);
    if (close === -1) {
      segments.push({ kind: "text", raw: source.slice(open) });
      break;
    }
    let language = "";
    let codeBody = source.slice(codeStart, close);
    if (infoLine === "" || FENCE_INFO_LINE.test(infoLine)) {
      language = infoLine;
    } else {
      codeBody = source.slice(afterTicks, close);
    }
    segments.push({ kind: "fence", language, code: codeBody });
    position = close + 3;
  }
  return segments;
}

function splitFencedHtmlToFit(language: string, code: string, maxChars: number): string[] {
  const single = fencedBlockToHtml(language, code);
  if (single.length <= maxChars) {
    return [single];
  }
  const lines = code.split("\n");
  const output: string[] = [];
  let current = "";
  const flush = (body: string) => {
    if (body.length === 0) {
      return;
    }
    output.push(fencedBlockToHtml(language, body));
  };
  for (const line of lines) {
    const next = current.length === 0 ? line : `${current}\n${line}`;
    if (fencedBlockToHtml(language, next).length <= maxChars) {
      current = next;
      continue;
    }
    if (current.length > 0) {
      flush(current);
      current = line;
    } else {
      current = line;
    }
    if (fencedBlockToHtml(language, current).length > maxChars) {
      const budget = Math.max(64, maxChars - 48);
      for (const chunk of splitTelegramOutboundText(escapeTelegramHtmlText(current), budget)) {
        output.push(`<pre>${chunk}</pre>`);
      }
      current = "";
    }
  }
  flush(current);
  return output;
}

function escapeHtmlAttrValue(text: string): string {
  return escapeTelegramHtmlText(text).replace(/"/g, "&quot;");
}

function isAllowedHttpUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function stash(slots: string[], html: string): string {
  const index = slots.length;
  slots.push(html);
  return `${STASH_OPEN}${String(index)}${STASH_CLOSE}`;
}

function unstashAndEscapeLiterals(source: string, slots: string[]): string {
  const parts = source.split(new RegExp(`(${STASH_OPEN}\\d+${STASH_CLOSE})`, "g"));
  return parts
    .map((part) => {
      const match = part.match(new RegExp(`^${STASH_OPEN}(\\d+)${STASH_CLOSE}$`));
      if (match) {
        return slots[Number(match[1])] ?? "";
      }
      return escapeTelegramHtmlText(part);
    })
    .join("");
}

function applyBoldStashed(source: string, slots: string[]): string {
  return source.replace(/\*\*([\s\S]+?)\*\*/g, (full, inner: string) => {
    if (String(inner).includes(STASH_OPEN)) {
      return full;
    }
    return stash(slots, `<b>${unstashAndEscapeLiterals(inner, slots)}</b>`);
  });
}

export function convertAssistantParagraphToTelegramHtml(paragraph: string): string {
  const trimmed = paragraph.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("```") && trimmed.length >= 6) {
    const closeInner = trimmed.lastIndexOf("```");
    if (closeInner > 3) {
      const inner = trimmed.slice(3, closeInner);
      const newline = inner.indexOf("\n");
      if (newline === -1) {
        const token = inner.trim();
        if (token.length > 0 && FENCE_INFO_LINE.test(token)) {
          return fencedBlockToHtml(token, "");
        }
        return fencedBlockToHtml("", inner);
      }
      const infoLine = inner.slice(0, newline).trimEnd();
      const code = inner.slice(newline + 1);
      if (infoLine === "" || FENCE_INFO_LINE.test(infoLine)) {
        return fencedBlockToHtml(infoLine, code);
      }
      return fencedBlockToHtml("", inner);
    }
  }

  const slots: string[] = [];

  let source = trimmed.replace(/`([^`]+)`/g, (_, code: string) =>
    stash(slots, `<code>${escapeTelegramHtmlText(code)}</code>`)
  );

  source = source.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (full, label: string, url: string) => {
    if (!isAllowedHttpUrl(url)) {
      return full;
    }
    return stash(
      slots,
      `<a href="${escapeHtmlAttrValue(url)}">${escapeTelegramHtmlText(label)}</a>`
    );
  });

  source = applyBoldStashed(source, slots);
  return unstashAndEscapeLiterals(source, slots);
}

export function lossyPlainFromTelegramHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/pre>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function splitParagraphs(source: string): string[] {
  return source
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function flushBuffer(buffer: string, out: string[]): string {
  if (buffer) {
    out.push(buffer);
  }
  return "";
}

function emitOversizedParagraph(messages: string[], markdown: string, maxChars: number): void {
  const lines = markdown
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    for (const line of lines) {
      emitOversizedParagraph(messages, line, maxChars);
    }
    return;
  }
  for (const chunk of splitTelegramOutboundText(markdown, maxChars)) {
    const html = convertAssistantParagraphToTelegramHtml(chunk);
    if (html.length <= maxChars) {
      messages.push(html);
    } else {
      for (const plainChunk of splitTelegramOutboundText(escapeTelegramHtmlText(chunk), maxChars)) {
        messages.push(plainChunk);
      }
    }
  }
}

export function buildTelegramHtmlMessageBodies(
  source: string,
  maxChars: number = TELEGRAM_BOT_API_MAX_MESSAGE_LENGTH
): string[] {
  if (source.trim().length === 0) {
    return [];
  }

  const segments = segmentSourceByFencedBlocks(source);
  const htmlBlocks: string[] = [];

  for (const segment of segments) {
    if (segment.kind === "fence") {
      htmlBlocks.push(...splitFencedHtmlToFit(segment.language, segment.code, maxChars));
      continue;
    }
    for (const paragraph of splitParagraphs(segment.raw)) {
      const html = convertAssistantParagraphToTelegramHtml(paragraph);
      if (!html) {
        continue;
      }
      if (html.length > maxChars) {
        emitOversizedParagraph(htmlBlocks, paragraph, maxChars);
      } else {
        htmlBlocks.push(html);
      }
    }
  }

  if (htmlBlocks.length === 0) {
    return [];
  }

  const messages: string[] = [];
  let current = "";
  for (const html of htmlBlocks) {
    if (!html) {
      continue;
    }
    if (html.length > maxChars) {
      current = flushBuffer(current, messages);
      messages.push(html);
      continue;
    }
    const separator = current ? "\n\n" : "";
    const next = current + separator + html;
    if (next.length <= maxChars) {
      current = next;
    } else {
      current = flushBuffer(current, messages) + html;
    }
  }
  flushBuffer(current, messages);
  return messages;
}
