# SESSION-HANDOFF

> Archive: handoff sections from 2026-06-06 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`; 2026-05-19 and earlier remain in `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`.
> Keep this file short: only the current active working set and immediate handoff.

## 2026-06-09 - ADR-112 memory-source + Telegram channel context follow-up

### Baseline

- Starting SHA: `1d86efdf` (clean tree after stacked ADR-112 Slice 5/6/9 + TTS UI commit).
- Scope: small operator-approved ADR-112 prompt-context follow-up. Keep it slim: use existing memory `chatId` truth for source markers, remove visible `open_loop` duplication between recent short memory and `Open Loop Refs`, slim `Working Files`, and make Telegram channel context cover both private and group Telegram turns with voice/audio guidance. Out of scope: new DB columns, broader memory retrieval/ranking changes, background job visibility (Slice 7), and background prompt hygiene (Slice 8).

### What changed

- `HydrateMemoryForTurnService` now includes each memory row's existing `chatId` in the internal runtime hydration payload. Runtime accepts the field and compares it to the current canonical chat id when available.
- Durable memory rendering adds compact source markers only when known: labels become `this chat · ...` or `past chat · ...`; unknown/null source chat stays unmarked. If a selected memory came from a past chat, the block adds one short instruction to use chat/context search for details instead of assuming the fact happened in the current conversation. Unresolved `open_loop` short memories are no longer rendered in the recent short-memory block, leaving their model-facing operational surface in `Open Loop Refs`.
- `TurnExecutionService` now renders one centralized `## Channel Context` section for Telegram private and group conversations. Telegram audio/voice-like inbound attachments add a concise voice-reply preference hint when TTS is available; group-only privacy cautions still appear only for group mode.
- `Working Files` is slimmer: the column-format legend is gone, guidance is compressed to sticky aliases / discovery / delivery honesty, and historical audio/voice attachments are suppressed from the default prompt surface while current-turn audio and explicitly discoverable files remain available through the files tools.

### Verification

- `corepack pnpm --filter @persai/api exec tsx test/hydrate-memory-for-turn.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/working-files-developer-section.test.ts`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/runtime run typecheck`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/web run typecheck`
- `git diff --check`

### Risks / residuals

- Background/idle auto-extract writes that cannot be tied to a specific canonical user message may still have `chatId = null`; runtime intentionally leaves those unmarked rather than mislabeling them as current or past.
- The Telegram voice hint is based on inbound audio attachments (`kind=audio` / `audio/*` MIME). If future Telegram STT carries a richer explicit voice-note signal, this section can consume it without changing the developer-section shape.

### Next recommended step

Commit this bounded follow-up if accepted. Then continue ADR-112 with Slice 7 (background jobs visibility) and Slice 8 (background model-call prompt hygiene).

## 2026-06-08 - ADR-112 Slices 5-6 + 9 tool-surface cleanup

### Baseline

- Starting SHA: `b771c981` (operator-approved stacked dirty flow after Slice 10 extractor tightening; no intermediate commit by request).
- Scope: ADR-112 Slice 5 plus the narrowed Slice 6 residual, followed by Slice 9 descriptor/instruction hygiene in the same operator-approved stacked dirty flow. Collapse file/media references into one stable sticky alias namespace for the model (`file #N` / `image #N`), keep `fileRef` hidden as execution identity, update runtime/tool consumers together, remove the remaining dead current-turn image ordinal plumbing, and clean model-facing tool descriptor vocabulary without changing execution architecture. Out of scope: background job visibility (Slice 7), background model-call prompt hygiene (Slice 8), and additional memory changes beyond the already-completed Slice 10 tightening.

### What changed

- `TurnContextHydrationService` now assigns stable sticky aliases from first appearance and preserves them through current attachments, historical images/documents, discovered file refs, and same-file merges instead of recomputing current/previous/recent/found/read ordinals.
- `TurnExecutionService` now renders `## Working Files` with `AssistantFile.createdAt | author | sticky label | filename | markers | microdescription`, separates recency/role into markers (`current source`, `last delivered result`, etc.), keeps same-name files visible with short-hash disambiguation, preserves document anchors past the display cap, and merges files-tool discovery refs without creating a parallel alias scheme.
- Runtime file/document/image tool guidance and native tool projection examples now teach sticky `file #N` / `image #N` handles. Document tool tests now use explicit `currentAttachments` / `availableAttachments` job inputs.
- Cleanliness follow-up: stale source comments and Slice 5-focused tests were updated away from legacy discovery aliases; the only remaining `previous attachment` source occurrence is a user-text intent detector in the document tool, not model-facing guidance.
- Slice 6 residual cleanup removed unused `showCurrentTurnImageOrdinals` plus the unused direct-attachment id/image/pdf counters from runtime hydration. Source audit shows no active runtime turn assembly still uses `## File history` or that dead current-turn image ordinal path.
- Independent audit follow-up closed the major media-path residual: image/video tool attachments now reuse aliases from Working Files/current turn state rather than running a second ephemeral `image #N` / `file #N` numbering path; media tool result/log aliases prefer sticky labels; files-tool model-visible alias arrays put sticky labels first and drop legacy ordinal aliases; non-UUID `docId` inputs are nulled/logged before enqueue; and stale runtime-contract / ADR-081 alias docs now point to sticky Working Files truth.
- Slice 9 cleaned runtime model-facing descriptors/instructions: `document` now consistently uses `docId` and states UUID-only; `memory_write` field descriptions no longer expose ADR-id cruft; `scheduled_action` projection is user-reminder-only and sanitizes stale hidden-follow-up / `assistant_check` policy copy; `background_task` projection no longer advertises ghost `update`; image/video/document pending-delivery honesty copy is centralized; video persona guidance consistently uses `Settings -> Characters`; and `tts` has a short tool-use rule for spoken replies/voice notes without claiming audio before `action='generated'`.

### Verification

- `corepack pnpm --filter @persai/runtime exec tsx test/working-files-developer-section.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution-discovered-file-refs.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/runtime-files-tool.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/runtime-document-tool.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/runtime-image-edit-tool.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/runtime-image-generate-tool.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/runtime-video-generate-tool.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/native-tool-projection.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/runtime-scheduled-action-tool.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/runtime-tts-tool.service.test.ts`
- `corepack pnpm --filter @persai/runtime run typecheck`
- `corepack pnpm --filter @persai/runtime run lint`
- `git diff --check`

### Risks / residuals

- Some historical docs/tests still mention legacy aliases as historical examples or explicit negative/compatibility fixtures, but active runtime model guidance and model-visible tool results now use sticky aliases.
- Internal compatibility names such as old memory alias tool codes remain in non-model-facing fixtures/config tests where they are exercising migration/compile behavior, not live projected tool descriptors.
- Provider-specific placement remains on the established ADR-110 path: OpenAI developer instructions and Anthropic user-wrapped runtime developer context. No provider projection code changed in this residual cleanup.

### Next recommended step

Run the full AGENTS.md verification gate on the stacked Slice 10c + 5/6 + 9 tree, then prepare the single combined commit when the operator is ready. After that, continue ADR-112 with Slice 7 (background jobs visibility) and Slice 8 (background model-call prompt hygiene).

## 2026-06-08 - ADR-112 post-Slice 10 auto-extract tightening

### Baseline

- Starting SHA: `b771c981` (clean tree).
- Scope: bounded ADR-112 follow-up on the runtime auto-extractor only. Tighten prompt/parser quality so idle/compaction extraction writes fewer higher-confidence memories, keeps `open_loop` concrete and usually `short`, and stops obvious vague/test/ephemeral items. Out of scope: scheduler/watermark logic, hydration, API write routing, provider changes, Slice 5/6/9 work.

### What changed

- `AutoExtractToMemoryService` now hard-caps extraction to `3` items instead of `8`, and the model prompt was rewritten to prefer zero over weak items, require explicit evidence, avoid broad portraits/personality takes, treat `open_loop` as a concrete unresolved action/decision rather than a vague direction, and reserve `long` for explicit/repeated/decision-grade evidence only.
- The prompt no longer tells the model to write in a warm first-person friend voice. It now asks for concise neutral memory notes while still forbidding user-voice / verbatim quotes.
- Added a small parser-side guardrail in the same runtime service: obvious test-voice/demo/ephemeral summaries are skipped, vague interest/product-direction `open_loop` summaries are skipped, `open_loop` items requested as `long` are deterministically downgraded to `short` unless the summary explicitly signals a durable long-term goal/commitment, and numeric-confidence `long` fact/preference candidates below `0.85` are skipped.
- Focused runtime tests now lock both the tightened prompt rules and the parser filtering/normalization behavior.

### Verification

- `corepack pnpm --filter @persai/runtime exec tsx test/auto-extract-to-memory.service.test.ts`
- `corepack pnpm --filter @persai/runtime run typecheck`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `git diff --check`

### Risks / residuals

- Extraction quality is still primarily model-judged; this slice only tightens the control surface and adds a narrow negative guardrail, so some borderline outputs may still depend on provider behavior.
- The parser guard is intentionally conservative and string-based; if live extraction still overcaptures new vague patterns, a later bounded follow-up may need one more narrow filter or prompt example.

### Next recommended step

Keep ADR-112 Slice 10 behavior under live review, then continue the agreed backlog order outside this follow-up: Slice 5, Slice 6, then Slice 9.

## 2026-06-08 - ADR-112 Slice 10 two-tier memory path + idle extraction completion

### Baseline

- Starting SHA: `5719b25c` (operator-approved dirty tree because `docs/ADR/112-context-memory-and-tool-surface-quality-program.md` already had an in-progress docs-only Slice 10 update; that pre-existing docs edit was preserved).
- Scope: ADR-112 Slice 10 completion — finish the already-landed two-tier memory path by adding the idle-session extraction watermark/scheduler follow-up, wiring it to the same compaction auto-extract seam, and updating docs to close the slice. Out of scope: broader Slice 9 tool-surface cleanup and unrelated ADR-113 work.

### What changed

