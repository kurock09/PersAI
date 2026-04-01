# ADR-060: Unified media pipeline — preprocessor, delivery, and inbound services

## Status

Accepted

## Context

ADR-059 established the M-series plan for systemic media support. During implementation of M1–M6, media handling was built per-channel under time pressure, resulting in fragmented logic:

| Concern | Web | Telegram | Problem |
|---------|-----|----------|---------|
| Inbound file upload | `stage-attachment` endpoint + `buildAttachmentContext` | `enrichMessageWithAttachments` in TG turn service | Two independent code paths, no shared normalization |
| Outbound media delivery | `persistToolMediaAttachments` in stream service | `deliverTelegramMedia` in OpenClaw fork | Delivery split across repos, each channel wired separately |
| Audio format handling | Browser records webm → saved as-is → model can't read | Telegram sends ogg/opus → OpenClaw transcribes directly | No normalization; web voice unusable by model |
| Document/PDF handling | Saved as blob → model receives path only | Not implemented | No text extraction; model must read raw file |
| Image handling | Saved as-is | Saved as-is | No resize/format normalization |
| Transcription | PersAI Whisper → text sent as message, file also attached → model confused | OpenClaw Whisper → text only, no file saved | Inconsistent; web sends both text AND file |

Adding WhatsApp, VK, or any future channel would require duplicating all of the above.

### Boundary constraint

OpenClaw generates media payloads (`{ mediaUrls, type, audioAsVoice }`). All delivery, preprocessing, and persistence must live in PersAI. The fork should not grow per-channel delivery logic.

## Decision

### Three services replace fragmented per-channel logic

```
                     INBOUND (user → assistant)
                     ═════════════════════════
   Web/TG/WA/VK ──► InboundMediaService.resolve(channel, rawAttachments)
                           │
                           ▼
                     MediaPreprocessor.process(file, mime)
                           │
                           ├─ audio:    webm/ogg/opus → mp3, + STT transcription
                           ├─ image:    heic → jpg, resize if >4MP
                           ├─ document: pdf/docx → text extract (first 50k chars)
                           ├─ video:    extract keyframe + audio track → STT
                           └─ passthrough for already-normalized formats
                           │
                           ▼
                     Normalized attachment record + enriched userMessage
                     (file path + transcription/extract in context)


                     OUTBOUND (assistant → user)
                     ══════════════════════════
   OpenClaw runtime ──► media payload { url, type, audioAsVoice }
                           │
                           ▼
                     MediaDeliveryService.deliver(artifacts[], channel, chatId)
                           │
                           ▼
                     ChannelMediaAdapter (per-channel implementation)
                           │
                     ┌─────┼──────┬──────────┬────────┐
                     web   tg    whatsapp    vk      ...
                    (SSE+  (Bot   (Cloud     (VK
                    proxy) API)   API)       API)
```

### 1. MediaPreprocessor

Single stateless service. Input: raw file buffer + MIME type. Output: normalized file + metadata.

```typescript
interface PreprocessedMedia {
  normalizedBuffer: Buffer;
  normalizedMime: string;
  normalizedExtension: string;
  transcription: string | null;     // STT for audio/video
  textExtract: string | null;       // content extract for documents
  durationMs: number | null;        // audio/video duration
  width: number | null;             // image/video dimensions
  height: number | null;
}

interface MediaPreprocessor {
  process(buffer: Buffer, mime: string, originalFilename: string): Promise<PreprocessedMedia>;
}
```

Implementation details:
- Audio normalization: `ffmpeg` (already available in container) for webm/ogg/opus → mp3 conversion
- STT: calls OpenClaw's existing `POST /api/v1/runtime/media/transcribe` endpoint
- Image normalization: `sharp` for heic → jpg, resize above threshold
- Document extraction: `pdf-parse` for PDF, plain read for txt/md
- Video: `ffmpeg` extract audio track → STT, extract keyframe for thumbnail
- All operations have timeout (30s default) and size limits (25MB input)

### 2. InboundMediaService

Replaces `stage-attachment` + `buildAttachmentContext` + `enrichMessageWithAttachments`.

```typescript
interface ResolvedInboundMedia {
  attachments: AssistantChatMessageAttachment[];  // persisted DB records
  enrichedMessage: string;                         // original message + attachment context block
}

interface InboundMediaService {
  resolve(params: {
    channel: "web" | "telegram" | "whatsapp" | "vk";
    assistantId: string;
    chatId: string;
    messageId: string;
    userMessage: string;
    rawAttachments: RawInboundAttachment[];
  }): Promise<ResolvedInboundMedia>;
}

interface RawInboundAttachment {
  buffer: Buffer;
  mime: string;
  originalFilename: string;
  source: "user_upload" | "telegram_download" | "whatsapp_download";
}
```

