# ADR-059: Systemic media, attachments, and voice support (M-series)

## Status

Accepted

## Context

PersAI chat is plain text end-to-end. The entire pipeline — DB schema (`assistant_chat_messages.content TEXT`), public API (`{ message: string }`), OpenClaw adapter (`userMessage: string → assistantMessage: string`), Telegram bot handler (only `message:text`), and web frontend (textarea, no media) — carries only text.

This creates five concrete product gaps for a mass-market SaaS:

1. **Tool media is lost in transit.** OpenClaw tools (`image_generate`, `tts`) produce media files with structured `details.media.mediaUrls` / `details.media.mediaUrl`, and the full OpenClaw delivery pipeline (`normalizeOutboundPayloads` → `deliverOutboundPayloads` → Telegram `sendPhoto`/`sendVoice`) supports rich media delivery. However, PersAI runs agent turns with `deliver: false` and `resolveAgentResponseText()` only extracts `.payloads[].text`, discarding all media. Users see "Generated audio reply." as text instead of an audio player.

2. **No voice messages.** OpenClaw has working STT (`transcribeAudioFile` via OpenAI Whisper in `media-understanding/runtime.ts`) and TTS (OpenAI, ElevenLabs, Microsoft providers with channel-aware opus/mp3 output), but neither is wired to PersAI flows. Telegram bot ignores `message:voice`, web UI has no microphone input.

3. **No file/image upload.** Web chat input has a disabled paperclip button ("coming soon"). There is no way for users to send images, documents, or other files to the assistant.

4. **No attachment data model.** There is no DB column, table, or API contract for media metadata on chat messages. Even if media were captured, there is nowhere to persist it.

5. **Media capabilities exist but are inactive.** `effectiveCapabilities.mediaClasses` already defines `{ text, image, audio, video, file }` in the type system, but `image/audio/video/file` are hardcoded to `false` in `resolve-effective-capability-state.service.ts`. Plan entitlements include `channelsAndSurfaces` but not `mediaClasses`.

### Existing infrastructure to reuse

| Component | Status | Reuse path |
|-----------|--------|------------|
| GCS FUSE per-assistant workspace | Working (`/mnt/workspaces/persai/<assistantId>/`) | Add `media/` subdirectory for chat attachments |
| Avatar upload/download proxy | Working (PersAI API → OpenClaw HTTP → workspace files) | Same proxy pattern for chat media |
| Tool credential pipeline | Working (`tool_tts` → encrypted store → bootstrap → runtime resolve) | Yandex TTS key flows through same path |
| Quota system | Working (`WorkspaceQuotaDimension` enum + state + events + limits) | Add `media_storage_bytes` dimension |
| Chat hard-delete cleanup | Working (runtime session delete → DB transaction) | Extend with media directory cleanup |
| Assistant reset cleanup | Working (`rm -rf` workspace directory) | Already covers media (directory is child of workspace) |
| OpenClaw TTS providers | Working (OpenAI, ElevenLabs, Microsoft Edge + voice-bubble opus for Telegram) | Add Yandex provider |
| OpenClaw STT | Working (`transcribeAudioFile()` via Whisper) | Call from PersAI bridge files |
| OpenClaw Telegram media APIs | Working (`sendVoice`, `sendPhoto`, `sendDocument` in `extensions/telegram/src/send.ts`) | Import from PersAI bridge Telegram handler |
| OpenClaw media extraction | Working (`extractToolResultMediaArtifact`, `normalizeOutboundPayloads`) | Use in bridge `resolveAgentResponse` |
| `mediaClasses` capability flags | Typed but hardcoded false | Activate from plan entitlements |

### Boundary-first analysis

The PersAI bridge files in the OpenClaw fork (`src/gateway/persai-runtime/persai-runtime-*.ts`) are designed to be extended without modifying native OpenClaw code. The only native OpenClaw change required in this entire M-series is adding a Yandex TTS provider (one new file + one line in the provider registry).

## Decision

### Architecture: media as a first-class message dimension

Media/attachments become a normalized, channel-agnostic layer in PersAI's message model. Every surface (web, Telegram, WhatsApp, MAX) produces and consumes the same attachment schema. Channel-specific concerns (opus for Telegram voice, thumbnails for web) are adapter-only.

```
User input (text/voice/file) → PersAI API (persist attachment + message)
  → OpenClaw runtime (agent turn with media context)
  → Agent response (text + tool media)
  → PersAI API (persist response + tool media as attachments)
  → Surface adapter (web: inline player/image; Telegram: sendVoice/sendPhoto)
```

