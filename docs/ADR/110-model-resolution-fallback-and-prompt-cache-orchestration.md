# ADR-110: Model resolution, fallback, embedding truth, and prompt-cache orchestration

## Status

Completed (2026-06-07). Baseline SHA: `1a0d1ca5`.

This ADR was written after a read-only audit by GPT 5.4 subagents. It is an orchestration program: the parent agent acts as orchestrator/reviewer, while production-code implementation must be delegated to GPT 5.4 subagents unless the user explicitly overrides that rule for a specific change.

## Audit Grounding

Four read-only GPT 5.4 audits were used before setting this ADR scope:

1. Runtime text fallback audit.
2. STT/TTS/web-search non-chat provider audit.
3. Admin Knowledge / Plans embedding audit.
4. Generated-media exclusion audit.

The confirmed current truth is:

- Admin Runtime primary/fallback provider/model settings are persisted and materialized into `runtimeProviderRouting`.
- `runtimeProviderRouting.fallbackMatrix` exists, but provider-failure/timeout failover is not executed by `apps/runtime` turn execution today. Runtime text selection is slot-based (`normal_reply`, `premium_reply`, `reasoning`, `system_tool`, `retrieval`) and falls back to the Normal slot / primary path, not to a failed-provider retry path.
- API does consume `fallbackMatrix` for the `cost_driving_restricted` degrade override, so the matrix is not completely unused.
- STT is OpenAI-only and model-hardcoded, but it is no longer an active ADR-110 blocker.
- TTS already has real provider-chain fallback execution across configured speech providers; it is not missing cross-provider fallback. The remaining TTS issue is hardcoded/default model truth.
- Web-search already has Admin Tools provider selection, but provider-specific model strings remain hardcoded and cross-provider fallback is not executed; this is deferred out of the active ADR-110 slice order.
- Admin Knowledge owns three model fields: embedding index, retrieval helper, authoring agent.
- Admin Knowledge authoring falls back to platform primary when unset.
- Retrieval helper rerank is optional; unset means graceful-off. If configured and provider/model fails, there is no model failover path today.
- Plan-level `embeddingModelKey` still exists across contracts/API/web/persistence and drives assistant-owned knowledge embedding/search.
- Changing a plan `embeddingModelKey` does not enqueue assistant-owned knowledge reindex, so vector search can silently degrade after a plan model change.
- Admin Knowledge embedding backfill currently covers global uploaded Product KB sources and Skill documents, but misses Product KB text entries, Skill knowledge cards, and assistant-owned knowledge.
- Generated-media provider/model selection (`image_generate`, `image_edit`, `video_generate`) is already governed by ADR-106/107/109 and is out of scope for this ADR. The only generated-media invariant repeated here is that HeyGen `talking_avatar` must not fallback to cinematic providers, because ordinary video cannot preserve the requested talking-avatar semantics.

## Decision

Adopt a single orchestration ADR with two independent tracks:

1. **Prompt-cache correctness and economics.**
2. **Model resolution, fallback, and embedding truth.**

These tracks share provider/model boundaries, but they must be executed in separate bounded slices.

## Orchestration Rule

Implementation work under this ADR must follow this operating model:

- The parent agent is the **orchestrator**.
- GPT 5.4 subagents do implementation work.
- The orchestrator writes the slice task, assigns it to subagents, reviews diffs, verifies tests, and either accepts, resumes, or rejects the output.
- The orchestrator must not directly implement production-code changes unless the user explicitly permits it for a specific fix.
- Subagents must receive bounded prompts with exact scope, non-goals, likely files, tests, and invariants.
- Every subagent task must explicitly say: start the slice cleanly and honestly, do not build a parallel replacement path beside the old one, and remove or supersede the old active truth in the same slice. Temporary dual-read/dual-write is allowed only at a persisted-data migration boundary, and the task must name the cleanup condition before implementation starts.
- Subagent summaries are not trusted blindly; the orchestrator verifies code and tests.

## Terminology

- **Normal** means the plan-level everyday chat model, stored as `primaryModelKey`.
- **Premium** means `premiumModelKey`.
- **Reasoning** means `reasoningModelKey`.
- **Platform primary** means the Admin > Runtime global primary model.
- In assistant/plan context, "primary chat model" means **Normal**, not Premium.

## Track A: Prompt-Cache Correctness

### Decision

OpenAI and Anthropic caching are not equivalent and must be handled provider-specifically.

- OpenAI prompt caching is automatic where supported.
- Anthropic prompt caching is explicit (`cache_control`) and has different economics, so stable cache breakpoints must be chosen deliberately.

### Target behavior

