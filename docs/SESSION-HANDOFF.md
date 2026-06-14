# SESSION-HANDOFF

> Archive: handoff sections from 2026-06-06 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`; 2026-05-19 and earlier remain in `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`.
> Keep this file short: only the current active working set and immediate handoff.

## 2026-06-14 — ADR-116 Slice 116.2 landed (preview + injection)

### Baseline

- Slices 116.0 + 116.1 in tree; 116.2 implementation uncommitted at session end.

### What landed (116.2)

- **`files.preview`:** image/\* and native PDF under plan `effectiveMaxPreviewBytes`; oversize → `preview_size_limit`; unsupported mime → `preview_unsupported`.
- **Ephemeral injection:** tool result is JSON ack only; pixels/PDF via turn-local `pendingFilePreviewBlocks` → `toolFollowUpUserContent` on next provider call (after `toolHistory`).
- **Unified hydration:** current-turn attachment direct-input uses bundle `effectiveMaxPreviewBytes` / `effectiveMaxPreviewEdgePx` instead of hardcoded 8 MB / 2048 px.
- **New modules:** `runtime-file-preview-hydration.ts`; provider-gateway OpenAI + Anthropic append ephemeral user multimodal after tool history.

### Verification

- `runtime-files-tool.service.test.ts` (preview success / size limit / unsupported)
- `@persai/runtime` / `@persai/provider-gateway` typecheck; lint + format gate

### Next recommended slice

- **ADR-116.3** — live acceptance, any remaining focused tests/docs.
- **Deploy:** `runtime` + `provider-gateway` for 116.2; `api` + `web` if 116.0 migration/UI not yet deployed.

---

## 2026-06-14 — ADR-116 Slice 116.1 landed (read hardening)

### Baseline

- Slice 116.0 landed in tree; 116.1 implementation uncommitted at session end.

### What landed (116.1)

- **`files.read` document path:** `charCount`, `extractionQuality`, `readNote`, `extractionCached` on tool result; operational `warning` stays separate from `readNote`.
- **Sanitizer:** when clipping `content` to 16k, model JSON gets `truncated: true` and `charCount` of the full text.
- **Internal extract API:** `cached: true` on durable `assistant_files.metadata` cache hits (second read skips download/OCR).

### Verification

- `runtime-files-read-metadata.test.ts`, `runtime-files-tool.service.test.ts`, `sanitize-tool-result-for-model.test.ts`, `extract-internal-runtime-assistant-file.service.test.ts`
- `@persai/api` / `@persai/runtime` typecheck

### Next recommended slice

- **ADR-116.2** — `files.preview` + ephemeral multimodal injection + unified hydration byte limit.
- Then **116.3** live acceptance.
- **Deploy:** `api` + `runtime` for 116.0 + 116.1; migration from 116.0 if not yet applied.