### Delivery UX: post-completion with status indication

Tool media (images, audio) is resolved and delivered after the streaming turn completes. During generation, the model naturally writes status text ("Generating image..."). In messengers, a status message is sent before the media. No fake inline streaming of binary content.

### Slicing plan (7 slices)

#### M1: Media foundation — DB model, storage, contracts

**Scope:** Backend-only foundation. No UI, no channel changes.

PersAI changes:
- Prisma: `assistant_chat_message_attachments` table (id, message_id, chat_id, assistant_id, workspace_id, attachment_type enum [`image`, `audio`, `voice`, `video`, `document`, `tool_output`], storage_path, original_filename, mime_type, size_bytes, duration_ms nullable, width nullable, height nullable, processing_status enum [`pending`, `ready`, `failed`], transcription nullable text, metadata JSONB nullable, created_at)
- Repository: `AssistantChatMessageAttachmentRepository` (create, findByMessageIds, findById, deleteByMessageIds, deleteByChatId, deleteByAssistantId)
- Extend `hardDeleteChat` to call new `deleteByChat` + runtime media cleanup
- Extend `resetAssistant` transaction to include `deleteMany` on attachments (physical files already cleaned by workspace reset)
- OpenAPI: extend `AssistantWebChatMessageState` with optional `attachments[]`
- OpenAPI: add `GET /api/v1/assistant/chats/web/{chatId}/messages/{messageId}/attachments/{attachmentId}` (proxy download from workspace)
- OpenAPI: extend `AssistantWebChatTurnRequest` with optional `attachmentIds[]` (references to pre-uploaded files)
- OpenAPI: add `POST /api/v1/assistant/chats/web/upload` (multipart upload → workspace storage → returns attachmentId)
- Contracts: regenerate typed client
- `mediaClasses` activation: resolve `image/audio/video/file` from plan entitlements `mediaClasses` array (new entitlement dimension) instead of hardcoded false; enforcement at upload and chat send boundaries

OpenClaw bridge changes:
- `persai-runtime-http.ts`: add `POST /api/v1/runtime/workspace/media/upload` and `GET /api/v1/runtime/workspace/media/download` handlers (write/read files under `<assistantId>/media/<path>`)
- `persai-runtime-http.ts`: add `DELETE /api/v1/runtime/workspace/media/delete-chat` handler (remove `<assistantId>/media/<chatId>/` directory)

Native OpenClaw changes: none.

#### M2: Tool media delivery — web chat

**Scope:** Tool-generated images and audio become real attachments in web chat responses.

OpenClaw bridge changes:
- `persai-runtime-agent-turn.ts`: extend `resolveAgentResponseText` → `resolveAgentResponse` that returns `{ text: string, media: Array<{ url: string, type: string, audioAsVoice?: boolean }> }` by reading `payloads[].mediaUrl`, `payloads[].mediaUrls`, `payloads[].audioAsVoice` and using `extractToolResultMediaArtifact` pattern
- `persai-runtime-http.ts`: sync and stream response shapes include `media[]` alongside `assistantMessage`
- Stream NDJSON: add `{ type: "media", media: [...] }` event emitted after `done` but before connection close, so PersAI receives media references when the turn completes

PersAI changes:
- `OpenClawRuntimeAdapter`: parse `media[]` from sync response and stream `media` event
- `SendWebChatTurnService` / `StreamWebChatTurnService`: after successful turn, copy media files from workspace to `media/<chatId>/<messageId>/` path, create `assistant_chat_message_attachments` rows
- Web UI: `ChatMessageBubble` renders attachments — images inline (`<img>` with lightbox), audio with `<audio>` player, voice with waveform player, documents as download links
- Web UI: message history load includes attachments via `include: { attachments: true }`

Native OpenClaw changes: none.

#### M3: Web voice messages (send + receive)

**Scope:** Users can send voice messages via microphone in web chat and receive voice responses.

PersAI changes:
- Web UI: `ChatInput` — microphone button, `MediaRecorder` API (opus/webm), recording UX with timer and waveform preview
- Web UI: on recording complete → `POST /api/v1/assistant/chats/web/upload` → receive `attachmentId`
- Web UI: send message with `attachmentIds: [voiceAttachmentId]` and empty or minimal `message` text
- API: `PrepareAssistantInboundTurnService` — when message has voice attachment with `processing_status: pending`, call OpenClaw STT before forwarding to runtime