- `memory_write` now exposes `layer: "long" | "short"` at the runtime/model boundary (`packages/runtime-contract`, runtime tool projection/parser, compaction auto-extract prompt/parser, internal API client, focused runtime tests). API write-side routing now maps `long -> core + identity/stable` and `short -> contextual + episodic/time_bound`, while persisted DB fields stay unchanged.
- The raw web-turn memory path was removed from production: `RecordWebChatMemoryTurnService` and its focused test were deleted, its callers were removed from `send-web-chat-turn.service.ts` / `stream-web-chat-turn.service.ts` / `complete-web-post-runtime-turn.ts`, and the old web-chat summary/skip helpers were deleted from `memory-summary.util.ts`. New raw `user · assistant` transcript rows are no longer created on successful web turns.
- `HydrateMemoryForTurnService` now reads a bounded newest-first recency window from active contextual `memory_write` rows instead of lexical `searchMemory(...)`, and the runtime contextual block now renders as a single recent short-memory list (still volatile via `cacheRole: "volatile_context"`). `TurnExecutionService` now removes retrieved-knowledge memory items whose summary is already present in that short-memory block before final prompt planning.
- Anthropic volatile memory projection now wraps recent short memory as app-provided `<persai_runtime_context><recent_short_memory>...` and explicitly states that the next user message is the real request, reducing the chance that Claude treats memory as a user turn. OpenAI keeps the provider-native `developer` item for the same volatile memory.
- `runtime_sessions` now carries explicit `memoryExtractionWatermark` truth (additive migration `20260608173000_adr112_slice10_idle_memory_extraction_watermark`). Compaction auto-extract no longer reprocesses the full summarized prefix: it slices only the compacted messages after the watermark and advances the watermark on any successful/no-item evaluation, so compaction and idle extraction share one durable prefix boundary.
- Added an API-side idle-session enqueue scheduler (`PersaiIdleSessionMemoryExtractionSchedulerService`) that reuses the existing background-compaction job table/scheduler. After `20` minutes idle it qualifies `web`/`telegram` sessions with at least `10` new hydratable canonical messages after the watermark, enqueues one `idle_extract` job for that thread, and suppresses repeat jobs until a newer turn opens a fresh idle window.
- Added a runtime idle extraction path (`POST /api/v1/internal/runtime/sessions/idle-extract`) that reuses the same compact-model `AutoExtractToMemoryService` over only the unprocessed delta. Successful/no-item runs advance the watermark to the current hydratable count; provider/incomplete failures leave the watermark unchanged and return bounded retry metadata. The background scheduler now stores failed idle snapshot payloads and skips memory consolidation for `idle_extract` jobs.
- Cleanup audit fix: background-compaction queue dedupe keys now include an explicit lane (`compaction` vs `idle_extract`) so a pending idle extraction can never suppress a real post-turn/manual compaction job, and retry/release paths restore the same lane-aware dedupe key.

### Verification

- `corepack pnpm --filter @persai/runtime exec tsx test/runtime-memory-write-tool.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/auto-extract-to-memory.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/prompt-cache-stable-blocks.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/session-store.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/session-compaction.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/turn-context-hydration.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts`
- `corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma`
- `corepack pnpm --filter @persai/api exec tsx test/enqueue-background-compaction-job.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/persai-background-compaction-scheduler.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/persai-idle-session-memory-extraction-scheduler.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/write-assistant-memory.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/hydrate-memory-for-turn.service.test.ts`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/runtime run typecheck`
- `corepack pnpm --filter @persai/api run lint`
- `corepack pnpm --filter @persai/runtime run lint`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm run format:check`
- `git diff --check`

### Risks / residuals

- Historical `web_chat` rows remain in storage until old data is cleaned by existing backfill/admin paths; Slice 10 stops creating new ones but does not rewrite legacy rows.
- The new migration is additive (`runtime_sessions.memory_extraction_watermark` + enum widening). It must be applied before promoting the API/runtime pair that uses the watermark-aware idle extraction path.

### Next recommended step

ADR-112 Slice 10 is complete. Continue the agreed batch order: Slice 5 sticky file aliases, then Slice 6 developer-block clarity, then Slice 9 tool descriptor + instruction hygiene, while preserving the now-closed long/short memory and idle extraction truth.

## 2026-06-08 - ADR-113 ElevenLabs picker correction + admin curation

Follow-up after rollout/UI review:

- `ElevenLabsVoiceCatalogService` now refreshes from ElevenLabs shared voice library (`/v1/shared-voices`) into an expanded admin-candidate cache key (`elevenlabs-shared-voices-v3-admin-candidates`) with up to 50 candidates per `RU|EN|OTHER` bucket and gender, using a 50/50 mix of `featured` rows and locally popularity-ranked candidates (`cloned_by_count + liked_by_count`).
- Admin curation decisions are stored in the same cache table under `elevenlabs-shared-voice-curation-v1` (`approved`, `hidden`, `rank`, `previewOk`). Regular users see only the admin-approved public projection capped to 24 per bucket/gender; admin users receive the expanded candidate set plus public preview and can still pick any candidate for their own assistant.
- `VoicePicker` was simplified to the intended premium surface and now has an explicit selected check marker. ElevenLabs selected `voiceId` is no longer silently cleared by the assistant-gender/filter reconciliation before save/publish.
- Provider fallback hotfix included before deploy: Yandex SpeechKit v3 now accepts multi-JSON/NDJSON audio chunk responses and concatenates audio chunks; OpenAI TTS ignores non-OpenAI speech model keys (for example an ElevenLabs `modelKey`) and falls back to `gpt-4o-mini-tts`.
- Verification this pass: API/web/provider-gateway eslint, API/web/provider-gateway typecheck, provider-gateway full test suite, ElevenLabs catalog unit test (including curation projection), and focused web voice picker/settings tests passed.

## 2026-06-08 - ADR-113 post-audit code-cleanliness cleanup

Ran an independent read-only auditor over the TTS 2.0 code (Slices 1/2/3a). No blockers; the `as never` Prisma cast, derived legacy tone tag, migration/schema, and custom-harness `console.log("PASS")` markers are all established conventions. Acted on the real findings:

- Removed the dead ElevenLabs `shortlist` machinery (`buildShortlist`/`balanceGender` + the `shortlist`/`fetchedAt` result fields) — it was built and plumbed end-to-end (`ElevenLabsVoiceCatalogService` → `ResolveAssistantVoiceSettingsService` → web `AssistantVoiceSettingsState`) but no consumer ever read it. The picker uses the full `voices` list with client-side filtering. Internal cache `fetchedAt` (TTL) is unchanged.
- Removed the now-orphaned `findVoiceOption` export from `assistant-voice-options.ts` (its last consumer was deleted in Slice 3a).
- Fixed a quiet UX regression: the picker now renders the enriched `formatElevenLabsVoiceLabel(...)` label (was being computed then discarded) instead of the raw voice name.
- Simplified the redundant `isV3Model` condition in the ElevenLabs client.

Re-verified: api/web/provider-gateway typecheck, api/web lint, ElevenLabs catalog test (5) + web voice-options test (9), format:check, `git diff --check` — all clean. Docs (ADR-113, API-BOUNDARY, CHANGELOG, TEST-PLAN) corrected to drop the `shortlist`/`fetchedAt` contract claims.

## 2026-06-08 - ADR-113 Slice 3a premium voice picker UI

### Baseline

- Continued in the same working tree as ADR-113 Slices 1-2 (starting SHA `e124c8575e52515f7e989bab557e46ff9af4abe0`); the tree was already non-single-author clean. This slice added only the voice-picker UI scope on top, web-only (no backend changes).
- Scope: ADR-113 Slice 3a only — premium voice picker UI in assistant settings, unified across all three TTS providers. Out of scope: `eleven_v3` test-phrase synthesis (Slice 3b, needs a metered backend endpoint), and the setup wizard voice step (kept on its existing simple selects).

### What changed & why

- New shared component `apps/web/app/app/_components/voice-picker.tsx`: card-based picker with search, gender/language/category filter chips (auto-shown only when they discriminate), selectable cards, and ElevenLabs stock-preview playback (single shared `Audio` element, cleaned up on unmount).
- New pure helper `filterVoicePickerEntries` + `VoicePickerEntry`/`VoicePickerFilter` types in `assistant-voice-options.ts`, with unit tests.
- `assistant-settings.tsx`: replaced the three `<select>` voice dropdowns with the shared `VoicePicker`. ElevenLabs entries come from the cached catalog (`voiceSettings.elevenlabs.voices`, enriched with language/category/preview), Yandex/OpenAI from their fixed enums. Removed the now-dead `elevenLabsSelectOptions`/`selectedElevenLabsVoiceOption`/`selectedElevenLabsVoiceAllowed` and the unused `findVoiceOption` import. Existing assistant-gender constraint effect and save path are unchanged.
- Web API client `AssistantVoiceSettingsState` extended (additive) with per-entry `language`/`languageBucket`; added exported `AssistantVoiceCatalogEntry`. (The `shortlist`/`fetchedAt` fields drafted here were removed in the post-audit cleanup above.)
- Added en/ru i18n keys `voicePicker*`.

### Files touched

- `apps/web/app/app/_components/voice-picker.tsx` (new)
- `apps/web/app/app/_components/assistant-voice-options.ts`, `apps/web/app/app/_components/assistant-voice-options.test.ts`
- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/messages/en.json`, `apps/web/messages/ru.json`
- docs: `docs/ADR/113-tts-2.0-expressive-chat-voice.md`, `docs/CHANGELOG.md`, `docs/TEST-PLAN.md`, this handoff

### Verification

- `corepack pnpm --filter @persai/web run typecheck` — clean.
- `corepack pnpm --filter @persai/web run lint` — clean.
- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-voice-options.test.ts` — 9 pass (incl. new picker-filter cases).
- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx app/app/setup/page.test.tsx` — 82 pass (no regressions).
- `corepack pnpm run format:check` clean; `git diff --check` no whitespace errors.

### Risks / residuals

- No preview audio for Yandex/OpenAI yet (their enums have no stock preview); preview/test-phrase for those + ElevenLabs expressive test-phrase is Slice 3b.
- Setup wizard voice step still uses the old simple selects; can adopt the shared `VoicePicker` later.
- Tree still not single-author clean: ADR-113 Slices 1/2/3a plus a concurrent ADR-111-closure scope coexist uncommitted — review/commit scopes separately.

### Next recommended step

ADR-113 is **complete** — Slice 3b (`eleven_v3` test-phrase synthesis) was **dropped** as unnecessary complexity (a paid preview-synthesis endpoint with billing/quota/anti-abuse is not justified for voice selection; the Slice 3a stock card preview plus the assistant's real in-chat voice notes already cover intonation verification). No further TTS 2.0 slices are planned. Recommended next action is repo hygiene: review/commit the four coexisting uncommitted scopes (ADR-113 Slices 1/2/3a + the concurrent ADR-111 closure) as separate clean commits and apply the Slice 2 migration before promoting the API image.

## 2026-06-08 - ADR-113 Slice 2 ElevenLabs voice catalog v2 backend/cache

### Baseline

- Continued in the same working tree as ADR-113 Slice 1 (starting SHA `e124c8575e52515f7e989bab557e46ff9af4abe0`); the tree was already non-single-author clean (Slice 1 TTS + a concurrent ADR-111-closure scope). This slice added only ElevenLabs-catalog-scoped content and code on top.
- Scope: ADR-113 Slice 2 only — platform-wide ElevenLabs voice catalog cache + normalized metadata + shortlist + honest load state, wired into `GET assistant/voice/settings`. Out of scope: premium voice picker UI (Slice 3), any web changes.

### What changed & why

- Added `platform_elevenlabs_voice_catalog_cache` Prisma model + additive migration `20260608000000_adr113_slice2_elevenlabs_voice_catalog_cache` (mirrors the HeyGen voice catalog cache table).
- Added `ElevenLabsVoiceCatalogService` (`apps/api/src/modules/workspace-management/application/elevenlabs/`): DB-backed read-through cache (24h TTL, lazy refresh, upsert on success, stale-on-failure fallback), normalized entries (`gender`, `category`, `language` + `languageBucket` ru/en/other, `previewUrl`), and honest `ready`/`not_configured`/`unavailable` load state. (A shortlist builder was added here then removed in the post-audit cleanup above as unconsumed.)
- Rewired `ResolveAssistantVoiceSettingsService` to read the cache instead of a live per-request ElevenLabs fetch; `AssistantVoiceSettingsState` additively gains per-entry `language` + `languageBucket`. Registered the new service in `workspace-management.module.ts` and regenerated the Prisma client.

### Files touched

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260608000000_adr113_slice2_elevenlabs_voice_catalog_cache/migration.sql`
- `apps/api/src/modules/workspace-management/application/elevenlabs/elevenlabs-voice-catalog.service.ts` (new)
- `apps/api/src/modules/workspace-management/application/resolve-assistant-voice-settings.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/elevenlabs-voice-catalog.service.test.ts` (new)
- docs: `docs/ADR/113-tts-2.0-expressive-chat-voice.md`, `docs/DATA-MODEL.md`, `docs/API-BOUNDARY.md`, `docs/CHANGELOG.md`, `docs/TEST-PLAN.md`, this handoff