Flow:
1. For each raw attachment → `MediaPreprocessor.process()`
2. Save normalized file to workspace `media/<chatId>/<messageId>/`
3. Create `AssistantChatMessageAttachment` record with metadata
4. Build context block for model:
   ```
   [Files attached by user:
   - media/<path> (image, "photo.jpg")
   - media/<path> (audio, "voice.mp3", transcription: "Привет, как дела?")
   - media/<path> (document, "report.pdf", extract: "Quarterly revenue increased by 15%...")
   You can read or reference them by their path.]
   ```
5. Return attachments + enriched message

### 3. MediaDeliveryService + ChannelMediaAdapter

Replaces `persistToolMediaAttachments` + `deliverTelegramMedia`.

```typescript
interface MediaArtifact {
  url: string;          // workspace-relative path
  type: "image" | "audio" | "video" | "document";
  audioAsVoice?: boolean;
  caption?: string;
}

interface DeliveredMedia {
  attachments: AssistantChatMessageAttachment[];  // persisted DB records
}

interface MediaDeliveryService {
  deliver(params: {
    artifacts: MediaArtifact[];
    channel: "web" | "telegram" | "whatsapp" | "vk";
    assistantId: string;
    chatId: string;
    messageId: string;
  }): Promise<DeliveredMedia>;
}

interface ChannelMediaAdapter {
  readonly channel: string;
  sendImage(target: ChannelTarget, buffer: Buffer, filename: string, caption?: string): Promise<void>;
  sendVoice(target: ChannelTarget, buffer: Buffer, filename: string): Promise<void>;
  sendDocument(target: ChannelTarget, buffer: Buffer, filename: string, caption?: string): Promise<void>;
  sendVideo(target: ChannelTarget, buffer: Buffer, filename: string, caption?: string): Promise<void>;
}
```

Flow:
1. Read media files from workspace
2. Create `AssistantChatMessageAttachment` records
3. Delegate to channel-specific adapter for delivery
4. Web adapter: attachments served via proxy (existing `/api/attachment/[id]`)
5. Telegram adapter: calls Grammy `sendPhoto`/`sendVoice`/`sendDocument`
6. Future adapters: implement same interface

### What changes in OpenClaw fork

**Removed from fork** (moved to PersAI):
- `deliverTelegramMedia` logic → replaced by `TelegramChannelMediaAdapter` in PersAI
- `buildAttachmentContext` duplication → replaced by `InboundMediaService`

**Kept in fork** (runtime-only):
- Media payload generation in agent response (`{ mediaUrls, type, audioAsVoice }`)
- TTS audio file generation to workspace
- Image generation to workspace
- STT transcription endpoint

### Module placement

All three services live in `apps/api/src/modules/workspace-management/application/media/`:

```
media/
  media-preprocessor.service.ts
  inbound-media.service.ts
  media-delivery.service.ts
  channel-adapters/
    web-media.adapter.ts
    telegram-media.adapter.ts
    channel-media-adapter.interface.ts
  media.types.ts
```

### Migration path

1. Build new services alongside existing code
2. Wire `InboundMediaService` into web stream + telegram turn handlers
3. Wire `MediaDeliveryService` into web stream + telegram turn handlers
4. Remove old per-channel logic
5. Verify nothing breaks
6. Clean up

## Consequences

### Positive

- Adding WhatsApp/VK/Matrix = one new adapter file (~100 lines), zero changes to core logic
- Audio always normalized to mp3 — model can always read it, all channels can always play it
- Documents always have text extract — model answers about content without needing to read raw file
- Single place for transcription logic — no web-vs-telegram inconsistency
- Single place for attachment context building — guaranteed consistent format for model
- Testable: each service has clear input/output contract

### Negative

- `ffmpeg` dependency in API container (already present but needs verification)
- `sharp` dependency for image processing (new, ~5MB)
- `pdf-parse` dependency for PDF extraction (new, lightweight)
- Migration requires careful wiring to avoid breaking existing flows

### Trade-offs

- **Eager preprocessing vs lazy**: Chosen eager (process on upload). Adds latency to upload but guarantees model always gets usable content. Lazy would be simpler but leaves model with unreadable files.
- **Normalization in PersAI vs OpenClaw**: Chosen PersAI. Normalization is product policy (what formats we accept, what quality, what size limits), not runtime behavior. Keeps fork minimal.

## Alternatives considered

- **Keep per-channel logic, just fix bugs**: Lower effort but every new channel duplicates everything. Rejected for a SaaS targeting 5+ channels.
- **Normalize in OpenClaw fork**: Would work technically but violates boundary principle. PersAI owns product policy; OpenClaw is runtime executor. Rejected.
- **External media processing service (separate microservice)**: Over-engineering for current scale. The preprocessor is stateless and lightweight. Can extract to service later if needed. Rejected for now.

## Relation to prior ADRs

- [ADR-059](059-systemic-media-attachments-voice-m-series.md) — original M-series plan; this ADR refactors the implementation approach from per-channel to unified pipeline
- [ADR-048](048-native-openclaw-runtime-from-persai-apply-chat.md) — runtime boundary; media delivery moves fully to PersAI side
- [ADR-006](006-openclaw-service-boundary.md) — fork boundary; reduces fork surface by moving delivery logic out