1. Represent Anthropic system content as cache-aware blocks where appropriate.
2. Mark stable, high-reuse prompt sections for caching.
3. Avoid placing volatile per-turn developer/user content before cacheable stable blocks in a way that invalidates useful cache reuse.
4. Parse and persist provider-reported cache usage honestly:
   - cache creation/input tokens where exposed
   - cache read tokens where exposed
   - normal uncached input/output tokens
5. Keep cost ledger semantics provider-specific and replay-safe.

### Non-goals

- No fake cached-token values.
- No broad prompt rewrite unrelated to cache layout.
- No user-visible assistant behavior change as part of cache work.

## Track B: Model Resolution and Fallback

### Text/chat fallback

Admin Runtime fallback is currently materialized, but runtime provider-failure/timeout failover is not executed by the normal turn path.

Target:

- Preserve slot inheritance (`retrieval -> system_tool -> Normal`, `premium -> Normal`, etc.).
- Add real runtime failover for eligible text calls when the selected provider/model fails or times out.
- Keep `cost_driving_restricted` API degrade behavior intact.
- Record fallback attempt/result telemetry so operators can see when failover happened.
- Avoid fallback loops.

Non-goal:

- Do not claim fallback is already executed today.
- Do not apply this path to embeddings.

### STT

STT is currently a real gap:

- Provider path is OpenAI-only.
- OpenAI STT model is hardcoded.
- Admin Runtime catalog has capability shapes that could describe STT, but they do not drive the execution path today.

Target:

- Add an STT provider abstraction.
- Make OpenAI the primary STT provider initially.
- Add Yandex SpeechKit as the first fallback candidate, because Yandex credentials/client infrastructure already exists and Russian quality is important for PersAI.
- Move operator-selectable STT model/provider truth into catalog/settings rather than hardcoded constants.
- Preserve billing facts/ledger truth for the successful provider.

Status: deferred from ADR-110 active implementation. It is not a current production blocker and should return as a separate full vertical ADR/slice only when product priority requires it.

### TTS

TTS already has real provider-chain fallback execution. ADR-110 must not describe TTS fallback as missing.

Confirmed current truth:

- TTS fallback chain is materialized and executed in runtime.
- Admin Tools already exposes TTS provider credentials and primary-provider selection.
- Remaining issue: model/default truth still includes hardcoded OpenAI/Yandex model identifiers and code-owned defaults.

Target:

- Reconcile TTS model/default truth into operator-visible catalog/settings where appropriate.
- Keep existing provider-chain fallback behavior.
- Treat Yandex `speechkit-v3` as API-version/path truth unless a later decision makes it an operator-selectable model slot.

### Web-search

Web-search has provider selection but lacks model/default ownership and cross-provider fallback execution.

Confirmed current truth:

- Admin Tools has web-search provider selection.
- Provider-specific model strings for Perplexity/OpenRouter and Gemini are hardcoded in provider-gateway.
- The request chooses one provider and fails if that provider fails; there is no TTS-style provider chain.
- Tool-path billing facts already exist for successful web-search calls.

Status: deferred from ADR-110 active implementation. It is not a current production blocker and should return as a separate full vertical ADR/slice only when product priority requires it.

Deferred target:

- Move web-search model/default truth out of hardcoded source constants.
- Add fallback-aware web-search execution across configured providers.
- Keep billing facts tied to the successful provider/result.

### Retrieval helper

Retrieval helper rerank is fallback-eligible because it is an ordinary LLM call over already-found candidates.

Rules:

- If no helper model is configured, keep current graceful-off behavior unless the product explicitly chooses default-on. This can be intentional token-cost control.
- If a helper model is configured but provider/model fails, use eligible text-model failover.
- If product later chooses helper default-on, empty helper in assistant context should inherit from plan **Normal**, not Premium. Admin-only contexts without a plan may use platform primary.

### Authoring model

Admin Knowledge authoring is an admin/platform operation with no assistant plan context.

Current behavior is acceptable:

- configured `authoringModelKey` wins
- unset authoring model falls back to platform primary

Provider failure failover may be handled by the same future text failover layer where applicable, but this ADR does not require a separate authoring-only fallback mechanism.

## Embedding Truth

### Rule: no generic embedding fallback

Embedding is the explicit exception to generic fallback.

Stored document vectors and query vectors must be produced by the same embedding model. Different embedding models can have different vector spaces and dimensions, causing empty results or silently wrong similarity scores.

Therefore:

- Cross-model embedding fallback is forbidden.
- Same-model retry is allowed.
- Graceful-off is allowed: if no embedding model is configured or the same-model call fails, vector search can be disabled and lexical search can continue.
- Changing embedding model means reindexing every vector-bearing source governed by that embedding truth.

### Ownership decision

Plan-owned embedding should be removed as active product truth. The single embedding model truth should move to Admin > Knowledge.

