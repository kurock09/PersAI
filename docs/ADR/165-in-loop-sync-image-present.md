# ADR-165: In-loop media present into the live assistant bubble

## Status

**Amended 2026-07-26** — founder rollback of D1 (ordinary `image_generate` /
`image_edit` defer again) + live UI receipts instead of inline file previews.
**Amended again 2026-07-26** — open USER_TURN job-deliver uses the same live
`media` + `async_jobs_open` contour (no parallel bus); Working banner clears on
job terminal, not turn end. Parent orchestrates/audits/commits; implementation
subagents use **`cursor-grok-4.5-high-fast` only**. Keep commits separate from
ADR-161/162/163/164.

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
| D6 | **2026-07-26.** While a web USER_TURN attempt is `running` for the job’s `sourceUserMessageId`, **media** job completion **must not** take the ADR-162 settle-without-chat path. It claims `current_turn_inline` if still unowned, attaches into the open assistant bubble (create+bind early row if needed), publishes SSE `media` (same shape as stream mid-present) for receipts, and publishes SSE `async_jobs_open` so the Working banner clears on job terminal. Document jobs keep ADR-162 settle/ConversationalPublish for chat invent (persist does not yet reuse document pins) but still publish `async_jobs_open` on terminal so Working clears. Closed-turn ordinary deferred media still uses ConversationalPublish. One turn bus — no second websocket / parallel client handler family. |

---

## Non-goals

- Sync video present / forcing image tools to run sync in the turn loop.
- Changes to ADR-162 ConversationalPublish / wave-closed continue for jobs that
  finalize **after** the source USER_TURN is already closed.
- ADR-161 cache / observation / usage work.
- Spinning a sandbox pod solely to hydrate an outbound image.
- Dual local-assistant invent or absorb-as-architecture for media present.

---

## Relation to ADR-162

ADR-162 owns **ordinary deferred / post-finalize** media & document chat
present (ConversationalPublish + wave-closed continue) when the source
USER_TURN is already closed. ADR-165 owns **live bubble binding + receipt UX**
when bytes arrive while that USER_TURN is still open — including deferred
media/document jobs that finish mid-loop (D6), via the same SSE `media` /
placement contour as stream mid-present, plus `async_jobs_open` for Working.
It does not reintroduce a sync-image tool exception.
