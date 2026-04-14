const MAX_CHUNK_CHARS = 1_800;
const CHUNK_OVERLAP_CHARS = 200;
const BREAK_WINDOW_CHARS = 300;

export type KnowledgeChunkDraft = {
  chunkIndex: number;
  locator: string;
  content: string;
};

export function chunkKnowledgeText(text: string): KnowledgeChunkDraft[] {
  const normalized = normalizeKnowledgeText(text);
  if (normalized.length === 0) {
    return [];
  }

  const chunks: KnowledgeChunkDraft[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < normalized.length) {
    const proposedEnd = Math.min(normalized.length, start + MAX_CHUNK_CHARS);
    let end = proposedEnd;

    if (proposedEnd < normalized.length) {
      const breakPoint = findBreakPoint(normalized, start, proposedEnd);
      if (breakPoint !== null && breakPoint > start) {
        end = breakPoint;
      }
    }

    const content = normalized.slice(start, end).trim();
    if (content.length > 0) {
      chunks.push({
        chunkIndex,
        locator: `chunk:${String(chunkIndex + 1)}`,
        content
      });
      chunkIndex += 1;
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
    while (start < normalized.length && /\s/.test(normalized[start] ?? "")) {
      start += 1;
    }
  }

  return chunks;
}

function normalizeKnowledgeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replaceAll("\u0000", "").trim();
}

function findBreakPoint(text: string, start: number, proposedEnd: number): number | null {
  const lowerBound = Math.max(
    start + Math.floor(MAX_CHUNK_CHARS / 2),
    proposedEnd - BREAK_WINDOW_CHARS
  );
  const candidate = text.slice(lowerBound, proposedEnd);
  const matches = Array.from(candidate.matchAll(/(?:\n{2,}|[.!?]\s+|\s+)/g));
  const last = matches.at(-1);
  if (!last || last.index === undefined) {
    return null;
  }
  return lowerBound + last.index + last[0].length;
}