Required implications:

- Remove `embeddingModelKey` from plan editing, plan payloads, and plan billing hints.
- Change assistant-owned knowledge embedding resolution so it reads Admin Knowledge embedding truth, not plan billing hints.
- Do not hide a model in code when Admin Knowledge is configured. If a bootstrap default is needed while unset, `text-embedding-3-large` may be used only as catalog-backed bootstrap/default guidance, not as hidden override.
- The operator may choose `text-embedding-3-large` manually in Admin > Knowledge for PersAI.

### Reindex/backfill decision

Admin Knowledge embedding changes must be a dangerous, confirmed action because reindex can be expensive.

Before changing the embedding model, the UI/API should make the operator acknowledge:

- affected source count where available
- approximate chunk/token volume where available
- that reindex can cost money and time
- that semantic/vector search may be degraded until reindex completes

Backfill must cover every vector-bearing source governed by the unified embedding truth:

- global uploaded Product KB sources
- Product KB text entries
- Skill documents
- Skill knowledge cards
- assistant-owned uploaded knowledge

Current implementation only covers part of that list, so ADR-110 implementation must close the gap.

## Generated Media Boundary

Generated-media provider/model selection is out of scope:

- `image_generate`
- `image_edit`
- cinematic `video_generate`
- HeyGen `talking_avatar` model selection
- new image provider work

Those remain governed by ADR-106, ADR-107, ADR-109, and any future generated-media ADR.

The only invariant repeated here:

- HeyGen `mode = "talking_avatar"` must stay HeyGen-only and must never fallback to cinematic providers such as OpenAI, Runway, or Kling. Ordinary cinematic video is not a valid substitute for a saved persona / portrait-driven talking head / speech request; on HeyGen failure, the system must fail honestly with a talking-avatar-specific error.

Known adjacent media item, explicitly not ADR-110 scope:

- Any hardcoded image capability rule such as transparent-background support belongs to the generated-media ADR line, not this ADR.

## Execution Slices

### Slice 0 — Audit closure and subagent task pack

Owner: orchestrator.

Status: completed by read-only GPT 5.4 audits before this ADR rewrite.

Exit:

- ADR scope reflects audited code truth.
- Generated media removed from active scope.
- TTS fallback corrected as already implemented.

### Slice 1 — Embedding truth consolidation and reindex safety

Owner: GPT 5.4 subagent. Orchestrator reviews.

Status: completed (2026-06-06).

Scope:

- Remove plan-owned `embeddingModelKey` from contracts/API/web/persistence writes.
- Resolve assistant-owned knowledge embeddings from Admin Knowledge policy.
- Preserve lexical graceful-off when embedding is unset or unavailable.
- Add impact analysis and dangerous confirmation for Admin Knowledge embedding model changes.
- Extend backfill coverage to Product KB text entries, Skill knowledge cards, and assistant-owned knowledge.
- Preserve no-op behavior for sources already indexed with the selected model.
- Expose progress/impact enough for Admin Knowledge UI.
- Update docs/contracts/tests.

Non-goals:

- Do not touch chat/premium/reasoning/system/retrieval plan slots.
- Do not implement generic embedding fallback.
- No dual-indexing unless a later ADR explicitly chooses that cost.

Required verification:

- plan save/read tests without embedding
- assistant knowledge indexing/search tests proving Admin Knowledge embedding is used
- backfill candidate tests for every source type
- no-op tests where selected-model vectors already exist
- confirmation requirement tests
- web tests for confirmation and impact copy
- contract generation if OpenAPI changes
- repo lint/format/typecheck gate

### Slice 2 — Runtime text failover and retrieval helper fallback

Owner: GPT 5.4 subagent. Orchestrator reviews.

Status: completed (2026-06-06).

Scope:

- Make provider-failure/timeout text fallback execute in `apps/runtime` for eligible text calls.
- Preserve existing slot inheritance and API cost-driving degrade behavior.
- Add telemetry for primary failure, fallback attempt, fallback success/failure.
- Avoid fallback loops and repeated attempts.
- If a retrieval helper model is configured and fails, route through eligible text failover.
- Preserve current "empty means rerank disabled" behavior unless product chooses default-on.
- Keep telemetry showing helper model/provider and fallback model/provider.

Non-goals:

- No embedding fallback.
- No generated-media fallback changes.
- Do not force helper rerank on all plans.
- Do not inherit Premium when Normal is intended.

Required verification:

- runtime/provider-gateway focused tests for primary failure -> fallback attempt
- tests for no fallback when fallback is missing/ineligible
- usage/cost accounting tests where affected
- helper failure -> fallback tests
- empty helper -> graceful-off tests

### Deferred — STT and web-search provider/model truth

