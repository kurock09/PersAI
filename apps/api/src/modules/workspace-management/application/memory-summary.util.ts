function truncateMiddle(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

/** One-line user-facing summary for Memory Center (not raw chat dump). */
export function buildWebChatMemorySummary(userContent: string, assistantContent: string): string {
  const u = truncateMiddle(userContent, 120);
  const a = truncateMiddle(assistantContent, 120);
  const combined = `${u} · ${a}`;
  return combined.length <= 500 ? combined : `${combined.slice(0, 499)}…`;
}