OpenClaw bridge changes:
- `persai-runtime-http.ts`: add `POST /api/v1/runtime/media/transcribe` handler that calls native `transcribeAudioFile()` and returns `{ text: string }`

PersAI changes (continued):
- `OpenClawRuntimeAdapter`: add `transcribeMedia(assistantId, filePath)` method
- After STT: update attachment `processing_status: ready`, `transcription: text`; use transcription as `userMessage` for the runtime turn (original voice preserved as attachment for playback)
- Web UI: voice message bubbles show waveform + play button + transcription text below

Native OpenClaw changes: none (uses existing `transcribeAudioFile`).

#### M4: Web file/image upload

**Scope:** Users can send images and documents alongside text messages in web chat.

PersAI changes:
- Web UI: `ChatInput` — activate paperclip button, file picker (images: jpg/png/gif/webp, documents: pdf/txt/md), drag-and-drop support
- Web UI: selected files show as preview chips before sending; upload on send
- Web UI: image attachments render inline in user messages; documents render as download cards
- API: validation — max file size (configurable, default 10MB), allowed MIME types, max attachments per message (configurable, default 5)
- Capability enforcement: `mediaClasses.image` / `mediaClasses.file` checked at upload boundary
- Quota: track `media_storage_bytes` dimension on upload; enforce workspace media storage limit

OpenClaw bridge changes: none (M1 upload/download endpoints sufficient).

Native OpenClaw changes: none.

#### M5: Telegram media — inbound (voice, photo, document)

**Scope:** Telegram bot accepts voice messages, photos, and documents from users.

OpenClaw bridge changes:
- `persai-runtime-telegram.ts`: add handlers for `message:voice`, `message:photo`, `message:document`, `message:video`
- `allowed_updates` webhook config: already includes `message` which covers all message subtypes
- Voice handler: download file via Grammy `getFile` API → call `transcribeAudioFile()` for STT → send transcription as `userMessage` to PersAI internal turn with attachment metadata
- Photo/document handler: download file → store in workspace `media/telegram/<chatId>/` → send to PersAI internal turn with attachment metadata

PersAI changes:
- Extend `InternalTelegramTurnRequest` with optional `attachments: Array<{ type, storagePath, mimeType, sizeBytes, originalFilename, transcription?, duration? }>`
- `HandleInternalTelegramTurnService`: persist attachments from Telegram on the resulting message records (create PersAI chat records for Telegram turns that carry media)
- `InternalRuntimeTurnController`: parse attachment fields from request body

Native OpenClaw changes: none.

#### M6: Telegram media — outbound (voice, photo, tool results)

**Scope:** Telegram bot sends images, voice notes, and documents back to users.

OpenClaw bridge changes:
- `persai-runtime-telegram.ts`: extend reply handling — when PersAI internal turn response includes `media[]`, use Grammy `sendPhoto` / `sendVoice` / `sendDocument` from existing `extensions/telegram/src/send.ts` module
- For tool-generated images: send as photo with caption
- For TTS/voice tool output: send as voice note (opus, using existing `audioAsVoice` flag)
- Status UX: if media generation is expected (turn takes >3s), send intermediate "⏳" typing indicator via `ctx.replyWithChatAction("upload_photo")` / `("record_voice")`

PersAI changes:
- Extend `HandleInternalTelegramTurnService` response shape to include `media[]` from runtime turn result
- Surface renderer formats media references for Telegram delivery

Native OpenClaw changes: none (uses existing Grammy APIs from `extensions/telegram`).

#### M7: Yandex SpeechKit TTS provider

**Scope:** Add Yandex SpeechKit as a TTS synthesis option alongside existing providers.

Native OpenClaw changes (minimal, justified — runtime TTS execution lives inside OpenClaw):
- New file: `src/tts/providers/yandex.ts` — implements `SpeechProviderPlugin` interface following the exact pattern of `openai.ts` / `elevenlabs.ts`; Yandex SpeechKit v3 REST API (`POST https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize`); supports opus output for voice-bubble channels
- `src/tts/provider-registry.ts`: add `buildYandexSpeechProvider` to `BUILTIN_SPEECH_PROVIDER_BUILDERS` array (1 line)

PersAI changes:
- Tool credential settings: Yandex provider selection already exists (`TOOL_PROVIDER_OPTIONS.tool_tts` includes `yandex`); `YANDEX_TTS_API_KEY` env var mapping already exists in `PROVIDER_ENV_OVERRIDES`
- Admin UI: provider dropdown for TTS already renders Yandex option
- No additional PersAI changes needed — credential flow is already wired

