# ADR-109: HeyGen talking-avatar mode and workspace character registry

## Status

Proposed (2026-06-03). Depends on ADR-108 at minimum through slice 3 (settle path debit + monthly grant). Parallel to ADR-102. **Slice 0 Completed (2026-06-04)** — baseline SHA, HeyGen v3 API truth, and 6 binding UX decisions recorded; see `## Slice 0 erratum (2026-06-04)` at the bottom of this ADR for the binding amendments that supersede the original slice specs where they conflict. **Slice 1 Completed (2026-06-04)** — HeyGen API key credential slot landed in `tool-credential-settings.ts` + `/admin/tools` Video Providers section; 7 verification gates green; no HeyGen HTTP calls yet (Slice 6 owns the client). **Slice 2a Completed (2026-06-04)** — HeyGen recognized as video catalog provider symmetric to Runway/Kling: union/contract widening, Admin Runtime UI card with empty round-trip, placeholder branches where exhaustive switches demanded; 8/8 verification gates green; Slice 2 split into 2a (substrate) + 2b (capability axis + plan validation). **Slice 2b Completed (2026-06-04)** — `RuntimeVideoModelKind = "cinematic" | "talking_avatar"` structural field on every `RuntimeProviderModelProfileBase`, provider-locked at parser level (HeyGen→talking_avatar, others→cinematic) with throw-on-incompatibility; plan validation refuses talking_avatar rows for `videoGenerateModelKey`/fallback; chat tool projection filters HeyGen out of cinematic `video_generate` surface via structural `isTalkingAvatarVideoProvider(providerId)` helper; Admin UI shows read-only "Cinematic"/"Talking Avatar" badge per row; 10/10 verification gates green; capability derivation is purely structural (invariant #15 preserved). **Slice 3 Completed (2026-06-04)** — `RuntimeVideoGenerateMode = "cinematic" | "talking_avatar"` request-mode contract with new optional fields (`mode`, `speechText`, `speechLanguage`, `personaId`, `portraitImageAlias`, `voiceKey`) on `RuntimeVideoGenerateRequest` + symmetric `requested*` echoes on `RuntimeVideoGenerateToolResult` + pass-through on `ProviderGatewayVideoGenerateRequest`. Structural validation in runtime tool service: `mode === "talking_avatar"` requires speechText + speechLanguage + XOR(personaId, portraitImageAlias); `mode === "cinematic"` or absent ignores new fields. Provider-gateway DTO accepts and forwards new fields; HeyGen branch retains Slice 2a placeholder throw. NO multi-character refusal in code (operator-superseded original spec clause; single-speaker rule moves to Slice 8 tool description). Tool projection JSON Schema unchanged (Slice 8 + 9 will wire). 10/10 verification gates green; invariant #15 verified (XOR is pure boolean, no regex/parsing). **Slice 4 Completed (2026-06-04)** — HeyGen voice catalog cache substrate landed as a structural mirror of the existing Kling pattern: new `PlatformHeygenVoiceCatalogCache` Prisma model + migration, new `HeyGenVoiceCatalogService` with 24h TTL fetching `GET https://api.heygen.com/v3/voices` via `X-Api-Key` (defensive multi-alias response parsing of both wrapped + flat shapes), `RuntimeVideoVoiceCatalogEntry.previewAudioUrl?` added (backward-compatible), `RuntimeVideoVoiceCatalog.provider` widened to `"kling" | "heygen"`, Kling service augmented to extract/hydrate `previewAudioUrl` symmetrically, materialization service uses explicit parallel branches for kling/heygen. Discovered + fixed pre-existing Slice 2a fixture omission in `materialize-assistant-published-version.service.test.ts` (latent — not a Slice 3 false-PASS because Slice 3 verification did not run this specific test). 10/10 verification gates green; #15 NON-NEGOTIABLE preserved (all parsing is structural JSON field inspection of HeyGen API response, zero regex on user input). **Slice 5 Completed (2026-06-04)** — Workspace persona registry: new `WorkspaceVideoPersona` Prisma model + migration (`workspace_video_personas` table, soft-delete via `archived` flag, FK ON DELETE RESTRICT, unique index on `(workspaceId, displayNameLower)`); `ManageWorkspaceVideoPersonasService` with create (single `prisma.$transaction`: limit check → duplicate-name check → persona insert → ledger event recordEvent → balance read → debit, all inside one tx via ADR-108 wallet primitives, ledger-first → debit-second per ADR-108 Slice 3 discipline), list (active rows + platform limit), archive (soft-delete only, no HeyGen API call, no VC refund); workspace-scoped REST controller (`POST/GET/DELETE /api/v1/workspaces/:workspaceId/video-personas`) with multipart portrait upload + fail-closed `req.workspaceId` identity auth; portrait normalized to 1024×1024 JPEG via `sharp` and saved AFTER tx commits (orphan-blob safe). Two new platform knobs (`heygenPersonaWorkspaceLimit` default 10, `heygenPersonaCreationVcoin` default 20) on `PlatformRuntimeProviderSettings` + Admin Runtime UI "Vcoin Economy" fold (bundled fix for pre-existing `vcoinExchangeRate` save-payload omission in the same admin path). `WorkspaceVcoinLedgerEventKind` union widened to `"persona_creation"`. 12/12 verification gates green. Voice selection is exact `providerVoiceId` equality against Slice 4 cached shortlist (zero fuzzy match, zero regex); duplicate-name check is `.toLowerCase()` equality (no fuzzy match). NO HeyGen HTTP calls anywhere (Slice 6 owns). `apps/runtime/**` untouched — invariant #14 (REST-only persona mutation) preserved. ADR-108 (Vcoin substrate) is fully closed and verified live. **Slice 6 Completed (2026-06-05)** — Provider-gateway HeyGen v3 HTTP client end-to-end: new `HeyGenProviderClient` covering four v3 endpoints (`POST /v3/videos` with `type: "image"` or `"avatar"`, `POST /v3/avatars` lazy avatar create, `POST /v3/assets` portrait pre-upload, `GET /v3/videos/{id}` poll). `X-Api-Key` auth header; fresh `crypto.randomUUID()` `Idempotency-Key` per submit POST attempt (never reused, never on polls or asset uploads); 10s poll cadence per erratum E10; submit failures fail-fast on all HTTP errors (Kling mirror); polling tolerates 3 transient transport failures then throws `PERSAI_VIDEO_POLLING_LOST::<json>` with `provider: "heygen"` (exact Kling format); `acceptedTask` resume path honored. **Slice 5b Completed (2026-06-05)** — E12 retrofit: persona POST now calls HeyGen `POST /v3/avatars` synchronously BEFORE the DB transaction (via the new provider-gateway endpoint `POST /api/v1/providers/heygen/create-photo-avatar`); `heygen_avatar_id` column tightened to NOT NULL with sentinel-backfill migration; HeyGen failures short-circuit cleanly (no persona row, no VC debit, honest `heygen_unavailable`/`heygen_avatar_create_failed` codes); pre-checks (limit/duplicate/balance) run BEFORE HeyGen call to avoid wasting the $1 spend on obvious violations, with authoritative re-checks INSIDE the tx as race guards; orphan-avatar warning log on the rare tx-race window. Slice 6 lazy-create code path preserved as defensive fallback (now delegates to the new `HeyGenProviderClient.createPhotoAvatar()` helper). 14/14 verification gates green. **`apps/runtime/src/**` untouched — cross-slice invariant #14 preserved in original strict form, no erratum needed.** **Slice 7 Completed (2026-06-05)** — Runtime `talking_avatar` execution wired end-to-end: new `executeTalkingAvatarDispatch` helper in `runtime-video-generate-tool.service.ts` handles structural HeyGen provider check, plan toggle TODO-stub (`talkingVideoEnabled === false` blocks; missing is permissive — Slice 8 will land materialization), persona path (reads via new read-only internal endpoint `GET /api/v1/internal/runtime/workspaces/:workspaceId/video-personas/:personaId`, uses `persona.heygenAvatarId` always populated post-E12, voice from persona's stored `heygenVoiceId` or explicit override against materialized HeyGen shortlist) vs portrait alias path (resolves alias bytes, requires explicit `voiceKey` per erratum E9), then dispatches via existing `provider-gateway.client.service.ts`. Honest failure codes: `persona_not_found`, `voice_required`, `voice_not_found`, `portrait_alias_unavailable`, `talking_avatar_provider_unavailable` (no Kling/Runway/OpenAI fallback), `talking_avatar_plan_disabled`. 12/12 verification gates green. **`apps/runtime/src/**` makes ZERO writes to `workspace_video_personas` — cross-slice invariant #14 preserved in original strict form; explicit grep verified no `personaRepository.(create|update|archive)` matches in runtime diff.** PersAI can now render HeyGen talking-avatar videos end-to-end on Scenario A (ad-hoc) and Scenario C (persona reuse). **Defensive status parsing (invariant #15 NON-NEGOTIABLE):** terminal SUCCESS = exact `status === "completed"`; terminal FAILED = exact `status === "failed"`; everything else (incl. `"pending"`/`"processing"`/`"waiting"`/future undocumented) → continue polling. Zero regex, zero `.includes()`, zero keyword list. **Missing-duration honesty:** completed response without `data.duration` throws `heygen_duration_missing` — NO fake `billingFacts`. On success, `billingFacts` is time-metered with `providerKey: "heygen"`, duration FROM HeyGen response. Contract widening: `ProviderGatewayVideoGenerateRequest` gained 3 new optional fields (`cachedHeygenAvatarId?`, `portraitImageBytesBase64?`, `portraitImageMimeType?`), `ProviderGatewayVideoGenerateResult` gained `lazyCreatedHeygenAvatarId?` (returned for Slice 7 to persist). Field decision: new `portraitImageBytesBase64` (not reusing `referenceImage`) keeps per-provider contract honest. Image transport: base64-inline for Scenario A (`type: "image"`); pre-upload via `POST /v3/assets` → `asset_id` for Scenario C lazy-create. Dispatch wired in `provider-video-generation.service.ts` (Slice 2a placeholder throw removed); `normalizeInput` defensively parses + forwards new fields with type-safe 400s. 12/12 verification gates green; 12-assertion `heygen-provider.client.test.ts` covers all scenarios incl. defensive `"waiting"` + `"unknown_future_value"` → in-progress, polling-loss, 4xx no-retry, missing-duration, resume, `Idempotency-Key` presence. Cross-slice invariants 1–15 verified true: #11 ADR-107 carve-out (no Runway/Kling/OpenAI provider-client edits), #14 REST-only persona mutation (`apps/runtime/src/**` untouched; client returns `lazyCreatedHeygenAvatarId` for Slice 7 to persist), #15 NON-NEGOTIABLE (pure structural `===` equality on terminal statuses). Subagent honored "no docs edits" instruction. PersAI can now call HeyGen v3 end-to-end; Slice 7 wires `mode = "talking_avatar"` in the runtime to populate the new gateway fields and persist `lazyCreatedHeygenAvatarId` back to the persona row. **Slice 8 Completed (2026-06-05)** — Plan toggle `talkingVideoEnabled` landed end-to-end: new boolean field on `AdminPlanInput`/`AdminPlanState` (persisted into the plan's existing `billingProviderHints` JSON column under the top-level `talkingVideoEnabled` key, default `false` for legacy plans); Admin Plans editor renders a sibling checkbox next to the video model keys with round-trip; materialization resolves the flag via new `resolvePlanTalkingVideoEnabled(planCode)` helper and injects it onto the bundle's `video_generate` tool policy (read by Slice 7's gate at `policy.talkingVideoEnabled === false`); runtime `RuntimeToolPolicy` interface gained typed `talkingVideoEnabled?: boolean` (Slice 7 defensive cast preserved for legacy bundles); LLM-facing tool projection in `native-tool-projection.ts` now structurally gates BOTH (a) the HeyGen-row visibility (the Slice 2b filter `!isTalkingAvatarVideoProvider(providerId)` is OR-ed with `talkingVideoEnabled`) AND (b) the conditional inclusion of talking-avatar fields (`mode`, `speechText`, `speechLanguage`, `personaId`, `portraitImageAlias`, `voiceKey`) + the talking-avatar description hint in the `video_generate` JSON schema — when flag is `false`/missing/undefined, the LLM sees the pre-Slice-3 cinematic-only surface. Slice 2b refusal error message in `manage-admin-plans.service.ts` updated from `(Slice 9)` to `(Slice 8)` since this slice IS the toggle landing. 12/12 verification gates green (lint, format:check, 5 typechecks, 4 focused tests + Slice 7 regression + full web suite 643/643 PASS). **Cross-slice invariants 1–15 verified true:** #11 ADR-107 carve-out preserved (no Runway/Kling/OpenAI provider-client edits), #12 no keyword routing (strict boolean `=== true` equality everywhere), #14 REST-only persona mutation preserved (`apps/runtime/src/**` untouched for writes), #15 NON-NEGOTIABLE (structural flag-presence check, zero regex/fuzzy/keyword match). Subagent honored "no docs edits" instruction (fifth subagent in a row to do so cleanly); falsely claimed one pre-existing test failure in its summary — orchestrator re-verified on clean baseline AND with Slice 8 changes: `use-chat.test.tsx` passes 82/82 in both states, and the full web suite passes 643/643 with Slice 8 applied (subagent hallucinated the "flaky" failure; the actual suite is fully green). Slice 7's runtime gate now lights up automatically when an operator disables `talkingVideoEnabled` on a plan: `mode: "talking_avatar"` requests get blocked with `talking_avatar_plan_disabled`. **Slice 9 Completed (2026-06-05)** — Assistant Settings UI Characters section landed end-to-end with three substrate additions to expose existing data to the user-facing UI: (1) `UserPlanVisibilityEntitlements.talkingVideoEnabled` (defensive structural read from `billingProviderHints.talkingVideoEnabled === true`, default `false`) so the UI can choose locked-with-upsell vs unlocked mode; (2) workspace-scoped voice catalog endpoint `GET /api/v1/workspaces/:workspaceId/video-personas/voice-catalog` returning the platform HeyGen voice shortlist (`{ provider: "heygen", voices: [...] }`) projected from Slice 4's `PlatformHeygenVoiceCatalogCache` — workspace ID accepted at controller layer for auth-scoping only, data is platform-wide; returns empty `voices: []` honestly when cache is unavailable; (3) `WorkspaceVideoPersonaListState.creationVcoinCost: integer` (sourced from `PlatformRuntimeProviderSettings.heygenPersonaCreationVcoin`) so the UI renders "Create for N VC" without a second roundtrip. New shared web component `apps/web/app/_components/voice-preview-button.tsx`: when `previewAudioUrl` is non-null and non-empty → active Play/Pause toggle with HTML5 `<audio>` lifecycle and module-level "only one plays at a time" coordination; when null/empty → grey disabled icon (`aria-disabled="true"`, `cursor-not-allowed`, `opacity-40`) with tooltip "Preview unavailable" — **NO TTS fallback substrate** (per operator directive — Slice 9b may add `POST /v3/voices/speech` blob caching later). New Settings UI section in `assistant-settings.tsx` between "Character" and "Limits" with two visual states gated structurally on `data.plan?.entitlements?.talkingVideoEnabled === true`: **Locked-with-upsell** (when `false`/missing) = section header + quiet italic upsell hint with inactive `/pricing` link + 1 mock disabled demo card ("Маша" with gray-circle placeholder portrait) + banner "Эти персонажи будут доступны при активации тарифа"; **Unlocked** (when `true`) = persona list with portrait/name/voice-label/preview-button (lookup `previewAudioUrl` by exact `heygenVoiceId` match against the voice catalog — single fetch on section mount, no N+1), top-right "Create persona" button (disabled when `personas.length >= limit` with tooltip), Create modal (drag-drop portrait upload + name input + voice picker with inline `VoicePreviewButton` per option + VC cost line "Cost: N VC. Balance: M VC. After: (M-N) VC" + submit disabled with "Insufficient balance" link to `/app/packages` when `balance < cost`), Delete confirm modal ("Удалить персонажа «{name}»? VC не возвращаются."). i18n keys under `settings.characters.*` namespace in both `en.json` and `ru.json`. 12/12 verification gates green (lint, format:check, 5 typechecks, 4 focused tests + Slice 7/5b regressions + full web suite 658/658 PASS across 65 files). **Cross-slice invariants 1–15 verified true:** #11 ADR-107 carve-out preserved (no Runway/Kling/OpenAI provider-client edits), #12 no keyword routing (boolean `=== true` equality everywhere; persona-name uniqueness delegated to existing REST API structural check), #14 REST-only persona mutation preserved (UI only calls REST endpoints, no runtime persona writes), #15 NON-NEGOTIABLE (voice catalog matched by exact `voiceId === heygenVoiceId` equality, no fuzzy match anywhere). Subagent: Claude Sonnet 4.6 medium thinking; single run; honored "no docs edits" rule (sixth subagent in a row to do so cleanly). Subagent's summary contained hallucinated "From prior session" phrasing for files actually created in this session — orchestrator verified all files actually got created and are correct; no impact on functionality. After this slice, end-users on plans with `talkingVideoEnabled: true` can create/list/delete personas via Settings without leaving the assistant settings page; end-users on plans with the toggle off see the feature exists as a quiet conversion hint. **Slice 10 Completed (2026-06-05)** — Chat UX for talking video landed via tool description update + persona materialization substrate. New `RuntimeVideoPersonaCatalog` type in `@persai/runtime-contract` (entries `{ personaId, displayName, voiceLabel }` — no portrait URL, no voiceLanguage normalization); new `videoPersonaCatalog?: RuntimeVideoPersonaCatalog | null` field on `AssistantRuntimeBundleToolCredentialRef` in `@persai/runtime-bundle` mirroring `videoVoiceCatalog`. Materialization service `attachMaterializedVideoPersonaCatalog` reads active personas from the Slice 5b repository (`listActive(workspaceId)`); gated by exact `providerId === "heygen"` AND `talkingVideoEnabled === true`; preserves chronological order; attaches `{ personas: [] }` honestly when workspace has zero active personas. Tool description in `native-tool-projection.ts::createVideoGenerateToolDefinition` (the same function Slice 8 conditionalized) gains a 7-section block when `talkingVideoEnabled === true` (total description char count ~3,566): (1) when to use `mode='talking_avatar'` (structural triggers — explicit speaking-video request + portrait OR named persona); (2) persona resolution from materialized `videoPersonas` block via exact case-insensitive name match with unambiguous-within-workspace guarantee from Slice 5's unique index; (3) persona creation guidance — "You cannot create personas yourself" — direct users to Settings → Characters (preserves invariant #14); (4) single-character-per-call rule with split-into-multiple-clips guidance for multi-speaker requests (replaces the operator-superseded Slice 3 multi-character refusal in code with LLM-instruction); (5) voice selection on portrait path (model picks from voice shortlist by context); (6) voice selection on persona path (omit voiceKey to use persona's stored voice); (7) inline persona shortlist table with `personaId` + `displayName` + `voiceLabel` per row, or "none yet" stub when empty. **E8 `needs_disambiguation` discriminated-union member is architecturally unreachable** given Slice 5's `UNIQUE INDEX (workspaceId, displayNameLower)` — duplicate persona names cannot exist within a workspace, so the LLM name-match is always unambiguous. NO new union member added; NO chat-side disambiguation card UI built (NOT Slice 9 scope despite E8 mentioning it; not Slice 10 scope either). **Mild orchestrator fixup mid-slice:** subagent's first pass introduced a `resolveVoiceLanguageFromLabel` function with a 16-entry hardcoded language-keyword prefix-match table (e.g. `"russian".startsWith("russian")` → `"ru-RU"`) used to derive a display-only `voiceLanguage` BCP-47 hint on each persona catalog entry. Display-only (didn't drive any behavior decision) but the prefix-match pattern is exactly what the operator has repeatedly asked to avoid ("честно и чисто", no keyword routing). Orchestrator resumed the subagent and instructed to **drop the entire `voiceLanguage` field** from the persona catalog rather than fix the lookup — the LLM already understands "Russian (Female)" via `voiceLabel` without a normalized BCP-47 code; the field was redundant. Fixup removed: `voiceLanguage` from the contract type, the materialization map, the description renderer, and all test fixtures. Final catalog entry shape: `{ personaId, displayName, voiceLabel }`. `resolveVoiceLanguageFromLabel` and `VOICE_LABEL_TO_LANGUAGE` no longer exist anywhere in the codebase (only pre-existing language detection in `heygen-voice-catalog.service.ts` and `kling-voice-catalog.service.ts` is left untouched — those parse HeyGen/Kling API response shape, not user input). Tests: `native-tool-projection.test.ts` gained 5 Slice 10 cases (`talkingVideoEnabled=true` with 2-persona catalog asserts all 7 description sections + persona lines; empty catalog → "none yet" stub; undefined catalog → defensive default; `talkingVideoEnabled=false` → none of the talking-avatar sections appear; snapshot via substring assertions for diff-visibility); `materialize-assistant-published-version.service.test.ts` gained 4 Slice 10 gate cases (HeyGen+enabled+2personas → catalog attached; HeyGen+disabled → no catalog; HeyGen+enabled+0personas → empty catalog; non-HeyGen → no catalog regardless of toggle). 12/12 verification gates green; web suite 658/658 (one transient flaky run early — 3 failures in unrelated tests during a high-load timing — confirmed not a Slice 10 regression on re-run). **Cross-slice invariants 1–15 verified true:** #11 ADR-107 carve-out preserved (no Runway/Kling/OpenAI provider-client edits), #12 no keyword routing (LLM does name → personaId resolution from materialized shortlist; no fuzzy/regex on user input messages anywhere — confirmed by explicit grep), #14 REST-only persona mutation preserved (materialization READS personas only via `listActive(workspaceId)`; explicit grep confirms zero `personaRepository.(create|update|archive)` calls in `materialize-*`), #15 NON-NEGOTIABLE (exact `=== "heygen"` provider check, exact `=== true` flag check; the keyword-prefix-match wart from first subagent pass was removed before commit). NO `apps/provider-gateway/**` edits. NO HeyGen API calls. NO new tools registered. NO Prisma schema/migration. NO `orval generate` run. NO chat-side UI changes. After this slice, the LLM has all the context it needs to drive talking-video workflows end-to-end: it sees the workspace persona list inline, it knows when to use `talking_avatar` vs `cinematic`, it knows to direct users to Settings for persona creation, and it knows the single-speaker constraint. Slice 11 (live smoke) is unblocked. **Audit-Pass Completed (2026-06-05)** — 4 independent read-only audit subagents in parallel (backend substrate integrity; architectural invariants + keyword routing; contracts + types + parallel paths; web UI + i18n + error mapping) produced 66 findings across slices 0–10; orchestrator triaged to 8 must-fix items (per E13.1–E13.12) and acknowledged 4 known limitations. Fixup landed via 2 parallel implementation subagents (Sonnet 4.6 medium thinking): backend/contract surface (`heygenAvatarId` removed from user-facing list, HeyGen 4xx→500 mis-mapping fixed via typed `HeyGenProviderClientError`, atomic conditional debit closes concurrent over-debit, orphan warning widened, `talkingVideoEnabled` required on generated TS, 6 stale slice-reference comments cleaned) + web UI surface (4 client methods aligned on `readApiErrorEnvelope` + `ApiStructuredError`, locked Characters now shows real personas disabled, `storageWarning` surfaced with new amber feedback + EN/RU i18n). 16 files modified, 0 new files, 12/12 verification gates green (lint, format:check, 4 typechecks, web suite 662/662, API + provider-gateway focused tests). E13 erratum block appended below the E12 block documenting all 12 audit reconciliations + 4 acknowledged limitations. **Slice 10b Completed (2026-06-05)** — Talking-video banner UX (time-based) landed on the right user-visible surface: the active-media-job chip in `chat-input.tsx` (lines ~1058–1079, the "media in progress" chips above the composer that already tick every 1s via `mediaJobNowMs`), NOT the activity-badge feed (which is suppressed for video jobs via `HIDDEN_MEDIA_ACTIVITY_LABEL` and was the first subagent's incorrect target). One optional + nullable contract field `displayKind?: "cinematic" | "talking_avatar" | null` added end-to-end on `AssistantWebChatActiveMediaJobState` (OpenAPI source-of-truth → hand-edited generated TS + new sibling enum file → API-side internal type). Per E3 erratum line 767, "a new optional `displayKind: "talking_avatar"` field on the active job DTO that the runtime can set when it accepts the job" is explicitly permitted — the implementation chose this option (b) over the "provider key visible on persisted artifact metadata" option (a) because metadata is post-completion only. API mapper helper `toWebOpenMediaJobDisplayKind` in `assistant-media-job.service.ts` derives the field structurally from `requestJson.directToolExecution.request.mode === "talking_avatar"` (Slice 3 contract); returns concrete `"cinematic" | "talking_avatar"` (never undefined on the wire); legacy rows without the field default to cinematic on the web side. `resolveMediaJobLabel(t, job, nowMs)` in `chat-input.tsx` gained a pre-switch early-return that maps elapsed seconds to one of 4 i18n keys (`chatTalkingAvatarBannerStage1`/`Stage2`/`Stage3`/`Stage4`) at thresholds `<30s` / `<120s` / `<300s` / `>=300s` ONLY when `operation === "video_generate" && displayKind === "talking_avatar"`; cinematic chip rendering byte-identical for every other case (Kling/Runway/OpenAI/`displayKind: "cinematic"`/legacy missing). The 4 new EN+RU i18n keys live as flat keys under `chat` namespace per the existing file convention (`charactersWarnStorageFailedTitle` precedent), not as nested `chat.talkingAvatarBanner.stage*` — the ADR spec at line 774 suggested the nested namespace but the file uses flat; orchestrator-decided to honor file convention. **Mid-slice pivot:** subagent's first pass honestly investigated and reported that the `ActivityEvent` activity-badge surface is suppressed in production for video jobs (`HIDDEN_MEDIA_ACTIVITY_LABEL` in `use-chat.ts:345`); the work was real infrastructure but invisible to users. Orchestrator resumed the same subagent with the corrected scope — revert activity-badge changes, keep the i18n keys, patch the actual user-visible chip surface, add the minimum DTO field. Both subagent passes preserved invariants 1, 11, 12, 14, 15. Subagent: Claude Sonnet 4.6 medium thinking; honored "no docs edits" rule (tenth subagent in a row). 6/6 verification gates green (lint, format:check, 3 typechecks web/api/contracts all exit 0, web 665/665 PASS, api full suite all assertions PASS including 3 new mapper assertions for displayKind projection in `assistant-media-job-open-context.test.ts`). NO `apps/runtime/**` edits, NO `apps/provider-gateway/**` edits, NO Prisma schema or migration, NO `orval generate` run, NO new Runtime DTO field. 10 modified files + 1 new generated enum file. Deploy: API + WEB + CONTRACTS (the OpenAPI/TS contract widening flows backward-compat — old API instances simply omit the field, web treats omitted-or-null as cinematic).

## Context

ADR-106 made `video_generate` provider-aware for OpenAI/Runway/Kling. ADR-107 added the audio capability axis (`silent`, `provider_native_audio`, `voice_control`) and the input capability axis (`text`, `single_reference_image`, `multi_image`, `omni`), and explicitly stated that "Runway voice/audio/avatar APIs must not be conflated with general-purpose `video_generate`" (`docs/ADR/107-provider-native-video-audio.md:39-40`). ADR-108 introduces Vcoin (VC) as the user-facing settlement currency for `video_generate`.

The next product step is HeyGen talking-avatar video. The product expectation is:

- User attaches a photo and asks to make a video with spoken text -> assistant produces a talking-head video using the photo and a Russian preset voice.
- User asks to "save Masha from this photo" -> assistant creates a workspace persona (display name + portrait + voice).
- User later asks to "have Masha read this text" -> assistant looks up the persona, reuses the cached HeyGen avatar, and renders the new video.

HeyGen exposes a Photo Avatar Video class of APIs that accept a photo and a voice id and produce a talking video without requiring the caller to first create a HeyGen avatar entity. HeyGen also exposes voice presets (`GET /v3/voices`) including Russian voices, and a voice cloning endpoint (`POST /v3/voices/clone`).

The architectural tension this ADR resolves: ADR-107 line 39-40 forbids conflating Runway voice/avatar APIs with general-purpose `video_generate`. HeyGen talking-avatar is architecturally similar (single-persona talking head from a portrait plus voice plus text). This ADR makes an **explicit, named exception** for HeyGen and formalizes the new product class as a top-level `mode` on the existing `video_generate` tool, so the tool surface does not multiply.

Per the 2026-06-03 audit synthesis, the user-confirmed shape is:

- `mode: "cinematic" | "talking_avatar"` as a top-level field on the `video_generate` request.
- `talking_avatar` is HeyGen-only in the first version; cinematic remains across OpenAI/Runway/Kling.
- Voice strategy MVP: HeyGen presets only (cached as Kling voice catalog is cached). Voice cloning is deferred to a later ADR.
- Workspace persona registry: separate PersAI entity. HeyGen avatar id is provider metadata stored on the persona row, created lazily on first use. Persona limit is configurable, default 10 per workspace.
- Plan toggle: boolean on the `video_generate` tool activation card in plans.
- Persona creation costs a fixed VC amount (configurable in Admin Tools) and is debited only on creation success.
- Render cost: catalog $/sec _ seconds _ `vcoinExchangeRate` per ADR-108 settle path.
- Multi-character in a single clip is deferred. MVP supports one persona per clip; the assistant proposes splitting a multi-character request into multiple clips.

## Decision

Add HeyGen as the fourth `video_generate` provider. Add `mode: "cinematic" | "talking_avatar"` as a top-level field on the request. Add a workspace-scoped persona registry. Gate `talking_avatar` per plan with a boolean on the `video_generate` activation card. Settle render cost through the ADR-108 VC wallet. Cache HeyGen presets the way Kling voices are cached.

### Provider policy

- `talking_avatar` is HeyGen-only. There is no automatic fallback to Runway, Kling, or OpenAI for `talking_avatar`. ADR-107 line 39-40 remains true for Runway and Kling; this ADR carves an exception only for HeyGen.
- `cinematic` continues to route to OpenAI / Runway / Kling exactly as ADR-106/107 already define.
- Voice cloning (`POST /v3/voices/clone`), avatar group APIs, scenes/montage, background music, and lipsync to third-party avatars are out of scope.
- Multi-character in a single clip is out of scope; the assistant must propose splitting into multiple clips when the user asks for it.

### User scenarios

**Scenario A: ad-hoc photo + text (no persona persistence).** User attaches a photo and asks to make a video with a spoken text. Runtime resolves the `portraitImageAlias` to a stored reference image, picks the assistant's default Russian voice (or the user-supplied `voiceKey`), and calls HeyGen Photo Avatar Video directly. No persona row is created. No "create avatar" VC charge. Render is debited from VC on success.

**Scenario B: explicit persona creation.** User says (or the assistant infers an explicit request) "save this as Masha". Runtime creates a `workspace_video_personas` row with `{ display_name, portrait_asset_id, heygen_voice_id, heygen_avatar_id = null }`. Persona creation debits the configured fixed VC cost on success. HeyGen avatar id is not created in this step.

**Scenario C: persona reuse.** User says "have Masha read this text". Runtime looks up persona by name (case-insensitive). If exactly one match: if `heygen_avatar_id` is null, runtime triggers HeyGen avatar creation lazily, persists the id, then proceeds with render. If `heygen_avatar_id` is already set, runtime uses it directly. Render is debited from VC on success. If zero matches, the assistant asks for clarification. If multiple matches, the assistant returns a list for the user to pick from. No keyword routing, no auto-guess.

### Persona registry shape

```ts
// workspace_video_personas
{
  id: string; // uuid
  workspace_id: string; // FK workspaces
  display_name: string; // unique within workspace, case-insensitive
  portrait_asset_id: string; // FK assistant_files (uploaded portrait)
  heygen_voice_id: string; // chosen at creation, from HeyGen presets
  heygen_avatar_id: string | null; // null until first talking_avatar render with this persona
  vc_cost_paid: number; // VC debited at creation
  created_at: Date;
  updated_at: Date;
}
```

A workspace has a configurable persona limit (default 10). The limit is stored in Admin Tools alongside the persona creation rate.

### Runtime contract shape (target)

The exact contract is finalized in slice 3 after a contract pass. The target shape is:

```ts
type RuntimeVideoGenerateMode = "cinematic" | "talking_avatar";

interface RuntimeVideoGenerateRequest {
  mode: RuntimeVideoGenerateMode;
  // cinematic-only fields
  prompt?: string;
  // talking_avatar fields
  speechText?: string;
  speechLanguage?: string; // ISO code, e.g. "ru"
  personaId?: string; // workspace persona, optional
  portraitImageAlias?: string; // ad-hoc photo when no persona
  voiceKey?: string; // explicit HeyGen preset voice id; overrides persona/default
  // common
  seconds?: number;
  size?: { width: number; height: number };
  // existing ADR-107 fields (audioMode, inputMode, voiceIds, voiceKeys, referenceTailImage, etc.)
}
```

Validation:

- `mode = "cinematic"`: same rules as ADR-106/107. `talking_avatar` fields are ignored if present.
- `mode = "talking_avatar"`: requires `speechText`, `speechLanguage`, and exactly one of `personaId` or `portraitImageAlias`. Plan must have `talkingVideoEnabled = true`. Provider must resolve to HeyGen; if not, the request fails honestly with `talking_avatar_provider_unavailable`.
- Multi-character requests (more than one persona reference or more than one named speaker in `speechText`) are rejected with `multi_character_not_supported`; the assistant is instructed by the tool description to split the work into multiple calls.

### Plan toggle

A new boolean `talkingVideoEnabled` on the `video_generate` tool activation card in the plan editor. Default false. When false, `mode = "talking_avatar"` requests fail with `talking_avatar_plan_disabled` and the runtime does not call HeyGen. (Erratum E13 (2026-06-05) pins the canonical error code as `talking_avatar_plan_disabled`; earlier draft text said `feature_unavailable` but no code path ever emitted that string.)

### Voice catalog cache

HeyGen voice presets are fetched via `GET /v3/voices` (or the equivalent listing endpoint), cached in a new platform table `platform_heygen_voice_catalog_cache` with the same 24h TTL pattern used by `KlingVoiceCatalogService`. Refresh is lazy on materialization (no cron). The cached shortlist is attached to the materialized assistant bundle on the `video_generate` ref when the resolved provider is `heygen`.

### Cost model

- **Persona creation cost (fixed VC):** stored in Admin Tools as `heygenPersonaCreationVcoin` (default 20 VC, configurable). Debited on persona row creation success. If `heygen_avatar_id` later creation fails, the persona row stays (with `heygen_avatar_id = null`) and the user is not charged twice.
- **Render cost (variable VC):** computed on success delivery by ADR-108 settle path. Catalog $/sec for HeyGen talking-avatar rows is admin-configured in Admin Runtime (same pattern as Runway/Kling video rows).
- **HeyGen-side avatar creation cost:** the HeyGen API may charge per avatar creation; that cost flows into the USD COGS ledger but is **not** separately surfaced to the user. The persona creation VC charge covers it conceptually.

## Non-goals

- Talking-avatar through Runway, OpenAI, or Kling. ADR-107 line 39-40 remains true for them.
- Voice cloning (`POST /v3/voices/clone`).
- Multi-character per clip / scenes / montage.
- Background music, sound effects, lipsync to non-HeyGen avatars.
- A standalone public Personas API / SDK.
- Sandbox / preview UI for personas (admin-side only in the first version).
- Auto-persisting every ad-hoc photo as a persona. Persona creation is explicit.
- Reforming VC pricing. ADR-108 owns it.
- Cross-plan persona sharing.

## Agent execution model

This ADR is executed by an **orchestrator agent that does not write code**. The orchestrator holds context across slices, plans one bounded slice at a time, spawns implementation subagents with precise prompts and file boundaries, diff-reviews every return, runs the focused tests and repo gates itself, and updates docs. Implementation subagents are the only actors that write source code.

### Orchestrator role

- **Read-only** for source/code files (`apps/**`, `packages/**`, `prisma/**`, infra, scripts).
- **Write-capable** only for docs: `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`, this ADR's slice status blocks, and the doc updates listed per slice (`docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`).
- Spawns one implementation subagent per slice. May spawn additional readonly audit subagents inside the slice's planning step for context-gathering (HeyGen API truth, persona-lookup edge cases, etc.).
- Diff-reviews every subagent return and rejects if scope was violated.
- Runs focused tests and repo gates through its own shell. Does not trust a subagent's PASS/FAIL claim unless verbatim command output was included.
- Refuses to mark a slice complete if the per-slice acceptance gate fails.
- Never commits or pushes (matches AGENTS.md).
- Enforces the ADR-108 dependency: ADR-108 must be at least at Slice 3 (settle path debit + monthly grant) **before** ADR-109 Slice 7 (runtime talking_avatar execution) is spawned. Earlier ADR-109 slices (0-6) can interleave with later ADR-108 slices.

### Per-slice orchestrator workflow

1. **Confirm tree.** `git status` clean. If dirty, stop and surface to the user.
2. **Confirm baseline.** Record SHA in `docs/SESSION-HANDOFF.md` if not already recorded for this session.
3. **Confirm ADR-108 dependency** for slices that need it (>= ADR-108 Slice 3 required for ADR-109 Slice 7).
4. **Read slice spec.** This ADR's `Slice specifications` for the current slice + all `Likely files` for that slice.
5. **State plan in chat.** Slice id, purpose, Scope IN, Scope OUT, files to touch, tests to add, exit criteria. Precondition for spawning the implementation subagent.
6. **Spawn one implementation subagent** using the prompt template below. Sequential, write-capable.
7. **Receive subagent return.** Mandatory structure (see below).
8. **Diff-review.** Reject if any `Scope OUT` file was touched, any `Forbidden patterns` are present, or the return structure is incomplete.
9. **Run focused tests + repo gates** from the slice spec plus this ADR's cross-slice invariants. Through orchestrator's own shell.
10. **Apply doc updates** listed for the slice.
11. **Append CHANGELOG line** matching the existing pattern.
12. **Update SESSION-HANDOFF** with baseline SHA, files touched, tests run, risks, deploy, next recommended step.
13. **Mark slice complete** in this ADR's `Slice specifications` by appending a `**Status (YYYY-MM-DD): Completed.**` block in the ADR-106 format.
14. **State next recommended slice** in chat.

If any step fails, the orchestrator rolls back (`git restore`) or re-spawns the subagent with a corrected prompt. Partial work is not silently accepted.

### Implementation subagent prompt template

The orchestrator constructs every implementation subagent prompt with these exact sections, derived from the slice spec:

- **ADR + slice id.** Example: `"ADR-109 Slice 6 - Provider-gateway HeyGen client"`.
- **Required reading.** Verbatim absolute paths: this ADR + ADR-108 (always — talking-avatar settles through ADR-108 wallet) + the slice's prior-ADR list + this slice's `Likely files`.
- **Purpose.** One paragraph from the slice's `Scope`.
- **Scope IN.** Exact files / directories the subagent may edit.
- **Scope OUT.** Exact files / directories the subagent must not touch (cinematic execution paths, image/tts/stt, chat routing, OpenAI image path, ADR-108 wallet code unless explicitly opened, etc.).
- **Required tests.** Verbatim from the slice `Required tests`.
- **Forbidden patterns.** Slice-specific anti-patterns (no keyword routing for persona lookup, no auto-guess on ambiguous persona names, no fallback to non-HeyGen for `talking_avatar`, no broad reformat, no commits, no push).
- **Verification commands.** Exact `pnpm` invocations the subagent must run with output included.
- **Return structure.** The mandatory structure below, listed in full so the subagent cannot omit it.

### Subagent return structure (mandatory)

The implementation subagent must return all seven items. Returns missing any item are rejected without diff-review:

1. **Changed files** — one bullet per file with one-line behavioral summary.
2. **Tests added or changed** — file path + assertion summary.
3. **Tests run** — exact commands + PASS / FAIL per command + tail of output where useful.
4. **Behavioral summary** — 3-5 bullets, no prose.
5. **Risks observed** — anything the orchestrator should know that is not in the slice spec.
6. **Out-of-scope discoveries** — issues found but not fixed. Orchestrator decides whether to file a follow-up slice or expand the current one.
7. **Diff line counts per file.**

### Per-slice acceptance gate

Before the orchestrator marks a slice complete, all of the following must be true:

- [ ] Every file in `Scope IN` was changed as planned; no file in `Scope OUT` was touched.
- [ ] Every test listed in `Required tests` exists and passes.
- [ ] No `Forbidden patterns` appear in the diff.
- [ ] Doc updates listed for the slice are present in the same change set.
- [ ] CHANGELOG line appended.
- [ ] SESSION-HANDOFF updated.
- [ ] This ADR's slice spec carries a `Status (YYYY-MM-DD): Completed.` block.
- [ ] Repo verification gates for the slice pass through the orchestrator's own shell.
- [ ] Cross-slice invariants below remain true (orchestrator may spawn a small readonly audit subagent to confirm if the diff is non-trivial).
- [ ] For Slice 7+: ADR-108 Slice 3 was already merged before this slice was started.

If any item fails, the orchestrator either re-spawns the subagent with a corrected prompt or rolls the slice back.

### Subagent rules (binding on every implementation subagent)

- Read this ADR + ADR-108 + the slice-specific files before editing.
- Edit only files listed in `Scope IN`.
- Refuse to edit `Scope OUT` files even if a refactor would seem helpful — surface as `Out-of-scope discoveries`.
- Return the mandatory structure above in full.
- Do not commit or push.
- Do not run broad reformatters across files outside `Scope IN`.
- Do not introduce keyword routing for persona lookup — that lives in the model + tool description, never in code.
- Do not silently auto-pick a persona on ambiguous match — surface the list to the user via runtime advisor copy.
- Do not let `mode: "talking_avatar"` fall back to non-HeyGen providers.
- Add focused tests for each changed seam.
- Run every verification command listed by the orchestrator and include the exact output tail.

### Cross-slice invariants the orchestrator enforces (above per-slice Scope OUT)

1. Cinematic mode behavior unchanged anywhere in this ADR.
2. ADR-106 invariants preserved (Runway/Kling video-only, chat routing OpenAI/Anthropic-only, OpenAI image untouched).
3. ADR-107 line 39-40 still applies to Runway and OpenAI; only HeyGen has the named exception.
4. ADR-105 media-job durability preserved.
5. Image / TTS / STT / chat routing behavior unchanged anywhere in this ADR.
6. No keyword routing for persona lookup anywhere.
7. `talking_avatar` mode never falls back to non-HeyGen providers.
8. Persona registry is workspace-scoped, never assistant-scoped.
9. VC debit for persona creation + render goes through ADR-108 wallet code (no parallel debit path).
10. HeyGen `avatar_id` is never surfaced in user-visible labels — only the persona's `display_name`.

If a subagent return violates any of these, the slice is rolled back.

### Required startup reading

1. `AGENTS.md`
2. `docs/SESSION-HANDOFF.md`
3. `docs/CHANGELOG.md`
4. `docs/ARCHITECTURE.md`
5. `docs/API-BOUNDARY.md`
6. `docs/DATA-MODEL.md`
7. `docs/TEST-PLAN.md`
8. `docs/ADR/108-video-vcoin-economy-and-pre-talking-avatar-cleanup.md`
9. this ADR
10. relevant prior ADRs:
    - `docs/ADR/082-billing-quota-and-delivery-confirmed-media-accounting.md`
    - `docs/ADR/086-async-media-jobs-for-generated-image-audio-and-video.md`
    - `docs/ADR/099-provider-pricing-catalog-and-unified-model-cost-ledger.md`
    - `docs/ADR/105-media-job-truth-and-orchestrated-cleanup.md`
    - `docs/ADR/106-video-provider-catalog-and-execution-routing.md`
    - `docs/ADR/107-provider-native-video-audio.md`

## Execution ledger

| Slice | Title                                 | Purpose                                                                                                                                                                                                                                                                                                                                    | Deploy                     |
| ----- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 0     | Baseline + HeyGen API confirm         | Re-read HeyGen Photo Avatar Video API + Voices listing. Confirm Russian preset voice availability. Confirm pricing and avatar creation semantics. Record baseline SHA.                                                                                                                                                                     | NO                         |
| 1     | HeyGen credential + Admin Tools UI    | `tool_video_generate_heygen` -> `tool/video_generate/heygen/api-key`. Secret store integration. Display in Admin Tools Video Providers section alongside Runway and Kling.                                                                                                                                                                 | API + WEB                  |
| 2     | HeyGen catalog row + Admin Runtime UI | Add `heygen` to `VIDEO_GENERATE_PROVIDERS` / `MANAGED_CATALOG_PROVIDERS`. Add catalog rows for `heygen` talking-avatar models with `capabilities: ["video"]`, `billingMode: "time_metered"`. Admin Runtime renders the HeyGen card video-only. Catalog can mark a row as talking-avatar-only (so cinematic plan selection cannot pick it). | API + WEB                  |
| 3     | Mode contract + tool projection       | Add `RuntimeVideoGenerateMode = "cinematic" \| "talking_avatar"` to runtime contract. Add `speechText`, `speechLanguage`, `personaId`, `portraitImageAlias`, `voiceKey` fields. Native tool projection extends `video_generate` schema with new fields, conditional on plan toggle.                                                        | CONTRACT + RUNTIME + WEB   |
| 4     | HeyGen voice catalog cache            | New `HeyGenVoiceCatalogService` and `platform_heygen_voice_catalog_cache` Prisma table. 24h TTL. Lazy refresh on materialization. Bundle attach when ref provider is `heygen`.                                                                                                                                                             | API                        |
| 5     | Workspace persona registry            | New `workspace_video_personas` table. CRUD service. Per-workspace persona limit setting (default 10, configurable in Admin Tools). VC debit on persona creation success (uses ADR-108 wallet).                                                                                                                                             | API                        |
| 5b    | Eager HeyGen avatar at persona POST   | Retrofit `ManageWorkspaceVideoPersonasService.createPersona` to call provider-gateway → HeyGen `POST /v3/assets` + `POST /v3/avatars` BEFORE the DB transaction. `heygen_avatar_id` becomes NOT NULL. New provider-gateway "create photo avatar only" endpoint. HeyGen failure short-circuits cleanly (no DB write, no VC debit). E12.    | API + PROVIDER-GATEWAY     |
| 6     | Provider-gateway HeyGen client        | New `apps/provider-gateway/src/modules/providers/heygen/heygen-provider.client.ts`. Submit Photo Avatar Video request, poll status, download result. Lazy avatar creation when persona reuse path requires it (defensive fallback only after E12; normal flow uses eager-created `avatar_id` from Slice 5b). Emit `billingFacts` time-metered. | PROVIDER-GATEWAY        |
| 7     | Runtime talking_avatar execution      | Runtime `runtime-video-generate-tool.service.ts` routes `mode = "talking_avatar"` to HeyGen. Resolves persona or ad-hoc photo. Validates plan toggle. Validates one-persona-per-clip. Calls provider gateway. Persists artifact. VC settle through ADR-108 path.                                                                           | RUNTIME + API              |
| 8     | Plan toggle + materialization gate    | Add `talkingVideoEnabled` boolean on plan `video_generate` tool activation. Admin Plans UI exposes it. Materialization writes the flag onto the bundle so runtime can fail honestly when off.                                                                                                                                              | API + WEB                  |
| 9     | Assistant Settings UI: Characters     | New section between Character (order 1) and Limits (order 2) in `apps/web/app/app/_components/assistant-settings.tsx`. Workspace personas list, create form (upload portrait + select voice + name), delete with confirm. Section hidden when plan `talkingVideoEnabled` is false.                                                         | WEB                        |
| 10    | Chat UX for talking video             | Tool description updated so the model knows when to ask "save as a reusable persona?" vs ad-hoc. No keyword routing. Tool description encodes multi-character refusal: split into multiple calls. Active media job pill and final artifact rendering reuse existing UX (Slice 6 of ADR-108 already adjusted balance display).              | RUNTIME (tool description) |
| 11    | Tests + docs + verification + smoke   | E2E tests for ad-hoc, persona create, persona reuse, multi-character refusal. Docs updates (ARCHITECTURE, API-BOUNDARY, DATA-MODEL, TEST-PLAN). Full verification gate. Live smoke in `persai-dev` with a real HeyGen credential.                                                                                                          | DOCS + ALL                 |

Minimum useful path for catalog-only HeyGen (admin can configure but feature not live): `0 -> 1 -> 2 -> 3`.

Minimum production path for live HeyGen talking-avatar: `0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11`.

Persona-aware path requires slice 5. Ad-hoc-only path can in principle launch at slice 7 if the assistant Settings section is deferred, but slice 8 plan toggle and slice 11 smoke are still required.

## Slice specifications

### Slice 0 - Baseline + HeyGen API confirm

**Scope**

- Re-read HeyGen Photo Avatar Video documentation (or equivalent endpoint that accepts a portrait + voice id + text and returns a video task).
- Confirm Russian preset voices in `GET /v3/voices` are reachable.
- Record exact endpoint paths, auth header shape, polling cadence guidance, and result download shape.
- Record HeyGen pricing model (per-second, currency).
- Record baseline SHA in `docs/SESSION-HANDOFF.md`.

**Exit**

- Provider truth is written down. No code change.

**Status (2026-06-04): Completed.** HeyGen v3 API truth (8 sections) + 6 binding UX decisions recorded. Baseline SHA `24d1d6ca89b92149a94d77c87c4c3af18cbbbd6c`. Source-of-truth landed in `docs/SESSION-HANDOFF.md` (`2026-06-04 — ADR-109 Slice 0` block). Binding amendments to the original slice specs (E1–E6, plus new Slice 10b for time-based talking-video banner UX, plus cross-slice invariants #14 and #15) recorded in `## Slice 0 erratum (2026-06-04)` at the bottom of this ADR. Later slices read both the original spec and the erratum; on conflict, **erratum wins**.

### Slice 1 - HeyGen credential + Admin Tools UI

**Scope**

- Add `tool_video_generate_heygen: "tool/video_generate/heygen/api-key"` to `TOOL_CREDENTIAL_IDS`.
- Map to tool code `video_generate`.
- Add display label.
- Add to `VIDEO_PROVIDER_CREDENTIAL_KEYS` in `apps/web/app/admin/tools/page.tsx`.
- Render in the existing Video Providers section.
- Reuse `PlatformRuntimeProviderSecretStoreService` exactly as Runway/Kling do.

**Required tests**

- API: save/load HeyGen key metadata.
- Web: Tools page renders the HeyGen row.

**Exit**

- Admin can store the HeyGen API key.

**Status (2026-06-04): Completed.** Baseline SHA `c4fa3825f64827ca21ffb10703fc2dc8a7456f9b` (post-Slice 0 closure commit). Landed via orchestrator-execution model with one Claude Opus 4.8 implementation subagent (first run) + same subagent resumed once to apply a derive-based refactor in `manage-admin-tool-credentials.service.ts:loadToolKeyMetadata()` after a Scope OUT typecheck blocker was surfaced. Future Slice subagents will use Sonnet 4.6 / GPT-5.4 per operator directive (Opus is cost-overkill for implementation slices). 6 files modified inside expanded Scope IN: `apps/api/src/modules/workspace-management/application/tool-credential-settings.ts` (added `tool_video_generate_heygen` to `TOOL_CREDENTIAL_IDS`, `TOOL_CODE_BY_CREDENTIAL_KEY`, display labels, and updated operator notes), `apps/api/src/modules/workspace-management/application/manage-admin-tool-credentials.service.ts` (derive-based refactor of `loadToolKeyMetadata()` `Record<ToolCredentialKey, …>` initializer using `Object.fromEntries(ALL_TOOL_CREDENTIAL_KEYS.map(...))` — semantic-preserving, removes the need for future provider slices to touch this file), `apps/web/app/admin/tools/page.tsx` (added third element to `VIDEO_PROVIDER_CREDENTIAL_KEYS`, updated Video Providers section copy), plus 3 augmented test files (`tool-credential-settings.test.ts` with `runHeygenCredentialRegistration` function asserting secret id / tool code / `ALL_TOOL_CREDENTIAL_KEYS` membership / reverse-resolve / secret ref shape; `manage-admin-tool-credentials.service.test.ts` with HeyGen save input + `updatedCredentials` assertion symmetric to Runway/Kling; `page.test.tsx` with new focused test asserting HeyGen row renders with default `"Enter API key..."` placeholder, not the Kling JSON placeholder). All 7 verification gates PASS via orchestrator's own shell: recursive lint, root format:check, `@persai/api` typecheck, `@persai/web` typecheck, `tool-credential-settings.test.ts`, `manage-admin-tool-credentials.service.test.ts`, `vitest run app/admin/tools/page.test.tsx` (3 tests). Cross-slice invariants 1–15 verified to remain true: no HeyGen URL / HTTP detail anywhere (pure storage), no keyword routing introduced, no behavioral change for Runway/Kling/OpenAI rows, no `Scope OUT` file outside the one-line expansion in `manage-admin-tool-credentials.service.ts` touched, no docs files touched by subagent (orchestrator writes docs). Deploy: API + WEB. No migration. No feature flag. Admin can now store the HeyGen API key in `/admin/tools` Video Providers section.

### Slice 2 - HeyGen catalog row + Admin Runtime UI

**Note (2026-06-04):** This slice has been split into **2a (substrate widening)** and **2b (capability axis + plan validation)** during orchestrator planning. The original combined spec is preserved below; deliverable boundaries are recorded in the Status stamp.

**Scope**

- Extend `MANAGED_CATALOG_PROVIDERS` and `VIDEO_GENERATE_PROVIDERS` with `heygen`.
- Extend `PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS` in `packages/runtime-contract/src/index.ts`.
- Add empty default catalog bucket `heygen: { models: [] }`.
- Admin Runtime renders the HeyGen card with the same video-only constraint applied to Runway/Kling.
- Add a per-row capability flag on catalog rows to indicate talking-avatar-only models (so plan validation cannot select them for cinematic). _(Slice 2b)_
- Plan validation: accept HeyGen rows only for `videoGenerateModelKey` / fallback when the model is marked talking-avatar-capable. _(Slice 2b)_

**Required tests**

- Catalog accepts HeyGen rows video-only. _(2a)_
- Chat selectors do not see HeyGen. _(2b — capability-axis-driven)_
- Talking-avatar-only catalog rows cannot be selected as cinematic primary/fallback. _(2b)_

**Exit**

- 2a: Admin sees a HeyGen card in `/admin/runtime` with empty catalog round-trip clean.
- 2b: Admin can configure HeyGen models with `talking_avatar` capability flag, and plan validation refuses cinematic selection of talking-avatar-only rows.

**Status (2026-06-04): Slice 2a + 2b Completed.** Baseline SHA `d18d0064...` (Slice 1 closure). Subagent: Claude Sonnet 4.6 medium thinking — first hire under the operator directive to retire Opus 4.8 from implementation slices. Single subagent run, no resume needed; Sonnet honestly self-reported a 5-file implicit scope expansion (`platform-runtime-provider-settings.ts`, `runtime-provider-settings-admin.ts`, `runtime-provider-settings-admin.test.ts`, `knowledge/page.test.tsx`, `assistant-api-client.test.ts`) as pure-additive `heygen: { models: [] }` data defaults symmetric to existing `kling: { models: [] }` sites, with no behavioral logic — pattern matches Slice 1 `loadToolKeyMetadata()` precedent. Orchestrator diff-reviewed every implicit-scope edit; all confirmed pure data-default. Substrate widening landed in: `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts` (`MANAGED_CATALOG_PROVIDERS`, `VIDEO_GENERATE_PROVIDERS`, `isVideoOnlyCatalogProvider`, 2 catalog default blocks); `packages/runtime-contract/src/index.ts` (`PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS`); `apps/web/app/admin/runtime/page.tsx` (~11 sites including `providerLabel()`, local `MANAGED_CATALOG_PROVIDERS`, `isVideoOnlyCatalogProvider()`, `normalizeCatalogForSlice2()`, `createEmptyCatalog()`, `withDerivedCatalogWeights()`, `buildCatalogFallback()`, `selectedCatalogIndexByProvider`, `newCatalogCapabilityByProvider`, `clampCatalogIndex` useEffect, card-footer copy branch). Placeholder branches added in 2 of 5 anticipated sites: `apps/provider-gateway/src/modules/providers/provider-video-generation.service.ts::generateVideo()` (`throw new Error("ADR-109 Slice 6: HeyGen runtime execution not yet implemented")`) and `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts::VIDEO_PROVIDER_CREDENTIAL_KEY` (`heygen: "tool_video_generate_heygen"` — references the Slice 1 credential symmetric to Runway/Kling); other 3 (`runtime-video-generate-tool.service.ts`, `runtime-tool-policy.ts`, `native-tool-projection.ts`) untouched because typecheck passed without modification. Contracts package updated: `packages/contracts/openapi.yaml` (added `"heygen"` to `ManagedRuntimeCatalogProvider` enum + `RuntimeProviderModelCatalogByProviderState` required array + properties); `packages/contracts/src/generated/model/managedRuntimeCatalogProvider.ts` + `packages/contracts/src/generated/model/runtimeProviderModelCatalogByProviderState.ts` (targeted Slice 2a additions only — orchestrator deliberately rolled back unrelated repo-wide generated-files drift surfaced by `pnpm --filter @persai/contracts run generate` so the Slice 2a commit stays clean; pre-existing contracts/generated drift is independent repo tech debt and not addressed in this slice). 15 files modified total (+111/−28); zero new files. All 8 verification gates PASS via orchestrator's own shell: `pnpm -r lint`, `pnpm format:check`, api/web/runtime/provider-gateway typechecks, `vitest run app/admin/runtime/page.test.tsx` (17 tests including new "renders the HeyGen catalog card with the empty-rows placeholder copy"), `tsx test/runtime-provider-profile.test.ts`. Cross-slice invariants 1–15 verified true: no HeyGen URL / HTTP detail anywhere (Slice 6 owns the HTTP layer), no keyword routing / message-body parsing introduced, no Prisma schema or migration changes, no plan-validation logic changes (deferred to 2b), no capability-axis field on catalog rows (deferred to 2b), no behavioral change for OpenAI/Runway/Kling rows. Deploy: API + WEB. No migration. No feature flag.

**Slice 2b Completed (2026-06-04).** Baseline SHA `f999d889` (Slice 2a closure). Subagent: Claude Sonnet 4.6 medium thinking, single run, no resume needed. Capability axis `RuntimeVideoModelKind = "cinematic" | "talking_avatar"` landed as a structural field on `RuntimeProviderModelProfileBase`, derived from provider identity at parse time (HeyGen→talking_avatar, others→cinematic), and enforced by the parser: `provider === "heygen" && kind !== "talking_avatar"` throws, and `provider !== "heygen" && kind === "talking_avatar"` throws. This makes capability provider-locked structurally rather than via any keyword or string-match heuristic — cross-slice invariant #15 remains true. Plan validation in `manage-admin-plans.service.ts::assertCapabilityModelKeysAvailable` now builds a `videoModelKindMap: Map<modelKey, kind>` from active video models across all 4 providers and refuses `videoGenerateModelKey` / `videoGenerateFallbackModelKey` with `BadRequestException` "is a talking_avatar (cinematic_only) model and cannot be used as a plan videoGenerateModelKey or videoGenerateFallbackModelKey. Talking-avatar models are exposed separately via the workspace plan toggle (Slice 9)." when the resolved row has `kind === "talking_avatar"`. Chat-side tool projection in `apps/runtime/src/modules/turns/native-tool-projection.ts` now filters out `video_generate` tool exposure when the configured video provider is a talking-avatar provider — uses new `isTalkingAvatarVideoProvider(providerId)` helper in `packages/runtime-contract/src/index.ts` (which checks providerId against the structural `PERSAI_RUNTIME_TALKING_AVATAR_VIDEO_PROVIDER_IDS = ["heygen"]` list — pure enum membership, never user-input parsing). Admin Runtime UI surfaces capability via a read-only badge per row (`aria-label="Capability kind"`, displays "Talking Avatar" for HeyGen rows and "Cinematic" otherwise). OpenAPI schema gained a `RuntimeVideoModelKind` enum component (`cinematic`, `talking_avatar`) and `kind` field on `RuntimeProviderModelProfileCommonState` — clean architecture because all 5 oneOf billing-mode variants already `allOf`-extend the common base. Generated contracts: new `packages/contracts/src/generated/model/runtimeVideoModelKind.ts` (manually mirroring orval style), `runtimeProviderModelProfileCommonState.ts` augmented with `kind` field + import, `index.ts` augmented with one new export. Pre-existing repo-wide generated-files drift NOT touched (orchestrator deliberately kept Slice 2b's contracts edit scope to exactly 3 generated files + 1 new file). Subagent self-reported 7-file implicit scope expansion: `platform-runtime-provider-settings.ts` (3 sites incl. provider-aware default), `tool-path-pricing-catalog.ts` (1 site, `kind: "cinematic"` for ledger pseudo-profile), `runtime-provider-settings-admin.ts` (1 site), `runtime-provider-settings-admin.test.ts` (3 sites), `assistant-api-client.test.ts` (3 sites), `admin/knowledge/page.test.tsx` (6 sites), `admin/runtime/page.test.tsx` (3 sites) — all pure-additive `kind` data defaults symmetric to Slice 2a's `kind`-free precedent; no behavioral logic introduced. Tests augmented: `runtime-provider-profile.test.ts` (5 new assertions covering default-cinematic / default-talking-avatar / explicit kind acceptance / incompatible-HeyGen-cinematic-throws / incompatible-Runway-talking-avatar-throws), `manage-admin-plans.service.test.ts` (new block: HeyGen v2 row rejected with `cinematic_only` error message; runway-gen-4 row passes), `native-tool-projection.test.ts` (2 new assertions: `video_generate` absent for heygen provider bundle, present for runway), `admin/runtime/page.test.tsx` (1 new test asserting "Cinematic"/"Talking Avatar" badges via `aria-label="Capability kind"`). 18 files modified + 1 new file (+445 / -5). All 10 verification gates PASS via orchestrator's own shell: recursive lint, root format:check, api/web/runtime/provider-gateway typechecks, `tsx test/runtime-provider-profile.test.ts`, `tsx test/manage-admin-plans.service.test.ts`, `tsx test/native-tool-projection.test.ts`, `vitest run app/admin/runtime/page.test.tsx` (18/18). Cross-slice invariants 1–15 verified true; specifically #11 ADR-107 line 39-40 carve-out enforced parser-side (Runway/Kling rows cannot be talking_avatar), and #15 NON-NEGOTIABLE (capability derivation is purely structural from `providerId` enum, not from any user input or model name string). Deploy: API + WEB. No Prisma migration. No feature flag.

### Slice 3 - Mode contract + tool projection

**Note (2026-06-04):** Original spec contained "Multi-character heuristic at request validation: refuse `>1 personaId` or detection of more than one named speaker pattern in speech text. Honest error code `multi_character_not_supported`." — the second half (parsing speech text) violates cross-slice invariant #15 (no keyword routing / no message-body parsing). **Operator superseded this clause: NO multi-character refusal in code anywhere. The `personaId` field is single-valued by type (multi-character is structurally impossible). The single-speaker rule lives ONLY in the LLM-facing tool description that Slice 8 will write — the model decides via instruction, not via code-side regex or counting.** Original "tool projection exposes new fields when plan has `talkingVideoEnabled` or `mode` is `cinematic`" wording was also imprecise; revised approach: Slice 3 lands types + structural validation + gateway pass-through ONLY. Tool projection JSON Schema for the new fields is deferred to Slice 8 (which owns tool description) + Slice 9 (which owns the plan toggle that lights up the talking-avatar tool surface).

**Scope (revised)**

- Add `RuntimeVideoGenerateMode = "cinematic" | "talking_avatar"` const + type + type guard in `packages/runtime-contract/src/index.ts`.
- Add new optional request fields (`mode`, `speechText`, `speechLanguage`, `personaId`, `portraitImageAlias`, `voiceKey`) to `RuntimeVideoGenerateRequest` and symmetric `requested*` echoes on `RuntimeVideoGenerateToolResult`.
- Symmetric pass-through fields on `ProviderGatewayVideoGenerateRequest` so the runtime → provider-gateway transport carries them.
- Structural validation in `runtime-video-generate-tool.service.ts`: when `mode === "talking_avatar"`, require non-empty `speechText` + non-empty `speechLanguage` + exactly one of `personaId` / `portraitImageAlias`. When `mode === "cinematic"` or absent, silently ignore new fields (legacy behavior preserved).
- Provider-gateway DTO acceptance of the new fields (defensive type-rejection of malformed values with honest 400; HeyGen branch retains the Slice 2a placeholder throw).

**Scope OUT (forbidden in this slice)**

- Tool projection JSON Schema for new fields and any tool description text (Slice 8 + 9 territory).
- Plan toggle `talkingVideoEnabled` (Slice 9).
- Any runtime execution path for `talking_avatar` rendering (Slice 7).
- Persona table or persona service (Slices 4-5).
- ADR-108 wallet code paths.
- Cinematic request shape — must round-trip identical bits.
- Multi-character refusal in code (operator directive — Slice 8 tool description holds the single-speaker rule).

**Forbidden patterns**

- Auto-defaulting `mode` to `"talking_avatar"` if `speechText` is present — `mode` must be an explicit top-level field set by the model.
- ANY regex / string matching / keyword detection / message-body parsing of `speechText`, `prompt`, or user input (invariant #15 NON-NEGOTIABLE).
- Counting `personaIds` for multi-character refusal — the type is single-valued, multi-character is structurally impossible.
- Hiding cinematic fields when `mode = "cinematic"` — the cinematic surface must remain unchanged.

**Required tests**

- `mode = "cinematic"` round-trips unchanged.
- `mode = "talking_avatar"` validates required fields.
- ~~Multi-character refusal returns a stable error code.~~ Superseded by operator directive (see note above): no multi-character refusal in code; single-speaker rule lives in Slice 8 tool description.

**Exit**

- Request contract is talking-avatar-ready and structurally validated (still not callable end-to-end until Slice 6 lands HeyGen HTTP client + Slice 7 wires the execution path).

**Status (2026-06-04): Completed.** Baseline SHA `1331c2e9` (Slice 2b closure). Subagent: GPT-5.4 medium (first hire on this project). Initial run honestly stopped on a false-positive "dirty tree" blocker (subagent interpreted the COMMITTED Slice 2b changes in `runtime-contract/src/index.ts` + `native-tool-projection.ts` as uncommitted working-directory drift); orchestrator confirmed `git status: nothing to commit, working tree clean` and resumed the subagent with clarification. Second run delivered cleanly. 6 files modified, all Scope IN (+568 / -6): `packages/runtime-contract/src/index.ts` (`RUNTIME_VIDEO_GENERATE_MODES`, `RuntimeVideoGenerateMode`, `isRuntimeVideoGenerateMode`, extended `RuntimeVideoGenerateRequest` with 6 optional new fields, extended `RuntimeVideoGenerateToolResult` with 6 symmetric `requested*` echoes, extended `ProviderGatewayVideoGenerateRequest` for transport pass-through); `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts` (defensive structural parsing of new args via existing `asNonEmptyString` helper; structural XOR validation `hasPersonaId === hasPortrait` for personaId/portraitImageAlias; mode-gated forwarding to gateway request `ONLY when mode === "talking_avatar"`; new private helpers `buildRequestedTalkingAvatarEchoes` and `buildGatewayTalkingAvatarFields`; symmetric echo additions to 14 `payload:` sites); `apps/provider-gateway/src/modules/providers/provider-video-generation.service.ts` (`normalizeInput` accepts new fields with defensive type-rejection 400s; HeyGen `case` keeps Slice 2a placeholder throw). Tests augmented: `runtime-video-generate-tool.service.test.ts` 7 focused scenarios (persona happy path, portrait happy path, cinematic-ignores-extras, missing-speechText-throws, missing-speechLanguage-throws, both-persona-and-portrait-throws-XOR, neither-persona-nor-portrait-throws-XOR); `provider-gateway.client.service.test.ts` assertion that new fields serialize into HTTP body; `provider-video-generation.service.test.ts` pass-through assertions + cinematic non-injection + defensive type-rejections + Slice 2a HeyGen-placeholder regression test. Verification (all 10 PASS): recursive lint, root format:check, api/web/runtime/provider-gateway typechecks, 4 focused tests, Slice 2b sanity test on `native-tool-projection.test.ts`. Cross-slice invariants 1–15 verified true; specifically #15 NON-NEGOTIABLE — zero regex, zero string matching, zero message-body parsing introduced; XOR check is pure boolean equality on `null`-vs-non-`null` field presence; `mode` is an explicit field set by the LLM, never inferred from any text content. NO multi-character refusal in code anywhere (operator directive). Tool projection JSON Schema and tool description text remain unchanged (Slice 8 + 9 will wire them with the plan toggle). Deploy: RUNTIME + PROVIDER-GATEWAY. No migration. No feature flag.

### Slice 4 - HeyGen voice catalog cache

**Scope**

- New service `HeyGenVoiceCatalogService` modeled on `KlingVoiceCatalogService`.
- New Prisma model `PlatformHeygenVoiceCatalogCache { id, fetched_at, voices_json }` with single-row pattern keyed `heygen-presets-voices`.
- 24h TTL.
- Lazy refresh on materialization.
- Materialization attaches a `videoVoiceCatalog` shortlist (provider `heygen`) on the `video_generate` ref when provider resolves to `heygen`.

**Required tests**

- Fresh cache returns cached shortlist.
- Expired cache refreshes from API.
- Materialization attaches the catalog only for `heygen` refs.

**Exit**

- Runtime knows which HeyGen voices it can offer.

**Status (2026-06-04): Completed.** Subagent: Claude Sonnet 4.6 medium thinking, single run, clean exit. 6 files modified + 4 new files, all Scope IN (~+48 lines diff stat). New `PlatformHeygenVoiceCatalogCache` Prisma model (table `platform_heygen_voice_catalog_cache`, PK on `cache_key VARCHAR(64)`, `voices_json JSONB`, `fetched_at TIMESTAMPTZ`) landed via hand-authored migration `20260604220000_slice4_heygen_voice_catalog_cache` (Postgres not running locally; SQL mirrors the Kling migration exactly with renamed identifiers; Prisma `generate` confirms the model is structurally valid). New `HeyGenVoiceCatalogService` at `apps/api/src/modules/workspace-management/application/heygen/heygen-voice-catalog.service.ts` mirrors `KlingVoiceCatalogService`'s public surface (`getMaterializedVoiceCatalog(): Promise<RuntimeVideoVoiceCatalog | null>`) with 24h TTL + lazy refresh; reads the HeyGen API key from `TOOL_CREDENTIAL_IDS.tool_video_generate_heygen` (registered in Slice 1) via `PlatformRuntimeProviderSecretStoreService`; fetches `GET https://api.heygen.com/v3/voices` with `X-Api-Key` header (HeyGen v3 auth convention); defensive multi-alias parsing accepts both `{data:[...]}` and flat-array response shapes plus field aliases `voice_id`/`voiceId`, `language`/`voice_language`, `gender`/`voice_gender`/`sex`, `preview_audio_url`/`preview_audio`/`previewAudioUrl`; documented failure modes: missing API key → returns null + WARN log; HTTP error → falls back to cached row + WARN log; empty refresh → falls back to cached row. Contract widening: `RuntimeVideoVoiceCatalogEntry.previewAudioUrl?: string | null` added (optional, backward-compatible); `RuntimeVideoVoiceCatalog.provider` widened from `"kling"` to `"kling" | "heygen"`. `KlingVoiceCatalogService` augmented symmetrically (extracts `previewAudioUrl` in `parseVoiceRow`, hydrates it from cached JSON in `parseCachedVoices`) — Kling regression test confirms existing behavior unchanged. Materialization wiring (`MaterializeAssistantPublishedVersionService.attachMaterializedVideoVoiceCatalog`) refactored from `if (ref.providerId !== "kling") return ref` early-return to explicit parallel branches for `"kling"` and `"heygen"`, each calling its own service. **Subagent honesty (no false-PASS regression):** the subagent discovered that `apps/api/test/materialize-assistant-published-version.service.test.ts` was already failing at HEAD — when Slice 2a added `"heygen"` to `MANAGED_CATALOG_PROVIDERS`, the test fixture's `availableModelCatalogByProvider` literal was not updated to include `heygen: { models: [] }`. Slice 3 verification did NOT include running this specific test (Slice 3's focused suite was `runtime-video-generate-tool`, `provider-gateway.client`, `provider-video-generation`), so this is not a Slice 3 false-PASS — it is a latent Slice 2a fixture omission. Fixed in Slice 4 as a 3-line addition. Tests added: `apps/api/test/heygen-voice-catalog.service.test.ts` (7 assertions: fresh→network+upsert, warm→no network, expired→refresh, missing creds→null, HTTP 401→stale fallback, flat array, `voiceId` alias) and `apps/api/test/materialize-heygen-voice-catalog.test.ts` (5 assertions: heygen catalog with `previewAudioUrl`, heygen ref→catalog attached, runway/openai refs→no attach, null catalog→ref unchanged, Kling regression). Verification (all 10 PASS via orchestrator shell): recursive lint, root format:check, api/web/runtime/provider-gateway typechecks (Prisma generate confirms `platformHeygenVoiceCatalogCache` valid), focused tests, kling regression, materialize-published-version regression. Cross-slice invariants 1–15 verified true; specifically #11 ADR-107 carve-out preserved (Slice 2b `kind=talking_avatar` constraint unchanged), #15 NON-NEGOTIABLE preserved (all parsing in the new service is purely structural JSON field inspection of the HeyGen API response — zero regex on user input, zero message-body parsing, zero keyword routing anywhere). NO HeyGen render wiring (Slice 6 owns; `provider-video-generation.service.ts` still throws `"ADR-109 Slice 6: HeyGen runtime execution not yet implemented"` on the `heygen` case). NO portrait/persona handling (Slice 5 + 6 own). NO LLM tool description text (Slice 8). NO plan toggle (Slice 9). Deploy: API. Migration `20260604220000_slice4_heygen_voice_catalog_cache` must run via `Dev Image Publish` migration approval gate per AGENTS.md before downstream slices. No feature flag.

### Slice 5 - Workspace persona registry

**Status (2026-06-04): Completed.** See SESSION-HANDOFF.md and CHANGELOG.md for full delivery details. Key decisions: soft-delete only (no hard-delete; `archived=true` preserves `heygenAvatarId` for Slice 6 cascade); non-filtered unique index on `(workspaceId, displayNameLower)` (Prisma 6.x limitation; Slice 6 will address); storage after tx; no VC refund on archive; `req.workspaceId` identity check for workspace authorization. Controller test deferred per scope.

**Scope**

- New `workspace_video_personas` Prisma model.
- CRUD service + workspace-scoped HTTP endpoints.
- Persona limit default 10, stored in Admin Tools as `heygenPersonaWorkspaceLimit`.
- Persona creation cost setting `heygenPersonaCreationVcoin` (default 20), debited on success via ADR-108 wallet.
- Persona deletion: cascade deletes `heygen_avatar_id` from HeyGen (best-effort) and removes the row.

**Scope OUT (forbidden in this slice)**

- Inventing a new VC debit path — must call the wallet service shipped by ADR-108 Slice 2 (rejection if ADR-108 Slice 2 is not merged yet).
- Provider-gateway HeyGen client (Slice 6).
- Runtime execution wiring (Slice 7).
- UI (Slice 9).
- Cross-workspace persona sharing.

**Forbidden patterns**

- Persona creation that proceeds when ADR-108 wallet rejects the debit — must surface honest `vcoin_balance_exhausted`.
- Two transactions for "create persona row" + "debit VC" — must be a single transaction; rollback persona row if debit fails.
- Hard-coding persona limit. Limit must be read from Admin Tools setting.
- Calling HeyGen API from this slice — Slice 5 only stores PersAI-side metadata.

**Required tests**

- Create / list / delete persona round-trip.
- Limit enforced.
- VC debit happens only on success.
- Duplicate display name within workspace rejected (case-insensitive).
- Delete cascades to HeyGen best-effort.

**Exit**

- Workspace can own up to N personas.

### Slice 6 - Provider-gateway HeyGen client

**Scope**

- New `HeyGenProviderClient` with:
  - submit Photo Avatar Video task (portrait, voice id, text, language, seconds, size);
  - poll task status;
  - download result url;
  - lazy create HeyGen avatar id when persona reuse path requires it;
  - emit `billingFacts` time-metered (`capability: "video"`, `providerKey: "heygen"`, `modelKey: <catalog model>`, `durationMs`/`durationSeconds`).
- Wire dispatch in `provider-video-generation.service.ts`.
- Polling-loss / accepted-task / retry behavior mirrors Runway/Kling.

**Scope OUT (forbidden in this slice)**

- Runway / Kling / OpenAI provider-client code (no edits, even refactors).
- Runtime side wiring (Slice 7).
- Persona DB writes — only HeyGen-side `avatar_id` creation, which is returned for the caller (Slice 7) to persist.
- ADR-108 wallet code.

**Forbidden patterns**

- Inlining persona DB lookups inside the provider client — the client receives a portrait URL + voice id + optional cached `heygen_avatar_id`, nothing more.
- Hardcoding HeyGen voice list — must consume the shortlist from materialized bundle (Slice 4 cache).
- Silent retry on 4xx HeyGen errors — only 5xx and transient transport errors retry per the existing Runway/Kling pattern.
- Returning fake `billingFacts` when HeyGen response lacks duration — must surface and fail honestly.

**Required tests**

- Ad-hoc submit: portrait + voice + text -> accepted task -> poll -> download.
- Persona reuse with cached `heygen_avatar_id`: avatar reused, no create call.
- Persona reuse with null `heygen_avatar_id`: create-then-render, persona row updated with new id.
- Polling loss handling matches existing pattern.
- BillingFacts emit time-metered fact.

**Exit**

- Provider-gateway can talk to HeyGen end-to-end.

### Slice 7 - Runtime talking_avatar execution

**Scope**

- `runtime-video-generate-tool.service.ts`: route `mode = "talking_avatar"` to HeyGen provider.
- Resolve `personaId` or `portraitImageAlias` to actual portrait asset; resolve voice id (persona default, explicit `voiceKey`, or assistant's default Russian preset).
- Validate plan toggle `talkingVideoEnabled`; honest fail when off.
- Refuse multi-persona in one request honestly.
- Async media job path: same lifecycle as cinematic (deferred enqueue, scheduler, completion delivery).
- VC settle through ADR-108 path on success.

**Scope OUT (forbidden in this slice)**

- Cinematic execution path — must round-trip identical bits.
- Provider-gateway code (Slice 6 owns it).
- Persona CRUD (Slice 5 owns it; this slice only reads).
- `media-delivery.service.ts` (settle path owned by ADR-108 Slice 2; this slice only ensures `billingFacts` flow correctly so the existing VC debit path fires).
- New tool registration in `native-tool-projection.ts` (Slice 3 owns the projection; this slice only wires execution).

**Forbidden patterns**

- Any fallback to Runway / Kling / OpenAI for `talking_avatar` — must fail honestly with `talking_avatar_provider_unavailable` if HeyGen is not configured.
- Auto-creating a persona when only `portraitImageAlias` was supplied — ad-hoc path must not persist anything.
- Auto-resolving an ambiguous persona name by picking the most recent — must return the list to the model via tool result for user disambiguation.
- Pattern-matching speech text for "Masha" / "Misha" / any name list — persona lookup is name-equality only against the workspace registry.

**Required tests**

- Ad-hoc end-to-end produces a video and debits VC.
- Persona reuse end-to-end produces a video, debits VC, sets `heygen_avatar_id` on first use.
- Plan toggle off blocks the request honestly.
- Multi-persona refused honestly.

**Exit**

- Talking-avatar is callable end-to-end.

### Slice 8 - Plan toggle + materialization

**Scope**

- Add `talkingVideoEnabled` boolean on plan `video_generate` tool activation card (in `manage-admin-plans.service.ts` and the editor UI).
- Materialization writes the flag onto the `video_generate` ref in the bundle.
- Tool projection (slice 3) reads the flag to decide whether to advertise talking-avatar fields.

**Required tests**

- Plan save/load round-trips the flag.
- Materialization carries the flag.
- Tool projection hides fields when flag is false.

**Exit**

- Admin can enable/disable talking-avatar per plan.

**Status (2026-06-05): Completed.** `talkingVideoEnabled` boolean lives at the top level of the plan's `billingProviderHints` JSON column (storage choice — no new column; legacy plans default to `false` when the field is absent). `parseBooleanInput(value, fieldName)` helper added to `manage-admin-plans.service.ts` (default `false` on null/undefined; throws on non-boolean). Admin Plans editor (`apps/web/app/admin/plans/page.tsx`) renders a sibling checkbox next to the video model keys; `PlanDraft` shape, load-from-plan path, save payload, sub-component props, and `isPlanDraftDirty` all carry the new field. Materialization (`materialize-assistant-published-version.service.ts`) resolves the flag via new private `resolvePlanTalkingVideoEnabled(planCode)` (mirrors the existing `resolvePlanBillingHintString` shape) and post-processes the resolved `toolPolicies` to inject `talkingVideoEnabled` onto the `video_generate` policy. Runtime `RuntimeToolPolicy` interface in `@persai/runtime-contract` gained typed `talkingVideoEnabled?: boolean` (Slice 7's defensive `(policy as unknown as Record<string, unknown>).talkingVideoEnabled` cast remains valid for backward compat). LLM-facing tool projection in `native-tool-projection.ts` gates BOTH layers structurally: (a) the Slice 2b HeyGen-row filter `!isTalkingAvatarVideoProvider(providerId)` is OR-ed with `talkingVideoEnabled`, so HeyGen is now projected when the plan toggle is on; (b) inside `createVideoGenerateToolDefinition(policy, credential, talkingVideoEnabled)`, the 6 talking-avatar properties (`mode`, `speechText`, `speechLanguage`, `personaId`, `portraitImageAlias`, `voiceKey`) AND the talking-avatar description hint are only spread into the schema when the flag is `true`; when `false`/missing, the LLM sees the pre-Slice-3 cinematic-only surface (description does not mention talking-avatar; schema has no talking-avatar fields). Slice 2b refusal message in `assertCapabilityModelKeysAvailable` updated from `(Slice 9)` to `(Slice 8)` (this slice IS the toggle landing). OpenAPI: added `talkingVideoEnabled: boolean (default false)` to `AdminPlanState` + `AdminPlanInputBase` schemas; generated TS models (`adminPlanState.ts`, `adminPlanInputBase.ts`) hand-updated (no `orval generate` run, preserves pre-existing repo-wide drift isolation). Tests: `manage-admin-plans.service.test.ts` +4 assertions (parse true / parse false / missing→false / non-boolean→throw); `materialize-assistant-published-version.service.test.ts` +4 assertions (toggle true materializes / toggle false materializes / legacy bundle absence → undefined permissive / Slice 8 materialization writes explicit false for legacy plans); `native-tool-projection.test.ts` +3 scenarios (HeyGen+true projects with all 6 fields + description hint / Runway+false stays cinematic-only / undefined defaults to cinematic-only); `apps/web/app/admin/plans/page.test.tsx` +4 assertions (legacy plan defaults false / true round-trip / false round-trip / `isPlanDraftDirty` detects toggle change); plus fixed an existing render that was missing the new required `ToolActivationsEdit` props. 12/12 verification gates green. NO `apps/provider-gateway/**` changes. NO HeyGen API calls. NO new tool registered (only existing `video_generate` projection adjusted). Slice 7's TODO-stub gate (`policy.talkingVideoEnabled === false` → `talking_avatar_plan_disabled`) is no longer a stub — the materialization writes the flag, and the gate fires when a plan disables talking-avatar. Subagent: Claude Sonnet 4.6 medium thinking; single run; honored "no docs edits" rule (fifth subagent in a row to do so cleanly). Subagent's summary claimed one pre-existing test failure in `use-chat.test.tsx > soft-detach resume refresh` — orchestrator verified on the clean baseline AND with Slice 8 applied: `use-chat.test.tsx` passes 82/82 in both states; full web suite passes 643/643 with Slice 8. Subagent claim was a hallucination; nothing is broken.

### Slice 9 - Assistant Settings UI: Characters

**Scope**

- New section in `assistant-settings.tsx`, ordered between Character (1) and Limits (2).
- List existing personas with portrait thumb + name + voice label.
- Create form: upload portrait, choose voice from the HeyGen preset cache, enter name. On submit: confirm VC cost, create.
- Delete with confirm.
- Hidden when plan `talkingVideoEnabled` is false.
- Empty state shows "Create a character to make talking videos with a consistent face and voice".

**Required tests**

- Section renders only when toggle is on.
- Create flow validates inputs and shows VC cost.
- Delete confirms and removes.

**Exit**

- Users can manage personas without leaving Assistant Settings.

**Status (2026-06-05): Completed.** Implemented with three substrate additions + a UI section + a shared component, per the planning constraints documented in erratum E2 (preview hard requirement, native URL only — NO TTS fallback in this slice) and E4 (locked-with-upsell, not hidden). **Substrate additions:** (1) `UserPlanVisibilityEntitlements.talkingVideoEnabled: boolean` — defensive structural read of `billingProviderHints.talkingVideoEnabled === true` from `resolve-plan-visibility.service.ts`; default `false` for legacy/missing hints; exposed via existing user-facing plan visibility endpoint that the web client already consumes through `useAppData`. (2) New `GET /api/v1/workspaces/:workspaceId/video-personas/voice-catalog` endpoint on the existing `WorkspaceVideoPersonasController` returning `{ provider: "heygen", voices: [...] }`. Workspace ID is for auth-scoping only; data is platform-wide. Returns `{ voices: [] }` (HTTP 200) honestly when the Slice 4 cache is unavailable (no HeyGen credential / empty shortlist). New application service `ReadHeygenVoiceCatalogForWorkspaceService` wraps `HeyGenVoiceCatalogService.getMaterializedVoiceCatalog()` and re-projects to UI shape (`voiceId`/`name`/`language`/`gender`/`previewAudioUrl`). (3) `WorkspaceVideoPersonaListState.creationVcoinCost: integer` sourced from `PlatformRuntimeProviderSettings.heygenPersonaCreationVcoin` (Slice 5 platform setting); `ManageWorkspaceVideoPersonasService.listPersonas` extended to read and return it. **Shared component** `apps/web/app/_components/voice-preview-button.tsx`: HTML5 `<audio>` playback with module-level coordination so only one preview plays at a time across the page; when `previewAudioUrl` is null/empty → grey disabled icon (`aria-disabled="true"`, `cursor-not-allowed`, `opacity-40`); when non-null → active Play/Pause toggle. NO TTS fallback (no `POST /v3/voices/speech`, no blob caching of generated previews); operator directive: voices without native HeyGen preview show a grey disabled play icon, not a generated fallback. **Settings UI section** in `assistant-settings.tsx` between Character (1) and Limits (2). Two visual states gated structurally on `data.plan?.entitlements?.talkingVideoEnabled === true`: **Locked-with-upsell** (false/missing): section header + italic upsell hint with inactive `/pricing` link + 1 mock disabled demo card ("Маша" with gray-circle placeholder portrait) + banner "Эти персонажи будут доступны при активации тарифа"; conversion-oriented but quiet per E4 directive. **Unlocked** (true): persona list with portrait/name/voice-label/preview-button (lookup by exact `heygenVoiceId` against the catalog — single fetch on section mount, no N+1); Create button (disabled with tooltip when `personas.length >= limit`); Create modal (portrait upload + name + voice picker with inline preview per option + VC cost line displaying current balance and post-creation balance + submit disabled with link to `/app/packages` when `balance < cost`); Delete confirm modal ("Удалить персонажа «{name}»? VC не возвращаются."). i18n keys live under `settings.characters.*` in both `en.json` and `ru.json`. **Tests:** `resolve-plan-visibility-vcoin.test.ts` +4 (`talkingVideoEnabled: true`, `false`, missing from hints, `billingProviderHints: null`); `read-heygen-voice-catalog-for-workspace.service.test.ts` 4 assertions (happy path, null catalog, empty shortlist, `previewAudioUrl` present/null); `voice-preview-button.test.tsx` 5 cases (active when URL non-null, disabled when null, disabled when empty, click triggers `audio.play()`, second click pauses); `assistant-settings.test.tsx` +8 cases under `describe("characters section")` (State A locked no-plan / locked with toggle=false / State B empty / State B with 2 personas / Create modal opens / insufficient balance disables submit / persona limit disables top-level Create / delete flow). 12/12 verification gates green. NO `apps/runtime/**` or `apps/provider-gateway/**` edits. NO HeyGen API calls from web. NO new tools registered. NO Prisma schema/migration. NO `orval generate` run. Subagent: Claude Sonnet 4.6 medium thinking; single run; honored "no docs edits" rule (sixth subagent in a row to do so cleanly). Mild wart: subagent summary contained "From prior session" hallucinated phrasing for files actually created in THIS session — orchestrator verified all files genuinely got created and are correct; no impact on the slice.

### Slice 10 - Chat UX for talking video

**Scope**

- Update the `video_generate` tool description to instruct the model:
  - when user attaches a photo + says "make a video" + provides text, use `talking_avatar` mode;
  - when user says "save this as <name>" (or similar explicit persona creation phrasing), create a persona first;
  - when user references a persona by name and the lookup is ambiguous, ask the user to disambiguate;
  - when user asks for multiple speakers in one clip, propose splitting into multiple clips.
- No keyword routing in code paths; the model uses the tool description.
- Active media job pill, sidebar dot, and final video rendering reuse the existing chat UX from ADR-108 Slice 6 (balance display) and ADR-105 (media job lifecycle).

**Scope OUT (forbidden in this slice)**

- Any new code paths in `apps/runtime/src/modules/turns/**` beyond updating tool description strings (and the matching snapshot test).
- Web components — Slice 9 owns Assistant Settings; chat UX reuse is verified, not extended.
- Provider-gateway changes.

**Forbidden patterns**

- Adding any regex / keyword routing for "talking" / "voice" / "озвучь" / "persona" / "character" / specific Russian or English verbs anywhere in code.
- Adding code that infers `mode` from the message body — `mode` is set by the model based on the tool description, never by string matching.
- Hard-coding the persona disambiguation copy — must come from a stable string table so locales can extend it.

**Required tests**

- Tool description text snapshot test (so unintended drift is visible in diffs).

**Exit**

- Assistant naturally drives talking-video workflows.

**Status (2026-06-05): Completed.** Implemented as **substrate (persona materialization) + tool description text**, NOT as chat UI. E8's `needs_disambiguation` discriminated-union member is architecturally unreachable given Slice 5's `UNIQUE INDEX (workspaceId, displayNameLower)`: persona names cannot duplicate within a workspace, so the LLM's name-match is always unambiguous. NO new union member added; NO chat-side disambiguation card UI built. **Substrate:** new `RuntimeVideoPersonaCatalog` type (entries `{ personaId, displayName, voiceLabel }` — minimal LLM-facing shape; no portrait URL, no BCP-47 voiceLanguage code); new `videoPersonaCatalog?` field on `AssistantRuntimeBundleToolCredentialRef` mirroring Slice 4's `videoVoiceCatalog`. Materialization `attachMaterializedVideoPersonaCatalog` gated by `providerId === "heygen"` AND `talkingVideoEnabled === true`; reads `listActive(workspaceId)` from Slice 5b repository; chronological order preserved; attaches `{ personas: [] }` honestly when workspace empty. **Tool description:** when `talkingVideoEnabled === true`, the `video_generate` tool description gains a 7-section structured block (~3,566 chars total): (1) when to use `mode='talking_avatar'` (structural triggers — explicit speaking-video request + photo OR named persona; mode='cinematic' default); (2) persona resolution from inline `videoPersonas` block via exact case-insensitive name match (LLM-side, structural — leverages Slice 5's unique-name guarantee); (3) "You cannot create personas yourself" — directs users to Settings → Characters (preserves invariant #14); (4) single-character-per-call rule with multi-speaker-→-multi-clip guidance (replaces the operator-superseded Slice 3 multi-character refusal in code); (5) voice selection on portrait path (model picks from shortlist by context); (6) voice selection on persona path (omit `voiceKey` to use stored voice); (7) inline persona shortlist table (`- personaId="<uuid>", displayName="<name>", voiceLabel="<label>"`) or "none yet" stub. **Orchestrator fixup mid-slice:** subagent's first pass introduced `resolveVoiceLanguageFromLabel` with a 16-entry hardcoded language-keyword prefix-match table to derive a display-only `voiceLanguage` BCP-47 hint — the prefix-match pattern is exactly what the operator asks to avoid ("честно и чисто"), even though it was display-only and not a strict #15 violation. Orchestrator resumed the subagent and instructed to drop the field entirely (LLM understands "Russian (Female)" via `voiceLabel` without normalization); fixup removed `voiceLanguage` from the contract type, materialization map, description renderer, and tests. `resolveVoiceLanguageFromLabel` and `VOICE_LABEL_TO_LANGUAGE` no longer exist anywhere in the codebase. Tests: 5 native-tool-projection cases (talking enabled with personas, empty catalog "none yet", undefined defensive default, talking disabled → no sections, snapshot substring assertions for diff-visibility) + 4 materialization gate cases (HeyGen+enabled+2personas, HeyGen+disabled, HeyGen+enabled+0personas, non-HeyGen) + Slice 7/Slice 5b regressions. 12/12 verification gates green; web suite 658/658 (one transient flaky high-load run early; confirmed not a Slice 10 regression). NO chat-side UI changes. NO `apps/provider-gateway/**` edits. NO `apps/web/**` edits at all (this slice is server-side only). NO new tools registered. NO Prisma schema/migration. NO `orval generate` run. Subagent: Claude Sonnet 4.6 medium thinking (single hire + one resume for the fixup; honored "no docs edits" rule both passes — seventh subagent in a row).

### Slice 11 - Tests + docs + verification + live smoke

**Scope**

- E2E coverage: ad-hoc photo + text; persona create then reuse; multi-character refusal; plan toggle off; insufficient VC.
- Update `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`.
- Cross-reference ADR-108, ADR-107 (with the explicit exception note for HeyGen), ADR-106, ADR-105.
- Full verification gate.
- Live smoke in `persai-dev` with a real HeyGen credential: one ad-hoc talking video, one persona-based reuse.

**Exit**

- Feature is live-callable and documented.

## Cross-slice invariants

1. `talking_avatar` mode is HeyGen-only. No automatic fallback to other video providers.
2. Cinematic mode behavior is unchanged.
3. Image / TTS / STT / chat behavior is unchanged.
4. Persona registry is workspace-scoped, not assistant-scoped.
5. HeyGen `avatar_id` is provider metadata stored on the persona row, never exposed in user-visible labels.
6. Voice cloning is out of scope; only HeyGen presets.
7. Multi-character per single clip is rejected; assistant proposes splitting.
8. Plan toggle gates `talking_avatar`; off plan returns honest `talking_avatar_plan_disabled` (canonical code per erratum E13).
9. Persona creation has a fixed VC cost (configurable in Admin Tools), debited on success only.
10. Render cost is variable VC computed per ADR-108 settle path.
11. ADR-107 line 39-40 stays true for Runway and OpenAI; this ADR carves an exception only for HeyGen.
12. No keyword routing for persona lookup; rely on the model and tool description.
13. ADR-106/107 invariants (Runway/Kling video-only, chat routing OpenAI/Anthropic-only, OpenAI image untouched) are preserved.

## Risks

- **HeyGen API rate limits / regional availability.** Mitigation: provider-gateway client surfaces honest accepted/poll/loss patterns matching Runway/Kling; document the operator-side rate limit policy.
- **Russian voice preset quality may not match user expectations.** Mitigation: voice cloning planned for a follow-up ADR; assistant should set expectations honestly when a user asks for a custom voice.
- **Persona limit 10 may be too low for agency-style workspaces.** Mitigation: limit is configurable in Admin Tools.
- **Race on lazy avatar creation when two requests reference the same persona in parallel.** Mitigation: persona row lock during first creation; second request waits or replays.
- **Photo privacy / GDPR.** HeyGen stores uploaded portraits. Mitigation: persona delete cascades to HeyGen best-effort; document retention policy.
- **Multi-character UX gap.** Users will ask. Mitigation: assistant proposes splitting; ADR-110 (future) can introduce montage.
- **Voice cloning deferral.** Users will ask. Mitigation: UI labels and assistant copy honest about preset-only support.
- **Plan migration friction.** Operators must enable `talkingVideoEnabled` per plan and tune VC grants. Mitigation: ADR-108 migration runbook is the place to anchor it.
- **HeyGen pricing changes.** Catalog $/sec is admin-editable; pricing drift handled the same as Runway/Kling drift.
- **Costs accumulate fast at high VC grant.** Settle-only debit means a user with a large monthly grant can burn VC in seconds. Mitigation: assistant exposes balance through advisor copy (ADR-108 slice 7).

## Alternatives considered

### New top-level tool `talking_video_generate`

Rejected. Multiplies the tool surface for a closely related class. The model already understands `video_generate`. ADR-106 explicitly chose to keep one tool with provider-neutral surface.

### Extend `audioMode` enum with `talking_avatar`

Rejected. `audioMode` is an ortho-axis describing audio behavior; `talking_avatar` is a structurally different request (different required inputs, different provider, different validation). Mixing them muddies both axes.

### Extend `inputMode` enum with `talking_avatar`

Rejected for the same reason. `inputMode` describes input shape (text, single image, multi-image, omni); `talking_avatar` is a mode of operation, not an input class.

### Persona registry assistant-scoped

Rejected. The product expectation is reuse across assistants in the same workspace ("Masha is my brand persona"). Workspace scope matches.

### Pre-create HeyGen avatar at persona creation

Rejected. Users may create personas they never use. Lazy creation avoids paying for unused HeyGen avatars and avoids a sync HeyGen call inside the persona create UX.

### No persona persistence (always ad-hoc)

Rejected. Reuse is the explicit product ask. Without persona persistence, every "Masha" video re-uploads the photo and re-creates the HeyGen avatar, which is wasteful and breaks naming continuity.

### Multi-character via scene montage

Deferred. Requires either a HeyGen multi-scene API (if/when available) or PersAI-side ffmpeg sandbox stitching. Both are larger than this ADR. Assistant proposes splitting instead.

## Consequences

### Positive

- Talking-avatar arrives as a first-class mode on the existing tool, with explicit honest exception to the ADR-107 rule.
- Persona reuse gives users a coherent brand-presence workflow across multiple videos.
- Settle through ADR-108 VC keeps cost honesty.
- Provider boundary mirrors Runway/Kling so HeyGen does not require a special-case execution path.

### Negative

- Adds a new provider, a new cache table, a new wallet debit category (persona creation), a new persona table, and a new section in Assistant Settings.
- Two-axis growth in the tool schema (cinematic vs talking_avatar) needs careful tool-description writing to keep model behavior crisp.
- Russian voice preset constraint will frustrate some users until voice cloning lands.
- Multi-character split is a workaround until montage support lands.

## Acceptance checklist

- [ ] HeyGen credential stored under `tool_video_generate_heygen` and visible in Admin Tools.
- [ ] HeyGen catalog rows configurable in Admin Runtime as video-only and talking-avatar-only.
- [ ] Runtime contract carries `mode = "cinematic" | "talking_avatar"` plus speech / persona / portrait / voice fields.
- [ ] Tool projection advertises the new fields only when plan toggle is on.
- [ ] HeyGen voice presets cached and attached on materialization.
- [ ] `workspace_video_personas` table exists with limit enforcement and VC debit on creation.
- [ ] Provider-gateway HeyGen client submits / polls / downloads.
- [ ] Provider-gateway lazily creates HeyGen avatar id for personas without one and persists it.
- [ ] Runtime executes `talking_avatar` end-to-end through HeyGen and debits VC on success.
- [ ] `talking_avatar` does not fallback to Runway / Kling / OpenAI.
- [ ] Cinematic mode behavior is unchanged (regression test).
- [ ] Plan toggle `talkingVideoEnabled` exists, gates execution, and hides UI fields when off.
- [ ] Assistant Settings has a Characters section (workspace-scoped) when toggle is on.
- [ ] Multi-character requests are refused honestly with split suggestion.
- [ ] Persona deletion cascades to HeyGen best-effort.
- [ ] E2E coverage exists for ad-hoc, persona create, persona reuse, multi-character refusal, plan toggle off, insufficient VC.
- [ ] Docs updated (ARCHITECTURE / API-BOUNDARY / DATA-MODEL / TEST-PLAN).
- [ ] ADR-107 line 39-40 exception for HeyGen recorded in this ADR and cross-referenced in ADR-107 if needed.
- [ ] Full verification gate PASS.
- [ ] Live smoke in `persai-dev` recorded for one ad-hoc and one persona-based talking video.

## Slice 0 erratum (2026-06-04)

The original ADR-109 (Proposed 2026-06-03) drafted slice specs before HeyGen API truth was empirically confirmed and before the user-facing UX gestures were agreed. Slice 0 closed both gaps. This erratum records the binding amendments. **Later slices read both the original spec and this erratum; on conflict, the erratum wins.** Slice specs above are not edited in place so the diff history of the original plan stays legible.

### E1 — Scenario B retired from runtime

**Supersedes:** § Decision § "User scenarios" § Scenario B; § Slice 5 spec; § Slice 7 spec; § Slice 10 spec.

**Decision:** persona creation is **REST-only**. The only mutator surface is the HTTP endpoint hit by the Settings → Characters create form. Runtime never creates a persona during tool execution. The model, when it detects an explicit "save as <name>" intent, **advises** the user in chat to create the persona via Settings → Characters; it does not have a `create_persona` tool to call.

**Why:** simpler runtime, smaller surface area, no need for runtime to learn "save as" intent, no risk of phantom personas from misclassified intents, no runtime-side VC debit path (the REST endpoint owns the transaction).

**Slice impact:**

- **Slice 5** stays as planned: `workspace_video_personas` table + CRUD service + HTTP endpoints + per-workspace limit (`heygenPersonaWorkspaceLimit`, default 10) + creation cost (`heygenPersonaCreationVcoin`, default 20 VC). Only the **REST endpoint** triggers it. No runtime caller. The endpoint runs the create + VC debit in ONE Prisma transaction (rollback persona row if debit fails).
- **Slice 7** is narrowed to Scenarios **A** (ad-hoc photo, no persona persistence) and **C** (persona reuse by `personaId`). Scenario B is removed from runtime entirely.
- **Slice 10** tool description teaches the model to advise persona creation in Settings when it detects intent; never to call a non-existent `create_persona` tool.

### E2 — Voice preview as a hard requirement everywhere `voice_id` appears

**Supersedes:** § Slice 4 spec; § Slice 9 spec.

**Decision:** every surface that displays or selects a `voice_id` must offer audio preview playback via a shared `<VoicePreviewButton voiceId={...} />` component. Surfaces:

- Settings → Characters → create form (voice picker; preview per voice option).
- Settings → Characters → persona card list (preview the persona's voice).
- Chat → disambiguation card list (preview each candidate's voice when names collide).
- Future chat surfaces that show voice metadata.

**Primary path:** consume `preview_audio_url` straight from `GET /v3/voices` (HeyGen-hosted). No re-hosting, no transcoding.

**Fallback path** (when `preview_audio_url === null` for a voice): Slice 4's cache refresh generates a short preview ("Hello, I can talk" or locale-appropriate equivalent) once per 24h TTL via `POST /v3/voices/speech` (Starfish-compatible voices only — filter `?engine=starfish`). Mp3 stored in PersAI blob storage. URL served to the client. **Cost is platform-paid** ($0.000667/sec × ~3s ≈ $0.002 per voice per refresh), never debited to the user wallet.

**Slice impact:**

- **Slice 4** scope expands: cache shape gains `previewAudioUrl: string` per voice (always non-null after first refresh); the cache row stores both HeyGen-native preview URLs and PersAI-generated fallback URLs uniformly so callers do not branch.
- **Slice 9** scope expands: voice picker UI includes preview button per option; persona card list includes preview button per row.
- New shared web component: `apps/web/app/_components/voice-preview-button.tsx` (audio play/pause with loading state). Built in Slice 9 alongside Characters UI.

**Cost guard:** if HeyGen reports voice has `engine != "starfish"` AND `preview_audio_url === null`, the cache row carries `previewAudioUrl: null` and the UI hides the preview button for that voice (rather than generating an empty/silent fallback). This is degraded UX, not a failure — confirmed acceptable in MVP.

### E3 — Talking-video banner UX is time-based (not phase-mapped) — NEW Slice 10b

**Supersedes:** § Decision § "User scenarios" (banner mentioned implicitly); § Slice 10 spec (Slice 10 still owns tool description only).

**Why this is needed:** HeyGen poll endpoint (`GET /v3/videos/{id}`) returns only `status: "pending" | "processing" | "completed" | "failed"`. No `progress: 0..100`, no `eta_seconds`, no nested `stage`/`phase`. Third-party signals indicate "1–3 minutes to render a 1-minute video" and HeyGen recommends webhooks over polling in production. A static "video processing…" banner on a 5-minute render reads as a hang.

**Decision:** add a **new Slice 10b — Talking-video banner UX (time-based)**. Pure-web slice. No backend changes. No `media_jobs.phase` column. No new contract fields.

**New Slice 10b specification:**

```
### Slice 10b - Talking-video banner UX (time-based)

Type: WEB only. No deploy of API/runtime/contracts.

Scope
- Detect that the active media job is talking-avatar (vs cinematic) on the client side, from the existing job snapshot (e.g. the `video_generate` ref provider key visible on the persisted artifact metadata, or a new optional `displayKind: "talking_avatar"` field on the active job DTO that the runtime can set when it accepts the job).
- Add a time-based banner copy rotation that swaps the user-visible banner text as elapsed time crosses thresholds. Suggested thresholds (locale-overridable):
  - 0–30s: "Готовим аватар…" / "Preparing avatar…"
  - 30s–2min: "Синтезируем голос…" / "Synthesizing voice…"
  - 2–5min: "Видео рендерится…" / "Rendering video…"
  - 5+ min: "Финальный проход, скоро будет готово…" / "Final pass, almost there…"
- Cinematic banner stays as today (preserves cross-slice invariant 1). The rotation applies only when the active job is talking-avatar.
- Banner copy lives in `apps/web/messages/en.json` and `ru.json` under a stable namespace (e.g. `chat.talkingAvatarBanner.stage1` … `stage4`).
- No timer in the i18n strings themselves; the React component owns the elapsed-time tracking and reads the localized strings.

Scope OUT
- Backend changes (runtime, API, contracts, provider-gateway).
- Cinematic banner copy or behavior.
- Real progress / ETA estimation (HeyGen does not surface it).
- Persisting elapsed-time stamps in the database.

Forbidden patterns
- Querying provider status more aggressively to extract phase info — none exists.
- Adding phase strings to runtime job snapshot that the runtime cannot honestly populate from HeyGen.
- Hard-coding banner copy strings outside the i18n catalog.

Required tests
- Web component test: given a mock active talking-avatar job with elapsed time X seconds, asserts the correct banner stage string is rendered.
- Web component test: given a cinematic job, asserts the legacy banner copy renders unchanged.

Exit
- Long HeyGen renders feel alive instead of hung.

Deploy
- WEB only.
```

Slice 10b lands after Slice 10 (tool description) and before Slice 11 (smoke). It can in principle land earlier if the active-job DTO already carries enough information to distinguish talking-avatar from cinematic on the web.

**Status (2026-06-05): Completed.** Landed on the user-visible `activeMediaJobs` chip in `chat-input.tsx:1058-1079` (NOT the suppressed `ActivityEvent` activity-badge feed — first subagent honestly identified the gap mid-implementation, orchestrator pivoted to the correct surface in a same-subagent resume). Detection mechanism: option (b) from the original spec — new optional + nullable `displayKind: "cinematic" | "talking_avatar" | null` field on `AssistantWebChatActiveMediaJobState` (OpenAPI + hand-edited generated TS + API-side internal type). API mapper `toWebOpenMediaJobDisplayKind` derives the field structurally from `requestJson.directToolExecution.request.mode` (the Slice 3 contract value). Web reads `job.displayKind` and rotates `resolveMediaJobLabel` by elapsed time at the 4 documented thresholds (`<30s`/`<120s`/`<300s`/`>=300s`). i18n: flat keys `chatTalkingAvatarBannerStage1..Stage4` under the existing `chat` namespace in `en.json` + `ru.json` (file uses flat convention; the nested `chat.talkingAvatarBanner.stage*` suggestion in the spec above is superseded by file-convention compliance). Cinematic chip is byte-identical for every non-talking-avatar case. Backward-compat: legacy rows without `displayKind` default to cinematic. Tests: 3 new chat-input cases (cinematic at 10s + 10min, legacy missing-field defaults to cinematic, talking-avatar stage rotation across all 4 stages with `vi.useFakeTimers`) + 3 new API mapper cases (talking_avatar → "talking_avatar"; cinematic → "cinematic"; missing/null/non-video → defensive "cinematic" default). Subagent: Claude Sonnet 4.6 medium thinking; resumed once for the surface pivot; honored "no docs edits" rule. 6/6 verification gates green (lint, format:check, 3 typechecks, web 665/665, api all assertions PASS). NO runtime, NO provider-gateway, NO Prisma, NO `orval generate`. 10 modified + 1 new generated enum file. Deploy: API + WEB + CONTRACTS.

### E14 — Slice 10c: Live integration fixup (talking-avatar credential routing + URL + prompt) — NEW (2026-06-05)

**Supersedes:** parts of § Slice 2b (capability refusal text), § Slice 3 (prompt requiredness), § Slice 7 (credential lookup site), § Slice 9 (web client URL shape), § Slice 10 (tool description prompt hint).

**Why this is needed:** live dev validation of the audit-pass deploy (`77512ef7`) surfaced four real production bugs that the 4-agent audit-pass missed because the audit was static (reading code) and never wired the end-to-end talking-avatar request from chat to HeyGen. Each bug blocks the feature independently:

1. **URL double-prefix (Slice 9):** the four web client methods landed in Slice 9 (`getWorkspaceVideoPersonas`, `getWorkspaceVoiceCatalog`, `createWorkspaceVideoPersona`, `deleteWorkspaceVideoPersona`) prepend `/api/v1` to the path while every other method in `assistant-api-client.ts` does NOT — `getApiBaseUrl()` already returns `/api/v1` (web default) or `http://localhost:3001/api/v1` (SSR default). Result: every Slice 9 fetch hits `/api/v1/api/v1/workspaces/.../...` → 404. Dev API logs confirm 4× 404s on both endpoints (2026-06-05 14:07–14:08 UTC).
2. **prompt required for talking_avatar (Slice 3):** `runtime-video-generate-tool.service.ts:886-889` validates `args.prompt` non-empty BEFORE checking `mode`. So talking-avatar requests without `prompt` fail with `"prompt must be a non-empty string"`. The LLM logically omits `prompt` for talking-avatar (`speechText` is the speaking content) — Slice 10 tool description does not say `prompt` is also required, so the LLM's reasoning is correct given the description but breaks the validator.
3. **`talking_avatar_provider_unavailable` is unreachable to clear (Slice 2b × Slice 7 architectural hole):** the runtime's Slice 7 `executeTalkingAvatarDispatch` requires `credential.providerId === "heygen"` to dispatch. The credential comes from `bundle.governance.toolCredentialRefs["video_generate"]`. Materializ-assistant builds that ref from `plan.videoGenerateModelKey` → catalog → providerId. But Slice 2b's plan validation EXPLICITLY refuses HeyGen models (kind=`talking_avatar`) for `videoGenerateModelKey` / `videoGenerateFallbackModelKey` with the cinematic-only error. So through the current plan editor, NO setup path makes `credential.providerId === "heygen"` reachable, and Slice 7 always fails with `talking_avatar_provider_unavailable`. Dev runtime log confirms `provider=kling` on every video_generate dispatch.
4. **LLM confusion in chat (Slice 10 description not enough):** the model tries different field combinations (omits `prompt`, mixes `referenceImageAlias` with `portraitImageAlias`, etc) because bug #3 prevents the HeyGen credential from being materialized, which means Slice 8's structural HeyGen-credential gate filters the talking-avatar fields and description OUT of the tool definition. The LLM never receives Slice 10's 7-section instruction block. Even when the LLM correctly emits `mode: "talking_avatar"`, validation throws on missing `prompt` (#2) and dispatch throws on `talking_avatar_provider_unavailable` (#3).

**Architectural decision (operator-approved 2026-06-05):** Variant B — add a dedicated `plan.talkingAvatarModelKey` + `plan.talkingAvatarFallbackModelKey` field. Plan editor exposes a separate selector that filters to HeyGen rows with `kind === "talking_avatar"`. Materializ-assistant builds a SECOND tool credential ref under the new key `bundle.governance.toolCredentialRefs["video_generate_talking_avatar"]` (separate from `["video_generate"]` — same precedent as `image_edit` vs `image_generate`). Slice 7 looks up `"video_generate_talking_avatar"` when `mode === "talking_avatar"`; cinematic continues to read `"video_generate"` unchanged. HeyGen voice catalog + persona catalog hang off the new talking-avatar credential ref (NOT the cinematic one). Slice 10 tool description renders the talking-avatar sections only when the talking-avatar credential ref is present AND `talkingVideoEnabled === true`.

**Variant A (rejected):** nested `talkingAvatarCredentialOverride` field on the existing video_generate ref. Cleaner mental model but adds nesting; operator chose B for the cleanest plan-editor UX.

**Variant C (deferred):** auto-pick the first active HeyGen row when `plan.talkingAvatarModelKey` is null. Variant B keeps this as a permissive default — materializ falls back to the first active HeyGen row only when `plan.talkingAvatarModelKey` is null AND the rest of the prerequisites pass (secret configured, plan toggle on, at least one active HeyGen row). Operator can later make it strict by setting the field explicitly per plan.

**Slice 10c specification:**

```
### Slice 10c - Live integration fixup (URL + prompt + credential routing + tool description)

Type: full-stack fixup spanning API + WEB + RUNTIME + CONTRACTS. NOT a feature slice — it closes 4 production bugs uncovered by live dev validation.

Scope IN
- Fix #1 (URL double-prefix): remove leading `/api/v1` from the 4 Slice 9 web client methods so they match the rest of the file's `${base}/path` convention.
- Fix #2 (prompt non-empty): in `runtime-video-generate-tool.service.ts::readVideoGenerateArguments`, move the `prompt` non-empty check below the `mode` parsing. Validate `prompt` is required for `mode === "cinematic"` or `mode` absent/null; OPTIONAL for `mode === "talking_avatar"`. When talking_avatar omits prompt, downstream code synthesizes a placeholder ("Talking-avatar render: <speechText short>") for observability + media job request shape — but does NOT pass any user-input text to HeyGen `image_prompt` or similar.
- Fix #3 (talking-avatar credential routing): add `talkingAvatarModelKey?: string | null` + `talkingAvatarFallbackModelKey?: string | null` to `AdminPlanInput` + `AdminPlanState`. Persist via the same `billingProviderHints` JSON column (under `talkingAvatarModelKey` + `talkingAvatarFallbackModelKey` top-level keys, default null). Plan editor: new selector under the Plan Editor's "Video Generation" fold that filters to active HeyGen rows with `kind === "talking_avatar"`. Plan validation (manage-admin-plans `assertCapabilityModelKeysAvailable`): refuse cinematic rows for the new field; refuse if HeyGen row is not active; keep refusing talking_avatar rows on the existing cinematic field (Slice 2b text preserved but reworded to point at the new field instead of "Slice 9 plan toggle"). Materializ-assistant: when `tool_video_generate_heygen` secret is configured AND `plan.talkingVideoEnabled === true` AND there's at least one active HeyGen row in catalog, build a new tool credential ref under `bundle.governance.toolCredentialRefs["video_generate_talking_avatar"]` (same shape as the cinematic ref). modelKey = `plan.talkingAvatarModelKey ?? firstActiveHeyGenRowModelKey`. Voice catalog + persona catalog materialization moves to this NEW key (the cinematic credential ref no longer carries them). Slice 7 runtime: when `mode === "talking_avatar"`, read `bundle.governance.toolCredentialRefs["video_generate_talking_avatar"]` instead of `["video_generate"]`. If missing/not-configured → `talking_avatar_provider_unavailable` with refined warning text pointing at "Plan editor → Video Generation → Talking Avatar Model".
- Fix #4 (LLM tool description): update Slice 10 description's 7-section block: (a) say `prompt` is OPTIONAL for talking_avatar but recommend a one-line scene context for observability; (b) drop the legacy hint that says all video_generate calls need a `prompt` (when talking-avatar fields are present); (c) ensure the persona shortlist + voice shortlist render from the NEW talking-avatar credential ref. Pass BOTH credential refs to `createVideoGenerateToolDefinition`: cinematic for video_generate base fields, talking-avatar for persona/voice/talking-avatar-specific schema.
- Tests for all 4 fixes: web client unit (mock fetch URL inspection), runtime validation, runtime credential resolution, materializ, plan editor, tool projection.

Scope OUT
- Any change to the cinematic video_generate code path beyond the unavoidable tool-projection signature widening.
- Any new HeyGen API call — Slice 6 client unchanged.
- Any new Prisma column — talking-avatar plan fields use existing `billingProviderHints` JSON.
- Webhook conversion — Slice 6 polling stays.
- `orval generate` — hand-edit generated TS for the new plan fields, mirroring Slice 8 pattern.

Forbidden patterns
- Hard-coding the talking-avatar credential lookup key inside Slice 7 — use a constant `VIDEO_GENERATE_TALKING_AVATAR_TOOL_CREDENTIAL_KEY` exported once.
- Falling back from talking_avatar to cinematic credential silently — failure must remain honest with `talking_avatar_provider_unavailable`.
- Building the new credential ref without the structural prerequisites (secret configured + plan toggle on + HeyGen row active).
- Using `.includes()` / regex on field names or LLM-supplied text anywhere in the new code (cross-slice invariant #15).

Required tests
- Web: 4 client methods land on `${base}/workspaces/.../video-personas[/...]` (NOT `/api/v1/api/v1/...`); add unit test asserting the URL passed to `fetch` does NOT contain `api/v1/api/v1`.
- Runtime: talking_avatar request WITHOUT `prompt` passes validation; cinematic without prompt still fails; talking_avatar WITH `prompt` also passes.
- Runtime: `executeTalkingAvatarDispatch` resolves the new credential key when set; falls back to `talking_avatar_provider_unavailable` when null; cinematic dispatch unaffected.
- API: materializ builds the new ref when all prerequisites met; omits it when any is missing; uses fallback HeyGen row when `plan.talkingAvatarModelKey` is null.
- API: plan validation refuses cinematic row on `talkingAvatarModelKey`; refuses talking-avatar row on `videoGenerateModelKey` (Slice 2b regression).
- Web: Admin Plans editor shows the new HeyGen-only selector; round-trips through save.

Exit
- Live talking-avatar render works end-to-end from chat without the four observed errors.
- The Admin Plans editor lets operators choose a talking-avatar model.
- The Settings → Characters page shows real voice catalog entries (assuming HeyGen API succeeds).
- All AGENTS.md verification gates pass.

Deploy
- API + WEB + RUNTIME + CONTRACTS (mirrors Slice 8/9 deploy shape). No Prisma migration.
```

**Slice 10c lands AFTER Slice 10b and BEFORE Slice 11 (live smoke).** It is bug-fixup work, not new feature scope — but its size matches a small slice because it touches multiple architectural layers.

**Status (2026-06-05): Completed.** All four fixes landed under one Slice 10c commit on top of the spec commit `39207360`. **Fix #1 (URL):** the 4 Slice 9 client methods in `apps/web/app/app/assistant-api-client.ts` drop the `/api/v1` prefix → `${base}/workspaces/...`. **Fix #2 (prompt):** `mode` parsed before `prompt`; `prompt` is REQUIRED for cinematic (existing behavior); OPTIONAL for `mode === "talking_avatar"` → runtime synthesizes literal placeholder `"Talking-avatar render"` (no user text leaks; invariant #15 preserved). Slice 10 tool description updated to mark `prompt` as "Required for cinematic mode. Optional for talking_avatar — provide a one-line scene context for observability, or omit." **Fix #3 (credential routing, Variant B):** new `plan.talkingAvatarModelKey` + `plan.talkingAvatarFallbackModelKey` fields on `AdminPlanInputBase` + `AdminPlanState`. Plan editor surfaces a separate HeyGen-only selector (filtered to `kind === "talking_avatar"` rows) under the existing video group, disabled when `talkingVideoEnabled === false`. Slice 2b refusal text updated to point at the new field. New `assertTalkingAvatarModelKeysAvailable` refuses cinematic rows on the new field. Materializ-assistant: new exported constant `VIDEO_GENERATE_TALKING_AVATAR_TOOL_KEY = "video_generate_talking_avatar"`; new `buildTalkingAvatarCredentialRef` returns null when any prerequisite missing; modelKey resolution: `plan.talkingAvatarModelKey` if active, else first active HeyGen row (Variant C fallback). Voice + persona catalogs MOVED to the talking-avatar ref (removed from cinematic). Runtime Slice 7: when `mode === "talking_avatar"` reads the new credential key; null → refined `talking_avatar_provider_unavailable` warning pointing at "Plan editor → Video Generation → Talking Avatar Model". Cinematic dispatch path unchanged. **Fix #4 (tool description):** `createVideoGenerateToolDefinition` signature change `talkingVideoEnabled: boolean` → `talkingAvatarCredential: ref | null`. Structural truth `talkingAvatarEnabled = ref !== null` (semantic equivalence preserved: materializ only builds the ref when toggle is true). Persona + voice catalog hints sourced from the talking-avatar ref. **Persistence:** new plan fields persist via `billingProviderHints` JSON column — NO Prisma migration. **Pre-existing test-suite repair:** `apps/runtime/test/native-tool-projection.test.ts` was using an obsolete self-executing pattern and was NOT registered in `run-suite-isolated.ts`. Slice 10c subagent exported `runNativeToolProjectionTest` and registered it. **Subagent:** Claude Sonnet 4.6 medium thinking; single hire, clean exit; honored "no docs edits" rule (eleventh in a row to do so cleanly). 8/8 verification gates green (lint, format:check, 3 typechecks, web 670/670, api all suites, runtime all suites). 17 files modified. NO `orval generate`. NO Prisma migration. NO HeyGen API client change. Deploy: API + WEB + RUNTIME + CONTRACTS. After this slice, the four bugs observed live on the audit-pass dev deploy are closed: voices load, persona create round-trips, chat talking-avatar dispatches end-to-end. Slice 11 (live smoke + cross-doc updates + final ADR-109 closure) is unblocked.

### E15 - Slice 10d/cleanup: HeyGen talking-avatar must use HeyGen-native model parameters (added 2026-06-05)

**Supersedes:** any reading of `RuntimeVideoModelParameters.duration`, `audioCapabilities`, `inputCapabilities`, or cinematic `size` as operator-facing controls for HeyGen talking-avatar rows.

Live cleanup after Slice 10c exposed two remaining production-truth gaps:

1. **HeyGen talking-avatar dispatch was still synchronous from the LLM turn path.** The `talking_avatar` branch in `runtime-video-generate-tool.service.ts` bypassed the existing cinematic `deferToAsyncMediaJob` gate. Result: the chat showed a long "thinking" state while runtime polled HeyGen inline; no `assistant_media_jobs` row was created; Slice 10b's active-job chip had nothing to render; delivery did not use the normal media-delivery path. Slice 10d wires `talking_avatar` through the same async media-job enqueue path when `params.deferToAsyncMediaJob` is set. Worker re-entry still performs the actual synchronous HeyGen polling, which is the intended async-worker behavior.
2. **The HeyGen provider response was rejected after HeyGen successfully rendered.** Runtime's `isVideoGenerateResult` type guard accepted `openai`, `runway`, and `kling` but not `heygen`. Provider-gateway returned a valid HeyGen result, but runtime treated it as "invalid video generation response", so the paid render was not delivered. The guard now accepts `provider: "heygen"`.
3. **Voice/persona endpoints missed Clerk auth middleware.** The Slice 9 workspace persona routes were not registered in `identity-access.module.ts`, producing `userId=null` and 401s for voice catalog and persona requests. The four workspace video persona routes are now covered by `ClerkAuthMiddleware`.
4. **HeyGen quality/aspect were hardcoded instead of catalog-driven.** Provider-gateway previously submitted every HeyGen video with `resolution: "1080p"` and `aspect_ratio: "auto"` regardless of the admin catalog. Admin Runtime also showed the shared cinematic video fields (duration, audio/input capabilities, aspect JSON), which made operators think those cinematic fields controlled HeyGen. The cleanup keeps the shared catalog envelope for compatibility but makes the operator-facing HeyGen controls HeyGen-native:
   - `providerParameters.resolution`: `"720p" | "1080p" | "4k"`
   - `providerParameters.aspectRatio`: `"auto" | "16:9" | "9:16" | "1:1" | "4:5" | "5:4"`
   - `providerParameters.engine`: `"avatar_iv" | "avatar_v"`

5. **Final follow-up fixes before push (same day, still under E15 cleanup scope).** Three late issues were closed on top of the main 10d cleanup:
   - The Slice 9 workspace voice/persona controller must validate workspace access via canonical membership lookup, not `req.workspaceId`, because the web path may carry `userId` with `workspaceId = null`. The controller now resolves membership from `resolveActiveAssistantService.resolveMembership(userId)` before serving persona/voice data.
   - Runtime/provider recovery must treat HeyGen like the other accepted async video providers. `provider-gateway.client.service.ts` now accepts finite fractional `seconds` in valid HeyGen responses, and `assistant-media-job-scheduler.service.ts` now includes `"heygen"` in the `accepted_primary_unconfirmed` recovery whitelist.
   - Talking-avatar aspect selection now has an explicit user/model intent field `talkingAvatarAspectRatio` (`"16:9" | "9:16" | "1:1"`) on the `video_generate` talking-avatar path. The tool instruction follows the agreed priority: explicit user request first, assistant choice from platform/context/source shape second, omission for provider/default behavior last. Runtime applies this only when the HeyGen admin row is configured with `providerParameters.aspectRatio = "auto"` (or null); a fixed admin aspect remains authoritative.
   - Persona portraits now load through a real authenticated serving path: API exposes `GET /api/v1/workspaces/:workspaceId/video-personas/:personaId/portrait`, and web proxies the already-stored `/api/persona-portrait/<workspaceId>/<personaId>/<hash>` URLs through a same-origin BFF route so existing rows do not need rewriting.
   - The HeyGen voice shortlist no longer sorts-and-slices blindly toward English names. Materialization now preserves balanced `ru` and `en` coverage first, then fills remaining slots, and the Characters create-persona form exposes a simple `RU | EN` filter instead of showing one mixed long list.
   - HeyGen video delivery now remains honest for oversized files. Generated video still attempts normal attachment delivery up to the `100MB` inline ceiling, but when a HeyGen result exceeds that threshold the job is treated as delivered-with-link instead of failed: provider-gateway preserves the original `video_url`, runtime carries it as additive metadata, and API completion appends a direct download link to the assistant message.

Admin Runtime now renders a dedicated "HeyGen talking-avatar parameters" block for HeyGen rows and hides the misleading cinematic duration/audio/input controls for that provider. Runtime forwards the materialized provider parameters to provider-gateway for talking-avatar dispatch. `HeyGenProviderClient` maps them directly to HeyGen v3 `resolution`, `aspect_ratio`, and optional `engine.type`. If a legacy row omits them, defaults remain `1080p`, `auto`, and `avatar_v`.

Important invariant: `speechText`, `voiceKey`/persona voice, and `personaId XOR portraitImageAlias` remain the talking-avatar contract. Cinematic `audioMode`, `inputMode`, `voiceKeys`, `voiceIds`, and `referenceImageAlias(es)` are not HeyGen talking-avatar controls and must not be surfaced as if they are.

### E16 — Saved-persona render root cause: spec re-materialization on persona mutation + non-UUID lookup hardening (added 2026-06-06)

**Symptom (operator, live dev):** rendering a talking-avatar with a **saved** persona (`Alexey`, `Lera`) hung with the progress banner for ~10 minutes and then surfaced a "UUID / image not found" error, while the in-chat assistant simultaneously claimed there were no saved characters even though two existed in Settings → Characters. The avatar rows and `heygenAvatarId` were correctly persisted in the DB, so the failure was downstream of persona creation.

**Root cause (confirmed from the second runtime pod's logs — the first pod had no traffic for these attempts):**

```
[talking-avatar] Persona fetch failed ... personaId=alexey:
Invalid `client.workspaceVideoPersona.findFirst()` invocation ...
Inconsistent column data: Error creating UUID, invalid character ... found `l` at 2
```

1. **Persona create/archive never re-materialized the assistant spec.** Slice 10's `videoPersonaCatalog` is embedded in the materialized spec and is what the model uses to resolve a named character to its `personaId`. Because create/archive did not flag the workspace assistants config-dirty (unlike Telegram/subscription/skills mutations, which all stamp `configDirtyAt`), a freshly created persona stayed invisible to the model. The projection rendered "Available saved characters: none yet", so the model both told the user there were none and, when pushed, improvised `personaId="alexey"` (the display name) instead of the real UUID. This is **not** a keyword-routing issue — the model behaves correctly given an empty catalog; the catalog was simply stale.
2. **`findById`/`archive` crashed on a non-UUID id.** `workspace_video_personas.id` is a Postgres `uuid`. Passing a non-UUID (`"alexey"`) made Prisma throw a raw "Error creating UUID" instead of returning no row; the runtime surfaced this as `talking_avatar_persona_unavailable`. That raw DB error is exactly the "UUID error" the model paraphrased.

**Why the banner hung ~10 minutes before the error (separate defect, same flow):** the async media-job worker classifier `assertVideoToolResultAccepted` (`runtime-media-job-run.service.ts`) threw `ServiceUnavailableException` (503) for **every** `isError` video reason except `requested_mode_unsupported`. A 503 is treated as retryable, so the API scheduler re-queued the job with exponential backoff (`30s → 60s → 120s → 240s → 480s`, base `30s`, ~5 attempts) before giving up — roughly 10–15 minutes of banner on a permanent error. Persona/voice/plan/provider-config failures (`persona_not_found`, `talking_avatar_persona_unavailable`, `talking_avatar_provider_unavailable`, `talking_avatar_plan_disabled`, `voice_not_found`, `voice_required`) can never succeed on retry of the identical job, so retrying them was pure dead waiting.

**Fix:**

- `ManageWorkspaceVideoPersonasService.createPersona` and `archivePersona` now best-effort `updateMany({ where: { workspaceId }, data: { configDirtyAt: now() } })` on the assistants table (reusing the established dirty-stamp pattern). The next runtime turn re-materializes the spec and the model sees the current persona catalog with real `personaId`s. The stamp is non-fatal — a failure logs a warning and never fails the already-committed persona operation; the catalog still refreshes on the next global spec-generation bump.
- `PrismaWorkspaceVideoPersonaRepository.findById`/`archive` guard against non-UUID `personaId` and resolve to `null` (→ honest `persona_not_found`), so a bad id from any caller can no longer crash Prisma.
- `assertVideoToolResultAccepted` now classifies a fixed set of permanent video reasons (`NON_RETRYABLE_VIDEO_REASONS`: the six talking-avatar config/input reasons above plus `requested_mode_unsupported`) as non-retryable `400` instead of `503`. Permanent failures now fail fast (one attempt) and the banner clears immediately; genuinely transient reasons (e.g. provider outage, network) still fall through to `503` and keep their retry budget.

**Note:** the broken portrait thumbnails the operator saw in the Characters list are the already-fixed (but at the time un-deployed) portrait serving route from E15; this fix plus that route deploy together for end-to-end re-validation. Invariants #14 (REST-only persona mutation) and #15 (no keyword routing) are preserved — the dirty-stamp is a structural side-effect of the REST mutation, and the UUID guard is a structural format check, not request-body parsing.

### E4 — Settings Characters section: locked-with-upsell when plan toggle is off

**Supersedes:** § Slice 9 spec ("Hidden when plan `talkingVideoEnabled` is false").

**Decision:** when `talkingVideoEnabled = false` on the active plan, the Characters section is **visible but disabled**, not hidden. Disabled state shows:

- The section title and position (between Character #1 and Limits #2) so users know the feature exists.
- A quiet upsell hint, e.g. "Доступно на тарифе X+" / "Available on Plan X+", with an inactive-style link to `/pricing`.
- Any persona cards the workspace already owns (e.g. created during an upgrade trial) remain visible but disabled: no edit, no delete, no use. A small banner explains "Эти персонажи будут доступны снова при активации тарифа" / "These characters will be usable again when the plan is reactivated".
- No create form, no upload affordances.

**Tone:** quiet conversion hint, not a sales banner. Aligns with "не шумно" (user directive 2026-06-04). Runtime still hard-rejects talking-avatar render with `talking_avatar_plan_disabled` when the toggle is off (existing Slice 7 plan-gate validation; canonical code per erratum E13).

**Slice impact:** Slice 9 must produce two visual states (enabled + disabled) and a tiny i18n entry for the upsell hint.

### E5 — Persona creation is REST-only — new cross-slice invariant #14

Reinforces E1 as a permanent constraint:

> **#14. Persona creation is REST-only.** Runtime tool calls never create personas. The only mutator surface for `workspace_video_personas` is the HTTP endpoint hit by the Settings → Characters form. Any future "create persona via chat" feature requires a new ADR.

### E6 — HeyGen integration targets v3 only

**Supersedes:** § Slice 1 spec (credential setup), § Slice 6 spec (provider client implementation).

**Decision:** every HeyGen API call PersAI makes uses **v3** endpoints against `https://api.heygen.com`. Auth header: `X-Api-Key: <key>`. Submit requests always carry an `Idempotency-Key` header (UUID per logical attempt). PersAI never calls v1/v2 endpoints (e.g. `POST /v2/video/generate` with `character.type: "talking_photo"`, `POST /v1/talking_photo`, `GET /v1/video_status.get`) even though they remain accepted until 2026-10-31. This avoids inheriting the v1/v2 sunset deadline and the documented v2 `talking_photo` lip-sync/billing bugs.

**Slice impact:**

- Slice 6 provider client uses `POST /v3/videos` (with `type: "image"` for Scenario A and `type: "avatar"` for Scenario C), `GET /v3/videos/{video_id}` for poll, `POST /v3/avatars` for lazy avatar create, `DELETE /v3/avatars/looks/{look_id}` + `DELETE /v3/avatars/{group_id}` for persona delete cascade.
- Slice 4 voice cache uses `GET /v3/voices` and (fallback) `POST /v3/voices/speech`.

### E7 — Defensive status parsing — new cross-slice invariant #15 (anti-keyword-routing reinforcement)

Reinforces user directive (2026-06-04) that PersAI must never keyword-route or parse message bodies:

> **#15. No keyword routing, no message-body parsing, no string-matching for behavior decisions, anywhere in PersAI code.** The model decides via tool description; PersAI code only handles structural data. This includes:
>
> - Mode selection (`mode: "cinematic" | "talking_avatar"`) is set explicitly by the model, never inferred from `speechText` content, photo presence, or any other request body inspection.
> - Persona resolution is exact-name equality (case-insensitive Unicode) against the workspace registry; no fuzzy match, no regex, no keyword list.
> - Multi-character detection uses **structural** signals only (e.g. `>1 personaId` field, or strict structural parse like "more than one named-speaker block in the speech script"). Never a keyword list of names.
> - Persona-creation intent ("save this as Masha") is detected by the model (tool description) and surfaced as advice; PersAI code does not parse this string.
> - Disambiguation choice: structured tool result `{status: "needs_disambiguation", candidates: [...]}` lets the chat render cards; the user clicks; the model re-issues `video_generate` with the chosen `personaId`. The chat code does not parse anything.
> - HeyGen poll status: defensive parsing treats any non-terminal status value as "in progress" (the documented `pending`/`processing`/`completed`/`failed` enum plus the `waiting` value seen in create responses; any future undocumented value follows the same rule).

This invariant binds every slice from this point on. A subagent that introduces keyword/regex/string-match routing must have its diff rejected.

### E8 — Tool result shape: `needs_disambiguation` variant

**Supersedes:** § Slice 7 spec (implicit).

**Decision:** the `video_generate` tool result type gets a new discriminated-union member returned when persona name resolves to more than one row:

```ts
type RuntimeVideoGenerateResult =
  | { status: "accepted"; jobId: string /* existing fields */ }
  | { status: "failed"; reason: string; code: string }
  | {
      status: "needs_disambiguation";
      candidates: Array<{
        personaId: string;
        displayName: string;
        portraitUrl: string;
        voiceId: string;
        voiceLabel: string;
        voicePreviewUrl: string | null;
        createdAtIso: string;
      }>;
    };
```

When the chat sees `status: "needs_disambiguation"`, it renders the candidate list as cards (shared `<PersonaCard>` component built in Slice 9). User clicks one card → next model turn calls `video_generate` with the chosen `personaId` → resolves uniquely → proceeds normally. The model receives the candidate list in the tool result and can also render the disambiguation as text if the UI does not enable cards (graceful degradation).

**Slice impact:** Slice 3 (contract) defines the union member. Slice 7 (runtime) returns it on ambiguous lookup. Slice 9 / Slice 10 / Slice 10b extend the chat rendering layer to display cards (lives in `apps/web/app/app/_components/chat-message.tsx` or a new sibling component).

### E9 — Ad-hoc voice selection (revised 2026-06-04 20:18 MSK)

**Supersedes:** an earlier draft of this erratum item that proposed runtime picking the first RU preset as a hardcoded default. Rejected after user feedback — that would be runtime "guessing", which violates cross-slice invariant #15 (no behavior decisions in PersAI code) and diverges from the proven ADR-107 Slice 4 Kling `voice_control` pattern.

**Decision:** the **model picks `voiceKey` explicitly**, the same way it already picks Kling `voiceIds[]` / `voiceKeys[]` under ADR-107 Slice 4 `audioMode: "voice_control"`.

- **Scenario A (ad-hoc):** the materialized tool bundle exposes the HeyGen voice shortlist (Slice 4 cache, attached as `videoVoiceCatalog` per Slice 4 spec). Each shortlist entry carries `voice_id`, `name`, `language`, `gender`, `preview_audio_url`, and (where present) tag/style metadata. The tool description teaches the model to pick a voice that fits the user's context (brand persona, requested gender/mood, language). The model passes the chosen `voiceKey` (= HeyGen `voice_id`) in the `video_generate` tool call. **Runtime does NOT pick a default.** If `mode = "talking_avatar"` is Scenario A and `voiceKey` is missing, runtime fails honestly with `voice_required` so the model retries the same tool call with an explicit pick. This is exactly the Kling `voice_control` failure honesty pattern (`requested_mode_unsupported` for missing voice ids).
- **Scenario C (persona reuse):** voice is already fixed on the persona row (`heygen_voice_id`, chosen by the user in Settings → Characters → Create). The model does not override it. If the user explicitly says "use a different voice" and the model passes an explicit `voiceKey`, runtime accepts the per-call override without mutating the persona row.

**Why this is better than the hardcoded default:**

- Honest. Code never "guesses" — the model decides based on the actual request context (e.g. "женский нежный для парфюмерии", "мужской низкий для рекламы автосалона", "детский для мультика про игрушки").
- Consistent with the ADR-107 Slice 4 pattern PersAI already ships and validates for Kling — no new architectural muscle, just reuse.
- Failure mode is loud, not silent. If the model misses the field, the user sees an honest retry, not the wrong voice playing.
- No assistant-level default-voice setting needed for MVP. A future ADR may add one if usage shows heavy ad-hoc traffic with predictable voice preference per assistant.

**Slice impact:**

- **Slice 3 (tool projection):** `voiceKey` field on `talking_avatar` request shape; tool description includes the voice shortlist (mirrors how the bundle already injects voice catalog for Kling under `voice_control`).
- **Slice 4 (voice cache):** shortlist shape is the same as Kling's `videoVoiceCatalog` attach (provider key `heygen`, voice list with metadata + preview URL). Slice 4 spec already calls for this — E2 just adds `preview_audio_url` guarantee on top.
- **Slice 7 (runtime execution):** validation for Scenario A requires `voiceKey` to be present in the request; missing → `voice_required` honest error; runtime never reads a default from constants or env. For Scenario C, runtime reads `heygen_voice_id` from the persona row unless `voiceKey` was explicitly set in the request (per-call override).
- **Slice 10 (tool description):** teaches the model how to pick from the shortlist by context — gender, language, tags. Same template the Kling voice_control description already uses.

### E10 — Webhook vs polling: polling for MVP (consistent with Runway/Kling)

**Adds clarification not in original ADR.**

HeyGen recommends webhooks (`callback_url` in create body or `POST /v3/webhooks/endpoints`) over polling in production. PersAI's existing Runway/Kling/OpenAI video providers all use polling via `pollMediaJobs` scheduler. For MVP, **HeyGen also uses polling** for consistency. Webhook adoption is a separate optimization slice after the program lands and produces real traffic data.

**Slice impact:** Slice 6 provider client uses polling. Polling cadence default = 10s (matching HeyGen v3 quick-start), tolerant to the 5–30s spread documented across HeyGen sources. Polling-loss tolerance follows the existing Runway/Kling pattern.

### E12 — Eager HeyGen avatar creation at persona POST (added 2026-06-05 01:06 MSK)

**Supersedes the "lazy create on first use" decision in § Decision (line 26), § Scenario B (line 47), § Slice 6 Scope, and § Alternatives "Pre-create HeyGen avatar at persona creation" rejection (line 654).**

The original design deferred HeyGen `POST /v3/avatars` to first video render ("lazy create") to avoid paying $1 to HeyGen for personas that users create but never use. After re-evaluating during Slice 6 closure, the operator chose **simplicity and architectural honesty over the marginal economic optimization**. Lazy-create conflicted with cross-slice invariant #14 (REST-only persona mutation) because runtime would need to write `heygen_avatar_id` back to the persona row after first video, breaking the "only REST mutates `workspace_video_personas`" rule.

**The binding amendment:**

- HeyGen avatar creation happens **synchronously at persona POST**, inside the `ManageWorkspaceVideoPersonasService.createPersona` flow, BEFORE the DB transaction opens.
- `heygen_avatar_id` column is **NOT NULL going forward**. (Slice 5 migration left the column nullable; Slice 5b migration tightens it to NOT NULL after backfill — there are no production rows yet, so backfill is trivial.)
- If HeyGen `POST /v3/avatars` fails, the persona is NOT created and VC is NOT debited. Honest error returned to the user (e.g. `heygen_unavailable`, `heygen_avatar_create_failed`).
- The VC cost (`heygenPersonaCreationVcoin`, Slice 5 default 20 VC) covers the HeyGen $1 avatar-create credit one-for-one at the default `vcoinExchangeRate = $0.05/VC` (ADR-108). Operators may adjust both knobs in Admin Runtime.
- Provider-gateway gets a new internal endpoint `POST /api/v1/providers/heygen/avatars` (or equivalent name — final naming is at subagent discretion within the existing controller conventions) that wraps HeyGen `POST /v3/assets` + `POST /v3/avatars`. The API service calls this endpoint with the (already-normalized) portrait bytes and persona name; it receives `{ avatarId }` back. Provider-gateway remains the sole HTTP caller of HeyGen — the HeyGen API key stays in one place (the gateway's credential resolution path).
- **Cross-slice invariant #14 stays in its original form, unchanged.** Runtime never writes `heygen_avatar_id`.
- The lazy-create code path in `HeyGenProviderClient.generateVideo` (Slice 6) **remains as a defensive fallback** so that if a persona row somehow lands with `heygen_avatar_id === null`, the client still recovers gracefully. The normal-flow execution after Slice 5b never exercises this path. The Slice 6 `lazyCreatedHeygenAvatarId` result field also stays as the gateway's return contract surface (always `null` in normal flow).

**Why not the "internal REST PATCH from runtime" alternative (deferred):** Adding a runtime → internal API → DB hop solely to update a single `heygen_avatar_id` field doubles the moving parts of a hot-path render call. Eager-create at REST POST is one fewer HTTP call per render and preserves the invariant naturally.

**Why not "lazy + erratum to invariant #14":** Erratum would have read "runtime may write exactly one field, `heygen_avatar_id`, on persona rows it did not create". That's a slippery slope — once one runtime-write is allowed for one field, the next persona feature is tempted to add another. Eager-create keeps the invariant clean.

**Operational consequence:** `Slice 5b` is a follow-up slice (between Slice 5 and Slice 7 in execution order) that retrofits eager-create into the existing persona POST endpoint and adds the provider-gateway "create avatar only" endpoint. Slice 7 (runtime talking_avatar execution) is then simpler: persona reads always return a populated `heygen_avatar_id`; Scenario C always uses `type: "avatar"` with the cached id.

---

### E11 — "Tool description" terminology + Admin Presets editor (added 2026-06-04 20:21 MSK)

**Clarifies what "tool description" means across this ADR (no new behavior, terminology pinning only).**

Throughout this ADR (notably § Decision § "Cost model", § Slice 10 spec, and erratum items E1/E7/E8/E9) the phrase "tool description" refers to the text that LLMs see in the function/tool JSON schema for `video_generate`, NOT a user-visible UI string. Concretely:

- **Code default** lives in `apps/runtime/src/modules/turns/native-tool-projection.ts::createVideoGenerateToolDefinition` (and the sibling `voiceCatalogHint` helper). This is what Slice 10 and Slice 4 (voice shortlist hint) actually edit.
- **Admin live override** is available via the existing `/admin/presets` editor (`apps/web/app/admin/presets/page.tsx::ToolPromptState`), which exposes per-tool `codeDefaultModelDescription`, `modelDescription` (override), `modelUsageGuidance` (override), and `modelDescriptionOverridden` / `modelUsageGuidanceOverridden` flags. The runtime resolver `resolveToolDefinitionDescription(policy, codeDefault)` returns the override when present, otherwise the code default. Same pattern already governs every other native tool.
- **Implication for Slice 10:** Slice 10 only changes the code default in `native-tool-projection.ts`. The `/admin/presets` editor automatically picks up the new code default in its "Code default" column and lets operators override per-deployment without a code change. No new admin UI is needed for ADR-109 — `/admin/presets` already covers it.
- **Implication for Slice 4:** the HeyGen voice shortlist hint (analogous to the existing Kling `voiceCatalogHint`) is generated at projection time inside `native-tool-projection.ts` and concatenated into the same `description` string. Slice 4 cache supplies the shortlist data; Slice 10 wires the hint string.

This is terminology pinning. No prior erratum item changes substantively because of E11 — the architecture was already correct, the word "tool description" was just under-specified.

---

### E13 — Audit-pass error-code & contract reconciliation (added 2026-06-05 post-Slice-10)

After the 4-agent independent audit of slices 0–10, several long-standing terminology and contract drifts were reconciled. **E13 is bookkeeping, not new behavior** — every item below documents what the code already does (or now does after the audit-pass commit). Items are listed for future readers who reach for the ADR as the source of truth.

**E13.1 — Canonical plan-disabled error code is `talking_avatar_plan_disabled`.** The ADR draft text in § Plan toggle, § Acceptance checklist item 8, and the Slice 9 spec previously said `feature_unavailable`. No code path ever emitted that string. Runtime emits `talking_avatar_plan_disabled` from `runtime-video-generate-tool.service.ts::executeTalkingAvatarDispatch` when `policy.talkingVideoEnabled === false`. ADR text updated in place.

**E13.2 — Canonical wallet-exhausted error code is `vcoin_balance_exhausted`.** ADR text and audit checklists sometimes referenced `insufficient_balance`; the API never emits that code. ADR-108's wallet primitives use `vcoin_balance_exhausted` and ADR-109 persona creation conforms to ADR-108. Web UI maps `vcoin_balance_exhausted` to `charactersErrorInsufficientBalance` i18n key (the i18n key name is independent of the wire code).

**E13.3 — Distinct error code `talking_avatar_persona_unavailable` documented.** Runtime emits this code (distinct from `persona_not_found`) when the internal runtime persona-fetch endpoint returns degraded/unreachable state OR when a persona row has `heygenAvatarId === "unset_legacy"` (sentinel from the Slice 5b backfill). `persona_not_found` is reserved for honest HTTP 404 on the read path.

**E13.4 — `heygenAvatarId` removed from the user-facing list contract.** Pre-audit, `GET /api/v1/workspaces/:workspaceId/video-personas` returned `heygenAvatarId` on each row in the JSON wire payload, in OpenAPI's `WorkspaceVideoPersonaState`, and in the web client's `PersonaListItemDto` type — despite invariant #5 stating provider avatar IDs must never reach the user-facing surface. Audit-pass commit strips the field from the REST `toListItem` mapper, OpenAPI `WorkspaceVideoPersonaState`, generated TS `workspaceVideoPersonaState.ts`, and the web `PersonaListItemDto`. The internal-runtime read endpoint (`GET /api/v1/internal/runtime/workspaces/:workspaceId/video-personas/:personaId`) continues to return `heygenAvatarId` + `heygenVoiceId` — runtime needs them, and that endpoint is platform-token-authenticated, not user-visible.

**E13.5 — Provider-gateway HeyGen 4xx now preserves 4xx semantics through the API layer.** Pre-audit, `ProviderHeyGenAvatarsService` wrapped every HeyGen client failure in `ServiceUnavailableException` (HTTP 503), so HeyGen-side bad-portrait / invalid-params rejections always surfaced at the API as `heygen_unavailable`. Audit-pass adds a typed `HeyGenProviderClientError { code, httpStatus, providerMessage }` in `heygen-provider.client.ts::createPhotoAvatar`; the gateway service inspects `httpStatus` and throws `BadRequestException(heygen_avatar_create_failed)` for 4xx vs `ServiceUnavailableException(heygen_unavailable)` for 5xx/network/timeout. The API-side `HeyGenProviderGatewayClient`'s existing status-based mapping now flows the right code through to the persona-creation UI.

**E13.6 — Concurrent persona-create wallet over-debit closed via conditional debit.** Pre-audit, the persona-create tx checked balance via `findUnique` then called `vcoinBalanceRepository.debit` — two concurrent POSTs with the same workspace could both observe `balanceVc >= cost` and both debit, dropping the wallet below zero. Audit-pass replaces the read-then-debit pair with a single atomic conditional update inside the tx: `tx.workspaceVcoinBalance.updateMany({ where: { workspaceId, balanceVc: { gte: cost } }, data: { balanceVc: { decrement: cost } } })`. If `updateMany.count === 0`, the tx throws `vcoin_balance_exhausted` honestly. The race window collapses; only one concurrent debit can succeed. The repository's `.debit` abstraction stays in the interface but is no longer the source of truth on the persona-creation hot path.

**E13.7 — Orphan-avatar warning widened to all tx failure modes.** Pre-audit, the orphan warning at `manage-workspace-video-personas.service.ts` only fired when the tx-level race guards (limit/duplicate/balance) rejected after a successful HeyGen call. Other failure modes (constraint violations, infra errors, unexpected debit failures) left an orphan HeyGen avatar silently. Audit-pass widens the catch block so the warning fires for any error thrown after the HeyGen `createPhotoAvatar` succeeds; the original error is always re-thrown.

**E13.8 — Web client now parses `{ error: { code, message } }` envelope correctly.** Pre-audit, the 4 Slice 9 web client methods (`getWorkspaceVideoPersonas`, `getWorkspaceVoiceCatalog`, `createWorkspaceVideoPersona`, `deleteWorkspaceVideoPersona`) read `body?.code` from non-OK responses — but the API's `ApiExceptionFilter` returns `{ error: { code, category, message } }`. As a result, ALL persona-create error code mappings in the Characters UI were unreachable (`heygen_unavailable`, `heygen_avatar_create_failed`, `persona_limit_reached`, `persona_duplicate_name`, `voice_not_found`, `vcoin_balance_exhausted` all fell through to a generic `create_failed` toast). Audit-pass aligns the 4 methods on the pre-existing `readApiErrorEnvelope` helper and throws `ApiStructuredError(envelope.message, envelope.code, envelope.details)`. The UI's `err instanceof ApiStructuredError ? err.code : null` then maps each code to the right i18n message.

**E13.9 — E4 locked state now shows real workspace personas (disabled).** Pre-audit, the Characters section's locked branch rendered only a mock disabled "Маша" card; `loadPersonas()` was gated on `talkingVideoEnabled`, so real workspace personas were never fetched in locked state. This violated E4 ("persona cards visible but disabled — even existing personas"). Audit-pass removes the `talkingVideoEnabled` gate from `loadPersonas`; locked state renders the real workspace persona list as `opacity-60` disabled cards with no create/edit/delete affordances. Zero-persona locked state shows nothing (no mock placeholder). Voice catalog fetch stays gated on the unlocked branch (preview button is hidden / non-interactive in locked state).

**E13.10 — `storageWarning` surfaced honestly in the create-success path.** Pre-audit, the API returned HTTP 200 with `{ persona, storageWarning?: "persona_created_storage_failed" }` when persona creation succeeded but the post-tx portrait storage failed. UI ignored `storageWarning` and showed an unconditional success toast — the user saw a persona with a broken/missing portrait with no warning. Audit-pass branches the create-success path on `response.storageWarning === "persona_created_storage_failed"` and renders a new amber warning feedback line with new i18n keys (`charactersWarnStorageFailedTitle`, `charactersWarnStorageFailedMessage` in both EN and RU).

**E13.11 — `UserPlanVisibilityEntitlements.talkingVideoEnabled` made required everywhere.** Pre-audit, OpenAPI marked the field required with `default: false`; the hand-edited generated TS had `talkingVideoEnabled?: boolean`. The next `orval generate` would have flipped the requiredness. Audit-pass tightens the generated TS to `talkingVideoEnabled: boolean` (required); `resolve-plan-visibility.service.ts` already sets the field explicitly on every path, so no runtime change is needed.

**E13.12 — Stale slice-reference comments cleaned up.** Several inline comments in `runtime-video-generate-tool.service.ts`, `provider-video-generation.service.ts`, and the Prisma schema referenced future Slice 6 / Slice 8 work that had since landed. Audit-pass removes or rewrites: `TODO(slice8)` block (Slice 8 plan-toggle gate is live), `// Slice 8 territory` comment for multi-character rule (Slice 10 owns the LLM-side rule), `// ADR-109 Slice 2a placeholder until Slice 6 lands` (Slice 6 landed), Prisma `heygenAvatarId` doc comment (now reflects E12 eager-create), and the archived-row name reuse comment (now flagged as an acknowledged limitation).

**Acknowledged limitations (no fix in this pass, recorded for honesty):**

- **Archived personas retain HeyGen-side avatar rows.** Soft-delete (`archived = true`) is intentional per Slice 5 spec; PersAI's workspace limit counts only active rows. HeyGen-side avatar slots remain consumed. A future cleanup slice may reconcile via batch deletion at HeyGen.
- **`RuntimeVideoVoiceCatalog` has no `schema: "persai.*.v1"` tag.** Asymmetric with `RuntimeVideoPersonaCatalog` (which carries `persai.runtimeVideoPersonaCatalog.v1`). Voice catalog is bundle-internal and has no cross-boundary readers that need schema tag validation; intentional skip.
- **`persai.runtimeVideoPersonaCatalog.v1` schema tag is set but not validated on read.** Materialization writes the tag, the `describeVideoPersonaCatalogHint` projection reads `catalog?.personas` directly without validation. `isRuntimeVideoPersonaCatalog` type guard remains exported but has no production caller. Kept as future-proofing; can be wired into projection if cross-version drift becomes a real concern.
- **Lazy-create branch in `HeyGenProviderClient.generateVideo` is unreachable from production runtime paths.** Per E12, persona POST stores `heygenAvatarId` eagerly; runtime always passes a non-empty `cachedHeygenAvatarId` to the gateway. The lazy branch is defensive fallback only. Kept per E12 § "Why not lazy + erratum to invariant #14".
- **Web client uses hand-typed DTOs, not orval-generated models.** Drift risk on every contract change. The audit-pass tightened the 3 most exposed drifts (`heygenAvatarId` removal, `talkingVideoEnabled` requiredness, `storageWarning` propagation); a future cleanup slice may wire `assistant-api-client.ts` to import from `packages/contracts/src/generated/model/`.

---

### Erratum-induced acceptance checklist additions

Append to § Acceptance checklist above when implementation lands:

- [ ] No `apps/runtime/**` file mutates `workspace_video_personas` (E1, invariant #14).
- [ ] Every `voice_id`-rendering UI surface uses the shared `<VoicePreviewButton>` component (E2).
- [ ] Voice cache populates `previewAudioUrl` from HeyGen native URL OR PersAI-generated fallback (E2).
- [ ] Talking-video banner copy rotates by elapsed time on talking-avatar jobs only (E3, Slice 10b).
- [ ] Cinematic banner copy unchanged (E3, invariant #1).
- [ ] Settings Characters section is visible-with-upsell (not hidden) when toggle is off (E4).
- [ ] PersAI code calls only HeyGen v3 endpoints (E6).
- [ ] `Idempotency-Key` header present on every `POST /v3/videos` submit (E6).
- [ ] HeyGen poll defensively treats any non-terminal status as in-progress (E7, invariant #15).
- [ ] No keyword routing / message-body parsing introduced anywhere (E7, invariant #15).
- [ ] `heygen_avatar_id` is NOT NULL on every `workspace_video_personas` row created after Slice 5b lands (E12).
- [ ] Persona POST short-circuits cleanly when HeyGen avatar create fails: no persona row, no VC debit, honest error (E12).
- [ ] Provider-gateway exposes a "create photo avatar only" endpoint distinct from video submit (E12).
- [ ] Lazy-create code path in `HeyGenProviderClient.generateVideo` remains as defensive fallback but is never exercised by normal flow (E12).