### Verification

- `corepack pnpm --filter @persai/api exec tsx test/elevenlabs-voice-catalog.service.test.ts` — all 5 cases pass (fresh fetch, fresh-cache no-network, not_configured no-network, HTTP error → unavailable, stale-on-failure).
- `corepack pnpm --filter @persai/api run typecheck`, `corepack pnpm --filter @persai/api run lint`, `corepack pnpm --filter @persai/web run typecheck`, `corepack pnpm run format:check` — all clean.
- `git diff --check` — no whitespace errors.

### Risks / residuals

- New additive migration (`CREATE TABLE` only) must be applied before the API image that reads `platformElevenlabsVoiceCatalogCache` is promoted; it stacks on the already-pending memory-block migrations in this tree.
- Tree is still not single-author clean: ADR-113 Slice 1, ADR-113 Slice 2, and a concurrent ADR-111-closure scope coexist uncommitted — review/commit the three scopes separately.

### Next recommended step

ADR-113 Slice 3 — premium voice picker UI, consuming the new `shortlist`/`voices`/`fetchedAt` contract. (Update: Slice 3a — the picker UI — landed later the same day; see the newer handoff section above. Remaining: Slice 3b `eleven_v3` test-phrase synthesis.)

## 2026-06-08 - ADR-113 Slice 1 TTS 2.0 expressive delivery core

### Baseline

- Starting SHA: `e124c8575e52515f7e989bab557e46ff9af4abe0` (clean tree when this session began).
- Scope: ADR-113 Slice 1 only — structured expressive TTS intent + safe `eleven_v3` tag compiler on the existing chat `tts` worker path. Out of scope: voice catalog v2 backend/cache (Slice 2), premium voice picker UI (Slice 3), HeyGen, Sound Effects, audio mixing.
- NOTE: a concurrent session edited `docs/ADR/111-*`, `docs/CHANGELOG.md`, and `docs/SESSION-HANDOFF.md` (ADR-111 closure) in this same working tree during this session. Those edits were left intact; this slice only added TTS-scoped content and code. The tree is therefore not single-author clean — review/commit TTS and ADR-111-closure scopes separately.

### What changed & why

Chat voice replies were flat: the `tts` tool exposed a single `toneTag` enum and ElevenLabs ran on `eleven_multilingual_v2`, with no safe way to drive expressive `eleven_v3` audio tags. TTS 2.0 makes delivery structured and controllable.

`@persai/runtime-contract` gained the TTS 2.0 structured intent (`RuntimeTtsDeliveryIntent` with `delivery|emotion|pace|intensity|pause|nonVerbal`), a default builder, and `mapTtsDeliveryIntentToToneTag` (deterministic legacy-tone derivation). `RuntimeTtsRequest`/`RuntimeTtsToolResult` carry the structured intent; `ProviderGatewaySpeechGenerateRequest` carries optional `delivery`.

The runtime `tts` tool now parses the structured fields (rejecting the old `toneTag` argument as unknown), derives the legacy `toneTag` for Yandex/OpenAI baselines, and forwards the structured intent. The model-facing tool descriptor exposes the six structured enums and instructs the model not to embed raw audio tags.

A new pure compiler (`apps/provider-gateway/src/modules/providers/elevenlabs/elevenlabs-v3-tag-compiler.ts`) converts intent into a conservative set of `eleven_v3` tags with conflict avoidance (whisper suppresses `[excited]`/`[dramatic]` and high-intensity escalation), a hard `MAX_ELEVEN_V3_TAGS = 3` budget by fixed priority (delivery > emotion > nonVerbal > pause), and model-authored-tag stripping from `text`. The ElevenLabs client defaults to `model_id: "eleven_v3"` (catalog `modelKey` overrides per ADR-110), prepends compiled tags, and sends minimal discrete-stability v3 voice settings; non-v3 ElevenLabs models keep the legacy full `voice_settings` + `language_code` path. The provider speech service normalizes/forwards `delivery`. The saved ElevenLabs `voiceId` and media/job delivery are unchanged.

### Files touched

- `packages/runtime-contract/src/index.ts`
- `apps/provider-gateway/src/modules/providers/elevenlabs/elevenlabs-v3-tag-compiler.ts` (new)
- `apps/provider-gateway/src/modules/providers/elevenlabs/elevenlabs-provider.client.ts`
- `apps/provider-gateway/src/modules/providers/provider-speech-generation.service.ts`
- `apps/runtime/src/modules/turns/runtime-tts-tool.service.ts`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- tests: `apps/provider-gateway/test/elevenlabs-v3-tag-compiler.test.ts` (new), `apps/provider-gateway/test/elevenlabs-provider.client.test.ts` (new), `apps/provider-gateway/test/provider-speech-generation.service.test.ts`, `apps/provider-gateway/test/run-suite.ts`, `apps/runtime/test/runtime-tts-tool.service.test.ts`
- docs: `docs/ADR/113-tts-2.0-expressive-chat-voice.md` (new), `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/provider-gateway run typecheck` - PASS
- `corepack pnpm --filter @persai/runtime run typecheck` - PASS
- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `corepack pnpm -r --if-present run lint` - PASS
- `corepack pnpm run format:check` - PASS
- `corepack pnpm --filter @persai/provider-gateway exec tsx test/run-suite.ts` - PASS (full suite incl. new compiler + ElevenLabs client + speech-service delivery passthrough)
- `corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/runtime-tts-tool.service.test.ts runRuntimeTtsToolServiceTest` - PASS
- `corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/native-tool-projection.test.ts runNativeToolProjectionTest` - PASS
- `git diff --check` - PASS

### Risks / residuals

- ElevenLabs chat TTS now defaults to `eleven_v3` (intentional replacement of the `eleven_multilingual_v2` default). If the ElevenLabs account/key lacks `eleven_v3` access, the provider returns an honest error and the runtime fallback chain (`yandex`/`openai`) still applies; an explicit catalog `modelKey` can pin a different ElevenLabs model. Live `persai-dev` smoke of a real `eleven_v3` generation was not run this session.
- `eleven_v3` voice-settings shape was kept deliberately minimal (discrete stability + speaker boost, no style/speed, no `language_code`) to avoid sending knobs the model may reject; confirm against a live v3 call.
- Concurrent ADR-111-closure doc edits are present in the same tree (see baseline note). Commit TTS and ADR-111 scopes separately; do not fold them.
- Voice catalog v2 backend/cache (Slice 2) and the premium picker UI with preview/test-phrase (Slice 3) are designed in ADR-113 but not implemented. (Update: Slice 2 landed later the same day — see the newer handoff section above.)

### Next recommended step

ADR-113 Slice 2 — voice catalog v2 backend/cache: cache service with normalized metadata, load/error state, preview URL, and a setup/settings shortlist (then Slice 3 premium picker UI). Start from a clean tree once the TTS and ADR-111 scopes are committed.

## 2026-06-08 - ADR-111 HeyGen program closure

### Baseline

- Starting SHA: `1aabfd76` (clean tree after GitOps fast-forward).
- Scope: docs-only closure of `docs/ADR/111-heygen-voice-cloning-and-characters-ux-v2.md`. Out of scope: ADR-112 implementation, TTS v2 implementation, HeyGen Studio API, custom audio lip-sync, and additional code changes.

### What changed & why

ADR-111 is now explicitly closed as completed. The ADR status, Slice 5 ledger, acceptance checklist, and closure notes now reflect the actual post-smoke state: HeyGen cloned voice creation succeeded after the Clerk route auth and audio MIME fixes, cloned voices are usable from the saved character surface, and the later provider-gateway `503` event was transient rollout noise rather than an ADR defect.

### Files touched

