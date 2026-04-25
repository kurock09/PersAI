/**
 * Pre-prod polish 2026 / FIX 3 — shared sentinel for "user pressed Send with
 * no typed text but at least one staged attachment".
 *
 * The web stream API requires `message` to be a non-empty string after trim
 * (`SendWebChatTurnService.parseInput` in `apps/api`). Until we make that
 * field genuinely optional (which is a contract change and a separate ADR
 * conversation), the chat composer fills it with this short placeholder when
 * the user sent only attachments. The placeholder is then persisted into the
 * user message's `content` field and replays into history.
 *
 * `chat-message.tsx` uses `isAttachmentsOnlyPlaceholderText` at render time to
 * suppress the `<p>` for user bubbles whose only content is this placeholder
 * (or empty after trim, defensively) — the attachment strip below speaks for
 * itself, and the user no longer sees a literal "(attached files)" line in
 * their own message.
 *
 * Both producer (`chat-input.tsx`) and renderer (`chat-message.tsx`) read the
 * constant from this single module so they cannot drift.
 */
export const ATTACHMENTS_ONLY_PLACEHOLDER = "(attached files)";

/**
 * True when the given content string is, after trimming, either empty or the
 * canonical attachments-only placeholder. Used by the user bubble to decide
 * whether the text node should be rendered at all when attachments are
 * already present in the same message.
 */
export function isAttachmentsOnlyPlaceholderText(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length === 0 || trimmed === ATTACHMENTS_ONLY_PLACEHOLDER;
}
