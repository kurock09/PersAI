/**
 * ADR-170 D10 — the note display classification rule, decided once,
 * deterministically, on the server at emission time. This exists so that no
 * surface ever inspects `note.text` itself to decide whether a pre-tool
 * narration segment renders as a folded "step" line or as inline "content"
 * (a table, heading, fenced code block, or a multi-item list). Classification
 * of *form* is allowed and lives in exactly this one place; inference of
 * *order* is never allowed anywhere (ADR-170 D4).
 *
 * This is a VERBATIM behavioural port of the client-side `isContentBlock`
 * classifier previously at
 * `apps/web/app/app/_components/chat-message.tsx` (~lines 940-957). Slice S3
 * deletes that client-side sniff once the web surface renders
 * `note.display` instead of re-deriving it from text.
 */
export function resolveNoteDisplay(text: string): "step" | "content" {
  if (/^\s*\|.*\|.*\|/m.test(text)) return "content";
  if (/^\s*#{2,}\s+\S/m.test(text)) return "content";
  if (/```/.test(text)) return "content";

  const lines = text.split(/\r?\n/);
  let consecutiveListLines = 0;
  for (const line of lines) {
    if (/^\s*([-*+]|\d+\.)\s+\S/.test(line)) {
      consecutiveListLines += 1;
      if (consecutiveListLines >= 3) return "content";
    } else if (line.trim().length === 0) {
      // Blank lines keep a markdown list visually continuous.
    } else {
      consecutiveListLines = 0;
    }
  }
  return "step";
}
