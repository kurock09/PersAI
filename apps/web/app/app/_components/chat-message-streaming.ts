export interface StreamingMarkdownSegments {
  stableContent: string;
  liveTail: string;
}

export interface WorkingMarkdownSegments {
  workingBlocks: string[];
  answerText: string;
}

const WORKING_BLOCK_OPEN = ":::working\n";
const WORKING_BLOCK_CLOSE = "\n:::";

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

function formatWorkingMarkdownBlock(content: string): string {
  return `${WORKING_BLOCK_OPEN}${content.trim()}\n:::`;
}

export function splitWorkingMarkdownContent(content: string): WorkingMarkdownSegments {
  const normalized = content.replace(/\r\n/g, "\n");
  const workingBlocks: string[] = [];
  let cursor = 0;

  while (normalized.startsWith(WORKING_BLOCK_OPEN, cursor)) {
    const blockStart = cursor + WORKING_BLOCK_OPEN.length;
    const blockEnd = normalized.indexOf(WORKING_BLOCK_CLOSE, blockStart);
    if (blockEnd === -1) {
      break;
    }
    const blockContent = normalized.slice(blockStart, blockEnd).trim();
    if (blockContent.length > 0) {
      workingBlocks.push(blockContent);
    }
    cursor = blockEnd + WORKING_BLOCK_CLOSE.length;
    while (normalized[cursor] === "\n") {
      cursor += 1;
    }
  }

  return {
    workingBlocks,
    answerText: normalized.slice(cursor)
  };
}

export function appendWorkingMarkdownBlock(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const { workingBlocks, answerText } = splitWorkingMarkdownContent(normalized);
  const nextBlock = answerText.trim();
  if (nextBlock.length === 0) {
    return normalized;
  }
  const blocks = [...workingBlocks, nextBlock].map((block) => formatWorkingMarkdownBlock(block));
  return `${blocks.join("\n\n")}\n\n`;
}