- `docs/ADR/111-heygen-voice-cloning-and-characters-ux-v2.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- Docs-only verification pending in this session: `corepack pnpm run format:check`, `git diff --check`.

### Risks / residuals

- ADR-111 remains closed. Do not reopen it for TTS/chat voice, HeyGen Studio API, sound effects, background music/noise, or custom audio lip-sync. Those require separate ADR/slices.

### Next recommended step

Continue the active ADR-112 memory/tool-surface program when requested, or open a new TTS 2.0 ADR for chat voice output if the operator chooses that next.

## 2026-06-07 - ADR-112 Slice 4 safe memory backfill

### Baseline

- Starting SHA: `f04a41f3` (ADR-112 Slice 3 landed; clean tree).
- Scope: ADR-112 Slice 4 only — assistant-scoped dry-run/apply backfill for legacy durable-memory pollution. Out of scope: web UI, multi-assistant scans, new schema/migrations, runtime/provider changes, contract regeneration.

### What changed & why

The API now exposes the established dangerous-admin two-phase pattern for safe memory backfill. `POST /api/v1/admin/memory-backfill/preview` is read-authorized and returns a bounded dry-run report for one assistant. `POST /api/v1/admin/memory-backfill/apply` requires a step-up token from `x-persai-step-up-token`, re-computes candidates from fresh active rows, applies soft cleanup, and appends one admin audit event.

The cleanup rules are intentionally narrow and match the ADR backlog exactly. Target A ("legacy episodic core") selects active rows where `memoryClass = "core"` and NOT (`durability = "identity"` AND `stability = "stable"`), then reclassifies them to `contextual`. Target B ("trivial web_chat") selects active `sourceType = "web_chat"` rows whose stored summary matches `isObviouslyNonDurableMemorySummary(summary)`, then soft-prunes them with `markForgottenById` (never hard delete). If a row matches both targets, prune wins and it is not reclassified.

Repository support was added in place rather than via a parallel path: `listActiveForBackfill(assistantId, limit)` and guarded `reclassifyMemoryClassById(id, assistantId, memoryClass)`. Step-up/action truth now includes `admin.memory_backfill.apply` with the same strict role gate as the other ops/super-admin dangerous settings actions, and the admin step-up challenge allowlist/OpenAPI were widened minimally so the challenge can be issued for this slice.

### Files touched

- `apps/api/src/modules/workspace-management/application/manage-admin-memory-backfill.service.ts` (new)
- `apps/api/src/modules/workspace-management/interface/http/admin-memory-maintenance.controller.ts` (new)
- `apps/api/src/modules/workspace-management/domain/assistant-memory-registry.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-memory-registry.repository.ts`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-security.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/manage-admin-memory-backfill.service.test.ts` (new)
- `packages/contracts/openapi.yaml`
- `docs/API-BOUNDARY.md`
- `docs/ADR/112-context-memory-and-tool-surface-quality-program.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `corepack pnpm -r --if-present run lint` - PASS
- `corepack pnpm run format:check` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-memory-backfill.service.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-knowledge-retrieval-policy.service.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/consolidate-assistant-memory.service.test.ts` - PASS

### Risks / residuals

