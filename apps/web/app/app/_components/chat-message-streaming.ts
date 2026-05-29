export interface StreamingMarkdownSegments {
  stableContent: string;
  liveTail: string;
}

const INLINE_PROGRESS_STATUS =
  /(?<=\S)\s+·\s+(?=(?:Провер|Свер|Собир|Ищу|Чита|Смотр|Уточн|Gather|Check|Read|Look|Scan|Review))/giu;

const PROGRESS_LINE_WITH_ANSWER =
  /^(·[^\n]+?\.\s+)(?!(?:Провер|Свер|Собир|Ищу|Чита|Смотр|Уточн|Gather|Check|Read|Look|Scan|Review))([А-ЯA-ZЁ][^\n]*)$/u;

/**
 * Models are instructed to emit each visible progress line on its own line with a
 * leading "· ", but often concatenate them inline as "… · Проверяю …". Markdown
 * paragraphs only preserve breaks when "\n" is present, so normalize before render.
 */
export function normalizeAssistantVisibleProgress(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(INLINE_PROGRESS_STATUS, "\n· ");

  return normalized
    .split("\n")
    .map((line) => {
      const match = line.match(PROGRESS_LINE_WITH_ANSWER);
      if (!match) {
        return line;
      }
      return `${match[1]!.trimEnd()}\n\n${match[2]!.trimStart()}`;
    })
    .join("\n");
}

interface StreamingMarkdownScanState {
  lastStableOffset: number;
  activeFence: { marker: "`" | "~"; length: number } | null;
  inMathFence: boolean;
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function isFenceLine(line: string): { marker: "`" | "~"; length: number } | null {
  const trimmed = line.trimStart();
  const match = trimmed.match(/^(`{3,}|~{3,})/);
  if (!match) {
    return null;
  }
  const marker = match[1]![0];
  return marker === "`" || marker === "~" ? { marker, length: match[1]!.length } : null;
}

function isStandaloneMathFence(line: string): boolean {
  return line.trim() === "$$";
}

function isAtxHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+\S/.test(line);
}

function isThematicBreak(line: string): boolean {
  return /^\s{0,3}((-\s*){3,}|(_\s*){3,}|(\*\s*){3,})$/.test(line.trimEnd());
}

function scanStreamingMarkdown(content: string): StreamingMarkdownScanState {
  let offset = 0;
  let lastStableOffset = 0;
  let activeFence: { marker: "`" | "~"; length: number } | null = null;
  let inMathFence = false;

  while (offset < content.length) {
    const newlineIndex = content.indexOf("\n", offset);
    const lineEnd = newlineIndex === -1 ? content.length : newlineIndex;
    const nextOffset = newlineIndex === -1 ? content.length : newlineIndex + 1;
    const line = content.slice(offset, lineEnd);

    if (activeFence !== null) {
      const closingFence = isFenceLine(line);
      if (
        closingFence !== null &&
        closingFence.marker === activeFence.marker &&
        closingFence.length >= activeFence.length
      ) {
        activeFence = null;
        lastStableOffset = nextOffset;
      }
      offset = nextOffset;
      continue;
    }

    if (inMathFence) {
      if (isStandaloneMathFence(line)) {
        inMathFence = false;
        lastStableOffset = nextOffset;
      }
      offset = nextOffset;
      continue;
    }

    const fenceLine = isFenceLine(line);
    if (fenceLine !== null) {
      activeFence = fenceLine;
      offset = nextOffset;
      continue;
    }

    if (isStandaloneMathFence(line)) {
      inMathFence = true;
      offset = nextOffset;
      continue;
    }

    if (isBlankLine(line) || isAtxHeading(line) || isThematicBreak(line)) {
      lastStableOffset = nextOffset;
    }

    offset = nextOffset;
  }

  return { lastStableOffset, activeFence, inMathFence };
}

export function splitStreamingMarkdownContent(content: string): StreamingMarkdownSegments {
  if (content.length === 0) {
    return { stableContent: "", liveTail: "" };
  }

  const { lastStableOffset } = scanStreamingMarkdown(content);

  return {
    stableContent: content.slice(0, lastStableOffset),
    liveTail: content.slice(lastStableOffset)
  };
}

export function buildStreamingMarkdownTailPreview(content: string): string {
  if (content.length === 0) {
    return "";
  }

  const { activeFence, inMathFence } = scanStreamingMarkdown(content);
  let preview = content;

  if (activeFence !== null) {
    preview += preview.endsWith("\n") ? "" : "\n";
    preview += activeFence.marker.repeat(activeFence.length);
  }

  if (inMathFence) {
    preview += preview.endsWith("\n") ? "" : "\n";
    preview += "$$";
  }

  return preview;
}