STT and web-search are known gaps but are explicitly removed from the active ADR-110 execution order. They are not current production blockers and require a later full vertical slice/ADR that defines credential/model contract, bundle materialization, runtime execution, provider-gateway behavior, UI, and tests together.

### Slice 3 — TTS model/default truth cleanup

Owner: GPT 5.4 subagent. Orchestrator reviews.

Status: completed (2026-06-06).

Scope:

- Keep existing TTS provider-chain fallback.
- Move hardcoded/default OpenAI TTS model truth into catalog/settings where appropriate.
- Explicitly decide whether Yandex `speechkit-v3` remains code-owned API-version truth.

Non-goals:

- Do not claim TTS fallback is missing.
- Do not rewrite assistant voice-profile UX.

Required verification:

- focused TTS provider/model selection tests
- existing TTS fallback tests remain green
- billing facts behavior remains correct

### Slice 4 — Anthropic prompt cache

Owner: GPT 5.4 subagent. Orchestrator reviews.

Status: completed (2026-06-06).

Scope:

- Add provider-specific Anthropic `cache_control` handling.
- Keep stable system prompt content cacheable.
- Avoid invalidating cache with volatile per-turn content.
- Capture provider-reported cache usage fields honestly.

Non-goals:

- No fake cache accounting.
- No broad prompt rewrite unrelated to cache layout.

Required verification:

- provider request-shape tests for Anthropic cache blocks
- usage parsing tests
- ledger/accounting tests if persisted fields change

## Global Invariants

- Active path remains PersAI-native only.
- No OpenClaw runtime/deploy compatibility wiring.
- No TODO scaffolding or dead stubs.
- No generic fallback for embedding.
- Generated-media provider/model selection stays out of ADR-110.
- HeyGen talking-avatar does not fallback to cinematic providers.
- No keyword/fuzzy routing where structural catalog/capability data is available.
- Plan `primaryModelKey` means Normal; do not confuse it with Premium.
- Docs and contracts must be updated in the same slice when long-term truth changes.

## Orchestrator Review Checklist

For every subagent output:

1. Inspect changed files and confirm scope boundaries.
2. Confirm the subagent replaced the old active path instead of adding a parallel path. Any temporary compatibility bridge must be tied to persisted-data migration and have an explicit cleanup condition.
3. Search for accidental embedding fallback and generated-media scope creep.
4. Verify hardcoded model-string removals are limited to the assigned scope.
5. Verify tests actually ran and match the touched surface.
6. Run or request the AGENTS.md verification gate before accepting a code slice:

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

7. Add focused runtime/provider-gateway/contracts checks when those boundaries changed.
8. Update `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`, and architecture/API/data/test docs where accepted slices change current truth.

## Consequences

Positive:

- Runtime fallback claims become honest: materialized policy will either execute or be documented as non-executing.
- STT no longer depends on OpenAI-only hardcode.
- TTS scope is corrected to model/default truth rather than reinventing fallback that already exists.
- Web-search gains model/default ownership and real provider failover.
- Embedding no longer hides mass-reindex risk inside plans.
- Admin Knowledge becomes the single embedding truth.
- Expensive embedding model changes become explicit, confirmed, and auditable.
- Anthropic cache economics become honest instead of being treated like OpenAI.

Trade-offs:

- This is multi-slice work touching API, web, runtime, provider-gateway, contracts, and docs.
- Removing plan-owned embedding is a product behavior change requiring careful contract/UI cleanup.
- Assistant-owned knowledge reindex can be expensive and must be throttled/observable.
- Cross-provider fallback can produce slightly different outputs/transcripts; this is acceptable during failover but must be observable.

## Out of Scope

- Dual-indexing embeddings across multiple models.
- Automatic fallback between unrelated embedding providers/models.
- Generated-media provider/model selection (`image_generate`, `image_edit`, `video_generate`), including new image provider work.
- Image capability cleanup such as transparent-background model constraints.
- Voice cloning or HeyGen talking-avatar fallback to non-HeyGen providers.
- Broad pricing-plan redesign unrelated to model slots.

## Closure

ADR-110 is closed.

Completed active execution order:

- Slice 0 — audit closure and bounded subagent task pack
- Slice 1 — embedding truth consolidation and reindex safety
- Slice 2 — runtime text failover and retrieval helper fallback
- Slice 3 — TTS model/default truth cleanup
- Slice 4 — Anthropic prompt cache and honest cache accounting

Follow-up work that remains intentionally outside this ADR:

- STT provider/model truth
- web-search provider/model truth and cross-provider fallback
- deeper OpenAI vs Anthropic first-turn prompt-shape comparison, which is now a separate investigation after the Anthropic double-count accounting bug was fixed
