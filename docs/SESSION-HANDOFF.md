# SESSION-HANDOFF

> Archive: handoff sections from 2026-06-06 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`; 2026-05-19 and earlier remain in `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`.
> Keep this file short: only the current active working set and immediate handoff.

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