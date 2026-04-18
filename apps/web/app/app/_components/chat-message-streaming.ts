export interface StreamingMarkdownSegments {
  stableContent: string;
  liveTail: string;
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

export function splitStreamingMarkdownContent(content: string): StreamingMarkdownSegments {
  if (content.length === 0) {
    return { stableContent: "", liveTail: "" };
  }

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

  return {
    stableContent: content.slice(0, lastStableOffset),
    liveTail: content.slice(lastStableOffset)
  };
}