## Consequences

### Positive

- Every surface (web, Telegram, future WhatsApp/MAX) uses the same attachment model — no per-channel ad hoc solutions.
- Tool media (images, audio) that OpenClaw already produces finally reaches users as proper rich content instead of text descriptions.
- Voice interaction completes the assistant UX for both web and Telegram with zero new STT infrastructure (reuses existing Whisper).
- Yandex TTS adds Russian-language voice quality option for the target market with one new file and one registry line.
- Media capabilities are plan-governed and quota-tracked from day one — no retroactive enforcement needed.
- All 7 slices are independently shippable and testable; each leaves the system in a working state.
- Only 2 lines of native OpenClaw code change (provider registry); everything else is PersAI-only or PersAI bridge files in the fork.

### Negative

- GCS FUSE adds ~5-15ms latency per media file operation; for large files this is acceptable but not instant.
- Post-completion media delivery means users wait for the full turn before seeing generated images; the tradeoff is reliability over perceived speed.
- Voice STT adds OpenAI Whisper API cost per voice message; this is governed by the existing quota/tool-limit infrastructure.
- The 7-slice delivery requires sustained focus; partial delivery (e.g., M1-M2 only) still provides value but leaves Telegram and voice incomplete.

### Trade-offs

- **Post-completion vs inline streaming for media:** Chosen post-completion for reliability. The model writes natural status text during generation. Inline streaming of binary content would require complex buffering and partial-file handling with no clear UX benefit.
- **Workspace filesystem vs dedicated object storage:** Chosen workspace (GCS FUSE) because infrastructure already exists and is proven. If media volume exceeds GCS FUSE performance envelope (>10,000 concurrent files per assistant), migration to direct GCS API with signed URLs is a clean swap at the storage layer without API/DB changes.
- **Single attachment table vs JSONB on messages:** Chosen separate table for clean quota queries, async processing status tracking, and lifecycle management (cascade delete, independent indexing).

## Alternatives considered

- **JSONB metadata column on `assistant_chat_messages`:** Simpler migration but poor for quota aggregation (`SUM(size_bytes)`), async processing tracking, and independent lifecycle management. Rejected for a SaaS product that needs media storage quotas.
- **Dedicated object storage (S3/GCS direct) with signed URLs:** Better for high-scale media serving but requires new infrastructure, IAM setup, and URL signing. Can be added later as a storage layer swap without changing the data model or API contracts. Deferred.
- **Inline streaming media events during tool execution:** Complex buffering, partial file handling, and frontend state management for marginal UX improvement. The model's natural "generating..." text plus post-completion delivery is honest and reliable. Rejected for MVP.
- **Native OpenClaw delivery pipeline (`deliver: true`):** Would bypass PersAI control-plane ownership of message persistence, quotas, and per-surface formatting. Violates the established boundary where PersAI owns product policy and OpenClaw is runtime executor. Rejected.

## Relation to prior ADRs

- [ADR-015](015-chat-record-model-and-runtime-session-boundary.md) — M1 extends the chat message model with attachment dimension
- [ADR-017](017-web-chat-streaming-first-transport.md) — M2 extends streaming protocol with post-completion media event
- [ADR-034](034-telegram-connection-and-delivery-surface-e4.md) — M5/M6 extend Telegram surface with media inbound/outbound
- [ADR-052](052-tool-credential-refs-and-tool-quota-limits-h2.md) — M7 reuses tool credential pipeline for Yandex TTS
- [ADR-053](053-runtime-hydration-depth-persona-memory-workspace-h3.md) — M1 reuses workspace storage model for media
- [ADR-056](056-unified-inbound-turn-gateway-and-persai-owned-reminders-h12-h13.md) — M5 extends unified turn gateway with attachment support
- [ADR-058](058-concrete-h13-unified-turn-gateway.md) — M5/M6 follow the same PersAI→OpenClaw turn pattern for media-enriched turns

## Slice dependency graph

```
M1 (foundation) ─┬─► M2 (tool media web) ─► M4 (web file upload)
                  │
                  ├─► M3 (web voice) ───────► M5 (telegram inbound) ─► M6 (telegram outbound)
                  │
                  └─► M7 (yandex tts) [independent, can ship any time after M1]
```

M1 is prerequisite for all others. M7 is independent after M1. M2-M6 follow the dependency chain shown. M3 and M4 can be parallelized after M2.
