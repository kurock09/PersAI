# ADR-165: In-loop sync image present into the same live assistant bubble

## Status

**Open 2026-07-24** — founder-directed parent-orchestrated slice on baseline
`ce624fcd`. Parent orchestrates/audits/commits; implementation subagents use
**`cursor-grok-4.5-high-fast` only**. Keep commits separate from ADR-161/162/163/164.

---

## ИКР (Ideal End Result)

On an ordinary web (or TG) turn, when the model calls sync `image_generate` /
`image_edit` and bytes are ready mid-loop:

1. The image appears in the **same** live assistant bubble as a piece
   **immediately after** the producing tool-step (between iteration text/tool
   pieces) — not a separate bubble, not idle/wave-closed/catch-up present.
2. Workspace + sticky alias still land via sync `writeRuntimeOutboundArtifact`.
3. Sandbox hydrate into a warm pod happens **only if a pod already exists** —
   never spin a pod just for the file.
4. After F5 / history reload, interleaving still looks organic (no jump of
   in-loop images into a bottom-only attachment strip).
5. Video stays deferred async; ADR-162 ConversationalPublish / catch-up remains
   the sole chat-present path for ordinary deferred jobs.

**One-sentence ИКР:** sync images present mid-turn inside the open reply bubble,
right after their tool step; deferred media stays on ADR-162.

---

## Decisions

| ID | Decision |
| --- | --- |
| D1 | `shouldDeferMediaToolExecution` never defers `system:media-job:*` threads; never defers `image_generate` / `image_edit`; still defers `video_generate` (and other non-image media) on ordinary threads. |
| D2 | Sync path keeps yielding `artifact` mid-loop; stamp optional `producingToolCallId` on `RuntimeOutputArtifact` / `RuntimeMediaArtifact`. |
| D3 | On web stream `media` chunks: ensure a live assistant message exists early; `mediaDeliveryService.deliver` immediately; persist `metadata.inlineMediaPlacement` as `{ toolCallId, attachmentIds }[]`; SSE `media` with `assistantMessageId` + attachments + `afterToolCallId` so the client binds the local streaming bubble to that row; interrupt/stop reuses the early message; mark delivered identities only for succeeded path-matched artifacts; end-of-turn must not double-deliver. |
| D4 | Web UI extends iteration pieces with `{ kind: "attachment" }`; bottom strip excludes attachments already shown inline. Live stream + committed history both use placement / `inlineAfterToolCallId`. |
| D5 | Warm-pod hydrate is best-effort only when a cheap “pod already exists” hook is available; otherwise leave an explicit residual — no cold-start invent. |

---

## Non-goals

- Sync video present / video no longer deferred.
- Changes to ADR-162 ConversationalPublish, wave-closed continue, or catch-up
  eligibility for deferred/async jobs.
- ADR-161 cache / observation / usage work.
- Spinning a sandbox pod solely to hydrate an outbound image.
- Dual local-assistant invent or absorb-as-architecture for sync images.

---

## Relation to ADR-162

ADR-162 owns **ordinary deferred / post-finalize** media & document chat
present (ConversationalPublish + wave-closed continue). **Sync in-loop image
present (this ADR) is out of deferred catch-up scope** — it attaches into the
open turn bubble during the USER_TURN stream and does not invent FIFO
catch-up bubbles.
