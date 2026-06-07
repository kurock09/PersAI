# SESSION-HANDOFF

> Archive: handoff sections from 2026-06-06 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`; 2026-05-19 and earlier remain in `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`.
> Keep this file short: only the current active working set and immediate handoff.

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
