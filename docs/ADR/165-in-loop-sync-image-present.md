# ADR-165: In-loop media present into the live assistant bubble

## Status

**Amended 2026-07-26** — founder rollback of D1 (ordinary `image_generate` /
`image_edit` defer again) + live UI receipts instead of inline file previews.
Parent orchestrates/audits/commits; implementation subagents use
**`cursor-grok-4.5-high-fast` only**. Keep commits separate from ADR-161/162/163/164.

Opened 2026-07-24 on baseline `ce624fcd`; first land `7ab4c0c2`.

---

## ИКР (Ideal End Result)

On an ordinary web (or TG) turn, when media/file bytes become ready while the
assistant reply is still open:

1. The model does **not** special-case image tools as sync — ordinary
   `image_generate` / `image_edit` / `video_generate` defer to async media jobs
   and the model waits via `await` (same as pre-ADR-165).
2. While the live reply is still streaming, the UI shows an italic status-like
   receipt after the producing tool step (e.g. `🖼 Получено изображение —
   генерация (1.0 MB)`), **not** a full inline attachment preview.
3. When the reply commits, attachments render in the **classic bottom strip**
   (pre-ADR-165 attachment UX). Placement metadata is not a permanent interleaved
   preview in history.
4. Workspace + sticky alias still land via existing outbound artifact writes;
   warm-pod hydrate only if a pod already exists.
5. ADR-162 ConversationalPublish / catch-up remains the chat-present path for
   ordinary deferred jobs that finalize outside the open USER_TURN bubble.

**One-sentence ИКР:** media tools stay deferred + `await`; live loop shows
italic “received …” receipts; committed replies keep the classic bottom
attachment strip.

---

## Decisions

| ID | Decision |
| --- | --- |
| D1 | **Rolled back 2026-07-26.** `shouldDeferMediaToolExecution` never defers `system:media-job:*` worker threads; on ordinary threads it **does** defer `image_generate` / `image_edit` / `video_generate` (and other media). No image sync-tool exception. |
| D2 | Keep optional `producingToolCallId` on runtime outbound/media artifacts so mid-stream delivery can bind a receipt to the producing tool step when media lands on the open USER_TURN stream. |
| D3 | On web stream `media` chunks: ensure a live assistant message exists early; `mediaDeliveryService.deliver` when media arrives on that stream; persist `metadata.inlineMediaPlacement` as `{ toolCallId, attachmentIds }[]`; SSE `media` with `assistantMessageId` + attachments + `afterToolCallId` so the client binds the local streaming bubble; interrupt/stop reuses the early message; mark delivered identities only for succeeded path-matched artifacts; end-of-turn must not double-deliver. |
| D4 | **Amended 2026-07-26.** Live UI: iteration pieces may include `{ kind: "media_receipt" }` (italic status line). Committed UI: no inline attachment/receipt pieces from placement — classic bottom `AttachmentStrip` for all attachments. Do not hide ordinary image/video live activity labels. |
| D5 | Warm-pod hydrate is best-effort only when a cheap “pod already exists” hook is available; otherwise leave an explicit residual — no cold-start invent. |

---

## Non-goals

- Sync video present / forcing image tools to run sync in the turn loop.
- Changes to ADR-162 ConversationalPublish, wave-closed continue, or catch-up
  eligibility for deferred/async jobs.
- ADR-161 cache / observation / usage work.
- Spinning a sandbox pod solely to hydrate an outbound image.
- Dual local-assistant invent or absorb-as-architecture for media present.

---

## Relation to ADR-162

ADR-162 owns **ordinary deferred / post-finalize** media & document chat
present (ConversationalPublish + wave-closed continue). ADR-165 owns **live
bubble binding + receipt UX** when media arrives on the open USER_TURN stream
(and the placement metadata that powers those live receipts). It does not
reintroduce a sync-image tool exception.
