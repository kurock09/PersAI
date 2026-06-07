# SESSION-HANDOFF

> Archive: handoff sections from 2026-06-06 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`; 2026-05-19 and earlier remain in `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`.
> Keep this file short: only the current active working set and immediate handoff.

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
- After deploy, live verification should confirm contextual-memory Anthropic turns keep history cache reads and do not repeat `~10.5k` `cacheCreationInputTokens` on short turns.
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