- This slice is intentionally bounded to the first `1000` active rows for one assistant (`MAX_BACKFILL_SCAN`). If an assistant somehow exceeds that active-memory volume, the preview/apply reports are safe but partial by design.
- OpenAPI (`packages/contracts/openapi.yaml`) was hand-edited for the two new endpoints + the new dangerous-action enum; `packages/contracts/src/generated/*` (the orval TS client) was intentionally NOT regenerated. Reason verified this session: running `orval generate` rewrites ~625 generated files (~7.6k lines) of pure cosmetic churn because the committed client predates the current orval/prettier output style. There is no consumer of these admin endpoints (backend-only, no web UI) and no CI drift gate, so the spec carries boundary truth and the typed client should be regenerated only on-demand when a consumer is added (and that regen should be its own isolated commit).
- Orchestrator note: audited and committed by the parent agent as part of the held memory block (Slices 1-4 land locally; unified push only after the operator's full check complex).

### Next recommended step

Run the full required verification complex for ADR-112 Slices 1-4 as a block, then review a real assistant preview/apply flow before any deploy/push decision.

## 2026-06-07 - ADR-112 Slice 3 memory normalization + consolidation + lifecycle

### Baseline

- Starting SHA: `1b9440d9` (ADR-112 Slice 2 landed; clean tree).
- Scope: ADR-112 Slice 3 only — durable-memory supersession lifecycle + an off-band consolidation pass (embedding near-duplicate merge + decay prune). Out of scope: backfill of existing rows (Slice 4), tool/developer-block work (Slices 5/6+).
- Landed as two tightly-coupled sub-slices: 3a substrate (`56613bff`), 3b engine (`8433dd6d`).

### What changed & why

3a (lifecycle substrate): `assistant_memory_registry_items` gained nullable `supersededAt` / `supersededByMemoryId`, the repository gained `markSupersededById` (audit-preserving, mirrors the forgotten/resolved guards), and EVERY active read/hydration/search path now also filters `supersededAt: null` (alongside `forgottenAt: null`) — including `searchMemory`. This is the mechanism by which a superseded fact stops resurfacing while its row is retained for audit. No consolidation logic yet.

3b (consolidation engine): durable memories can now carry an embedding (`embedding_vector` JSONB + `embedding_model_key` + `embedding_generated_at`; model key resolved via the existing `KnowledgeModelPolicyService` knowledge path). New `ConsolidateAssistantMemoryService` runs best-effort after each successful background compaction job (hooked into `PersaiBackgroundCompactionSchedulerService` after `completeJob`, inside the existing lease — never throws into / fails / delays the compaction job). Per pass it: loads up to 200 most-recent active memories; lazily embeds rows lacking a current-model embedding; merges near-duplicates within the same `kind` (cosine >= 0.92 -> supersede the loser via `markSupersededById`, survivor priority core > confidence > recency > id); and decay-prunes (`markForgottenById`) `contextual` + `time_bound` rows whose `lastUsedAt ?? createdAt` is older than 45 days. Unresolved open loops are never merged or pruned; identity/stable/core rows are never decay-pruned. If no embedding model/credentials are available it skips merge but still runs decay (graceful). Reuses the existing scheduler/lease/cadence — no new job table or scheduler. Mechanical cosine merge, not a positive classifier (model-as-judge preserved).

### Files touched

- `apps/api/prisma/schema.prisma` (+ migrations `20260607230000_adr112_slice3a_memory_supersession`, `20260607231500_adr112_slice3b_memory_embeddings`)
- `apps/api/src/modules/workspace-management/domain/assistant-memory-registry-item.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-memory-registry.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-memory-registry.repository.ts`
- `apps/api/src/modules/workspace-management/application/read-assistant-knowledge.service.ts` (searchMemory superseded exclusion)
- `apps/api/src/modules/workspace-management/application/consolidate-assistant-memory.service.ts` (new)
- `apps/api/src/modules/workspace-management/application/persai-background-compaction-scheduler.service.ts` (post-success hook)
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- tests: `consolidate-assistant-memory.service.test.ts` (new), `persai-background-compaction-scheduler.service.test.ts`, and memory fixtures across `write-assistant-memory` / `hydrate-memory-for-turn` / `read-assistant-knowledge` / close/carry-over/web-chat suites
- docs: `docs/ADR/112-...md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `corepack pnpm run format:check` - PASS
- `corepack pnpm -r --if-present run lint` - PASS (api, runtime, provider-gateway)
- focused (via tsx): `consolidate-assistant-memory.service.test.ts`, `persai-background-compaction-scheduler.service.test.ts`, `write-assistant-memory.service.test.ts`, `hydrate-memory-for-turn.service.test.ts`, `read-assistant-knowledge.service.test.ts` - PASS

### Risks / residuals

- HELD from push by operator direction: the whole memory block (Slices 1-4) is being landed locally and will be deployed together after a dedicated "complex of checks" — do NOT push memory commits piecemeal. Slices 1, 2, 3a, 3b are committed locally only.
- Two additive Prisma migrations are pending DB apply; both are nullable ADD COLUMN only (safe/backward-compatible) but must be applied before the consolidation pass writes embeddings/supersession in PROD.
- Consolidation runs on every successful compaction (bounded O(n^2) cosine + lazy embedding of new rows); cheap now, revisit if working sets grow. Could add a per-assistant cadence gate later.
- Embedding-based merge depends on the admin knowledge embedding model key being configured; without it, only decay runs (acceptable, logged).

### Next recommended step

ADR-112 Slice 4 — safe memory backfill: dry-run report of legacy episodic `core` rows + trivial `web_chat` rows, then step-up confirmed reclassify/prune. After Slice 4, run the full check complex and deploy the memory block together (push on explicit operator go).

## 2026-06-07 - ADR-112 Slice 2 retrieval/render quality + single runtime-owned framing

### Baseline

- Starting SHA: `6f44f754` (ADR-112 Slice 1 landed; clean tree).
- Scope: ADR-112 Slice 2 only — durable-memory retrieval quality (drop trivial/legacy greeting hits, semantic dedup vs core), single runtime-owned contextual framing (one grouped volatile block), and an ADR-110 prompt-cache regression guard. Out of scope: embeddings/consolidation (Slice 3), backfill (Slice 4), tool/developer-block work (Slices 5/6).

### What changed & why

API-side runtime hydration (`hydrate-memory-for-turn.service.ts`) now drops contextual hits whose summary is obviously non-durable (reusing Slice 1's `isObviouslyNonDurableMemorySummary`) — this is the negative guardrail that removes legacy greeting/ack rows which still pass `searchMemory`'s lexical exact-token relevance floor (a high-score `"hello"` match is dropped in test). It also de-duplicates contextual vs core by `normalizeMemoryText` instead of only by id, so the same fact never renders in both blocks. Surviving contextual hits keep the search relevance order. No positive classifier was added (model-as-judge preserved).

Runtime render now emits the per-turn contextual memory as ONE volatile block under the existing header, deterministically grouped by kind (`Preferences -> Facts -> Open loops -> Other`) via `formatDurableMemoryContextualBlock(groups)`; the block still carries `cacheRole: "volatile_context"` and stays last in the prefix, so the provider keeps re-projecting it into the uncached tail. The core block, carry-over block, synopsis block, headers, versions, and stable-prefix order are untouched.

ADR-110 invariant is now locked by tests: a provider-gateway guard asserts the `volatile_context` block is re-projected as a non-cacheable `user` block before the current question and never carries `cache_control` (`[1,0,0]` cache_control distribution); the stable-blocks test asserts the core stable token is invariant under contextual rotation.

### Files touched

- `apps/api/src/modules/workspace-management/application/hydrate-memory-for-turn.service.ts`
- `apps/api/test/hydrate-memory-for-turn.service.test.ts`
- `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts`
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts`
- `apps/runtime/test/prompt-cache-stable-blocks.test.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- docs: `docs/ADR/112-...md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `corepack pnpm run format:check` - PASS
- `corepack pnpm -r --if-present run lint` - PASS
- focused (via tsx): `hydrate-memory-for-turn.service.test.ts`, `prompt-cache-stable-blocks.test.ts`, `turn-execution.service.test.ts`, `anthropic-provider.client.test.ts` - PASS

### Risks / residuals

- Local commit only; NOT pushed (per repo rule; awaiting explicit operator go-ahead to push/deploy).
- Legacy greeting/ack rows are now suppressed at retrieval but still exist in the DB; their permanent cleanup is ADR-112 Slice 4 (backfill).
- Grouping char/item budget is an approximation (heading length counted into the group budget); acceptable for the soft per-turn memory cap.

### Next recommended step

ADR-112 Slice 3 — memory normalization + consolidation + lifecycle (A Layers 2-4): embedding-based dedup/merge, periodic background reflection extending auto-extract, supersession/decay. Start from a clean tree at the Slice 2 commit.

## 2026-06-07 - ADR-112 Slice 1 memory capture schema + semantic routing

### Baseline

- Starting SHA: `ac4a321d5461973ccdea1d376b980e5e469448f2` (clean tree).
- Scope: ADR-112 Slice 1 only — model-emitted durability/stability on the durable-memory write path, semantic core/contextual/skip routing, auto-extract parity, trivial web-chat suppression, and tighter `memory_write` guidance/tests.

### What changed & why

`memory_write` is no longer classified by syntactic `kind`. The runtime/API write path now requires model-emitted `durability` (`identity | episodic`) and `stability` (`stable | time_bound`) plus optional `confidence`, persists those fields on `assistant_memory_registry_items`, and routes deterministically: only `identity + stable` lands in always-on `core`; other durable writes land in `contextual`; negative guardrails (empty/too-short/obvious trivial) soft-skip with `code=not_durable` instead of throwing. Existing rows stay nullable/unreclassified in this slice.

Auto-extract now emits the same semantic fields and forwards them through the same write API/router, keeping compaction memory writes aligned with the interactive tool path. Web-chat capture now uses a small pure guardrail to suppress clearly trivial greeting/acknowledgement turns (including RU/EN cases like `Привет · Привет`) while still storing substantive turns as contextual `web_chat` rows. Runtime tool projection/guidance was tightened so the model writes fewer marginal memories and sets durability/stability honestly.

Orchestrator audit caught one blocking defect before acceptance: the auto-extract structured-output schema added `confidence` to `properties` but not to `required` under `strict: true` / `additionalProperties: false`, which OpenAI Structured Outputs rejects (every property must be required). It was fixed by making `confidence` `type: ["number","null"]` and listing it in `required`, matching the repo convention used by the other strict background schemas; the parser already tolerated a JSON `null`. `memory_write` tool inputSchema is unaffected because function tools use `strict: false`.

### Files touched

- `packages/runtime-contract/src/index.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260607214000_adr112_slice1_memory_semantic_routing/migration.sql`
- `apps/api/src/modules/workspace-management/domain/memory-class-policy.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-memory-registry-item.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-memory-registry.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-memory-registry.repository.ts`
- `apps/api/src/modules/workspace-management/application/memory-summary.util.ts`
- `apps/api/src/modules/workspace-management/application/record-web-chat-memory-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/write-assistant-memory.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-assistant-workspace-memory.service.ts`
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`
- `apps/runtime/src/modules/turns/runtime-memory-write-tool.service.ts`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/runtime/src/modules/turns/auto-extract-to-memory.service.ts`
- `apps/api/test/write-assistant-memory.service.test.ts`
- `apps/api/test/hydrate-memory-for-turn.service.test.ts`
- `apps/api/test/record-web-chat-memory-turn.service.test.ts` (new)
- `apps/api/test/close-assistant-memory-by-ref.service.test.ts`
- `apps/api/test/find-cross-session-carry-over.service.test.ts`
- `apps/api/test/close-most-similar-open-loop.service.test.ts`
- `apps/runtime/test/runtime-memory-write-tool.service.test.ts`
- `apps/runtime/test/auto-extract-to-memory.service.test.ts`
- `apps/runtime/test/turn-execution.service.test.ts`
- `docs/ADR/112-context-memory-and-tool-surface-quality-program.md`
- `docs/CHANGELOG.md`
- `docs/DATA-MODEL.md`
- `docs/SESSION-HANDOFF.md`

### Verification

Focused (subagent + orchestrator reruns):

- `corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/write-assistant-memory.service.test.ts` - PASS (covers identity+stable -> core, episodic -> contextual, identity+time_bound -> contextual, trivial -> `not_durable` skip, core-cap demotion)
- `corepack pnpm --filter @persai/api exec tsx test/hydrate-memory-for-turn.service.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/record-web-chat-memory-turn.service.test.ts` - PASS (RU/EN greeting/ack suppressed; substantive turn stored)
- `corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/runtime-memory-write-tool.service.test.ts runRuntimeMemoryWriteToolServiceTest` - PASS
- `corepack pnpm --filter @persai/runtime exec tsx test/auto-extract-to-memory.service.test.ts` - PASS (expected warning log in the provider-error branch test)

Full AGENTS.md gate (orchestrator):

- `corepack pnpm -r --if-present run lint` - PASS
- `corepack pnpm run format:check` - PASS
- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `corepack pnpm --filter @persai/runtime run typecheck` - PASS
- Contract regen note: `@persai/runtime-contract` has no `build` script and the changed memory route is internal (not in `packages/contracts/openapi.yaml`), so no OpenAPI regeneration was required; downstream api/runtime typecheck is the effective contract check.

### Risks / residuals

- This slice stores nullable `durability`, `stability`, and `confidence` only for new writes. Existing legacy rows remain NULL and are intentionally not reclassified/backfilled here; Slice 4 owns live-data cleanup.
- The workspace-memory manual add path was widened just enough to keep repository callers compiling, but no broader workspace-memory UX/classification redesign was attempted in this slice.
- The requested `runtime-contract` build command is currently a no-op because the package has no `build` script; the effective verification for that package here is downstream runtime/API typecheck plus focused tests.

### Next recommended step

Proceed to ADR-112 Slice 2 only: retrieval/render quality plus the single runtime-owned contextual-memory framing, while preserving ADR-110 prompt-cache placement.

Carry-in for Slice 2 (prompt-cache invariant) — RESOLVED + live-verified 2026-06-07. The operator's worry (small `cache_creation` of 27-375 tokens on every turn) was investigated directly against the cluster: per-turn `runtime_turn_receipts.result_payload.usageAccounting` for session `78ae7b44` (28 turns, `claude-sonnet-4-6`), querying both top-level cacheCreation/cachedInput and the `entries[]` anthropic step. Result splits exactly at the ~18:25 UTC deploy of the typed-`cacheRole` contextual-memory fix (the `volatile_context` marker is present in the running provider-gateway `dist`, so the fix is live):

- PRE-FIX (10:38-16:17): `cacheRead` PINNED at the 14.1k system block while a 3k->10.5k history segment was RE-WRITTEN at 1.25x every short turn (never read back) — a real ~2x cost inflation. This was the volatile contextual-memory block poisoning the cacheable prefix; it is the bug the typed-`cacheRole` fix targeted.
- POST-FIX (18:47-19:11, same loaded chat): `cacheRead` grows monotonically (`31774 -> ... -> 34203`) with `cacheRead[n+1] ≈ cacheRead[n] + cacheCreation[n]` and writes shrink to the genuine new tail (`18, 27, 0, 375, 185, ...`). This is exactly the post-deploy verification line 204/209 below asked for — CONFIRMED working. The 27-375 per-turn write is HEALTHY incremental caching, not waste: it caches this turn's new content so the next turn reads it at 0.1x ("accumulate 3k then cache once" would be strictly worse). The only large writes left are after >5min idle (Anthropic 5m TTL expiry; `cacheRead=0, cacheCreation≈24.6k`), which is expected.
  Remaining Slice 2 cache work is narrow: keep ADR-110 green and add a regression guard asserting `cacheRole: "volatile_context"` stays out of the Anthropic cacheable prefix. Earlier ADR/handoff wording (both the "expected incremental frontier advance" and the later "source unknown / inconsistent" framings) is superseded by this live verification.

## 2026-06-07 - ADR-112 authored (context/memory/tool-surface quality program)

### Baseline

- Starting SHA: `b4fbe24c` (working tree concurrently dirty with ADR-111 UI/video work and the ADR-110 contextual-memory cache fix; ADR-112 authoring is doc-only).
- Scope: deep read-only analysis + new program ADR. No production code in this session.

### What changed & why

Authored `docs/ADR/112-context-memory-and-tool-surface-quality-program.md`. Five read-only GPT-5.4 audits mapped the truth/defects for durable memory, prompt/developer assembly, file aliases, background jobs/turns, and tool descriptors. The ADR encodes seven workstreams (A-G) and a 9-slice subagent-coded backlog, with the explicit orchestration rule (parent orchestrates/audits, GPT-5.4 subagents implement) and the memory methodology (model-as-judge + embedding dedup + periodic consolidation + lifecycle; heuristics only as a guardrail). Registered in `docs/CHANGELOG.md`.

### Files touched

- `docs/ADR/112-context-memory-and-tool-surface-quality-program.md` (new)
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- Doc-only session; no code/tests run. Verification gate applies per implementation slice, not to this authoring step.

### Risks / residuals

- Live-data memory backfill (Slice 4) and the alias-scheme migration (Slice 5) are the highest-risk slices; both require careful single-slice execution and (for backfill) operator step-up.
- Prompt-cache stability (ADR-110) must not regress in Slices 2/6.

### Next recommended step

Begin ADR-112 Slice 1 (memory capture schema + classification + web-chat gate) as a bounded GPT-5.4 subagent task on a clean baseline, after the concurrent ADR-110/ADR-111 working-tree changes are committed.

## 2026-06-07 - ADR-111 post-smoke UX/video cleanup

### Baseline

- Starting SHA: `fc42a8626dfee36c0aec4505c76817c244a28155`
- Scope: post-live-smoke cleanup for mobile video preview/player polish, demo voice selection, talking-avatar aspect ratio, and cloned-voice UI noise.
- Note: this work is stacked in a dirty tree that already contained provider prompt-cache changes in `apps/provider-gateway/*` plus existing docs edits. Those provider changes are intentionally not part of this UI/video cleanup.

### What changed & why

Inline chat video previews now keep the Android-safe deterministic placeholder approach but size the visible card from video metadata once available, so mobile previews no longer stay forced into a generic `16:9` box. The visible card uses filename/duration/play affordances instead of a blurred frame dependency.

The video lightbox no longer swallows clicks on the playing `<video>`, so after chrome auto-hides the user can tap the actual video surface to restore controls without closing the lightbox.

Characters cleanup: the locked demo character now prefers a female localized voice when the catalog contains one; cloned-voice cards use concise linked-persona copy and clearer default-action wording; the clone modal top copy is collapsed into one quiet guidance block.

Talking-avatar runtime generation now treats explicit `talkingAvatarAspectRatio` as authoritative. When no explicit request exists, it avoids letting a generic landscape `16:9` catalog default silently decide HeyGen talking-avatar renders and defers that case to provider `auto` / talking-avatar source policy instead.

### Files touched

- `apps/web/app/app/_components/chat-message.tsx`
- `apps/web/app/app/_components/chat-message.test.tsx`
- `apps/web/app/app/_components/image-lightbox.tsx`
- `apps/web/app/app/_components/image-lightbox.test.tsx`
- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/_components/assistant-settings.test.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ru.json`
- `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts`
- `apps/runtime/test/runtime-video-generate-tool.service.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/web run test -- app/app/_components/image-lightbox.test.tsx app/app/_components/chat-message.test.tsx app/app/_components/assistant-settings.test.tsx` - PASS (`66` files / `701` tests due existing web test script behavior)
- `corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/runtime-video-generate-tool.service.test.ts runRuntimeVideoGenerateToolServiceTest` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `corepack pnpm --filter @persai/runtime run typecheck` - PASS
- `corepack pnpm run format:check` - PASS
- `corepack pnpm -r --if-present run lint` - PASS
- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `git diff --check` - PASS

### Risks / residuals

- Chat preview still intentionally avoids rendering the decoded first frame on Android/Capacitor; when metadata never arrives, the card uses a portrait-safe deterministic fallback rather than a true thumbnail.
- Exact source portrait dimensions are not yet materialized into the runtime talking-avatar path; the no-explicit-aspect fallback now defers generic landscape defaults to provider `auto` rather than inventing a runtime-side portrait ratio.
- Existing dirty provider prompt-cache files (`apps/provider-gateway/src/modules/providers/{anthropic,openai}/...` and tests) remain separate from this cleanup and should be reviewed/committed as their own hotfix scope.

### Next recommended step

Run a mobile/Capacitor smoke for inline preview geometry, lightbox tap-to-controls recovery, and one talking-avatar render using a portrait persona. If accepted, commit this cleanup separately from the provider prompt-cache hotfix unless the operator explicitly wants one combined commit.

## 2026-06-07 - Contextual-memory prompt-cache PROD fix (typed flag)

### Baseline

- Starting SHA: `fc42a8626dfee36c0aec4505c76817c244a28155`
- Scope: turn the earlier contextual-memory cache hotfix into a PROD-quality fix. Replace fragile header string-matching with a typed contract flag, and project the volatile block with one symmetric provider schema.

### What changed & why

Live cluster receipts for runtime session `78ae7b44-b335-49e4-94b3-c684d1bd7fcf` showed one initial Anthropic write of `24,751` cache-creation tokens, then repeated short-turn writes around `10.5k` tokens while cache reads stayed at `14,138`. The chat had `168` stored messages, the moving-history marker itself stayed on the same stored assistant message across the sampled turns, and runtime code intentionally labels `durable_memory_contextual` as query-dependent / non-stable while prepending it before conversation history. That meant the Anthropic history breakpoint could include a potentially changing memory prefix before the otherwise-stable history marker.

The PROD fix makes the volatility a first-class typed property instead of a string heuristic. `ProviderGatewayTextMessage` now carries `cacheRole?: "volatile_context"`, set by the runtime when it builds the contextual-memory message in `turn-context-hydration.service.ts`. Both provider clients detect the flag (not the block header text), drop the message from the cacheable prefix, and re-project it as a `user` block spliced in immediately before the current user question — symmetric across Anthropic and OpenAI. This keeps the user's actual question highest in recency, keeps the stable system/tools cache and the Anthropic moving-history breakpoint hot, and never lets per-turn memory rotation invalidate the cached prefix. OpenAI per-turn developer instructions stay a provider-native trailing `developer` suffix; Anthropic developer instructions stay the `user`-wrapped suffix (Anthropic has no `developer` role). `cross_session_carry_over` and `rolling_session_synopsis` are stable-when-present and remain in the cached prefix unchanged.

### Files touched

- `packages/runtime-contract/src/index.ts` (new `cacheRole` typed flag)
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` (set flag on contextual block)
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`
- `apps/provider-gateway/test/openai-provider.client.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/provider-gateway run test` - PASS
- `corepack pnpm --filter @persai/runtime run test` - PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` - PASS
- `corepack pnpm --filter @persai/runtime run typecheck` - PASS
- `corepack pnpm --filter @persai/provider-gateway --filter @persai/runtime -r --if-present run lint` - PASS

### Risks / residuals

- Provider/runtime deploy independently: during the transition window an old provider-gateway ignores the new flag (old in-prefix behavior, no regression) and an old runtime omits the flag (no optimization until both deploy). Safe both ways.
- Provider prompt order for contextual memory intentionally changes: the block now sits as a `user` context block right before the question. Live smoke should confirm answer quality still uses retrieved memory.
- After deploy, live verification should confirm contextual-memory Anthropic turns keep history cache reads and do not repeat `~10.5k` `cacheCreationInputTokens` on short turns. VERIFIED 2026-06-07 against live `runtime_turn_receipts` for session `78ae7b44`: post-deploy short turns (18:47-19:11 UTC) keep `cacheRead` growing (`31774 -> 34203`) with only tiny tail writes (`18, 27, 0, 375, 185`), versus pre-deploy turns (10:38-16:17) that re-wrote a 3k-10.5k segment every turn with `cacheRead` pinned at `14138`. Fix confirmed working; the only remaining large writes are >5min-idle TTL misses (`cacheRead=0, cacheCreation≈24.6k`).
- Full-repo `format:check` / `pnpm -r lint` / `api`/`web` typecheck were intentionally not re-run here because the working tree is concurrently dirty with a separate UI/video cleanup; run the full gate at commit time once the tree settles.

### Next recommended step

Hold commit until the concurrent UI/video cleanup in the dirty tree settles, then commit this cache fix as its own scope (contract + runtime + provider-gateway + tests + docs). After deploy, ask the operator to send two short Anthropic turns in the same loaded chat and inspect live `runtime_turn_receipts` / Anthropic logs for cache-write suppression.

## 2026-06-07 - ADR-111 Slice 5 voice clone UI

### Baseline

- Starting SHA: `ec32253e68acb759fefd1c1471ca74735ea5f2bc`
- Scope: ADR-111 Slice 5, voice clone UI + runtime guidance + cross-docs, stacked on accepted uncommitted Slice 1-4b work by operator approval.

### What changed & why

Settings -> Characters now includes a compact `My voices` subsection. It renders ready/pending/failed cloned voices, preview/default/archive actions, linked-character summaries, VC cost/limit copy, and keeps pending/failed clones visible but not selectable for persona voice use.

The clone modal supports upload and browser recording modes with visible quality guidance, prepared reading/consent text, rights confirmation, preview playback, retry/remove, and microphone-permission fallback copy. It uses a bounded local wrapper around the same browser `getUserMedia` / `MediaRecorder` primitives as chat recording rather than changing the existing chat voice-message flow.

Persona create/edit can attach a ready cloned voice while preserving preset `heygenVoiceId` fallback. Inline `Clone a new voice` from the persona form opens the clone modal and attaches the newly ready clone after success. Runtime tool guidance now surfaces safe linked cloned-voice labels only from the materialized persona catalog and does not expose provider clone ids or add keyword routing.

Post-audit cleanliness repairs landed before commit: stale clone-recorder permission resolutions are ignored and stopped, duplicate recorder starts are guarded, clone/persona preview blob URLs are revoked on replace/close, failed cloned-voice rows count toward the UI limit gate to match API active-row truth, and cloned-voice archive now best-effort marks workspace assistants config-dirty so materialized persona guidance refreshes.

### Files touched

- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/_components/assistant-settings.test.tsx`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/assistant-api-client.test.ts`
- `apps/api/src/modules/workspace-management/application/heygen/manage-workspace-video-cloned-voices.service.ts`
- `apps/api/test/manage-workspace-video-cloned-voices.service.test.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ru.json`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/runtime/test/native-tool-projection.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/ADR/111-heygen-voice-cloning-and-characters-ux-v2.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/web exec vitest run app/app/assistant-api-client.test.ts app/app/_components/assistant-settings.test.tsx --config vitest.config.ts` - PASS (`128` tests)
- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx --config vitest.config.ts` - PASS (`72` tests after audit repairs)
- `corepack pnpm --filter @persai/api exec tsx test/manage-workspace-video-cloned-voices.service.test.ts` - PASS after audit repairs
- `corepack pnpm --filter @persai/runtime exec tsx test/native-tool-projection.test.ts` - PASS
- `corepack pnpm -r --if-present run lint` - PASS
- `corepack pnpm run format:check` - PASS
- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` - PASS
- `corepack pnpm --filter @persai/runtime run typecheck` - PASS
- `git diff --check` - PASS

### Risks / residuals

- Live authenticated smoke on `persai-dev` is still outstanding. The implementation subagent confirmed `https://persai.dev` is reachable, but could not complete Settings -> Characters clone/persona/render smoke because no signed-in dev session or local dev server was available.
- The clone modal recorder intentionally avoided extracting shared `ChatInput` recorder code in this slice to avoid destabilizing existing chat voice messages. It remains a small guarded wrapper around the same browser APIs and should be revisited if more recording surfaces appear.
- DB migrations have been statically verified through Prisma generation/typechecks/tests but not applied in a live database during this session.

### Next recommended step

Complete the one remaining ADR-111 acceptance item: authenticated dev smoke for cloned voice creation, persona attachment, talking-avatar render, and separate clone/render VC debit verification. After that, commit the full ADR-111 stack if the operator wants one combined commit.

## 2026-06-07 - ADR-111 Slice 4b persona clone runtime resolve

### Baseline

- Starting SHA: `ec32253e68acb759fefd1c1471ca74735ea5f2bc`
- Scope: ADR-111 Slice 4b, persona linked-clone substrate plus runtime voice resolution, stacked on accepted uncommitted Slice 1-4a work by operator approval.

### What changed & why

Personas now persist an optional workspace cloned-voice link through `clonedVoiceId` while preserving the existing preset `heygenVoiceId` / `heygenVoiceLabel` fallback fields. API create/update validates linked clones as same-workspace, active, ready, and provider-backed, and rejects archived, failed, missing, or cross-workspace links.

Internal persona reads now carry linked cloned-voice display/provider metadata for runtime. Materialized model-facing persona catalogs use safe display labels and never raw HeyGen clone ids. Talking-avatar runtime voice resolution now follows ADR-111 order: explicit request `voiceKey`, then linked ready cloned voice, then preset persona voice.

### Files touched

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260607153000_adr111_slice4b_persona_cloned_voice_linkage/migration.sql`
- `apps/api/src/modules/workspace-management/domain/workspace-video-persona.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-video-persona.repository.ts`
- `apps/api/src/modules/workspace-management/application/heygen/manage-workspace-video-personas.service.ts`
- `apps/api/src/modules/workspace-management/application/heygen/read-workspace-video-persona.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/workspace-video-personas.controller.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-workspace-video-personas.controller.ts`
- `packages/runtime-contract/src/index.ts`
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`
- `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts`
- focused API/runtime tests for persona linkage, materialization, controller parsing, and voice precedence
- `docs/ADR/111-heygen-voice-cloning-and-characters-ux-v2.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/manage-workspace-video-personas.service.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/read-workspace-video-persona.service.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/workspace-video-personas.controller.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/materialize-assistant-published-version.service.test.ts` - PASS
- `corepack pnpm --filter @persai/runtime exec tsx test/runtime-video-generate-tool.service.test.ts` - PASS
- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/runtime run typecheck` - PASS
- `corepack pnpm run format:check` - PASS
- `git diff --check` - PASS

### Risks / residuals

- Migration execution has been statically verified through Prisma generation/type/tests, but not applied to a live database in this slice.
- The internal runtime persona response was widened additively without a schema string bump; current callers are tolerant, but future schema-hardening may want an explicit version.
- Voice clone UI, recording/upload UX, cross-doc updates, full verification, and live dev smoke remain in Slice 5.

### Next recommended step

Continue with ADR-111 Slice 5: Voice clone UI + docs + smoke.

## 2026-06-07 - ADR-111 Slice 4a voice clone backend

### Baseline

- Starting SHA: `ec32253e68acb759fefd1c1471ca74735ea5f2bc`
- Scope: ADR-111 Slice 4a, provider-gateway/API cloned voice backend stacked on accepted uncommitted Slice 1-3 and split-decision work by operator approval.

### What changed & why

Provider-gateway now supports HeyGen voice clone submission and polling. The clone path uses `POST /v3/voices/clone` and `GET /v3/voices/{voice_clone_id}`, accepts only exact `complete` as success, keeps non-terminal statuses polling, and maps clone limit / plan upgrade / auth / rate-limit failures to stable product errors.

API now exposes workspace-scoped cloned voice create/list/archive/set-default behavior. Create accepts multipart audio upload, validates the audio file, enforces clone limit and duplicate-name checks, persists failed provider attempts as `failed` with no VC debit, and finalizes successful clones by marking the row `ready` and recording a `voice_clone_creation` debit in the same transaction. Runtime/persona linked-clone resolution remains explicitly out of scope for 4a and moves to 4b.

### Files touched

- `packages/runtime-contract/src/index.ts`
- `apps/provider-gateway/src/modules/providers/heygen/heygen-provider.client.ts`
- `apps/provider-gateway/src/modules/providers/provider-heygen-voices.service.ts`
- `apps/provider-gateway/src/modules/providers/interface/http/provider-heygen-voices.controller.ts`
- `apps/provider-gateway/src/modules/providers/provider-gateway.module.ts`
- `apps/provider-gateway/test/heygen-provider.client.test.ts`
- `apps/api/src/modules/workspace-management/application/heygen/heygen-provider-gateway.client.ts`
- `apps/api/src/modules/workspace-management/application/heygen/manage-workspace-video-cloned-voices.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/workspace-video-cloned-voices.controller.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-video-cloned-voice.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-video-cloned-voice.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/heygen-provider-gateway.client.test.ts`
- `apps/api/test/manage-workspace-video-cloned-voices.service.test.ts`
- `apps/api/test/workspace-video-cloned-voices.controller.test.ts`
- `apps/api/test/workspace-video-cloned-voice.repository.test.ts`
- `docs/ADR/111-heygen-voice-cloning-and-characters-ux-v2.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/provider-gateway exec tsx test/heygen-provider.client.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/heygen-provider-gateway.client.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/manage-workspace-video-cloned-voices.service.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/workspace-video-cloned-voices.controller.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/workspace-video-cloned-voice.repository.test.ts` - PASS
- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` - PASS
- `corepack pnpm -r --if-present run lint` - PASS after removing one unused test type alias
- `corepack pnpm run format:check` - PASS
- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` - PASS
- `corepack pnpm --filter @persai/runtime run typecheck` - PASS
- `git diff --check` - PASS

### Risks / residuals

- The provider-gateway HeyGen client test remains slow because older video-polling cases use real intervals.
- OpenAPI/generated client exposure for cloned voice endpoints was not added in 4a.
- Cloned voices are not yet selectable in Characters UI or used by runtime talking-avatar generation until 4b/5.

### Next recommended step

Continue with ADR-111 Slice 4b: persona linked-clone substrate plus runtime voice resolution.

## 2026-06-07 - ADR-111 Slice 4 split decision

### Baseline

- Starting SHA: `ec32253e68acb759fefd1c1471ca74735ea5f2bc`
- Scope: ADR-111 Slice 4 orchestration decision, stacked on accepted uncommitted Slice 1-3 work by operator approval.

### What changed & why

The first GPT-5.4 Slice 4 implementation subagent stopped before code changes and identified the ADR-allowed split point. Provider-gateway/API cloned-voice CRUD + successful-completion VC debit is coherent as `4a`; runtime precedence requires `4b` because current persona persistence/internal runtime fetches only carry preset HeyGen voice fields, not both a linked cloned voice and preset fallback.

ADR-111 now records the actual execution split: `4a` for HeyGen clone submit/poll, cloned-voice CRUD, provider error mapping, and clone VC debit; `4b` for persona linked-clone substrate, contract widening, and runtime voice resolution order.

### Files touched

- `docs/ADR/111-heygen-voice-cloning-and-characters-ux-v2.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- Docs-only split decision; full verification will run after the next implementation slice.

### Next recommended step

Continue with ADR-111 Slice 4a: provider-gateway/API cloned-voice CRUD and successful-completion VC debit.

## 2026-06-07 - ADR-111 Slice 3 voice clone substrate

### Baseline

- Starting SHA: `ec32253e68acb759fefd1c1471ca74735ea5f2bc`
- Scope: ADR-111 Slice 3, API substrate stacked on accepted uncommitted Slice 1 and Slice 2 work by operator approval.

### What changed & why

The API now has durable workspace-scoped cloned voice persistence via `workspace_video_cloned_voices`, including Prisma schema/migration, a repository port, a Prisma adapter, and module provider registration. Rows store display-name normalization, nullable HeyGen clone id, language hint, lifecycle status, default flag, preview URL, source metadata, timestamps, and soft archive state.

Platform runtime settings now include `heygenVoiceCloneWorkspaceLimit` and `heygenVoiceCloneCreationVcoin` with ADR-111 defaults (`5` and `50`) and a hard cap of `10` for the workspace limit. The VC ledger kind union now permits `voice_clone_creation`, but this slice intentionally did not add debit behavior, HeyGen HTTP calls, REST endpoints, runtime resolution, or web UI.

### Files touched

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260607141500_adr111_slice3_voice_clone_substrate/migration.sql`
- `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts`
- `apps/api/src/modules/workspace-management/application/resolve-platform-runtime-provider-settings.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-runtime-provider-settings.service.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-vcoin-ledger-event.repository.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-video-cloned-voice.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-video-cloned-voice.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/platform-runtime-provider-settings.test.ts`
- `apps/api/test/workspace-vcoin-ledger-event.repository.test.ts`
- `apps/api/test/workspace-video-cloned-voice.repository.test.ts`
- `apps/api/test/knowledge-retrieval-helper.service.test.ts`
- `docs/ADR/111-heygen-voice-cloning-and-characters-ux-v2.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/api exec prisma generate --schema prisma/schema.prisma` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/workspace-video-cloned-voice.repository.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/workspace-vcoin-ledger-event.repository.test.ts` - PASS
- `corepack pnpm --filter @persai/api exec tsx test/platform-runtime-provider-settings.test.ts` - PASS
- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm -r --if-present run lint` - PASS
- `corepack pnpm run format:check` - PASS
- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `git diff --check` - PASS

### Risks / residuals

- Name reuse after archive is blocked by the unconditional `(workspaceId, displayNameLower)` uniqueness constraint, matching the existing persona table pattern.
- `isDefault` is stored but not yet constrained to one active default per workspace; Slice 4 service behavior should own that if product logic requires it.
- Cloned voice statuses are intentionally minimal (`pending`, `ready`, `failed`) until Slice 4 maps the provider lifecycle.

### Next recommended step

Continue with ADR-111 Slice 4: HeyGen voice clone backend plus runtime voice resolution.

## 2026-06-07 - ADR-111 Slice 2 Characters UI v2

### Baseline

- Starting SHA: `ec32253e68acb759fefd1c1471ca74735ea5f2bc`
- Scope: ADR-111 Slice 2, Characters UI v2 stacked on accepted uncommitted Slice 1 work by operator approval.

### What changed & why

Characters now use a compact premium responsive grid instead of the old sparse/wide layout. `assistant-settings.tsx` has shared local card/create-slot helpers for unlocked personas, locked saved personas, and the locked demo record. Locked saved personas stay visible but disabled, and locked cards expose no edit/delete/portrait-open actions.

The create action now lives in the grid as a compact slot. It is enabled only when talking video is available and the persona limit has not been reached; plan-gated or limit-gated states stay visible but disabled and do not open the create modal. Voice labels use the cleaner `Voice - {voice}` / `Голос - {voice}` copy.

### Files touched

- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/_components/assistant-settings.test.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ru.json`
- `docs/ADR/111-heygen-voice-cloning-and-characters-ux-v2.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/assistant-settings.test.tsx --config vitest.config.ts` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `corepack pnpm -r --if-present run lint` - PASS
- `corepack pnpm run format:check` - PASS
- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `git diff --check` - PASS

### Risks / residuals

- `assistant-settings.tsx` remains large. Slice 2 kept extraction local to avoid new files, but future Characters/voices work will continue increasing pressure on this module.
- Coverage is DOM behavior focused; no pixel/screenshot test was added for the premium visual language.

### Next recommended step

Continue with ADR-111 Slice 3: voice clone substrate.

## 2026-06-07 - ADR-111 Slice 1 video preview polish

### Baseline

- Starting SHA: `ec32253e68acb759fefd1c1471ca74735ea5f2bc`
- Scope: ADR-111 Slice 1, video lightbox playback polish plus Capacitor-relevant same-origin assistant-file MIME/Range verification.

### What changed & why

The inline chat video preview no longer depends on Android WebView decoding the first video frame. Chat video cards now render a deterministic compact play placeholder while keeping a hidden metadata-only `<video>` for duration, so Capacitor does not show a blank grey rectangle before opening playback.

The video lightbox no longer keeps the hero play overlay mounted over a playing video. The overlay now disappears once `videoPlaying` is true, independent of chrome visibility, so it does not block playback after start. Video chrome also auto-hides after playback starts and can be restored by tapping the video surface; pause/end restores the hero play affordance and controls.

The same-origin `assistant-file` BFF route received focused regression coverage for the Capacitor WebView preview path: it forwards `Range`, `If-Range`, `If-None-Match`, and `If-Modified-Since`, and preserves upstream `206`, `Content-Range`, `Accept-Ranges`, `Content-Length`, and `Content-Type: video/mp4`. Upstream API download code already served real ranged responses, so no API change was needed. No `persai-mobile` files changed and no APK rebuild was required.

### Files touched

- `apps/web/app/app/_components/image-lightbox.tsx`
- `apps/web/app/app/_components/image-lightbox.test.tsx`
- `apps/web/app/app/_components/chat-message.tsx`
- `apps/web/app/app/_components/chat-message.test.tsx`
- `apps/web/app/api/assistant-file/[fileRef]/route.test.ts`
- `docs/ADR/111-heygen-voice-cloning-and-characters-ux-v2.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/image-lightbox.test.tsx --config vitest.config.ts` - PASS
- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/chat-message.test.tsx --config vitest.config.ts` - PASS
- `corepack pnpm --filter @persai/web exec vitest run "app/api/assistant-file/[fileRef]/route.test.ts" --config vitest.config.ts` - PASS
- `corepack pnpm -r --if-present run lint` - PASS
- `corepack pnpm run format:check` - PASS
- `corepack pnpm --filter @persai/api run typecheck` - PASS
- `corepack pnpm --filter @persai/web run typecheck` - PASS
- `git diff --check` - PASS

### Risks / residuals

- The generic fallback for an upstream response that omits `Content-Type` remains `application/octet-stream`; this is documented by test and intentionally does not invent HeyGen-specific MIME inference in the BFF.
- Live Capacitor smoke was not run in this slice; the code-level BFF and upstream API behaviors are now covered.

### Next recommended step

Continue with ADR-111 Slice 2: Characters UI v2.

## 2026-06-07 - History archive compaction

### Baseline

- Starting SHA: `15ed2324b1ff234101530ce9b23ea20aa0b3fca9`
- Scope: shorten active historical docs while preserving their full contents in archive files.

### What changed & why

`docs/SESSION-HANDOFF.md` now keeps only the active 2026-06-07 working set. Older 2026-06-06-and-earlier handoff sections moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`.

`docs/CHANGELOG.md` now keeps current entries and concise recent summaries only. Detailed 2026-06-05-and-earlier changelog entries moved to `docs/CHANGELOG.archive-2026-06-05-details-and-earlier.md`.

### Files touched

- `docs/CHANGELOG.md`
- `docs/CHANGELOG.archive-2026-06-05-details-and-earlier.md`
- `docs/SESSION-HANDOFF.md`
- `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`

### Verification

- Docs-only archive reshaping; no runtime tests required.

### Next recommended step

Continue with ADR-111 as the active HeyGen voice cloning / Characters UX v2 follow-up when ready.

## 2026-06-07 - Old ADR tail closure sweep

### Baseline

- Starting SHA: `15ed2324b1ff234101530ce9b23ea20aa0b3fca9`
- Scope: close stale/non-active ADR tails across older completed programs without changing production code.

### What changed & why

ADR-103, ADR-104, ADR-106, and ADR-107 now accurately reflect current project truth:

- ADR-103 is completed/closed around the shipped stubbed interactive landing demo. The public unauthenticated LLM demo endpoint is cancelled/deferred indefinitely and is no longer an active backlog item.
- ADR-104 is completed/closed around D1/D2 deploy-resilience improvements. The auto-mutating drift-repair cron is cancelled/deferred indefinitely, and prod atomicity remains only a future design note.
- ADR-106 is marked completed now that all provider-catalog/execution-routing slices are done.
- ADR-107 is marked closed as a partial program, pointing to its existing Program closure for the landed/deferred split.

### Files touched

- `docs/ADR/103-interactive-landing-demo-system.md`
- `docs/ADR/104-deploy-resilience-partial-build-and-drift-repair.md`
- `docs/ADR/106-video-provider-catalog-and-execution-routing.md`
- `docs/ADR/107-provider-native-video-audio.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- Docs-only change; no runtime verification required.
- `git status --short` was clean before this closure sweep.

### Risks / residuals

- These ADR tails are intentionally not active work. If the product later wants a public LLM landing demo, drift-repair automation, or broader provider-native video/audio expansion, it should be opened as a new ADR with fresh boundaries.

### Next recommended step

Continue with ADR-111 as the active HeyGen voice cloning / Characters UX v2 follow-up when ready.

## 2026-06-07 - ADR-110 closure + CI test harness fix

### Baseline

- Starting SHA: `080c85279f2a7ea496dfd89f0e28381e057a1f22`
- Scope: close ADR-110 after live verification and fix the follow-up CI regression in the Anthropic provider test harness.

### What changed & why

ADR-110 is now closed as completed. Live dev verification after the Anthropic stream-accounting fix showed that fresh Anthropic turns no longer double-count cache-read/input usage in PersAI persistence: `runtime_turn_receipts.result_payload.usageAccounting` and `model_cost_ledger_events.rawUsage` now match each other and reflect the expected prompt-cache shape (`cacheCreationInputTokens` on the first turn, then `cachedInputTokens` on subsequent turns) instead of the previous 2x inflation. That closed the active ADR-110 execution order.

Separately, the post-push CI failure on commit `080c8527` was traced to a test-only regression in `apps/provider-gateway/test/anthropic-provider.client.test.ts`: the new snapshot-usage regression case replaced the fake Anthropic stream implementation and did not restore the default stream before later assertions, so the rest of the suite stopped receiving the expected `text_delta` events. The fix factors the default fake stream into a reusable helper and reinstalls it after the snapshot-specific assertion, restoring deterministic suite behavior without changing production code.

### Files touched

- `docs/ADR/110-model-resolution-fallback-and-prompt-cache-orchestration.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`

### Verification

- `corepack pnpm --filter @persai/provider-gateway exec tsx test/run-suite.ts` - PASS
- Full AGENTS.md verification gate + `pnpm run test` are the next required step before commit/push.

### Risks / residuals

- Anthropic first-turn totals are still higher than the matched OpenAI first-turn totals on brand-new chats, but live evidence now shows this is no longer a double-count accounting bug. The remaining gap appears to be a real provider/prefix-shape difference and should be investigated separately by comparing exact assembled OpenAI vs Anthropic request sections.
- STT and web-search provider/model truth remain intentionally deferred outside ADR-110.

### Next recommended step

Run the full AGENTS.md verification gate plus `pnpm run test`; if green, commit and push the ADR-110 closure docs together with the CI-only test harness fix.

## 2026-06-07 - Anthropic stream usage double-count hotfix

### Baseline

- Starting SHA: `2f24b93d09b32af392199916245692acf0308690`
- Scope: focused Anthropic accounting correction after live prompt-cache / compaction investigation.

### What changed & why

Live Anthropic diagnostics narrowed the apparent "huge first-turn context" issue to incorrect PersAI-side accounting rather than an actually giant carry-over payload. Anthropic's own logs showed values like `input=891` and `cache read=12610`, while PersAI ledger/session data for the same turns showed exact doubled values (`inputTokens=1782`, `cachedInputTokens=25220`). Root cause was in `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`: the streaming path merged `message_start` and `message_delta` usage objects by summing fields, even though Anthropic emits usage snapshots/updated totals rather than additive deltas.

The fix changes Anthropic stream usage merging to "latest field wins" semantics instead of additive accumulation. This keeps the final provider-gateway usage snapshot aligned with Anthropic's own logs, which in turn prevents inflated `runtimeSession.currentTokens` and false context-pressure / compaction signals on short chats.

### Files touched

- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- `corepack pnpm --filter @persai/provider-gateway exec tsx test/anthropic-provider.client.test.ts` - PASS
- `corepack pnpm --filter @persai/provider-gateway exec tsx test/anthropic-empty-completion.test.ts` - PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` - PASS

### Risks / residuals

- This fix corrects provider-gateway stream accounting, but live confirmation still needs a fresh Anthropic deploy plus a short-chat repro to prove `model_cost_ledger_events`, `runtime_sessions.current_tokens`, and compaction advisories now match Anthropic's own dashboard numbers.
- Anthropic first-turn continuity still merits later inspection for semantic duplication (`carry-over` vs memory/open-loop wording), but the inflated 2x token counts were an accounting bug, not proof of a 2x larger prompt.

### Next recommended step

Deploy provider-gateway, run one fresh short Anthropic chat, and compare Anthropic dashboard token numbers against PersAI ledger/session values for the same request ids. If they match, re-check the compaction banner on a near-empty thread before reopening any continuity-path investigation.

## 2026-06-07 - ADR-111 opened: HeyGen voice cloning + Characters UX v2

### Baseline

- Starting SHA: `2f24b93d09b32af392199916245692acf0308690`
- Scope: docs-only ADR creation and ADR-109 closure at operator request; no code changes.

### What changed & why

ADR-111 was opened as the next HeyGen/talking-avatar follow-up program without reopening ADR-109. It supersedes only ADR-109's deferred voice-cloning non-goal and keeps custom audio lip-sync, broad HeyGen passthrough tuning, webhooks, Video Translate, and Photo Avatar Looks out of scope.

The operator then confirmed ADR-109 should be considered complete. ADR-109 was closed as `Completed (2026-06-07)` with a closure note stating that further HeyGen voice cloning, Characters UI v2, and video-player polish belong to ADR-111 and must not reopen ADR-109.

The ADR is written for an orchestrator agent that does not write production code. The orchestrator hires GPT-5.4 subagents per bounded slice, reviews diffs, runs verification itself, and updates docs. The planned slice order is:

1. Video player and Capacitor preview polish.
2. Characters UI v2.
3. Voice clone substrate.
4. Voice clone backend + runtime resolve.
5. Voice clone UI + docs + smoke.

### Files touched

- `docs/ADR/111-heygen-voice-cloning-and-characters-ux-v2.md`
- `docs/ADR/109-heygen-talking-avatar-on-vcoin.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Verification

- Docs-only change; no code tests required.
- `git status --short` was clean before edits.
- Official HeyGen voice-clone docs were re-read: `POST /v3/voices/clone` returns `voice_clone_id`; poll `GET /v3/voices/{voice_clone_id}` until `complete`; resulting voice can be used with `POST /v3/videos`.

### Risks / residuals

- ADR-109 is closed by operator verification; ADR-111 must not rewrite its historical record.
- Voice cloning depends on HeyGen account capability and may return `plan_upgrade_required`; ADR-111 requires honest surfacing rather than treating it as a PersAI plan error.
- Capacitor preview polish may require upstream API MIME/Range fixes; Slice 1 must verify the actual response headers before changing code.

### Next recommended step

Start ADR-111 Slice 1 with a clean tree: fix the generic video lightbox overlay and validate/fix video MIME/Range behavior for Capacitor preview. Use a GPT-5.4 implementation subagent with exact Scope IN/OUT from the ADR.
